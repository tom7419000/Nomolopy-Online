/**
 * Das Jeopardy-Brett und die Punktetafel – die Ansicht für den großen
 * Bildschirm.
 *
 * Sechs Spalten, fünf Zeilen, mehr nicht. Genau dieselbe Form hat das
 * Abdeckungsraster im Paket-Editor: das Fragenformat ist auf sechs
 * Kategorien und fünf Stufen festgelegt, also IST das Brett das Raster.
 */

import { CATEGORY_EMOJI, CATEGORY_LABELS } from '@shared/trivia/types';
import { membersOf, teamLabel } from '@shared/jeopardy/engine';
import type { JeopardyView } from '@shared/jeopardy/types';

/**
 * Die Punktetafel – eine Zeile je TEAM.
 *
 * Wer allein spielt, ist ein Team mit einem Mitglied; die Zeile sieht dann
 * genauso aus wie vor den Teams. Deshalb gibt es hier nur einen Fall statt
 * „mit Teams" und „ohne".
 */
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
  const myTeam = view.players.find((p) => p.id === meId)?.teamId;
  const answeringTeam = view.players.find((p) => p.id === answererId)?.teamId;
  return (
    <ul className="jeo-scores">
      {/* Der Moderator hat keinen Punktestand – er spielt nicht mit und
          steht deshalb in gar keinem Team. */}
      {view.teams.map((t) => {
        const members = membersOf(view, t.id);
        const solo = members.length === 1;
        return (
          <li
            key={t.id}
            className={[
              'jeo-score',
              t.id === answeringTeam ? 'answering' : '',
              members.some((m) => buzzedIds?.includes(m.id)) ? 'buzzed' : '',
              members.every((m) => !m.connected) ? 'away' : '',
              t.id === myTeam ? 'me' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{ borderColor: t.color }}
          >
            <span className="jeo-score-name">
              <span aria-hidden>{solo ? members[0]?.avatar ?? '👥' : '👥'}</span>{' '}
              {teamLabel(view, t)}
              {t.id === view.pickerTeamId && !view.clue && (
                <span className="badge" title="wählt das nächste Feld">
                  wählt
                </span>
              )}
              {members.every((m) => !m.connected) && <span className="badge away">weg</span>}
            </span>
            <strong className={t.score < 0 ? 'negative' : ''}>{t.score}</strong>
          </li>
        );
      })}
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
