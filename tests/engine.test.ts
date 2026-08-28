/**
 * Unit-Tests für die Spiel-Engine (node:test, via `npm test`).
 * Die Würfel werden über den Debug-Modus (nextDice) deterministisch gesetzt.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GameState } from '../shared/types';
import {
  addPlayer,
  applyAction,
  auctionBidderId,
  auctionTick,
  canBuildOn,
  computeRent,
  createGame,
  cur,
  getPlayer,
  startGame,
} from '../shared/engine';
import { BUILT_IN_EDITIONS } from '../shared/boards';
import { CLASSIC_RULES } from '../shared/rules';

function newGame(playerCount = 2): GameState {
  const state = createGame('TEST1', BUILT_IN_EDITIONS[0], 'classic', {
    ...CLASSIC_RULES,
    debugMode: true,
  });
  for (let i = 0; i < playerCount; i++) {
    addPlayer(state, `p${i + 1}`, `Spieler ${i + 1}`, i === 0);
  }
  const r = startGame(state);
  assert.ok(r.ok);
  state.currentPlayer = 0; // deterministisch: p1 beginnt
  return state;
}

function roll(state: GameState, playerId: string, d1: number, d2: number) {
  assert.ok(applyAction(state, playerId, { type: 'setDice', dice: [d1, d2] }).ok);
  const r = applyAction(state, playerId, { type: 'roll' });
  assert.ok(r.ok, r.error);
  return r;
}

function endTurn(state: GameState, playerId: string) {
  const r = applyAction(state, playerId, { type: 'endTurn' });
  assert.ok(r.ok, r.error);
}

/** p1 kauft eine komplette Farbgruppe direkt (Testhelfer). */
function grant(state: GameState, playerId: string, tileIds: number[]) {
  for (const id of tileIds) state.properties[id].ownerId = playerId;
}

test('Startaufstellung: Geld, Position, Reihenfolge', () => {
  const g = newGame(3);
  assert.equal(g.players.length, 3);
  for (const p of g.players) {
    assert.equal(p.money, 1500);
    assert.equal(p.position, 0);
  }
  assert.equal(g.phase, 'playing');
  assert.equal(g.turnPhase, 'awaiting-roll');
});

test('Würfeln bewegt die Figur und bietet Kauf an', () => {
  const g = newGame();
  roll(g, 'p1', 2, 3); // Feld 5: Südbahnhof
  assert.equal(getPlayer(g, 'p1')!.position, 5);
  assert.equal(g.turnPhase, 'awaiting-buy');
});

test('Kauf: Geld wird abgezogen, Besitz registriert', () => {
  const g = newGame();
  roll(g, 'p1', 2, 3);
  assert.ok(applyAction(g, 'p1', { type: 'buy' }).ok);
  assert.equal(getPlayer(g, 'p1')!.money, 1500 - 200);
  assert.equal(g.properties[5].ownerId, 'p1');
  assert.equal(g.turnPhase, 'awaiting-end');
});

test('Miete: Bahnhof-Staffelung und Zahlung', () => {
  const g = newGame();
  grant(g, 'p1', [5, 15]); // zwei Bahnhöfe → 50 Miete
  roll(g, 'p1', 1, 2); // p1 auf Feld 3 (eigene Runde irrelevant)
  assert.ok(applyAction(g, 'p1', { type: 'skipBuy' }).ok);
  endTurn(g, 'p1');
  roll(g, 'p2', 2, 3); // p2 landet auf Bahnhof 5
  assert.equal(getPlayer(g, 'p2')!.money, 1500 - 50);
  assert.equal(getPlayer(g, 'p1')!.money, 1500 + 50);
});

test('Doppelte Grundmiete bei kompletter Farbgruppe', () => {
  const g = newGame();
  grant(g, 'p2', [1, 3]); // braune Gruppe komplett
  assert.equal(computeRent(g, 1, 7), 4); // 2 × 2
  g.rules.doubleRentFullGroup = false;
  assert.equal(computeRent(g, 1, 7), 2);
});

test('Pasch: Spieler ist erneut dran, dritter Pasch führt ins Gefängnis', () => {
  const g = newGame();
  roll(g, 'p1', 2, 2); // Pasch → Feld 4 Steuer (200)
  assert.equal(g.doubles, 1);
  endTurn(g, 'p1');
  assert.equal(cur(g).id, 'p1'); // immer noch p1
  assert.equal(g.turnPhase, 'awaiting-roll');
  roll(g, 'p1', 3, 3); // 2. Pasch → Feld 10 (nur zu Besuch)
  endTurn(g, 'p1');
  roll(g, 'p1', 1, 1); // 3. Pasch → Gefängnis!
  const p1 = getPlayer(g, 'p1')!;
  assert.equal(p1.inJail, true);
  assert.equal(p1.position, 10);
  endTurn(g, 'p1');
  assert.equal(cur(g).id, 'p2'); // Pasch-Bonus verfällt
});

test('Gefängnis: Freikommen per Pasch, Kaution nach 3 Fehlversuchen', () => {
  const g = newGame();
  const p1 = getPlayer(g, 'p1')!;
  p1.inJail = true;
  p1.position = 10;

  // Fehlversuch 1+2
  roll(g, 'p1', 1, 2);
  assert.equal(p1.inJail, true);
  assert.equal(p1.jailTurns, 1);
  endTurn(g, 'p1');
  roll(g, 'p2', 4, 6);
  applyAction(g, 'p2', { type: 'skipBuy' });
  endTurn(g, 'p2');
  roll(g, 'p1', 1, 3);
  assert.equal(p1.jailTurns, 2);
  endTurn(g, 'p1');
  roll(g, 'p2', 4, 6);
  if (g.turnPhase === 'awaiting-buy') applyAction(g, 'p2', { type: 'skipBuy' });
  endTurn(g, 'p2');
  // Fehlversuch 3 → Kaution wird fällig, Figur zieht die Augenzahl
  const moneyBefore = p1.money;
  roll(g, 'p1', 2, 4);
  assert.equal(p1.inJail, false);
  assert.equal(p1.money, moneyBefore - 50);
  assert.equal(p1.position, 16);
});

test('Gefängnis: Kaution freiwillig zahlen', () => {
  const g = newGame();
  const p1 = getPlayer(g, 'p1')!;
  p1.inJail = true;
  p1.position = 10;
  assert.ok(applyAction(g, 'p1', { type: 'payJail' }).ok);
  assert.equal(p1.inJail, false);
  assert.equal(p1.money, 1450);
  assert.equal(g.turnPhase, 'awaiting-roll'); // es wird ganz normal gewürfelt
});

test('Über Los gehen bringt Gehalt', () => {
  const g = newGame();
  const p1 = getPlayer(g, 'p1')!;
  p1.position = 38;
  roll(g, 'p1', 2, 3); // 38 → 3 (über Los)
  assert.equal(p1.position, 3);
  assert.equal(g.turnPhase, 'awaiting-buy');
  assert.equal(p1.money, 1500 + 200);
});

test('Bauen: nur mit kompletter Gruppe, gleichmäßig, Hotel nach 4 Häusern', () => {
  const g = newGame();
  grant(g, 'p1', [1, 3]);
  const check1 = canBuildOn(g, 'p1', 1);
  assert.ok(check1.ok);
  // p1 ist am Zug (awaiting-roll) → bauen erlaubt
  assert.ok(applyAction(g, 'p1', { type: 'build', tileId: 1 }).ok);
  assert.equal(g.properties[1].houses, 1);
  assert.equal(getPlayer(g, 'p1')!.money, 1500 - 50);
  // zweites Haus auf gleichem Feld verletzt Gleichmäßigkeit
  const r = applyAction(g, 'p1', { type: 'build', tileId: 1 });
  assert.equal(r.ok, false);
  assert.ok(applyAction(g, 'p1', { type: 'build', tileId: 3 }).ok);
  // bis zum Hotel bauen
  for (const _ of [1, 2, 3]) {
    assert.ok(applyAction(g, 'p1', { type: 'build', tileId: 1 }).ok);
    assert.ok(applyAction(g, 'p1', { type: 'build', tileId: 3 }).ok);
  }
  assert.ok(applyAction(g, 'p1', { type: 'build', tileId: 1 }).ok); // Hotel
  assert.equal(g.properties[1].houses, 5);
  assert.equal(g.bankHotels, 11);
  assert.equal(g.bankHouses, 32 - 4); // 8 gebaut, 4 durchs Hotel zurück
  assert.equal(computeRent(g, 1, 7), 250);
});

test('Hypothek: Miete entfällt, Ablösen kostet Zinsen', () => {
  const g = newGame();
  grant(g, 'p1', [5]);
  assert.ok(applyAction(g, 'p1', { type: 'mortgage', tileId: 5 }).ok);
  const p1 = getPlayer(g, 'p1')!;
  assert.equal(p1.money, 1600);
  assert.equal(computeRent(g, 5, 7), 0);
  assert.ok(applyAction(g, 'p1', { type: 'unmortgage', tileId: 5 }).ok);
  assert.equal(p1.money, 1600 - 110);
});

test('Schulden & Bankrott: Besitz geht an den Gläubiger', () => {
  const g = newGame();
  grant(g, 'p1', [39]); // Schlossallee
  g.properties[39].houses = 5; // Hotel → Miete 2000
  const p2 = getPlayer(g, 'p2')!;
  p2.money = 100;
  grant(g, 'p2', [5]);
  // p2 direkt vor die Schlossallee setzen und an die Reihe bringen
  g.currentPlayer = 1;
  g.turnPhase = 'awaiting-roll';
  p2.position = 36;
  roll(g, 'p2', 1, 2); // → 39
  assert.equal(g.turnPhase, 'debt');
  assert.equal(g.debt?.creditorId, 'p1');
  // Zahlen unmöglich → Bankrott
  assert.ok(applyAction(g, 'p2', { type: 'declareBankruptcy' }).ok);
  assert.equal(p2.bankrupt, true);
  assert.equal(g.properties[5].ownerId, 'p1'); // Bahnhof geht an Gläubiger
  assert.equal(g.phase, 'ended');
  assert.equal(g.winnerId, 'p1');
});

test('Schulden können nach Hypothek beglichen werden', () => {
  const g = newGame(3);
  grant(g, 'p1', [39]);
  g.properties[39].houses = 3; // Miete 1100... nein: rent[3]=1100? [50,200,600,1400,1700,2000] → 3 Häuser = 1400
  const p2 = getPlayer(g, 'p2')!;
  p2.money = 500;
  grant(g, 'p2', [37]); // Parkstraße (Hypothekenwert 175)
  grant(g, 'p2', [31, 32, 34]); // grüne Gruppe (150 + 150 + 160)
  g.currentPlayer = 1;
  g.turnPhase = 'awaiting-roll';
  p2.position = 36;
  roll(g, 'p2', 1, 2); // → 39, Miete 1400
  assert.equal(g.turnPhase, 'debt');
  // Hypotheken: 175 + 150 + 150 + 160 = 635 → 500 + 635 = 1135 < 1400 → erst mit Zuschuss
  p2.money += 400;
  assert.ok(applyAction(g, 'p2', { type: 'mortgage', tileId: 37 }).ok);
  assert.ok(applyAction(g, 'p2', { type: 'mortgage', tileId: 31 }).ok);
  assert.ok(applyAction(g, 'p2', { type: 'mortgage', tileId: 32 }).ok);
  assert.ok(applyAction(g, 'p2', { type: 'mortgage', tileId: 34 }).ok);
  const r = applyAction(g, 'p2', { type: 'payDebt' });
  assert.ok(r.ok, r.error);
  assert.equal(g.debt, null);
  assert.equal(g.turnPhase, 'awaiting-end');
  assert.equal(getPlayer(g, 'p2')!.bankrupt, false);
});

test('Karten: Geldkarten wirken sofort nach Bestätigung', () => {
  const g = newGame();
  roll(g, 'p1', 3, 4); // Feld 7: Ereignisfeld
  assert.equal(g.turnPhase, 'awaiting-card');
  assert.ok(g.pendingCard);
  const card = g.pendingCard!.card;
  const before = getPlayer(g, 'p1')!.money;
  assert.ok(applyAction(g, 'p1', { type: 'ackCard' }).ok);
  if (card.effect.kind === 'money') {
    assert.equal(getPlayer(g, 'p1')!.money, before + card.effect.amount);
  }
  assert.equal(g.pendingCard, null);
});

test('Handel: Angebot, Annahme, Eigentumsübertragung', () => {
  const g = newGame();
  grant(g, 'p1', [5]);
  grant(g, 'p2', [12]);
  const r = applyAction(g, 'p1', {
    type: 'proposeTrade',
    to: 'p2',
    offerMoney: 100,
    offerProps: [5],
    requestMoney: 0,
    requestProps: [12],
  });
  assert.ok(r.ok, r.error);
  assert.ok(g.trade);
  assert.ok(applyAction(g, 'p2', { type: 'respondTrade', accept: true }).ok);
  assert.equal(g.properties[5].ownerId, 'p2');
  assert.equal(g.properties[12].ownerId, 'p1');
  assert.equal(getPlayer(g, 'p1')!.money, 1400);
  assert.equal(getPlayer(g, 'p2')!.money, 1600);
  assert.equal(g.trade, null);
});

test('Frei-Parken-Bonus: Steuern landen im Topf und werden kassiert', () => {
  const g = newGame();
  g.rules.freeParkingBonus = true;
  roll(g, 'p1', 1, 3); // Feld 4: Einkommensteuer 200
  assert.equal(g.freeParkingPot, 200);
  assert.equal(getPlayer(g, 'p1')!.money, 1300);
  endTurn(g, 'p1');
  const p2 = getPlayer(g, 'p2')!;
  p2.position = 15;
  roll(g, 'p2', 2, 3); // → Feld 20 Frei Parken
  assert.equal(p2.money, 1500 + 200);
  assert.equal(g.freeParkingPot, 0);
});

test('Getrennter Spieler: Host kann Zug erzwingen', () => {
  const g = newGame();
  // p2 ist dran, aber getrennt
  g.currentPlayer = 1;
  g.turnPhase = 'awaiting-roll';
  const p2 = getPlayer(g, 'p2')!;
  p2.connected = false;
  const r = applyAction(g, 'p1', { type: 'forceEndTurn' });
  assert.ok(r.ok, r.error);
  assert.equal(cur(g).id, 'p1'); // Zug ist weitergegangen
});

test('Aufgeben: Spieler scheidet aus, letzter gewinnt', () => {
  const g = newGame(3);
  assert.ok(applyAction(g, 'p3', { type: 'resign' }).ok);
  assert.equal(getPlayer(g, 'p3')!.bankrupt, true);
  assert.equal(g.phase, 'playing'); // noch 2 aktiv
  assert.ok(applyAction(g, 'p2', { type: 'resign' }).ok);
  assert.equal(g.phase, 'ended');
  assert.equal(g.winnerId, 'p1');
});

test('Ungültige Aktionen werden abgelehnt', () => {
  const g = newGame();
  // Falscher Spieler würfelt
  assert.equal(applyAction(g, 'p2', { type: 'roll' }).ok, false);
  // Kaufen ohne Kaufphase
  assert.equal(applyAction(g, 'p1', { type: 'buy' }).ok, false);
  // Bauen ohne Besitz
  assert.equal(applyAction(g, 'p1', { type: 'build', tileId: 1 }).ok, false);
  // Zug beenden vor dem Würfeln
  assert.equal(applyAction(g, 'p1', { type: 'endTurn' }).ok, false);
  // setDice ohne Debug-Modus
  g.rules.debugMode = false;
  assert.equal(applyAction(g, 'p1', { type: 'setDice', dice: [1, 1] }).ok, false);
});

// ---------------------------------------------------------------------------
// Auktionen (Regeloption `auctionOnSkip`)
// ---------------------------------------------------------------------------

/** Spiel mit eingeschalteter Auktion; p1 steht vor dem Südbahnhof (Feld 5). */
function auctionGame(playerCount = 3): GameState {
  const g = newGame(playerCount);
  g.rules.auctionOnSkip = true;
  g.rules.auctionBidSeconds = 0; // ohne Uhr – Zeitverhalten wird separat geprüft
  roll(g, 'p1', 2, 3); // → Feld 5, Südbahnhof (200)
  assert.equal(g.turnPhase, 'awaiting-buy');
  return g;
}

test('Auktion aus: ausgeschlagenes Grundstück bleibt schlicht frei', () => {
  const g = newGame(3);
  assert.equal(g.rules.auctionOnSkip, false, 'Vorgabe bleibt das bisherige Verhalten');
  roll(g, 'p1', 2, 3);
  assert.ok(applyAction(g, 'p1', { type: 'skipBuy' }).ok);
  assert.equal(g.turnPhase, 'awaiting-end');
  assert.equal(g.auction, null);
  assert.equal(g.properties[5].ownerId, null);
});

test('Auktion an: Verzicht eröffnet die Versteigerung', () => {
  const g = auctionGame();
  assert.ok(applyAction(g, 'p1', { type: 'skipBuy' }).ok);
  assert.equal(g.turnPhase, 'auction');
  assert.equal(g.auction?.tileId, 5);
  assert.deepEqual(g.auction?.order, ['p1', 'p2', 'p3'], 'reihum ab dem aktuellen Spieler');
  assert.equal(g.auction?.highBidderId, null);
});

test('Auktion: reihum bieten, letzter Bieter bekommt den Zuschlag', () => {
  const g = auctionGame();
  applyAction(g, 'p1', { type: 'skipBuy' });

  assert.ok(applyAction(g, 'p1', { type: 'bid', amount: 50 }).ok);
  assert.ok(applyAction(g, 'p2', { type: 'bid', amount: 80 }).ok);
  assert.ok(applyAction(g, 'p3', { type: 'passAuction' }).ok);
  assert.ok(applyAction(g, 'p1', { type: 'passAuction' }).ok);

  // Nur noch p2 übrig → Zuschlag zum Höchstgebot
  assert.equal(g.auction, null);
  assert.equal(g.properties[5].ownerId, 'p2');
  assert.equal(getPlayer(g, 'p2')!.money, 1500 - 80);
  assert.equal(g.turnPhase, 'awaiting-end', 'der Zug von p1 geht normal weiter');
});

test('Auktion: passen alle ohne Gebot, bleibt das Feld unverkauft', () => {
  const g = auctionGame();
  applyAction(g, 'p1', { type: 'skipBuy' });

  assert.ok(applyAction(g, 'p1', { type: 'passAuction' }).ok);
  assert.ok(applyAction(g, 'p2', { type: 'passAuction' }).ok);
  assert.ok(applyAction(g, 'p3', { type: 'passAuction' }).ok);

  assert.equal(g.auction, null);
  assert.equal(g.properties[5].ownerId, null);
  assert.equal(g.turnPhase, 'awaiting-end');
  for (const p of g.players) assert.equal(p.money, 1500, 'niemand zahlt etwas');
});

test('Auktion: Gebot über dem eigenen Bargeld wird abgelehnt', () => {
  const g = auctionGame();
  applyAction(g, 'p1', { type: 'skipBuy' });
  getPlayer(g, 'p1')!.money = 100;

  const r = applyAction(g, 'p1', { type: 'bid', amount: 150 });
  assert.equal(r.ok, false);
  assert.match(r.error ?? '', /Bargeld/);
  assert.ok(applyAction(g, 'p1', { type: 'bid', amount: 100 }).ok, 'genau das Bargeld geht');
});

test('Auktion: zu niedriges Gebot und Bieten außer der Reihe werden abgelehnt', () => {
  const g = auctionGame();
  applyAction(g, 'p1', { type: 'skipBuy' });

  // p2 ist noch nicht dran
  assert.equal(applyAction(g, 'p2', { type: 'bid', amount: 50 }).ok, false);

  assert.ok(applyAction(g, 'p1', { type: 'bid', amount: 50 }).ok);
  // p2 muss das Höchstgebot überbieten
  assert.equal(applyAction(g, 'p2', { type: 'bid', amount: 50 }).ok, false);
  assert.ok(applyAction(g, 'p2', { type: 'bid', amount: 51 }).ok);
});

test('Auktion: wer gepasst hat, ist raus und wird übersprungen', () => {
  const g = auctionGame();
  applyAction(g, 'p1', { type: 'skipBuy' });

  assert.ok(applyAction(g, 'p1', { type: 'passAuction' }).ok);
  assert.equal(applyAction(g, 'p1', { type: 'bid', amount: 500 }).ok, false, 'raus bleibt raus');

  assert.ok(applyAction(g, 'p2', { type: 'bid', amount: 10 }).ok);
  assert.ok(applyAction(g, 'p3', { type: 'bid', amount: 20 }).ok);
  // p1 wird übersprungen, p2 ist wieder dran
  assert.ok(applyAction(g, 'p2', { type: 'passAuction' }).ok);
  assert.equal(g.properties[5].ownerId, 'p3');
});

test('Auktion: Bedenkzeit lässt einen stummen Bieter passen', () => {
  const g = auctionGame();
  g.rules.auctionBidSeconds = 30;
  applyAction(g, 'p1', { type: 'skipBuy' });

  const deadline = g.auction!.deadline!;
  assert.ok(deadline > Date.now(), 'Uhr läuft');
  assert.equal(auctionTick(g, deadline - 1), false, 'vorher passiert nichts');

  assert.equal(auctionTick(g, deadline + 1), true);
  assert.deepEqual(g.auction?.passed, ['p1'], 'p1 hat die Zeit verstreichen lassen');
  assert.equal(auctionBidderId(g), 'p2');
});

test('Auktion: Handel ist währenddessen gesperrt', () => {
  const g = auctionGame();
  applyAction(g, 'p1', { type: 'skipBuy' });

  const r = applyAction(g, 'p2', {
    type: 'proposeTrade',
    to: 'p3',
    offerMoney: 10,
    offerProps: [],
    requestMoney: 0,
    requestProps: [],
  });
  assert.equal(r.ok, false);
  assert.match(r.error ?? '', /Auktion/);
});

test('Auktion: Bankrott während der Auktion nimmt den Spieler heraus', () => {
  const g = auctionGame(4);
  applyAction(g, 'p1', { type: 'skipBuy' });
  assert.ok(applyAction(g, 'p1', { type: 'bid', amount: 30 }).ok);

  // p2 steigt aus, während er am Zug wäre
  assert.ok(applyAction(g, 'p2', { type: 'resign' }).ok);
  assert.ok(g.auction?.passed.includes('p2'), 'ausgeschiedener Bieter ist raus');
  assert.equal(auctionBidderId(g), 'p3');
});

test('Auktion: unbezahlbares Feld führt über denselben Knopf in die Auktion', () => {
  const g = auctionGame();
  getPlayer(g, 'p1')!.money = 10; // kann den Südbahnhof (200) nicht kaufen

  assert.equal(applyAction(g, 'p1', { type: 'buy' }).ok, false);
  assert.ok(applyAction(g, 'p1', { type: 'skipBuy' }).ok);
  assert.equal(g.turnPhase, 'auction', 'auch der Zahlungsunfähige löst die Auktion aus');
});
