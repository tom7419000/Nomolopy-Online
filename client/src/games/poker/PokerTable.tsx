/**
 * Poker-Tisch: ovaler Filztisch mit Sitzen im Kreis, Community Cards und Pot
 * in der Mitte, eigener Hand + Action-Bar unten und Chat/Log rechts.
 * Alle Aktionen werden serverseitig validiert – die UI blendet nur ein/aus.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { HandResult, PokerPlayer, PokerView } from '@shared/poker/types';
import { bestHand, handName } from '@shared/poker/hands';
import { HIDDEN_CARD, pokerCallAmount, pokerMinRaiseTo, potTotal } from '@shared/poker/engine';
import { api } from '../../net';
import { useSeatRotation, useStore } from '../../state/store';
import { Chat } from '../../components/Chat';
import { Modal } from '../../components/Modal';
import { PlayingCard } from './PlayingCard';
import { HoleCards, usePeek } from './HoleCards';
import { TurnBanner } from '../../components/TurnBanner';
import { SeatDock, TableSideSheet } from '../../components/SeatDock';

const QUICK_MESSAGES = ['👏 Gut gespielt', '😏 Netter Bluff', '🍀 Glück gehabt', '😂'];

function fmt(n: number): string {
  return n.toLocaleString('de-DE');
}

function streetLabel(view: PokerView): string {
  switch (view.street) {
    case 'preflop':
      return 'Pre-Flop';
    case 'flop':
      return 'Flop';
    case 'turn':
      return 'Turn';
    case 'river':
      return 'River';
    default:
      return 'Showdown';
  }
}

/** Countdown-Fortschritt (1 → 0) für die Bedenkzeit. */
function useDeadlineProgress(deadline: number | null, totalSec: number): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (deadline === null) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [deadline]);
  if (deadline === null) return 0;
  return Math.max(0, Math.min(1, (deadline - now) / (totalSec * 1000)));
}

function Seat({
  view,
  player,
  index,
  seatCount,
  isMe,
  result,
  hideHole,
  edge,
}: {
  view: PokerView;
  player: PokerPlayer;
  index: number;
  seatCount: number;
  isMe: boolean;
  result: HandResult | null;
  /** Lokal: der aktive Sitz zeigt seine Karten erst beim Halten des Knopfes. */
  hideHole?: boolean;
  /** Feste Plätze: Kante, zu der sich diese Sitzbox drehen soll. */
  edge?: number | null;
}) {
  const isDealer = view.players[view.dealerIndex]?.id === player.id;
  const isToAct = view.toActIndex !== null && view.players[view.toActIndex]?.id === player.id;
  const progress = useDeadlineProgress(isToAct ? view.actionDeadline : null, view.rules.actionTimeoutSec);
  const reveal = result?.reveal.find((r) => r.playerId === player.id);
  const bestSet = new Set(reveal?.best ?? []);
  const won = result?.pots.some((pot) => pot.winners.some((w) => w.playerId === player.id));

  // Position auf der Ellipse: eigener Sitz unten (90°), Rest im Uhrzeigersinn.
  //
  // Bei festen Plätzen kommt der Winkel dagegen aus der KANTE – dann sitzt
  // jeder dort, wo er wirklich sitzt. Die Kanten sind so definiert, dass das
  // aufgeht: 0 = unten = 90°, 90 = links = 180°, 180 = oben = 270°,
  // 270 = rechts = 0°.
  const deg = edge != null ? 90 + edge : 90 + (360 / seatCount) * index;
  const angle = (Math.PI / 180) * deg;
  const x = 50 + 43 * Math.cos(angle);
  const y = 50 + 41 * Math.sin(angle);

  return (
    <div
      className={`seat ${isToAct ? 'to-act' : ''} ${player.folded ? 'folded' : ''} ${player.out ? 'out' : ''} ${
        won ? 'won' : ''
      } ${isMe ? 'me' : ''} ${edge != null ? 'fixed-edge' : ''}`}
      style={
        {
          left: `${x}%`,
          top: `${y}%`,
          ...(edge != null ? { '--edge-deg': `${edge}deg` } : {}),
        } as React.CSSProperties
      }
    >
      <div className="seat-cards">
        {(reveal?.hole ?? player.hole ?? []).map((c, i) => (
          <PlayingCard
            key={i}
            card={hideHole && !reveal ? HIDDEN_CARD : c}
            size="sm"
            highlight={!hideHole && bestSet.has(c)}
          />
        ))}
      </div>
      <div className="seat-box" style={{ borderColor: player.color }}>
        <span className="seat-avatar" style={{ background: player.color }} aria-hidden>
          {player.avatar}
        </span>
        <span className="seat-info">
          <span className="seat-name">
            {player.name}
            {isMe && <span className="badge you">DU</span>}
            {!player.connected && !player.out && (
              <span className="flag offline" title="Verbindung getrennt">
                ⚠
              </span>
            )}
          </span>
          <span className="seat-chips">
            {player.out ? '– raus –' : `${fmt(player.chips)} 🪙`}
            {player.allIn && !player.out && <span className="badge allin">ALL-IN</span>}
          </span>
        </span>
        {isDealer && (
          <span className="dealer-chip" title="Dealer-Button">
            D
          </span>
        )}
        {isToAct && <span className="seat-timer" style={{ transform: `scaleX(${progress})` }} />}
      </div>
      {player.lastAction && !player.out && <span className="seat-action">{player.lastAction}</span>}
      {player.bet > 0 && <span className="seat-bet">{fmt(player.bet)}</span>}
      {reveal && <span className="seat-handname">{reveal.handName}</span>}
    </div>
  );
}

function ActionBar({ view, me }: { view: PokerView; me: PokerPlayer }) {
  const isMyTurn = view.toActIndex !== null && view.players[view.toActIndex]?.id === me.id;
  const callAmount = pokerCallAmount(view, me);
  const canCheck = me.bet === view.currentBet;
  const minTo = pokerMinRaiseTo(view);
  const maxTo = me.bet + me.chips;
  const [raiseTo, setRaiseTo] = useState(minTo);
  const pot = potTotal(view);
  // Hat der Spieler den Betrag selbst angefasst, darf ein hereinkommender
  // Zustand ihn nicht überschreiben. Lokal trifft jeder eigene Klick sofort
  // wieder ein – ohne diese Merkung risse es einen laufenden Zieh-Vorgang weg.
  const touched = useRef(false);

  useEffect(() => {
    touched.current = false;
  }, [view.street, me.id]);

  useEffect(() => {
    if (touched.current) return;
    setRaiseTo(Math.min(Math.max(minTo, view.bigBlind * 2), maxTo));
    // Bei neuem Zug/Street sinnvoll vorbelegen
  }, [minTo, maxTo, view.street, view.currentBet, view.bigBlind]);

  const changeRaise = (v: number) => {
    touched.current = true;
    setRaiseTo(v);
  };

  if (me.out) return <div className="poker-actions hint">Du bist ausgeschieden – schau einfach weiter zu.</div>;

  if (view.street === 'showdown') {
    return (
      <div className="poker-actions">
        {view.rules.allowRebuy && me.chips === 0 && (
          <button className="btn primary" onClick={() => api.action({ type: 'rebuy' })}>
            🔄 Rebuy ({fmt(view.rules.buyIn)})
          </button>
        )}
        {me.isHost && (
          <>
            <button className="btn" onClick={() => api.action({ type: 'nextHand' })}>
              ⏭ Nächste Hand
            </button>
            {view.rules.allowRebuy && (
              <button
                className="btn ghost"
                onClick={() => {
                  if (window.confirm('Partie beenden? Gewinner ist der größte Stack.')) {
                    api.action({ type: 'endGame' });
                  }
                }}
              >
                🏁 Partie beenden
              </button>
            )}
          </>
        )}
        {!me.isHost && <span className="hint">Nächste Hand startet gleich …</span>}
      </div>
    );
  }

  if (!isMyTurn || me.folded || me.allIn) {
    const actor = view.toActIndex !== null ? view.players[view.toActIndex] : null;
    return (
      <div className="poker-actions hint">
        {me.folded
          ? 'Du hast gefoldet – warte auf die nächste Hand.'
          : me.allIn
            ? 'Du bist all-in – Daumen drücken! 🤞'
            : actor
              ? `${actor.name} ist am Zug …`
              : 'Warte …'}
      </div>
    );
  }

  const canRaise = maxTo > view.currentBet;
  const clampedRaise = Math.max(minTo, Math.min(maxTo, raiseTo));

  return (
    <div className="poker-actions mine">
      <button className="btn danger" onClick={() => api.action({ type: 'fold' })}>
        Fold
      </button>
      {canCheck ? (
        <button className="btn" onClick={() => api.action({ type: 'check' })}>
          Check
        </button>
      ) : (
        <button className="btn primary" onClick={() => api.action({ type: 'call' })}>
          Call {fmt(callAmount)}
          {callAmount === me.chips && ' (All-In)'}
        </button>
      )}
      {canRaise && maxTo >= minTo && (
        <div className="raise-group">
          <input
            type="range"
            min={minTo}
            max={maxTo}
            step={view.bigBlind}
            value={clampedRaise}
            onChange={(e) => changeRaise(Number(e.target.value))}
            aria-label="Erhöhen auf"
          />
          <input
            type="number"
            className="input small"
            min={minTo}
            max={maxTo}
            value={clampedRaise}
            onChange={(e) => changeRaise(Number(e.target.value))}
          />
          <div className="raise-quick">
            <button className="btn ghost small" onClick={() => changeRaise(minTo)}>
              Min
            </button>
            <button
              className="btn ghost small"
              onClick={() => changeRaise(Math.min(maxTo, view.currentBet + Math.floor(pot / 2)))}
            >
              ½ Pot
            </button>
            <button className="btn ghost small" onClick={() => changeRaise(Math.min(maxTo, view.currentBet + pot))}>
              Pot
            </button>
          </div>
          <button className="btn primary" onClick={() => api.action({ type: 'raise', to: clampedRaise })}>
            {view.currentBet === 0 ? 'Bet' : 'Raise'} {fmt(clampedRaise)}
          </button>
        </div>
      )}
      <button className="btn allin" onClick={() => api.action({ type: 'allin' })}>
        All-In {fmt(maxTo)}
      </button>
    </div>
  );
}

function ResultBanner({ view }: { view: PokerView }) {
  const result = view.handResult;
  if (!result) return null;
  return (
    <div className="hand-result">
      {result.pots.map((pot, i) => (
        <div key={i} className="hand-result-line">
          🏆{' '}
          {pot.winners
            .map((w) => `${view.players.find((p) => p.id === w.playerId)?.name ?? '?'} +${fmt(w.amount)}`)
            .join(' · ')}
          {pot.handName && <span className="hand-result-hand"> – {pot.handName}</span>}
          {result.pots.length > 1 && <span className="hint"> ({i === 0 ? 'Main Pot' : `Side Pot ${i}`})</span>}
        </div>
      ))}
    </div>
  );
}

function PokerGameOver({ view, onClose }: { view: PokerView; onClose: () => void }) {
  const me = useStore((s) => s.session);
  const winner = view.players.find((p) => p.id === view.winnerId);
  const ranking = [...view.players].sort((a, b) => b.chips - a.chips);
  const minutes = Math.max(1, Math.round((Date.now() - view.startedAt) / 60_000));
  const isHost = view.players.find((p) => p.id === me?.playerId)?.isHost;

  return (
    <Modal title="🏆 Partie beendet" onClose={onClose}>
      {winner && (
        <p className="winner-line">
          <span className="token big" style={{ background: winner.color }}>
            {winner.avatar}
          </span>{' '}
          <strong>{winner.name}</strong> gewinnt die Partie!
        </p>
      )}
      <p className="hint">
        {view.handNumber} Hände · {minutes} Minuten
        {view.players.some((p) => p.rebuys > 0) && ' · inkl. Rebuys'}
      </p>
      <ol className="ranking">
        {ranking.map((p) => (
          <li key={p.id}>
            <span style={{ color: p.color }}>
              {p.avatar} {p.name}
              {p.rebuys > 0 && <span className="hint"> ({p.rebuys}× Rebuy)</span>}
            </span>
            <span>{p.out && p.chips === 0 ? '💀 raus' : `${fmt(p.chips)} 🪙`}</span>
          </li>
        ))}
      </ol>
      <div className="btn-row">
        {isHost && (
          <button className="btn primary" onClick={() => api.rematch()}>
            🔁 Neue Runde (zurück zur Lobby)
          </button>
        )}
        <button className="btn" onClick={() => api.leaveRoom()}>
          🚪 Raum verlassen
        </button>
      </div>
    </Modal>
  );
}

export function PokerTable() {
  const room = useStore((s) => s.room)!;
  const view = useStore((s) => s.poker)!;
  const session = useStore((s) => s.session);
  const connected = useStore((s) => s.connected);
  const isLocalGame = useStore((s) => s.session?.mode === 'local');
  const addToast = useStore((s) => s.addToast);
  const [tab, setTab] = useState<'log' | 'chat'>('chat');
  const [resultDismissed, setResultDismissed] = useState(false);

  useEffect(() => {
    if (view.phase === 'ended') setResultDismissed(false);
  }, [view.phase]);

  const me = view.players.find((p) => p.id === session?.playerId);
  const isSpectator = !me;
  const peek = usePeek(me?.id, view.street);
  // Der aktive Sitz sitzt unten am Filz und zeigt dieselben echten Karten –
  // ohne diese Sperre wäre der Halten-Knopf wirkungslos.
  const hideOwnHole = isLocalGame && !peek.peeking;
  const seating = useStore((s) => s.seating);
  const fixedSeats = seating?.mode === 'fixed';
  const rotation = useSeatRotation();

  // Sitz-Anordnung: normalerweise „ich unten", Rest im Uhrzeigersinn.
  //
  // Bei festen Plätzen muss das entfallen: im lokalen Modus wechselt
  // `session.playerId` nach JEDER Aktion, der Kranz würde sich also ständig
  // sichtbar weiterdrehen, obwohl niemand aufsteht.
  const seats = useMemo(() => {
    const players = view.players;
    if (!me || fixedSeats) return players;
    const myIndex = players.findIndex((p) => p.id === me.id);
    return [...players.slice(myIndex), ...players.slice(0, myIndex)];
  }, [view.players, me, fixedSeats]);

  const pot = potTotal(view);
  const myHint = useMemo(() => {
    if (hideOwnHole) return null;
    if (!me?.hole || me.hole.some((c) => c < 0) || me.folded) return null;
    if (view.community.length < 3) return null;
    return handName(bestHand([...me.hole, ...view.community]));
  }, [me?.hole, me?.folded, view.community, hideOwnHole]);

  function copyCode() {
    navigator.clipboard
      ?.writeText(room.meta.code)
      .then(() => addToast('success', 'Code kopiert!'))
      .catch(() => addToast('info', `Raum-Code: ${room.meta.code}`));
  }

  const sideContent = (
    <>
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
    </>
  );

  return (
    <div className="game-table poker">
      <header className="game-header">
        <div className="game-title">
          <strong>🃏 {room.meta.name}</strong>
          <span className="hint">
            Hand {view.handNumber} · Blinds {fmt(view.smallBlind)}/{fmt(view.bigBlind)} · {streetLabel(view)}
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
          {me && !me.out && view.phase === 'playing' && (
            <button
              className="btn ghost small"
              title="Endgültig aufgeben"
              onClick={() => {
                if (window.confirm('Wirklich aufgeben? Deine Chips verlassen mit dir den Tisch.')) {
                  api.action({ type: 'resign' });
                }
              }}
            >
              🏳
            </button>
          )}
          <button
            className="btn ghost small"
            title={isLocalGame ? 'Partie beenden' : 'Raum verlassen'}
            onClick={() => {
              // Lokal gibt es kein Zurückkommen: der Spielstand liegt nur hier.
              const question = isLocalGame
                ? 'Partie beenden? Der lokale Spielstand geht dabei verloren.'
                : 'Raum verlassen? Du kannst mit deinem Namen wieder beitreten – abwesende Spieler folden automatisch.';
              if (isSpectator || view.phase !== 'playing' || (!isLocalGame && me?.out) || window.confirm(question)) {
                api.leaveRoom();
              }
            }}
          >
            🚪
          </button>
        </div>
      </header>

      <div className={`game-layout poker-layout ${fixedSeats ? 'at-table' : ''}`}>
        <main className="poker-area">
          {isSpectator && <div className="spectator-banner">👁 Du schaust zu</div>}
          {!fixedSeats && <TurnBanner />}
          <div className={`poker-felt ${fixedSeats ? 'fixed' : ''}`}>
            {seats.map((p, i) => (
              <Seat
                key={p.id}
                view={view}
                player={p}
                index={i}
                seatCount={seats.length}
                isMe={p.id === me?.id}
                result={view.street === 'showdown' ? view.handResult : null}
                hideHole={p.id === me?.id && hideOwnHole}
                edge={fixedSeats ? (seating?.edges[p.id] ?? 0) : null}
              />
            ))}
            <div className="felt-center">
              <div className="community">
                {view.community.map((c, i) => (
                  <PlayingCard key={i} card={c} size="md" />
                ))}
                {Array.from({ length: 5 - view.community.length }, (_, i) => (
                  <span key={`slot-${i}`} className="pcard slot md" aria-hidden />
                ))}
              </div>
              <div className="pot">
                Pot: <strong>{fmt(pot)}</strong> 🪙
              </div>
              {view.street === 'showdown' && <ResultBanner view={view} />}
            </div>
          </div>

          {me &&
            (fixedSeats ? (
              // Der Filz bleibt liegen, die Leiste kommt an die Kante dessen,
              // der handelt – und dreht sich zu ihm.
              <SeatDock edge={rotation} className="poker-dock">
                <HoleCards me={me} hint={myHint} local={isLocalGame} peek={peek} />
                <ActionBar view={view} me={me} />
              </SeatDock>
            ) : (
              <div className="my-bar">
                <HoleCards me={me} hint={myHint} local={isLocalGame} peek={peek} />
                <ActionBar view={view} me={me} />
              </div>
            ))}
        </main>

        {/* Am Tisch hinter einem Knopf statt in einer Spalte – die Fläche
            gehört dem Filz. */}
        {fixedSeats ? (
          <TableSideSheet>{sideContent}</TableSideSheet>
        ) : (
          <aside className="side right">{sideContent}</aside>
        )}
      </div>

      {!connected && !isLocalGame && (
        <div className="reconnect-overlay">
          <div className="reconnect-box">
            <span className="spinner" /> Verbindung unterbrochen – stelle wieder her …
          </div>
        </div>
      )}

      {view.phase === 'ended' && !resultDismissed && (
        <PokerGameOver view={view} onClose={() => setResultDismissed(true)} />
      )}
    </div>
  );
}
