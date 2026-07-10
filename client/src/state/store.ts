import { create } from 'zustand';
import type { BoardEdition, GameState, Player, RulePreset } from '@shared/types';

export interface Session {
  code: string;
  playerId: string;
  token: string;
  name: string;
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
  game: GameState | null;
  toasts: Toast[];
  dialog: Dialog;
  setConnected(v: boolean): void;
  setCatalog(editions: BoardEdition[], presets: RulePreset[]): void;
  setGame(game: GameState | null): void;
  setSession(session: Session | null): void;
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
  game: null,
  toasts: [],
  dialog: null,

  setConnected: (v) => set({ connected: v }),

  setCatalog: (editions, presets) => set({ editions, presets }),

  setGame: (game) => {
    const { game: prev, session, addToast } = get();
    if (game && session && game.phase === 'playing') {
      const nowCurrent = game.players[game.currentPlayer];
      const prevCurrent =
        prev && prev.phase === 'playing' ? prev.players[prev.currentPlayer] : null;
      const becameMyTurn =
        nowCurrent?.id === session.playerId &&
        (prevCurrent?.id !== session.playerId || prev?.phase !== 'playing');
      if (becameMyTurn && game.turnPhase === 'awaiting-roll') {
        addToast('turn', '🎲 Du bist dran!');
      }
      const newTradeForMe =
        game.trade &&
        game.trade.toId === session.playerId &&
        prev?.trade?.id !== game.trade.id;
      if (newTradeForMe) {
        const from = game.players.find((p) => p.id === game.trade!.fromId);
        addToast('info', `🤝 ${from?.name ?? 'Jemand'} schlägt dir einen Handel vor.`);
      }
    }
    set({ game });
  },

  setSession: (session) => set({ session }),

  addToast: (kind, text) => {
    const id = toastSeq++;
    set((s) => ({ toasts: [...s.toasts.slice(-4), { id, kind, text }] }));
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
    if (!s.game || !s.session || s.game.phase !== 'playing') return false;
    return s.game.players[s.game.currentPlayer]?.id === s.session.playerId;
  });
}

// ---------------------------------------------------------------------------
// LocalStorage
// ---------------------------------------------------------------------------

const SESSION_KEY = 'nomolopy.session';
const NAME_KEY = 'nomolopy.name';

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
    return localStorage.getItem(NAME_KEY) ?? '';
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
