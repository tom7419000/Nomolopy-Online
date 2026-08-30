/**
 * Das Trivial-Pursuit-Rad als Wegenetz.
 *
 * Das Brett ist ein GRAPH, kein Ring – daran hängt der ganze Aufwand dieses
 * Spiels. Und es wird ERZEUGT, nicht von Hand geschrieben: 73 Knoten mit
 * Nachbarschaften und Darstellungskoordinaten fallen aus rund achtzig Zeilen,
 * und niemand muss je eine Feldliste pflegen.
 *
 * Weil `buildWheel()` deterministisch ist und in `shared/` liegt, baut der
 * Client dasselbe Brett selbst. Es wandert deshalb NICHT über die Leitung –
 * im Spielzustand stehen nur Positions-Indizes. (Monopoly bettet seine Edition
 * ein, weil Spielstände autark sein müssen; hier gibt es keine.)
 *
 * Diese Datei ist frei von DOM- und Node-APIs.
 */

import { TRIVIA_CATEGORIES, type TriviaCategory } from '../trivia/types';

export type PursuitNodeKind = 'category' | 'hq' | 'rollAgain' | 'hub';

export interface PursuitNode {
  id: number;
  kind: PursuitNodeKind;
  /** Nur bei 'category' und 'hq' gesetzt. */
  category: TriviaCategory | null;
  /** Nachbarn. Mehr als zwei heißt: hier gibt es eine Abzweigung. */
  next: number[];
  /** Darstellung: Grad im Uhrzeigersinn, 0 = rechts. */
  angle: number;
  /** Darstellung: 0 (Nabe) bis 1 (äußerer Ring). */
  radius: number;
  /** Ringposition 0–41, sonst null – für die Bogensegmente im SVG. */
  ring: number | null;
}

/** Felder im äußeren Ring. */
export const RING_SIZE = 42;
/** Felder je Speiche, zwischen Käse-Ecke und Nabe. */
export const SPOKE_LEN = 5;
/** Abstand zweier Käse-Ecken im Ring: 42 / 6 = 7. */
export const HQ_SPACING = RING_SIZE / TRIVIA_CATEGORIES.length;
export const HUB = RING_SIZE + TRIVIA_CATEGORIES.length * SPOKE_LEN;
export const NODE_COUNT = HUB + 1;

/** ID des j-ten Speichenknotens (j = 0 außen) der Speiche s. */
export function spokeNode(s: number, j: number): number {
  return RING_SIZE + s * SPOKE_LEN + j;
}

/** Ringposition der Käse-Ecke der Speiche s. */
export function hqNode(s: number): number {
  return s * HQ_SPACING;
}

function link(nodes: PursuitNode[], a: number, b: number): void {
  if (!nodes[a].next.includes(b)) nodes[a].next.push(b);
  if (!nodes[b].next.includes(a)) nodes[b].next.push(a);
}

/**
 * Baut das Rad: 42 Ringfelder, sechs Speichen zu je fünf Feldern, eine Nabe.
 *
 * Die Farbverteilung im Ring geht rechnerisch auf: 42 = 6 · 7, jede Farbe
 * käme also siebenmal vor – abzüglich je einer Käse-Ecke und eines
 * „Nochmal würfeln" liegt jede Farbe genau fünfmal. Das ist kein Zufall,
 * sondern der Grund für die 42.
 */
export function buildWheel(): PursuitNode[] {
  const cats = TRIVIA_CATEGORIES;
  const nodes: PursuitNode[] = [];

  // -- Äußerer Ring --------------------------------------------------------
  for (let i = 0; i < RING_SIZE; i++) {
    const isHq = i % HQ_SPACING === 0;
    // Die Mitte zwischen zwei Käse-Ecken ist ein Freiwurf.
    const isRollAgain = i % HQ_SPACING === 3;
    nodes.push({
      id: i,
      kind: isHq ? 'hq' : isRollAgain ? 'rollAgain' : 'category',
      category: isHq ? cats[i / HQ_SPACING] : isRollAgain ? null : cats[i % cats.length],
      next: [],
      angle: (i * 360) / RING_SIZE,
      radius: 1,
      ring: i,
    });
  }

  // -- Speichen ------------------------------------------------------------
  for (let s = 0; s < cats.length; s++) {
    for (let j = 0; j < SPOKE_LEN; j++) {
      const middle = j === 2;
      nodes.push({
        id: spokeNode(s, j),
        kind: middle ? 'rollAgain' : 'category',
        // Das +1 verhindert, dass eine Speiche mit der Farbe ihrer eigenen
        // Käse-Ecke beginnt – sonst sähe das Rad an sechs Stellen doppelt aus.
        category: middle ? null : cats[(s + j + 1) % cats.length],
        next: [],
        angle: (hqNode(s) * 360) / RING_SIZE,
        radius: 1 - (j + 1) / (SPOKE_LEN + 1),
        ring: null,
      });
    }
  }

  // -- Nabe ----------------------------------------------------------------
  nodes.push({ id: HUB, kind: 'hub', category: null, next: [], angle: 0, radius: 0, ring: null });

  // -- Kanten --------------------------------------------------------------
  for (let i = 0; i < RING_SIZE; i++) link(nodes, i, (i + 1) % RING_SIZE);
  for (let s = 0; s < cats.length; s++) {
    link(nodes, hqNode(s), spokeNode(s, 0));
    for (let j = 0; j < SPOKE_LEN - 1; j++) link(nodes, spokeNode(s, j), spokeNode(s, j + 1));
    link(nodes, spokeNode(s, SPOKE_LEN - 1), HUB);
  }

  return nodes;
}

/**
 * Das Rad ist für jede Partie identisch – also wird es einmal gebaut.
 * Eingefroren, damit niemand versehentlich hineinschreibt.
 */
export const WHEEL: readonly PursuitNode[] = Object.freeze(
  buildWheel().map((n) => Object.freeze({ ...n, next: Object.freeze(n.next) as unknown as number[] }))
);

export function nodeAt(id: number): PursuitNode | undefined {
  return WHEEL[id];
}

/**
 * Alle Felder, die in GENAU `steps` Schritten erreichbar sind.
 *
 * Die einzige Bewegungsregel, die dafür nötig ist, ist die Sperre gegen die
 * sofortige Kehrtwende (`nx !== prev`) – man darf mitten im Zug nicht
 * umdrehen, an einer Abzweigung aber frei wählen.
 *
 * Zwei Spielregeln fallen daraus von selbst heraus, und genau deshalb ist das
 * die richtige Bauform:
 *
 * - **Die Nabe muss exakt getroffen werden.** Sie ist in der Ergebnismenge
 *   oder eben nicht; es braucht keinen Sonderfall.
 * - **Durch die Nabe hindurch in eine andere Speiche** ist erlaubt, weil die
 *   Nabe ein ganz normaler Knoten mit sechs Nachbarn ist. Das ist eine
 *   bewusste Lesart der Regel und macht das Rad als Abkürzung interessant.
 *
 * Kein Knoten hat Grad 1, deshalb ist das Ergebnis nie leer: festsitzen kann
 * niemand.
 */
export function reachable(from: number, steps: number): number[] {
  const out = new Set<number>();
  const walk = (at: number, prev: number, left: number): void => {
    if (left === 0) {
      out.add(at);
      return;
    }
    for (const nx of WHEEL[at].next) {
      if (nx !== prev) walk(nx, at, left - 1);
    }
  };
  if (steps > 0 && WHEEL[from]) walk(from, -1, steps);
  return [...out].sort((a, b) => a - b);
}

/**
 * Ein Weg von `from` nach `to` in genau `steps` Schritten, oder null.
 *
 * Nur für die Anzeige gedacht (Zugvorschau, Figurenbewegung): welchen der
 * möglichen Wege man nimmt, ist für die Regeln bedeutungslos – am Ende zählt
 * nur, wo man steht.
 */
export function pathTo(from: number, steps: number, to: number): number[] | null {
  const walk = (at: number, prev: number, left: number, acc: number[]): number[] | null => {
    if (left === 0) return at === to ? acc : null;
    for (const nx of WHEEL[at].next) {
      if (nx === prev) continue;
      const found = walk(nx, at, left - 1, [...acc, nx]);
      if (found) return found;
    }
    return null;
  };
  return walk(from, -1, steps, [from]);
}

// ---------------------------------------------------------------------------
// Geometrie für die Darstellung
// ---------------------------------------------------------------------------

/** Polarkoordinate → kartesisch. 0° zeigt nach rechts, gedreht im Uhrzeigersinn. */
export function polar(angleDeg: number, radius: number): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: Math.cos(rad) * radius, y: Math.sin(rad) * radius };
}
