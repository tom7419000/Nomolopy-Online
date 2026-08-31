/**
 * Unit-Tests der Jeopardy-Engine.
 *
 *   npm test
 *
 * Geprüft wird vor allem das, was sich im Browser nur schwer nachstellen
 * lässt: das Buzzer-Rennen, die Sperre nach einer falschen Antwort, die
 * Wertung durch die Mitspieler – und dass die richtige Antwort den Server
 * nicht verlässt, bevor aufgelöst ist.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addJeopardyPlayer,
  applyJeopardyAction,
  createJeopardy,
  jeopardyDeadline,
  jeopardyTick,
  jeopardyView,
  ROWS,
  startJeopardy,
} from '../shared/jeopardy/engine';
import { BUZZ_GRACE_MS, DEFAULT_JEOPARDY_RULES, MIN_REACTION_MS } from '../shared/jeopardy/rules';
import type { JeopardyAction, JeopardyState } from '../shared/jeopardy/types';
import {
  MIN_PER_BUCKET,
  TRIVIA_CATEGORIES,
  TRIVIA_LEVELS,
  type TriviaPack,
  type TriviaQuestion,
} from '../shared/trivia/types';

// ---------------------------------------------------------------------------
// Aufbau
// ---------------------------------------------------------------------------

/**
 * Ein vollständiges Paket, in dem die Antwort jeder Frage ihre ID ist.
 *
 * Damit ist jede Antwort ohne Nachschlagen bekannt, egal welche Frage aus
 * einem Fach gezogen wurde – die Tests müssen den Zufall also nicht fesseln.
 */
function testPack(): TriviaPack {
  const questions: TriviaQuestion[] = [];
  for (const category of TRIVIA_CATEGORIES) {
    for (const level of TRIVIA_LEVELS) {
      for (let i = 0; i < MIN_PER_BUCKET; i++) {
        const id = `${category}-${level}-${i}`;
        questions.push({ id, category, level, prompt: `Frage ${id}?`, answer: id });
      }
    }
  }
  return { id: 'test', name: 'Testpaket', description: '', builtIn: false, language: 'de', questions };
}

const PACK = testPack();

function game(names = ['Anna', 'Ben', 'Clara'], rules: Partial<typeof DEFAULT_JEOPARDY_RULES> = {}) {
  const state = createJeopardy('TEST', {
    ...DEFAULT_JEOPARDY_RULES,
    packId: PACK.id,
    // Ohne Vorlesezeit steht der Buzzer sofort offen – das spart in fast
    // jedem Test einen Schritt.
    readSeconds: 0,
    ...rules,
  });
  names.forEach((n, i) => addJeopardyPlayer(state, `p${i}`, n, i === 0));
  const r = startJeopardy(state, PACK, 1000);
  assert.equal(r.ok, true, r.error);
  return state;
}

/** Kurzform für eine Aktion; `now` ist frei wählbar. */
function act(s: JeopardyState, playerId: string, action: JeopardyAction, now = 1000) {
  return applyJeopardyAction(s, playerId, action, PACK, now);
}

/** Der Spieler, der gerade wählen darf. */
const picker = (s: JeopardyState) => s.players[s.pickerIndex].id;

/** Das erste freie Feld wählen (immer erlaubt) und die Frage stellen. */
function pick(s: JeopardyState, col = 0, row = 0, now = 1000) {
  const r = act(s, picker(s), { type: 'pick', col, row }, now);
  assert.equal(r.ok, true, r.error);
  return s.clue!;
}

/** Die richtige Antwort – im Testpaket ist sie gleich der Frage-ID. */
const solution = (s: JeopardyState) => s.clue!.questionId!;

// ---------------------------------------------------------------------------
// Aufbau und Brett
// ---------------------------------------------------------------------------

test('Start baut ein Brett aus sechs Kategorien und fünf Zeilen', () => {
  const s = game();
  assert.equal(s.phase, 'playing');
  assert.equal(s.board.length, TRIVIA_CATEGORIES.length);
  assert.equal(new Set(s.board.map((c) => c.category)).size, TRIVIA_CATEGORIES.length, 'jede Kategorie genau einmal');
  for (const col of s.board) assert.equal(col.used.length, ROWS.length);
});

test('Ein unvollständiges Paket lässt sich nicht spielen', () => {
  const thin: TriviaPack = { ...PACK, questions: PACK.questions.slice(0, 5) };
  const s = createJeopardy('TEST', { ...DEFAULT_JEOPARDY_RULES, packId: thin.id });
  addJeopardyPlayer(s, 'p0', 'Anna', true);
  addJeopardyPlayer(s, 'p1', 'Ben', false);

  const r = startJeopardy(s, thin, 1000);
  assert.equal(r.ok, false);
  assert.match(r.error ?? '', /nicht vollständig/);
  assert.equal(s.phase, 'lobby', 'die Lobby bleibt stehen');
});

test('Ohne Paket startet nichts', () => {
  const s = createJeopardy('TEST', { ...DEFAULT_JEOPARDY_RULES });
  addJeopardyPlayer(s, 'p0', 'Anna', true);
  addJeopardyPlayer(s, 'p1', 'Ben', false);
  assert.equal(startJeopardy(s, null, 1000).ok, false);
});

test('Nur der Picker wählt ein Feld, und nur ein freies', () => {
  const s = game();
  const other = s.players.find((p) => p.id !== picker(s))!.id;

  assert.equal(act(s, other, { type: 'pick', col: 0, row: 0 }).ok, false, 'fremder Zugriff');
  assert.equal(act(s, picker(s), { type: 'pick', col: 9, row: 0 }).ok, false, 'Spalte gibt es nicht');
  assert.equal(act(s, picker(s), { type: 'pick', col: 0, row: 9 }).ok, false, 'Zeile gibt es nicht');

  pick(s, 2, 3);
  assert.equal(s.board[2].used[3], true, 'sofort verbraucht, nicht erst bei der Auflösung');
  assert.equal(s.clue?.value, 4 * DEFAULT_JEOPARDY_RULES.baseValue, 'Zeile 4 ist viermal so viel wert');
  assert.equal(act(s, picker(s), { type: 'pick', col: 0, row: 0 }).ok, false, 'es läuft schon eine Frage');
});

// ---------------------------------------------------------------------------
// Das Buzzer-Rennen
// ---------------------------------------------------------------------------

test('Nicht die erste Nachricht gewinnt, sondern die schnellste Reaktion', () => {
  const s = game();
  pick(s);

  // p0 drückt und meldet 500 ms; p1 trifft 40 ms später ein, hat aber nur
  // 300 ms gebraucht – sein WLAN war langsamer, nicht sein Finger.
  assert.equal(act(s, 'p0', { type: 'buzz', reactionMs: 500 }, 1600).ok, true);
  assert.equal(s.clue!.raceEndsAt, 1600 + BUZZ_GRACE_MS, 'der erste Buzz eröffnet das Fenster');
  assert.equal(act(s, 'p1', { type: 'buzz', reactionMs: 300 }, 1640).ok, true);
  assert.equal(s.clue!.answererId, null, 'noch ist nichts entschieden');

  // Fenster abgelaufen.
  assert.equal(jeopardyTick(s, 1600 + BUZZ_GRACE_MS, PACK), true);
  assert.equal(s.clue!.answererId, 'p1');
  assert.equal(s.clue!.step, 'answering');
});

test('Wer nach dem Gnadenfenster drückt, kommt zu spät', () => {
  const s = game();
  pick(s);
  act(s, 'p0', { type: 'buzz', reactionMs: 900 }, 1600);
  jeopardyTick(s, 1600 + BUZZ_GRACE_MS, PACK);

  assert.equal(s.clue!.answererId, 'p0');
  const late = act(s, 'p1', { type: 'buzz', reactionMs: 100 }, 1800);
  assert.equal(late.ok, false, 'das Rennen ist gelaufen');
});

test('Eine gemeldete Reaktionszeit wird nach unten und oben gedeckelt', () => {
  const s = game();
  pick(s, 0, 0, 1000);

  // Behauptet 0 ms → auf den physiologischen Boden angehoben.
  act(s, 'p0', { type: 'buzz', reactionMs: 0 }, 1500);
  assert.equal(s.clue!.buzzes.p0, MIN_REACTION_MS);

  // Behauptet 9 s, der Server hat aber nur 600 ms gemessen → gedeckelt.
  act(s, 'p1', { type: 'buzz', reactionMs: 9000 }, 1600);
  assert.equal(s.clue!.buzzes.p1, 600);

  // Ohne Angabe zählt schlicht die Ankunft.
  act(s, 'p2', { type: 'buzz' }, 1900);
  assert.equal(s.clue!.buzzes.p2, 900);
});

test('Ein zu früh gedrückter Buzzer wird abgelehnt, sperrt aber nicht', () => {
  const s = game(['Anna', 'Ben', 'Clara'], { readSeconds: 5 });
  const clue = pick(s);
  assert.equal(clue.step, 'reading');

  assert.equal(act(s, 'p1', { type: 'buzz' }, 1100).ok, false);
  assert.deepEqual(s.clue!.lockedOut, [], 'kein Nachsitzen fürs Vorpreschen');

  // Vorlesezeit vorbei → Buzzer auf.
  assert.equal(jeopardyTick(s, 1000 + 5000, PACK), true);
  assert.equal(s.clue!.step, 'buzzing');
  assert.equal(act(s, 'p1', { type: 'buzz' }, 6100).ok, true);
});

test('Zweimal buzzern geht nicht', () => {
  const s = game();
  pick(s);
  assert.equal(act(s, 'p0', { type: 'buzz' }, 1500).ok, true);
  assert.equal(act(s, 'p0', { type: 'buzz' }, 1510).ok, false);
});

test('Buzzert niemand, läuft die Frage aus und wird aufgelöst', () => {
  const s = game();
  const clue = pick(s);
  assert.equal(jeopardyDeadline(s), clue.deadline);

  assert.equal(jeopardyTick(s, clue.deadline!, PACK), true);
  assert.equal(s.clue!.step, 'revealed');
  assert.equal(s.clue!.answer, clue.questionId!, 'die Auflösung steht');
  assert.equal(s.players.every((p) => p.score === 0), true, 'niemand bekommt Punkte');
});

// ---------------------------------------------------------------------------
// Antworten und werten
// ---------------------------------------------------------------------------

/** Bringt die Partie in den Zustand „p1 hat das Wort". */
function buzzedIn(s: JeopardyState, who = 'p1', now = 1500) {
  act(s, who, { type: 'buzz' }, now);
  jeopardyTick(s, now + BUZZ_GRACE_MS, PACK);
  assert.equal(s.clue!.answererId, who);
  return now + BUZZ_GRACE_MS;
}

test('Nur wer gebuzzert hat, darf antworten', () => {
  const s = game();
  pick(s);
  const t = buzzedIn(s);
  assert.equal(act(s, 'p0', { type: 'answer', text: solution(s) }, t).ok, false);
  assert.equal(act(s, 'p1', { type: 'answer', text: solution(s) }, t).ok, true);
});

test('Eine richtige Antwort bringt Punkte, und der Antwortende wählt weiter', () => {
  const s = game();
  const clue = pick(s, 1, 2);
  const t = buzzedIn(s);
  act(s, 'p1', { type: 'answer', text: solution(s) }, t);

  assert.equal(s.clue!.step, 'judging');
  assert.equal(s.clue!.suggestion, true, 'die automatische Vorprüfung schlägt „richtig" vor');

  // Die beiden anderen bestätigen.
  act(s, 'p0', { type: 'judge', correct: true }, t);
  act(s, 'p2', { type: 'judge', correct: true }, t);

  assert.equal(s.clue!.step, 'revealed');
  assert.equal(s.players.find((p) => p.id === 'p1')!.score, clue.value);
  assert.equal(picker(s), 'p1', 'wer richtig lag, wählt das nächste Feld');
});

test('Die Mitspieler können den Vorschlag überstimmen', () => {
  const s = game();
  pick(s);
  const t = buzzedIn(s);
  act(s, 'p1', { type: 'answer', text: 'völlig daneben' }, t);
  assert.equal(s.clue!.suggestion, false);

  // Die Runde lässt es trotzdem gelten (Mehrheit schlägt Vorschlag).
  act(s, 'p0', { type: 'judge', correct: true }, t);
  act(s, 'p2', { type: 'judge', correct: true }, t);
  assert.equal(s.players.find((p) => p.id === 'p1')!.score > 0, true);
});

test('Über die eigene Antwort stimmt niemand ab', () => {
  const s = game();
  pick(s);
  const t = buzzedIn(s);
  act(s, 'p1', { type: 'answer', text: solution(s) }, t);
  assert.equal(act(s, 'p1', { type: 'judge', correct: true }, t).ok, false);
});

test('Falsch geantwortet: Abzug, Sperre, und der Buzzer geht für den Rest wieder auf', () => {
  const s = game();
  const clue = pick(s);
  const t = buzzedIn(s);
  act(s, 'p1', { type: 'answer', text: 'Quatsch' }, t);
  act(s, 'p0', { type: 'judge', correct: false }, t);
  act(s, 'p2', { type: 'judge', correct: false }, t);

  assert.equal(s.players.find((p) => p.id === 'p1')!.score, -clue.value, 'Minuspunkte');
  assert.deepEqual(s.clue!.lockedOut, ['p1']);
  assert.equal(s.clue!.step, 'buzzing', 'die anderen dürfen noch');
  assert.equal(s.clue!.answererId, null);
  assert.equal(act(s, 'p1', { type: 'buzz' }, t + 10).ok, false, 'p1 hatte seinen Versuch');
  assert.equal(act(s, 'p2', { type: 'buzz' }, t + 10).ok, true);
});

test('Ohne Abzug kostet eine falsche Antwort keine Punkte', () => {
  const s = game(['Anna', 'Ben', 'Clara'], { penalty: false });
  pick(s);
  const t = buzzedIn(s);
  act(s, 'p1', { type: 'answer', text: '' }, t);
  assert.equal(s.players.find((p) => p.id === 'p1')!.score, 0);
  assert.deepEqual(s.clue!.lockedOut, ['p1']);
});

test('Sind alle gesperrt, wird aufgelöst', () => {
  const s = game(['Anna', 'Ben'], {});
  const clue = pick(s);
  let t = 1500;

  for (const who of ['p0', 'p1']) {
    t = buzzedIn(s, who, t + 10);
    // Leer abschicken heißt „weiß ich nicht" – darüber stimmt niemand ab.
    act(s, who, { type: 'answer', text: '' }, t);
  }

  assert.equal(s.clue!.step, 'revealed');
  assert.equal(s.clue!.answer, clue.questionId);
  assert.equal(s.clue!.correct, false);
});

test('Eine leere Antwort geht ohne Abstimmung als falsch durch', () => {
  const s = game();
  pick(s);
  const t = buzzedIn(s);
  act(s, 'p1', { type: 'answer', text: '   ' }, t);
  assert.equal(s.clue!.step, 'buzzing', 'direkt zurück zum Buzzer, ohne Wertungsrunde');
  assert.deepEqual(s.clue!.lockedOut, ['p1']);
});

test('Wertet niemand rechtzeitig, greift der Vorschlag', () => {
  const s = game();
  const clue = pick(s);
  const t = buzzedIn(s);
  act(s, 'p1', { type: 'answer', text: solution(s) }, t);

  const deadline = s.clue!.deadline!;
  assert.equal(jeopardyTick(s, deadline, PACK), true);
  assert.equal(s.players.find((p) => p.id === 'p1')!.score, clue.value);
});

test('Gleichstand in der Wertung geht zugunsten des Spielers', () => {
  const s = game(['Anna', 'Ben', 'Clara', 'Dora']);
  const clue = pick(s);
  const t = buzzedIn(s);
  act(s, 'p1', { type: 'answer', text: 'grenzwertig' }, t);

  act(s, 'p0', { type: 'judge', correct: true }, t);
  act(s, 'p2', { type: 'judge', correct: false }, t);
  act(s, 'p3', { type: 'judge', correct: true }, t);
  // 2:1 – aber selbst 1:1 hätte gereicht.
  assert.equal(s.players.find((p) => p.id === 'p1')!.score, clue.value);
});

test('Wer nicht antwortet, verliert den Zug an der Uhr', () => {
  const s = game();
  const clue = pick(s);
  const t = buzzedIn(s);
  const deadline = s.clue!.deadline!;

  assert.equal(jeopardyTick(s, deadline, PACK), true);
  assert.equal(s.players.find((p) => p.id === 'p1')!.score, -clue.value);
  assert.deepEqual(s.clue!.lockedOut, ['p1']);
  assert.ok(t < deadline);
});

// ---------------------------------------------------------------------------
// Redaktion
// ---------------------------------------------------------------------------

test('Die richtige Antwort verlässt den Server erst bei der Auflösung', () => {
  const s = game();
  pick(s);

  assert.equal(jeopardyView(s).clue!.answer, null, 'während der Frage nicht');
  const t = buzzedIn(s);
  act(s, 'p1', { type: 'answer', text: 'irgendwas' }, t);
  assert.equal(jeopardyView(s).clue!.answer, null, 'auch nicht während der Wertung');

  // Falsch gewertet – der Buzzer geht für die anderen wieder auf, die
  // Antwort bleibt also weiter verborgen.
  act(s, 'p0', { type: 'judge', correct: false }, t);
  act(s, 'p2', { type: 'judge', correct: false }, t);
  assert.equal(s.clue!.step, 'buzzing');
  assert.equal(jeopardyView(s).clue!.answer, null, 'auch in der zweiten Runde nicht');

  act(s, picker(s), { type: 'skip' }, t + 10);
  assert.equal(s.clue!.step, 'revealed');
  assert.equal(jeopardyView(s).clue!.answer, s.clue!.questionId!, 'jetzt schon');
});

test('Die Redaktion verändert den echten Zustand nicht', () => {
  const s = game();
  pick(s);
  const before = s.clue!.answer;
  jeopardyView(s);
  assert.equal(s.clue!.answer, before);
});

// ---------------------------------------------------------------------------
// Ende
// ---------------------------------------------------------------------------

test('Ist das Brett leer, endet die Partie und der Beste gewinnt', () => {
  const s = game(['Anna', 'Ben']);
  s.players[0].score = 700;
  s.players[1].score = 300;

  // Alle dreißig Felder durchspielen, ohne dass jemand buzzert.
  for (let col = 0; col < s.board.length; col++) {
    for (let row = 0; row < ROWS.length; row++) {
      let now = 10_000 + col * 1000 + row * 100;
      act(s, picker(s), { type: 'pick', col, row }, now);
      jeopardyTick(s, s.clue!.deadline!, PACK); // Buzzer-Zeit abgelaufen
      jeopardyTick(s, s.clue!.deadline!, PACK); // Auflösung weg
      assert.ok(now > 0);
    }
  }

  assert.equal(s.phase, 'ended');
  assert.equal(s.winnerId, 'p0');
  assert.equal(s.clue, null);
});

test('Eine Frage wiederholt sich in einer Partie nicht', () => {
  const s = game();
  const seen = new Set<string>();
  for (let row = 0; row < ROWS.length; row++) {
    act(s, picker(s), { type: 'pick', col: 0, row }, 5000);
    const id = s.clue!.questionId!;
    assert.equal(seen.has(id), false, `Frage doppelt: ${id}`);
    seen.add(id);
    jeopardyTick(s, s.clue!.deadline!, PACK);
    jeopardyTick(s, s.clue!.deadline!, PACK);
  }
});

test('Auflösen kann nur, wer das Feld gewählt hat', () => {
  const s = game();
  pick(s);
  const other = s.players.find((p) => p.id !== picker(s))!.id;
  assert.equal(act(s, other, { type: 'skip' }, 1500).ok, false);
  assert.equal(act(s, picker(s), { type: 'skip' }, 1500).ok, true);
  assert.equal(s.clue!.step, 'revealed');
});

// ---------------------------------------------------------------------------
// Am gemeinsamen Gerät
// ---------------------------------------------------------------------------

test('Lokal entscheidet der Namensknopf sofort – ohne Rennen und ohne Uhr', () => {
  const s = game();
  s.local = true;
  const clue = pick(s);
  assert.equal(clue.deadline, null, 'am Tisch tickt keine Uhr');

  act(s, 'p2', { type: 'buzz' }, 1500);
  assert.equal(s.clue!.raceEndsAt, null, 'kein Gnadenfenster');
  assert.equal(s.clue!.answererId, 'p2', 'direkt entschieden');
  assert.equal(s.clue!.step, 'answering');
});

test('Lokal genügt ein Tipp zum Werten – sonst hinge die Runde ohne Uhr', () => {
  const s = game();
  const clue = pick(s);
  s.local = true;

  act(s, 'p1', { type: 'buzz' }, 1500);
  act(s, 'p1', { type: 'answer', text: solution(s) }, 1600);
  assert.equal(s.clue!.step, 'judging');

  act(s, 'p0', { type: 'judge', correct: true }, 1700);
  assert.equal(s.clue!.step, 'revealed', 'kein Warten auf die zweite Stimme');
  assert.equal(s.players.find((p) => p.id === 'p1')!.score, clue.value);
});

test('Auch die Frage-Kennung verlässt den Server erst bei der Auflösung', () => {
  // Die Antwort zu schwärzen und die Kennung mitzuschicken wäre wirkungslos:
  // der Client hat die Fragenpakete gebündelt dabei und schlüge sie nach.
  const s = game();
  pick(s);
  assert.equal(jeopardyView(s).clue!.questionId, null);

  const t = buzzedIn(s);
  act(s, 'p1', { type: 'answer', text: solution(s) }, t);
  assert.equal(jeopardyView(s).clue!.questionId, null, 'auch während der Wertung nicht');

  act(s, 'p0', { type: 'judge', correct: true }, t);
  act(s, 'p2', { type: 'judge', correct: true }, t);
  assert.equal(jeopardyView(s).clue!.questionId, s.clue!.questionId, 'jetzt schon');
});

// ---------------------------------------------------------------------------
// Der Moderator
// ---------------------------------------------------------------------------

/**
 * Eine moderierte Sendung: `p0` führt durch, `p1`…`pn` spielen.
 *
 * Der Moderator ist bewusst ein SITZ mit Markierung und kein Raum-Feld –
 * so gelten Host-Rechte, Host-Übergang und Rauswerfen unverändert weiter.
 */
function show(names = ['Mod', 'Ben', 'Clara'], rules: Partial<typeof DEFAULT_JEOPARDY_RULES> = {}) {
  const state = createJeopardy('TEST', {
    ...DEFAULT_JEOPARDY_RULES,
    packId: PACK.id,
    readSeconds: 0,
    moderated: true,
    ...rules,
  });
  names.forEach((n, i) => addJeopardyPlayer(state, `p${i}`, n, i === 0));
  const r = startJeopardy(state, PACK, 1000);
  assert.equal(r.ok, true, r.error);
  return state;
}

test('Der Moderator sitzt mit am Tisch, spielt aber nicht mit', () => {
  const s = show();
  assert.equal(s.players[0].moderator, true, 'der Ersteller moderiert');
  assert.equal(s.players[0].isHost, true, 'und bleibt Host – daran hängt die Plattform');
  assert.equal(s.players[1].moderator, false);
  assert.notEqual(picker(s), 'p0', 'gewählt wird von einem Mitspieler');
});

test('Der Moderator zählt nicht zur Mindestspielerzahl', () => {
  const s = createJeopardy('TEST', { ...DEFAULT_JEOPARDY_RULES, packId: PACK.id, moderated: true });
  addJeopardyPlayer(s, 'p0', 'Mod', true);
  addJeopardyPlayer(s, 'p1', 'Ben', false);

  const r = startJeopardy(s, PACK, 1000);
  assert.equal(r.ok, false, 'ein Mitspieler ist keine Sendung');
  assert.match(r.error ?? '', /Mitspieler|Spieler/);

  addJeopardyPlayer(s, 'p2', 'Clara', false);
  assert.equal(startJeopardy(s, PACK, 1000).ok, true);
});

test('Der Moderator wählt die Felder – der Picker nur den Wunsch', () => {
  const s = show();
  assert.equal(act(s, picker(s), { type: 'pick', col: 0, row: 0 }).ok, false, 'der Picker wählt nicht selbst');
  assert.equal(act(s, 'p0', { type: 'pick', col: 0, row: 0 }).ok, true);
  assert.equal(s.clue!.col, 0);
});

test('Auch moderiert geht der Buzzer nach der Vorlesezeit von selbst auf', () => {
  // Die Freigabe an einen Knopf zu hängen war der Fehler: Wer moderiert,
  // spielt am echten Tisch nebenher mit und hat keine Hand dafür frei.
  const s = show(undefined, { readSeconds: 10 });
  act(s, 'p0', { type: 'pick', col: 0, row: 0 }, 1000);
  assert.equal(s.clue!.step, 'reading');
  assert.equal(s.clue!.deadline, 11_000, 'die Vorlesezeit läuft');

  assert.equal(jeopardyTick(s, 10_500, PACK), false, 'vorher passiert nichts');
  assert.equal(s.clue!.step, 'reading');

  assert.equal(jeopardyTick(s, 11_001, PACK), true, 'ohne dass jemand einen Knopf drückt');
  assert.equal(s.clue!.step, 'buzzing');
});

test('Der Moderator kann die Vorlesezeit abkürzen, ein Mitspieler nicht', () => {
  const s = show(undefined, { readSeconds: 10 });
  act(s, 'p0', { type: 'pick', col: 0, row: 0 }, 1000);

  assert.equal(act(s, 'p1', { type: 'openBuzzer' }, 2000).ok, false, 'nur er kürzt ab');
  assert.equal(s.clue!.step, 'reading');
  assert.equal(act(s, 'p0', { type: 'openBuzzer' }, 2000).ok, true);
  assert.equal(s.clue!.step, 'buzzing');
});

test('Der Moderator buzzert nicht mit', () => {
  const s = show();
  act(s, 'p0', { type: 'pick', col: 0, row: 0 });
  act(s, 'p0', { type: 'openBuzzer' }, 2000);

  const r = act(s, 'p0', { type: 'buzz' }, 2100);
  assert.equal(r.ok, false);
  assert.match(r.error ?? '', /moderierst/);
});

test('Der Moderator wertet allein', () => {
  const s = show();
  act(s, 'p0', { type: 'pick', col: 0, row: 0 });
  act(s, 'p0', { type: 'openBuzzer' }, 2000);
  act(s, 'p1', { type: 'buzz' }, 2100);
  jeopardyTick(s, 2100 + BUZZ_GRACE_MS, PACK);
  act(s, 'p1', { type: 'answer', text: solution(s) }, 2300);
  assert.equal(s.clue!.step, 'judging');

  // Ohne die Sperre landete die Stimme zwar in `votes`, würde aber
  // mitgezählt – gewertet hätte dann doch die Runde.
  assert.equal(act(s, 'p2', { type: 'judge', correct: false }, 2400).ok, false, 'Mitspieler werten nicht');
  assert.deepEqual(s.clue!.votes, {});

  assert.equal(act(s, 'p0', { type: 'judge', correct: true }, 2500).ok, true);
  assert.equal(s.clue!.step, 'revealed', 'seine Stimme genügt');
  assert.equal(s.players.find((p) => p.id === 'p1')!.score, s.clue!.value);
});

test('Der Moderator löst auf und führt weiter', () => {
  const s = show();
  act(s, 'p0', { type: 'pick', col: 0, row: 0 });
  act(s, 'p0', { type: 'openBuzzer' }, 2000);

  assert.equal(act(s, 'p1', { type: 'skip' }, 2100).ok, false, 'auflösen darf nur er');
  assert.equal(act(s, 'p0', { type: 'skip' }, 2100).ok, true);
  assert.equal(s.clue!.step, 'revealed');

  assert.equal(act(s, 'p1', { type: 'next' }, 2200).ok, false);
  assert.equal(act(s, 'p0', { type: 'next' }, 2200).ok, true);
  assert.equal(s.clue, null, 'zurück zum Brett');
});

test('Der Moderator steht nicht in der Wertung', () => {
  const s = show();
  s.players[0].score = 9999; // käme er in die Wertung, gewänne er
  act(s, 'p0', { type: 'pick', col: 0, row: 0 });
  // Das letzte Feld: danach ist Schluss, und es wird abgerechnet.
  for (const col of s.board) col.used = col.used.map(() => true);
  act(s, 'p0', { type: 'skip' }, 2100);
  act(s, 'p0', { type: 'next' }, 3000);

  assert.equal(s.phase, 'ended');
  assert.notEqual(s.winnerId, 'p0', 'der Moderator gewinnt seine eigene Sendung nicht');
});

test('Ist der Moderator weg, gelten wieder die normalen Regeln', () => {
  const s = show();
  s.players[0].connected = false;

  // Sonst stünde die Sendung still: nur er dürfte wählen, und niemand
  // könnte ihn ersetzen.
  assert.equal(act(s, picker(s), { type: 'pick', col: 0, row: 0 }).ok, true);
  assert.equal(s.clue!.step, 'buzzing', 'ohne ihn greift wieder readSeconds: 0');
});

test('Die Ansicht verrät den Moderator, aber nicht die Antwort', () => {
  const s = show();
  act(s, 'p0', { type: 'pick', col: 0, row: 0 });
  const v = jeopardyView(s);
  assert.equal(v.players[0].moderator, true);
  assert.equal(v.clue!.answer, null);
  assert.equal(v.clue!.questionId, null);
});
