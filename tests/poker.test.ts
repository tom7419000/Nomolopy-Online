/**
 * Unit-Tests für die Poker-Engine (node:test, via `npm test`).
 * Hände werden über präparierte Decks deterministisch gemacht.
 *
 * Kartenkodierung: rank = card % 13 (0=„2" … 12=Ass), suit = floor(card/13).
 * Gegeben wird je zwei Karten am Stück, beginnend links vom Dealer; danach
 * kommen Flop (3), Turn (1), River (1) – ohne Burn-Karten.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestHand, evaluate5, handName, makeCard } from '../shared/poker/hands';
import {
  addPokerPlayer,
  applyPokerAction,
  createPoker,
  getPokerPlayer,
  pokerTick,
  potTotal,
  startHand,
  startPoker,
  viewFor,
  HIDDEN_CARD,
} from '../shared/poker/engine';
import { DEFAULT_POKER_RULES } from '../shared/poker/rules';
import type { PokerRules, PokerState } from '../shared/poker/types';

const NOW = 1_700_000_000_000;

// Lesbare Kartennotation: C('A','♠')
const RANK_OF: Record<string, number> = {
  '2': 0, '3': 1, '4': 2, '5': 3, '6': 4, '7': 5, '8': 6, '9': 7, '10': 8, B: 9, D: 10, K: 11, A: 12,
};
const SUIT_OF: Record<string, number> = { '♠': 0, '♥': 1, '♦': 2, '♣': 3 };
function C(rank: string, suit: string): number {
  return makeCard(RANK_OF[rank], SUIT_OF[suit]);
}

function fillDeck(top: number[]): number[] {
  const used = new Set(top);
  const rest: number[] = [];
  for (let c = 0; c < 52; c++) if (!used.has(c)) rest.push(c);
  return [...top, ...rest];
}

/**
 * Spiel mit kontrolliertem Dealer und Deck starten.
 * dealerBefore: Sitz, VON dem aus der Button weitergereicht wird
 * (bei dealerBefore = letzter Sitz wird also Sitz 0 Dealer).
 */
function begin(
  names: string[],
  opts: {
    dealerBefore?: number;
    deck?: number[];
    chips?: number[];
    rules?: Partial<PokerRules>;
    now?: number;
  } = {}
): PokerState {
  const rules: PokerRules = { ...DEFAULT_POKER_RULES, blindIncreaseMinutes: 0, ...opts.rules };
  const state = createPoker('TEST1', rules, opts.now ?? NOW);
  names.forEach((n, i) => {
    const r = addPokerPlayer(state, `p${i + 1}`, n, i === 0);
    assert.ok(r.ok, r.error);
  });
  state.phase = 'playing';
  state.startedAt = opts.now ?? NOW;
  state.players.forEach((p, i) => {
    p.chips = opts.chips?.[i] ?? rules.buyIn;
  });
  state.dealerIndex = opts.dealerBefore ?? names.length - 1;
  startHand(state, opts.now ?? NOW, opts.deck ? fillDeck(opts.deck) : undefined);
  return state;
}

function act(state: PokerState, playerId: string, action: Parameters<typeof applyPokerAction>[2], now = NOW) {
  const r = applyPokerAction(state, playerId, action, now);
  assert.ok(r.ok, `${playerId} ${JSON.stringify(action)}: ${r.error}`);
  return r;
}

function toAct(state: PokerState): string {
  assert.notEqual(state.toActIndex, null, 'niemand am Zug');
  return state.players[state.toActIndex!].id;
}

// ---------------------------------------------------------------------------
// Hand-Bewertung
// ---------------------------------------------------------------------------

test('Hand-Rankings: Kategorien in korrekter Reihenfolge', () => {
  const hands = [
    evaluate5([C('A', '♠'), C('K', '♠'), C('D', '♠'), C('B', '♠'), C('10', '♠')]), // Royal Flush
    evaluate5([C('9', '♥'), C('8', '♥'), C('7', '♥'), C('6', '♥'), C('5', '♥')]), // Straight Flush
    evaluate5([C('A', '♠'), C('A', '♥'), C('A', '♦'), C('A', '♣'), C('2', '♠')]), // Vierling
    evaluate5([C('K', '♠'), C('K', '♥'), C('K', '♦'), C('2', '♣'), C('2', '♠')]), // Full House
    evaluate5([C('A', '♦'), C('B', '♦'), C('9', '♦'), C('6', '♦'), C('3', '♦')]), // Flush
    evaluate5([C('8', '♠'), C('7', '♥'), C('6', '♦'), C('5', '♣'), C('4', '♠')]), // Straße
    evaluate5([C('D', '♠'), C('D', '♥'), C('D', '♦'), C('7', '♣'), C('2', '♠')]), // Drilling
    evaluate5([C('B', '♠'), C('B', '♥'), C('4', '♦'), C('4', '♣'), C('A', '♠')]), // Zwei Paare
    evaluate5([C('10', '♠'), C('10', '♥'), C('A', '♦'), C('7', '♣'), C('2', '♠')]), // Ein Paar
    evaluate5([C('A', '♠'), C('B', '♥'), C('8', '♦'), C('6', '♣'), C('3', '♠')]), // Höchste Karte
  ];
  for (let i = 1; i < hands.length; i++) {
    assert.ok(hands[i - 1].score > hands[i].score, `Hand ${i - 1} muss Hand ${i} schlagen`);
  }
  assert.equal(hands[0].category, 8);
  assert.equal(hands[9].category, 0);
});

test('Wheel (A-2-3-4-5) ist eine Straße mit Höchstkarte 5', () => {
  const wheel = evaluate5([C('A', '♠'), C('2', '♥'), C('3', '♦'), C('4', '♣'), C('5', '♠')]);
  assert.equal(wheel.category, 4);
  const sixHigh = evaluate5([C('2', '♥'), C('3', '♦'), C('4', '♣'), C('5', '♠'), C('6', '♠')]);
  assert.ok(sixHigh.score > wheel.score, '6-high schlägt Wheel');
  // A-K-D-B-10 um die Ecke gibt es nicht
  const noWrap = evaluate5([C('D', '♠'), C('K', '♥'), C('A', '♦'), C('2', '♣'), C('3', '♠')]);
  assert.equal(noWrap.category, 0);
});

test('Kicker entscheiden bei gleichem Paar', () => {
  const kingsAce = evaluate5([C('K', '♠'), C('K', '♥'), C('A', '♦'), C('7', '♣'), C('2', '♠')]);
  const kingsQueen = evaluate5([C('K', '♦'), C('K', '♣'), C('D', '♦'), C('7', '♠'), C('2', '♥')]);
  assert.ok(kingsAce.score > kingsQueen.score);

  const twoPairHigh = evaluate5([C('A', '♠'), C('A', '♥'), C('3', '♦'), C('3', '♣'), C('4', '♠')]);
  const twoPairLow = evaluate5([C('K', '♠'), C('K', '♥'), C('D', '♦'), C('D', '♣'), C('A', '♠')]);
  assert.ok(twoPairHigh.score > twoPairLow.score, 'höheres Top-Paar gewinnt');

  const fullHouseTrips = evaluate5([C('9', '♠'), C('9', '♥'), C('9', '♦'), C('2', '♣'), C('2', '♠')]);
  const fullHousePair = evaluate5([C('8', '♠'), C('8', '♥'), C('8', '♦'), C('A', '♣'), C('A', '♠')]);
  assert.ok(fullHouseTrips.score > fullHousePair.score, 'Drilling zählt vor Paar');
});

test('bestHand findet die beste 5er-Kombination aus 7 Karten', () => {
  // 7 Karten mit verstecktem Flush
  const v = bestHand([
    C('A', '♠'), C('K', '♥'), C('2', '♦'),
    C('9', '♣'), C('7', '♣'), C('5', '♣'), C('3', '♣'), // nur 4 Kreuz …
  ]);
  assert.notEqual(v.category, 5, 'vier Kreuz sind kein Flush');

  const flush = bestHand([
    C('A', '♣'), C('K', '♥'), C('2', '♦'),
    C('9', '♣'), C('7', '♣'), C('5', '♣'), C('3', '♣'),
  ]);
  assert.equal(flush.category, 5);
  assert.equal(handName(flush), 'Flush (A hoch)');

  // Identische Boards → identischer Score (Split)
  const board = [C('A', '♠'), C('A', '♥'), C('K', '♦'), C('K', '♣'), C('D', '♠')];
  const a = bestHand([...board, C('2', '♦'), C('3', '♦')]);
  const b = bestHand([...board, C('4', '♣'), C('5', '♣')]);
  assert.equal(a.score, b.score, 'Board spielt für beide');
});

test('handName liefert deutsche Bezeichnungen', () => {
  assert.equal(handName(evaluate5([C('A', '♠'), C('K', '♠'), C('D', '♠'), C('B', '♠'), C('10', '♠')])), 'Royal Flush');
  assert.equal(handName(evaluate5([C('8', '♠'), C('8', '♥'), C('8', '♦'), C('A', '♣'), C('2', '♠')])), 'Drilling (8)');
  assert.equal(
    handName(evaluate5([C('K', '♠'), C('K', '♥'), C('8', '♦'), C('8', '♣'), C('A', '♠')])),
    'Zwei Paare (K und 8)'
  );
});

// ---------------------------------------------------------------------------
// Spielablauf
// ---------------------------------------------------------------------------

test('Hand-Start: Dealer, Blinds, Karten, Reihenfolge (3 Spieler)', () => {
  const g = begin(['Anna', 'Ben', 'Cleo']);
  // dealerBefore = 2 → Dealer ist Sitz 0 (Anna), SB Ben, BB Cleo
  assert.equal(g.dealerIndex, 0);
  const [anna, ben, cleo] = g.players;
  assert.equal(ben.bet, 10);
  assert.equal(cleo.bet, 20);
  assert.equal(g.currentBet, 20);
  assert.equal(anna.chips, 2000);
  assert.equal(ben.chips, 1990);
  for (const p of g.players) assert.equal(p.hole?.length, 2);
  // Preflop beginnt links vom Big Blind → Anna (Button, 3-handed)
  assert.equal(toAct(g), 'p1');
  assert.equal(potTotal(g), 30);
});

test('Alle folden → Big Blind gewinnt ohne Showdown', () => {
  const g = begin(['Anna', 'Ben', 'Cleo']);
  act(g, 'p1', { type: 'fold' });
  act(g, 'p2', { type: 'fold' });
  assert.equal(g.street, 'showdown');
  assert.ok(g.handResult?.foldWin);
  assert.equal(g.handResult?.reveal.length, 0, 'keine Karten aufdecken');
  const cleo = getPokerPlayer(g, 'p3')!;
  assert.equal(cleo.chips, 2000 + 10, 'BB gewinnt den Small Blind');
  assert.equal(g.handResult?.pots[0].amount, 30);
});

test('Komplette Hand bis zum Showdown – bester gewinnt', () => {
  // Dealer Anna → gegeben wird ab Ben: Ben, Cleo, Anna
  const deck = [
    C('K', '♠'), C('K', '♥'), // Ben
    C('D', '♠'), C('D', '♥'), // Cleo
    C('A', '♠'), C('A', '♥'), // Anna
    C('2', '♦'), C('7', '♣'), C('9', '♠'), // Flop
    C('B', '♦'), // Turn
    C('3', '♣'), // River
  ];
  const g = begin(['Anna', 'Ben', 'Cleo'], { deck });
  act(g, 'p1', { type: 'call' }); // Anna callt 20
  act(g, 'p2', { type: 'call' }); // Ben (SB) komplettiert
  act(g, 'p3', { type: 'check' }); // Cleo (BB) – Option
  assert.equal(g.street, 'flop');
  assert.equal(g.community.length, 3);
  // Postflop beginnt links vom Dealer → Ben
  assert.equal(toAct(g), 'p2');
  act(g, 'p2', { type: 'check' });
  act(g, 'p3', { type: 'check' });
  act(g, 'p1', { type: 'raise', to: 100 }); // Bet 100
  act(g, 'p2', { type: 'call' });
  act(g, 'p3', { type: 'fold' });
  assert.equal(g.street, 'turn');
  act(g, 'p2', { type: 'check' });
  act(g, 'p1', { type: 'check' });
  assert.equal(g.street, 'river');
  act(g, 'p2', { type: 'check' });
  act(g, 'p1', { type: 'check' });

  assert.equal(g.street, 'showdown');
  assert.equal(g.community.length, 5);
  const result = g.handResult!;
  assert.equal(result.foldWin, false);
  assert.equal(result.reveal.length, 2, 'Anna und Ben decken auf');
  assert.equal(result.pots.length, 1);
  // Pot: 3×20 (preflop) + 2×100 = 260, Anna gewinnt mit Paar Asse
  assert.equal(result.pots[0].amount, 260);
  assert.deepEqual(result.pots[0].winners, [{ playerId: 'p1', amount: 260 }]);
  assert.equal(result.pots[0].handName, 'Ein Paar (A)');
  assert.equal(getPokerPlayer(g, 'p1')!.chips, 2000 - 120 + 260);
});

test('Check gegen offenen Einsatz ist verboten, Mindest-Raise gilt', () => {
  const g = begin(['Anna', 'Ben', 'Cleo']);
  const r1 = applyPokerAction(g, 'p1', { type: 'check' }, NOW);
  assert.equal(r1.ok, false);
  const r2 = applyPokerAction(g, 'p1', { type: 'raise', to: 30 }, NOW); // min wäre 40
  assert.equal(r2.ok, false);
  act(g, 'p1', { type: 'raise', to: 60 }); // Raise um 40 (min 20) ✓
  assert.equal(g.currentBet, 60);
  assert.equal(g.minRaise, 40);
  // Re-Raise eröffnet die Runde für alle neu – auch Anna muss ggf. wieder handeln
  act(g, 'p2', { type: 'raise', to: 160 });
  assert.deepEqual([...g.needToAct].sort(), ['p1', 'p3']);
});

test('Heads-up: Dealer ist Small Blind und beginnt preflop', () => {
  const g = begin(['Anna', 'Ben'], { dealerBefore: 1 }); // → Dealer Anna
  assert.equal(g.dealerIndex, 0);
  const [anna, ben] = g.players;
  assert.equal(anna.bet, 10, 'Dealer zahlt Small Blind');
  assert.equal(ben.bet, 20);
  assert.equal(toAct(g), 'p1', 'Dealer/SB beginnt preflop');
  act(g, 'p1', { type: 'call' });
  act(g, 'p2', { type: 'check' });
  assert.equal(g.street, 'flop');
  assert.equal(toAct(g), 'p2', 'Big Blind beginnt postflop');
});

test('Side-Pots: Short-Stack gewinnt nur den Main-Pot', () => {
  const deck = [
    C('K', '♠'), C('K', '♥'), // Ben (1000)
    C('D', '♠'), C('D', '♥'), // Cleo (1000)
    C('A', '♠'), C('A', '♥'), // Anna (100, Short-Stack)
    C('2', '♦'), C('7', '♣'), C('9', '♠'),
    C('B', '♦'),
    C('3', '♣'),
  ];
  const g = begin(['Anna', 'Ben', 'Cleo'], { deck, chips: [100, 1000, 1000] });
  act(g, 'p1', { type: 'allin' }); // Anna all-in 100
  act(g, 'p2', { type: 'call' });
  act(g, 'p3', { type: 'call' });
  assert.equal(g.street, 'flop');
  act(g, 'p2', { type: 'raise', to: 200 });
  act(g, 'p3', { type: 'call' });
  // Turn & River durchchecken
  act(g, 'p2', { type: 'check' });
  act(g, 'p3', { type: 'check' });
  act(g, 'p2', { type: 'check' });
  act(g, 'p3', { type: 'check' });

  assert.equal(g.street, 'showdown');
  const result = g.handResult!;
  assert.equal(result.pots.length, 2);
  // Main-Pot: 3×100 = 300 an Anna (Asse), Side-Pot: 2×200 = 400 an Ben (Könige)
  assert.deepEqual(result.pots[0].winners, [{ playerId: 'p1', amount: 300 }]);
  assert.deepEqual(result.pots[1].winners, [{ playerId: 'p2', amount: 400 }]);
  assert.equal(getPokerPlayer(g, 'p1')!.chips, 300);
  assert.equal(getPokerPlayer(g, 'p2')!.chips, 1000 - 300 + 400);
  assert.equal(getPokerPlayer(g, 'p3')!.chips, 1000 - 300);
});

test('Split-Pot: Board spielt für beide, Pot wird geteilt', () => {
  const deck = [
    C('4', '♣'), C('5', '♣'), // Ben
    C('2', '♦'), C('3', '♦'), // Anna
    C('A', '♠'), C('A', '♥'), C('K', '♦'), // Flop
    C('K', '♣'), // Turn
    C('D', '♠'), // River
  ];
  const g = begin(['Anna', 'Ben'], { dealerBefore: 1, deck });
  act(g, 'p1', { type: 'call' });
  act(g, 'p2', { type: 'check' });
  for (const _street of ['flop', 'turn', 'river']) {
    act(g, 'p2', { type: 'check' });
    act(g, 'p1', { type: 'check' });
  }
  assert.equal(g.street, 'showdown');
  const pot = g.handResult!.pots[0];
  assert.equal(pot.amount, 40);
  assert.equal(pot.winners.length, 2);
  assert.ok(pot.winners.every((w) => w.amount === 20));
  assert.equal(getPokerPlayer(g, 'p1')!.chips, 2000);
  assert.equal(getPokerPlayer(g, 'p2')!.chips, 2000);
});

test('Timeout: Auto-Fold gegen Einsatz, Auto-Check wenn möglich', () => {
  const g = begin(['Anna', 'Ben', 'Cleo'], { rules: { actionTimeoutSec: 30 } });
  assert.equal(toAct(g), 'p1');
  assert.equal(g.actionDeadline, NOW + 30_000);
  // Noch nicht abgelaufen
  assert.equal(pokerTick(g, NOW + 29_000), false);
  // Abgelaufen → Anna muss 20 callen → Auto-Fold
  assert.equal(pokerTick(g, NOW + 30_000), true);
  assert.ok(getPokerPlayer(g, 'p1')!.folded);
  assert.equal(toAct(g), 'p2');
  act(g, 'p2', { type: 'call' }, NOW + 31_000);
  // Cleo (BB) könnte checken → Timeout checkt für sie
  assert.equal(pokerTick(g, NOW + 31_000 + 60_000), true);
  assert.equal(getPokerPlayer(g, 'p3')!.folded, false);
  assert.equal(g.street, 'flop');
});

test('Heads-up All-In: Verlierer scheidet aus, Partie endet', () => {
  const deck = [
    C('K', '♠'), C('K', '♥'), // Ben
    C('A', '♠'), C('A', '♥'), // Anna (Dealer/SB)
    C('2', '♦'), C('7', '♣'), C('9', '♠'),
    C('B', '♦'),
    C('3', '♣'),
  ];
  const g = begin(['Anna', 'Ben'], { dealerBefore: 1, deck, chips: [500, 500] });
  act(g, 'p1', { type: 'allin' });
  act(g, 'p2', { type: 'call' });
  // Beide all-in → automatisch bis zum River
  assert.equal(g.street, 'showdown');
  assert.equal(g.community.length, 5);
  assert.equal(getPokerPlayer(g, 'p1')!.chips, 1000);
  assert.equal(getPokerPlayer(g, 'p2')!.chips, 0);
  assert.equal(g.phase, 'ended');
  assert.equal(g.winnerId, 'p1');
  assert.ok(getPokerPlayer(g, 'p2')!.out);
});

test('Rebuy: nur zwischen Händen, nur wenn pleite', () => {
  const deck = [
    C('K', '♠'), C('K', '♥'), // Ben
    C('A', '♠'), C('A', '♥'), // Anna
    C('2', '♦'), C('7', '♣'), C('9', '♠'),
    C('B', '♦'),
    C('3', '♣'),
  ];
  const g = begin(['Anna', 'Ben'], {
    dealerBefore: 1,
    deck,
    chips: [500, 500],
    rules: { allowRebuy: true, buyIn: 1000 },
  });
  const early = applyPokerAction(g, 'p2', { type: 'rebuy' }, NOW);
  assert.equal(early.ok, false, 'Rebuy mit Chips verboten');
  act(g, 'p1', { type: 'allin' });
  act(g, 'p2', { type: 'call' });
  assert.equal(g.street, 'showdown');
  assert.equal(g.phase, 'playing', 'mit Rebuy endet die Partie nicht sofort');
  act(g, 'p2', { type: 'rebuy' });
  assert.equal(getPokerPlayer(g, 'p2')!.chips, 1000);
  assert.equal(getPokerPlayer(g, 'p2')!.rebuys, 1);
  // Nächste Hand startet automatisch nach der Pause
  assert.ok(g.nextHandAt !== null);
  assert.equal(pokerTick(g, g.nextHandAt!), true);
  assert.equal(g.handNumber, 2);
  assert.equal(g.phase, 'playing');
});

test('Aufgeben mitten in der Hand: Fold + endgültig raus, Host wechselt', () => {
  const g = begin(['Anna', 'Ben', 'Cleo']);
  assert.ok(getPokerPlayer(g, 'p1')!.isHost);
  act(g, 'p1', { type: 'resign' });
  const anna = getPokerPlayer(g, 'p1')!;
  assert.ok(anna.out);
  assert.equal(anna.chips, 0);
  assert.ok(getPokerPlayer(g, 'p2')!.isHost, 'Host-Rechte wandern weiter');
  // Hand läuft für Ben/Cleo weiter
  assert.equal(g.phase, 'playing');
  assert.equal(toAct(g), 'p2');
  act(g, 'p2', { type: 'fold' });
  assert.ok(g.handResult?.foldWin);
});

test('Blind-Erhöhung nach Zeitplan', () => {
  const g = begin(['Anna', 'Ben', 'Cleo'], {
    rules: { blindIncreaseMinutes: 10, smallBlind: 10 },
    now: NOW,
  });
  assert.equal(g.smallBlind, 10);
  // Hand vorbei, 25 Minuten später startet die nächste → Stufe 2 (10 → 20 → 40)
  act(g, 'p1', { type: 'fold' });
  act(g, 'p2', { type: 'fold' });
  const later = NOW + 25 * 60_000;
  g.nextHandAt = later; // Pause künstlich strecken
  assert.equal(pokerTick(g, later), true);
  assert.equal(g.blindLevel, 2);
  assert.equal(g.smallBlind, 40);
  assert.equal(g.bigBlind, 80);
});

test('viewFor: fremde Hole Cards maskiert, Deck entfernt, Showdown deckt auf', () => {
  const g = begin(['Anna', 'Ben']);
  const view = viewFor(g, 'p1');
  assert.equal((view as { deck?: unknown }).deck, undefined);
  const me = view.players.find((p) => p.id === 'p1')!;
  const other = view.players.find((p) => p.id === 'p2')!;
  assert.ok(me.hole!.every((c) => c >= 0), 'eigene Karten sichtbar');
  assert.deepEqual(other.hole, [HIDDEN_CARD, HIDDEN_CARD], 'fremde Karten maskiert');
  // Zuschauer sehen gar nichts
  const specView = viewFor(g, 'spectator-x');
  assert.ok(specView.players.every((p) => p.hole![0] === HIDDEN_CARD));
  // Nach Showdown mit Reveal sind die Karten für alle sichtbar
  act(g, 'p1', { type: 'call' });
  act(g, 'p2', { type: 'check' });
  for (let i = 0; i < 3; i++) {
    act(g, 'p2', { type: 'check' });
    act(g, 'p1', { type: 'check' });
  }
  assert.equal(g.street, 'showdown');
  const after = viewFor(g, 'spectator-x');
  assert.ok(after.players.every((p) => p.hole!.every((c) => c >= 0)), 'Showdown deckt auf');
});

test('startPoker: reguläre Partie über die öffentliche API', () => {
  const rules: PokerRules = { ...DEFAULT_POKER_RULES, buyIn: 1500 };
  const g = createPoker('ROOM2', rules, NOW);
  addPokerPlayer(g, 'a', 'Anna', true);
  const tooFew = startPoker(g, NOW);
  assert.equal(tooFew.ok, false, 'alleine kein Start');
  addPokerPlayer(g, 'b', 'Ben', false);
  const r = startPoker(g, NOW);
  assert.ok(r.ok, r.error);
  assert.equal(g.phase, 'playing');
  assert.equal(g.handNumber, 1);
  for (const p of g.players) {
    assert.equal(p.chips + p.committed, 1500);
    assert.equal(p.hole?.length, 2);
  }
  assert.equal(potTotal(g), 30);
});
