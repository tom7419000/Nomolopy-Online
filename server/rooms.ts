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
import type { GameState } from '../shared/types';
import { log } from '../shared/engine';
import { getPreset, RULE_PRESETS } from '../shared/rules';
import { randomId, randomRoomCode, PLAYER_COLORS } from '../shared/util';
import {
  GAME_CATALOG,
  getGameInfo,
  MAX_ROOM_DESC,
  MAX_ROOM_NAME,
  MAX_ROOMS,
  isGameId,
  type AnyGameState,
  type GameId,
  type LobbyChatMessage,
  type PublicRoomInfo,
  type RoomEnvelope,
  type RoomMeta,
  type SpectatorInfo,
} from '../shared/games';
import { pokerLog } from '../shared/poker/engine';
import { moduleFor, type SeatInfo } from '../shared/registry';
import * as store from './store';

/** Was Spiele beim Anlegen und Umkonfigurieren von außen brauchen. */
const deps = {
  editions: () => store.allEditions(),
  preset: (id: string) => getPreset(id) as unknown as { id: string; rules: Record<string, unknown> },
};

/**
 * Protokollzeile ins Spiel schreiben, egal welches Spiel.
 * (Die Engines haben je eigene log-Funktionen; die Plattform braucht nur eine.)
 */
/**
 * Monopoly-Zustand des Raums, sonst null.
 *
 * Spielstände bleiben bewusst Monopoly-eigen (`caps.saveLoad`): ein
 * Speicherformat, das eine ganze Edition einbettet, für Spiele zu
 * verallgemeinern, die eine halbe Stunde dauern, wäre reine Altlast.
 */
function monopolyState(room: Room): GameState | null {
  return room.meta.gameId === 'monopoly' ? (room.state as GameState) : null;
}

function roomLog(room: Room, text: string, playerId?: string): void {
  if (room.meta.gameId === 'poker') pokerLog(room.state as never, 'system', text, playerId);
  else log(room.state as never, 'system', text, playerId);
}

interface Room {
  code: string;
  meta: RoomMeta;
  /** Der Zustand des Spiels, das dieser Raum spielt (siehe `meta.gameId`). */
  state: AnyGameState;
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

/** Das Modul, das dieser Raum spielt. */
function mod(room: Room) {
  return moduleFor(room.meta.gameId);
}

function envelopeFor(room: Room, viewerId: string | null): RoomEnvelope {
  const m = mod(room);
  const view = m.redact ? m.redact(room.state, viewerId) : room.state;
  return {
    meta: room.meta,
    spectators: room.spectators,
    [room.meta.gameId]: view,
  } as RoomEnvelope;
}

function roomPhase(room: Room): 'lobby' | 'playing' | 'ended' {
  return mod(room).phase(room.state);
}

function roomPlayers(room: Room): SeatInfo[] {
  return mod(room).seats(room.state);
}

function broadcast(io: Server, room: Room): void {
  room.lastActivity = Date.now();
  if (mod(room).redactPerViewer) {
    // Verdeckte Information: die Sicht muss pro Empfänger gerechnet werden.
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

function scheduleRoomTimer(io: Server, room: Room): void {
  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }
  const m = mod(room);
  if (m.phase(room.state) !== 'playing') return;

  const at = m.deadline(room.state, Date.now());
  if (at === null) return;

  room.timer = setTimeout(() => {
    room.timer = null;
    // Der Raum kann inzwischen abgeräumt oder ersetzt worden sein.
    if (rooms.get(room.code) !== room) return;
    if (m.tick(room.state, Date.now())) {
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
  return roomPlayers(room).find((p) => p.id === memberId)?.isHost === true;
}

/** Mitglied verlässt den Raum (Tab zu / explizit). */
function handleLeave(io: Server, room: Room, memberId: string, explicit: boolean): void {
  const spectator = isSpectator(room, memberId);
  if (spectator) {
    room.spectators = room.spectators.filter((s) => s.id !== memberId);
    room.secrets.delete(memberId);
    roomLog(room, `👁 ${spectator.name} schaut nicht mehr zu.`);
  } else {
    const m = mod(room);
    const player = m.seats(room.state).find((p) => p.id === memberId);
    if (!player) return;

    if (m.phase(room.state) === 'lobby') {
      m.removeLobbyPlayer(room.state, memberId);
      room.secrets.delete(memberId);
    } else {
      // Sitz bleibt reserviert – Wiederbeitritt mit demselben Namen möglich.
      m.setConnected(room.state, memberId, false);
      roomLog(
        room,
        explicit
          ? `${player.name} hat das Spiel verlassen.`
          : `⚠ Verbindung zu ${player.name} unterbrochen.`,
        memberId
      );
      const next = m.transferHost(room.state, memberId);
      if (next) roomLog(room, `${next.name} ist jetzt Host.`);
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
        // Unbekannte Kennungen wurden früher still zu Monopoly.
        if (!isGameId(payload?.gameId)) {
          return reply(cb, { ok: false, error: 'Unbekanntes Spiel.' });
        }
        const gameId: GameId = payload.gameId;
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
        const m = moduleFor(gameId);
        const room: Room = {
          code,
          meta,
          state: m.create(code, { ...payload }, deps, Date.now()),
          spectators: [],
          secrets: new Map([[playerId, token]]),
          sockets: new Map(),
          lastActivity: Date.now(),
          timer: null,
        };
        m.addPlayer(room.state, playerId, name, true);

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
          const result = mod(room).addPlayer(room.state, playerId, finalName, false);
          if (!result.ok) return reply(cb, { ok: false, error: result.error });
          room.secrets.set(playerId, token);
          attach(room, socket, playerId);
          reply(cb, { ok: true, code, playerId, token, gameId: room.meta.gameId });
          broadcast(io, room);
          return;
        }

        // Laufendes/beendetes Spiel: getrennten Spieler mit gleichem Namen übernehmen
        const seat = mod(room).caps.rejoinByName
          ? roomPlayers(room).find(
              (p) => !p.connected && !p.eliminated && p.name.toLowerCase() === name.toLowerCase()
            )
          : undefined;
        if (seat) {
          const token = randomId(24);
          room.secrets.set(seat.id, token);
          mod(room).setConnected(room.state, seat.id, true);
          roomLog(room, `${seat.name} ist wieder verbunden.`, seat.id);
          attach(room, socket, seat.id);
          reply(cb, { ok: true, code, playerId: seat.id, token, gameId: room.meta.gameId });
          broadcast(io, room);
          return;
        }

        // Manche Spiele nehmen neue Gesichter als Zuschauer auf (Poker, später Jeopardy)
        if (mod(room).caps.spectators) {
          const spectatorId = randomId();
          const token = randomId(24);
          const finalName = uniqueName(memberNames(room), name);
          room.spectators.push({ id: spectatorId, name: finalName, color: nameColor(finalName) });
          room.secrets.set(spectatorId, token);
          attach(room, socket, spectatorId);
          roomLog(room, `👁 ${finalName} schaut jetzt zu.`);
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
        const player = roomPlayers(room).find((p) => p.id === memberId);
        if (!player) return reply(cb, { ok: false, error: 'Spieler nicht mehr im Spiel.' });
        if (!player.connected) {
          mod(room).setConnected(room.state, memberId, true);
          roomLog(room, `${player.name} ist wieder verbunden.`, memberId);
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

      // Spielspezifische Einstellungen übernimmt das jeweilige Modul –
      // vorher stand hier eine handgeschriebene Allowlist pro Regelfeld,
      // die bei jeder neuen Regel vergessen werden konnte.
      mod(room).configure(room.state, { ...payload }, deps);

      reply(cb, { ok: true });
      broadcast(io, room);
    });

    socket.on('lobby:reroll', (_payload, cb) => {
      const ctx = currentRoom(socket);
      if (!ctx) return reply(cb, { ok: false, error: 'Kein Raum.' });
      const reroll = mod(ctx.room).rerollAppearance;
      if (!reroll) return reply(cb, { ok: false, error: 'Bei diesem Spiel gibt es nichts zu würfeln.' });
      const result = reroll(ctx.room.state, ctx.memberId);
      reply(cb, { ...result });
      if (result.ok) broadcast(io, ctx.room);
    });

    socket.on('lobby:start', (_payload, cb) => {
      const ctx = currentRoom(socket);
      if (!ctx) return reply(cb, { ok: false, error: 'Kein Raum.' });
      const { room, memberId } = ctx;
      if (!requireHost(room, memberId)) return reply(cb, { ok: false, error: 'Nur der Host kann starten.' });
      const result = mod(room).start(room.state, Date.now());
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
      } else {
        mod(room).removeLobbyPlayer(room.state, targetId);
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
        if (isSpectator(room, memberId)) {
          return reply(cb, { ok: false, error: 'Zuschauer können nicht mitspielen.' });
        }
        const result = mod(room).apply(room.state, memberId, payload, Date.now());
        reply(cb, { ...result });
        if (result.ok) broadcast(io, room);
      } catch (e) {
        console.error('game:action', e);
        reply(cb, { ok: false, error: 'Serverfehler bei der Aktion.' });
      }
    });

    socket.on('chat:send', (payload, cb) => {
      const ctx = currentRoom(socket);
      if (!ctx) return reply(cb, { ok: false, error: 'Kein Raum.' });
      const { room, memberId } = ctx;
      const spectator = isSpectator(room, memberId);
      const player = roomPlayers(room).find((p) => p.id === memberId);
      const author = spectator
        ? { id: spectator.id, name: `👁 ${spectator.name}`, color: spectator.color }
        : player
          ? { id: player.id, name: player.name, color: player.color }
          : null;
      if (!author) return reply(cb, { ok: false, error: 'Nicht im Raum.' });

      const result = mod(room).chat(room.state, author, String(payload?.text ?? ''));
      reply(cb, { ...result });
      if (result.ok) broadcast(io, room);
    });

    socket.on('game:rematch', (_payload, cb) => {
      const ctx = currentRoom(socket);
      if (!ctx) return reply(cb, { ok: false, error: 'Kein Raum.' });
      const { room, memberId } = ctx;
      if (!requireHost(room, memberId)) {
        return reply(cb, { ok: false, error: 'Nur der Host kann eine neue Runde starten.' });
      }
      if (roomPhase(room) !== 'ended') return reply(cb, { ok: false, error: 'Das Spiel läuft noch.' });

      mod(room).resetForRematch(room.state, {
        spectators: room.spectators.map((sp) => ({ id: sp.id, name: sp.name, color: sp.color })),
        maxPlayers: room.meta.maxPlayers,
        // Wer einen Sitz bekommen hat, ist kein Zuschauer mehr.
        onSeated: (id) => {
          room.spectators = room.spectators.filter((sp) => sp.id !== id);
        },
      });

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
      const game = monopolyState(room);
      if (!game) return reply(cb, { ok: false, error: 'Spielstände gibt es nur bei Monopoly.' });
      if (!requireHost(room, memberId)) return reply(cb, { ok: false, error: 'Nur der Host kann speichern.' });
      if (game.phase === 'lobby') return reply(cb, { ok: false, error: 'Es läuft kein Spiel.' });
      const meta = store.saveGame(game);
      log(game, 'system', `💾 Spielstand gespeichert („${meta.name}“).`);
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
      const game = monopolyState(room);
      if (!game) return reply(cb, { ok: false, error: 'Spielstände gibt es nur bei Monopoly.' });
      if (!requireHost(room, memberId)) return reply(cb, { ok: false, error: 'Nur der Host kann laden.' });
      const saved = store.loadSave(String(payload?.id ?? ''));
      if (!saved) return reply(cb, { ok: false, error: 'Spielstand nicht gefunden.' });

      const hostName = game.players.find((p) => p.id === memberId)?.name.toLowerCase();
      if (!saved.players.some((p) => p.name.toLowerCase() === hostName)) {
        return reply(cb, { ok: false, error: 'Dein Name kommt in diesem Spielstand nicht vor.' });
      }

      const previousPlayers = game.players;
      saved.id = room.code;
      for (const p of saved.players) p.connected = false;
      room.state = saved;

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
      for (const p of saved.players) p.isHost = false;
      const hostSeat = saved.players.find((p) => p.name.toLowerCase() === hostName);
      if (hostSeat) hostSeat.isHost = true;

      log(saved, 'system', '📂 Spielstand geladen. Getrennte Spieler können mit ihrem Namen wieder beitreten.');
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

