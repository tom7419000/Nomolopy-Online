import { create } from 'zustand';
import type { BoardEdition, GameState, Player, RulePreset } from '@shared/types';
import type { LobbyChatMessage, PublicRoomInfo, RoomEnvelope } from '@shared/games';
import type { PokerView } from '@shared/poker/types';

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
  | { type: 'debug' }
  | { type: 'trade'; partnerId?: string }
  | { type: 'saves' }
  | { type: 'property'; tileId: number }
  | null;

interface AppStore {
  connected: boolean;
  editions: BoardEdition[];
  presets: RulePreset[];
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
  setConnected(v: boolean): void;
  setCatalog(editions: BoardEdition[], presets: RulePreset[]): void;
  setRoom(room: RoomEnvelope | null): void;
  setSession(session: Session | null): void;
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
  session: loadSession(),
  room: null,
  game: null,
  poker: null,
  lobbyRooms: [],
  lobbyChat: [],
  toasts: [],
  dialog: null,

  setConnected: (v) => set({ connected: v }),

  setCatalog: (editions, presets) => set({ editions, presets }),

  setRoom: (room) => {
    const { game: prevGame, poker: prevPoker, session, addToast } = get();
    const game = room?.monopoly ?? null;
    const poker = room?.poker ?? null;

    // Monopoly: „Du bist dran"-Hinweis
    if (game && session && game.phase === 'playing') {
      const nowCurrent = game.players[game.currentPlayer];
      const prevCurrent =
        prevGame && prevGame.phase === 'playing' ? prevGame.players[prevGame.currentPlayer] : null;
      const becameMyTurn =
        nowCurrent?.id === session.playerId &&
        (prevCurrent?.id !== session.playerId || prevGame?.phase !== 'playing');
      if (becameMyTurn && game.turnPhase === 'awaiting-roll') {
        // Am gemeinsamen Gerät ist der Name die Information, die zählt –
        // „du" wäre für alle am Tisch mehrdeutig.
        addToast('turn', session.mode === 'local' ? `👉 ${nowCurrent.name} ist dran` : '🎲 Du bist dran!');
      }
      const newTradeForMe =
        game.trade && game.trade.toId === session.playerId && prevGame?.trade?.id !== game.trade.id;
      if (newTradeForMe) {
        const from = game.players.find((p) => p.id === game.trade!.fromId);
        addToast('info', `🤝 ${from?.name ?? 'Jemand'} schlägt dir einen Handel vor.`);
      }
    }

    // Poker: „Du bist dran"-Hinweis
    if (poker && session && poker.phase === 'playing' && poker.toActIndex !== null) {
      const actor = poker.players[poker.toActIndex];
      const prevActor =
        prevPoker && prevPoker.toActIndex !== null ? prevPoker.players[prevPoker.toActIndex] : null;
      if (actor?.id === session.playerId && prevActor?.id !== session.playerId) {
        addToast('turn', session.mode === 'local' ? `👉 ${actor.name} ist dran` : '🃏 Du bist dran!');
      }
    }

    set({ room, game, poker });
  },

  setSession: (session) => set({ session }),

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

export function useMe(): Player | undefined {
  return useStore((s) =>
    s.game && s.session ? s.game.players.find((p) => p.id === s.session!.playerId) : undefined
  );
}

export function useIsMyTurn(): boolean {
  return useStore((s) => {
    if (!s.session) return false;
    if (s.game && s.game.phase === 'playing') {
      return s.game.players[s.game.currentPlayer]?.id === s.session.playerId;
    }
    if (s.poker && s.poker.phase === 'playing' && s.poker.toActIndex !== null) {
      return s.poker.players[s.poker.toActIndex]?.id === s.session.playerId;
    }
    return false;
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
