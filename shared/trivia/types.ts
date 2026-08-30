/**
 * Gemeinsames Fragenformat für Jeopardy und Trivial Pursuit.
 *
 * Ein Format, ein Editor, ein Inhaltsbestand – zwei Spiele. Die sechs
 * Kategorien sind die klassischen Trivial-Pursuit-Farben, und beide Spiele
 * sind ohnehin auf sechs festgelegt: Jeopardy hat sechs Spalten, Trivial
 * Pursuit sechs Käsestücke. Fest verdrahtete Sechs heißt, dass Jeopardys
 * Brett buchstäblich `Kategorie × Stufe` ist und TPs Käseset buchstäblich
 * die Kategorienliste – keine Zuordnungstabelle pro Paket, keine
 * spielspezifische Abdeckungsprüfung.
 */

import { normalize } from './text';

export type TriviaCategory =
  | 'geografie'
  | 'unterhaltung'
  | 'geschichte'
  | 'kunst'
  | 'wissenschaft'
  | 'sport';

export const TRIVIA_CATEGORIES: TriviaCategory[] = [
  'geografie',
  'unterhaltung',
  'geschichte',
  'kunst',
  'wissenschaft',
  'sport',
];

export type TriviaLevel = 1 | 2 | 3 | 4 | 5;
export const TRIVIA_LEVELS: TriviaLevel[] = [1, 2, 3, 4, 5];

export const CATEGORY_LABELS: Record<TriviaCategory, string> = {
  geografie: 'Geografie',
  unterhaltung: 'Unterhaltung',
  geschichte: 'Geschichte',
  kunst: 'Kunst & Literatur',
  wissenschaft: 'Wissenschaft & Natur',
  sport: 'Sport & Freizeit',
};

/** Die klassischen Käse-Farben. */
export const CATEGORY_COLORS: Record<TriviaCategory, string> = {
  geografie: '#2b7fd4',
  unterhaltung: '#e05fa8',
  geschichte: '#e8c33a',
  kunst: '#a05ad6',
  wissenschaft: '#3aa960',
  sport: '#e2762e',
};

export const CATEGORY_EMOJI: Record<TriviaCategory, string> = {
  geografie: '🌍',
  unterhaltung: '🎬',
  geschichte: '🏛',
  kunst: '🎨',
  wissenschaft: '🔬',
  sport: '⚽',
};

export interface TriviaQuestion {
  id: string;
  category: TriviaCategory;
  /** 1 = leicht … 5 = schwer. Jeopardy: die Brettzeile. TP: Schwierigkeit. */
  level: TriviaLevel;
  prompt: string;
  answer: string;
  /**
   * Weitere gültige Schreibweisen. Speist die automatische Vorprüfung bei
   * Jeopardy – je besser gepflegt, desto seltener müssen die Mitspieler
   * überhaupt werten.
   */
  accept?: string[];
}

export interface TriviaPack {
  id: string;
  name: string;
  description: string;
  builtIn: boolean;
  language: string;
  questions: TriviaQuestion[];
}

// ---------------------------------------------------------------------------
// Grenzen und Validierung
// ---------------------------------------------------------------------------

export const MAX_PROMPT_LEN = 300;
export const MAX_ANSWER_LEN = 120;
export const MAX_PACK_NAME = 60;
export const MAX_PACK_DESC = 200;
export const MAX_QUESTIONS_PER_PACK = 5000;

/**
 * Untergrenze je Fach (Kategorie × Stufe).
 *
 * Trivial Pursuit erzeugt seine drei falschen Antwortmöglichkeiten aus den
 * Antworten anderer Fragen desselben Fachs – dafür braucht es neben der
 * richtigen noch drei weitere, also vier insgesamt.
 *
 * Gezählt werden dabei VERSCHIEDENE Antworten, nicht Fragen: zwei Fragen mit
 * derselben Lösung liefern nur einen Ablenker. Verglichen wird über
 * `normalize`, damit „Die Elbe" und „Elbe" nicht als zwei durchgehen – genau
 * so bildet `distractors` sie schließlich auch.
 */
export const MIN_PER_BUCKET = 4;

export interface PackIssue {
  category: TriviaCategory;
  level: TriviaLevel;
  /** Fragen im Fach. */
  count: number;
  /** Davon verschiedene Antworten – das ist die Zahl, die zählt. */
  distinct: number;
}

export interface PackReport {
  ok: boolean;
  /** Fächer mit zu wenigen verschiedenen Antworten (leer, wenn alles passt). */
  thin: PackIssue[];
  /** Fragen je Fach – speist das Abdeckungsraster im Editor. */
  counts: Record<string, number>;
  /** Verschiedene Antworten je Fach. */
  distinct: Record<string, number>;
  total: number;
}

export function bucketKey(category: TriviaCategory, level: TriviaLevel): string {
  return `${category}:${level}`;
}

/**
 * Prüft, ob ein Paket bespielbar ist: jedes der 30 Fächer braucht genug
 * Fragen, sonst lassen sich weder ein volles Jeopardy-Brett füllen noch
 * Ablenker bilden.
 */
export function checkPack(pack: TriviaPack): PackReport {
  const counts: Record<string, number> = {};
  const answers: Record<string, Set<string>> = {};
  for (const c of TRIVIA_CATEGORIES) {
    for (const l of TRIVIA_LEVELS) {
      counts[bucketKey(c, l)] = 0;
      answers[bucketKey(c, l)] = new Set();
    }
  }
  for (const q of pack.questions) {
    const key = bucketKey(q.category, q.level);
    if (!(key in counts)) continue;
    counts[key] += 1;
    answers[key].add(normalize(q.answer));
  }

  const distinct: Record<string, number> = {};
  const thin: PackIssue[] = [];
  for (const c of TRIVIA_CATEGORIES) {
    for (const l of TRIVIA_LEVELS) {
      const key = bucketKey(c, l);
      distinct[key] = answers[key].size;
      if (distinct[key] < MIN_PER_BUCKET) {
        thin.push({ category: c, level: l, count: counts[key], distinct: distinct[key] });
      }
    }
  }

  return { ok: thin.length === 0, thin, counts, distinct, total: pack.questions.length };
}

export function isTriviaCategory(v: unknown): v is TriviaCategory {
  return typeof v === 'string' && (TRIVIA_CATEGORIES as string[]).includes(v);
}

export function isTriviaLevel(v: unknown): v is TriviaLevel {
  return v === 1 || v === 2 || v === 3 || v === 4 || v === 5;
}
