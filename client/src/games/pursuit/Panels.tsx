/**
 * Das Aktionspanel von Trivial Pursuit – ein Block je Zugphase, nach dem
 * Muster von `monopoly/Panels.tsx`.
 *
 * Hier steht auch die **Zielreihe**: die erreichbaren Felder als echte Knöpfe.
 * Auf dem Rad sind sie zwar anklickbar, aber SVG-Pfade sind keine Knöpfe –
 * und am Handy ist eine Knopfreihe ohnehin die bessere Trefferfläche. Ein
 * Mechanismus, zwei Zwecke.
 */

import { useEffect, useRef, useState } from 'react';
import { WHEEL } from '@shared/pursuit/board';
import {
  CATEGORY_COLORS,
  CATEGORY_EMOJI,
  CATEGORY_LABELS,
  TRIVIA_CATEGORIES,
} from '@shared/trivia/types';
import type { PursuitAction, PursuitPlayer, PursuitView } from '@shared/pursuit/types';
import { Wedges } from './Wedges';

export interface PursuitActions {
  send(action: PursuitAction, seatId?: string): void;
  /** Wer im lokalen Modus stellvertretend wertet bzw. abstimmt. */
  otherSeat(): string | undefined;
}

/** Verbleibende Sekunden einer Frist. `null` = keine Uhr (lokaler Modus). */
export function Countdown({ deadline }: { deadline: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadline === null) return;
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [deadline]);
  if (deadline === null) return null;
  const left = Math.max(0, deadline - now);
  return <span className={`tp-clock ${left < 6000 ? 'urgent' : ''}`}>⏱ {Math.ceil(left / 1000)}s</span>;
}

/** Wie ein Feld heißt, wenn man es antippen soll. */
function targetLabel(nodeId: number): { text: string; color: string; emoji: string } {
  const n = WHEEL[nodeId];
  if (n.kind === 'hub') return { text: 'Mitte', color: 'var(--accent)', emoji: '🎯' };
  if (n.kind === 'rollAgain') return { text: 'Freiwurf', color: 'var(--panel-3)', emoji: '🎲' };
  const c = n.category!;
  return {
    text: n.kind === 'hq' ? `${CATEGORY_LABELS[c]}-Ecke` : CATEGORY_LABELS[c],
    color: CATEGORY_COLORS[c],
    emoji: n.kind === 'hq' ? '🧀' : CATEGORY_EMOJI[c],
  };
}

function AnswerForm({ onSubmit }: { onSubmit(text: string): void }) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <form
      className="tp-answer-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(text);
      }}
    >
      <input
        ref={ref}
        className="input"
        value={text}
        maxLength={200}
        autoComplete="off"
        placeholder="Deine Antwort …"
        aria-label="Deine Antwort"
        onChange={(e) => setText(e.target.value)}
      />
      <div className="btn-row">
        <button className="btn primary" type="submit" disabled={!text.trim()}>
          Abschicken
        </button>
        <button className="btn ghost" type="button" onClick={() => onSubmit('')}>
          Weiß ich nicht
        </button>
      </div>
    </form>
  );
}

export function PursuitPanel({
  view,
  me,
  local,
  actions,
}: {
  view: PursuitView;
  me: PursuitPlayer | undefined;
  local: boolean;
  actions: PursuitActions;
}) {
  const current = view.players[view.currentPlayer];
  // Lokal handelt immer, wer das Gerät hält – dort ist „ich" der aktive Sitz.
  const mine = local || (!!me && current?.id === me.id);
  const c = view.clue;
  const iMayJudge = local || (!!me && current?.id !== me.id);

  if (view.phase !== 'playing') return null;

  return (
    <div className="actions-panel tp-panel">
      <div className={`turn-banner ${mine ? 'mine' : ''}`} style={{ borderColor: current?.color }}>
        <span className="token" aria-hidden>
          {current?.avatar}
        </span>
        <div className="tp-turn-text">
          <strong>{mine && !local ? 'Du bist' : `${current?.name} ist`}</strong> am Zug
          {view.die !== null && <span className="tp-die" aria-label={`gewürfelt: ${view.die}`}>🎲 {view.die}</span>}
        </div>
        <Wedges have={current?.wedges ?? []} />
      </div>

      {/* -- Würfeln ---------------------------------------------------- */}
      {view.turnPhase === 'awaiting-roll' && (
        <div className="action-block">
          {mine ? (
            <button className="btn primary big" onClick={() => actions.send({ type: 'roll' })}>
              🎲 Würfeln
            </button>
          ) : (
            <p className="hint">{current?.name} würfelt …</p>
          )}
          {/* Debug-Modus: den nächsten Wurf setzen. Zum Vorführen und für den
              E2E-Test, der sonst auf die richtige Augenzahl warten müsste. */}
          {view.rules.debugMode && mine && (
            <div className="tp-debug">
              <span className="hint">🐞 Nächster Wurf:</span>
              {[1, 2, 3, 4, 5, 6].map((d) => (
                <button
                  key={d}
                  className={`btn small ${view.nextDie === d ? 'primary' : ''}`}
                  aria-label={`Nächster Wurf ${d}`}
                  onClick={() => actions.send({ type: 'setDie', die: d })}
                >
                  {d}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* -- Ziel wählen ------------------------------------------------- */}
      {view.turnPhase === 'awaiting-move' && (
        <div className="action-block">
          <p className="hint">
            {mine ? 'Wohin?' : `${current?.name} sucht sich ein Ziel …`}
          </p>
          <div className="tp-targets">
            {view.moveOptions.map((id, i) => {
              const l = targetLabel(id);
              return (
                <button
                  key={id}
                  className="btn tp-target"
                  style={{ borderColor: l.color }}
                  disabled={!mine}
                  onClick={() => actions.send({ type: 'move', to: id })}
                >
                  {/* Dieselbe Ziffer steht auf dem Feld im Rad. */}
                  <span className="tp-target-badge" aria-hidden>
                    {i + 1}
                  </span>
                  <span aria-hidden>{l.emoji}</span> {l.text}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* -- Farbe der Schlussfrage -------------------------------------- */}
      {view.turnPhase === 'awaiting-category' && (
        <div className="action-block tp-final">
          <p className="tp-final-head">
            🎯 <strong>{current?.name}</strong> steht in der Mitte!
          </p>
          {iMayJudge ? (
            <>
              <p className="hint">Ihr bestimmt die Farbe der Schlussfrage:</p>
              <div className="tp-targets">
                {TRIVIA_CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    className="btn tp-target"
                    style={{ borderColor: CATEGORY_COLORS[cat] }}
                    onClick={() =>
                      actions.send({ type: 'voteCategory', category: cat }, actions.otherSeat())
                    }
                  >
                    <span aria-hidden>{CATEGORY_EMOJI[cat]}</span> {CATEGORY_LABELS[cat]}
                  </button>
                ))}
              </div>
              <p className="hint">
                {Object.keys(view.categoryVotes).length} von{' '}
                {view.players.filter((p) => p.connected && !p.resigned).length - 1} gewählt
              </p>
            </>
          ) : (
            <p className="hint">Die anderen suchen dir eine Farbe aus …</p>
          )}
          <Countdown deadline={view.categoryDeadline} />
        </div>
      )}

      {/* -- Frage -------------------------------------------------------- */}
      {c && view.turnPhase !== 'awaiting-category' && (
        <div className="action-block tp-clue">
          <header className="tp-clue-head">
            <span className="tp-clue-cat" style={{ background: CATEGORY_COLORS[c.category] }}>
              {CATEGORY_EMOJI[c.category]} {CATEGORY_LABELS[c.category]}
            </span>
            {c.forWedge && <span className="tp-badge">🧀 Käsestück</span>}
            {c.final && <span className="tp-badge final">🎯 Schlussfrage</span>}
            <Countdown deadline={c.deadline} />
          </header>
          <p className="tp-prompt">{c.prompt}</p>

          {view.turnPhase === 'awaiting-answer' &&
            (mine ? (
              c.options.length > 0 ? (
                <div className="tp-options">
                  {c.options.map((o) => (
                    <button
                      key={o}
                      className="btn big tp-option"
                      onClick={() => actions.send({ type: 'answer', text: o })}
                    >
                      {o}
                    </button>
                  ))}
                </div>
              ) : (
                <AnswerForm onSubmit={(t) => actions.send({ type: 'answer', text: t })} />
              )
            ) : (
              <p className="hint">{current?.name} überlegt …</p>
            ))}

          {view.turnPhase === 'awaiting-judge' && (
            <>
              <p className="tp-submitted">
                <span className="hint">{current?.name} sagt:</span>
                <strong>{c.submitted || '—'}</strong>
              </p>
              {iMayJudge ? (
                <>
                  <p className="hint">
                    {c.suggestion ? 'Sieht richtig aus' : 'Sieht falsch aus'} – bestätigen oder überstimmen:
                  </p>
                  <div className="btn-row">
                    <button
                      className={`btn big ${c.suggestion === true ? 'primary' : ''}`}
                      onClick={() => actions.send({ type: 'judge', correct: true }, actions.otherSeat())}
                    >
                      ✓ Richtig
                    </button>
                    <button
                      className={`btn big ${c.suggestion === false ? 'primary' : ''}`}
                      onClick={() => actions.send({ type: 'judge', correct: false }, actions.otherSeat())}
                    >
                      ✗ Falsch
                    </button>
                  </div>
                </>
              ) : (
                <p className="hint">Die anderen werten gerade …</p>
              )}
            </>
          )}

          {view.turnPhase === 'revealed' && (
            <>
              <p className={`tp-verdict ${c.correct ? 'right' : 'wrong'}`}>
                {c.correct
                  ? c.final
                    ? `🏆 ${current?.name} gewinnt!`
                    : c.forWedge
                      ? `🧀 Käsestück für ${current?.name}!`
                      : `✅ Richtig – ${current?.name} darf nochmal.`
                  : `❌ Leider falsch.`}
              </p>
              {!c.correct && (
                <p className="tp-solution">
                  <span className="hint">Richtig ist:</span> <strong>{c.answer}</strong>
                </p>
              )}
              <button className="btn primary big" onClick={() => actions.send({ type: 'next' })}>
                Weiter
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Die Spielerliste mit Käse-Torten – am Tisch die wichtigste Anzeige. */
export function PursuitPlayers({ view, meId }: { view: PursuitView; meId?: string }) {
  return (
    <ul className="tp-players">
      {view.players.map((p, i) => (
        <li
          key={p.id}
          className={[
            'tp-player',
            i === view.currentPlayer ? 'current' : '',
            p.resigned ? 'out' : '',
            !p.connected ? 'away' : '',
            p.id === meId ? 'me' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          style={{ borderColor: p.color }}
        >
          <span className="token" aria-hidden>
            {p.avatar}
          </span>
          <span className="tp-player-name">
            {p.name}
            {!p.connected && <span className="badge away">weg</span>}
            {p.resigned && <span className="badge away">raus</span>}
          </span>
          <Wedges have={p.wedges} />
          <strong className="tp-player-count">
            {p.wedges.length}/{view.rules.wedgesToWin}
          </strong>
        </li>
      ))}
    </ul>
  );
}
