/**
 * Der Jeopardy-Bildschirm.
 *
 * Ein Raum, zwei Ansichten:
 *
 * - **Brett** – für den großen Bildschirm. Das Gerät tritt als Zuschauer bei
 *   (dafür gibt es `caps.spectators`), zeigt Brett, Punktestände und die
 *   laufende Frage. Genau das ist der Mehrgeräte-Betrieb: Fernseher plus
 *   Handys.
 * - **Spieler** – für das Handy. Ein bildschirmfüllender Buzzer, sonst fast
 *   nichts; wer wählen darf, bekommt statt dessen das Brett.
 *
 * Am gemeinsamen Gerät gibt es nur die Brett-Ansicht: gleichzeitig buzzern
 * geht auf einem Tablet nicht, also tippt der Vorlesende auf den Namen
 * dessen, der zuerst gerufen hat.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { JeopardyAction } from '@shared/jeopardy/types';
import { api } from '../../net';
import { useStore } from '../../state/store';
import { Chat } from '../../components/Chat';
import { Modal } from '../../components/Modal';
import { JeopardyBoard, ScoreBoard } from './Board';
import { Clue, Countdown, type ClueActions } from './Clue';
import { membersOf, teamLabel } from '@shared/jeopardy/engine';

const QUICK_MESSAGES = ['Zu schnell! 😄', 'Das zählt!', 'Niemals …', 'Gut gebuzzert!', 'Nochmal!'];

function GameOver({ onClose }: { onClose: () => void }) {
  const view = useStore((s) => s.jeopardy)!;
  const session = useStore((s) => s.session);
  const isHost = view.players.find((p) => p.id === session?.playerId)?.isHost ?? false;
  const ranking = [...view.teams].sort((a, b) => b.score - a.score);
  const winner = view.teams.find((t) => t.id === view.winnerTeamId);

  return (
    <Modal title="🏆 Vorbei!" onClose={onClose}>
      <p>{winner ? `${teamLabel(view, winner)} gewinnt.` : 'Kein Sieger.'}</p>
      <ol className="ranking">
        {ranking.map((t) => (
          <li key={t.id}>
            <span style={{ color: t.color }}>
              {membersOf(view, t.id).length === 1 ? '🎯' : '👥'} {teamLabel(view, t)}
            </span>
            <span>{t.score} Punkte</span>
          </li>
        ))}
      </ol>
      <div className="btn-row">
        {isHost && (
          <button className="btn primary" onClick={() => api.rematch()}>
            🔁 Neue Runde
          </button>
        )}
        <button className="btn" onClick={() => api.leaveRoom()}>
          🚪 Raum verlassen
        </button>
      </div>
    </Modal>
  );
}

export function JeopardyTable() {
  const room = useStore((s) => s.room)!;
  const view = useStore((s) => s.jeopardy)!;
  const session = useStore((s) => s.session);
  const connected = useStore((s) => s.connected);
  const isLocalGame = useStore((s) => s.session?.mode === 'local');
  const addToast = useStore((s) => s.addToast);
  const [tab, setTab] = useState<'log' | 'chat'>('chat');
  const [showBoard, setShowBoard] = useState(false);
  const [resultDismissed, setResultDismissed] = useState(false);

  useEffect(() => {
    if (view.phase === 'ended') setResultDismissed(false);
  }, [view.phase]);

  const me = view.players.find((p) => p.id === session?.playerId);
  const isSpectator = !me;
  const clue = view.clue;
  // Dran ist ein TEAM – jedes Mitglied darf tippen.
  const pickerTeam = view.teams.find((t) => t.id === view.pickerTeamId) ?? null;
  const pickerName = pickerTeam ? teamLabel(view, pickerTeam) : null;
  // Am gemeinsamen Gerät handelt die Oberfläche FÜR einen Sitz – dort ist
  // jeder sein eigenes Team, also ist das erste Mitglied der richtige.
  const pickerSeatId = view.pickerTeamId ? membersOf(view, view.pickerTeamId)[0]?.id : undefined;
  // Moderiert wird die Sendung von einem, der nicht mitspielt: er wählt die
  // Felder, liest vor und wertet. Den Buzzer macht die Vorlesezeit auf – er
  // kann sie nur abkürzen.
  const moderator = view.players.find((p) => p.moderator && p.connected) ?? null;
  const iModerate = !!me?.moderator;
  const isPicker =
    iModerate || (!moderator && (isLocalGame || (!!me && me.teamId === view.pickerTeamId)));

  // Zuschauer sind der große Bildschirm; am geteilten Gerät sitzen alle
  // davor. Der Moderator startet direkt in der Präsentation.
  const boardView = isLocalGame || isSpectator || iModerate || showBoard;

  /**
   * Reaktionszeit messen.
   *
   * Nicht die Ankunft der Nachricht entscheidet das Buzzer-Rennen, sondern
   * die Zeit von „Buzzer sichtbar offen" bis zum Tastendruck – gemessen auf
   * DIESEM Gerät, ohne Uhrenabgleich. Der Schlüssel enthält `lockedOut`,
   * weil der Buzzer nach einer falschen Antwort erneut aufgeht.
   */
  const openKey = clue && clue.step === 'buzzing' ? `${clue.col}:${clue.row}:${clue.lockedOut.length}` : '';
  const openedAt = useRef<{ key: string; at: number } | null>(null);
  useEffect(() => {
    if (openKey) openedAt.current = { key: openKey, at: performance.now() };
  }, [openKey]);

  /** Lokal handelt die Oberfläche für einen bestimmten Sitz (siehe api.action). */
  function send(action: JeopardyAction, seatId?: string) {
    api.action(action, isLocalGame ? seatId : undefined);
  }

  const actions: ClueActions = useMemo(
    () => ({
      buzz() {
        const measured = openedAt.current;
        send({
          type: 'buzz',
          reactionMs: measured && measured.key === openKey ? performance.now() - measured.at : undefined,
        });
      },
      buzzFor(playerId) {
        send({ type: 'buzz' }, playerId);
      },
      answer(text) {
        send({ type: 'answer', text }, clue?.answererId ?? undefined);
      },
      judge(correct) {
        // Am geteilten Gerät wertet die Runde gemeinsam – ein Tipp genügt,
        // abgegeben im Namen des Ersten, der nicht im Team des Antwortenden
        // ist (der dürfte über die eigenen Punkte nicht abstimmen).
        const answering = view.players.find((p) => p.id === clue?.answererId)?.teamId;
        const judge = view.players.find(
          (p) => p.connected && !p.moderator && p.teamId !== answering
        );
        send({ type: 'judge', correct }, judge?.id);
      },
      openBuzzer() {
        send({ type: 'openBuzzer' }, pickerSeatId);
      },
      skip() {
        send({ type: 'skip' }, pickerSeatId);
      },
      next() {
        send({ type: 'next' }, pickerSeatId);
      },
    }),
    // `send` und die IDs hängen an genau diesen Werten.
    [openKey, clue?.answererId, pickerSeatId, view.players, isLocalGame]
  );

  function pick(col: number, row: number) {
    send({ type: 'pick', col, row }, pickerSeatId);
  }

  function copyCode() {
    navigator.clipboard
      ?.writeText(room.meta.code)
      .then(() => addToast('success', 'Code kopiert!'))
      .catch(() => addToast('info', `Raum-Code: ${room.meta.code}`));
  }

  const left = view.board.reduce((n, col) => n + col.used.filter((u) => !u).length, 0);

  return (
    <div className="game-table jeopardy">
      <header className="game-header">
        <div className="game-title">
          <strong>🎯 {room.meta.name}</strong>
          <span className="hint">
            {left} von 30 Feldern offen
            {clue ? '' : pickerName ? ` · ${pickerName} wählt` : ''}
          </span>
        </div>
        {isLocalGame ? (
          <div className="conn-pill local">
            <span className="dot" /> am Gerät
          </div>
        ) : (
          <>
            <button className="room-code small" onClick={copyCode} title="Code kopieren">
              {room.meta.code} ⧉
            </button>
            <div className={`conn-pill ${connected ? 'ok' : 'bad'}`}>
              <span className="dot" />
              {connected ? 'online' : 'offline'}
            </div>
          </>
        )}
        <div className="game-menu">
          {view.phase === 'ended' && resultDismissed && (
            <button className="btn small" onClick={() => setResultDismissed(false)}>
              🏆 Ergebnis
            </button>
          )}
          {me && !isLocalGame && (
            <button
              className="btn ghost small"
              title={showBoard ? 'Zurück zum Buzzer' : 'Brett groß zeigen (z. B. am Fernseher)'}
              aria-label={showBoard ? 'Buzzer-Ansicht' : 'Brett-Ansicht'}
              onClick={() => setShowBoard((v) => !v)}
            >
              {showBoard ? '📱' : '🖥'}
            </button>
          )}
          <button
            className="btn ghost small"
            title={isLocalGame ? 'Partie beenden' : 'Raum verlassen'}
            onClick={() => {
              const question = isLocalGame
                ? 'Partie beenden? Der lokale Spielstand geht dabei verloren.'
                : 'Raum verlassen? Du kannst mit deinem Namen wieder beitreten.';
              if (isSpectator || view.phase !== 'playing' || window.confirm(question)) api.leaveRoom();
            }}
          >
            🚪
          </button>
        </div>
      </header>

      <div className={`game-layout jeopardy-layout ${iModerate ? 'presenting' : ''}`}>
        <main className={`jeo-main ${boardView ? 'board-view' : 'player-view'}`}>
          {isSpectator && <div className="spectator-banner">🖥 Brett-Ansicht – du schaust zu</div>}
          {iModerate && (
            <div className="jeo-moderator-hint">
              🎙 Du moderierst.{' '}
              {clue
                ? 'Lies vor – der Buzzer geht von selbst auf. Werten tust du.'
                : `${pickerName ?? 'Wer dran ist'} darf sich ein Feld wünschen – tipp es an.`}
            </div>
          )}

          {boardView ? (
            <>
              {clue ? (
                <Clue
                  view={view}
                  // Der Moderator bekommt weder Buzzer noch Antwortfeld: er
                  // spielt nicht mit, er führt.
                  me={iModerate ? undefined : me}
                  layout="board"
                  local={isLocalGame}
                  isPicker={iModerate ? false : isPicker}
                  moderated={!!moderator}
                  actions={actions}
                />
              ) : (
                <JeopardyBoard view={view} canPick={isPicker && view.phase === 'playing'} onPick={pick} />
              )}
              <ScoreBoard
                view={view}
                meId={me?.id}
                buzzedIds={clue ? Object.keys(clue.buzzes) : []}
                answererId={clue?.answererId}
              />
            </>
          ) : clue ? (
            <Clue
              view={view}
              me={me}
              layout="player"
              local={false}
              isPicker={isPicker}
              moderated={!!moderator}
              actions={actions}
            />
          ) : isPicker ? (
            <>
              <p className="jeo-turn">
                <strong>Du wählst</strong> das nächste Feld
              </p>
              <JeopardyBoard view={view} canPick onPick={pick} />
            </>
          ) : (
            <div className="jeo-idle">
              <p className="jeo-waiting">
                <strong>{pickerName ?? '—'}</strong> wählt gerade …
              </p>
              <ScoreBoard view={view} meId={me?.id} />
            </div>
          )}
        </main>

        <aside className="side right">
          <div className="tabs">
            <button className={`tab ${tab === 'chat' ? 'active' : ''}`} onClick={() => setTab('chat')}>
              💬 Chat
            </button>
            <button className={`tab ${tab === 'log' ? 'active' : ''}`} onClick={() => setTab('log')}>
              📜 Verlauf
            </button>
          </div>
          <div className="tab-content">
            {tab === 'chat' ? (
              <Chat
                messages={view.chat.map((m) => ({ ...m, mine: m.playerId === session?.playerId }))}
                onSend={(t) => api.chat(t)}
                quickMessages={QUICK_MESSAGES}
              />
            ) : (
              <div className="log-panel" role="log">
                {view.log.map((entry) => (
                  <div key={entry.id} className={`log-entry kind-${entry.kind}`}>
                    <span className="log-text">{entry.text}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>

      {!connected && !isLocalGame && (
        <div className="reconnect-overlay">
          <div className="reconnect-box">
            <span className="spinner" /> Verbindung unterbrochen – stelle wieder her …
          </div>
        </div>
      )}

      {iModerate && clue && view.phase === 'playing' && (
        <div className="jeo-moderator-bar">
          {clue.step === 'reading' && (
            <>
              {/* Der Buzzer geht nach der Vorlesezeit von selbst auf – der
                  Knopf ist die Abkürzung für den, der schneller fertig ist. */}
              <span className="hint">Der Buzzer geht gleich von selbst auf.</span>
              <button className="btn big" onClick={actions.openBuzzer}>
                🔔 Sofort öffnen
              </button>
            </>
          )}
          {clue.step === 'buzzing' && (
            <>
              <span className="hint">Buzzer offen …</span>
              <button className="btn" onClick={actions.skip}>
                Niemand weiß es – auflösen
              </button>
            </>
          )}
          {clue.step === 'answering' && (
            <span className="hint">{view.players.find((p) => p.id === clue.answererId)?.name} antwortet …</span>
          )}
          {clue.step === 'judging' && (
            <>
              <span className="jeo-mod-answer">
                „{clue.submitted || '—'}"
              </span>
              <button
                className={`btn big ${clue.suggestion === true ? 'primary' : ''}`}
                onClick={() => actions.judge(true)}
              >
                ✓ Richtig
              </button>
              <button
                className={`btn big ${clue.suggestion === false ? 'primary' : ''}`}
                onClick={() => actions.judge(false)}
              >
                ✗ Falsch
              </button>
            </>
          )}
          {clue.step === 'revealed' && (
            <button className="btn primary big" onClick={actions.next}>
              Weiter zum Brett
            </button>
          )}
        </div>
      )}

      {view.phase === 'ended' && !resultDismissed && <GameOver onClose={() => setResultDismissed(true)} />}
    </div>
  );
}

export { Countdown };
