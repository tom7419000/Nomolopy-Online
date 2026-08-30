import { create } from 'zustand';
import type { BoardEdition, GameState, Player, RulePreset } from '@shared/types';
import type { SeatInfo } from '@shared/registry';
import type { TriviaPack } from '@shared/trivia/types';
import { BUILT_IN_PACKS } from '@shared/trivia/packs/standard-de';
import type { LobbyChatMessage, PublicRoomInfo, RoomEnvelope } from '@shared/games';
import type { PokerView } from '@shared/poker/types';
import { moduleFor } from '@shared/registry';
import { CLIENT_GAMES } from '../games/registry';
import type { LocalSeating, SeatEdge } from '../net/localRoom';

export interface Session {
  code: string;
  playerId: string;
  token: string;
  name: string;
  spectator?: boolean;
  /**
   * Im lokalen Pass-&-Play-Modus wandert `playerId` mit dem aktiven Sitz.
   * Der Diskriminator hält solche Sitzungen aus dem Server-Reconnect heraus
   * und schaltet die Hinweistexte auf den Spielernamen um.
   */
  mode?: 'online' | 'local';
}

export interface Toast {
  id: number;
  kind: 'info' | 'error' | 'success' | 'turn';
  text: string;
}

export type Dialog =
  | { type: 'admin' }
  | { type: 'packs' }
  | { type: 'debug' }
  | { type: 'trade'; partnerId?: string }
  | { type: 'saves' }
  | { type: 'property'; tileId: number }
  | null;

interface AppStore {
  connected: boolean;
  editions: BoardEdition[];
  presets: RulePreset[];
  /** Fragenpakete – eingebaut, bis der Server-Katalog eintrifft. */
  packs: TriviaPack[];
  session: Session | null;
  /** Aktueller Raum (Hülle mit meta + genau einem Spielzustand) */
  room: RoomEnvelope | null;
  /** Bequemer Zugriff: Monopoly-Zustand, wenn der Raum Monopoly spielt */
  game: GameState | null;
  /** Bequemer Zugriff: redigierte Poker-Sicht, wenn der Raum Poker spielt */
  poker: PokerView | null;
  lobbyRooms: PublicRoomInfo[];
  lobbyChat: LobbyChatMessage[];
  toasts: Toast[];
  dialog: Dialog;
  /** Sitzordnung im lokalen Modus (Darstellung, kein Spielzustand) */
  seating: LocalSeating | null;
  /** Drehwinkel der Spielansicht – folgt dem Sitz, der gerade handelt */
  rotation: SeatEdge;
  setConnected(v: boolean): void;
  setCatalog(editions: BoardEdition[], presets: RulePreset[], packs: TriviaPack[]): void;
  setRoom(room: RoomEnvelope | null): void;
  setSession(session: Session | null): void;
  setSeating(seating: LocalSeating | null, rotation: SeatEdge): void;
  setLobbyRooms(rooms: PublicRoomInfo[]): void;
  setLobbyChat(messages: LobbyChatMessage[]): void;
  pushLobbyChat(message: LobbyChatMessage): void;
  addToast(kind: Toast['kind'], text: string): void;
  dismissToast(id: number): void;
  openDialog(dialog: Dialog): void;
  closeDialog(): void;
}

let toastSeq = 1;

export const useStore = create<AppStore>((set, get) => ({
  connected: false,
  editions: [],
  presets: [],
  packs: BUILT_IN_PACKS,
  session: loadSession(),
  room: null,
  game: null,
  poker: null,
  lobbyRooms: [],
  lobbyChat: [],
  toasts: [],
  dialog: null,
  seating: null,
  rotation: 0,

  setConnected: (v) => set({ connected: v }),

  setCatalog: (editions, presets, packs) => set({ editions, presets, packs }),

  setRoom: (room) => {
    const { room: prevRoom, session, addToast } = get();
    const game = room?.monopoly ?? null;
    const poker = room?.poker ?? null;

    if (room && session) {
      const gameId = room.meta.gameId;
      const m = moduleFor(gameId);
      const state = room[gameId];
      const prevState = prevRoom?.meta.gameId === gameId ? prevRoom[gameId] : undefined;

      if (state) {
        // „Du bist dran" – generisch über die Registry, statt wie früher
        // einmal handgeschrieben pro Spiel.
        const nowActive = m.activeSeatId(state);
        const prevActive = prevState ? m.activeSeatId(prevState) : null;
        if (nowActive === session.playerId && prevActive !== session.playerId) {
          const seat = m.seats(state).find((p) => p.id === nowActive);
          // Am gemeinsamen Gerät ist der Name die Information, die zählt –
          // „du" wäre für alle am Tisch mehrdeutig.
          addToast(
            'turn',
            session.mode === 'local' ? `👉 ${seat?.name ?? 'Jemand'} ist dran` : '👉 Du bist dran!'
          );
        }

        // Alles Weitere weiß nur das Spiel selbst.
        CLIENT_GAMES[gameId].notify?.(prevState ?? null, state, {
          playerId: session.playerId,
          local: session.mode === 'local',
          toast: addToast,
        });
      }
    }

    set({ room, game, poker });
  },

  setSession: (session) => set({ session }),

  setSeating: (seating, rotation) => set({ seating, rotation }),

  setLobbyRooms: (lobbyRooms) => set({ lobbyRooms }),

  setLobbyChat: (lobbyChat) => set({ lobbyChat }),

  pushLobbyChat: (message) =>
    set((s) => ({ lobbyChat: [...s.lobbyChat.slice(-99), message] })),

  addToast: (kind, text) => {
    const id = toastSeq++;
    set((s) => ({
      // „Du bist dran"-Hinweise nicht stapeln – der neueste ersetzt den alten
      toasts: [...s.toasts.filter((t) => !(kind === 'turn' && t.kind === 'turn')).slice(-4), { id, kind, text }],
    }));
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 6000 : 4000);
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  openDialog: (dialog) => set({ dialog }),

  closeDialog: () => set({ dialog: null }),
}));

// ---------------------------------------------------------------------------
// Abgeleitete Helfer
// ---------------------------------------------------------------------------

/**
 * Der eigene Sitz – spielunabhängig.
 *
 * Vorher las das nur `s.game` und lieferte bei Poker `undefined`; die
 * Poker-Oberfläche suchte sich ihren Spieler deshalb selbst.
 */
export function useSeat(): SeatInfo | undefined {
  return useStore((s) => {
    if (!s.room || !s.session) return undefined;
    const state = s.room[s.room.meta.gameId];
    if (!state) return undefined;
    return moduleFor(s.room.meta.gameId)
      .seats(state)
      .find((p) => p.id === s.session!.playerId);
  });
}

/** Monopoly-Spieler mit allen Feldern (Geld, Position …). */
export function useMe(): Player | undefined {
  return useStore((s) =>
    s.game && s.session ? s.game.players.find((p) => p.id === s.session!.playerId) : undefined
  );
}

/**
 * Drehwinkel für die Spielansicht. Bei „Gerät weiterreichen" immer 0 – dort
 * wandert das Gerät, nicht das Bild.
 */
export function useSeatRotation(): SeatEdge {
  return useStore((s) => s.rotation);
}

export function useIsMyTurn(): boolean {
  return useStore((s) => {
    if (!s.session || !s.room) return false;
    const state = s.room[s.room.meta.gameId];
    if (!state) return false;
    return moduleFor(s.room.meta.gameId).activeSeatId(state) === s.session.playerId;
  });
}

// ---------------------------------------------------------------------------
// LocalStorage
// ---------------------------------------------------------------------------

const SESSION_KEY = 'playhub.session';
const NAME_KEY = 'playhub.name';
const LEGACY_NAME_KEY = 'nomolopy.name';

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (s && s.code && s.playerId && s.token) return s;
  } catch {
    // ignorieren
  }
  return null;
}

export function saveSession(session: Session): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    if (session.name) localStorage.setItem(NAME_KEY, session.name);
  } catch {
    // ignorieren
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // ignorieren
  }
}

export function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? localStorage.getItem(LEGACY_NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // ignorieren
  }
}
