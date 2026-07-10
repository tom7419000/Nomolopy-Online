/**
 * Geometrie des 11×11-Bretts: Feld 0 (Los) liegt unten rechts,
 * die Laufrichtung ist gegen den Uhrzeigersinn (unten: rechts → links).
 */

export type Side = 'bottom' | 'left' | 'top' | 'right' | 'corner';

export interface GridPos {
  row: number; // 1-basiert
  col: number;
}

export function tileGridPos(i: number): GridPos {
  if (i === 0) return { row: 11, col: 11 };
  if (i < 10) return { row: 11, col: 11 - i };
  if (i === 10) return { row: 11, col: 1 };
  if (i < 20) return { row: 11 - (i - 10), col: 1 };
  if (i === 20) return { row: 1, col: 1 };
  if (i < 30) return { row: 1, col: i - 20 + 1 };
  if (i === 30) return { row: 1, col: 11 };
  return { row: i - 30 + 1, col: 11 };
}

export function tileSide(i: number): Side {
  if (i % 10 === 0) return 'corner';
  if (i < 10) return 'bottom';
  if (i < 20) return 'left';
  if (i < 30) return 'top';
  return 'right';
}

/** Eckfelder sind CORNER-fr breit, Randfelder 1fr (muss zum CSS-Grid passen). */
const CORNER = 1.45;
const UNITS = 2 * CORNER + 9;

function axisCenterPct(k: number): number {
  // k: 0..10 (Zellenindex entlang einer Achse)
  let units: number;
  if (k === 0) units = CORNER / 2;
  else if (k === 10) units = CORNER + 9 + CORNER / 2;
  else units = CORNER + (k - 1) + 0.5;
  return (units / UNITS) * 100;
}

/** Mittelpunkt eines Feldes in Prozent der Brettgröße (für die Token-Ebene). */
export function tileCenterPct(i: number): { x: number; y: number } {
  const { row, col } = tileGridPos(i);
  return { x: axisCenterPct(col - 1), y: axisCenterPct(row - 1) };
}

/** Versatz, damit mehrere Figuren auf einem Feld nebeneinander stehen. */
export function tokenOffset(indexOnTile: number, countOnTile: number): { dx: number; dy: number } {
  if (countOnTile <= 1) return { dx: 0, dy: 0 };
  const cols = countOnTile <= 4 ? 2 : 3;
  const col = indexOnTile % cols;
  const row = Math.floor(indexOnTile / cols);
  const spread = 2.2; // Prozent der Brettgröße
  return {
    dx: (col - (cols - 1) / 2) * spread,
    dy: (row - (Math.ceil(countOnTile / cols) - 1) / 2) * spread,
  };
}

export const CORNER_FR = CORNER;
