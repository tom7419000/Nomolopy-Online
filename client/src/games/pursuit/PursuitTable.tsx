/**
 * Der Trivial-Pursuit-Bildschirm.
 *
 * Zwei Ansichten desselben Raums, wie bei Jeopardy:
 *
 * - **Rad** – für den großen Bildschirm. Ein Zusatzgerät tritt als Zuschauer
 *   bei und zeigt Rad, Käsestücke und die laufende Frage groß.
 * - **Spieler** – für das Handy. Würfeln, Zielreihe, Antwortknöpfe; das Rad
 *   klein darüber, damit man trotzdem sieht, wo man steht.
 *
 * Am gemeinsamen Gerät gibt es nur die Rad-Ansicht – dort schauen ohnehin alle
 * auf denselben Bildschirm.
 */

import { useEffect, useMemo, useState } from 'react';
import type { PursuitAction } from '@shared/pursuit/types';
import { api } from '../../net';
import { useSeatRotation, useStore } from '../../state/store';
import { Chat } from '../../components/Chat';
import { Modal } from '../../components/Modal';
import { Wheel } from './Wheel';
import { PursuitPanel, PursuitPlayers, type PursuitActions } from './Panels';
import { Wedges } from './Wedges';

const QUICK_MESSAGES = ['Wusste ich!', 'Geraten … 😄', 'Käse!', 'Gut gemacht!', 'Nochmal!'];

function GameOver({ onClose }: { onClose: () => void }) {
  const view = useStore((s) => s.pursuit)!;
  const session = useStore((s) => s.session);
  const isHost = view.players.find((p) => p.id === session?.playerId)?.isHost ?? false;
  const ranking = [...view.players].sort((a, b) => b.wedges.length - a.wedges.length);

  return (
    <Modal title="🧀 Vorbei!" onClose={onClose}>
      <p>
        {view.winnerId
          ? `${view.players.find((p) => p.id === view.winnerId)?.name} gewinnt.`
          : 'Kein Sieger.'}
      </p>
      <ol className="ranking">
        {ranking.map((p) => (
          <li key={p.id}>
            <span style={{ color: p.color }}>
              {p.avatar} {p.name}
            </span>
            <span className="tp-rank-wedges">
              <Wedges have={p.wedges} size={22} /> {p.wedges.length}
            </span>
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

export function PursuitTable() {
  const room = useStore((s) => s.room)!;
  const view = useStore((s) => s.pursuit)!;
  const session = useStore((s) => s.session);
  const connected = useStore((s) => s.connected);
  const isLocalGame = useStore((s) => s.session?.mode === 'local');
  const addToast = useStore((s) => s.addToast);
  const rotation = useSeatRotation();
  const [tab, setTab] = useState<'log' | 'chat'>('chat');
  const [showWheel, setShowWheel] = useState(false);
  const [resultDismissed, setResultDismissed] = useState(false);

  useEffect(() => {
    if (view.phase === 'ended') setResultDismissed(false);
  }, [view.phase]);

  const me = view.players.find((p) => p.id === session?.playerId);
  const isSpectator = !me;
  const current = view.players[view.currentPlayer];
  const wheelView = isLocalGame || isSpectator || showWheel;

  const actions: PursuitActions = useMemo(
    () => ({
      send(action: PursuitAction, seatId?: string) {
        // Lokal handelt die Oberfläche auch mal für einen anderen Sitz
        // (werten, Farbe wählen). Online ignoriert der Server das – dort
        // kommt die Identität aus dem Socket.
        api.action(action, isLocalGame ? seatId : undefined);
      },
      otherSeat() {
        return view.players.find((p) => p.connected && !p.resigned && p.id !== current?.id)?.id;
      },
    }),
    [isLocalGame, view.players, current?.id]
  );

  // Hervorgehoben wird für alle – anklicken darf nur, wer am Zug ist.
  const canPick = isLocalGame || (!!me && current?.id === me.id);
  const targets = view.turnPhase === 'awaiting-move' ? view.moveOptions : [];

  function copyCode() {
    navigator.clipboard
      ?.writeText(room.meta.code)
      .then(() => addToast('success', 'Code kopiert!'))
      .catch(() => addToast('info', `Raum-Code: ${room.meta.code}`));
  }

  return (
    <div className="game-table pursuit">
      <header className="game-header">
        <div className="game-title">
          <strong>🧀 {room.meta.name}</strong>
          <span className="hint">
            {current?.name} ist am Zug · Ziel: {view.rules.wedgesToWin} Käsestücke
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
              title={showWheel ? 'Zurück zur Spieleransicht' : 'Rad groß zeigen (z. B. am Fernseher)'}
              aria-label={showWheel ? 'Spieleransicht' : 'Rad-Ansicht'}
              onClick={() => setShowWheel((v) => !v)}
            >
              {showWheel ? '📱' : '🖥'}
            </button>
          )}
          {me && !me.resigned && view.phase === 'playing' && !isLocalGame && (
            <button
              className="btn ghost small"
              title="Endgültig aufgeben"
              onClick={() => {
                if (window.confirm('Wirklich aussteigen?')) api.action({ type: 'resign' });
              }}
            >
              🏳
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

      <div className={`game-layout pursuit-layout ${wheelView ? 'wheel-view' : 'player-view'}`}>
        <main className={`tp-main ${wheelView ? 'wheel-view' : 'player-view'}`}>
          {isSpectator && <div className="spectator-banner">🖥 Rad-Ansicht – du schaust zu</div>}
          <div className="tp-wheel-wrap">
            <Wheel
              players={view.players}
              targets={targets}
              canPick={canPick}
              onPick={(id) => actions.send({ type: 'move', to: id })}
              rotation={rotation}
            />
          </div>
          <PursuitPlayers view={view} meId={me?.id} />
        </main>

        <aside className="side right tp-side">
          <PursuitPanel view={view} me={me} local={isLocalGame} actions={actions} />
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

      {view.phase === 'ended' && !resultDismissed && <GameOver onClose={() => setResultDismissed(true)} />}
    </div>
  );
}
