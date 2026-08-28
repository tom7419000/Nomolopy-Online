/**
 * Setup für eine Partie am gemeinsamen Gerät.
 *
 * Bewusst kein Wartezimmer: es gibt niemanden, auf den man warten müsste.
 * Namen eintragen, Regeln wählen, los.
 */

import { useState } from 'react';
import { getGameInfo, type GameId } from '@shared/games';
import { BUILT_IN_EDITIONS } from '@shared/boards';
import { RULE_PRESETS } from '@shared/rules';
import { DEFAULT_POKER_RULES, POKER_LIMITS } from '@shared/poker/rules';
import type { PokerRules } from '@shared/poker/types';
import { PLAYER_COLORS } from '@shared/util';
import { startLocalGame } from '../net';
import { loadName, saveName, useStore } from '../state/store';
import { Modal } from '../components/Modal';

export function LocalSetup({ gameId, onClose }: { gameId: GameId; onClose: () => void }) {
  const info = getGameInfo(gameId);
  const addToast = useStore((s) => s.addToast);

  const [names, setNames] = useState<string[]>(() => [loadName() || 'Spieler 1', 'Spieler 2']);
  const [editionId, setEditionId] = useState(BUILT_IN_EDITIONS[0]?.id ?? 'classic-de');
  const [presetId, setPresetId] = useState('classic');
  const [poker, setPoker] = useState<PokerRules>({
    ...DEFAULT_POKER_RULES,
    blindIncreaseMinutes: 0,
  });

  const edition = BUILT_IN_EDITIONS.find((e) => e.id === editionId);
  const preset = RULE_PRESETS.find((p) => p.id === presetId);

  function setName(i: number, value: string) {
    setNames((prev) => prev.map((n, idx) => (idx === i ? value : n)));
  }

  function addRow() {
    setNames((prev) => [...prev, `Spieler ${prev.length + 1}`]);
  }

  function removeRow(i: number) {
    setNames((prev) => prev.filter((_, idx) => idx !== i));
  }

  function start() {
    const cleaned = names.map((n) => n.trim());

    if (cleaned.some((n) => !n)) {
      return addToast('error', 'Bitte für jeden Sitz einen Namen eintragen.');
    }
    const lower = cleaned.map((n) => n.toLowerCase());
    if (new Set(lower).size !== lower.length) {
      return addToast('error', 'Zwei Spieler heißen gleich – am selben Gerät wird das verwirrend.');
    }
    if (cleaned.length < info.minPlayers) {
      return addToast('error', `${info.name} braucht mindestens ${info.minPlayers} Spieler.`);
    }

    // Der erste Name ist typischerweise der Gerätebesitzer – für die Online-
    // Startseite merken.
    saveName(cleaned[0]);

    const r = startLocalGame({
      gameId,
      players: cleaned,
      roomName: `${cleaned[0]}s ${info.name}-Runde`,
      editionId,
      presetId,
      pokerRules: gameId === 'poker' ? poker : undefined,
    });
    if (r.ok) onClose();
  }

  return (
    <Modal title={`📱 ${info.name} an einem Gerät`} onClose={onClose}>
      <p className="hint">
        Alle spielen abwechselnd an diesem Gerät. Es wird nichts über das Internet
        übertragen – die Partie läuft auch im Flugmodus.
      </p>

      <h3 className="setup-title">Spieler ({names.length})</h3>
      <ul className="seat-setup">
        {names.map((n, i) => (
          <li key={i}>
            <span className="seat-dot" style={{ background: PLAYER_COLORS[i % PLAYER_COLORS.length] }} aria-hidden />
            <input
              className="input"
              maxLength={20}
              value={n}
              onChange={(e) => setName(i, e.target.value)}
              aria-label={`Name Spieler ${i + 1}`}
            />
            <button
              className="btn ghost small"
              onClick={() => removeRow(i)}
              disabled={names.length <= info.minPlayers}
              aria-label={`Spieler ${i + 1} entfernen`}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>

      {names.length < info.maxPlayers && (
        <button className="btn ghost" onClick={addRow}>
          ➕ Spieler hinzufügen
        </button>
      )}

      {gameId === 'monopoly' && (
        <>
          <label className="field">
            <span>Edition</span>
            <select className="input" value={editionId} onChange={(e) => setEditionId(e.target.value)}>
              {BUILT_IN_EDITIONS.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
          {edition?.description && <p className="hint">{edition.description}</p>}
          <label className="field">
            <span>Regel-Preset</span>
            <select className="input" value={presetId} onChange={(e) => setPresetId(e.target.value)}>
              {RULE_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {preset && <p className="hint">{preset.description}</p>}
        </>
      )}

      {gameId === 'poker' && (
        <>
          <div className="field-row">
            <label className="field">
              <span>Buy-in (Chips)</span>
              <input
                type="number"
                className="input small"
                min={POKER_LIMITS.buyIn.min}
                max={POKER_LIMITS.buyIn.max}
                step={POKER_LIMITS.buyIn.step}
                value={poker.buyIn}
                onChange={(e) => setPoker({ ...poker, buyIn: Number(e.target.value) })}
              />
            </label>
            <label className="field">
              <span>Small Blind</span>
              <input
                type="number"
                className="input small"
                min={POKER_LIMITS.smallBlind.min}
                max={POKER_LIMITS.smallBlind.max}
                step={POKER_LIMITS.smallBlind.step}
                value={poker.smallBlind}
                onChange={(e) => setPoker({ ...poker, smallBlind: Number(e.target.value) })}
              />
            </label>
          </div>
          <label className="rule-row boolean">
            <span>Rebuy erlaubt (Pleite-Spieler kaufen sich neu ein)</span>
            <input
              type="checkbox"
              checked={poker.allowRebuy}
              onChange={(e) => setPoker({ ...poker, allowRebuy: e.target.checked })}
            />
          </label>
          <p className="hint">
            🔍 Die Handkarten bleiben verdeckt. Wer dran ist, hält den Knopf
            „Karten ansehen" gedrückt – loslassen deckt sie wieder zu.
          </p>
          <p className="hint">
            Eine Bedenkzeit gibt es hier nicht: Am gemeinsamen Gerät wäre ein
            Auto-Fold beim Weiterreichen die falsche Strafe.
          </p>
        </>
      )}

      <button className="btn primary big" onClick={start}>
        {info.emoji} Spiel starten
      </button>
    </Modal>
  );
}
