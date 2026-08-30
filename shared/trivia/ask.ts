/**
 * Fragen ziehen, Antworten prüfen, Ablenker bilden.
 *
 * Alles, was Jeopardy und Trivial Pursuit gemeinsam brauchen – bewusst
 * hier und nicht doppelt in beiden Engines.
 */

import { editDistance, normalize } from './text';
import {
  bucketKey,
  type TriviaCategory,
  type TriviaLevel,
  type TriviaPack,
  type TriviaQuestion,
} from './types';

// ---------------------------------------------------------------------------
// Wertung
// ---------------------------------------------------------------------------

/**
 * Vorschlag für die Wertung einer freien Antwort.
 *
 * Bewusst nur ein VORSCHLAG: Bei Jeopardy wird er den Mitspielern
 * vorausgewählt gezeigt, das letzte Wort haben sie. Damit werden die
 * allermeisten Wertungen ein bestätigender Tipp – ohne dass eine knapp
 * danebenliegende Antwort automatisch durchfällt.
 */
export function autoVerdict(q: TriviaQuestion, submitted: string): boolean {
  const given = normalize(submitted);
  if (!given) return false;

  const valid = [q.answer, ...(q.accept ?? [])].map(normalize).filter(Boolean);
  for (const want of valid) {
    if (given === want) return true;
    // Tippfehlertoleranz, aber nur bei Antworten, die lang genug sind –
    // bei „Rom" wäre Abstand 2 schon fast beliebig.
    if (want.length >= 6 && editDistance(given, want, 2) <= 2) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Fragen ziehen
// ---------------------------------------------------------------------------

function bucketOf(pack: TriviaPack, category: TriviaCategory, level: TriviaLevel): TriviaQuestion[] {
  return pack.questions.filter((q) => q.category === category && q.level === level);
}

/** Zufällige Auswahl ohne Seiteneffekt auf die Eingabe. */
function pick<T>(arr: T[], rnd: () => number): T | undefined {
  if (arr.length === 0) return undefined;
  return arr[Math.floor(rnd() * arr.length)];
}

/**
 * Zieht eine noch nicht gespielte Frage aus einem Fach.
 *
 * Ist das Fach erschöpft, wird `null` geliefert – die Engines entscheiden
 * dann selbst, ob sie die verbrauchten Fragen wieder freigeben.
 */
export function drawQuestion(
  pack: TriviaPack,
  category: TriviaCategory,
  level: TriviaLevel,
  usedIds: string[] = [],
  rnd: () => number = Math.random
): TriviaQuestion | null {
  const used = new Set(usedIds);
  const free = bucketOf(pack, category, level).filter((q) => !used.has(q.id));
  return pick(free, rnd) ?? null;
}

/**
 * Falsche Antwortmöglichkeiten für Multiple Choice.
 *
 * Gezogen wird aus dem GESAMTEN Fach – auch aus schon gespielten Fragen.
 * Deren Antwort ist als Ablenker weiterhin brauchbar, und zöge man nur aus
 * den ungenutzten, gingen die Ablenker gegen Ende einer Partie aus.
 *
 * Verglichen wird über `normalize`, damit nicht „Die Elbe" neben „Elbe"
 * zur Auswahl steht.
 */
export function distractors(
  pack: TriviaPack,
  q: TriviaQuestion,
  n = 3,
  rnd: () => number = Math.random
): string[] {
  const taken = new Set([normalize(q.answer)]);
  const pool = bucketOf(pack, q.category, q.level)
    .filter((other) => other.id !== q.id)
    .map((other) => other.answer);

  const out: string[] = [];
  // Fisher-Yates auf einer Kopie, damit die Reihenfolge zufällig ist.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  for (const candidate of pool) {
    const key = normalize(candidate);
    if (taken.has(key)) continue;
    taken.add(key);
    out.push(candidate);
    if (out.length >= n) break;
  }
  return out;
}

/**
 * Fertige Auswahlmöglichkeiten in zufälliger Reihenfolge, richtige Antwort
 * enthalten. Weniger als `n + 1` Einträge heißt: das Fach ist zu dünn –
 * `checkPack` verhindert das eigentlich schon beim Speichern.
 */
export function multipleChoice(
  pack: TriviaPack,
  q: TriviaQuestion,
  rnd: () => number = Math.random
): string[] {
  const options = [q.answer, ...distractors(pack, q, 3, rnd)];
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return options;
}

/** Zählt Stimmen aus; Gleichstand geht zugunsten des Spielers. */
export function tallyVotes(votes: Record<string, boolean>, fallback: boolean): boolean {
  const values = Object.values(votes);
  if (values.length === 0) return fallback;
  const yes = values.filter(Boolean).length;
  return yes * 2 >= values.length;
}

// Weiterhin von hier importierbar – der Umzug nach `text.ts` war rein
// technisch (Importzyklus), nicht inhaltlich.
export { bucketKey, editDistance, normalize };
