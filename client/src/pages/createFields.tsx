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
import { JEOPARDY_LIMITS } from '@shared/jeopardy/rules';
import type { JeopardyRules } from '@shared/jeopardy/types';
import { PURSUIT_LIMITS } from '@shared/pursuit/rules';
import type { PursuitRules } from '@shared/pursuit/types';
import { checkPack } from '@shared/trivia/types';
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

export function JeopardyCreateFields({ jeopardy, setJeopardy, local }: CreateFieldsProps) {
  const rules = jeopardy as unknown as JeopardyRules;
  const set = (patch: Partial<JeopardyRules>) =>
    setJeopardy({ ...rules, ...patch } as unknown as Record<string, unknown>);

  // Online kommen eigene Pakete vom Server, lokal aus dem Browser-Speicher.
  // Der Store hält beides unter demselben Feld.
  const packs = useStore((s) => s.packs);
  const pack = packs.find((p) => p.id === rules.packId) ?? packs[0];
  const report = pack ? checkPack(pack) : null;

  return (
    <>
      <label className="field">
        <span>Fragenpaket</span>
        <select
          className="input"
          value={pack?.id ?? ''}
          onChange={(e) => set({ packId: e.target.value })}
        >
          {packs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.builtIn ? '' : ' (eigenes)'}
            </option>
          ))}
        </select>
      </label>
      {pack && (
        <p className="hint">
          {pack.description ? `${pack.description} · ` : ''}
          {report?.total ?? 0} Fragen
          {report && !report.ok && ' · ⚠️ noch nicht vollständig, so lässt sich nicht starten'}
        </p>
      )}

      <div className="field-row">
        <label className="field">
          <span>Punkte für die erste Zeile</span>
          <input
            type="number"
            className="input small"
            min={JEOPARDY_LIMITS.baseValue.min}
            max={JEOPARDY_LIMITS.baseValue.max}
            step={JEOPARDY_LIMITS.baseValue.step}
            value={rules.baseValue}
            onChange={(e) => set({ baseValue: Number(e.target.value) })}
          />
        </label>
        {!local && (
          <label className="field">
            <span>Buzzer-Zeit (Sek.)</span>
            <input
              type="number"
              className="input small"
              min={JEOPARDY_LIMITS.buzzSeconds.min}
              max={JEOPARDY_LIMITS.buzzSeconds.max}
              step={JEOPARDY_LIMITS.buzzSeconds.step}
              value={rules.buzzSeconds}
              onChange={(e) => set({ buzzSeconds: Number(e.target.value) })}
            />
          </label>
        )}
      </div>

      <label className="rule-row boolean">
        <span>Falsche Antwort kostet Punkte (Originalregel)</span>
        <input type="checkbox" checked={rules.penalty} onChange={(e) => set({ penalty: e.target.checked })} />
      </label>

      {local ? (
        <p className="hint">
          🪑 Am gemeinsamen Gerät kann niemand gleichzeitig buzzern. Wer vorliest,
          tippt statt dessen auf den Namen dessen, der zuerst gerufen hat – und es
          läuft keine Uhr mit.
        </p>
      ) : (
        <p className="hint">
          🖥 Tipp: Ein weiteres Gerät (Fernseher, Laptop) kann mit demselben Code
          beitreten und zeigt dann das Brett groß, während alle mit dem Handy
          buzzern.
        </p>
      )}
    </>
  );
}

export function PursuitCreateFields({ pursuit, setPursuit, local }: CreateFieldsProps) {
  const rules = pursuit as unknown as PursuitRules;
  const set = (patch: Partial<PursuitRules>) =>
    setPursuit({ ...rules, ...patch } as unknown as Record<string, unknown>);

  const packs = useStore((s) => s.packs);
  const pack = packs.find((p) => p.id === rules.packId) ?? packs[0];
  const report = pack ? checkPack(pack) : null;

  return (
    <>
      <label className="field">
        <span>Fragenpaket</span>
        <select className="input" value={pack?.id ?? ''} onChange={(e) => set({ packId: e.target.value })}>
          {packs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.builtIn ? '' : ' (eigenes)'}
            </option>
          ))}
        </select>
      </label>
      {pack && (
        <p className="hint">
          {report?.total ?? 0} Fragen
          {report && !report.ok && ' · ⚠️ zu wenige verschiedene Antworten für Multiple Choice'}
        </p>
      )}

      <div className="field-row">
        <label className="field">
          <span>Käsestücke zum Sieg</span>
          <input
            type="number"
            className="input small"
            min={PURSUIT_LIMITS.wedgesToWin.min}
            max={PURSUIT_LIMITS.wedgesToWin.max}
            value={rules.wedgesToWin}
            onChange={(e) => set({ wedgesToWin: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          <span>Schwierigkeit</span>
          <select
            className="input"
            value={rules.level}
            onChange={(e) => set({ level: Number(e.target.value) as PursuitRules['level'] })}
          >
            <option value={0}>gemischt</option>
            {[1, 2, 3, 4, 5].map((l) => (
              <option key={l} value={l}>
                Stufe {l}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="rule-row boolean">
        <span>Frei antworten statt ankreuzen</span>
        <input type="checkbox" checked={rules.freeText} onChange={(e) => set({ freeText: e.target.checked })} />
      </label>
      <p className="hint">
        {rules.freeText
          ? 'Wie bei Jeopardy: die Mitspieler werten, mit vorausgewähltem Vorschlag. Authentischer, aber jede Frage kostet eine Runde mehr.'
          : 'Vier Möglichkeiten je Frage. Über eine ganze Partie hält das das Tempo – deshalb die Vorgabe.'}
      </p>

      {local ? (
        <p className="hint">
          🪑 Das Rad dreht sich zu dem, der am Zug ist. Die Frage steht in der
          Seitenspalte und bleibt aufrecht.
        </p>
      ) : (
        <p className="hint">
          🖥 Ein weiteres Gerät kann mit demselben Code beitreten und zeigt dann das
          Rad groß – gewürfelt und geantwortet wird am Handy.
        </p>
      )}
    </>
  );
}
