/**
 * Ein Stück Kreisgeometrie – und die einzige, die dieses Projekt braucht.
 *
 * `arcPath` zeichnet einen Kreisringsektor. Damit entstehen die 42
 * Ringsegmente, die 30 Speichenfelder, die sechs Nabensektoren UND die kleinen
 * Käse-Torten in der Spielerliste: ein Helfer, vier Verwendungen.
 *
 * Koordinatensystem wie in `shared/pursuit/board.ts`: 0° zeigt nach oben,
 * gedreht wird im Uhrzeigersinn.
 */

export function polarXY(angleDeg: number, radius: number): [number, number] {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return [Math.cos(rad) * radius, Math.sin(rad) * radius];
}

/**
 * Kreisringsektor von `a0` bis `a1` zwischen den Radien `rInner` und `rOuter`.
 * Bei `rInner === 0` entsteht ein Tortenstück statt eines Rings.
 */
export function arcPath(a0: number, a1: number, rInner: number, rOuter: number): string {
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  const [ox0, oy0] = polarXY(a0, rOuter);
  const [ox1, oy1] = polarXY(a1, rOuter);

  if (rInner <= 0) {
    return `M 0 0 L ${ox0} ${oy0} A ${rOuter} ${rOuter} 0 ${large} 1 ${ox1} ${oy1} Z`;
  }
  const [ix1, iy1] = polarXY(a1, rInner);
  const [ix0, iy0] = polarXY(a0, rInner);
  return [
    `M ${ox0} ${oy0}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${ox1} ${oy1}`,
    `L ${ix1} ${iy1}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${ix0} ${iy0}`,
    'Z',
  ].join(' ');
}

/** Mittelpunkt eines Sektors – für Emoji und Spielfiguren. */
export function arcCenter(a0: number, a1: number, rInner: number, rOuter: number): [number, number] {
  return polarXY((a0 + a1) / 2, (rInner + rOuter) / 2);
}
