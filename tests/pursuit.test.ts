/**
 * Unit-Tests für Trivial Pursuit.
 *
 *   npm test
 *
 * Teil 1 prüft das Wegenetz. Das ist die Grundlage von allem: ist der Graph
 * falsch, ist jede Bewegung darüber falsch – und zwar auf eine Weise, die im
 * Browser kaum auffällt.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPursuitAction,
  addPursuitPlayer,
  createPursuit,
  localAdjustPursuit,
  pursuitDeadline,
  pursuitTick,
  pursuitView,
  resetPursuitToLobby,
  startPursuit,
} from '../shared/pursuit/engine';
import { DEFAULT_PURSUIT_RULES } from '../shared/pursuit/rules';
import type { PursuitAction, PursuitRules, PursuitState } from '../shared/pursuit/types';
import { normalize } from '../shared/trivia/ask';
import {
  MIN_PER_BUCKET,
  TRIVIA_LEVELS,
  type TriviaPack,
  type TriviaQuestion,
} from '../shared/trivia/types';
import {
  buildWheel,
  HQ_SPACING,
  HUB,
  hqNode,
  NODE_COUNT,
  pathTo,
  polar,
  reachable,
  RING_SIZE,
  spokeNode,
  SPOKE_LEN,
  WHEEL,
} from '../shared/pursuit/board';
import { TRIVIA_CATEGORIES } from '../shared/trivia/types';

// ---------------------------------------------------------------------------
// Das Wegenetz
// ---------------------------------------------------------------------------

test('Das Rad hat 73 Knoten: 42 Ring, 30 Speiche, 1 Nabe', () => {
  assert.equal(WHEEL.length, NODE_COUNT);
  assert.equal(NODE_COUNT, 73);
  assert.equal(RING_SIZE, 42);
  assert.equal(SPOKE_LEN * TRIVIA_CATEGORIES.length, 30);
  assert.equal(WHEEL[HUB].kind, 'hub');
});

test('Nachbarschaft ist symmetrisch', () => {
  for (const node of WHEEL) {
    for (const nx of node.next) {
      assert.ok(
        WHEEL[nx].next.includes(node.id),
        `${node.id} kennt ${nx}, aber nicht umgekehrt`
      );
    }
  }
});

test('Die Grade stimmen – und kein Knoten hat Grad 1', () => {
  // Grad 1 hieße: man kann dort nur zurück, und die Kehrtwende-Sperre würde
  // einen Spieler festsetzen.
  for (const node of WHEEL) {
    assert.ok(node.next.length >= 2, `Knoten ${node.id} hat Grad ${node.next.length}`);
  }
  assert.equal(WHEEL[HUB].next.length, TRIVIA_CATEGORIES.length, 'Nabe: sechs Speichen');
  for (let s = 0; s < TRIVIA_CATEGORIES.length; s++) {
    assert.equal(WHEEL[hqNode(s)].next.length, 3, 'Käse-Ecke: zwei Ringnachbarn plus Speiche');
  }
  assert.equal(WHEEL[1].next.length, 2, 'normales Ringfeld');
});

test('Die sechs Käse-Ecken liegen gleichmäßig im Ring', () => {
  const hqs = WHEEL.filter((n) => n.kind === 'hq').map((n) => n.id);
  assert.equal(hqs.length, TRIVIA_CATEGORIES.length);
  assert.deepEqual(hqs, [0, 7, 14, 21, 28, 35]);
  // Auch die Lücke zwischen der letzten und der ersten Ecke muss stimmen.
  for (let i = 0; i < hqs.length; i++) {
    const gap = (hqs[(i + 1) % hqs.length] - hqs[i] + RING_SIZE) % RING_SIZE;
    assert.equal(gap, HQ_SPACING, `Abstand ${i} → ${i + 1}`);
  }
  // Jede Kategorie genau einmal.
  assert.equal(new Set(hqs.map((id) => WHEEL[id].category)).size, TRIVIA_CATEGORIES.length);
});

test('Jede Farbe kommt im Ring genau fünfmal vor', () => {
  // 42 = 6 · 7, minus je eine Käse-Ecke und ein „Nochmal würfeln" pro Farbe.
  // Das ist der Grund für die 42 – eine unbalancierte Verteilung fiele sonst
  // niemandem auf.
  const counts = new Map<string, number>();
  for (const n of WHEEL) {
    if (n.ring === null || n.kind !== 'category') continue;
    counts.set(n.category!, (counts.get(n.category!) ?? 0) + 1);
  }
  for (const c of TRIVIA_CATEGORIES) assert.equal(counts.get(c), 5, `${c} im Ring`);
});

test('Jede Speiche führt von ihrer Käse-Ecke zur Nabe', () => {
  for (let s = 0; s < TRIVIA_CATEGORIES.length; s++) {
    assert.ok(WHEEL[hqNode(s)].next.includes(spokeNode(s, 0)), 'Ecke hängt an der Speiche');
    for (let j = 0; j < SPOKE_LEN - 1; j++) {
      assert.ok(WHEEL[spokeNode(s, j)].next.includes(spokeNode(s, j + 1)));
    }
    assert.ok(WHEEL[spokeNode(s, SPOKE_LEN - 1)].next.includes(HUB), 'innerstes Feld an der Nabe');
    // In der Mitte jeder Speiche steht ein Freiwurf.
    assert.equal(WHEEL[spokeNode(s, 2)].kind, 'rollAgain');
  }
});

test('Von der Nabe aus ist jeder Knoten erreichbar', () => {
  const seen = new Set<number>([HUB]);
  const queue = [HUB];
  while (queue.length) {
    for (const nx of WHEEL[queue.shift()!].next) {
      if (!seen.has(nx)) {
        seen.add(nx);
        queue.push(nx);
      }
    }
  }
  assert.equal(seen.size, NODE_COUNT, 'kein abgehängter Knoten');
});

test('buildWheel ist deterministisch und WHEEL ist eingefroren', () => {
  assert.deepEqual(buildWheel(), buildWheel());
  assert.throws(() => {
    (WHEEL as unknown as { length: number }).length = 0;
  });
});

// ---------------------------------------------------------------------------
// Bewegung
// ---------------------------------------------------------------------------

test('reachable liefert für jedes Feld und jede Augenzahl ein Ziel', () => {
  // Festsitzen darf niemand – das ist die Zusage, die aus „kein Grad 1" folgt.
  for (let id = 0; id < NODE_COUNT; id++) {
    for (let steps = 1; steps <= 6; steps++) {
      const targets = reachable(id, steps);
      assert.ok(targets.length > 0, `Feld ${id} mit ${steps} Schritten steht still`);
      assert.ok(!targets.includes(id), `Feld ${id} führt mit ${steps} Schritten zu sich selbst`);
    }
  }
});

test('Im Ring geht es genau in beide Richtungen', () => {
  // Feld 10 ist ein Freiwurf-Feld ohne Abzweigung – von dort sind es mit zwei
  // Schritten genau zwei Ziele.
  assert.deepEqual(reachable(10, 2), [8, 12]);
  assert.deepEqual(reachable(10, 1), [9, 11]);
});

test('Die Kehrtwende mitten im Zug ist gesperrt', () => {
  // Ohne die Sperre wäre das Startfeld selbst mit zwei Schritten erreichbar.
  assert.ok(!reachable(10, 2).includes(10));
  assert.ok(!reachable(HUB, 2).includes(HUB));
});

test('An der Käse-Ecke zweigt der Weg in die Speiche ab', () => {
  const hq = hqNode(0);
  const one = reachable(hq, 1);
  assert.equal(one.length, 3, 'links, rechts, nach innen');
  assert.ok(one.includes(1));
  assert.ok(one.includes(RING_SIZE - 1));
  assert.ok(one.includes(spokeNode(0, 0)));
});

test('Von der Nabe führen sechs Wege hinaus', () => {
  const one = reachable(HUB, 1);
  assert.equal(one.length, TRIVIA_CATEGORIES.length);
  for (let s = 0; s < TRIVIA_CATEGORIES.length; s++) {
    assert.ok(one.includes(spokeNode(s, SPOKE_LEN - 1)), `Speiche ${s}`);
  }
});

test('Die Nabe muss exakt getroffen werden', () => {
  // Von einer Käse-Ecke sind es fünf Speichenfelder plus die Nabe = 6.
  const hq = hqNode(2);
  assert.ok(reachable(hq, 6).includes(HUB), 'mit genau sechs Schritten');
  assert.ok(!reachable(hq, 5).includes(HUB), 'mit fünf nicht');
  // Mit sieben liefe man durch die Nabe hindurch und käme in einer anderen
  // Speiche wieder heraus – das ist erlaubt, aber eben kein Treffer.
  const seven = reachable(hq, 7);
  assert.ok(!seven.includes(HUB));
  assert.ok(
    seven.some((id) => id >= RING_SIZE && id < HUB && Math.floor((id - RING_SIZE) / SPOKE_LEN) !== 2),
    'durch die Nabe in eine andere Speiche'
  );
});

test('pathTo liefert einen gültigen Weg der richtigen Länge', () => {
  const target = reachable(0, 4)[0];
  const path = pathTo(0, 4, target)!;
  assert.ok(path, 'es gibt einen Weg');
  assert.equal(path.length, 5, 'Start plus vier Schritte');
  assert.equal(path[0], 0);
  assert.equal(path[path.length - 1], target);
  for (let i = 1; i < path.length; i++) {
    assert.ok(WHEEL[path[i - 1]].next.includes(path[i]), `${path[i - 1]} → ${path[i]} ist keine Kante`);
    if (i >= 2) assert.notEqual(path[i], path[i - 2], 'keine Kehrtwende');
  }
  assert.equal(pathTo(0, 4, HUB), null, 'unerreichbares Ziel gibt null');
});

test('polar rechnet 0° nach oben und dreht im Uhrzeigersinn', () => {
  const top = polar(0, 1);
  assert.ok(Math.abs(top.x) < 1e-9);
  assert.ok(Math.abs(top.y + 1) < 1e-9, 'Feld 0 liegt oben');
  const right = polar(90, 1);
  assert.ok(Math.abs(right.x - 1) < 1e-9, '90° liegt rechts');
});

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/**
 * Ein vollständiges Paket, in dem die Antwort jeder Frage ihre ID ist – wie
 * bei den Jeopardy-Tests. So kennen die Tests die Lösung, ohne sie aus dem
 * geschwärzten Zustand lesen zu müssen.
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

function game(names = ['Anna', 'Ben', 'Clara'], rules: Partial<PursuitRules> = {}) {
  const s = createPursuit('TEST', {
    ...DEFAULT_PURSUIT_RULES,
    packId: PACK.id,
    // Ohne gesetzte Würfel wäre kein einziger Test reproduzierbar.
    debugMode: true,
    ...rules,
  });
  names.forEach((n, i) => addPursuitPlayer(s, `p${i}`, n, i === 0));
  const r = startPursuit(s, PACK, 1000);
  assert.equal(r.ok, true, r.error);
  // Zugreihenfolge festnageln: der Start ist absichtlich zufällig.
  s.currentPlayer = 0;
  return s;
}

function act(s: PursuitState, playerId: string, action: PursuitAction, now = 1000) {
  return applyPursuitAction(s, playerId, action, PACK, now);
}

const who = (s: PursuitState) => s.players[s.currentPlayer].id;
/** Die richtige Antwort – im Testpaket ist sie gleich der Frage-ID. */
const solution = (s: PursuitState) => s.clue!.answer!;

/** Würfeln mit gesetzter Augenzahl und auf ein bestimmtes Feld ziehen. */
function rollTo(s: PursuitState, die: number, target: number, now = 1000) {
  const me = who(s);
  assert.equal(act(s, me, { type: 'setDie', die }, now).ok, true);
  assert.equal(act(s, me, { type: 'roll' }, now).ok, true, 'würfeln');
  if (s.turnPhase === 'awaiting-move') {
    const r = act(s, me, { type: 'move', to: target }, now);
    assert.equal(r.ok, true, r.error);
  }
  assert.equal(s.players.find((p) => p.id === me)!.position, target);
}

/** Multiple Choice richtig bzw. falsch beantworten und weiterklicken. */
function answerWith(s: PursuitState, correct: boolean, now = 1000) {
  const me = who(s);
  const c = s.clue!;
  const pick = correct
    ? c.options.find((o) => normalize(o) === normalize(c.answer!))!
    : c.options.find((o) => normalize(o) !== normalize(c.answer!))!;
  const r = act(s, me, { type: 'answer', text: pick }, now);
  assert.equal(r.ok, true, r.error);
  assert.equal(s.clue!.correct, correct);
}

test('Zu Beginn stehen alle in der Mitte', () => {
  const s = game();
  for (const p of s.players) {
    assert.equal(p.position, HUB);
    assert.deepEqual(p.wedges, []);
  }
  assert.equal(s.turnPhase, 'awaiting-roll');
});

test('Ein Wurf öffnet genau die erreichbaren Ziele', () => {
  const s = game();
  act(s, 'p0', { type: 'setDie', die: 3 });
  act(s, 'p0', { type: 'roll' });
  assert.equal(s.die, 3);
  assert.deepEqual(s.moveOptions, reachable(HUB, 3));
  assert.equal(s.turnPhase, 'awaiting-move');
});

test('Würfeln und Ziehen außer der Reihe wird abgelehnt', () => {
  const s = game();
  assert.equal(act(s, 'p1', { type: 'roll' }).ok, false);
  act(s, 'p0', { type: 'setDie', die: 3 });
  act(s, 'p0', { type: 'roll' });
  assert.equal(act(s, 'p1', { type: 'move', to: s.moveOptions[0] }).ok, false);
});

test('Ein Feld außerhalb der Reichweite wird abgelehnt', () => {
  // Sonst wäre das ganze Wegenetz Dekoration.
  const s = game();
  act(s, 'p0', { type: 'setDie', die: 2 });
  act(s, 'p0', { type: 'roll' });
  const unreachable = [...Array(NODE_COUNT).keys()].find((i) => !s.moveOptions.includes(i))!;
  const r = act(s, 'p0', { type: 'move', to: unreachable });
  assert.equal(r.ok, false);
  assert.match(r.error ?? '', /nicht erreichbar/);
});

test('Ein Freiwurf-Feld stellt keine Frage und gibt denselben Spieler frei', () => {
  const s = game();
  // Speiche 0, mittleres Feld (j = 2) ist ein Freiwurf: von der Nabe drei Schritte.
  rollTo(s, 3, spokeNode(0, 2));
  assert.equal(s.clue, null, 'keine Frage');
  assert.equal(s.turnPhase, 'awaiting-roll');
  assert.equal(who(s), 'p0', 'derselbe Spieler');
});

test('Richtig beantwortet heißt: nochmal würfeln', () => {
  const s = game();
  rollTo(s, 1, spokeNode(0, 4));
  assert.equal(s.turnPhase, 'awaiting-answer');
  answerWith(s, true);
  assert.equal(s.turnPhase, 'revealed');
  act(s, 'p0', { type: 'next' });
  assert.equal(who(s), 'p0');
  assert.equal(s.turnPhase, 'awaiting-roll');
});

test('Falsch beantwortet heißt: nächster Spieler', () => {
  const s = game();
  rollTo(s, 1, spokeNode(0, 4));
  answerWith(s, false);
  act(s, 'p0', { type: 'next' });
  assert.equal(who(s), 'p1');
});

test('Multiple Choice nimmt nur die angebotenen Möglichkeiten', () => {
  const s = game();
  rollTo(s, 1, spokeNode(0, 4));
  assert.equal(s.clue!.options.length, 4);
  assert.ok(s.clue!.options.includes(s.clue!.answer!));
  const r = act(s, 'p0', { type: 'answer', text: 'irgendwas Ausgedachtes' });
  assert.equal(r.ok, false, 'freie Eingabe ist im Ankreuz-Modus nicht erlaubt');
});

test('Eine Käse-Ecke bringt genau ein Käsestück – auch beim zweiten Besuch', () => {
  const s = game();
  const hq = hqNode(0);
  const category = WHEEL[hq].category!;

  // Von der Nabe über die Speiche 0 nach außen: 6 Schritte auf die Ecke.
  rollTo(s, 6, hq);
  assert.equal(s.clue!.forWedge, true);
  answerWith(s, true);
  act(s, 'p0', { type: 'next' });
  assert.deepEqual(s.players[0].wedges, [category]);

  // Nochmal dieselbe Ecke: Frage ja, zweites Käsestück nein.
  rollTo(s, 2, hqNode(0) + 2);
  answerWith(s, true);
  act(s, 'p0', { type: 'next' });
  rollTo(s, 2, hq);
  assert.equal(s.clue!.forWedge, false, 'die Farbe ist schon im Besitz');
  answerWith(s, true);
  act(s, 'p0', { type: 'next' });
  assert.deepEqual(s.players[0].wedges, [category], 'kein zweites Stück');
});

test('Die Nabe ohne alle Käsestücke ist ein normales Feld', () => {
  const s = game();
  rollTo(s, 6, hqNode(0));
  answerWith(s, false);
  act(s, 'p0', { type: 'next' });
  // Zurück in die Mitte, ohne Käsestücke.
  s.currentPlayer = 0;
  s.players[0].position = hqNode(0);
  rollTo(s, 6, HUB);
  assert.equal(s.turnPhase, 'awaiting-answer', 'kein totes Feld');
  assert.equal(s.clue!.final, false);
});

// ---------------------------------------------------------------------------
// Die Schlussfrage
// ---------------------------------------------------------------------------

/** Setzt einen Spieler mit allen Käsestücken direkt vor die Mitte. */
function readyForFinal(s: PursuitState, id = 'p0') {
  const p = s.players.find((x) => x.id === id)!;
  p.wedges = [...TRIVIA_CATEGORIES];
  p.position = hqNode(0);
  s.currentPlayer = s.players.indexOf(p);
}

test('Die Schlussfrage gibt es nur mit allen Käsestücken und exakt auf der Nabe', () => {
  const s = game();
  readyForFinal(s);
  assert.ok(!reachable(hqNode(0), 5).includes(HUB), 'mit fünf trifft man nicht');

  rollTo(s, 6, HUB);
  assert.equal(s.turnPhase, 'awaiting-category', 'die Runde wählt die Farbe');
});

test('Die Mitspieler stimmen über die Farbe ab – Mehrheit entscheidet', () => {
  const s = game(['Anna', 'Ben', 'Clara']);
  readyForFinal(s);
  rollTo(s, 6, HUB);

  assert.equal(act(s, 'p0', { type: 'voteCategory', category: 'sport' }).ok, false, 'nicht selbst');
  act(s, 'p1', { type: 'voteCategory', category: 'sport' });
  assert.equal(s.turnPhase, 'awaiting-category', 'noch fehlt eine Stimme');
  act(s, 'p2', { type: 'voteCategory', category: 'sport' });

  assert.equal(s.turnPhase, 'awaiting-answer');
  assert.equal(s.clue!.category, 'sport');
  assert.equal(s.clue!.final, true);
});

test('Bei Gleichstand entscheidet die Reihenfolge der Kategorien, nicht der Zufall', () => {
  const s = game(['Anna', 'Ben', 'Clara']);
  readyForFinal(s);
  rollTo(s, 6, HUB);
  act(s, 'p1', { type: 'voteCategory', category: 'sport' });
  act(s, 'p2', { type: 'voteCategory', category: 'geografie' });
  // 'geografie' steht in TRIVIA_CATEGORIES vor 'sport'.
  assert.equal(s.clue!.category, 'geografie');
});

test('Die Schlussfrage richtig beantwortet gewinnt die Partie', () => {
  const s = game();
  readyForFinal(s);
  rollTo(s, 6, HUB);
  act(s, 'p1', { type: 'voteCategory', category: 'kunst' });
  act(s, 'p2', { type: 'voteCategory', category: 'kunst' });
  answerWith(s, true);
  assert.equal(s.winnerId, 'p0');
  act(s, 'p0', { type: 'next' });
  assert.equal(s.phase, 'ended');
});

test('Die Schlussfrage falsch beantwortet lässt weiterspielen', () => {
  const s = game();
  readyForFinal(s);
  rollTo(s, 6, HUB);
  act(s, 'p1', { type: 'voteCategory', category: 'kunst' });
  act(s, 'p2', { type: 'voteCategory', category: 'kunst' });
  answerWith(s, false);
  act(s, 'p0', { type: 'next' });
  assert.equal(s.phase, 'playing');
  assert.equal(s.winnerId, null);
  assert.equal(who(s), 'p1', 'der Nächste ist dran');
  assert.equal(s.players[0].position, HUB, 'er steht weiter in der Mitte');
});

// ---------------------------------------------------------------------------
// Freitext
// ---------------------------------------------------------------------------

test('Im Freitext-Modus werten die Mitspieler', () => {
  const s = game(['Anna', 'Ben', 'Clara'], { freeText: true });
  rollTo(s, 1, spokeNode(0, 4));
  assert.deepEqual(s.clue!.options, [], 'nichts anzukreuzen');

  act(s, 'p0', { type: 'answer', text: solution(s) });
  assert.equal(s.turnPhase, 'awaiting-judge');
  assert.equal(s.clue!.suggestion, true, 'die Vorprüfung schlägt „richtig" vor');
  assert.equal(act(s, 'p0', { type: 'judge', correct: true }).ok, false, 'nicht über sich selbst');

  act(s, 'p1', { type: 'judge', correct: true });
  act(s, 'p2', { type: 'judge', correct: true });
  assert.equal(s.clue!.correct, true);
});

test('Die Runde kann den Vorschlag überstimmen', () => {
  const s = game(['Anna', 'Ben', 'Clara'], { freeText: true });
  rollTo(s, 1, spokeNode(0, 4));
  act(s, 'p0', { type: 'answer', text: 'völlig daneben' });
  assert.equal(s.clue!.suggestion, false);
  act(s, 'p1', { type: 'judge', correct: true });
  act(s, 'p2', { type: 'judge', correct: true });
  assert.equal(s.clue!.correct, true, 'Mehrheit schlägt Vorschlag');
});

test('Leer abgeschickt gilt ohne Abstimmung als falsch', () => {
  const s = game(['Anna', 'Ben'], { freeText: true });
  rollTo(s, 1, spokeNode(0, 4));
  act(s, 'p0', { type: 'answer', text: '   ' });
  assert.equal(s.turnPhase, 'revealed', 'keine Wertungsrunde');
  assert.equal(s.clue!.correct, false);
});

// ---------------------------------------------------------------------------
// Redaktion, Uhren, Rematch
// ---------------------------------------------------------------------------

test('Antwort und Frage-Kennung verlassen den Server erst bei der Auflösung', () => {
  const s = game();
  rollTo(s, 1, spokeNode(0, 4));
  assert.equal(pursuitView(s).clue!.answer, null);
  assert.equal(pursuitView(s).clue!.questionId, null, 'sonst schlägt man sie im Paket nach');
  assert.equal(pursuitView(s).clue!.options.length, 4, 'die Auswahl bleibt sichtbar');

  answerWith(s, true);
  assert.equal(pursuitView(s).clue!.answer, s.clue!.answer, 'jetzt schon');
});

test('Die Redaktion verändert den echten Zustand nicht', () => {
  const s = game();
  rollTo(s, 1, spokeNode(0, 4));
  const before = s.clue!.answer;
  pursuitView(s);
  assert.equal(s.clue!.answer, before);
});

test('Wer nicht rechtzeitig antwortet, hat falsch geantwortet', () => {
  const s = game();
  rollTo(s, 1, spokeNode(0, 4));
  const deadline = s.clue!.deadline!;
  assert.equal(pursuitDeadline(s, 1000), deadline);
  assert.equal(pursuitTick(s, deadline), true);
  assert.equal(s.clue!.correct, false);
});

test('Ein getrennter Spieler blockiert das Rad nicht', () => {
  // Würfeln und Ziehen haben sonst keine Uhr – nur für Getrennte.
  const s = game();
  assert.equal(pursuitDeadline(s, 1000), null, 'wer da ist, darf sich Zeit lassen');
  s.players[0].connected = false;
  const at = pursuitDeadline(s, 1000)!;
  assert.ok(at > 1000);
  assert.equal(pursuitTick(s, at), true);
  assert.equal(who(s), 'p1', 'der Zug ist weitergewandert');
});

test('Am gemeinsamen Gerät tickt keine Uhr', () => {
  const s = game();
  s.local = true;
  rollTo(s, 1, spokeNode(0, 4));
  localAdjustPursuit(s, 5000);
  assert.equal(s.clue!.deadline, null);
  assert.equal(pursuitDeadline(s, 5000), null);
});

test('Lokal genügt ein Tipp zum Werten', () => {
  const s = game(['Anna', 'Ben', 'Clara'], { freeText: true });
  s.local = true;
  rollTo(s, 1, spokeNode(0, 4));
  act(s, 'p0', { type: 'answer', text: solution(s) });
  act(s, 'p1', { type: 'judge', correct: true });
  assert.equal(s.turnPhase, 'revealed', 'kein Warten auf die zweite Stimme');
});

test('Der Rematch setzt Positionen, Käse und verbrauchte Fragen zurück', () => {
  // Wird gern vergessen und fällt erst in der zweiten Runde auf.
  const s = game();
  rollTo(s, 6, hqNode(0));
  answerWith(s, true);
  act(s, 'p0', { type: 'next' });
  assert.equal(s.players[0].wedges.length, 1);
  assert.ok(s.usedQuestionIds.length > 0);

  resetPursuitToLobby(s);
  assert.equal(s.phase, 'lobby');
  assert.deepEqual(s.usedQuestionIds, []);
  assert.equal(s.clue, null);
  assert.deepEqual(s.moveOptions, []);
  for (const p of s.players) {
    assert.equal(p.position, HUB);
    assert.deepEqual(p.wedges, []);
  }
  assert.equal(startPursuit(s, PACK, 2000).ok, true, 'lässt sich erneut starten');
});

test('Aussteigen gibt den Zug weiter, und zu zweit endet die Partie', () => {
  const s = game(['Anna', 'Ben', 'Clara']);
  act(s, 'p0', { type: 'resign' });
  assert.equal(who(s), 'p1', 'der Zug hängt nicht am leeren Sitz');
  act(s, 'p1', { type: 'resign' });
  assert.equal(s.phase, 'ended');
});

test('Die Fragen gehen über eine lange Partie nicht aus', () => {
  // Dreistufiges Ziehen: gewünschte Stufe → beliebige Stufe → wieder freigeben.
  const s = game();
  const seen: string[] = [];
  for (let i = 0; i < 300; i++) {
    s.turnPhase = 'awaiting-roll';
    s.currentPlayer = 0;
    s.players[0].position = HUB;
    rollTo(s, 1, spokeNode(i % 6, 4));
    assert.ok(s.clue, `Zug ${i + 1} liefert eine Frage`);
    seen.push(s.clue!.questionId!);
    answerWith(s, false);
    act(s, 'p0', { type: 'next' });
  }
  assert.equal(seen.length, 300);
});
