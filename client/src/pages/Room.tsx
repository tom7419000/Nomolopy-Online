/**
 * Wartezimmer eines Raums: Spieler, spielspezifische Einstellungen,
 * Chat und teilbarer Einladungs-Link. Von hier startet der Host das Spiel.
 */

import { useState } from 'react';
import { getGameInfo } from '@shared/games';
import { moduleFor } from '@shared/registry';
import { api } from '../net';
import { useStore } from '../state/store';
import { Chat } from '../components/Chat';
import { CLIENT_GAMES } from '../games/registry';
import { roomLink } from '../hooks/useHashRoute';

function ShareRow({ code }: { code: string }) {
  const addToast = useStore((s) => s.addToast);
  const link = roomLink(code);

  function copy(text: string, label: string) {
    navigator.clipboard
      ?.writeText(text)
      .then(() => addToast('success', `${label} kopiert!`))
      .catch(() => addToast('info', text));
  }

  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'PlayHub – spiel mit!', url: link });
        return;
      } catch {
        // abgebrochen → nichts tun
      }
    } else {
      copy(link, 'Link');
    }
  }

  return (
    <div className="share-row">
      <button className="room-code" onClick={() => copy(code, 'Code')} title="Code kopieren">
        Code: <strong>{code}</strong> ⧉
      </button>
      <button className="btn" onClick={() => copy(link, 'Link')} title={link}>
        🔗 Link kopieren
      </button>
      <button className="btn ghost" onClick={share}>
        📤 Teilen
      </button>
    </div>
  );
}

export function RoomPage() {
  const room = useStore((s) => s.room)!;
  const LobbySettings = CLIENT_GAMES[room.meta.gameId].LobbySettings;
  const game = useStore((s) => s.game);
  const session = useStore((s) => s.session);
  const [busy, setBusy] = useState(false);

  const info = getGameInfo(room.meta.gameId);
  // Sitze und Chat kommen aus dem Modul. Die frühere `game ?? poker`-Kette
  // hätte bei einem neuen Spiel stumm eine leere Lobby gezeigt.
  const state = room[room.meta.gameId];
  const players = state ? moduleFor(room.meta.gameId).seats(state) : [];
  const me = players.find((p) => p.id === session?.playerId);
  const isHost = me?.isHost ?? false;
  const chat = state ? moduleFor(room.meta.gameId).messages(state) : [];
  const minPlayers = info.minPlayers;
  const canStart = players.length >= minPlayers;

  async function start() {
    setBusy(true);
    await api.startGame();
    setBusy(false);
  }

  return (
    <div className="lobby">
      <header className="lobby-header">
        <h1>
          <span aria-hidden>{info.emoji}</span> {room.meta.name}
          <span className="lobby-game-badge">{info.name}</span>
        </h1>
        <ShareRow code={room.meta.code} />
      </header>
      {room.meta.description && <p className="room-desc">{room.meta.description}</p>}

      <div className="lobby-grid">
        <section className="panel">
          <h2>
            Spieler ({players.length}/{room.meta.maxPlayers})
            {!canStart && <span className="hint"> – mindestens {minPlayers} nötig</span>}
          </h2>
          <ul className="lobby-players">
            {players.map((p) => (
              <li key={p.id} style={{ borderLeftColor: p.color }}>
                <span className="token" aria-hidden>
                  {p.avatar}
                </span>
                <span className="name">
                  {p.name}
                  {p.isHost && <span className="badge">HOST</span>}
                  {p.id === me?.id && <span className="badge you">DU</span>}
                </span>
                <span className="color-chip" style={{ background: p.color }} title="Spielerfarbe" />
                {p.id === me?.id && game && (
                  <button
                    className="btn ghost small"
                    onClick={() => api.rerollAppearance()}
                    title="Farbe und Figur neu auslosen"
                  >
                    🎲 Neu losen
                  </button>
                )}
                {isHost && p.id !== me?.id && (
                  <button
                    className="btn ghost small danger"
                    title="Spieler entfernen"
                    onClick={() => {
                      if (window.confirm(`${p.name} aus dem Raum entfernen?`)) api.kick(p.id);
                    }}
                  >
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>
          {room.spectators.length > 0 && (
            <p className="hint">👁 Zuschauer: {room.spectators.map((s) => s.name).join(', ')}</p>
          )}
          <p className="hint">
            Lade Freunde mit dem Link oben ein – sie landen direkt in diesem Raum.
          </p>
          {isHost && (
            <button className="btn primary big" disabled={!canStart || busy} onClick={start}>
              ▶ Spiel starten
            </button>
          )}
          {!isHost && <p className="hint">Warte, bis der Host das Spiel startet …</p>}
        </section>

        <section className="panel">
          <h2>Einstellungen {isHost ? '' : '(nur Host)'}</h2>
          {isHost && (
            <div className="room-meta-settings">
              <label className="field">
                <span>Raumname</span>
                <input
                  className="input"
                  maxLength={40}
                  defaultValue={room.meta.name}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== room.meta.name) api.configureLobby({ roomName: v });
                  }}
                />
              </label>
              <div className="field-row">
                <label className="rule-row boolean grow">
                  <span>Öffentlich sichtbar</span>
                  <input
                    type="checkbox"
                    checked={room.meta.isPublic}
                    onChange={(e) => api.configureLobby({ isPublic: e.target.checked })}
                  />
                </label>
                <label className="field">
                  <span>Max. Spieler</span>
                  <input
                    type="number"
                    className="input small"
                    min={info.minPlayers}
                    max={info.maxPlayers}
                    value={room.meta.maxPlayers}
                    onChange={(e) => api.configureLobby({ maxPlayers: Number(e.target.value) })}
                  />
                </label>
              </div>
            </div>
          )}
          <LobbySettings isHost={isHost} />
        </section>

        <section className="panel lobby-chat">
          <h2>Chat</h2>
          <Chat
            messages={chat.map((m) => ({ ...m, mine: m.playerId === session?.playerId }))}
            onSend={(t) => api.chat(t)}
          />
        </section>
      </div>

      <button className="btn ghost leave" onClick={() => api.leaveRoom()}>
        ← Raum verlassen
      </button>
    </div>
  );
}
