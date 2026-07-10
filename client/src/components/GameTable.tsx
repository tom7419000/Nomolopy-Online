import { useEffect, useState } from 'react';
import { api } from '../net/socket';
import { useMe, useStore } from '../state/store';
import { Board } from './Board';
import { GameOverModal } from './Dialogs';
import { ActionsPanel, ChatPanel, LogPanel, PlayersPanel } from './Panels';

export function GameTable() {
  const game = useStore((s) => s.game)!;
  const connected = useStore((s) => s.connected);
  const openDialog = useStore((s) => s.openDialog);
  const addToast = useStore((s) => s.addToast);
  const me = useMe();
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
        <button className="room-code small" onClick={copyCode} title="Code kopieren">
          {game.id} ⧉
        </button>
        <div className={`conn-pill ${connected ? 'ok' : 'bad'}`}>
          <span className="dot" />
          {connected ? 'online' : 'offline'}
        </div>
        <div className="game-menu">
          {game.phase === 'ended' && resultDismissed && (
            <button className="btn small" onClick={() => setResultDismissed(false)}>
              🏆 Ergebnis
            </button>
          )}
          {me?.isHost && game.phase !== 'lobby' && (
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
          <button className="btn ghost small" title="Spielstände" onClick={() => openDialog({ type: 'saves' })}>
            📂
          </button>
          <button className="btn ghost small" title="Admin-Panel" onClick={() => openDialog({ type: 'admin' })}>
            ⚙️
          </button>
          <button className="btn ghost small" title="Debug / Spielzustand" onClick={() => openDialog({ type: 'debug' })}>
            🐞
          </button>
          <button
            className="btn ghost small"
            title="Raum verlassen"
            onClick={() => {
              if (
                game.phase !== 'playing' ||
                me?.bankrupt ||
                window.confirm('Raum verlassen? Du kannst mit deinem Namen wieder beitreten.')
              ) {
                api.leaveRoom();
              }
            }}
          >
            🚪
          </button>
        </div>
      </header>

      <div className="game-layout">
        <aside className="side left">
          <PlayersPanel />
        </aside>

        <main className="board-area">
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
