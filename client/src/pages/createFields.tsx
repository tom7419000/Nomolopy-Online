/**
 * Felder beim Anlegen einer Partie, je Spiel.
 *
 * Dieselben Felder braucht der Online-Dialog „Raum erstellen" (Home) und das
 * lokale Setup – vorher standen sie doppelt da, jeweils hinter einem
 * `{gameId === '…' && …}`. Über `CLIENT_GAMES` gibt es sie nur noch einmal,
 * und ein neues Spiel kann sie nicht vergessen.
 */

import { BUILT_IN_EDITIONS } from '@shared/boards';
import { RULE_PRESETS } from '@shared/rules';
import { POKER_LIMITS } from '@shared/poker/rules';
import type { PokerRules } from '@shared/poker/types';
import { useStore } from '../state/store';
import type { CreateFieldsProps } from '../games/registry';

export function MonopolyCreateFields({
  editionId,
  setEditionId,
  presetId,
  setPresetId,
  local,
}: CreateFieldsProps) {
  // Online kommen eigene Editionen vom Server; lokal gibt es nur die
  // eingebauten – der Katalog wird ohne Verbindung nicht geliefert.
  const fromServer = useStore((s) => s.editions);
  const editions = local || fromServer.length === 0 ? BUILT_IN_EDITIONS : fromServer;
  const serverPresets = useStore((s) => s.presets);
  const presets = local || serverPresets.length === 0 ? RULE_PRESETS : serverPresets;

  const edition = editions.find((e) => e.id === editionId);
  const preset = presets.find((p) => p.id === presetId);

  return (
    <>
      <label className="field">
        <span>Edition</span>
        <select className="input" value={editionId} onChange={(e) => setEditionId(e.target.value)}>
          {editions.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
              {'builtIn' in e && !e.builtIn ? ' (eigene)' : ''}
            </option>
          ))}
        </select>
      </label>
      {edition?.description && <p className="hint">{edition.description}</p>}
      <label className="field">
        <span>Regel-Preset</span>
        <select className="input" value={presetId} onChange={(e) => setPresetId(e.target.value)}>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      {preset && <p className="hint">{preset.description}</p>}
    </>
  );
}

export function PokerCreateFields({ poker, setPoker, local }: CreateFieldsProps) {
  const rules = poker as unknown as PokerRules;
  const set = (patch: Partial<PokerRules>) =>
    setPoker({ ...rules, ...patch } as unknown as Record<string, unknown>);

  return (
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
            value={rules.buyIn}
            onChange={(e) => set({ buyIn: Number(e.target.value) })}
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
            value={rules.smallBlind}
            onChange={(e) => set({ smallBlind: Number(e.target.value) })}
          />
        </label>
      </div>

      {!local && (
        <div className="field-row">
          <label className="field">
            <span>Blinds erhöhen (min, 0 = nie)</span>
            <input
              type="number"
              className="input small"
              min={POKER_LIMITS.blindIncreaseMinutes.min}
              max={POKER_LIMITS.blindIncreaseMinutes.max}
              step={POKER_LIMITS.blindIncreaseMinutes.step}
              value={rules.blindIncreaseMinutes}
              onChange={(e) => set({ blindIncreaseMinutes: Number(e.target.value) })}
            />
          </label>
          <label className="field">
            <span>Bedenkzeit (Sek.)</span>
            <input
              type="number"
              className="input small"
              min={POKER_LIMITS.actionTimeoutSec.min}
              max={POKER_LIMITS.actionTimeoutSec.max}
              step={POKER_LIMITS.actionTimeoutSec.step}
              value={rules.actionTimeoutSec}
              onChange={(e) => set({ actionTimeoutSec: Number(e.target.value) })}
            />
          </label>
        </div>
      )}

      <label className="rule-row boolean">
        <span>Rebuy erlaubt (Pleite-Spieler kaufen sich neu ein)</span>
        <input
          type="checkbox"
          checked={rules.allowRebuy}
          onChange={(e) => set({ allowRebuy: e.target.checked })}
        />
      </label>

      {local && (
        <>
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
    </>
  );
}
