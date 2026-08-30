/** Trivial-Pursuit-Raumoptionen: Grenzen und Voreinstellungen. */

import type { PursuitRules } from './types';
import type { TriviaLevel } from '../trivia/types';

/** Sechs Käsefarben, sechs Spielfiguren – mehr Sitze ergäben keinen Sinn. */
export const PURSUIT_MIN_PLAYERS = 2;
export const PURSUIT_MAX_PLAYERS = 6;

export const DEFAULT_PURSUIT_RULES: PursuitRules = {
  packId: 'standard-de',
  wedgesToWin: 6,
  freeText: false,
  level: 0,
  answerSeconds: 45,
  judgeSeconds: 20,
  debugMode: false,
};

export const PURSUIT_LIMITS = {
  wedgesToWin: { min: 3, max: 6, step: 1 },
  answerSeconds: { min: 15, max: 120, step: 5 },
  judgeSeconds: { min: 5, max: 60, step: 5 },
} as const;

/** Pause auf der Auflösung, bevor es weitergeht. */
export const REVEAL_PAUSE_MS = 6000;
/** Am gemeinsamen Gerät will die Runde in Ruhe lesen. */
export const LOCAL_REVEAL_PAUSE_MS = 40_000;
/**
 * Wie lange ein GETRENNTER Spieler den Zug blockieren darf, bevor er
 * übersprungen wird. Monopoly bleibt in dem Fall stehen und verlässt sich auf
 * ein Host-Werkzeug – hier wäre das zu wenig, weil jeder Zug eine Frage
 * enthält und die Partie sonst mitten im Rad einfriert.
 */
export const DISCONNECTED_GRACE_MS = 12_000;

export function sanitizePursuitRules(input: unknown): PursuitRules {
  const raw = (input ?? {}) as Partial<Record<keyof PursuitRules, unknown>>;
  const num = (v: unknown, def: number, min: number, max: number, step: number) => {
    const n = typeof v === 'number' && Number.isFinite(v) ? v : def;
    return Math.round(Math.max(min, Math.min(max, n)) / step) * step;
  };
  const L = PURSUIT_LIMITS;
  const D = DEFAULT_PURSUIT_RULES;
  const level = [0, 1, 2, 3, 4, 5].includes(raw.level as number) ? (raw.level as 0 | TriviaLevel) : D.level;
  return {
    // Struktur aus dem Code, Inhalt vom Nutzer: ob es das Paket gibt, prüft
    // das Modul gegen `deps.packs()`.
    packId: typeof raw.packId === 'string' && raw.packId ? raw.packId.slice(0, 60) : D.packId,
    wedgesToWin: num(raw.wedgesToWin, D.wedgesToWin, L.wedgesToWin.min, L.wedgesToWin.max, L.wedgesToWin.step),
    freeText: Boolean(raw.freeText ?? D.freeText),
    level,
    answerSeconds: num(raw.answerSeconds, D.answerSeconds, L.answerSeconds.min, L.answerSeconds.max, L.answerSeconds.step),
    judgeSeconds: num(raw.judgeSeconds, D.judgeSeconds, L.judgeSeconds.min, L.judgeSeconds.max, L.judgeSeconds.step),
    debugMode: Boolean(raw.debugMode ?? D.debugMode),
  };
}
