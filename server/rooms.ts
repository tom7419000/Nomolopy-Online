/**
 * Raum- und Verbindungs-Verwaltung: Spieler treten Räumen bei, Aktionen
 * laufen durch die Engine, der komplette Spielzustand wird nach jeder
 * Änderung an alle Clients im Raum gesendet (Zustand ist klein genug,
 * Delta-Sync lohnt sich nicht).
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
} from '../shared/engine';
import { getPreset, RULE_PRESETS } from '../shared/rules';
import { randomId, randomRoomCode, MAX_PLAYERS } from '../shared/util';
import * as store from './store';

interface Room {
  code: string;
  game: GameState;
  /** playerId → geheimes Token für Reconnect */
  secrets: Map<string, string>;
  /** playerId → verbundene Sockets */
  sockets: Map<string, Set<Socket>>;
  lastActivity: number;
}

const rooms = new Map<string, Room>();

type Ack = (response: Record<string, unknown>) => void;

function reply(cb: unknown, data: Record<string, unknown>): void {
  if (typeof cb === 'function') (cb as Ack)(data);
}

function broadcast(io: Server, room: Room): void {
  room.lastActivity = Date.now();
  io.to(room.code).emit('state', room.game);
}

function catalogPayload() {
  return { editions: store.allEditions(), presets: RULE_PRESETS };
}

function cleanName(v: unknown): string {
  return String(v ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 20);
}

function uniqueName(game: GameState, name: string): string {
  let candidate = name;
  let n = 2;
  while (game.players.some((p) => p.name.toLowerCase() === candidate.toLowerCase())) {
    candidate = `${name} ${n++}`;
  }
  return candidate;
}

function attach(room: Room, socket: Socket, playerId: string): void {
  socket.data.code = room.code;
  socket.data.playerId = playerId;
  socket.join(room.code);
  if (!room.sockets.has(playerId)) room.sockets.set(playerId, new Set());
  room.sockets.get(playerId)!.add(socket);
}

function detach(socket: Socket): { room: Room; playerId: string; lastSocket: boolean } | null {
  const code = socket.data.code as string | undefined;
  const playerId = socket.data.playerId as string | undefined;
  socket.data.code = undefined;
  socket.data.playerId = undefined;
  if (!code || !playerId) return null;
  const room = rooms.get(code);
  if (!room) return null;
  socket.leave(code);
  const set = room.sockets.get(playerId);
  set?.delete(socket);
  const lastSocket = !set || set.size === 0;
  if (lastSocket) room.sockets.delete(playerId);
  return { room, playerId, lastSocket };
}

function currentRoom(socket: Socket): { room: Room; playerId: string } | null {
  const code = socket.data.code as string | undefined;
  const playerId = socket.data.playerId as string | undefined;
  if (!code || !playerId) return null;
  const room = rooms.get(code);
  if (!room) return null;
  return { room, playerId };
}

function requireHost(room: Room, playerId: string): boolean {
  return getPlayer(room.game, playerId)?.isHost === true;
}

/** Spieler verlässt den Raum (Tab zu / explizit). */
function handleLeave(io: Server, room: Room, playerId: string, explicit: boolean): void {
  const player = getPlayer(room.game, playerId);
  if (!player) return;
  if (room.game.phase === 'lobby') {
    removeLobbyPlayer(room.game, playerId);
    room.secrets.delete(playerId);
  } else {
    player.connected = false;
    log(
      room.game,
      'system',
      explicit
        ? `${player.name} hat das Spiel verlassen.`
        : `⚠ Verbindung zu ${player.name} unterbrochen.`,
      playerId
    );
    // Host-Rechte an einen verbundenen Spieler weitergeben
    if (player.isHost) {
      const next = room.game.players.find((p) => p.connected && !p.bankrupt && p.id !== playerId);
      if (next) {
        player.isHost = false;
        next.isHost = true;
        log(room.game, 'system', `${next.name} ist jetzt Host.`);
      }
    }
  }
  if (room.game.players.length === 0) {
    rooms.delete(room.code);
    return;
  }
  broadcast(io, room);
}

export function registerHandlers(io: Server): void {
  io.on('connection', (socket) => {
    socket.emit('catalog', catalogPayload());

    // -----------------------------------------------------------------
    // Raum erstellen / beitreten / wieder verbinden
    // -----------------------------------------------------------------

    socket.on('room:create', (payload, cb) => {
      try {
        const name = cleanName(payload?.name);
        if (!name) return reply(cb, { ok: false, error: 'Bitte gib einen Namen ein.' });
        const edition = store.getEdition(String(payload?.editionId ?? '')) ?? store.allEditions()[0];
        const presetId = String(payload?.presetId ?? 'classic');
        const preset = getPreset(presetId);
        let code = randomRoomCode();
        while (rooms.has(code)) code = randomRoomCode();
        const game = createGame(code, edition, preset.id, preset.rules);
        const playerId = randomId();
        const token = randomId(24);
        addPlayer(game, playerId, name, true);
        const room: Room = {
          code,
          game,
          secrets: new Map([[playerId, token]]),
          sockets: new Map(),
          lastActivity: Date.now(),
        };
        rooms.set(code, room);
        attach(room, socket, playerId);
        reply(cb, { ok: true, code, playerId, token });
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

        if (room.game.phase === 'lobby') {
          if (room.game.players.length >= MAX_PLAYERS) {
            return reply(cb, { ok: false, error: `Der Raum ist voll (max. ${MAX_PLAYERS}).` });
          }
          const playerId = randomId();
          const token = randomId(24);
          const result = addPlayer(room.game, playerId, uniqueName(room.game, name), false);
          if (!result.ok) return reply(cb, { ok: false, error: result.error });
          room.secrets.set(playerId, token);
          attach(room, socket, playerId);
          reply(cb, { ok: true, code, playerId, token });
          broadcast(io, room);
          return;
        }

        // Laufendes Spiel: getrennten Spieler mit gleichem Namen übernehmen
        const seat = room.game.players.find(
          (p) => !p.connected && !p.bankrupt && p.name.toLowerCase() === name.toLowerCase()
        );
        if (!seat) {
          return reply(cb, {
            ok: false,
            error:
              'Das Spiel läuft bereits. Beitreten ist nur mit dem Namen eines getrennten Spielers möglich.',
          });
        }
        const token = randomId(24);
        room.secrets.set(seat.id, token);
        seat.connected = true;
        log(room.game, 'system', `${seat.name} ist wieder verbunden.`, seat.id);
        attach(room, socket, seat.id);
        reply(cb, { ok: true, code, playerId: seat.id, token });
        broadcast(io, room);
      } catch (e) {
        console.error('room:join', e);
        reply(cb, { ok: false, error: 'Serverfehler beim Beitreten.' });
      }
    });

    socket.on('room:rejoin', (payload, cb) => {
      try {
        const code = String(payload?.code ?? '').trim().toUpperCase();
        const playerId = String(payload?.playerId ?? '');
        const token = String(payload?.token ?? '');
        const room = rooms.get(code);
        if (!room) return reply(cb, { ok: false, error: 'Der Raum existiert nicht mehr.' });
        if (room.secrets.get(playerId) !== token) {
          return reply(cb, { ok: false, error: 'Sitzung abgelaufen.' });
        }
        const player = getPlayer(room.game, playerId);
        if (!player) return reply(cb, { ok: false, error: 'Spieler nicht mehr im Spiel.' });
        if (!player.connected) {
          player.connected = true;
          log(room.game, 'system', `${player.name} ist wieder verbunden.`, playerId);
        }
        attach(room, socket, playerId);
        reply(cb, { ok: true, code, playerId, token });
        broadcast(io, room);
      } catch (e) {
        console.error('room:rejoin', e);
        reply(cb, { ok: false, error: 'Serverfehler beim Wiederverbinden.' });
      }
    });

    socket.on('room:leave', (_payload, cb) => {
      const ctx = detach(socket);
      if (ctx) handleLeave(io, ctx.room, ctx.playerId, true);
      reply(cb, { ok: true });
    });

    socket.on('disconnect', () => {
      const ctx = detach(socket);
      if (ctx && ctx.lastSocket) {
        const { room, playerId } = ctx;
        const player = getPlayer(room.game, playerId);
        if (!player) return;
        if (room.game.phase === 'lobby') {
          handleLeave(io, room, playerId, false);
        } else {
          player.connected = false;
          log(room.game, 'system', `⚠ Verbindung zu ${player.name} unterbrochen.`, playerId);
          broadcast(io, room);
        }
      }
    });

    // -----------------------------------------------------------------
    // Lobby
    // -----------------------------------------------------------------

    socket.on('lobby:configure', (payload, cb) => {
      const ctx = currentRoom(socket);
      if (!ctx) return reply(cb, { ok: false, error: 'Kein Raum.' });
      const { room, playerId } = ctx;
      if (!requireHost(room, playerId)) return reply(cb, { ok: false, error: 'Nur der Host kann Einstellungen ändern.' });
      if (room.game.phase !== 'lobby') return reply(cb, { ok: false, error: 'Nur in der Lobby möglich.' });

      if (payload?.editionId) {
        const edition = store.getEdition(String(payload.editionId));
        if (edition) room.game.edition = structuredClone(edition) as BoardEdition;
      }
      if (payload?.presetId) {
        const preset = getPreset(String(payload.presetId));
        room.game.presetId = preset.id;
        room.game.rules = { ...preset.rules };
      }
      if (payload?.rules && typeof payload.rules === 'object') {
        const r = payload.rules as Partial<RuleSet>;
        const rules = room.game.rules;
        if (typeof r.startingMoney === 'number') rules.startingMoney = clamp(r.startingMoney, 100, 10000);
        if (typeof r.goSalary === 'number') rules.goSalary = clamp(r.goSalary, 0, 1000);
        if (typeof r.jailFine === 'number') rules.jailFine = clamp(r.jailFine, 0, 500);
        if (typeof r.freeParkingBonus === 'boolean') rules.freeParkingBonus = r.freeParkingBonus;
        if (typeof r.doubleRentFullGroup === 'boolean') rules.doubleRentFullGroup = r.doubleRentFullGroup;
        if (typeof r.debugMode === 'boolean') rules.debugMode = r.debugMode;
      }
      reply(cb, { ok: true });
      broadcast(io, room);
    });

    socket.on('lobby:reroll', (_payload, cb) => {
      const ctx = currentRoom(socket);
      if (!ctx) return reply(cb, { ok: false, error: 'Kein Raum.' });
      const result = rerollAppearance(ctx.room.game, ctx.playerId);
      reply(cb, { ...result });
      if (result.ok) broadcast(io, ctx.room);
    });

    socket.on('lobby:start', (_payload, cb) => {
      const ctx = currentRoom(socket);
      if (!ctx) return reply(cb, { ok: false, error: 'Kein Raum.' });
      const { room, playerId } = ctx;
      if (!requireHost(room, playerId)) return reply(cb, { ok: false, error: 'Nur der Host kann starten.' });
      const result = startGame(room.game);
      reply(cb, { ...result });
      if (result.ok) broadcast(io, room);
    });

    // -----------------------------------------------------------------
    // Spielaktionen & Chat
    // -----------------------------------------------------------------

    socket.on('game:action', (payload, cb) => {
      const ctx = currentRoom(socket);
      if (!ctx) return reply(cb, { ok: false, error: 'Kein Raum.' });
      try {
        const result = applyAction(ctx.room.game, ctx.playerId, payload as GameAction);
        reply(cb, { ...result });
        if (result.ok) broadcast(io, ctx.room);
      } catch (e) {
        console.error('game:action', e);
        reply(cb, { ok: false, error: 'Serverfehler bei der Aktion.' });
      }
    });

    socket.on('chat:send', (payload, cb) => {
      const ctx = currentRoom(socket);
      if (!ctx) return reply(cb, { ok: false, error: 'Kein Raum.' });
      const result = addChat(ctx.room.game, ctx.playerId, String(payload?.text ?? ''));
      reply(cb, { ...result });
      if (result.ok) broadcast(io, ctx.room);
    });

    socket.on('game:rematch', (_payload, cb) => {
      const ctx = currentRoom(socket);
      if (!ctx) return reply(cb, { ok: false, error: 'Kein Raum.' });
      const { room, playerId } = ctx;
      if (!requireHost(room, playerId)) return reply(cb, { ok: false, error: 'Nur der Host kann eine neue Runde starten.' });
      if (room.game.phase !== 'ended') return reply(cb, { ok: false, error: 'Das Spiel läuft noch.' });
      // Getrennte Spieler fliegen bei der Neuauflage raus
      room.game.players = room.game.players.filter((p) => p.connected);
      resetToLobby(room.game);
      reply(cb, { ok: true });
      broadcast(io, room);
    });

    // -----------------------------------------------------------------
    // Spielstände speichern/laden
    // -----------------------------------------------------------------

    socket.on('save:create', (_payload, cb) => {
      const ctx = currentRoom(socket);
      if (!ctx) return reply(cb, { ok: false, error: 'Kein Raum.' });
      const { room, playerId } = ctx;
      if (!requireHost(room, playerId)) return reply(cb, { ok: false, error: 'Nur der Host kann speichern.' });
      if (room.game.phase === 'lobby') return reply(cb, { ok: false, error: 'Es läuft kein Spiel.' });
      const meta = store.saveGame(room.game);
      log(room.game, 'system', `💾 Spielstand gespeichert („${meta.name}“).`);
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
      const { room, playerId } = ctx;
      if (!requireHost(room, playerId)) return reply(cb, { ok: false, error: 'Nur der Host kann laden.' });
      const saved = store.loadSave(String(payload?.id ?? ''));
      if (!saved) return reply(cb, { ok: false, error: 'Spielstand nicht gefunden.' });

      const hostName = getPlayer(room.game, playerId)?.name.toLowerCase();
      if (!saved.players.some((p) => p.name.toLowerCase() === hostName)) {
        return reply(cb, { ok: false, error: 'Dein Name kommt in diesem Spielstand nicht vor.' });
      }

      const previousPlayers = room.game.players;
      saved.id = room.code;
      for (const p of saved.players) p.connected = false;
      room.game = saved;

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
          // Mitglied kommt im Spielstand nicht vor → zurück zum Startbildschirm
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
      // Host-Rechte dem Lader geben
      for (const p of room.game.players) p.isHost = false;
      const hostSeat = room.game.players.find((p) => p.name.toLowerCase() === hostName);
      if (hostSeat) hostSeat.isHost = true;

      log(room.game, 'system', '📂 Spielstand geladen. Getrennte Spieler können mit ihrem Namen wieder beitreten.');
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
    for (const [code, room] of rooms) {
      const anyoneConnected = room.game.players.some((p) => p.connected);
      const idleMs = now - room.lastActivity;
      if ((!anyoneConnected && idleMs > 60 * 60_000) || idleMs > 24 * 60 * 60_000) {
        rooms.delete(code);
      }
    }
  }, 5 * 60_000).unref();
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(v)));
}
