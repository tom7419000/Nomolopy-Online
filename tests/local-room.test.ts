/**
 * Unit-Tests der lokalen Pass-&-Play-Raumschicht.
 *
 *   npm test
 *
 * Der Testlauf übersetzt mit `tsconfig.server.json`, also OHNE DOM-Typen –
 * das hält `client/src/net/localRoom.ts` ehrlich frei von Browser-APIs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  activeSeatId,
  buildEnvelope,
  createLocalRoom,
  defaultEdges,
  LocalRoomRunner,
  MAX_FIXED_SEATS,
  rotationFor,
  type LocalRoom,
} from '../client/src/net/localRoom';
import { HIDDEN_CARD, pokerTick } from '../shared/poker/engine';
import type { RoomEnvelope } from '../shared/games';

/** Sammelt die veröffentlichten Sichten, wie es die UI täte. */
function runnerFor(room: LocalRoom, now?: () => number) {
  const published: { env: RoomEnvelope; seat: string | null }[] = [];
  const runner = new LocalRoomRunner(room, {
    publish: (env, seat) => published.push({ env, seat }),
    now,
  });
  return { runner, published, last: () => published[published.length - 1] };
}

function monopolyRoom(names = ['Anna', 'Ben', 'Clara', 'Dora']) {
  return createLocalRoom({ gameId: 'monopoly', players: names });
}

function pokerRoom(names = ['Anna', 'Ben', 'Clara']) {
  return createLocalRoom({
    gameId: 'poker',
    players: names,
    pokerRules: { buyIn: 1000, smallBlind: 10, blindIncreaseMinutes: 0 },
  });
}

// ---------------------------------------------------------------------------
// Aufbau
// ---------------------------------------------------------------------------

test('Monopoly: Raum mit vier Sitzen in der angegebenen Reihenfolge', () => {
  const room = monopolyRoom();
  assert.equal(room.meta.gameId, 'monopoly');
  assert.equal(room.monopoly?.players.length, 4);
  assert.deepEqual(
    room.monopoly?.players.map((p) => p.name),
    ['Anna', 'Ben', 'Clara', 'Dora']
  );
  assert.equal(room.poker, null);
  assert.equal(room.meta.isPublic, false, 'lokale Räume tauchen nie in der Raumliste auf');
});

test('Leere Namen werden verworfen', () => {
  const room = createLocalRoom({ gameId: 'monopoly', players: ['Anna', '  ', 'Ben'] });
  assert.equal(room.monopoly?.players.length, 2);
});

test('Jeder Sitz ist Host – sonst scheitern host-gebundene Aktionen je nach Sitz', () => {
  const room = monopolyRoom();
  assert.ok(room.monopoly?.players.every((p) => p.isHost));
  const poker = pokerRoom();
  assert.ok(poker.poker?.players.every((p) => p.isHost));
});

// ---------------------------------------------------------------------------
// Wer ist dran?
// ---------------------------------------------------------------------------

test('activeSeatId folgt currentPlayer', () => {
  const room = monopolyRoom();
  assert.equal(activeSeatId(room), null, 'in der Lobby handelt niemand');

  const { runner } = runnerFor(room);
  runner.start();

  const g = room.monopoly!;
  assert.equal(activeSeatId(room), g.players[g.currentPlayer].id);

  // Zug künstlich weiterschalten und prüfen, dass der Sitz mitwandert
  g.currentPlayer = (g.currentPlayer + 1) % g.players.length;
  assert.equal(activeSeatId(room), g.players[g.currentPlayer].id);
});

test('activeSeatId folgt toActIndex und ist beim Showdown null', () => {
  const room = pokerRoom();
  const { runner } = runnerFor(room);
  runner.start();

  const p = room.poker!;
  assert.equal(activeSeatId(room), p.players[p.toActIndex!].id);

  p.toActIndex = null;
  assert.equal(activeSeatId(room), null, 'beim Showdown liegt keine Hand offen');
});

// ---------------------------------------------------------------------------
// Der Klon-Vertrag
// ---------------------------------------------------------------------------

test('buildEnvelope liefert bei jedem Aufruf eine frische Identität', () => {
  const room = monopolyRoom();
  const { runner } = runnerFor(room);
  runner.start();

  const a = buildEnvelope(room).env.monopoly!;
  const b = buildEnvelope(room).env.monopoly!;

  assert.notEqual(a, b, 'ohne Klon würde React nicht neu rendern');
  assert.notEqual(a.players, b.players);
  assert.deepEqual(a.players.map((p) => p.id), b.players.map((p) => p.id));
});

test('Die veröffentlichte Sicht hängt nicht am lebenden Zustand', () => {
  const room = monopolyRoom();
  const { runner, last } = runnerFor(room);
  runner.start();

  const before = last().env.monopoly!.players[0].money;
  room.monopoly!.players[0].money = 12345;

  assert.equal(last().env.monopoly!.players[0].money, before, 'Kopie, keine Referenz');
});

// ---------------------------------------------------------------------------
// Poker-Redaction
// ---------------------------------------------------------------------------

test('Nur der aktive Sitz sieht seine Handkarten', () => {
  const room = pokerRoom();
  const { runner, last } = runnerFor(room);
  runner.start();

  const seat = last().seat!;
  const view = last().env.poker!;
  const me = view.players.find((p) => p.id === seat)!;

  assert.ok(me.hole && me.hole.every((c) => c !== HIDDEN_CARD), 'eigene Karten sichtbar');
  for (const other of view.players.filter((p) => p.id !== seat && p.hole)) {
    assert.deepEqual(other.hole, [HIDDEN_CARD, HIDDEN_CARD], 'fremde Karten verdeckt');
  }
});

test('Das Deck verlässt die Sicht nie', () => {
  const room = pokerRoom();
  const { runner, last } = runnerFor(room);
  runner.start();
  assert.ok(!('deck' in last().env.poker!), 'viewFor entfernt das Deck');
});

test('Wandert der Zug weiter, wechseln die offenen Karten mit', () => {
  const room = pokerRoom();
  const { runner, last } = runnerFor(room);
  runner.start();

  const firstSeat = last().seat!;
  runner.action({ type: 'fold' });
  const secondSeat = last().seat!;

  assert.notEqual(firstSeat, secondSeat, 'nach dem Fold ist der Nächste dran');

  const view = last().env.poker!;
  const previous = view.players.find((p) => p.id === firstSeat)!;
  if (previous.hole) {
    assert.deepEqual(previous.hole, [HIDDEN_CARD, HIDDEN_CARD], 'der vorige Sitz ist wieder zu');
  }
});

// ---------------------------------------------------------------------------
// Uhr und Takt
// ---------------------------------------------------------------------------

test('Die Zug-Uhr ist am gemeinsamen Gerät abgeschaltet', () => {
  const room = pokerRoom();
  const { runner, last } = runnerFor(room);
  runner.start();

  assert.equal(room.poker!.actionDeadline, null, 'kein Auto-Fold beim Weiterreichen');
  assert.equal(last().env.poker!.actionDeadline, null);

  runner.action({ type: 'fold' });
  assert.equal(room.poker!.actionDeadline, null, 'bleibt auch nach Aktionen aus');
});

test('pokerTick bringt die Partie über den Showdown hinaus', () => {
  const room = pokerRoom(['Anna', 'Ben']);
  let clock = Date.now();
  const { runner, published } = runnerFor(room, () => clock);
  runner.start();

  const handBefore = room.poker!.handNumber;

  // Heads-up: einer foldet, die Hand endet, nextHandAt wird gesetzt.
  runner.action({ type: 'fold' });
  assert.notEqual(room.poker!.nextHandAt, null, 'nach dem Handende läuft eine Pause');

  // Die Zeit vorspulen und den Takt von Hand auslösen – im Test ohne Timer.
  clock = room.poker!.nextHandAt! + 1;
  const publishedBefore = published.length;
  assert.equal(pokerTick(room.poker!, clock), true, 'pokerTick meldet die Änderung');
  runner.publish();

  assert.ok(room.poker!.handNumber > handBefore, 'die nächste Hand hat begonnen');
  assert.ok(published.length > publishedBefore, 'die neue Hand wurde veröffentlicht');

  runner.stop();
});

// ---------------------------------------------------------------------------
// Host-gebundene Aktionen von jedem Sitz
// ---------------------------------------------------------------------------

test('nextHand funktioniert unabhängig davon, wer gerade dran ist', () => {
  const room = pokerRoom(['Anna', 'Ben']);
  const { runner } = runnerFor(room);
  runner.start();

  runner.action({ type: 'fold' });
  // Zwischen den Händen ist toActIndex null – die Aktion muss trotzdem greifen.
  assert.equal(activeSeatId(room), null);
  const r = runner.action({ type: 'nextHand' });
  assert.equal(r.ok, true, r.error);
});

test('Monopoly: forceEndTurn ist von jedem Sitz erlaubt', () => {
  const room = monopolyRoom(['Anna', 'Ben']);
  const { runner } = runnerFor(room);
  runner.start();

  const r = runner.action({ type: 'forceEndTurn' });
  // Die Engine darf die Aktion inhaltlich ablehnen – aber nie mit „nur der Host".
  if (!r.ok) assert.ok(!/Host/i.test(r.error ?? ''), `Host-Ablehnung: ${r.error}`);
});

// ---------------------------------------------------------------------------
// Chat & Rematch
// ---------------------------------------------------------------------------

test('Chat läuft unter dem aktiven Sitz', () => {
  const room = monopolyRoom();
  const { runner, last } = runnerFor(room);
  runner.start();

  const seat = activeSeatId(room)!;
  assert.equal(runner.chat('Hallo zusammen').ok, true);

  const chat = last().env.monopoly!.chat;
  assert.equal(chat[chat.length - 1].playerId, seat);
  assert.equal(chat[chat.length - 1].text, 'Hallo zusammen');
});

test('Rematch erst nach Spielende', () => {
  const room = monopolyRoom();
  const { runner } = runnerFor(room);
  runner.start();

  assert.equal(runner.rematch().ok, false, 'die laufende Partie bleibt unangetastet');

  room.monopoly!.phase = 'ended';
  assert.equal(runner.rematch().ok, true);
  assert.equal(room.monopoly!.phase, 'playing', 'neue Runde läuft');
});

test('stop() räumt den Poker-Takt ab', () => {
  const room = pokerRoom(['Anna', 'Ben']);
  const { runner, published } = runnerFor(room);
  runner.start();
  runner.stop();

  const count = published.length;
  runner.publish();
  assert.equal(published.length, count, 'nach stop() wird nichts mehr veröffentlicht');
});

test('Auktion: der aktive Sitz wandert zum Bieter, nicht zum Spieler am Zug', () => {
  const room = monopolyRoom(['Anna', 'Ben', 'Clara']);
  room.monopoly!.rules.auctionOnSkip = true;
  room.monopoly!.rules.debugMode = true;
  const { runner } = runnerFor(room);
  runner.start();

  const g = room.monopoly!;
  g.currentPlayer = 0;
  g.turnPhase = 'awaiting-roll';

  runner.action({ type: 'setDice', dice: [2, 3] });
  runner.action({ type: 'roll' });
  assert.equal(g.turnPhase, 'awaiting-buy');

  const atTurn = g.players[g.currentPlayer].id;
  runner.action({ type: 'skipBuy' });
  assert.equal(g.turnPhase, 'auction');

  // Erster Bieter ist der Spieler am Zug …
  assert.equal(activeSeatId(room), atTurn);
  // … nach seinem Gebot rückt der Nächste nach, obwohl der Zug bei ihm bleibt.
  runner.action({ type: 'bid', amount: 20 });
  assert.notEqual(activeSeatId(room), atTurn, 'das Gerät wandert zum nächsten Bieter');
  assert.equal(g.players[g.currentPlayer].id, atTurn, 'der Zug selbst bleibt bei Anna');
});

test('Auktion: am geteilten Gerät läuft keine Bedenkzeit', () => {
  const room = monopolyRoom(['Anna', 'Ben', 'Clara']);
  room.monopoly!.rules.auctionOnSkip = true;
  room.monopoly!.rules.auctionBidSeconds = 30;
  room.monopoly!.rules.debugMode = true;
  const { runner } = runnerFor(room);
  runner.start();

  const g = room.monopoly!;
  g.currentPlayer = 0;
  g.turnPhase = 'awaiting-roll';
  runner.action({ type: 'setDice', dice: [2, 3] });
  runner.action({ type: 'roll' });
  runner.action({ type: 'skipBuy' });

  assert.equal(g.auction?.deadline, null, 'kein Auto-Pass beim Weiterreichen');
});

// ---------------------------------------------------------------------------
// Sitzordnung (feste Plätze)
// ---------------------------------------------------------------------------

test('Weiterreichen ist die Vorgabe – keine Sitzordnung, keine Drehung', () => {
  const room = monopolyRoom();
  assert.equal(room.seating, null);
  assert.equal(rotationFor(room.seating, room.monopoly!.players[0].id), 0);
});

test('Feste Plätze: jeder Sitz bekommt eine eigene Kante', () => {
  const room = createLocalRoom({
    gameId: 'monopoly',
    players: ['Anna', 'Ben', 'Clara', 'Dora'],
    seatMode: 'fixed',
  });

  assert.equal(room.seating?.mode, 'fixed');
  const edges = Object.values(room.seating!.edges);
  assert.equal(edges.length, 4);
  assert.equal(new Set(edges).size, 4, 'vier Spieler, vier verschiedene Kanten');
});

test('Feste Plätze: zwei Spieler sitzen sich gegenüber', () => {
  const room = createLocalRoom({
    gameId: 'monopoly',
    players: ['Anna', 'Ben'],
    seatMode: 'fixed',
  });
  const [a, b] = room.monopoly!.players.map((p) => room.seating!.edges[p.id]);
  assert.deepEqual([a, b], [0, 180], 'unten und oben, nicht über Eck');
});

test('Feste Plätze: eigene Kantenwahl schlägt die Vorbelegung', () => {
  const room = createLocalRoom({
    gameId: 'monopoly',
    players: ['Anna', 'Ben', 'Clara'],
    seatMode: 'fixed',
    seatEdges: [90, 270, 0],
  });
  const ids = room.monopoly!.players.map((p) => p.id);
  assert.equal(room.seating!.edges[ids[0]], 90);
  assert.equal(room.seating!.edges[ids[1]], 270);
  assert.equal(room.seating!.edges[ids[2]], 0);
});

test('Der Drehwinkel folgt dem Sitz, der gerade handelt', () => {
  const room = createLocalRoom({
    gameId: 'monopoly',
    players: ['Anna', 'Ben', 'Clara', 'Dora'],
    seatMode: 'fixed',
  });
  const { runner } = runnerFor(room);
  runner.start();

  const g = room.monopoly!;
  for (let i = 0; i < g.players.length; i++) {
    g.currentPlayer = i;
    const seat = activeSeatId(room)!;
    assert.equal(
      rotationFor(room.seating, seat),
      room.seating!.edges[g.players[i].id],
      `Spieler ${i} bekommt seine eigene Kante`
    );
  }
});

test('rotationFor liefert 0, solange niemand handelt', () => {
  const room = createLocalRoom({
    gameId: 'monopoly',
    players: ['Anna', 'Ben'],
    seatMode: 'fixed',
  });
  assert.equal(activeSeatId(room), null, 'in der Lobby handelt niemand');
  assert.equal(rotationFor(room.seating, null), 0);
});

test('defaultEdges verteilt auch mehr Spieler als Kanten ohne Absturz', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
  const edges = defaultEdges(ids);
  assert.equal(Object.keys(edges).length, 6);
  // Bei mehr als vier teilen sich Spieler eine Kante – dafür begrenzt die UI
  // die Auswahl, hier darf es trotzdem nicht knallen.
  assert.ok(MAX_FIXED_SEATS === 4);
});

test('Feste Plätze überleben einen Neuaufbau des Raums (Persistenz-Form)', () => {
  const room = createLocalRoom({
    gameId: 'poker',
    players: ['Anna', 'Ben', 'Clara'],
    seatMode: 'fixed',
    pokerRules: { buyIn: 1000, smallBlind: 10, blindIncreaseMinutes: 0 },
  });

  // So legt local.ts den Stand ab und baut ihn wieder auf.
  const stored = JSON.parse(JSON.stringify({ seating: room.seating }));
  const restored: LocalRoom = { ...room, seating: stored.seating };

  assert.deepEqual(restored.seating, room.seating);
  const seat = room.poker!.players[1].id;
  assert.equal(rotationFor(restored.seating, seat), room.seating!.edges[seat]);
});
