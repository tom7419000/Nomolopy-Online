/**
 * Editor für Fragenpakete.
 *
 * In derselben Form wie `AdminPanel.tsx` (Editionen): links das Paket
 * wählen, rechts den Entwurf bearbeiten, dann speichern oder löschen.
 * Deutlich einfacher als der Editionen-Editor, weil Bild-Upload und
 * Farbwahl entfallen.
 *
 * Das Abdeckungsraster oben ist zugleich die Jeopardy-Brettvorschau: Ein
 * Paket ist bespielbar, wenn jedes der 30 Fächer genug Fragen hat.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  CATEGORY_EMOJI,
  CATEGORY_LABELS,
  MIN_PER_BUCKET,
  TRIVIA_CATEGORIES,
  TRIVIA_LEVELS,
  bucketKey,
  checkPack,
  type TriviaCategory,
  type TriviaLevel,
  type TriviaPack,
  type TriviaQuestion,
} from '@shared/trivia/types';
import { api } from '../../net';
import { useStore } from '../../state/store';
import { Modal } from '../../components/Modal';

function emptyQuestion(category: TriviaCategory, level: TriviaLevel): TriviaQuestion {
  return {
    id: `q-${Math.random().toString(36).slice(2, 10)}`,
    category,
    level,
    prompt: '',
    answer: '',
  };
}

export function PackEditor() {
  const closeDialog = useStore((s) => s.closeDialog);
  const packs = useStore((s) => s.packs);
  const addToast = useStore((s) => s.addToast);

  const [selectedId, setSelectedId] = useState<string>(packs[0]?.id ?? '');
  const [draft, setDraft] = useState<TriviaPack | null>(null);
  const [busy, setBusy] = useState(false);
  const [filterCat, setFilterCat] = useState<TriviaCategory | 'alle'>('alle');
  const [filterLevel, setFilterLevel] = useState<TriviaLevel | 'alle'>('alle');
  const [showJson, setShowJson] = useState(false);
  const [jsonText, setJsonText] = useState('');

  useEffect(() => {
    const source = packs.find((p) => p.id === selectedId) ?? packs[0];
    if (source) setDraft(structuredClone(source));
  }, [selectedId, packs]);

  const report = useMemo(() => (draft ? checkPack(draft) : null), [draft]);

  const visible = useMemo(() => {
    if (!draft) return [];
    return draft.questions
      .map((q, i) => ({ q, i }))
      .filter(({ q }) => filterCat === 'alle' || q.category === filterCat)
      .filter(({ q }) => filterLevel === 'alle' || q.level === filterLevel);
  }, [draft, filterCat, filterLevel]);

  if (!draft || !report) {
    return (
      <Modal title="📚 Fragenpakete" onClose={closeDialog}>
        <p className="hint">Pakete werden geladen …</p>
      </Modal>
    );
  }

  const isBuiltIn = draft.builtIn;

  function patch(p: Partial<TriviaPack>) {
    setDraft((d) => (d ? { ...d, ...p } : d));
  }

  function patchQuestion(index: number, p: Partial<TriviaQuestion>) {
    setDraft((d) => {
      if (!d) return d;
      const questions = d.questions.map((q, i) => (i === index ? { ...q, ...p } : q));
      return { ...d, questions };
    });
  }

  function addQuestion() {
    const cat = filterCat === 'alle' ? TRIVIA_CATEGORIES[0] : filterCat;
    const lvl = filterLevel === 'alle' ? 1 : filterLevel;
    setDraft((d) => (d ? { ...d, questions: [...d.questions, emptyQuestion(cat, lvl)] } : d));
  }

  function removeQuestion(index: number) {
    setDraft((d) => (d ? { ...d, questions: d.questions.filter((_, i) => i !== index) } : d));
  }

  async function save(asCopy: boolean) {
    if (!draft) return;
    setBusy(true);
    const payload: TriviaPack = {
      ...draft,
      // Eingebaute Pakete werden nie überschrieben – daraus wird eine Kopie.
      id: asCopy || isBuiltIn ? '' : draft.id,
      name: asCopy || isBuiltIn ? `${draft.name} (Kopie)` : draft.name,
      builtIn: false,
    };
    const r = await api.savePack(payload);
    setBusy(false);
    if (r.ok) {
      addToast('success', 'Paket gespeichert.');
      const saved = r.pack as TriviaPack | undefined;
      if (saved) setSelectedId(saved.id);
    }
  }

  async function remove() {
    if (!draft) return;
    if (!window.confirm(`Paket „${draft.name}" wirklich löschen?`)) return;
    setBusy(true);
    const r = await api.deletePack(draft.id);
    setBusy(false);
    if (r.ok) {
      addToast('success', 'Paket gelöscht.');
      setSelectedId(packs[0]?.id ?? '');
    }
  }

  function exportJson() {
    setJsonText(JSON.stringify({ ...draft, id: '', builtIn: false }, null, 2));
    setShowJson(true);
  }

  function importJson() {
    try {
      const parsed = JSON.parse(jsonText) as TriviaPack;
      if (!Array.isArray(parsed.questions)) throw new Error('questions fehlt');
      setDraft({ ...parsed, id: '', builtIn: false });
      setShowJson(false);
      addToast('success', `${parsed.questions.length} Fragen übernommen – noch nicht gespeichert.`);
    } catch (e) {
      addToast('error', `JSON konnte nicht gelesen werden: ${(e as Error).message}`);
    }
  }

  return (
    <Modal title="📚 Fragenpakete" onClose={closeDialog} wide>
      <div className="field-row">
        <label className="field">
          <span>Paket</span>
          <select className="input" value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
            {packs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.builtIn ? '' : ' (eigenes)'}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Name</span>
          <input
            className="input"
            maxLength={60}
            value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
          />
        </label>
      </div>

      <label className="field">
        <span>Beschreibung</span>
        <input
          className="input"
          maxLength={200}
          value={draft.description}
          onChange={(e) => patch({ description: e.target.value })}
        />
      </label>

      {/* Abdeckung: zugleich die Jeopardy-Brettvorschau */}
      <h3 className="setup-title">
        Abdeckung ({report.total} Fragen){' '}
        {report.ok ? (
          <span className="pack-ok">✓ bespielbar</span>
        ) : (
          <span className="pack-thin">⚠ {report.thin.length} Fächer zu dünn</span>
        )}
      </h3>
      <div className="pack-grid">
        <div />
        {TRIVIA_LEVELS.map((l) => (
          <div key={l} className="pack-grid-head">
            {l}
          </div>
        ))}
        {TRIVIA_CATEGORIES.map((c) => (
          <FragmentRow key={c} category={c} counts={report.counts} distinct={report.distinct} />
        ))}
      </div>
      {!report.ok && (
        <p className="hint">
          Jedes Fach braucht mindestens {MIN_PER_BUCKET} <strong>verschiedene Antworten</strong>:
          Trivial Pursuit bildet die falschen Antwortmöglichkeiten aus den übrigen
          Antworten desselben Fachs, und zwei Fragen mit derselben Lösung liefern
          nur eine davon.
        </p>
      )}

      {/* Fragen */}
      <h3 className="setup-title">Fragen</h3>
      <div className="field-row">
        <label className="field">
          <span>Kategorie</span>
          <select
            className="input"
            value={filterCat}
            onChange={(e) => setFilterCat(e.target.value as TriviaCategory | 'alle')}
          >
            <option value="alle">alle</option>
            {TRIVIA_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_EMOJI[c]} {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Stufe</span>
          <select
            className="input small"
            value={filterLevel}
            onChange={(e) =>
              setFilterLevel(e.target.value === 'alle' ? 'alle' : (Number(e.target.value) as TriviaLevel))
            }
          >
            <option value="alle">alle</option>
            {TRIVIA_LEVELS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </div>

      <ul className="pack-questions">
        {visible.map(({ q, i }) => (
          <li key={q.id}>
            <div className="pack-q-head">
              <select
                className="input small"
                value={q.category}
                onChange={(e) => patchQuestion(i, { category: e.target.value as TriviaCategory })}
                aria-label="Kategorie"
              >
                {TRIVIA_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_EMOJI[c]}
                  </option>
                ))}
              </select>
              <select
                className="input small"
                value={q.level}
                onChange={(e) => patchQuestion(i, { level: Number(e.target.value) as TriviaLevel })}
                aria-label="Stufe"
              >
                {TRIVIA_LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
              <button
                className="btn ghost small"
                onClick={() => removeQuestion(i)}
                aria-label="Frage entfernen"
              >
                ✕
              </button>
            </div>
            <input
              className="input"
              placeholder="Frage …"
              maxLength={300}
              value={q.prompt}
              onChange={(e) => patchQuestion(i, { prompt: e.target.value })}
              aria-label="Frage"
            />
            <div className="field-row">
              <input
                className="input"
                placeholder="Antwort"
                maxLength={120}
                value={q.answer}
                onChange={(e) => patchQuestion(i, { answer: e.target.value })}
                aria-label="Antwort"
              />
              <input
                className="input"
                placeholder="Auch gültig (Komma-getrennt)"
                value={(q.accept ?? []).join(', ')}
                onChange={(e) =>
                  patchQuestion(i, {
                    accept: e.target.value
                      .split(',')
                      .map((x) => x.trim())
                      .filter(Boolean),
                  })
                }
                aria-label="Alternativschreibweisen"
              />
            </div>
          </li>
        ))}
      </ul>
      {visible.length === 0 && <p className="hint">Keine Fragen in dieser Auswahl.</p>}

      <button className="btn ghost" onClick={addQuestion}>
        ➕ Frage hinzufügen
      </button>

      {/* JSON – der eigentliche Weg zu größeren Paketen */}
      {showJson ? (
        <>
          <label className="field">
            <span>JSON (einfügen und übernehmen, oder herauskopieren)</span>
            <textarea
              className="input pack-json"
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
            />
          </label>
          <div className="btn-row">
            <button className="btn primary" onClick={importJson}>
              Übernehmen
            </button>
            <button className="btn" onClick={() => setShowJson(false)}>
              Abbrechen
            </button>
          </div>
        </>
      ) : (
        <div className="btn-row">
          <button className="btn ghost" onClick={exportJson}>
            ⤓ Als JSON zeigen
          </button>
          <button
            className="btn ghost"
            onClick={() => {
              setJsonText('');
              setShowJson(true);
            }}
          >
            ⤒ JSON einfügen
          </button>
        </div>
      )}

      <div className="btn-row">
        <button className="btn primary" disabled={busy} onClick={() => save(false)}>
          {isBuiltIn ? 'Als eigenes Paket speichern' : 'Speichern'}
        </button>
        {!isBuiltIn && (
          <>
            <button className="btn" disabled={busy} onClick={() => save(true)}>
              Als Kopie speichern
            </button>
            <button className="btn danger" disabled={busy} onClick={remove}>
              Löschen
            </button>
          </>
        )}
      </div>
      {isBuiltIn && (
        <p className="hint">
          Das mitgelieferte Paket lässt sich nicht überschreiben – gespeichert wird eine Kopie.
        </p>
      )}
    </Modal>
  );
}

function FragmentRow({
  category,
  counts,
  distinct,
}: {
  category: TriviaCategory;
  counts: Record<string, number>;
  distinct: Record<string, number>;
}) {
  return (
    <>
      <div className="pack-grid-cat">
        {CATEGORY_EMOJI[category]} {CATEGORY_LABELS[category]}
      </div>
      {TRIVIA_LEVELS.map((l) => {
        const key = bucketKey(category, l);
        const n = counts[key] ?? 0;
        const d = distinct[key] ?? 0;
        return (
          <div
            key={l}
            className={`pack-grid-cell ${d < MIN_PER_BUCKET ? 'thin' : ''}`}
            // Der Unterschied fällt sonst nicht auf: das Fach kann voll
            // aussehen und trotzdem zu wenige verschiedene Antworten haben.
            title={d < n ? `${n} Fragen, aber nur ${d} verschiedene Antworten` : `${n} Fragen`}
          >
            {n}
            {d < n && <span className="pack-grid-distinct">{d}</span>}
          </div>
        );
      })}
    </>
  );
}
