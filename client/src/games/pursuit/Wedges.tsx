/**
 * Das Käsestück-Rad eines Spielers: sechs Sektoren, gefüllt was er hat.
 *
 * Dieselbe `arcPath`-Geometrie wie das große Rad – nur klein und ohne
 * Wegenetz. Am Tisch ist das die Information, auf die alle schauen.
 */

import { CATEGORY_COLORS, CATEGORY_LABELS, TRIVIA_CATEGORIES, type TriviaCategory } from '@shared/trivia/types';
import { arcPath } from './geometry';

export function Wedges({ have, size = 28 }: { have: TriviaCategory[]; size?: number }) {
  const step = 360 / TRIVIA_CATEGORIES.length;
  return (
    <svg
      className="tp-wedges"
      viewBox="-11 -11 22 22"
      width={size}
      height={size}
      role="img"
      aria-label={
        have.length === 0
          ? 'noch kein Käsestück'
          : `Käsestücke: ${have.map((c) => CATEGORY_LABELS[c]).join(', ')}`
      }
    >
      {TRIVIA_CATEGORIES.map((c, i) => {
        const owned = have.includes(c);
        return (
          <path
            key={c}
            d={arcPath(i * step, (i + 1) * step, 0, 10)}
            fill={owned ? CATEGORY_COLORS[c] : 'transparent'}
            stroke={CATEGORY_COLORS[c]}
            strokeWidth={owned ? 0 : 0.8}
            opacity={owned ? 1 : 0.4}
          />
        );
      })}
    </svg>
  );
}
