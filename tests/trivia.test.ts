/**
 * Unit-Tests für das Trivia-Fundament: Textvergleich, Fragen ziehen,
 * Ablenker bilden und die Vollständigkeit des mitgelieferten Pakets.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  autoVerdict,
  distractors,
  drawQuestion,
  editDistance,
  multipleChoice,
  normalize,
  tallyVotes,
} from '../shared/trivia/ask';
import {
  checkPack,
  MIN_PER_BUCKET,
  TRIVIA_CATEGORIES,
  TRIVIA_LEVELS,
  bucketKey,
  type TriviaPack,
  type TriviaQuestion,
} from '../shared/trivia/types';
import { STANDARD_DE } from '../shared/trivia/packs/standard-de';

/** Deterministischer „Zufall" für reproduzierbare Läufe. */
function seeded(seed = 1): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function packOf(questions: TriviaQuestion[]): TriviaPack {
  return {
    id: 'test',
    name: 'Test',
    description: '',
    builtIn: false,
    language: 'de',
    questions,
  };
}

// ---------------------------------------------------------------------------
// Textvergleich
// ---------------------------------------------------------------------------

test('normalize macht Schreibweisen vergleichbar', () => {
  assert.equal(normalize('Die Elbe'), 'elbe');
  assert.equal(normalize('ELBE!'), 'elbe');
  assert.equal(normalize('  die   elbe  '), 'elbe');
  assert.equal(normalize('Köln'), 'koln', 'Umlaute werden aufgelöst');
  assert.equal(normalize('Straße'), 'strasse');
  assert.equal(normalize('Der Rhein'), 'rhein', 'führender Artikel fällt weg');
  assert.equal(normalize(''), '');
});

test('normalize entfernt nur FÜHRENDE Artikel', () => {
  // „Das Kapital" → „kapital", aber ein Artikel mitten drin bleibt stehen.
  assert.equal(normalize('Die Blumen des Bösen'), 'blumen des bosen');
});

test('editDistance bricht über der Grenze ab', () => {
  assert.equal(editDistance('elbe', 'elbe'), 0);
  assert.equal(editDistance('elbe', 'elba'), 1);
  assert.ok(editDistance('elbe', 'donau', 2) > 2, 'weit auseinander');
});

test('autoVerdict akzeptiert exakte und leicht vertippte Antworten', () => {
  const q: TriviaQuestion = {
    id: 'q1',
    category: 'geografie',
    level: 2,
    prompt: 'Welcher Fluss mündet bei Cuxhaven in die Nordsee?',
    answer: 'Die Elbe',
    accept: ['Elbe'],
  };

  assert.equal(autoVerdict(q, 'Die Elbe'), true);
  assert.equal(autoVerdict(q, 'elbe'), true, 'Kleinschreibung');
  assert.equal(autoVerdict(q, 'Der Rhein'), false);
  assert.equal(autoVerdict(q, ''), false);
});

test('autoVerdict toleriert Tippfehler nur bei langen Antworten', () => {
  const lang: TriviaQuestion = {
    id: 'q2',
    category: 'geschichte',
    level: 3,
    prompt: 'Wer war die letzte Königin des antiken Ägypten?',
    answer: 'Kleopatra',
  };
  assert.equal(autoVerdict(lang, 'Kleopatr'), true, 'ein Zeichen fehlt');
  assert.equal(autoVerdict(lang, 'Cleopatra'), true, 'ein Zeichen anders');

  const kurz: TriviaQuestion = {
    id: 'q3',
    category: 'geografie',
    level: 1,
    prompt: 'Wie heißt die Hauptstadt von Italien?',
    answer: 'Rom',
  };
  // Bei drei Buchstaben wäre Abstand 2 fast beliebig – deshalb kein Rabatt.
  assert.equal(autoVerdict(kurz, 'Bonn'), false);
  assert.equal(autoVerdict(kurz, 'Rom'), true);
});

// ---------------------------------------------------------------------------
// Ziehen
// ---------------------------------------------------------------------------

test('drawQuestion zieht ohne Zurücklegen', () => {
  const rnd = seeded();
  const used: string[] = [];
  for (let i = 0; i < 10; i++) {
    const q = drawQuestion(STANDARD_DE, 'geografie', 1, used, rnd);
    assert.ok(q, `Zug ${i + 1} liefert eine Frage`);
    assert.ok(!used.includes(q!.id), 'keine Wiederholung');
    used.push(q!.id);
  }
  // Das Fach hat genau zehn Fragen – die elfte gibt es nicht mehr.
  assert.equal(drawQuestion(STANDARD_DE, 'geografie', 1, used, rnd), null);
});

test('drawQuestion liefert null für ein leeres Fach', () => {
  const pack = packOf([]);
  assert.equal(drawQuestion(pack, 'sport', 3, [], seeded()), null);
});

// ---------------------------------------------------------------------------
// Ablenker
// ---------------------------------------------------------------------------

test('distractors liefert drei verschiedene, nie die richtige Antwort', () => {
  const rnd = seeded(7);
  const q = drawQuestion(STANDARD_DE, 'wissenschaft', 2, [], rnd)!;
  const wrong = distractors(STANDARD_DE, q, 3, rnd);

  assert.equal(wrong.length, 3);
  assert.equal(new Set(wrong.map(normalize)).size, 3, 'untereinander verschieden');
  for (const w of wrong) {
    assert.notEqual(normalize(w), normalize(q.answer), 'nie die richtige Antwort');
  }
});

test('Ablenker kommen auch aus schon gespielten Fragen', () => {
  // Sonst gingen sie gegen Ende einer Partie aus.
  const rnd = seeded(3);
  const bucket = STANDARD_DE.questions.filter((q) => q.category === 'sport' && q.level === 1);
  const q = bucket[0];
  const alleAnderenVerbraucht = bucket.slice(1).map((x) => x.id);

  assert.equal(
    drawQuestion(STANDARD_DE, 'sport', 1, alleAnderenVerbraucht, rnd)?.id,
    q.id,
    'nur noch eine Frage übrig'
  );
  assert.equal(
    distractors(STANDARD_DE, q, 3, rnd).length,
    3,
    'Ablenker gibt es trotzdem noch'
  );
});

test('distractors unterscheidet „Die Elbe" nicht von „Elbe"', () => {
  const pack = packOf([
    { id: 'a', category: 'geografie', level: 1, prompt: 'A?', answer: 'Die Elbe' },
    { id: 'b', category: 'geografie', level: 1, prompt: 'B?', answer: 'Elbe' },
    { id: 'c', category: 'geografie', level: 1, prompt: 'C?', answer: 'Der Rhein' },
    { id: 'd', category: 'geografie', level: 1, prompt: 'D?', answer: 'Die Donau' },
  ]);
  const wrong = distractors(pack, pack.questions[0], 3, seeded());
  assert.ok(!wrong.map(normalize).includes('elbe'), 'dieselbe Antwort anders geschrieben fällt raus');
});

test('multipleChoice enthält die richtige Antwort und vier Optionen', () => {
  const rnd = seeded(11);
  const q = drawQuestion(STANDARD_DE, 'kunst', 3, [], rnd)!;
  const options = multipleChoice(STANDARD_DE, q, rnd);

  assert.equal(options.length, 4);
  assert.ok(options.includes(q.answer), 'die richtige Antwort ist dabei');
  assert.equal(new Set(options.map(normalize)).size, 4, 'keine Dubletten');
});

// ---------------------------------------------------------------------------
// Wertung
// ---------------------------------------------------------------------------

test('tallyVotes: Mehrheit entscheidet, Gleichstand zugunsten des Spielers', () => {
  assert.equal(tallyVotes({ a: true, b: true, c: false }, false), true);
  assert.equal(tallyVotes({ a: false, b: false, c: true }, true), false);
  assert.equal(tallyVotes({ a: true, b: false }, false), true, 'Gleichstand → richtig');
  assert.equal(tallyVotes({}, true), true, 'niemand wertet → Vorschlag greift');
  assert.equal(tallyVotes({}, false), false);
});

// ---------------------------------------------------------------------------
// Paket-Validierung
// ---------------------------------------------------------------------------

test('checkPack meldet zu dünne Fächer', () => {
  const pack = packOf([
    { id: 'a', category: 'geografie', level: 1, prompt: 'A?', answer: 'A' },
    { id: 'b', category: 'geografie', level: 1, prompt: 'B?', answer: 'B' },
  ]);
  const report = checkPack(pack);

  assert.equal(report.ok, false);
  assert.equal(report.total, 2);
  // 30 Fächer, alle unterbesetzt
  assert.equal(report.thin.length, TRIVIA_CATEGORIES.length * TRIVIA_LEVELS.length);
  const geo1 = report.thin.find((t) => t.category === 'geografie' && t.level === 1);
  assert.equal(geo1?.count, 2, `zwei Fragen sind weniger als ${MIN_PER_BUCKET}`);
  assert.equal(geo1?.distinct, 2);
});

test('checkPack zählt verschiedene ANTWORTEN, nicht Fragen', () => {
  // Vier Fragen, aber nur drei verschiedene Lösungen: daraus lassen sich
  // keine drei Ablenker bilden, und Trivial Pursuit stünde auf jedem Feld
  // mit weniger als vier Möglichkeiten da.
  const pack = packOf([
    { id: 'a', category: 'sport', level: 1, prompt: 'A?', answer: 'Fußball' },
    { id: 'b', category: 'sport', level: 1, prompt: 'B?', answer: 'fussball!' },
    { id: 'c', category: 'sport', level: 1, prompt: 'C?', answer: 'Handball' },
    { id: 'd', category: 'sport', level: 1, prompt: 'D?', answer: 'Tennis' },
  ]);
  const bucket = checkPack(pack).thin.find((t) => t.category === 'sport' && t.level === 1);
  assert.equal(bucket?.count, 4, 'vier Fragen …');
  assert.equal(bucket?.distinct, 3, '… aber nur drei verschiedene Antworten');
});

test('Das mitgelieferte Paket besteht auch die strengere Prüfung', () => {
  const report = checkPack(STANDARD_DE);
  assert.deepEqual(report.thin, []);
  for (const c of TRIVIA_CATEGORIES) {
    for (const l of TRIVIA_LEVELS) {
      assert.ok(
        report.distinct[bucketKey(c, l)] >= MIN_PER_BUCKET,
        `${c}/${l} hat nur ${report.distinct[bucketKey(c, l)]} verschiedene Antworten`
      );
    }
  }
});

test('Das mitgelieferte Paket ist vollständig und bespielbar', () => {
  const report = checkPack(STANDARD_DE);

  assert.deepEqual(report.thin, [], 'kein Fach ist unterbesetzt');
  assert.equal(report.ok, true);
  assert.equal(report.total, 300, 'sechs Kategorien × fünf Stufen × zehn Fragen');

  for (const c of TRIVIA_CATEGORIES) {
    for (const l of TRIVIA_LEVELS) {
      assert.equal(report.counts[bucketKey(c, l)], 10, `${c}/${l} hat zehn Fragen`);
    }
  }
});

test('Das mitgelieferte Paket hat eindeutige IDs und gefüllte Felder', () => {
  const ids = new Set<string>();
  for (const q of STANDARD_DE.questions) {
    assert.ok(!ids.has(q.id), `ID doppelt: ${q.id}`);
    ids.add(q.id);
    assert.ok(q.prompt.trim().length > 5, `Frage zu kurz: ${q.id}`);
    assert.ok(q.answer.trim().length > 0, `Antwort fehlt: ${q.id}`);
    assert.ok(q.prompt.trim().endsWith('?'), `Frage ohne Fragezeichen: ${q.id}`);
  }
});

test('Jede Frage des Pakets lässt sich als Multiple Choice stellen', () => {
  // Das ist die eigentliche Zusage des Formats: Trivial Pursuit erzeugt
  // seine Ablenker aus dem Fach, also muss das überall aufgehen.
  const rnd = seeded(42);
  for (const q of STANDARD_DE.questions) {
    const options = multipleChoice(STANDARD_DE, q, rnd);
    assert.equal(options.length, 4, `zu wenige Optionen bei ${q.id}`);
    assert.ok(options.includes(q.answer), `richtige Antwort fehlt bei ${q.id}`);
  }
});
