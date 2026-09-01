/**
 * Die laufende Frage – in zwei Zuschnitten.
 *
 * `board`  – für den großen Bildschirm: Frage formatfüllend, drumherum wer
 *            gebuzzert hat und wie gewertet wird.
 * `player` – für das Handy: die Frage klein, der Buzzer riesig. Wer nicht
 *            gerade dran ist, soll auf einen einzigen Knopf schauen.
 *
 * Beide zeigen die Frage. Ohne großen Bildschirm gäbe es sonst nichts zu
 * lesen – der Mehrgeräte-Betrieb ist ein Angebot, keine Voraussetzung.
 */

import { useEffect, useRef, useState } from 'react';
import { CATEGORY_EMOJI, CATEGORY_LABELS } from '@shared/trivia/types';
import { teamLabel } from '@shared/jeopardy/engine';
import type { JeopardyPlayer, JeopardyView } from '@shared/jeopardy/types';

/** Verbleibende Sekunden einer Frist. `null` = keine Uhr (lokaler Modus). */
export function Countdown({ deadline, label }: { deadline: number | null; label?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadline === null) return;
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [deadline]);

  if (deadline === null) return null;
  const left = Math.max(0, deadline - now);
  return (
    <span className={`jeo-clock ${left < 4000 ? 'urgent' : ''}`}>
      ⏱ {Math.ceil(left / 1000)}s{label ? ` ${label}` : ''}
    </span>
  );
}

/**
 * Die Vorlesezeit, groß und unter der Frage.
 *
 * Die kleine Uhr oben rechts (`Countdown`) reicht für ein Handy; auf einem
 * Fernseher quer durch den Raum sieht sie niemand. Und seit der Buzzer von
 * selbst aufgeht, ist das die einzige Anzeige, die sagt WANN – vorher stand
 * dort ein Knopf, der es beantwortete.
 */
function ReadClock({ deadline, seconds }: { deadline: number | null; seconds: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadline === null) return;
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [deadline]);

  // Am gemeinsamen Gerät tickt keine Uhr – dort öffnet der Vorlesende selbst.
  if (deadline === null) return <p className="jeo-waiting">Gleich geht der Buzzer auf …</p>;

  const left = Math.max(0, deadline - now);
  const total = Math.max(1, seconds * 1000);
  return (
    <div className={`jeo-readclock ${left < 3000 ? 'urgent' : ''}`} role="timer">
      <span className="jeo-readclock-num">{Math.ceil(left / 1000)}</span>
      <span className="jeo-readclock-label">bis der Buzzer aufgeht</span>
      <span className="jeo-readclock-bar" aria-hidden>
        <i style={{ width: `${Math.min(100, (left / total) * 100)}%` }} />
      </span>
    </div>
  );
}

function name(view: JeopardyView, id: string | null): string {
  return view.players.find((p) => p.id === id)?.name ?? '—';
}

/** Ein Team über seine ID – für die Sperrliste, die Team-IDs hält. */
function teamName(view: JeopardyView, teamId: string): string {
  const t = view.teams.find((x) => x.id === teamId);
  return t ? teamLabel(view, t) : '—';
}

/** Antwortfeld für den, der das Wort hat. */
function AnswerForm({
  onSubmit,
  big,
}: {
  onSubmit(text: string): void;
  big: boolean;
}) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <form
      className={`jeo-answer-form ${big ? 'big' : ''}`}
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

export interface ClueActions {
  buzz(): void;
  /** Lokal: „wer war zuerst?" – der Namensknopf handelt für diesen Sitz. */
  buzzFor(playerId: string): void;
  answer(text: string): void;
  judge(correct: boolean): void;
  openBuzzer(): void;
  skip(): void;
  next(): void;
}

export function Clue({
  view,
  me,
  layout,
  local,
  isPicker,
  moderated,
  actions,
}: {
  view: JeopardyView;
  me: JeopardyPlayer | undefined;
  layout: 'board' | 'player';
  local: boolean;
  isPicker: boolean;
  /**
   * Führt ein Moderator durch die Sendung? Dann liegen Buzzer öffnen,
   * Auflösen, Werten und Weiter in SEINER Leiste – hier wären sie doppelt,
   * und für alle anderen liefen sie ohnehin in eine Absage.
   */
  moderated?: boolean;
  actions: ClueActions;
}) {
  const c = view.clue;
  if (!c) return null;

  const iAnswer = !!me && c.answererId === me.id;
  // Gesperrt und gewertet wird pro TEAM: Der Kollege des Antwortenden hat
  // weder einen zweiten Versuch noch eine Stimme über die eigenen Punkte.
  const answeringTeam = view.players.find((p) => p.id === c.answererId)?.teamId;
  const iAmLockedOut = !!me && c.lockedOut.includes(me.teamId);
  const iMayBuzz = !!me && !iAmLockedOut && !(me.id in c.buzzes);
  const iMayJudge = !!me && me.teamId !== answeringTeam;
  const buzzed = Object.keys(c.buzzes);

  // `layout-board`, nicht bloß `board`: `.board` ist Monopolys Spielbrett und
  // brächte feste Breite, Seitenverhältnis und dunkle Schrift mit.
  return (
    <section className={`jeo-clue layout-${layout} step-${c.step}`}>
      <header className="jeo-clue-head">
        <span className="jeo-clue-cat" style={{ ['--cat' as string]: `var(--cat-${c.category})` }}>
          <span aria-hidden>{CATEGORY_EMOJI[c.category]}</span> {CATEGORY_LABELS[c.category]}
        </span>
        <strong className="jeo-clue-value">{c.value}</strong>
        <Countdown deadline={c.deadline} />
      </header>

      <p className="jeo-prompt">{c.prompt}</p>

      {/* -- Vorlesezeit ------------------------------------------------- */}
      {c.step === 'reading' && (
        <div className="jeo-stage">
          <ReadClock deadline={c.deadline} seconds={view.rules.readSeconds} />
          {isPicker && !moderated && (
            <button className="btn" onClick={actions.openBuzzer}>
              🔔 Buzzer sofort öffnen
            </button>
          )}
        </div>
      )}

      {/* -- Buzzer ------------------------------------------------------ */}
      {c.step === 'buzzing' && (
        <div className="jeo-stage">
          {local ? (
            // Am gemeinsamen Gerät kann niemand gleichzeitig drücken. Also
            // ruft man wie am echten Spieltisch – und wer vorgelesen hat,
            // tippt auf den Namen dessen, der zuerst dran war.
            <>
              <p className="hint">Wer war zuerst?</p>
              <div className="jeo-name-buzzers">
                {view.players
                  .filter((p) => !p.moderator && !c.lockedOut.includes(p.teamId))
                  .map((p) => (
                    <button
                      key={p.id}
                      className="btn jeo-name-buzzer"
                      style={{ borderColor: p.color }}
                      onClick={() => actions.buzzFor(p.id)}
                    >
                      <span aria-hidden>{p.avatar}</span> {p.name}
                    </button>
                  ))}
              </div>
            </>
          ) : iMayBuzz ? (
            <button className="jeo-buzzer" onClick={actions.buzz} aria-label="Buzzer">
              <span>BUZZ</span>
            </button>
          ) : (
            <p className="jeo-waiting">
              {!me
                ? 'Buzzer offen – wer weiß es?'
                : iAmLockedOut
                  ? 'Dein Team hatte seinen Versuch – die anderen sind dran.'
                  : 'Gedrückt! Warte auf die Entscheidung …'}
            </p>
          )}

          {buzzed.length > 0 && !local && (
            <p className="hint">🔔 {buzzed.map((id) => name(view, id)).join(', ')}</p>
          )}
          {c.lockedOut.length > 0 && (
            <p className="hint">
              Raus: {c.lockedOut.map((id) => teamName(view, id)).join(', ')}
            </p>
          )}
          {isPicker && !moderated && (
            <button className="btn ghost" onClick={actions.skip}>
              Niemand weiß es – auflösen
            </button>
          )}
        </div>
      )}

      {/* -- Antworten --------------------------------------------------- */}
      {c.step === 'answering' && (
        <div className="jeo-stage">
          {iAnswer || (local && c.answererId) ? (
            <>
              <p className="jeo-turn">
                <strong>{name(view, c.answererId)}</strong> hat das Wort
              </p>
              <AnswerForm onSubmit={actions.answer} big={layout === 'board'} />
            </>
          ) : (
            <p className="jeo-waiting">
              <strong>{name(view, c.answererId)}</strong> antwortet …
            </p>
          )}
        </div>
      )}

      {/* -- Werten ------------------------------------------------------ */}
      {c.step === 'judging' && (
        <div className="jeo-stage">
          <p className="jeo-submitted">
            <span className="hint">{name(view, c.answererId)} sagt:</span>
            <strong>{c.submitted || '—'}</strong>
          </p>
          {(iMayJudge && !moderated) || local ? (
            <>
              <p className="hint">
                {c.suggestion === null
                  ? 'Richtig oder nicht?'
                  : c.suggestion
                    ? 'Sieht richtig aus – bestätigen oder überstimmen:'
                    : 'Sieht falsch aus – bestätigen oder überstimmen:'}
              </p>
              <div className="jeo-judge">
                <button
                  className={`btn big ${c.suggestion === true ? 'primary' : ''}`}
                  onClick={() => actions.judge(true)}
                >
                  ✓ Richtig
                </button>
                <button
                  className={`btn big ${c.suggestion === false ? 'primary' : ''}`}
                  onClick={() => actions.judge(false)}
                >
                  ✗ Falsch
                </button>
              </div>
              <p className="hint">
                {Object.keys(c.votes).length} von{' '}
                {/* Werten darf, wer nicht im Team des Antwortenden ist. */}
                {view.players.filter(
                  (p) => p.connected && !p.moderator && p.teamId !== answeringTeam
                ).length}{' '}
                gewertet
              </p>
            </>
          ) : (
            <p className="jeo-waiting">
              {moderated ? 'Der Moderator wertet …' : 'Die anderen werten gerade …'}
            </p>
          )}
        </div>
      )}

      {/* -- Auflösung --------------------------------------------------- */}
      {c.step === 'revealed' && (
        <div className="jeo-stage">
          <p className={`jeo-verdict ${c.correct ? 'right' : 'wrong'}`}>
            {c.correct ? `✅ ${name(view, c.answererId)} bekommt ${c.value}` : '❌ Niemand bekommt Punkte'}
          </p>
          <p className="jeo-solution">
            <span className="hint">Richtig ist:</span>
            <strong>{c.answer}</strong>
          </p>
          {!moderated && (
            <button className="btn primary big" onClick={actions.next}>
              Weiter zum Brett
            </button>
          )}
        </div>
      )}
    </section>
  );
}
