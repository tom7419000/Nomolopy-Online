/**
 * Das Jeopardy-Brett und die Punktetafel – die Ansicht für den großen
 * Bildschirm.
 *
 * Sechs Spalten, fünf Zeilen, mehr nicht. Genau dieselbe Form hat das
 * Abdeckungsraster im Paket-Editor: das Fragenformat ist auf sechs
 * Kategorien und fünf Stufen festgelegt, also IST das Brett das Raster.
 */

import { CATEGORY_EMOJI, CATEGORY_LABELS } from '@shared/trivia/types';
import type { JeopardyView } from '@shared/jeopardy/types';

export function ScoreBoard({
  view,
  meId,
  buzzedIds,
  answererId,
}: {
  view: JeopardyView;
  meId?: string;
  /** Wer bei der laufenden Frage schon gedrückt hat. */
  buzzedIds?: string[];
  answererId?: string | null;
}) {
  const picker = view.players[view.pickerIndex]?.id;
  return (
    <ul className="jeo-scores">
      {view.players.map((p) => (
        <li
          key={p.id}
          className={[
            'jeo-score',
            p.id === answererId ? 'answering' : '',
            buzzedIds?.includes(p.id) ? 'buzzed' : '',
            !p.connected ? 'away' : '',
            p.id === meId ? 'me' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          style={{ borderColor: p.color }}
        >
          <span className="jeo-score-name">
            <span aria-hidden>{p.avatar}</span> {p.name}
            {p.id === picker && !view.clue && (
              <span className="badge" title="wählt das nächste Feld">
                wählt
              </span>
            )}
            {!p.connected && <span className="badge away">weg</span>}
          </span>
          <strong className={p.score < 0 ? 'negative' : ''}>{p.score}</strong>
        </li>
      ))}
    </ul>
  );
}

export function JeopardyBoard({
  view,
  canPick,
  onPick,
}: {
  view: JeopardyView;
  canPick: boolean;
  onPick(col: number, row: number): void;
}) {
  return (
    <div className="jeo-board" role="grid" aria-label="Jeopardy-Brett">
      {view.board.map((col, ci) => (
        <div className="jeo-col" key={ci} role="row">
          <div className="jeo-cat" style={{ ['--cat' as string]: `var(--cat-${col.category})` }}>
            <span aria-hidden>{CATEGORY_EMOJI[col.category]}</span>
            <span className="jeo-cat-name">{CATEGORY_LABELS[col.category]}</span>
          </div>
          {col.used.map((used, ri) => (
            <button
              key={ri}
              role="gridcell"
              className={`jeo-cell ${used ? 'used' : ''}`}
              disabled={used || !canPick}
              onClick={() => onPick(ci, ri)}
              aria-label={`${CATEGORY_LABELS[col.category]} für ${(ri + 1) * view.rules.baseValue}`}
            >
              {used ? '' : (ri + 1) * view.rules.baseValue}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
