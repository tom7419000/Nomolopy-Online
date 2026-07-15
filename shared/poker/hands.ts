/**
 * Poker-Hand-Bewertung: beste 5-Karten-Kombination aus 5–7 Karten.
 *
 * Karten sind Zahlen 0..51: rank = card % 13 (0 = „2" … 12 = Ass),
 * suit = floor(card / 13) (0 = ♠, 1 = ♥, 2 = ♦, 3 = ♣).
 *
 * Der Score ist eine einzelne Zahl: höhere Zahl = bessere Hand. Kategorie und
 * bis zu fünf Tiebreaker-Ränge werden Basis-15-kodiert, damit exakt die
 * offiziellen Kicker-Regeln greifen.
 */

export const RANKS = 13;
export const SUITS = 4;

export function cardRank(card: number): number {
  return card % 13;
}

export function cardSuit(card: number): number {
  return Math.floor(card / 13);
}

export function makeCard(rank: number, suit: number): number {
  return suit * 13 + rank;
}

export const RANK_LABELS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'B', 'D', 'K', 'A'];
export const SUIT_LABELS = ['♠', '♥', '♦', '♣'];

export type HandCategory =
  | 0 // Höchste Karte
  | 1 // Ein Paar
  | 2 // Zwei Paare
  | 3 // Drilling
  | 4 // Straße
  | 5 // Flush
  | 6 // Full House
  | 7 // Vierling
  | 8; // Straight Flush / Royal Flush

export interface HandValue {
  score: number;
  category: HandCategory;
  /** Tiebreaker-Ränge in Bewertungsreihenfolge (z. B. [Paar, Kicker1, Kicker2, Kicker3]) */
  ranks: number[];
  /** Die 5 Karten der besten Hand (für Hervorhebung im UI) */
  cards: number[];
}

function encode(category: number, ranks: number[]): number {
  let score = category;
  for (let i = 0; i < 5; i++) {
    score = score * 15 + (ranks[i] ?? 0);
  }
  return score;
}

/** Bewertet exakt 5 Karten. */
export function evaluate5(cards: number[]): HandValue {
  const ranks = cards.map(cardRank).sort((a, b) => b - a);
  const suits = cards.map(cardSuit);
  const isFlush = suits.every((s) => s === suits[0]);

  // Vorkommen pro Rang
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  // Gruppen nach (Anzahl, Rang) absteigend sortiert
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);

  // Straße erkennen (nur wenn alle 5 Ränge verschieden)
  let straightHigh = -1;
  if (groups.length === 5) {
    if (ranks[0] - ranks[4] === 4) {
      straightHigh = ranks[0];
    } else if (ranks[0] === 12 && ranks[1] === 3 && ranks[1] - ranks[4] === 3) {
      // A-2-3-4-5 („Wheel"): Ass zählt niedrig, höchste Karte ist die 5 (Rang 3)
      straightHigh = 3;
    }
  }

  let category: HandCategory;
  let tiebreak: number[];

  if (isFlush && straightHigh >= 0) {
    category = 8;
    tiebreak = [straightHigh];
  } else if (groups[0][1] === 4) {
    category = 7;
    tiebreak = [groups[0][0], groups[1][0]];
  } else if (groups[0][1] === 3 && groups[1][1] === 2) {
    category = 6;
    tiebreak = [groups[0][0], groups[1][0]];
  } else if (isFlush) {
    category = 5;
    tiebreak = ranks;
  } else if (straightHigh >= 0) {
    category = 4;
    tiebreak = [straightHigh];
  } else if (groups[0][1] === 3) {
    category = 3;
    tiebreak = [groups[0][0], groups[1][0], groups[2][0]];
  } else if (groups[0][1] === 2 && groups[1][1] === 2) {
    category = 2;
    tiebreak = [groups[0][0], groups[1][0], groups[2][0]];
  } else if (groups[0][1] === 2) {
    category = 1;
    tiebreak = [groups[0][0], groups[1][0], groups[2][0], groups[3][0]];
  } else {
    category = 0;
    tiebreak = ranks;
  }

  return { score: encode(category, tiebreak), category, ranks: tiebreak, cards: [...cards] };
}

/** Beste 5-Karten-Hand aus 5–7 Karten (alle C(n,5)-Kombinationen). */
export function bestHand(cards: number[]): HandValue {
  if (cards.length < 5) throw new Error('bestHand braucht mindestens 5 Karten');
  if (cards.length === 5) return evaluate5(cards);
  let best: HandValue | null = null;
  const n = cards.length;
  const combo: number[] = [];
  const pick = (start: number) => {
    if (combo.length === 5) {
      const v = evaluate5(combo.map((i) => cards[i]));
      if (!best || v.score > best.score) best = v;
      return;
    }
    for (let i = start; i <= n - (5 - combo.length); i++) {
      combo.push(i);
      pick(i + 1);
      combo.pop();
    }
  };
  pick(0);
  return best!;
}

/** Deutscher Anzeigename, z. B. „Zwei Paare (K und 8)". */
export function handName(value: HandValue): string {
  const L = (r: number) => RANK_LABELS[r];
  const [a, b] = value.ranks;
  switch (value.category) {
    case 8:
      return a === 12 ? 'Royal Flush' : `Straight Flush (bis ${L(a)})`;
    case 7:
      return `Vierling (${L(a)})`;
    case 6:
      return `Full House (${L(a)} über ${L(b)})`;
    case 5:
      return `Flush (${L(a)} hoch)`;
    case 4:
      return `Straße (bis ${L(a)})`;
    case 3:
      return `Drilling (${L(a)})`;
    case 2:
      return `Zwei Paare (${L(a)} und ${L(b)})`;
    case 1:
      return `Ein Paar (${L(a)})`;
    default:
      return `Höchste Karte ${L(a)}`;
  }
}

/** Kartenlabel fürs Log, z. B. „A♠". */
export function cardLabel(card: number): string {
  return `${RANK_LABELS[cardRank(card)]}${SUIT_LABELS[cardSuit(card)]}`;
}
