/**
 * Wartezimmer eines Raums: Spieler, spielspezifische Einstellungen,
 * Chat und teilbarer Einladungs-Link. Von hier startet der Host das Spiel.
 */

import { useState } from 'react';
import type { RuleSet } from '@shared/types';
import { RULE_FIELDS } from '@shared/rules';
import { getGameInfo } from '@shared/games';
import { POKER_LIMITS } from '@shared/poker/rules';
import type { PokerRules } from '@shared/poker/types';
import { api } from '../net/socket';
import { useStore } from '../state/store';
import { Chat } from '../components/Chat';
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

function MonopolySettings({ isHost }: { isHost: boolean }) {
  const game = useStore((s) => s.game)!;
  const editions = useStore((s) => s.editions);
  const presets = useStore((s) => s.presets);
  const openDialog = useStore((s) => s.openDialog);

  function setRule(key: keyof RuleSet, value: number | boolean) {
    api.configureLobby({ rules: { [key]: value } });
  }

  return (
    <>
      <label className="field">
        <span>Edition</span>
        <select
          className="input"
          disabled={!isHost}
          value={game.edition.id}
          onChange={(e) => api.configureLobby({ editionId: e.target.value })}
        >
          {editions.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
              {e.builtIn ? '' : ' (eigene)'}
            </option>
          ))}
        </select>
      </label>
      <div className="edition-preview" aria-hidden>
        {Object.values(game.edition.groupColors).map((c, i) => (
          <span key={i} style={{ background: c }} />
        ))}
      </div>
      <label className="field">
        <span>Regel-Preset</span>
        <select
          className="input"
          disabled={!isHost}
          value={game.presetId}
          onChange={(e) => api.configureLobby({ presetId: e.target.value })}
        >
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <div className="rules-list">
        {RULE_FIELDS.map((f) => (
          <label key={f.key} className={`rule-row ${f.kind}`}>
            <span>{f.label}</span>
            {f.kind === 'boolean' ? (
              <input
                type="checkbox"
                disabled={!isHost}
                checked={Boolean(game.rules[f.key])}
                onChange={(e) => setRule(f.key, e.target.checked)}
              />
            ) : (
              <input
                type="number"
                className="input small"
                disabled={!isHost}
                min={f.min}
                max={f.max}
                step={f.step}
                value={Number(game.rules[f.key])}
                onChange={(e) => setRule(f.key, Number(e.target.value))}
              />
            )}
          </label>
        ))}
      </div>

      {isHost && (
        <div className="lobby-actions">
          <button className="btn ghost" onClick={() => openDialog({ type: 'saves' })}>
            📂 Spielstand laden
          </button>
          <button className="btn ghost" onClick={() => openDialog({ type: 'admin' })}>
            ⚙️ Admin-Panel
          </button>
        </div>
      )}
    </>
  );
}

function PokerSettings({ isHost }: { isHost: boolean }) {
  const poker = useStore((s) => s.poker)!;
  const rules = poker.rules;

  function set<K extends keyof PokerRules>(key: K, value: PokerRules[K]) {
    api.configureLobby({ poker: { [key]: value } });
  }

  const numberRow = (
    label: string,
    key: 'buyIn' | 'smallBlind' | 'blindIncreaseMinutes' | 'actionTimeoutSec',
    hint?: string
  ) => (
    <label className="rule-row number" title={hint}>
      <span>{label}</span>
      <input
        type="number"
        className="input small"
        disabled={!isHost}
        min={POKER_LIMITS[key].min}
        max={POKER_LIMITS[key].max}
        step={POKER_LIMITS[key].step}
        value={rules[key]}
        onChange={(e) => set(key, Number(e.target.value))}
      />
    </label>
  );

  return (
    <div className="rules-list">
      {numberRow('Buy-in (Chips)', 'buyIn')}
      {numberRow('Small Blind', 'smallBlind')}
      {numberRow('Blinds erhöhen alle … min (0 = nie)', 'blindIncreaseMinutes')}
      {numberRow('Bedenkzeit pro Aktion (Sek.)', 'actionTimeoutSec')}
      <label className="rule-row boolean">
        <span>Rebuy erlaubt</span>
        <input
          type="checkbox"
          disabled={!isHost}
          checked={rules.allowRebuy}
          onChange={(e) => set('allowRebuy', e.target.checked)}
        />
      </label>
      <p className="hint">
        Blinds starten bei {rules.smallBlind}/{rules.smallBlind * 2} und verdoppeln sich pro Stufe.
        Wer nicht rechtzeitig handelt, checkt bzw. foldet automatisch.
      </p>
    </div>
  );
}

export function RoomPage() {
  const room = useStore((s) => s.room)!;
  const game = useStore((s) => s.game);
  const poker = useStore((s) => s.poker);
  const session = useStore((s) => s.session);
  const [busy, setBusy] = useState(false);

  const info = getGameInfo(room.meta.gameId);
  const players = (game?.players ?? poker?.players ?? []) as {
    id: string;
    name: string;
    color: string;
    isHost: boolean;
    connected: boolean;
    token?: string;
    avatar?: string;
  }[];
  const me = players.find((p) => p.id === session?.playerId);
  const isHost = me?.isHost ?? false;
  const chat = game?.chat ?? poker?.chat ?? [];
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
                  {p.token ?? p.avatar}
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
          {game && <MonopolySettings isHost={isHost} />}
          {poker && <PokerSettings isHost={isHost} />}
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
