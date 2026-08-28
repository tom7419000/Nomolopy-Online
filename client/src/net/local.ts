/**
 * Verdrahtung des lokalen Raums mit Store und Browser-Speicher.
 *
 * `localRoom.ts` kennt weder Store noch localStorage – hier kommt beides
 * zusammen: der lokale `api` sieht für die Komponenten aus wie der Socket-`api`,
 * und die Partie überlebt einen Reload.
 */

import type { BoardEdition, GameAction } from '@shared/types';
import type { GameId, RoomEnvelope } from '@shared/games';
import type { PokerAction, PokerRules, PokerState } from '@shared/poker/types';
import type { GameState } from '@shared/types';
import { useStore } from '../state/store';
import { LOCAL_GAME_KEY, setMode } from './mode';
import { resumeSocket, suspendSocket } from './socket';
import {
  createLocalRoom,
  LocalRoomRunner,
  rotationFor,
  type LocalRoom,
  type LocalSeating,
  type SeatEdge,
} from './localRoom';

const STORE_VERSION = 2;

interface StoredLocal {
  v: number;
  meta: LocalRoom['meta'];
  monopoly?: GameState;
  poker?: PokerState;
  seating?: LocalSeating | null;
  savedAt: number;
}

let runner: LocalRoomRunner | null = null;
/** Nur einmal warnen, wenn der Speicher voll ist – sonst Toast-Lawine. */
let storageWarned = false;

export function isLocalRunning(): boolean {
  return runner !== null;
}

// ---------------------------------------------------------------------------
// Persistenz
// ---------------------------------------------------------------------------

function persist(room: LocalRoom): void {
  try {
    const payload: StoredLocal = {
      v: STORE_VERSION,
      meta: room.meta,
      savedAt: Date.now(),
      seating: room.seating,
      ...(room.monopoly ? { monopoly: room.monopoly } : {}),
      ...(room.poker ? { poker: room.poker } : {}),
    };
    localStorage.setItem(LOCAL_GAME_KEY, JSON.stringify(payload));
    storageWarned = false;
  } catch {
    // Eigene Editionen können Bilder als Data-URL enthalten und die Quote
    // sprengen. Die Partie läuft weiter – nur ein Reload ginge verloren.
    if (!storageWarned) {
      storageWarned = true;
      useStore.getState().addToast('error', 'Spielstand konnte nicht gesichert werden.');
    }
  }
}

export function clearLocalGame(): void {
  try {
    localStorage.removeItem(LOCAL_GAME_KEY);
  } catch {
    // ignorieren
  }
}

function readStored(): StoredLocal | null {
  try {
    const raw = localStorage.getItem(LOCAL_GAME_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as StoredLocal;
    if (!s?.meta) return null;
    if (!s.monopoly && !s.poker) return null;
    // v1 kannte noch keine Sitzordnung. Eine laufende Partie deswegen zu
    // verwerfen wäre die schlechteste aller Antworten – also anheben.
    if (s.v === 1) return { ...s, v: STORE_VERSION, seating: null };
    if (s.v !== STORE_VERSION) return null;
    return s;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Store-Anbindung
// ---------------------------------------------------------------------------

/**
 * Übernimmt eine frische Sicht in den Store.
 *
 * Der Kern des Pass-&-Play-Modus steckt in der einen Zeile, die `playerId`
 * auf den aktiven Sitz setzt: von da an hält die gesamte bestehende UI den
 * gerade Handelnden für „mich". `useIsMyTurn()` stimmt, die Action-Buttons
 * sind frei, und bei Poker deckt `viewFor` genau die richtigen Karten auf.
 */
function publish(room: LocalRoom, env: RoomEnvelope, seatId: string | null): void {
  const store = useStore.getState();
  const players = env.monopoly?.players ?? env.poker?.players ?? [];
  const seat = players.find((p) => p.id === seatId) ?? players[0];

  store.setSession({
    code: env.meta.code,
    playerId: seat?.id ?? '',
    token: 'local',
    name: seat?.name ?? '',
    mode: 'local',
  });
  store.setSeating(room.seating, rotationFor(room.seating, seat?.id ?? null));
  store.setRoom(env);
  persist(room);
}

function attach(room: LocalRoom): LocalRoomRunner {
  runner?.stop();
  const r = new LocalRoomRunner(room, {
    publish: (env, seatId) => publish(room, env, seatId),
  });
  runner = r;
  return r;
}

/** Betritt den lokalen Modus: Socket schlafen legen, Anzeige auf „bereit". */
function enterLocalMode(): void {
  setMode('local');
  suspendSocket();
  // Ohne das legt sich das Reconnect-Overlay über den Bildschirm, sobald
  // kein Netz da ist – im lokalen Modus wäre das schlicht falsch.
  useStore.getState().setConnected(true);
}

function leaveLocalMode(): void {
  runner?.stop();
  runner = null;
  clearLocalGame();
  setMode('online');
  const store = useStore.getState();
  store.setRoom(null);
  store.setSession(null);
  store.setSeating(null, 0);
  store.setConnected(false);
  resumeSocket();
}

// ---------------------------------------------------------------------------
// Einstieg
// ---------------------------------------------------------------------------

export interface StartLocalOptions {
  gameId: GameId;
  players: string[];
  roomName?: string;
  editionId?: string;
  presetId?: string;
  pokerRules?: Partial<PokerRules>;
  editions?: BoardEdition[];
  seatMode?: LocalSeating['mode'];
  seatEdges?: SeatEdge[];
}

/** Legt eine lokale Partie an und startet sie sofort. */
export function startLocalGame(opts: StartLocalOptions): { ok: boolean; error?: string } {
  const room = createLocalRoom(opts);
  enterLocalMode();
  const r = attach(room);
  const started = r.start();
  if (!started.ok) {
    leaveLocalMode();
    useStore.getState().addToast('error', started.error ?? 'Partie konnte nicht starten.');
  }
  return started;
}

/**
 * Stellt eine gespeicherte Partie beim App-Start wieder her.
 * Gibt zurück, ob etwas wiederhergestellt wurde.
 */
export function restoreLocalGame(): boolean {
  const stored = readStored();
  if (!stored) return false;

  const room: LocalRoom = {
    meta: stored.meta,
    monopoly: stored.monopoly ?? null,
    poker: stored.poker ?? null,
    seating: stored.seating ?? null,
  };
  enterLocalMode();
  attach(room).publish();
  return true;
}

// ---------------------------------------------------------------------------
// Der lokale api – gleiche Form wie der Socket-api
// ---------------------------------------------------------------------------

const unavailable = (what: string) => async () => ({
  ok: false as const,
  error: `${what} gibt es im lokalen Modus nicht.`,
});

function withToast(r: { ok: boolean; error?: string }) {
  if (!r.ok && r.error) useStore.getState().addToast('error', r.error);
  return r;
}

function requireRunner(): LocalRoomRunner | null {
  if (!runner) useStore.getState().addToast('error', 'Keine lokale Partie aktiv.');
  return runner;
}

export const localApi = {
  async createRoom() {
    // Lokale Partien entstehen über den Setup-Bildschirm, nicht hierüber.
    return { ok: false, error: 'Lokale Partien werden über „Am Gerät spielen" gestartet.' };
  },

  joinRoom: unavailable('Beitreten'),

  async leaveRoom() {
    leaveLocalMode();
  },

  async action(action: GameAction) {
    const r = requireRunner();
    return withToast(r ? r.action(action) : { ok: false });
  },

  async pokerAction(action: PokerAction) {
    const r = requireRunner();
    return withToast(r ? r.action(action) : { ok: false });
  },

  async chat(text: string) {
    const r = requireRunner();
    return withToast(r ? r.chat(text) : { ok: false });
  },

  lobbyChat: unavailable('Den Lobby-Chat'),
  kick: unavailable('Spieler entfernen'),
  configureLobby: unavailable('Raum-Einstellungen'),
  rerollAppearance: unavailable('Neue Spielfigur'),

  async startGame() {
    const r = requireRunner();
    return withToast(r ? r.start() : { ok: false });
  },

  async rematch() {
    const r = requireRunner();
    return withToast(r ? r.rematch() : { ok: false });
  },

  saveGame: unavailable('Spielstände auf dem Server'),
  async listSaves() {
    return { ok: false, error: 'Im lokalen Modus nicht verfügbar.', saves: [] };
  },
  loadSave: unavailable('Spielstände laden'),
  async deleteSave() {
    return { ok: false, error: 'Im lokalen Modus nicht verfügbar.' };
  },
  saveEdition: unavailable('Eigene Editionen speichern'),
  deleteEdition: unavailable('Eigene Editionen löschen'),
};
