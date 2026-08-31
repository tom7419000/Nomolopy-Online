import { useEffect, useState } from 'react';
import type { GameState } from '@shared/types';
import { api } from '../../net';
import { money } from '../../ui/format';
import { useMe, useSeatRotation, useStore } from '../../state/store';
import { Board, DicePair } from './Board';
import { SeatDock, TableSideSheet } from '../../components/SeatDock';
import { TurnBanner } from '../../components/TurnBanner';
import { GameOverModal } from './Dialogs';
import { ActionsPanel, ChatPanel, LogPanel, PlayersPanel } from './Panels';

/**
 * Eine Zeile mit dem Geld aller Mitspieler.
 *
 * Im Tischmodus gibt es keine Spielerspalte mehr – und vier gedrehte
 * Spielerkarten an vier Kanten kämen sich mit dem Dock ins Gehege. Wer dran
 * ist, sieht die Zahlen hier, gedreht zu sich.
 */
function MoneyStrip({ game }: { game: GameState }) {
  return (
    <ul className="dock-money">
      {game.players.map((p) => (
        <li key={p.id} className={p.bankrupt ? 'out' : ''}>
          <span className="dock-money-token" aria-hidden>
            {p.token}
          </span>
          <span className="dock-money-name" style={{ color: p.color }}>
            {p.name}
          </span>
          <strong>{p.bankrupt ? '—' : money(game, p.money)}</strong>
        </li>
      ))}
    </ul>
  );
}

export function GameTable() {
  const game = useStore((s) => s.game)!;
  const connected = useStore((s) => s.connected);
  const isLocalGame = useStore((s) => s.session?.mode === 'local');
  const openDialog = useStore((s) => s.openDialog);
  const addToast = useStore((s) => s.addToast);
  const me = useMe();
  // Tischmodus: feste Plätze, Gerät liegt in der Mitte. Nur dann wandert die
  // Bedienung an die Kante – online und beim Weiterreichen bleibt alles, wie
  // es ist.
  const tableMode = useStore((s) => s.seating?.mode === 'fixed');
  const edge = useSeatRotation();
  const [tab, setTab] = useState<'log' | 'chat'>('log');
  const [resultDismissed, setResultDismissed] = useState(false);
  const [unreadChat, setUnreadChat] = useState(0);
  const [lastChatCount, setLastChatCount] = useState(game.chat.length);

  useEffect(() => {
    if (game.phase === 'ended') setResultDismissed(false);
  }, [game.phase]);

  useEffect(() => {
    if (game.chat.length > lastChatCount && tab !== 'chat') {
      setUnreadChat((u) => u + (game.chat.length - lastChatCount));
    }
    setLastChatCount(game.chat.length);
  }, [game.chat.length, lastChatCount, tab]);

  const lastLog = game.log.length ? game.log[game.log.length - 1] : null;

  function copyCode() {
    navigator.clipboard
      ?.writeText(game.id)
      .then(() => addToast('success', 'Code kopiert!'))
      .catch(() => addToast('info', `Raum-Code: ${game.id}`));
  }

  return (
    <div className="game-table">
      <header className="game-header">
        <div className="game-title">
          <strong>Nomolopy</strong>
          <span className="hint">{game.edition.name}</span>
        </div>
        {isLocalGame ? (
          <div className="conn-pill local">
            <span className="dot" /> am Gerät
          </div>
        ) : (
          <>
            <button className="room-code small" onClick={copyCode} title="Code kopieren">
              {game.id} ⧉
            </button>
            <div className={`conn-pill ${connected ? 'ok' : 'bad'}`}>
              <span className="dot" />
              {connected ? 'online' : 'offline'}
            </div>
          </>
        )}
        <div className="game-menu">
          {game.phase === 'ended' && resultDismissed && (
            <button className="btn small" onClick={() => setResultDismissed(false)}>
              🏆 Ergebnis
            </button>
          )}
          {!isLocalGame && me?.isHost && game.phase !== 'lobby' && (
            <button
              className="btn ghost small"
              title="Spielstand speichern"
              onClick={async () => {
                const r = await api.saveGame();
                if (r.ok) addToast('success', 'Spielstand gespeichert.');
              }}
            >
              💾
            </button>
          )}
          {!isLocalGame && (
            <>
              <button className="btn ghost small" title="Spielstände" onClick={() => openDialog({ type: 'saves' })}>
                📂
              </button>
              <button className="btn ghost small" title="Admin-Panel" onClick={() => openDialog({ type: 'admin' })}>
                ⚙️
              </button>
            </>
          )}
          <button className="btn ghost small" title="Debug / Spielzustand" onClick={() => openDialog({ type: 'debug' })}>
            🐞
          </button>
          <button
            className="btn ghost small"
            title={isLocalGame ? 'Partie beenden' : 'Raum verlassen'}
            onClick={() => {
              // Lokal gibt es kein Zurückkommen: der Spielstand liegt nur hier.
              const question = isLocalGame
                ? 'Partie beenden? Der lokale Spielstand geht dabei verloren.'
                : 'Raum verlassen? Du kannst mit deinem Namen wieder beitreten.';
              if (game.phase !== 'playing' || (!isLocalGame && me?.bankrupt) || window.confirm(question)) {
                api.leaveRoom();
              }
            }}
          >
            🚪
          </button>
        </div>
      </header>

      {tableMode ? (
        <div className="table-mode">
          <Board game={game} tableMode />
          {/* Alles, womit der Spieler hantiert, an seiner Kante – gedreht. */}
          <SeatDock edge={edge}>
            <div className="dock-head">
              <DicePair dice={game.dice} />
              <MoneyStrip game={game} />
            </div>
            <ActionsPanel />
            {lastLog && <p className="dock-lastlog">{lastLog.text}</p>}
          </SeatDock>
          <TableSideSheet title="Verlauf, Chat und Spieler">
            <PlayersPanel />
            <div className="tabs">
              <button className={`tab ${tab === 'log' ? 'active' : ''}`} onClick={() => setTab('log')}>
                📜 Verlauf
              </button>
              <button className={`tab ${tab === 'chat' ? 'active' : ''}`} onClick={() => setTab('chat')}>
                💬 Chat
              </button>
            </div>
            <div className="tab-content">{tab === 'log' ? <LogPanel /> : <ChatPanel />}</div>
          </TableSideSheet>
        </div>
      ) : (
        <div className="game-layout">
          <aside className="side left">
            <PlayersPanel />
          </aside>

          <main className="board-area">
            <TurnBanner />
            <Board game={game} />
          </main>

          <aside className="side right">
            <ActionsPanel />
            <div className="tabs">
              <button className={`tab ${tab === 'log' ? 'active' : ''}`} onClick={() => setTab('log')}>
                📜 Verlauf
              </button>
              <button
                className={`tab ${tab === 'chat' ? 'active' : ''}`}
                onClick={() => {
                  setTab('chat');
                  setUnreadChat(0);
                }}
              >
                💬 Chat{unreadChat > 0 && <span className="unread">{unreadChat}</span>}
              </button>
            </div>
            <div className="tab-content">{tab === 'log' ? <LogPanel /> : <ChatPanel />}</div>
          </aside>
        </div>
      )}


      {!connected && (
        <div className="reconnect-overlay">
          <div className="reconnect-box">
            <span className="spinner" /> Verbindung unterbrochen – stelle wieder her …
          </div>
        </div>
      )}

      {game.phase === 'ended' && !resultDismissed && (
        <GameOverModal game={game} onClose={() => setResultDismissed(true)} />
      )}
    </div>
  );
}
