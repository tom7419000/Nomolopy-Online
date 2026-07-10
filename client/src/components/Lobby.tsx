import { useState } from 'react';
import type { RuleSet } from '@shared/types';
import { RULE_FIELDS } from '@shared/rules';
import { MIN_PLAYERS } from '@shared/util';
import { api } from '../net/socket';
import { useMe, useStore } from '../state/store';
import { ChatPanel } from './Panels';

export function Lobby() {
  const game = useStore((s) => s.game)!;
  const editions = useStore((s) => s.editions);
  const presets = useStore((s) => s.presets);
  const openDialog = useStore((s) => s.openDialog);
  const addToast = useStore((s) => s.addToast);
  const me = useMe();
  const isHost = me?.isHost ?? false;
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    await api.startGame();
    setBusy(false);
  }

  function copyCode() {
    navigator.clipboard
      ?.writeText(game.id)
      .then(() => addToast('success', 'Code kopiert!'))
      .catch(() => addToast('info', `Raum-Code: ${game.id}`));
  }

  function setRule(key: keyof RuleSet, value: number | boolean) {
    api.configureLobby({ rules: { [key]: value } });
  }

  const canStart = game.players.length >= MIN_PLAYERS;

  return (
    <div className="lobby">
      <header className="lobby-header">
        <h1>Lobby</h1>
        <button className="room-code" onClick={copyCode} title="Code kopieren">
          Raum-Code: <strong>{game.id}</strong> ⧉
        </button>
      </header>

      <div className="lobby-grid">
        <section className="panel">
          <h2>
            Spieler ({game.players.length}/8)
            {!canStart && <span className="hint"> – mindestens {MIN_PLAYERS} nötig</span>}
          </h2>
          <ul className="lobby-players">
            {game.players.map((p) => (
              <li key={p.id} style={{ borderLeftColor: p.color }}>
                <span className="token" aria-hidden>
                  {p.token}
                </span>
                <span className="name">
                  {p.name}
                  {p.isHost && <span className="badge">HOST</span>}
                  {p.id === me?.id && <span className="badge you">DU</span>}
                </span>
                <span className="color-chip" style={{ background: p.color }} title="Spielerfarbe" />
                {p.id === me?.id && (
                  <button
                    className="btn ghost small"
                    onClick={() => api.rerollAppearance()}
                    title="Farbe und Figur neu auslosen"
                  >
                    🎲 Neu losen
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p className="hint">
            Farben und Figuren werden automatisch zufällig vergeben – mit „Neu losen“ bekommst du
            eine andere Kombination.
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
        </section>

        <section className="panel lobby-chat">
          <h2>Chat</h2>
          <ChatPanel />
        </section>
      </div>

      <button className="btn ghost leave" onClick={() => api.leaveRoom()}>
        ← Lobby verlassen
      </button>
    </div>
  );
}
