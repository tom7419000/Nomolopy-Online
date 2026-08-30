/**
 * Socket.io-Anbindung: eine Verbindung für die gesamte App.
 * Alle Anfragen laufen als Request/Response über Acknowledgements,
 * der Raum-Zustand kommt als 'state'-Broadcast (bei Poker pro Spieler
 * redigiert), dazu Lobby-Events für Raumliste und globalen Chat.
 */

import { io } from 'socket.io-client';
import type { GameId, RoomEnvelope } from '@shared/games';
import type { PokerRules } from '@shared/poker/types';
import type { JeopardyRules } from '@shared/jeopardy/types';
import type { PursuitRules } from '@shared/pursuit/types';
import { useStore, loadSession, saveSession, clearSession } from '../state/store';
import { isLocal } from './mode';

// Socket.io-Pfad aus dem Seitenpfad ableiten, damit die App auch unter
// einem Unterpfad funktioniert (z. B. https://example.de/playhub/ →
// /playhub/socket.io/). An der Wurzel ergibt das das übliche /socket.io/.
const socketPath = `${new URL('.', window.location.href).pathname.replace(/\/+$/, '')}/socket.io/`;

export const socket = io({
  // Gleicher Origin: In Produktion liefert der Server den Client aus,
  // im Dev-Modus proxied Vite /socket.io zum Server.
  path: socketPath,
  // Wird eine lokale Partie fortgesetzt, gar nicht erst verbinden: Der Server
  // hat damit nichts zu tun, und ohne Netz wären es nur Fehlversuche.
  autoConnect: !isLocal(),
});

interface Resp {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

export function call<T extends Resp = Resp>(event: string, payload?: unknown): Promise<T> {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) resolve({ ok: false, error: 'Zeitüberschreitung – Server nicht erreichbar.' } as T);
    }, 8000);
    socket.emit(event, payload, (resp: T) => {
      done = true;
      clearTimeout(timer);
      resolve(resp ?? ({ ok: false, error: 'Keine Antwort vom Server.' } as T));
    });
  });
}

socket.on('connect', async () => {
  // Läuft gerade eine lokale Partie, hat der Server damit nichts zu tun. Ohne
  // diesen Riegel würde die synthetische lokale Sitzung als 'room:rejoin'
  // verschickt, scheitern – und mit ihr die laufende Partie gelöscht.
  if (isLocal()) return;
  const store = useStore.getState();
  store.setConnected(true);
  const session = useStore.getState().session ?? loadSession();
  if (session) {
    const r = await call('room:rejoin', session);
    if (r.ok) {
      useStore.getState().setSession({ ...session, spectator: Boolean(r.spectator) });
    } else {
      const hadRoom = useStore.getState().room !== null;
      clearSession();
      useStore.getState().setSession(null);
      useStore.getState().setRoom(null);
      if (hadRoom) useStore.getState().addToast('error', r.error ?? 'Sitzung abgelaufen.');
    }
  }
});

socket.on('disconnect', () => {
  if (isLocal()) return;
  useStore.getState().setConnected(false);
});

socket.on('state', (room: RoomEnvelope) => {
  if (isLocal()) return;
  useStore.getState().setRoom(room);
});

socket.on('catalog', (payload) => {
  useStore.getState().setCatalog(payload.editions ?? [], payload.presets ?? [], payload.packs ?? []);
});

socket.on('lobby:rooms', (payload) => {
  useStore.getState().setLobbyRooms(payload?.rooms ?? []);
});

socket.on('lobby:chat:history', (payload) => {
  useStore.getState().setLobbyChat(payload?.messages ?? []);
});

socket.on('lobby:chat:new', (payload) => {
  if (payload?.message) useStore.getState().pushLobbyChat(payload.message);
});

socket.on('identity', (payload: { code: string; playerId: string; token: string }) => {
  if (isLocal()) return;
  const prev = useStore.getState().session;
  const session = { code: payload.code, playerId: payload.playerId, token: payload.token, name: prev?.name ?? '' };
  saveSession(session);
  useStore.getState().setSession(session);
});

socket.on('kicked', (payload: { reason?: string }) => {
  if (isLocal()) return;
  clearSession();
  useStore.getState().setSession(null);
  useStore.getState().setRoom(null);
  useStore.getState().addToast('error', payload?.reason ?? 'Du wurdest aus dem Raum entfernt.');
});

// ---------------------------------------------------------------------------
// API-Helfer
// ---------------------------------------------------------------------------

async function withErrorToast<T extends Resp>(p: Promise<T>): Promise<T> {
  const r = await p;
  if (!r.ok && r.error) useStore.getState().addToast('error', r.error);
  return r;
}

function storeJoinReply(r: Resp, name: string): void {
  if (!r.ok) return;
  const session = {
    code: String(r.code),
    playerId: String(r.playerId),
    token: String(r.token),
    name,
    spectator: Boolean(r.spectator),
  };
  saveSession(session);
  useStore.getState().setSession(session);
}

export interface CreateRoomOptions {
  name: string;
  gameId: GameId;
  roomName?: string;
  description?: string;
  isPublic?: boolean;
  maxPlayers?: number;
  editionId?: string;
  presetId?: string;
  pokerRules?: Partial<PokerRules>;
  jeopardyRules?: Partial<JeopardyRules>;
  pursuitRules?: Partial<PursuitRules>;
}

export const socketApi = {
  async createRoom(options: CreateRoomOptions) {
    const r = await withErrorToast(call('room:create', options));
    storeJoinReply(r, options.name);
    return r;
  },

  async joinRoom(code: string, name: string) {
    const r = await withErrorToast(call('room:join', { code, name }));
    storeJoinReply(r, name);
    return r;
  },

  async leaveRoom() {
    await call('room:leave');
    clearSession();
    useStore.getState().setSession(null);
    useStore.getState().setRoom(null);
  },

  /**
   * Spielzug. Der Server entscheidet anhand des Raums, welche Engine ihn
   * bekommt – deshalb reicht EINE Methode für alle Spiele.
   *
   * `_seatId` wird hier ABSICHTLICH ignoriert. Am gemeinsamen Gerät braucht
   * die Oberfläche einen Weg, für einen anderen Sitz zu handeln (Jeopardys
   * „wer war zuerst?"); online wäre genau das die Übernahme einer fremden
   * Identität. Die Identität kommt dort aus dem Socket, nicht aus der
   * Nachricht – deshalb ist der Parameter nur Teil der gemeinsamen Form.
   */
  action(action: unknown, _seatId?: string) {
    return withErrorToast(call('game:action', action));
  },

  chat(text: string) {
    return withErrorToast(call('chat:send', { text }));
  },

  lobbyChat(name: string, text: string) {
    return withErrorToast(call('lobby:chat', { name, text }));
  },

  kick(targetId: string) {
    return withErrorToast(call('room:kick', { targetId }));
  },

  configureLobby(payload: {
    roomName?: string;
    description?: string;
    isPublic?: boolean;
    maxPlayers?: number;
    editionId?: string;
    presetId?: string;
    rules?: Record<string, unknown>;
    poker?: Partial<PokerRules>;
    jeopardy?: Partial<JeopardyRules>;
    pursuit?: Partial<PursuitRules>;
  }) {
    return withErrorToast(call('lobby:configure', payload));
  },

  rerollAppearance() {
    return withErrorToast(call('lobby:reroll'));
  },

  startGame() {
    return withErrorToast(call('lobby:start'));
  },

  rematch() {
    return withErrorToast(call('game:rematch'));
  },

  saveGame() {
    return withErrorToast(call('save:create'));
  },

  listSaves() {
    return call('save:list');
  },

  loadSave(id: string) {
    return withErrorToast(call('save:load', { id }));
  },

  deleteSave(id: string) {
    return call('save:delete', { id });
  },

  saveEdition(edition: unknown) {
    return withErrorToast(call('admin:saveEdition', { edition }));
  },

  deleteEdition(id: string) {
    return withErrorToast(call('admin:deleteEdition', { id }));
  },

  savePack(pack: unknown) {
    return withErrorToast(call('admin:savePack', { pack }));
  },

  deletePack(id: string) {
    return withErrorToast(call('admin:deletePack', { id }));
  },
};

/**
 * Verbindung im lokalen Modus schlafen legen. Ohne das versucht Socket.io
 * ohne Netz endlos zu verbinden – unnötiger Akkuverbrauch am Tablet.
 */
export function suspendSocket(): void {
  if (socket.connected || socket.active) socket.disconnect();
}

/** Verbindung wieder aufnehmen (Rückkehr aus dem lokalen Modus). */
export function resumeSocket(): void {
  if (!socket.connected) socket.connect();
}

/** Die Form, die jeder Transport erfüllen muss. */
export type SocketApi = typeof socketApi;
