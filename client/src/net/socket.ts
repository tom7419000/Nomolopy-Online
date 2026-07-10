/**
 * Socket.io-Anbindung: eine Verbindung für die gesamte App.
 * Alle Anfragen laufen als Request/Response über Acknowledgements,
 * der Spielzustand kommt als 'state'-Broadcast.
 */

import { io } from 'socket.io-client';
import type { GameAction } from '@shared/types';
import { useStore, loadSession, saveSession, clearSession } from '../state/store';

export const socket = io({
  // Gleicher Origin: In Produktion liefert der Server den Client aus,
  // im Dev-Modus proxied Vite /socket.io zum Server.
  autoConnect: true,
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
  const store = useStore.getState();
  store.setConnected(true);
  const session = useStore.getState().session ?? loadSession();
  if (session) {
    const r = await call('room:rejoin', session);
    if (r.ok) {
      useStore.getState().setSession(session);
    } else {
      const hadGame = useStore.getState().game !== null;
      clearSession();
      useStore.getState().setSession(null);
      useStore.getState().setGame(null);
      if (hadGame) useStore.getState().addToast('error', r.error ?? 'Sitzung abgelaufen.');
    }
  }
});

socket.on('disconnect', () => {
  useStore.getState().setConnected(false);
});

socket.on('state', (game) => {
  useStore.getState().setGame(game);
});

socket.on('catalog', (payload) => {
  useStore.getState().setCatalog(payload.editions ?? [], payload.presets ?? []);
});

socket.on('identity', (payload: { code: string; playerId: string; token: string }) => {
  const prev = useStore.getState().session;
  const session = { code: payload.code, playerId: payload.playerId, token: payload.token, name: prev?.name ?? '' };
  saveSession(session);
  useStore.getState().setSession(session);
});

socket.on('kicked', (payload: { reason?: string }) => {
  clearSession();
  useStore.getState().setSession(null);
  useStore.getState().setGame(null);
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

export const api = {
  async createRoom(name: string, editionId: string, presetId: string) {
    const r = await withErrorToast(call('room:create', { name, editionId, presetId }));
    if (r.ok) {
      const session = {
        code: String(r.code),
        playerId: String(r.playerId),
        token: String(r.token),
        name,
      };
      saveSession(session);
      useStore.getState().setSession(session);
    }
    return r;
  },

  async joinRoom(code: string, name: string) {
    const r = await withErrorToast(call('room:join', { code, name }));
    if (r.ok) {
      const session = {
        code: String(r.code),
        playerId: String(r.playerId),
        token: String(r.token),
        name,
      };
      saveSession(session);
      useStore.getState().setSession(session);
    }
    return r;
  },

  async leaveRoom() {
    await call('room:leave');
    clearSession();
    useStore.getState().setSession(null);
    useStore.getState().setGame(null);
  },

  action(action: GameAction) {
    return withErrorToast(call('game:action', action));
  },

  chat(text: string) {
    return withErrorToast(call('chat:send', { text }));
  },

  configureLobby(payload: { editionId?: string; presetId?: string; rules?: Record<string, unknown> }) {
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
};
