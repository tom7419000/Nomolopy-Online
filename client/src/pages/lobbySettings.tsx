/**
 * Lobby-Einstellungen je Spiel.
 *
 * Lag früher in `Room.tsx` und wurde dort über `{game && …}{poker && …}`
 * eingehängt. Jetzt hängt es an `CLIENT_GAMES` – so meldet der Compiler ein
 * fehlendes Einstellungs-Panel, wenn ein Spiel dazukommt.
 */

import { RULE_FIELDS } from '@shared/rules';
import { POKER_LIMITS } from '@shared/poker/rules';
import { JEOPARDY_LIMITS } from '@shared/jeopardy/rules';
import { PURSUIT_LIMITS } from '@shared/pursuit/rules';
import type { PursuitRules } from '@shared/pursuit/types';
import { checkPack } from '@shared/trivia/types';
import type { RuleSet } from '@shared/types';
import type { PokerRules } from '@shared/poker/types';
import type { JeopardyRules } from '@shared/jeopardy/types';
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


export function JeopardySettings({ isHost }: { isHost: boolean }) {
  const view = useStore((s) => s.jeopardy)!;
  const packs = useStore((s) => s.packs);
  const openDialog = useStore((s) => s.openDialog);
  const rules = view.rules;

  function set<K extends keyof JeopardyRules>(key: K, value: JeopardyRules[K]) {
    api.configureLobby({ jeopardy: { [key]: value } });
  }

  const pack = packs.find((p) => p.id === rules.packId);
  const report = pack ? checkPack(pack) : null;

  const numberRow = (
    label: string,
    key: 'baseValue' | 'readSeconds' | 'buzzSeconds' | 'answerSeconds' | 'judgeSeconds'
  ) => (
    <label className="rule-row number">
      <span>{label}</span>
      <input
        type="number"
        className="input small"
        disabled={!isHost}
        min={JEOPARDY_LIMITS[key].min}
        max={JEOPARDY_LIMITS[key].max}
        step={JEOPARDY_LIMITS[key].step}
        value={rules[key]}
        onChange={(e) => set(key, Number(e.target.value))}
      />
    </label>
  );

  return (
    <>
      <label className="field">
        <span>Fragenpaket</span>
        <select
          className="input"
          disabled={!isHost}
          value={rules.packId}
          onChange={(e) => set('packId', e.target.value)}
        >
          {packs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.builtIn ? '' : ' (eigenes)'}
            </option>
          ))}
        </select>
      </label>
      {report && (
        <p className="hint">
          {report.total} Fragen
          {report.ok
            ? ' · alle 30 Fächer gefüllt'
            : ` · ⚠️ ${report.thin.length} Fächer zu dünn – damit lässt sich nicht starten`}
        </p>
      )}

      <div className="rules-list">
        {numberRow('Punkte für die erste Zeile', 'baseValue')}
        {numberRow('Vorlesezeit vor dem Buzzer (Sek.)', 'readSeconds')}
        {numberRow('Buzzer offen für … Sek.', 'buzzSeconds')}
        {numberRow('Bedenkzeit zum Antworten (Sek.)', 'answerSeconds')}
        {numberRow('Zeit zum Werten (Sek.)', 'judgeSeconds')}
        <label className="rule-row boolean">
          <span>Falsche Antwort kostet Punkte</span>
          <input
            type="checkbox"
            disabled={!isHost}
            checked={rules.penalty}
            onChange={(e) => set('penalty', e.target.checked)}
          />
        </label>
      </div>

      <p className="hint">
        🖥 Ein weiteres Gerät kann mit demselben Code beitreten und zeigt dann das
        Brett groß – die Spieler buzzern mit dem Handy.
      </p>

      {isHost && (
        <div className="lobby-actions">
          <button className="btn ghost" onClick={() => openDialog({ type: 'packs' })}>
            ✏️ Fragen bearbeiten
          </button>
        </div>
      )}
    </>
  );
}

export function PursuitSettings({ isHost }: { isHost: boolean }) {
  const view = useStore((s) => s.pursuit)!;
  const packs = useStore((s) => s.packs);
  const openDialog = useStore((s) => s.openDialog);
  const rules = view.rules;

  function set<K extends keyof PursuitRules>(key: K, value: PursuitRules[K]) {
    api.configureLobby({ pursuit: { [key]: value } });
  }

  const pack = packs.find((p) => p.id === rules.packId);
  const report = pack ? checkPack(pack) : null;

  const numberRow = (label: string, key: 'wedgesToWin' | 'answerSeconds' | 'judgeSeconds') => (
    <label className="rule-row number">
      <span>{label}</span>
      <input
        type="number"
        className="input small"
        disabled={!isHost}
        min={PURSUIT_LIMITS[key].min}
        max={PURSUIT_LIMITS[key].max}
        step={PURSUIT_LIMITS[key].step}
        value={rules[key]}
        onChange={(e) => set(key, Number(e.target.value))}
      />
    </label>
  );

  return (
    <>
      <label className="field">
        <span>Fragenpaket</span>
        <select
          className="input"
          disabled={!isHost}
          value={rules.packId}
          onChange={(e) => set('packId', e.target.value)}
        >
          {packs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.builtIn ? '' : ' (eigenes)'}
            </option>
          ))}
        </select>
      </label>
      {report && (
        <p className="hint">
          {report.total} Fragen
          {report.ok
            ? ' · alle Fächer haben genug verschiedene Antworten'
            : ` · ⚠️ ${report.thin.length} Fächer zu dünn für Multiple Choice`}
        </p>
      )}

      <div className="rules-list">
        {numberRow('Käsestücke zum Sieg', 'wedgesToWin')}
        {numberRow('Bedenkzeit zum Antworten (Sek.)', 'answerSeconds')}
        {numberRow('Zeit zum Werten bzw. Abstimmen (Sek.)', 'judgeSeconds')}
        <label className="rule-row number">
          <span>Schwierigkeit</span>
          <select
            className="input small"
            disabled={!isHost}
            value={rules.level}
            onChange={(e) => set('level', Number(e.target.value) as PursuitRules['level'])}
          >
            <option value={0}>gemischt</option>
            {[1, 2, 3, 4, 5].map((l) => (
              <option key={l} value={l}>
                Stufe {l}
              </option>
            ))}
          </select>
        </label>
        <label className="rule-row boolean">
          <span>Frei antworten statt ankreuzen</span>
          <input
            type="checkbox"
            disabled={!isHost}
            checked={rules.freeText}
            onChange={(e) => set('freeText', e.target.checked)}
          />
        </label>
        <label className="rule-row boolean">
          <span>Debug-Modus (Würfel manuell setzbar)</span>
          <input
            type="checkbox"
            disabled={!isHost}
            checked={rules.debugMode}
            onChange={(e) => set('debugMode', e.target.checked)}
          />
        </label>
      </div>

      <p className="hint">
        🖥 Ein weiteres Gerät kann mit demselben Code beitreten und zeigt dann das
        Rad groß – gewürfelt und geantwortet wird am Handy.
      </p>

      {isHost && (
        <div className="lobby-actions">
          <button className="btn ghost" onClick={() => openDialog({ type: 'packs' })}>
            ✏️ Fragen bearbeiten
          </button>
        </div>
      )}
    </>
  );
}
