/**
 * Verdrahtung des lokalen Raums mit Store und Browser-Speicher.
 *
 * `localRoom.ts` kennt weder Store noch localStorage – hier kommt beides
 * zusammen: der lokale `api` sieht für die Komponenten aus wie der Socket-`api`,
 * und die Partie überlebt einen Reload.
 */

import type { BoardEdition } from '@shared/types';
import type { TriviaPack } from '@shared/trivia/types';
import { BUILT_IN_PACKS } from '@shared/trivia/packs/standard-de';
import type { AnyGameState, GameId, RoomEnvelope } from '@shared/games';
import type { PokerRules } from '@shared/poker/types';
import type { JeopardyRules } from '@shared/jeopardy/types';
import { moduleFor } from '@shared/registry';
import { useStore } from '../state/store';
import { LOCAL_GAME_KEY, setMode } from './mode';
import { resumeSocket, suspendSocket, type SocketApi } from './socket';
import {
  createLocalRoom,
  LocalRoomRunner,
  rotationFor,
  type LocalRoom,
  type LocalSeating,
  type SeatEdge,
} from './localRoom';

const STORE_VERSION = 2;

/**
 * Eigene Fragenpakete im Browser.
 *
 * Anders als Spielstände und Editionen ist das hier KEIN Stummel: Offline
 * mit den eigenen Fragen zu spielen ist gerade der Sinn des lokalen Modus.
 */
const PACKS_KEY = 'playhub.packs';

export function loadLocalPacks(): TriviaPack[] {
  try {
    const raw = localStorage.getItem(PACKS_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? (list as TriviaPack[]) : [];
  } catch {
    return [];
  }
}

/** Eingebaute plus eigene – das, was lokal zur Auswahl steht. */
export function allLocalPacks(): TriviaPack[] {
  return [...BUILT_IN_PACKS, ...loadLocalPacks()];
}

function persistLocalPacks(packs: TriviaPack[]): boolean {
  try {
    localStorage.setItem(PACKS_KEY, JSON.stringify(packs));
    return true;
  } catch {
    return false;
  }
}

interface StoredLocal {
  v: number;
  meta: LocalRoom['meta'];
  /** Zustand des Spiels (v1 hatte stattdessen `monopoly` / `poker`). */
  state?: AnyGameState;
  seating?: LocalSeating | null;
  savedAt: number;
}

/** Die alte Form – nur noch für die Migration. */
interface StoredLocalV1 {
  v: 1;
  meta: LocalRoom['meta'];
  monopoly?: AnyGameState;
  poker?: AnyGameState;
  seating?: null;
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
      state: room.state,
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
    const raw1 = JSON.parse(raw) as StoredLocal | StoredLocalV1;
    if (!raw1?.meta) return null;

    // v1 hatte je Spiel ein eigenes Feld und noch keine Sitzordnung. Eine
    // laufende Partie deswegen zu verwerfen wäre die schlechteste aller
    // Antworten – also anheben statt löschen.
    if (raw1.v === 1) {
      const old = raw1 as StoredLocalV1;
      const state = old.monopoly ?? old.poker;
      if (!state) return null;
      return { v: STORE_VERSION, meta: old.meta, state, seating: null, savedAt: old.savedAt };
    }

    const s = raw1 as StoredLocal;
    if (s.v !== STORE_VERSION || !s.state) return null;
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
  const state = env[env.meta.gameId];
  const players = state ? moduleFor(env.meta.gameId).seats(state) : [];
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
  const r = new LocalRoomRunner(
    room,
    { publish: (env, seatId) => publish(room, env, seatId) },
    // Auch nach einem Reload muss Jeopardy seine Fragen wiederfinden.
    { packs: allLocalPacks() }
  );
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
  jeopardyRules?: Partial<JeopardyRules>;
  editions?: BoardEdition[];
  seatMode?: LocalSeating['mode'];
  seatEdges?: SeatEdge[];
}

/** Legt eine lokale Partie an und startet sie sofort. */
export function startLocalGame(opts: StartLocalOptions): { ok: boolean; error?: string } {
  const room = createLocalRoom({ ...opts, packs: allLocalPacks() });
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
    state: stored.state!,
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

export const localApi: SocketApi = {
  async createRoom() {
    // Lokale Partien entstehen über den Setup-Bildschirm, nicht hierüber.
    return { ok: false, error: 'Lokale Partien werden über „Am Gerät spielen" gestartet.' };
  },

  joinRoom: unavailable('Beitreten'),

  async leaveRoom() {
    leaveLocalMode();
  },

  async action(action: unknown, seatId?: string) {
    const r = requireRunner();
    return withToast(r ? r.action(action, seatId) : { ok: false });
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

  async savePack(pack: unknown) {
    const cleaned = pack as TriviaPack | undefined;
    if (!cleaned?.name) return { ok: false, error: 'Das Paket braucht einen Namen.' };
    const own = loadLocalPacks();
    // Eingebaute lassen sich nicht überschreiben – wie auf dem Server.
    const id = !cleaned.id || BUILT_IN_PACKS.some((p) => p.id === cleaned.id)
      ? `pack-${Math.random().toString(36).slice(2, 10)}`
      : cleaned.id;
    const stored: TriviaPack = { ...cleaned, id, builtIn: false };
    const idx = own.findIndex((p) => p.id === id);
    if (idx >= 0) own[idx] = stored;
    else own.push(stored);

    if (!persistLocalPacks(own)) {
      return { ok: false, error: 'Paket konnte nicht gespeichert werden (Speicher voll).' };
    }
    useStore.getState().setCatalog([], [], allLocalPacks());
    return { ok: true, pack: stored };
  },

  async deletePack(id: string) {
    if (BUILT_IN_PACKS.some((p) => p.id === id)) {
      return { ok: false, error: 'Eingebaute Pakete können nicht gelöscht werden.' };
    }
    const own = loadLocalPacks().filter((p) => p.id !== id);
    if (!persistLocalPacks(own)) return { ok: false, error: 'Konnte nicht gespeichert werden.' };
    useStore.getState().setCatalog([], [], allLocalPacks());
    return { ok: true };
  },
};
