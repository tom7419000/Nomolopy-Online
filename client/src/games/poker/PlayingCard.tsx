/**
 * Spielkarte: rendert eine Karte (0..51) oder eine Rückseite (HIDDEN_CARD).
 */

import { cardRank, cardSuit, RANK_LABELS, SUIT_LABELS } from '@shared/poker/hands';

export function PlayingCard({
  card,
  size = 'md',
  highlight = false,
  dimmed = false,
}: {
  card: number;
  size?: 'sm' | 'md' | 'lg';
  highlight?: boolean;
  dimmed?: boolean;
}) {
  if (card < 0) {
    return <span className={`pcard back ${size}`} aria-label="Verdeckte Karte" />;
  }
  const rank = RANK_LABELS[cardRank(card)];
  const suit = SUIT_LABELS[cardSuit(card)];
  const red = cardSuit(card) === 1 || cardSuit(card) === 2;
  return (
    <span
      className={`pcard ${size} ${red ? 'red' : 'black'} ${highlight ? 'best' : ''} ${dimmed ? 'dimmed' : ''}`}
      aria-label={`${rank}${suit}`}
    >
      <span className="pcard-corner">
        {rank}
        <em>{suit}</em>
      </span>
      <span className="pcard-suit" aria-hidden>
        {suit}
      </span>
    </span>
  );
}
