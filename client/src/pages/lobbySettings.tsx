/**
 * Lobby-Einstellungen je Spiel.
 *
 * Lag früher in `Room.tsx` und wurde dort über `{game && …}{poker && …}`
 * eingehängt. Jetzt hängt es an `CLIENT_GAMES` – so meldet der Compiler ein
 * fehlendes Einstellungs-Panel, wenn ein Spiel dazukommt.
 */

import { RULE_FIELDS } from '@shared/rules';
import { POKER_LIMITS } from '@shared/poker/rules';
import type { RuleSet } from '@shared/types';
import type { PokerRules } from '@shared/poker/types';
import { api } from '../net';
import { useStore } from '../state/store';

export function MonopolySettings({ isHost }: { isHost: boolean }) {
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

export function PokerSettings({ isHost }: { isHost: boolean }) {
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

