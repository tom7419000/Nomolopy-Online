/**
 * Plattform-Schicht von PlayHub: Räume, Spieler/Zuschauer, Lobby-Chat und
 * öffentliche Raumliste. Jeder Raum trägt genau EIN Spiel (Monopoly oder
 * Poker); die Spiellogik selbst lebt in den Engines unter shared/.
 *
 * Synchronisation wie gehabt: Nach jeder Aktion geht der komplette Zustand
 * an alle Clients im Raum. Bei Poker bekommt jeder Empfänger eine redigierte
 * Sicht (kein Deck, fremde Hole Cards verdeckt) – die Karten verlassen den
 * Server also nie unverschlüsselt für alle.
 */

import type { Server, Socket } from 'socket.io';
import type { BoardEdition, GameAction, GameState, RuleSet } from '../shared/types';
import {
  addPlayer,
  addChat,
  applyAction,
  createGame,
  getPlayer,
  log,
  removeLobbyPlayer,
  rerollAppearance,
  resetToLobby,
  startGame,
  auctionBidderId,
  auctionTick,
  nextDeadline as monopolyNextDeadline,
} from '../shared/engine';
import { getPreset, RULE_PRESETS } from '../shared/rules';
import { randomId, randomRoomCode, PLAYER_COLORS } from '../shared/util';
import {
  GAME_CATALOG,
  getGameInfo,
  MAX_ROOM_DESC,
  MAX_ROOM_NAME,
  MAX_ROOMS,
  type GameId,
  type LobbyChatMessage,
  type PublicRoomInfo,
  type RoomEnvelope,
  type RoomMeta,
  type SpectatorInfo,
} from '../shared/games';
import {
  addPokerChat,
  addPokerPlayer,
  applyPokerAction,
  createPoker,
  getPokerPlayer,
  pokerLog,
  pokerTick,
  removePokerLobbyPlayer,
  resetPokerToLobby,
  startPoker,
  viewFor,
} from '../shared/poker/engine';
import { sanitizePokerRules } from '../shared/poker/rules';
import type { PokerAction, PokerState } from '../shared/poker/types';
import * as store from './store';

interface Room {
  code: string;
  meta: RoomMeta;
  monopoly: GameState | null;
  poker: PokerState | null;
  spectators: SpectatorInfo[];
  /** memberId (Spieler ODER Zuschauer) → geheimes Token für Reconnect */
  secrets: Map<string, string>;
  /** memberId → verbundene Sockets */
  sockets: Map<string, Set<Socket>>;
  lastActivity: number;
  /** Bedenkzeit-Uhr des Raums (Poker-Zug bzw. Auktions-Gebot) */
  timer: NodeJS.Timeout | null;
}

const rooms = new Map<string, Room>();

type Ack = (response: Record<string, unknown>) => void;

function reply(cb: unknown, data: Record<string, unknown>): void {
  if (typeof cb === 'function') (cb as Ack)(data);
}

function cleanName(v: unknown): string {
  return String(v ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 20);
}

function cleanText(v: unknown, max: number): string {
  return String(v ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, max);
}

// ---------------------------------------------------------------------------
// Zustand verteilen
// ---------------------------------------------------------------------------

function envelopeFor(room: Room, viewerId: string | null): RoomEnvelope {
  return {
    meta: room.meta,
    spectators: room.spectators,
    monopoly: room.monopoly ?? undefined,
    poker: room.poker ? viewFor(room.poker, viewerId) : undefined,
  };
}

function roomPhase(room: Room): 'lobby' | 'playing' | 'ended' {
  return room.monopoly?.phase ?? room.poker?.phase ?? 'lobby';
}

function roomPlayers(room: Room): { id: string; name: string; isHost: boolean; connected: boolean }[] {
  return (room.monopoly?.players ?? room.poker?.players ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    isHost: p.isHost,
    connected: p.connected,
  }));
}

function broadcast(io: Server, room: Room): void {
  room.lastActivity = Date.now();
  if (room.poker) {
    // Redigierte Sicht pro Empfänger; Zuschauer & Unbekannte sehen keine Hole Cards
    for (const [memberId, socks] of room.sockets) {
      const env = envelopeFor(room, memberId);
      for (const s of socks) s.emit('state', env);
    }
    scheduleRoomTimer(io, room);
  } else {
    io.to(room.code).emit('state', envelopeFor(room, null));
    scheduleRoomTimer(io, room);
  }
  broadcastLobbyRooms(io);
}

// ---------------------------------------------------------------------------
// Raum-Timer (Poker-Bedenkzeit, Auktions-Bedenkzeit)
// ---------------------------------------------------------------------------

/** Getrennte Spieler bekommen nur eine kurze Gnadenfrist statt der vollen Bedenkzeit. */
const DISCONNECTED_GRACE_MS = 5000;

/** Nächste Frist des Raums, oder null wenn gerade keine Uhr läuft. */
function roomDeadline(room: Room): number | null {
  const p = room.poker;
  if (p && p.phase === 'playing') {
    if (p.street === 'showdown' && p.nextHandAt !== null) return p.nextHandAt;
    if (p.toActIndex !== null && p.actionDeadline !== null) {
      const actor = p.players[p.toActIndex];
      if (actor && !actor.connected) {
        p.actionDeadline = Math.min(p.actionDeadline, Date.now() + DISCONNECTED_GRACE_MS);
      }
      return p.actionDeadline;
    }
    return null;
  }

  const g = room.monopoly;
  if (g && g.phase === 'playing') {
    // Auktionen brauchen eine eigene Uhr: `forceEndTurn` wirkt nur auf den
    // aktuellen Spieler und erreicht einen getrennten BIETER nicht – ohne
    // Frist stünde die Auktion für alle still.
    const at = monopolyNextDeadline(g);
    if (at !== null) {
      const bidder = g.auction ? getPlayer(g, auctionBidderId(g) ?? '') : undefined;
      if (bidder && !bidder.connected && g.auction) {
        g.auction.deadline = Math.min(at, Date.now() + DISCONNECTED_GRACE_MS);
        return g.auction.deadline;
      }
      return at;
    }
  }
  return null;
}

/** Lässt die Zeit im Raum weiterlaufen; true, wenn sich etwas geändert hat. */
function roomTick(room: Room, now: number): boolean {
  if (room.poker) return pokerTick(room.poker, now);
  if (room.monopoly) return auctionTick(room.monopoly, now);
  return false;
}

function scheduleRoomTimer(io: Server, room: Room): void {
  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }
  const at = roomDeadline(room);
  if (at === null) return;

  room.timer = setTimeout(() => {
    room.timer = null;
    if (rooms.get(room.code) !== room) return;
    if (roomTick(room, Date.now())) {
      broadcast(io, room);
    } else {
      scheduleRoomTimer(io, room);
    }
  }, Math.max(50, at - Date.now()));
  room.timer.unref?.();
}

function deleteRoom(io: Server, room: Room): void {
  if (room.timer) clearTimeout(room.timer);
  rooms.delete(room.code);
  broadcastLobbyRooms(io);
}

// ---------------------------------------------------------------------------
// Öffentliche Raumliste & Lobby-Chat
// ---------------------------------------------------------------------------

let lastRoomsSignature = '';

function publicRoomList(): PublicRoomInfo[] {
  const list: PublicRoomInfo[] = [];
  for (const room of rooms.values()) {
    if (!room.meta.isPublic) continue;
    const players = roomPlayers(room);
    list.push({
      code: room.code,
      name: room.meta.name,
      gameId: room.meta.gameId,
      hostName: players.find((p) => p.isHost)?.name ?? '–',
      playerCount: players.length,
      maxPlayers: room.meta.maxPlayers,
      phase: roomPhase(room),
      createdAt: room.meta.createdAt,
    });
  }
  return list.sort((a, b) => b.createdAt - a.createdAt).slice(0, 50);
}

function broadcastLobbyRooms(io: Server): void {
  const list = publicRoomList();
  const signature = JSON.stringify(list);
  if (signature === lastRoomsSignature) return;
  lastRoomsSignature = signature;
  io.emit('lobby:rooms', { rooms: list });
}

const lobbyChat: LobbyChatMessage[] = [];
let lobbyChatSeq = 1;

function nameColor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PLAYER_COLORS[h % PLAYER_COLORS.length];
}

// ---------------------------------------------------------------------------
// Mitglieder-Verwaltung (Spieler + Zuschauer)
// ---------------------------------------------------------------------------

function catalogPayload() {
  return { editions: store.allEditions(), presets: RULE_PRESETS, games: GAME_CATALOG };
}

function uniqueName(existing: string[], name: string): string {
  let candidate = name;
  let n = 2;
  while (existing.some((x) => x.toLowerCase() === candidate.toLowerCase())) {
    candidate = `${name} ${n++}`;
  }
  return candidate;
}

function memberNames(room: Room): string[] {
  return [...roomPlayers(room).map((p) => p.name), ...room.spectators.map((s) => s.name)];
}

function attach(room: Room, socket: Socket, memberId: string): void {
  socket.data.code = room.code;
  socket.data.playerId = memberId;
  socket.join(room.code);
  if (!room.sockets.has(memberId)) room.sockets.set(memberId, new Set());
  room.sockets.get(memberId)!.add(socket);
}

function detach(socket: Socket): { room: Room; memberId: string; lastSocket: boolean } | null {
  const code = socket.data.code as string | undefined;
  const memberId = socket.data.playerId as string | undefined;
  socket.data.code = undefined;
  socket.data.playerId = undefined;
  if (!code || !memberId) return null;
  const room = rooms.get(code);
  if (!room) return null;
  socket.leave(code);
  const set = room.sockets.get(memberId);
  set?.delete(socket);
  const lastSocket = !set || set.size === 0;
  if (lastSocket) room.sockets.delete(memberId);
  return { room, memberId, lastSocket };
}

function currentRoom(socket: Socket): { room: Room; memberId: string } | null {
  const code = socket.data.code as string | undefined;
  const memberId = socket.data.playerId as string | undefined;
  if (!code || !memberId) return null;
  const room = rooms.get(code);
  if (!room) return null;
  return { room, memberId };
}

function isSpectator(room: Room, memberId: string): SpectatorInfo | undefined {
  return room.spectators.find((s) => s.id === memberId);
}

function requireHost(room: Room, memberId: string): boolean {
  if (room.monopoly) return getPlayer(room.monopoly, memberId)?.isHost === true;
  if (room.poker) return getPokerPlayer(room.poker, memberId)?.isHost === true;
  return false;
}

/** Mitglied verlässt den Raum (Tab zu / explizit). */
function handleLeave(io: Server, room: Room, memberId: string, explicit: boolean): void {
  const spectator = isSpectator(room, memberId);
  if (spectator) {
    room.spectators = room.spectators.filter((s) => s.id !== memberId);
    room.secrets.delete(memberId);
    if (room.poker) pokerLog(room.poker, 'system', `👁 ${spectator.name} schaut nicht mehr zu.`);
  } else if (room.monopoly) {
    const game = room.monopoly;
    const player = getPlayer(game, memberId);
    if (!player) return;
    if (game.phase === 'lobby') {
      removeLobbyPlayer(game, memberId);
      room.secrets.delete(memberId);
    } else {
      player.connected = false;
      log(
        game,
        'system',
        explicit ? `${player.name} hat das Spiel verlassen.` : `⚠ Verbindung zu ${player.name} unterbrochen.`,
        memberId
      );
      if (player.isHost) {
        const next = game.players.find((p) => p.connected && !p.bankrupt && p.id !== memberId);
        if (next) {
          player.isHost = false;
          next.isHost = true;
          log(game, 'system', `${next.name} ist jetzt Host.`);
        }
      }
    }
  } else if (room.poker) {
    const poker = room.poker;
    const player = getPokerPlayer(poker, memberId);
    if (!player) return;
    if (poker.phase === 'lobby') {
      removePokerLobbyPlayer(poker, memberId);
      room.secrets.delete(memberId);
    } else {
      // Sitz bleibt reserviert – Wiederbeitritt mit demselben Namen möglich.
      // Abwesende werden vom Timer automatisch gefoldet (Blinds laufen weiter).
      player.connected = false;
      pokerLog(
        poker,
        'system',
        explicit ? `${player.name} hat den Tisch verlassen.` : `⚠ Verbindung zu ${player.name} unterbrochen.`,
        memberId
      );
      if (player.isHost) {
        const next = poker.players.find((p) => p.connected && !p.out && p.id !== memberId);
        if (next) {
          player.isHost = false;
          next.isHost = true;
          pokerLog(poker, 'system', `${next.name} ist jetzt Host.`);
        }
      }
    }
  }

  if (roomPlayers(room).length === 0 && room.spectators.length === 0) {
    deleteRoom(io, room);
    return;
  }
  broadcast(io, room);
}

// ---------------------------------------------------------------------------
// Socket-Handler
// ---------------------------------------------------------------------------

export function registerHandlers(io: Server): void {
  io.on('connection', (socket) => {
    socket.emit('catalog', catalogPayload());
    socket.emit('lobby:rooms', { rooms: publicRoomList() });
    socket.emit('lobby:chat:history', { messages: lobbyChat.slice(-100) });

    // -----------------------------------------------------------------
    // Raum erstellen / beitreten / wieder verbinden
    // -----------------------------------------------------------------

    socket.on('room:create', (payload, cb) => {
      try {
        const name = cleanName(payload?.name);
        if (!name) return reply(cb, { ok: false, error: 'Bitte gib einen Namen ein.' });
        if (rooms.size >= MAX_ROOMS) {
          return reply(cb, { ok: false, error: 'Der Server ist voll – bitte später erneut versuchen.' });
        }
        const gameId: GameId = payload?.gameId === 'poker' ? 'poker' : 'monopoly';
        const info = getGameInfo(gameId);

        let code = randomRoomCode();
        while (rooms.has(code)) code = randomRoomCode();

        const requestedMax = Number(payload?.maxPlayers);
        const maxPlayers = Number.isFinite(requestedMax)
          ? Math.max(info.minPlayers, Math.min(info.maxPlayers, Math.round(requestedMax)))
          : info.maxPlayers;

        const meta: RoomMeta = {
          code,
          name: cleanText(payload?.roomName, MAX_ROOM_NAME) || `${name}s Runde`,
          description: cleanText(payload?.description, MAX_ROOM_DESC),
          gameId,
          isPublic: Boolean(payload?.isPublic),
          maxPlayers,
          createdAt: Date.now(),
        };

        const playerId = randomId();
        const token = randomId(24);
        const room: Room = {
          code,
          meta,
          monopoly: null,
          poker: null,
          spectators: [],
          secrets: new Map([[playerId, token]]),
          sockets: new Map(),
          lastActivity: Date.now(),
          timer: null,
        };

        if (gameId === 'monopoly') {
          const edition = store.getEdition(String(payload?.editionId ?? '')) ?? store.allEditions()[0];
          const presetId = String(payload?.presetId ?? 'classic');
          const preset = getPreset(presetId);
          room.monopoly = createGame(code, edition, preset.id, preset.rules);
          addPlayer(room.monopoly, playerId, name, true);
        } else {
          room.poker = createPoker(code, sanitizePokerRules(payload?.pokerRules));
          addPokerPlayer(room.poker, playerId, name, true);
        }

        rooms.set(code, room);
        attach(room, socket, playerId);
        reply(cb, { ok: true, code, playerId, token, gameId });
        broadcast(io, room);
      } catch (e) {
        console.error('room:create', e);
        reply(cb, { ok: false, error: 'Serverfehler beim Erstellen.' });
      }
    });

    socket.on('room:join', (payload, cb) => {
      try {
        const code = String(payload?.code ?? '').trim().toUpperCase();
        const name = cleanName(payload?.name);
        if (!name) return reply(cb, { ok: false, error: 'Bitte gib einen Namen ein.' });
        const room = rooms.get(code);
        if (!room) return reply(cb, { ok: false, error: 'Raum nicht gefunden – Code prüfen.' });
        const phase = roomPhase(room);

        if (phase === 'lobby') {
          const players = roomPlayers(room);
          if (players.length >= room.meta.maxPlayers) {
            return reply(cb, { ok: false, error: `Der Raum ist voll (max. ${room.meta.maxPlayers}).` });
          }
          const playerId = randomId();
          const token = randomId(24);
          const finalName = uniqueName(memberNames(room), name);
          const result = room.monopoly
            ? addPlayer(room.monopoly, playerId, finalName, false)
            : addPokerPlayer(room.poker!, playerId, finalName, false);
          if (!result.ok) return reply(cb, { ok: false, error: result.error });
          room.secrets.set(playerId, token);
          attach(room, socket, playerId);
          reply(cb, { ok: true, code, playerId, token, gameId: room.meta.gameId });
          broadcast(io, room);
          return;
        }

        // Laufendes/beendetes Spiel: getrennten Spieler mit gleichem Namen übernehmen
        const seat = room.monopoly
          ? room.monopoly.players.find(
              (p) => !p.connected && !p.bankrupt && p.name.toLowerCase() === name.toLowerCase()
            )
          : room.poker!.players.find(
              (p) => !p.connected && !p.out && p.name.toLowerCase() === name.toLowerCase()
            );
        if (seat) {
          const token = randomId(24);
          room.secrets.set(seat.id, token);
          seat.connected = true;
          if (room.monopoly) log(room.monopoly, 'system', `${seat.name} ist wieder verbunden.`, seat.id);
          else pokerLog(room.poker!, 'system', `${seat.name} ist wieder verbunden.`, seat.id);
          attach(room, socket, seat.id);
          reply(cb, { ok: true, code, playerId: seat.id, token, gameId: room.meta.gameId });
          broadcast(io, room);
          return;
        }

        // Poker: Neue Gesichter dürfen zuschauen
        if (room.poker) {
          const spectatorId = randomId();
          const token = randomId(24);
          const finalName = uniqueName(memberNames(room), name);
          room.spectators.push({ id: spectatorId, name: finalName, color: nameColor(finalName) });
          room.secrets.set(spectatorId, token);
          attach(room, socket, spectatorId);
          pokerLog(room.poker, 'system', `👁 ${finalName} schaut jetzt zu.`);
          reply(cb, { ok: true, code, playerId: spectatorId, token, gameId: room.meta.gameId, spectator: true });
          broadcast(io, room);
          return;
        }

        return reply(cb, {
          ok: false,
          error: 'Das Spiel läuft bereits. Beitreten ist nur mit dem Namen eines getrennten Spielers möglich.',
        });
      } catch (e) {
        console.error('room:join', e);
        reply(cb, { ok: false, error: 'Serverfehler beim Beitreten.' });
      }
    });

    socket.on('room:rejoin', (payload, cb) => {
      try {
        const code = String(payload?.code ?? '').trim().toUpperCase();
        const memberId = String(payload?.playerId ?? '');
        const token = String(payload?.token ?? '');
        const room = rooms.get(code);
        if (!room) return reply(cb, { ok: false, error: 'Der Raum existiert nicht mehr.' });
        if (room.secrets.get(memberId) !== token) {
          return reply(cb, { ok: false, error: 'Sitzung abgelaufen.' });
        }
        const spectator = isSpectator(room, memberId);
        if (spectator) {
          attach(room, socket, memberId);
          reply(cb, { ok: true, code, playerId: memberId, token, gameId: room.meta.gameId, spectator: true });
          broadcast(io, room);
          return;
        }
        const player = room.monopoly ? getPlayer(room.monopoly, memberId) : getPokerPlayer(room.poker!, memberId);
        if (!player) return reply(cb, { ok: false, error: 'Spieler nicht mehr im Spiel.' });
        if (!player.connected) {
          player.connected = true;
          if (room.monopoly) log(room.monopoly, 'system', `${player.name} ist wieder verbunden.`, memberId);
          else pokerLog(room.poker!, 'system', `${player.name} ist wieder verbunden.`, memberId);
        }
        attach(room, socket, memberId);
        reply(cb, { ok: true, code, playerId: memberId, token, gameId: room.meta.gameId });
        broadcast(io, room);
      } catch (e) {
        console.error('room:rejoin', e);
        reply(cb, { ok: false, error: 'Serverfehler beim Wiederverbinden.' });
      }
    });

    socket.on('room:leave', (_payload, cb) => {
      const ctx = detach(socket);
      if (ctx) handleLeave(io, ctx.room, ctx.memberId, true);
      reply(cb, { ok: true });
    });

    socket.on('disconnect', () => {
      const ctx = detach(socket);
      if (ctx && ctx.lastSocket) {
        handleLeave(io, ctx.room, ctx.memberId, false);
      }
    });

    // -----------------------------------------------------------------
    // Lobby (Wartezimmer im Raum)
    // -----------------------------------------------------------------

    socket.on('lobby:configure', (payload, cb) => {
      const ctx = currentRoom(socket);
      if (!ctx) return reply(cb, { ok: false, error: 'Kein Raum.' });
      const { room, memberId } = ctx;
      if (!requireHost(room, memberId)) {
        return reply(cb, { ok: false, error: 'Nur der Host kann Einstellungen ändern.' });
      }
      if (roomPhase(room) !== 'lobby') return reply(cb, { ok: false, error: 'Nur in der Lobby möglich.' });

      // Raum-Metadaten
      if (typeof payload?.roomName === 'string') {
        const n = cleanText(payload.roomName, MAX_ROOM_NAME);
        if (n) room.meta.name = n;
      }
      if (typeof payload?.description === 'string') {
        room.meta.description = cleanText(payload.description, MAX_ROOM_DESC);
      }
      if (typeof payload?.isPublic === 'boolean') room.meta.isPublic = payload.isPublic;
      if (typeof payload?.maxPlayers === 'number') {
        const info = getGameInfo(room.meta.gameId);
        const current = roomPlayers(room).length;
        room.meta.maxPlayers = Math.max(
          Math.max(info.minPlayers, current),
          Math.min(info.maxPlayers, Math.round(payload.maxPlayers))
        );
      }

      // Monopoly-Einstellungen
      if (room.monopoly) {
        const game = room.monopoly;
        if (payload?.editionId) {
          const edition = store.getEdition(String(payload.editionId));
          if (edition) game.edition = structuredClone(edition) as BoardEdition;
        }
        if (payload?.presetId) {
          const preset = getPreset(String(payload.presetId));
          game.presetId = preset.id;
          game.rules = { ...preset.rules };
        }
        if (payload?.rules && typeof payload.rules === 'object') {
          const r = payload.rules as Partial<RuleSet>;
          const rules = game.rules;
          if (typeof r.startingMoney === 'number') rules.startingMoney = clamp(r.startingMoney, 100, 10000);
          if (typeof r.goSalary === 'number') rules.goSalary = clamp(r.goSalary, 0, 1000);
          if (typeof r.jailFine === 'number') rules.jailFine = clamp(r.jailFine, 0, 500);
          if (typeof r.freeParkingBonus === 'boolean') rules.freeParkingBonus = r.freeParkingBonus;
          if (typeof r.doubleRentFullGroup === 'boolean') rules.doubleRentFullGroup = r.doubleRentFullGroup;
          if (typeof r.auctionOnSkip === 'boolean') rules.auctionOnSkip = r.auctionOnSkip;
          if (typeof r.auctionBidSeconds === 'number') rules.auctionBidSeconds = clamp(r.auctionBidSeconds, 0, 120);
          if (typeof r.debugMode === 'boolean') rules.debugMode = r.debugMode;
        }
      }

      // Poker-Einstellungen
      if (room.poker && payload?.poker && typeof payload.poker === 'object') {
        room.poker.rules = sanitizePokerRules({ ...room.poker.rules, ...payload.poker });
        room.poker.smallBlind = room.poker.rules.smallBlind;
        room.poker.bigBlind = room.poker.rules.smallBlind * 2;
      }

      reply(cb, { ok: true });
      broadcast(io, room);
    });

    socket.on('lobby:reroll', (_payload, cb) => {
      const ctx = currentRoom(socket);
      if (!ctx) return reply(cb, { ok: false, error: 'Kein Raum.' });
      if (!ctx.room.monopoly) return reply(cb, { ok: false, error: 'Nur bei Monopoly möglich.' });
      const result = rerollAppearance(ctx.room.monopoly, ctx.memberId);
      reply(cb, { ...result });
      if (result.ok) broadcast(io, ctx.room);
    });

    socket.on('lobby:start', (_payload, cb) => {
      const ctx = currentRoom(socket);
      if (!ctx) return reply(cb, { ok: false, error: 'Kein Raum.' });
      const { room, memberId } = ctx;
      if (!requireHost(room, memberId)) return reply(cb, { ok: false, error: 'Nur der Host kann starten.' });
      const result = room.monopoly ? startGame(room.monopoly) : startPoker(room.poker!);
      reply(cb, { ...result });
      if (result.ok) broadcast(io, room);
    });

    /** Host entfernt ein Mitglied aus der Lobby (oder einen Zuschauer jederzeit). */
    socket.on('room:kick', (payload, cb) => {
      const ctx = currentRoom(socket);
      if (!ctx) return reply(cb, { ok: false, error: 'Kein Raum.' });
      const { room, memberId } = ctx;
      if (!requireHost(room, memberId)) return reply(cb, { ok: false, error: 'Nur der Host kann Spieler entfernen.' });
      const targetId = String(payload?.targetId ?? '');
      if (targetId === memberId) return reply(cb, { ok: false, error: 'Du kannst dich nicht selbst entfernen.' });

      const spectator = isSpectator(room, targetId);
      if (!spectator && roomPhase(room) !== 'lobby') {
        return reply(cb, { ok: false, error: 'Während des Spiels bitte die Host-Werkzeuge im Spiel nutzen.' });
      }
      const targetSockets = room.sockets.get(targetId);
      if (spectator) {
        room.spectators = room.spectators.filter((s) => s.id !== targetId);
        room.secrets.delete(targetId);
      } else if (room.monopoly) {
        removeLobbyPlayer(room.monopoly, targetId);
        room.secrets.delete(targetId);
      } else if (room.poker) {
        removePokerLobbyPlayer(room.poker, targetId);
        room.secrets.delete(targetId);
      }
      if (targetSockets) {
        for (const s of targetSockets) {
          s.leave(room.code);
          s.data.code = undefined;
          s.data.playerId = undefined;
          s.emit('kicked', { reason: 'Der Host hat dich aus dem Raum entfernt.' });
        }
        room.sockets.delete(targetId);
      }
      reply(cb, { ok: true });
      broadcast(io, room);
    });

    // -----------------------------------------------------------------
    // Spielaktionen & Chat
    // -----------------------------------------------------------------

    socket.on('game:action', (payload, cb) => {
      const ctx = currentRoom(socket);
      if (!ctx) return reply(cb, { ok: false, error: 'Kein Raum.' });
      const { room, memberId } = ctx;
      try {
        if (room.monopoly) {
          const result = applyAction(room.monopoly, memberId, payload as GameAction);
          reply(cb, { ...result });
          if (result.ok) broadcast(io, room);
        } else if (room.poker) {
          if (isSpectator(room, memberId)) return reply(cb, { ok: false, error: 'Zuschauer können nicht mitspielen.' });
          const result = applyPokerAction(room.poker, memberId, payload as PokerAction);
          reply(cb, { ...result });
          if (result.ok) broadcast(io, room);
        } else {
          reply(cb, { ok: false, error: 'Kein Spiel im Raum.' });
        }
      } catch (e) {
        console.error('game:action', e);
        reply(cb, { ok: false, error: 'Serverfehler bei der Aktion.' });
      }
    });

    socket.on('chat:send', (payload, cb) => {
      const ctx = currentRoom(socket);
      if (!ctx) return reply(cb, { ok: false, error: 'Kein Raum.' });
      const { room, memberId } = ctx;
      if (room.monopoly) {
        const result = addChat(room.monopoly, memberId, String(payload?.text ?? ''));
        reply(cb, { ...result });
        if (result.ok) broadcast(io, room);
        return;
      }
      if (room.poker) {
        const spectator = isSpectator(room, memberId);
        const player = getPokerPlayer(room.poker, memberId);
        const author = spectator
          ? { id: spectator.id, name: `👁 ${spectator.name}`, color: spectator.color }
          : player
            ? { id: player.id, name: player.name, color: player.color }
            : null;
        if (!author) return reply(cb, { ok: false, error: 'Nicht im Raum.' });
        const result = addPokerChat(room.poker, author, String(payload?.text ?? ''));
        reply(cb, { ...result });
        if (result.ok) broadcast(io, room);
        return;
      }
      reply(cb, { ok: false, error: 'Kein Spiel im Raum.' });
    });

    socket.on('game:rematch', (_payload, cb) => {
      const ctx = currentRoom(socket);
      if (!ctx) return reply(cb, { ok: false, error: 'Kein Raum.' });
      const { room, memberId } = ctx;
      if (!requireHost(room, memberId)) {
        return reply(cb, { ok: false, error: 'Nur der Host kann eine neue Runde starten.' });
      }
      if (roomPhase(room) !== 'ended') return reply(cb, { ok: false, error: 'Das Spiel läuft noch.' });

      if (room.monopoly) {
        room.monopoly.players = room.monopoly.players.filter((p) => p.connected);
        resetToLobby(room.monopoly);
      } else if (room.poker) {
        const poker = room.poker;
        // Getrennte fliegen raus; wer verbunden ist (auch Ausgeschiedene), spielt die neue Runde mit
        poker.players = poker.players.filter((p) => p.connected);
        resetPokerToLobby(poker);
        if (poker.players.length > 0 && !poker.players.some((p) => p.isHost)) {
          poker.players[0].isHost = true;
        }
        // Zuschauer bekommen einen Sitz, solange Platz ist
        for (const spec of [...room.spectators]) {
          if (poker.players.length >= room.meta.maxPlayers) break;
          if (!room.sockets.has(spec.id)) continue;
          addPokerPlayer(poker, spec.id, spec.name, poker.players.length === 0);
          room.spectators = room.spectators.filter((s) => s.id !== spec.id);
        }
      }
      reply(cb, { ok: true });
      broadcast(io, room);
    });

    // -----------------------------------------------------------------
    // Globaler Lobby-Chat & Raumliste
    // -----------------------------------------------------------------

    socket.on('lobby:chat', (payload, cb) => {
      const name = cleanName(payload?.name);
      const text = cleanText(payload?.text, 300);
      if (!name) return reply(cb, { ok: false, error: 'Bitte gib zuerst deinen Namen ein.' });
      if (!text) return reply(cb, { ok: false, error: 'Leere Nachricht.' });
      const last = (socket.data.lastLobbyChat as number | undefined) ?? 0;
      const now = Date.now();
      if (now - last < 750) return reply(cb, { ok: false, error: 'Langsam! 😄' });
      socket.data.lastLobbyChat = now;
      const msg: LobbyChatMessage = { id: lobbyChatSeq++, time: now, name, color: nameColor(name), text };
      lobbyChat.push(msg);
      if (lobbyChat.length > 100) lobbyChat.splice(0, lobbyChat.length - 100);
      reply(cb, { ok: true });
      io.emit('lobby:chat:new', { message: msg });
    });

    socket.on('lobby:list', (_payload, cb) => {
      reply(cb, { ok: true, rooms: publicRoomList() });
    });

    // -----------------------------------------------------------------
    // Spielstände speichern/laden (nur Monopoly)
    // -----------------------------------------------------------------

    socket.on('save:create', (_payload, cb) => {
      const ctx = currentRoom(socket);
      if (!ctx) return reply(cb, { ok: false, error: 'Kein Raum.' });
      const { room, memberId } = ctx;
      if (!room.monopoly) return reply(cb, { ok: false, error: 'Spielstände gibt es nur bei Monopoly.' });
      if (!requireHost(room, memberId)) return reply(cb, { ok: false, error: 'Nur der Host kann speichern.' });
      if (room.monopoly.phase === 'lobby') return reply(cb, { ok: false, error: 'Es läuft kein Spiel.' });
      const meta = store.saveGame(room.monopoly);
      log(room.monopoly, 'system', `💾 Spielstand gespeichert („${meta.name}“).`);
      reply(cb, { ok: true, meta });
      broadcast(io, room);
    });

    socket.on('save:list', (_payload, cb) => {
      reply(cb, { ok: true, saves: store.listSaves() });
    });

    socket.on('save:delete', (payload, cb) => {
      const ok = store.deleteSave(String(payload?.id ?? ''));
      reply(cb, { ok });
    });

    socket.on('save:load', (payload, cb) => {
      const ctx = currentRoom(socket);
      if (!ctx) return reply(cb, { ok: false, error: 'Kein Raum.' });
      const { room, memberId } = ctx;
      if (!room.monopoly) return reply(cb, { ok: false, error: 'Spielstände gibt es nur bei Monopoly.' });
      if (!requireHost(room, memberId)) return reply(cb, { ok: false, error: 'Nur der Host kann laden.' });
      const saved = store.loadSave(String(payload?.id ?? ''));
      if (!saved) return reply(cb, { ok: false, error: 'Spielstand nicht gefunden.' });

      const hostName = getPlayer(room.monopoly, memberId)?.name.toLowerCase();
      if (!saved.players.some((p) => p.name.toLowerCase() === hostName)) {
        return reply(cb, { ok: false, error: 'Dein Name kommt in diesem Spielstand nicht vor.' });
      }

      const previousPlayers = room.monopoly.players;
      saved.id = room.code;
      for (const p of saved.players) p.connected = false;
      room.monopoly = saved;

      // Aktuelle Raum-Mitglieder anhand des Namens auf gespeicherte Spieler mappen
      for (const prev of previousPlayers) {
        const socketsOfPlayer = room.sockets.get(prev.id);
        if (!socketsOfPlayer || socketsOfPlayer.size === 0) {
          room.secrets.delete(prev.id);
          continue;
        }
        const seat = saved.players.find((s) => s.name.toLowerCase() === prev.name.toLowerCase());
        if (seat) {
          const token = room.secrets.get(prev.id) ?? randomId(24);
          room.secrets.delete(prev.id);
          room.secrets.set(seat.id, token);
          room.sockets.delete(prev.id);
          seat.connected = true;
          for (const s of socketsOfPlayer) {
            s.data.playerId = seat.id;
            if (!room.sockets.has(seat.id)) room.sockets.set(seat.id, new Set());
            room.sockets.get(seat.id)!.add(s);
            s.emit('identity', { code: room.code, playerId: seat.id, token });
          }
        } else {
          for (const s of socketsOfPlayer) {
            s.leave(room.code);
            s.data.code = undefined;
            s.data.playerId = undefined;
            s.emit('kicked', { reason: 'Du kommst im geladenen Spielstand nicht vor.' });
          }
          room.sockets.delete(prev.id);
          room.secrets.delete(prev.id);
        }
      }
      for (const p of room.monopoly.players) p.isHost = false;
      const hostSeat = room.monopoly.players.find((p) => p.name.toLowerCase() === hostName);
      if (hostSeat) hostSeat.isHost = true;

      log(room.monopoly, 'system', '📂 Spielstand geladen. Getrennte Spieler können mit ihrem Namen wieder beitreten.');
      reply(cb, { ok: true });
      broadcast(io, room);
    });

    // -----------------------------------------------------------------
    // Admin: Editionen
    // -----------------------------------------------------------------

    socket.on('admin:saveEdition', (payload, cb) => {
      const result = store.upsertEdition(payload?.edition);
      if (!result.ok) return reply(cb, { ok: false, error: result.error });
      reply(cb, { ok: true, edition: result.edition });
      io.emit('catalog', catalogPayload());
    });

    socket.on('admin:deleteEdition', (payload, cb) => {
      const result = store.deleteEdition(String(payload?.id ?? ''));
      reply(cb, { ...result });
      if (result.ok) io.emit('catalog', catalogPayload());
    });
  });

  // Verwaiste Räume regelmäßig aufräumen
  setInterval(() => {
    const now = Date.now();
    for (const room of [...rooms.values()]) {
      const anyoneConnected = room.sockets.size > 0;
      const idleMs = now - room.lastActivity;
      if ((!anyoneConnected && idleMs > 60 * 60_000) || idleMs > 24 * 60 * 60_000) {
        deleteRoom(io, room);
      }
    }
  }, 5 * 60_000).unref();
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(v)));
}
