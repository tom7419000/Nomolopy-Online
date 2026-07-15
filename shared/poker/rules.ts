/** Poker-Raumoptionen: Grenzen und Voreinstellungen. */

import type { PokerRules } from './types';

export const POKER_MIN_PLAYERS = 2;
export const POKER_MAX_PLAYERS = 9;

export const DEFAULT_POKER_RULES: PokerRules = {
  buyIn: 2000,
  smallBlind: 10,
  blindIncreaseMinutes: 10,
  actionTimeoutSec: 60,
  allowRebuy: false,
};

export const POKER_LIMITS = {
  buyIn: { min: 1000, max: 10000, step: 500 },
  smallBlind: { min: 5, max: 100, step: 5 },
  blindIncreaseMinutes: { min: 0, max: 60, step: 5 },
  actionTimeoutSec: { min: 30, max: 120, step: 15 },
} as const;

/** Höchste Blind-Stufe (Verdopplung pro Stufe) – verhindert Zahlen-Explosion. */
export const MAX_BLIND_LEVEL = 10;

export function sanitizePokerRules(input: unknown): PokerRules {
  const raw = (input ?? {}) as Partial<Record<keyof PokerRules, unknown>>;
  const num = (v: unknown, def: number, min: number, max: number, step: number) => {
    const n = typeof v === 'number' && Number.isFinite(v) ? v : def;
    const clamped = Math.max(min, Math.min(max, n));
    return Math.round(clamped / step) * step;
  };
  return {
    buyIn: num(raw.buyIn, DEFAULT_POKER_RULES.buyIn, POKER_LIMITS.buyIn.min, POKER_LIMITS.buyIn.max, POKER_LIMITS.buyIn.step),
    smallBlind: num(
      raw.smallBlind,
      DEFAULT_POKER_RULES.smallBlind,
      POKER_LIMITS.smallBlind.min,
      POKER_LIMITS.smallBlind.max,
      POKER_LIMITS.smallBlind.step
    ),
    blindIncreaseMinutes: num(
      raw.blindIncreaseMinutes,
      DEFAULT_POKER_RULES.blindIncreaseMinutes,
      POKER_LIMITS.blindIncreaseMinutes.min,
      POKER_LIMITS.blindIncreaseMinutes.max,
      POKER_LIMITS.blindIncreaseMinutes.step
    ),
    actionTimeoutSec: num(
      raw.actionTimeoutSec,
      DEFAULT_POKER_RULES.actionTimeoutSec,
      POKER_LIMITS.actionTimeoutSec.min,
      POKER_LIMITS.actionTimeoutSec.max,
      POKER_LIMITS.actionTimeoutSec.step
    ),
    allowRebuy: Boolean(raw.allowRebuy ?? DEFAULT_POKER_RULES.allowRebuy),
  };
}
