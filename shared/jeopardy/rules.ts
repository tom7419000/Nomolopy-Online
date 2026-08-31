/** Jeopardy-Raumoptionen: Grenzen und Voreinstellungen. */

import type { JeopardyRules } from './types';

export const JEOPARDY_MIN_PLAYERS = 2;
export const JEOPARDY_MAX_PLAYERS = 8;

export const DEFAULT_JEOPARDY_RULES: JeopardyRules = {
  packId: 'standard-de',
  baseValue: 100,
  readSeconds: 5,
  buzzSeconds: 20,
  answerSeconds: 25,
  judgeSeconds: 20,
  penalty: true,
  moderated: false,
};

export const JEOPARDY_LIMITS = {
  baseValue: { min: 50, max: 500, step: 50 },
  readSeconds: { min: 0, max: 20, step: 1 },
  buzzSeconds: { min: 5, max: 60, step: 5 },
  answerSeconds: { min: 10, max: 90, step: 5 },
  judgeSeconds: { min: 5, max: 60, step: 5 },
} as const;

/**
 * Das Gnadenfenster des Buzzer-Rennens.
 *
 * „Erste Nachricht gewinnt" bestraft schlicht das schlechtere WLAN: der
 * Jitter zwischen zwei Handys im Heimnetz ist regelmäßig größer als der
 * Unterschied menschlicher Reaktionszeiten. Der erste eintreffende Buzz
 * eröffnet deshalb ein Fenster; erst danach wird entschieden.
 *
 * Entscheidend ist dann NICHT die Ankunftszeit – die wäre nur eine andere
 * Schreibweise für „erste Nachricht gewinnt" –, sondern die REAKTIONSZEIT,
 * die jedes Gerät für sich misst: von dem Moment, in dem es den offenen
 * Buzzer angezeigt bekam, bis zum Tastendruck. Diese Messung ist rein
 * geräteintern, braucht also keine Uhrensynchronisation, und rechnet die
 * Laufzeit in beide Richtungen heraus.
 */
export const BUZZ_GRACE_MS = 150;

/**
 * Untergrenze für eine gemeldete Reaktionszeit.
 *
 * Die Messung kommt vom Client und ließe sich fälschen. Ein Boden von 120 ms
 * (schneller reagiert kein Mensch auf einen optischen Reiz) nimmt dem die
 * Spitze, und nach oben deckelt der Server ohnehin auf die selbst gemessene
 * Zeitspanne. Gegen jemanden, der seinen Client umbaut, hilft das nicht –
 * das gehört zu einem Partyspiel unter Freunden ehrlich dazu.
 */
export const MIN_REACTION_MS = 120;

export function sanitizeJeopardyRules(input: unknown): JeopardyRules {
  const raw = (input ?? {}) as Partial<Record<keyof JeopardyRules, unknown>>;
  const num = (v: unknown, def: number, min: number, max: number, step: number) => {
    const n = typeof v === 'number' && Number.isFinite(v) ? v : def;
    const clamped = Math.max(min, Math.min(max, n));
    return Math.round(clamped / step) * step;
  };
  const L = JEOPARDY_LIMITS;
  const D = DEFAULT_JEOPARDY_RULES;
  return {
    // Der Inhalt kommt vom Nutzer, die Struktur aus dem Code: ob es das
    // Paket gibt, prüft das Modul beim Anlegen gegen `deps.packs()`.
    packId: typeof raw.packId === 'string' && raw.packId ? raw.packId.slice(0, 60) : D.packId,
    baseValue: num(raw.baseValue, D.baseValue, L.baseValue.min, L.baseValue.max, L.baseValue.step),
    readSeconds: num(raw.readSeconds, D.readSeconds, L.readSeconds.min, L.readSeconds.max, L.readSeconds.step),
    buzzSeconds: num(raw.buzzSeconds, D.buzzSeconds, L.buzzSeconds.min, L.buzzSeconds.max, L.buzzSeconds.step),
    answerSeconds: num(raw.answerSeconds, D.answerSeconds, L.answerSeconds.min, L.answerSeconds.max, L.answerSeconds.step),
    judgeSeconds: num(raw.judgeSeconds, D.judgeSeconds, L.judgeSeconds.min, L.judgeSeconds.max, L.judgeSeconds.step),
    penalty: Boolean(raw.penalty ?? D.penalty),
    moderated: Boolean(raw.moderated ?? D.moderated),
  };
}
