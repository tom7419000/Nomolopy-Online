/**
 * Das Trivial-Pursuit-Rad als SVG.
 *
 * Erstes SVG im Projekt – und für 42 farbige Kreisringsektoren, sechs
 * Speichen und eine Nabe ist es klar das richtige Werkzeug: eine
 * Koordinatenwelt, exakte Bögen, und über `viewBox` skaliert alles zusammen,
 * ohne dass irgendwo `cqw`-Größen nachgeführt werden müssten.
 *
 * Die Geometrie kommt vollständig aus `shared/pursuit/board.ts` – jeder Knoten
 * bringt Winkel und Radius mit. Es gibt keine zweite, handgepflegte
 * Brettbeschreibung, die auseinanderlaufen könnte.
 *
 * Anklickbar sind nur die erreichbaren Ziele. SVG-Pfade sind allerdings keine
 * Knöpfe: die Ziele stehen deshalb ZUSÄTZLICH als echte `<button>`-Reihe im
 * Aktionspanel. Das ist am Handy ohnehin die bessere Trefferfläche.
 */

import { useMemo } from 'react';
import { HUB, RING_SIZE, WHEEL, type PursuitNode } from '@shared/pursuit/board';
import { CATEGORY_COLORS, CATEGORY_EMOJI, TRIVIA_CATEGORIES } from '@shared/trivia/types';
import type { PursuitPlayer } from '@shared/pursuit/types';
import { tokenOffset } from '../../ui/layout';
import { arcCenter, arcPath, polarXY } from './geometry';

/**
 * Radien im viewBox-Maß. Sie dürfen sich NICHT überlappen: die äußersten
 * Speichenfelder lagen zuerst genau über den Käse-Ecken und haben deren
 * Emoji verdeckt.
 *
 *   0 ──── 22 ─────────── 30 … 62 ──── 70 ──── 78 ──── 100
 *          Nabe            Speichen     Ecke    Ring
 */
const R_RING_OUT = 100;
const R_RING_IN = 78;
/** Käse-Ecken ragen ein Stück nach innen – so erkennt man sie sofort. */
const R_HQ_IN = 70;
const R_HUB = 22;
const R_SPOKE_IN = 30;
const R_SPOKE_OUT = 62;
/** Halbe radiale Dicke eines Speichenfeldes (Abstand der Mitten ist 8). */
const SPOKE_THICK = 3.4;
/** Halbe Winkelbreite eines Speichenfeldes. */
const SPOKE_HALF = 6.4;

const RING_STEP = 360 / RING_SIZE;

/**
 * Anzeigeradius eines Knotens.
 *
 * Die EINE Stelle, an der aus dem Brett-Radius (0…1 aus `board.ts`) ein
 * Bildradius wird – Segmente und Spielfiguren gehen beide hier durch, sonst
 * stünden die Figuren neben ihrem Feld.
 */
function displayRadius(n: PursuitNode): number {
  if (n.kind === 'hub') return 0;
  if (n.ring !== null) return (R_RING_IN + R_RING_OUT) / 2;
  // Speichenknoten liegen bei 5/6 (außen) bis 1/6 (innen).
  const t = (n.radius - 1 / 6) / (4 / 6);
  return R_SPOKE_IN + t * (R_SPOKE_OUT - R_SPOKE_IN);
}

interface Seg {
  node: PursuitNode;
  d: string;
  cx: number;
  cy: number;
}

/** Ein Sektor je Knoten – einmal gerechnet, das Rad ändert sich nie. */
function segments(): Seg[] {
  return WHEEL.filter((n) => n.kind !== 'hub').map((n) => {
    if (n.ring !== null) {
      const a0 = n.angle - RING_STEP / 2;
      const a1 = n.angle + RING_STEP / 2;
      const inner = n.kind === 'hq' ? R_HQ_IN : R_RING_IN;
      return { node: n, d: arcPath(a0, a1, inner, R_RING_OUT), ...xy(arcCenter(a0, a1, inner, R_RING_OUT)) };
    }
    // Speichenfeld: ein kurzes Stück Band unter dem Winkel seiner Ecke.
    const mid = displayRadius(n);
    const a0 = n.angle - SPOKE_HALF;
    const a1 = n.angle + SPOKE_HALF;
    return {
      node: n,
      d: arcPath(a0, a1, mid - SPOKE_THICK, mid + SPOKE_THICK),
      ...xy(arcCenter(a0, a1, mid - SPOKE_THICK, mid + SPOKE_THICK)),
    };
  });
}

function xy([cx, cy]: [number, number]) {
  return { cx, cy };
}

function fillOf(node: PursuitNode): string {
  if (node.kind === 'rollAgain') return 'var(--tp-again)';
  return node.category ? CATEGORY_COLORS[node.category] : 'var(--tp-again)';
}

export function Wheel({
  players,
  targets,
  canPick,
  onPick,
  rotation,
}: {
  players: PursuitPlayer[];
  /**
   * Erreichbare Ziele. Sie werden für ALLE hervorgehoben – am Fernseher soll
   * man sehen, worüber gerade nachgedacht wird. Anklicken darf sie nur, wer
   * am Zug ist.
   */
  targets: number[];
  canPick: boolean;
  onPick(nodeId: number): void;
  /** Drehwinkel bei festen Plätzen. */
  rotation?: number;
}) {
  const segs = useMemo(segments, []);
  // Ziffer je Ziel – dieselbe steht auf dem Knopf in der Zielreihe. Zwei
  // Ziele derselben Farbe wären dort sonst nicht zu unterscheiden.
  const numberOf = new Map(targets.map((id, i) => [id, i + 1]));

  // Figuren nach Feld bündeln, damit mehrere auf einem Feld auffächern.
  const byNode = new Map<number, PursuitPlayer[]>();
  for (const p of players) {
    if (p.resigned) continue;
    if (!byNode.has(p.position)) byNode.set(p.position, []);
    byNode.get(p.position)!.push(p);
  }

  return (
    <svg
      className="tp-wheel"
      viewBox="-108 -108 216 216"
      role="img"
      aria-label="Trivial-Pursuit-Rad"
      style={rotation ? { ['--seat-rotation' as string]: `${rotation}deg` } : undefined}
    >
      {/* Speichenbänder als Untergrund, damit die Felder auf einer Linie liegen */}
      {TRIVIA_CATEGORIES.map((_, s) => {
        const angle = s * (360 / TRIVIA_CATEGORIES.length);
        const [x1, y1] = polarXY(angle, R_HUB);
        const [x2, y2] = polarXY(angle, R_HQ_IN + 2);
        return (
          <line key={s} x1={x1} y1={y1} x2={x2} y2={y2} className="tp-spoke-line" />
        );
      })}

      {segs.map((seg) => {
        const num = numberOf.get(seg.node.id);
        return (
          <g key={seg.node.id}>
            <path
              d={seg.d}
              className={`tp-seg kind-${seg.node.kind} ${num ? 'pickable' : ''}`}
              fill={fillOf(seg.node)}
              onClick={num && canPick ? () => onPick(seg.node.id) : undefined}
            />
            {num ? (
              <text x={seg.cx} y={seg.cy} className="tp-target-num">
                {num}
              </text>
            ) : seg.node.kind === 'hq' ? (
              <text x={seg.cx} y={seg.cy} className="tp-hq-emoji">
                {CATEGORY_EMOJI[seg.node.category!]}
              </text>
            ) : seg.node.kind === 'rollAgain' ? (
              <text x={seg.cx} y={seg.cy} className="tp-again-mark">
                🎲
              </text>
            ) : null}
          </g>
        );
      })}

      {/* Nabe: sechs Sektoren, damit sie aussieht wie das Käsestück, das sie ist */}
      <g
        className={`tp-hub ${numberOf.has(HUB) ? 'pickable' : ''}`}
        onClick={numberOf.has(HUB) && canPick ? () => onPick(HUB) : undefined}
      >
        {TRIVIA_CATEGORIES.map((c, i) => {
          const step = 360 / TRIVIA_CATEGORIES.length;
          return (
            <path
              key={c}
              d={arcPath(i * step, (i + 1) * step, 0, R_HUB)}
              fill={CATEGORY_COLORS[c]}
              opacity={0.85}
            />
          );
        })}
        <circle r={R_HUB} className="tp-hub-ring" />
        {numberOf.has(HUB) && (
          <text x={0} y={0} className="tp-target-num">
            {numberOf.get(HUB)}
          </text>
        )}
      </g>

      {/* Spielfiguren */}
      {[...byNode.entries()].map(([nodeId, here]) => {
        const n = WHEEL[nodeId];
        const [bx, by] = polarXY(n.angle, displayRadius(n));
        return here.map((p, i) => {
          const o = tokenOffset(i, here.length);
          return (
            <circle
              key={p.id}
              className="tp-token"
              cx={bx + o.dx * 1.6}
              cy={by + o.dy * 1.6}
              r={5.5}
              fill={p.color}
            >
              <title>{p.name}</title>
            </circle>
          );
        });
      })}
    </svg>
  );
}
