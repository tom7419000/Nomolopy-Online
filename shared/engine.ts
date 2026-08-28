/**
 * Serverautoritative Monopoly-Engine.
 *
 * Alle Funktionen arbeiten direkt auf dem GameState (Server ist alleiniger
 * Besitzer des Objekts) und geben ein ActionResult zurück. Der Client nutzt
 * dieselben Prüf-Funktionen (canBuildOn, …), um Buttons zu aktivieren –
 * die eigentliche Validierung passiert aber immer hier, serverseitig.
 *
 * Bewusste Vereinfachungen gegenüber dem Originalregelwerk (dokumentiert):
 * - Auktionen (Regeloption `auctionOnSkip`) laufen REIHUM statt offen und
 *   gleichzeitig: Jeder erhöht der Reihe nach oder passt, bis einer übrig
 *   bleibt. Das ist leichter zu modellieren, zu rendern und gegen getrennte
 *   Spieler abzusichern – und es ist die einzige Form, die am geteilten
 *   Gerät überhaupt funktioniert.
 * - Geboten wird höchstens so viel, wie der Bieter bar hat. Im Original
 *   dürfte er darüber hinausgehen und danach Häuser verkaufen oder
 *   Hypotheken aufnehmen; mit dem Deckel kann der Gewinner immer zahlen,
 *   was eine ganze Klasse von Folgezuständen erspart.
 * - Karten mit "zahle jedem Spieler" / "kassiere von jedem": Zahlungs-
 *   unfähige Spieler werden automatisch liquidiert (Häuser verkaufen,
 *   Hypotheken aufnehmen) statt in eine verschachtelte Schuldenphase zu gehen.
 */

import type {
  ActionResult,
  BoardEdition,
  Card,
  GameAction,
  GameState,
  GroupId,
  LogKind,
  Player,
  RuleSet,
  TileDef,
  TradeOffer,
} from './types';
import { CHANCE_CARDS, COMMUNITY_CARDS, cardText, getCard } from './cards';
import { fmtMoney, randomId, rollDie, shuffled, MAX_PLAYERS, MIN_PLAYERS, PLAYER_COLORS, PLAYER_TOKENS } from './util';

const err = (error: string): ActionResult => ({ ok: false, error });
const OK: ActionResult = { ok: true };

// ---------------------------------------------------------------------------
// Aufbau / Lobby
// ---------------------------------------------------------------------------

export function createGame(code: string, edition: BoardEdition, presetId: string, rules: RuleSet): GameState {
  return {
    id: code,
    createdAt: Date.now(),
    phase: 'lobby',
    rules: { ...rules },
    presetId,
    edition: structuredClone(edition),
    players: [],
    currentPlayer: 0,
    turnPhase: 'awaiting-roll',
    turnCount: 0,
    dice: null,
    doubles: 0,
    nextDice: null,
    properties: {},
    chanceDeck: [],
    communityDeck: [],
    pendingCard: null,
    debt: null,
    trade: null,
    auction: null,
    freeParkingPot: 0,
    bankHouses: rules.houseLimit,
    bankHotels: rules.hotelLimit,
    log: [],
    chat: [],
    winnerId: null,
    seq: 1,
  };
}

export function addPlayer(state: GameState, id: string, name: string, isHost: boolean): ActionResult {
  if (state.phase !== 'lobby') return err('Das Spiel läuft bereits.');
  if (state.players.length >= MAX_PLAYERS) return err(`Maximal ${MAX_PLAYERS} Spieler.`);
  const usedColors = new Set(state.players.map((p) => p.color));
  const usedTokens = new Set(state.players.map((p) => p.token));
  const color = shuffled(PLAYER_COLORS).find((c) => !usedColors.has(c)) ?? PLAYER_COLORS[0];
  const token = shuffled(PLAYER_TOKENS).find((t) => !usedTokens.has(t)) ?? PLAYER_TOKENS[0];
  state.players.push({
    id,
    name,
    color,
    token,
    money: 0,
    position: 0,
    inJail: false,
    jailTurns: 0,
    jailCards: 0,
    bankrupt: false,
    connected: true,
    isHost,
  });
  log(state, 'system', `${name} ist der Lobby beigetreten.`, id);
  return OK;
}

export function removeLobbyPlayer(state: GameState, playerId: string): void {
  const p = getPlayer(state, playerId);
  state.players = state.players.filter((x) => x.id !== playerId);
  if (p) log(state, 'system', `${p.name} hat die Lobby verlassen.`);
  if (p?.isHost && state.players.length > 0) {
    state.players[0].isHost = true;
    log(state, 'system', `${state.players[0].name} ist jetzt Host.`);
  }
}

export function rerollAppearance(state: GameState, playerId: string): ActionResult {
  if (state.phase !== 'lobby') return err('Nur in der Lobby möglich.');
  const p = getPlayer(state, playerId);
  if (!p) return err('Spieler nicht gefunden.');
  const usedColors = new Set(state.players.filter((x) => x.id !== playerId).map((x) => x.color));
  const usedTokens = new Set(state.players.filter((x) => x.id !== playerId).map((x) => x.token));
  const colors = PLAYER_COLORS.filter((c) => !usedColors.has(c) && c !== p.color);
  const tokens = PLAYER_TOKENS.filter((t) => !usedTokens.has(t) && t !== p.token);
  if (colors.length) p.color = colors[Math.floor(Math.random() * colors.length)];
  if (tokens.length) p.token = tokens[Math.floor(Math.random() * tokens.length)];
  return OK;
}

export function startGame(state: GameState): ActionResult {
  if (state.phase !== 'lobby') return err('Das Spiel läuft bereits.');
  if (state.players.length < MIN_PLAYERS) return err(`Mindestens ${MIN_PLAYERS} Spieler nötig.`);
  state.phase = 'playing';
  state.turnCount = 1;
  state.bankHouses = state.rules.houseLimit;
  state.bankHotels = state.rules.hotelLimit;
  state.freeParkingPot = 0;
  state.chanceDeck = shuffled(CHANCE_CARDS.map((_, i) => i));
  state.communityDeck = shuffled(COMMUNITY_CARDS.map((_, i) => i));
  state.properties = {};
  for (const t of state.edition.tiles) {
    if (t.type === 'street' || t.type === 'railroad' || t.type === 'utility') {
      state.properties[t.id] = { ownerId: null, houses: 0, mortgaged: false };
    }
  }
  for (const p of state.players) {
    p.money = state.rules.startingMoney;
    p.position = 0;
    p.inJail = false;
    p.jailTurns = 0;
    p.jailCards = 0;
    p.bankrupt = false;
  }
  state.currentPlayer = Math.floor(Math.random() * state.players.length);
  state.turnPhase = 'awaiting-roll';
  state.dice = null;
  state.doubles = 0;
  state.debt = null;
  state.trade = null;
  state.auction = null;
  state.pendingCard = null;
  state.winnerId = null;
  log(state, 'system', `Das Spiel beginnt! ${cur(state).name} fängt an.`);
  return OK;
}

/** Nach Spielende: zurück in die Lobby (gleiche Spieler, gleiche Einstellungen). */
export function resetToLobby(state: GameState): void {
  state.phase = 'lobby';
  state.winnerId = null;
  state.properties = {};
  state.debt = null;
  state.trade = null;
  state.auction = null;
  state.pendingCard = null;
  state.dice = null;
  for (const p of state.players) {
    p.bankrupt = false;
    p.money = 0;
    p.position = 0;
    p.inJail = false;
    p.jailTurns = 0;
    p.jailCards = 0;
  }
  log(state, 'system', 'Zurück in der Lobby – bereit für eine neue Runde.');
}

// ---------------------------------------------------------------------------
// Getter / Helfer (auch vom Client für die UI genutzt)
// ---------------------------------------------------------------------------

export function getPlayer(state: GameState, id: string): Player | undefined {
  return state.players.find((p) => p.id === id);
}

export function cur(state: GameState): Player {
  return state.players[state.currentPlayer];
}

export function getTile(state: GameState, id: number): TileDef {
  return state.edition.tiles[id];
}

export function activePlayers(state: GameState): Player[] {
  return state.players.filter((p) => !p.bankrupt);
}

export function groupTiles(edition: BoardEdition, group: GroupId): TileDef[] {
  return edition.tiles.filter((t) => t.type === 'street' && t.group === group);
}

export function ownsFullGroup(state: GameState, playerId: string, group: GroupId): boolean {
  return groupTiles(state.edition, group).every(
    (t) => state.properties[t.id]?.ownerId === playerId
  );
}

export function countOwned(state: GameState, playerId: string, type: 'railroad' | 'utility'): number {
  return state.edition.tiles.filter(
    (t) => t.type === type && state.properties[t.id]?.ownerId === playerId
  ).length;
}

/** Miete für ein Feld (diceTotal nur für Werke relevant). */
export function computeRent(state: GameState, tileId: number, diceTotal: number): number {
  const tile = getTile(state, tileId);
  const prop = state.properties[tileId];
  if (!prop?.ownerId || prop.mortgaged) return 0;
  if (tile.type === 'street') {
    const rents = tile.rent!;
    if (prop.houses > 0) return rents[prop.houses];
    const base = rents[0];
    if (state.rules.doubleRentFullGroup && ownsFullGroup(state, prop.ownerId, tile.group!)) {
      return base * 2;
    }
    return base;
  }
  if (tile.type === 'railroad') {
    const n = countOwned(state, prop.ownerId, 'railroad');
    return tile.rent![Math.min(n, 4) - 1];
  }
  if (tile.type === 'utility') {
    const n = countOwned(state, prop.ownerId, 'utility');
    return tile.rent![Math.min(n, 2) - 1] * diceTotal;
  }
  return 0;
}

export interface Check {
  ok: boolean;
  reason?: string;
}

const no = (reason: string): Check => ({ ok: false, reason });
const yes: Check = { ok: true };

function buildableGroupState(state: GameState, playerId: string, tileId: number): Check {
  const tile = getTile(state, tileId);
  if (tile.type !== 'street') return no('Nur auf Straßen kann gebaut werden.');
  const prop = state.properties[tileId];
  if (prop.ownerId !== playerId) return no('Dir gehört diese Straße nicht.');
  if (!ownsFullGroup(state, playerId, tile.group!)) return no('Dir gehört noch nicht die ganze Farbgruppe.');
  const group = groupTiles(state.edition, tile.group!);
  if (group.some((t) => state.properties[t.id].mortgaged)) {
    return no('In dieser Gruppe ist eine Straße mit Hypothek belastet.');
  }
  return yes;
}

export function canBuildOn(state: GameState, playerId: string, tileId: number): Check {
  const g = buildableGroupState(state, playerId, tileId);
  if (!g.ok) return g;
  const tile = getTile(state, tileId);
  const prop = state.properties[tileId];
  if (prop.houses >= 5) return no('Hier steht bereits ein Hotel.');
  const group = groupTiles(state.edition, tile.group!);
  const minHouses = Math.min(...group.map((t) => state.properties[t.id].houses));
  if (prop.houses > minHouses) return no('Es muss gleichmäßig gebaut werden.');
  if (prop.houses === 4) {
    if (state.bankHotels <= 0) return no('Die Bank hat keine Hotels mehr.');
  } else if (state.bankHouses <= 0) {
    return no('Die Bank hat keine Häuser mehr.');
  }
  const player = getPlayer(state, playerId)!;
  if (player.money < tile.houseCost!) return no('Nicht genug Geld.');
  return yes;
}

export function canSellHouseOn(state: GameState, playerId: string, tileId: number): Check {
  const tile = getTile(state, tileId);
  if (tile.type !== 'street') return no('Keine Straße.');
  const prop = state.properties[tileId];
  if (prop.ownerId !== playerId) return no('Dir gehört diese Straße nicht.');
  if (prop.houses <= 0) return no('Hier steht kein Gebäude.');
  const group = groupTiles(state.edition, tile.group!);
  const maxHouses = Math.max(...group.map((t) => state.properties[t.id].houses));
  if (prop.houses < maxHouses) return no('Es muss gleichmäßig verkauft werden.');
  return yes;
}

export function canMortgage(state: GameState, playerId: string, tileId: number): Check {
  const tile = getTile(state, tileId);
  const prop = state.properties[tileId];
  if (!prop || prop.ownerId !== playerId) return no('Dir gehört dieses Grundstück nicht.');
  if (prop.mortgaged) return no('Bereits mit Hypothek belastet.');
  if (tile.type === 'street') {
    const group = groupTiles(state.edition, tile.group!);
    const ownBuilt = group.some(
      (t) => state.properties[t.id].ownerId === playerId && state.properties[t.id].houses > 0
    );
    if (ownBuilt) return no('Erst alle Gebäude der Farbgruppe verkaufen.');
  }
  return yes;
}

export function unmortgageCost(state: GameState, tileId: number): number {
  const tile = getTile(state, tileId);
  return Math.round((tile.price! / 2) * (1 + state.rules.mortgageInterest));
}

export function canUnmortgage(state: GameState, playerId: string, tileId: number): Check {
  const prop = state.properties[tileId];
  if (!prop || prop.ownerId !== playerId) return no('Dir gehört dieses Grundstück nicht.');
  if (!prop.mortgaged) return no('Keine Hypothek vorhanden.');
  const player = getPlayer(state, playerId)!;
  if (player.money < unmortgageCost(state, tileId)) return no('Nicht genug Geld.');
  return yes;
}

/** Wie viel Geld ein Spieler durch Verkäufe/Hypotheken maximal noch beschaffen kann. */
export function liquidationCapacity(state: GameState, playerId: string): number {
  let sum = 0;
  for (const t of state.edition.tiles) {
    const prop = state.properties[t.id];
    if (!prop || prop.ownerId !== playerId) continue;
    if (t.type === 'street' && prop.houses > 0) {
      sum += Math.floor((prop.houses * t.houseCost!) / 2);
    }
    if (!prop.mortgaged) sum += Math.floor(t.price! / 2);
  }
  return sum;
}

export function netWorth(state: GameState, playerId: string): number {
  const p = getPlayer(state, playerId);
  if (!p || p.bankrupt) return 0;
  let sum = p.money;
  for (const t of state.edition.tiles) {
    const prop = state.properties[t.id];
    if (!prop || prop.ownerId !== playerId) continue;
    sum += prop.mortgaged ? Math.floor(t.price! / 2) : t.price!;
    if (t.type === 'street' && prop.houses > 0) sum += prop.houses * t.houseCost!;
  }
  return sum;
}

export function ownedTiles(state: GameState, playerId: string): TileDef[] {
  return state.edition.tiles.filter((t) => state.properties[t.id]?.ownerId === playerId);
}

function money(state: GameState, amount: number): string {
  return fmtMoney(amount, state.edition.currency);
}

export function log(state: GameState, kind: LogKind, text: string, playerId?: string): void {
  state.log.push({ id: state.seq++, time: Date.now(), kind, text, playerId });
  if (state.log.length > 250) state.log.splice(0, state.log.length - 250);
}

export function addChat(state: GameState, playerId: string, text: string): ActionResult {
  const p = getPlayer(state, playerId);
  if (!p) return err('Spieler nicht gefunden.');
  const clean = text.trim().slice(0, 500);
  if (!clean) return err('Leere Nachricht.');
  state.chat.push({
    id: state.seq++,
    time: Date.now(),
    playerId,
    name: p.name,
    color: p.color,
    text: clean,
  });
  if (state.chat.length > 150) state.chat.splice(0, state.chat.length - 150);
  return OK;
}

// ---------------------------------------------------------------------------
// Geldfluss
// ---------------------------------------------------------------------------

/** Zahlung an die Bank; Strafen/Steuern wandern optional in den Frei-Parken-Topf. */
function bankReceives(state: GameState, amount: number, toPot: boolean): void {
  if (toPot && state.rules.freeParkingBonus) {
    state.freeParkingPot += amount;
  }
}

/**
 * Belastet einen Spieler. Reicht das Geld nicht, wird die Schuldenphase
 * eröffnet (der Spieler muss verkaufen/beleihen oder Bankrott erklären).
 * Gibt true zurück, wenn sofort vollständig gezahlt wurde.
 */
function charge(
  state: GameState,
  payer: Player,
  amount: number,
  creditorId: string | null,
  reason: string,
  toPot: boolean,
  then?: { kind: 'jailRelease'; total: number }
): boolean {
  if (amount <= 0) return true;
  if (payer.money >= amount) {
    payer.money -= amount;
    const creditor = creditorId ? getPlayer(state, creditorId) : undefined;
    if (creditor) creditor.money += amount;
    else bankReceives(state, amount, toPot);
    log(
      state,
      'money',
      `${payer.name} zahlt ${money(state, amount)} ${creditor ? `an ${creditor.name}` : 'an die Bank'} (${reason}).`,
      payer.id
    );
    return true;
  }
  state.debt = { playerId: payer.id, amount, creditorId, reason, then };
  state.turnPhase = 'debt';
  log(
    state,
    'money',
    `${payer.name} kann ${money(state, amount)} (${reason}) nicht zahlen und muss Geld beschaffen oder aufgeben!`,
    payer.id
  );
  return false;
}

/** Automatisch Häuser verkaufen und Hypotheken aufnehmen, bis target erreicht ist. */
function autoRaise(state: GameState, player: Player, target: number): void {
  let progress = true;
  while (player.money < target && progress) {
    progress = false;
    // 1. Gebäude verkaufen (höchste Bebauung zuerst, hält die Gleichmäßigkeit ein)
    const built = state.edition.tiles
      .filter(
        (t) =>
          t.type === 'street' &&
          state.properties[t.id]?.ownerId === player.id &&
          state.properties[t.id].houses > 0
      )
      .sort((a, b) => state.properties[b.id].houses - state.properties[a.id].houses);
    if (built.length > 0) {
      sellOneLevel(state, player, built[0].id);
      progress = true;
      continue;
    }
    // 2. Hypothek aufnehmen
    const mortgageable = state.edition.tiles.find(
      (t) => state.properties[t.id]?.ownerId === player.id && canMortgage(state, player.id, t.id).ok
    );
    if (mortgageable) {
      doMortgage(state, player, mortgageable.id);
      progress = true;
    }
  }
}

/**
 * Erzwungene Zahlung (Karteneffekte, automatischer Zugabschluss): liquidiert
 * notfalls automatisch; reicht es trotzdem nicht, geht der Spieler bankrott.
 */
function forcePay(state: GameState, from: Player, toId: string | null, amount: number, reason: string): void {
  if (from.money < amount) autoRaise(state, from, amount);
  if (from.money >= amount) {
    from.money -= amount;
    const to = toId ? getPlayer(state, toId) : undefined;
    if (to) to.money += amount;
    else bankReceives(state, amount, true);
    log(
      state,
      'money',
      `${from.name} zahlt ${money(state, amount)} ${to ? `an ${to.name}` : 'an die Bank'} (${reason}).`,
      from.id
    );
  } else {
    log(state, 'money', `${from.name} kann ${money(state, amount)} (${reason}) nicht aufbringen.`, from.id);
    bankruptPlayer(state, from, toId);
  }
}

// ---------------------------------------------------------------------------
// Bewegung & Feld-Auflösung
// ---------------------------------------------------------------------------

function grantGoSalary(state: GameState, player: Player): void {
  player.money += state.rules.goSalary;
  log(state, 'money', `${player.name} kommt über ${getTile(state, 0).name} und erhält ${money(state, state.rules.goSalary)}.`, player.id);
}

function moveBy(state: GameState, player: Player, steps: number): void {
  const from = player.position;
  let to = (from + steps) % 40;
  if (to < 0) to += 40;
  player.position = to;
  if (steps > 0 && from + steps >= 40) grantGoSalary(state, player);
}

function moveTo(state: GameState, player: Player, target: number, collectGo: boolean): void {
  if (collectGo && target <= player.position) grantGoSalary(state, player);
  player.position = target;
}

function sendToJail(state: GameState, player: Player): void {
  player.position = 10;
  player.inJail = true;
  player.jailTurns = 0;
  state.doubles = 0;
  log(state, 'move', `${player.name} muss ins Gefängnis! 🚔`, player.id);
}

function resolveLanding(state: GameState, player: Player, diceTotal: number): void {
  const tile = getTile(state, player.position);
  log(state, 'move', `${player.name} landet auf ${tile.name}.`, player.id);
  state.turnPhase = 'awaiting-end';

  switch (tile.type) {
    case 'street':
    case 'railroad':
    case 'utility': {
      const prop = state.properties[tile.id];
      if (!prop.ownerId) {
        state.turnPhase = 'awaiting-buy';
        return;
      }
      if (prop.ownerId === player.id) return;
      if (prop.mortgaged) {
        log(state, 'info', `${tile.name} ist mit einer Hypothek belastet – keine Miete fällig.`);
        return;
      }
      const owner = getPlayer(state, prop.ownerId);
      if (!owner || owner.bankrupt) return;
      const rent = computeRent(state, tile.id, diceTotal);
      charge(state, player, rent, owner.id, `Miete für ${tile.name}`, false);
      return;
    }
    case 'tax': {
      charge(state, player, tile.tax!, null, tile.name, true);
      return;
    }
    case 'chance':
      drawCard(state, player, 'chance');
      return;
    case 'community':
      drawCard(state, player, 'community');
      return;
    case 'gotojail':
      sendToJail(state, player);
      return;
    case 'freeparking': {
      if (state.rules.freeParkingBonus && state.freeParkingPot > 0) {
        player.money += state.freeParkingPot;
        log(state, 'money', `${player.name} kassiert den Frei-Parken-Topf: ${money(state, state.freeParkingPot)}! 🎉`, player.id);
        state.freeParkingPot = 0;
      }
      return;
    }
    case 'go':
    case 'jail':
      return;
  }
}

// ---------------------------------------------------------------------------
// Karten
// ---------------------------------------------------------------------------

function drawCard(state: GameState, player: Player, deck: 'chance' | 'community'): void {
  const pile = deck === 'chance' ? state.chanceDeck : state.communityDeck;
  if (pile.length === 0) {
    const source = deck === 'chance' ? CHANCE_CARDS : COMMUNITY_CARDS;
    pile.push(...shuffled(source.map((_, i) => i)));
  }
  const idx = pile.shift()!;
  pile.push(idx); // Karte wandert unter den Stapel (zyklisch)
  const card = getCard(deck, idx);
  state.pendingCard = { card, playerId: player.id };
  state.turnPhase = 'awaiting-card';
  log(
    state,
    'card',
    `${player.name} zieht eine ${deck === 'chance' ? 'Ereigniskarte' : 'Gemeinschaftskarte'}: „${cardText(card, state.edition)}“`,
    player.id
  );
}

function applyCard(state: GameState, player: Player, card: Card): void {
  state.pendingCard = null;
  state.turnPhase = 'awaiting-end';
  const e = card.effect;
  switch (e.kind) {
    case 'money':
      if (e.amount >= 0) {
        player.money += e.amount;
        log(state, 'money', `${player.name} erhält ${money(state, e.amount)}.`, player.id);
      } else {
        charge(state, player, -e.amount, null, 'Kartenzahlung', true);
      }
      return;
    case 'moveTo':
      moveTo(state, player, e.tile, e.collectGo);
      resolveLanding(state, player, diceTotal(state));
      return;
    case 'moveBy':
      moveBy(state, player, e.steps);
      resolveLanding(state, player, diceTotal(state));
      return;
    case 'gotojail':
      sendToJail(state, player);
      return;
    case 'jailFree':
      player.jailCards += 1;
      log(state, 'card', `${player.name} behält die Gefängnis-Frei-Karte.`, player.id);
      return;
    case 'perHouse': {
      let houses = 0;
      let hotels = 0;
      for (const t of state.edition.tiles) {
        const prop = state.properties[t.id];
        if (t.type === 'street' && prop?.ownerId === player.id) {
          if (prop.houses === 5) hotels += 1;
          else houses += prop.houses;
        }
      }
      const total = houses * e.house + hotels * e.hotel;
      if (total > 0) charge(state, player, total, null, 'Reparaturen', true);
      else log(state, 'info', `${player.name} besitzt keine Gebäude – nichts zu zahlen.`, player.id);
      return;
    }
    case 'collectFromEach': {
      for (const other of activePlayers(state)) {
        if (other.id === player.id) continue;
        forcePay(state, other, player.id, e.amount, 'Geschenk');
        if (state.phase === 'ended') return;
      }
      return;
    }
    case 'payToEach': {
      const others = activePlayers(state).filter((p) => p.id !== player.id);
      for (const other of others) {
        forcePay(state, player, other.id, e.amount, 'Kartenzahlung');
        if (player.bankrupt || state.phase === 'ended') return;
      }
      return;
    }
  }
}

function diceTotal(state: GameState): number {
  return state.dice ? state.dice[0] + state.dice[1] : 7;
}

// ---------------------------------------------------------------------------
// Bauen / Hypotheken (interne Ausführung, Guards in applyAction)
// ---------------------------------------------------------------------------

function doBuild(state: GameState, player: Player, tileId: number): void {
  const tile = getTile(state, tileId);
  const prop = state.properties[tileId];
  player.money -= tile.houseCost!;
  if (prop.houses === 4) {
    prop.houses = 5;
    state.bankHotels -= 1;
    state.bankHouses += 4;
    log(state, 'info', `${player.name} baut ein Hotel auf ${tile.name}. 🏨`, player.id);
  } else {
    prop.houses += 1;
    state.bankHouses -= 1;
    log(state, 'info', `${player.name} baut ein Haus auf ${tile.name} (${prop.houses}/4). 🏠`, player.id);
  }
}

function sellOneLevel(state: GameState, player: Player, tileId: number): void {
  const tile = getTile(state, tileId);
  const prop = state.properties[tileId];
  const half = Math.floor(tile.houseCost! / 2);
  if (prop.houses === 5) {
    if (state.bankHouses >= 4) {
      prop.houses = 4;
      state.bankHotels += 1;
      state.bankHouses -= 4;
      player.money += half;
      log(state, 'info', `${player.name} verkauft das Hotel auf ${tile.name} (zurück zu 4 Häusern, +${money(state, half)}).`, player.id);
    } else {
      // Bank hat keine 4 Häuser als Ersatz → Komplettabriss
      prop.houses = 0;
      state.bankHotels += 1;
      player.money += half * 5;
      log(state, 'info', `${player.name} reißt das Hotel auf ${tile.name} komplett ab (+${money(state, half * 5)}).`, player.id);
    }
  } else {
    prop.houses -= 1;
    state.bankHouses += 1;
    player.money += half;
    log(state, 'info', `${player.name} verkauft ein Haus auf ${tile.name} (+${money(state, half)}).`, player.id);
  }
}

function doMortgage(state: GameState, player: Player, tileId: number): void {
  const tile = getTile(state, tileId);
  const prop = state.properties[tileId];
  prop.mortgaged = true;
  const value = Math.floor(tile.price! / 2);
  player.money += value;
  log(state, 'money', `${player.name} nimmt eine Hypothek auf ${tile.name} auf (+${money(state, value)}).`, player.id);
}

// ---------------------------------------------------------------------------
// Bankrott & Sieg
// ---------------------------------------------------------------------------

function bankruptPlayer(state: GameState, player: Player, creditorId: string | null): void {
  // Gebäude zwangsverkaufen (Erlös geht mit in die Masse)
  for (const t of state.edition.tiles) {
    const prop = state.properties[t.id];
    if (t.type === 'street' && prop?.ownerId === player.id && prop.houses > 0) {
      const half = Math.floor(t.houseCost! / 2);
      if (prop.houses === 5) {
        state.bankHotels += 1;
        player.money += half * 5;
      } else {
        state.bankHouses += prop.houses;
        player.money += half * prop.houses;
      }
      prop.houses = 0;
    }
  }
  const creditor = creditorId ? getPlayer(state, creditorId) : undefined;
  if (creditor && !creditor.bankrupt) {
    creditor.money += player.money;
    creditor.jailCards += player.jailCards;
    for (const key of Object.keys(state.properties)) {
      const prop = state.properties[Number(key)];
      if (prop.ownerId === player.id) prop.ownerId = creditor.id; // Hypotheken bleiben bestehen
    }
    log(state, 'system', `💥 ${player.name} ist bankrott! Der gesamte Besitz geht an ${creditor.name}.`, player.id);
  } else {
    for (const key of Object.keys(state.properties)) {
      const prop = state.properties[Number(key)];
      if (prop.ownerId === player.id) {
        prop.ownerId = null;
        prop.mortgaged = false;
      }
    }
    log(state, 'system', `💥 ${player.name} ist bankrott! Der Besitz fällt an die Bank zurück.`, player.id);
  }
  player.money = 0;
  player.jailCards = 0;
  player.bankrupt = true;
  player.inJail = false;
  if (state.debt?.playerId === player.id) state.debt = null;
  if (state.pendingCard?.playerId === player.id) state.pendingCard = null;
  if (state.trade && (state.trade.fromId === player.id || state.trade.toId === player.id)) {
    state.trade = null;
  }
  // Aus einer laufenden Auktion fällt der Bankrotteur einfach heraus.
  if (state.auction) dropFromAuction(state, player.id);

  if (checkWinner(state)) return;
  if (cur(state).id === player.id && state.phase === 'playing') {
    advanceTurn(state);
  }
}

function checkWinner(state: GameState): boolean {
  const active = activePlayers(state);
  if (active.length === 1 && state.phase === 'playing') {
    state.phase = 'ended';
    state.winnerId = active[0].id;
    state.debt = null;
    state.trade = null;
    state.auction = null;
    state.pendingCard = null;
    log(state, 'system', `🏆 ${active[0].name} gewinnt das Spiel!`, active[0].id);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Zugwechsel
// ---------------------------------------------------------------------------

function advanceTurn(state: GameState): void {
  if (state.phase !== 'playing') return;
  state.doubles = 0;
  let idx = state.currentPlayer;
  for (let i = 0; i < state.players.length; i++) {
    idx = (idx + 1) % state.players.length;
    if (!state.players[idx].bankrupt) break;
  }
  state.currentPlayer = idx;
  state.turnCount += 1;
  state.turnPhase = 'awaiting-roll';
  log(state, 'system', `▶ ${cur(state).name} ist am Zug.`, cur(state).id);
}

// ---------------------------------------------------------------------------
// Haupteinstieg: Aktionen
// ---------------------------------------------------------------------------

export function applyAction(state: GameState, playerId: string, action: GameAction): ActionResult {
  if (state.phase === 'lobby') return err('Das Spiel hat noch nicht begonnen.');
  const player = getPlayer(state, playerId);
  if (!player) return err('Spieler nicht gefunden.');

  // Aktionen, die auch nach Spielende bzw. außer der Reihe erlaubt sind
  switch (action.type) {
    case 'resign':
      return doResign(state, player);
    case 'proposeTrade':
      return doProposeTrade(state, player, action);
    case 'respondTrade':
      return doRespondTrade(state, player, action.accept);
    case 'cancelTrade':
      return doCancelTrade(state, player);
    // Bieter sind nicht der aktuelle Spieler – deshalb hier oben, wie beim Handel
    case 'bid':
      return doBid(state, player, action.amount);
    case 'passAuction':
      return doPassAuction(state, player);
    case 'setDice': {
      if (!state.rules.debugMode) return err('Debug-Modus ist deaktiviert.');
      const [a, b] = action.dice;
      if (![1, 2, 3, 4, 5, 6].includes(a) || ![1, 2, 3, 4, 5, 6].includes(b)) {
        return err('Ungültige Würfelwerte.');
      }
      state.nextDice = [a, b];
      log(state, 'system', `🐞 Debug: Nächster Wurf wird ${a} + ${b}.`);
      return OK;
    }
    case 'forceEndTurn':
      return doForceEndTurn(state, player);
    case 'removePlayer':
      return doRemovePlayer(state, player, action.targetId);
    default:
      break;
  }

  if (state.phase !== 'playing') return err('Das Spiel ist beendet.');
  if (player.bankrupt) return err('Du bist bereits ausgeschieden.');

  switch (action.type) {
    case 'roll':
      return doRoll(state, player);
    case 'buy':
      return doBuy(state, player);
    case 'skipBuy':
      return doSkipBuy(state, player);
    case 'endTurn':
      return doEndTurn(state, player);
    case 'payJail':
      return doPayJail(state, player);
    case 'useJailCard':
      return doUseJailCard(state, player);
    case 'ackCard':
      return doAckCard(state, player);
    case 'build':
    case 'sellHouse':
    case 'mortgage':
    case 'unmortgage':
      return doManage(state, player, action);
    case 'payDebt':
      return doPayDebt(state, player);
    case 'declareBankruptcy': {
      if (!state.debt || state.debt.playerId !== player.id) {
        return err('Du hast keine offenen Schulden.');
      }
      const creditor = state.debt.creditorId;
      bankruptPlayer(state, player, creditor);
      return OK;
    }
    default:
      return err('Unbekannte Aktion.');
  }
}

/**
 * Erzwingt Vollständigkeit in Switches über eine Union. Ohne das schweigt
 * TypeScript bei Anweisungs-Switches im void-Kontext – ein neuer Fall würde
 * dort still nichts tun.
 */
function assertNever(x: never, what = 'Fall'): never {
  throw new Error(`Unbehandelter ${what}: ${JSON.stringify(x)}`);
}

function requireTurn(state: GameState, player: Player): ActionResult | null {
  if (cur(state).id !== player.id) return err('Du bist nicht am Zug.');
  return null;
}

function doRoll(state: GameState, player: Player): ActionResult {
  const guard = requireTurn(state, player);
  if (guard) return guard;
  if (state.turnPhase !== 'awaiting-roll') return err('Jetzt kann nicht gewürfelt werden.');

  const dice: [number, number] =
    state.rules.debugMode && state.nextDice ? state.nextDice : [rollDie(), rollDie()];
  state.nextDice = null;
  state.dice = dice;
  const [a, b] = dice;
  const isDouble = a === b;
  const total = a + b;
  log(state, 'move', `${player.name} würfelt ${a} + ${b} = ${total}${isDouble ? ' (Pasch!)' : ''}. 🎲`, player.id);

  if (player.inJail) {
    if (isDouble) {
      player.inJail = false;
      player.jailTurns = 0;
      state.doubles = 0; // kein Extra-Wurf nach Pasch aus dem Gefängnis
      log(state, 'move', `${player.name} würfelt einen Pasch und kommt frei!`, player.id);
      moveBy(state, player, total);
      resolveLanding(state, player, total);
      return OK;
    }
    player.jailTurns += 1;
    if (player.jailTurns >= state.rules.maxJailTurns) {
      log(state, 'info', `${player.name} muss nach ${player.jailTurns} Versuchen die Kaution zahlen.`, player.id);
      const paid = charge(
        state,
        player,
        state.rules.jailFine,
        null,
        'Gefängnis-Kaution',
        true,
        { kind: 'jailRelease', total }
      );
      if (paid) {
        player.inJail = false;
        player.jailTurns = 0;
        moveBy(state, player, total);
        resolveLanding(state, player, total);
      }
      return OK;
    }
    log(state, 'info', `${player.name} bleibt im Gefängnis (Versuch ${player.jailTurns}/${state.rules.maxJailTurns}).`, player.id);
    state.turnPhase = 'awaiting-end';
    return OK;
  }

  if (isDouble) {
    state.doubles += 1;
    if (state.doubles >= 3) {
      log(state, 'move', `${player.name} würfelt den dritten Pasch in Folge!`, player.id);
      sendToJail(state, player);
      state.turnPhase = 'awaiting-end';
      return OK;
    }
  } else {
    state.doubles = 0;
  }

  moveBy(state, player, total);
  resolveLanding(state, player, total);
  return OK;
}

function doBuy(state: GameState, player: Player): ActionResult {
  const guard = requireTurn(state, player);
  if (guard) return guard;
  if (state.turnPhase !== 'awaiting-buy') return err('Es steht kein Kauf an.');
  const tile = getTile(state, player.position);
  const prop = state.properties[tile.id];
  if (!prop || prop.ownerId) return err('Dieses Grundstück ist nicht zu kaufen.');
  if (player.money < tile.price!) return err('Nicht genug Geld.');
  player.money -= tile.price!;
  prop.ownerId = player.id;
  log(state, 'money', `${player.name} kauft ${tile.name} für ${money(state, tile.price!)}. 🏠`, player.id);
  state.turnPhase = 'awaiting-end';
  return OK;
}

function doSkipBuy(state: GameState, player: Player): ActionResult {
  const guard = requireTurn(state, player);
  if (guard) return guard;
  if (state.turnPhase !== 'awaiting-buy') return err('Es steht kein Kauf an.');
  const tile = getTile(state, player.position);
  log(state, 'info', `${player.name} verzichtet auf den Kauf von ${tile.name}.`, player.id);
  // Zweiter Einstieg neben dem freiwilligen Verzicht: Wer sich das Feld nicht
  // leisten kann, landet über denselben Knopf hier – auch dann wird versteigert.
  if (state.rules.auctionOnSkip) {
    startAuction(state, tile.id);
    return OK;
  }
  state.turnPhase = 'awaiting-end';
  return OK;
}

// ---------------------------------------------------------------------------
// Auktion (Regeloption `auctionOnSkip`)
// ---------------------------------------------------------------------------

/** Mindesterhöhung – hält Auktionen kurz, ohne 1er-Schritte zu erzwingen. */
const MIN_BID_STEP = 1;

/**
 * Eröffnet die Versteigerung eines ausgeschlagenen Grundstücks.
 *
 * Bieter sind alle nicht bankrotten Spieler, beginnend beim aktuellen –
 * das entspricht dem Original, wo der Ausschlagende mitbieten darf.
 */
function startAuction(state: GameState, tileId: number): void {
  const order: string[] = [];
  const n = state.players.length;
  for (let i = 0; i < n; i++) {
    const p = state.players[(state.currentPlayer + i) % n];
    if (!p.bankrupt) order.push(p.id);
  }

  state.auction = {
    id: randomId(8),
    tileId,
    order,
    turnIndex: 0,
    passed: [],
    highBid: 0,
    highBidderId: null,
    deadline: auctionDeadline(state),
  };
  state.turnPhase = 'auction';
  log(
    state,
    'info',
    `🔨 ${getTile(state, tileId).name} kommt unter den Hammer – wer bietet?`
  );
}

function auctionDeadline(state: GameState): number | null {
  const secs = state.rules.auctionBidSeconds;
  return secs > 0 ? Date.now() + secs * 1000 : null;
}

/** Wer ist mit Bieten dran? `null`, wenn die Auktion vorbei ist. */
export function auctionBidderId(state: GameState): string | null {
  const a = state.auction;
  if (!a) return null;
  return a.order[a.turnIndex] ?? null;
}

/** Höchstgebot, das ein Spieler abgeben darf: sein Bargeld (siehe Kopfkommentar). */
export function maxBid(state: GameState, playerId: string): number {
  return getPlayer(state, playerId)?.money ?? 0;
}

/** Mindestgebot, um das aktuelle Höchstgebot zu überbieten. */
export function minBid(state: GameState): number {
  return (state.auction?.highBid ?? 0) + MIN_BID_STEP;
}

/** Schaltet auf den nächsten Bieter weiter, der noch nicht gepasst hat. */
function nextBidder(state: GameState): void {
  const a = state.auction;
  if (!a) return;
  for (let i = 1; i <= a.order.length; i++) {
    const idx = (a.turnIndex + i) % a.order.length;
    if (!a.passed.includes(a.order[idx])) {
      a.turnIndex = idx;
      a.deadline = auctionDeadline(state);
      return;
    }
  }
}

/** Nimmt einen Spieler aus der laufenden Auktion (Bankrott, Rauswurf). */
function dropFromAuction(state: GameState, playerId: string): void {
  const a = state.auction;
  if (!a || a.passed.includes(playerId)) return;
  a.passed.push(playerId);
  if (a.highBidderId === playerId) {
    // Das Gebot eines Ausgeschiedenen verfällt.
    a.highBidderId = null;
    a.highBid = 0;
  }
  if (settleAuctionIfDone(state)) return;
  // War er gerade mit Bieten dran, rückt der Nächste nach.
  if (a.order[a.turnIndex] === playerId) nextBidder(state);
}

/**
 * Beendet die Auktion, sobald höchstens ein Bieter übrig ist.
 * Gibt zurück, ob sie beendet wurde.
 */
function settleAuctionIfDone(state: GameState): boolean {
  const a = state.auction;
  if (!a) return false;
  const remaining = a.order.filter((id) => !a.passed.includes(id));
  if (remaining.length > 1) return false;
  // Ist einer übrig, der noch gar nicht geboten hat, bekommt er erst seine
  // Gelegenheit – sonst ginge das Feld unverkauft an ihm vorbei.
  if (remaining.length === 1 && a.highBidderId !== remaining[0]) return false;

  const tile = getTile(state, a.tileId);
  const winnerId = remaining.length === 1 && a.highBidderId === remaining[0] ? remaining[0] : null;

  if (winnerId && a.highBid > 0) {
    const winner = getPlayer(state, winnerId)!;
    winner.money -= a.highBid;
    state.properties[a.tileId].ownerId = winnerId;
    log(
      state,
      'money',
      `🔨 ${winner.name} ersteigert ${tile.name} für ${money(state, a.highBid)}.`,
      winnerId
    );
  } else {
    log(state, 'info', `🔨 Niemand bietet auf ${tile.name} – es bleibt unverkauft.`);
  }

  state.auction = null;
  // Der Zug des aktuellen Spielers geht ganz normal weiter.
  state.turnPhase = 'awaiting-end';
  return true;
}

function doBid(state: GameState, player: Player, amount: number): ActionResult {
  const a = state.auction;
  if (!a) return err('Es läuft gerade keine Auktion.');
  if (auctionBidderId(state) !== player.id) return err('Du bist nicht mit Bieten dran.');

  const bid = Math.floor(amount);
  if (!Number.isFinite(bid)) return err('Ungültiges Gebot.');
  if (bid < minBid(state)) {
    return err(`Mindestens ${money(state, minBid(state))} bieten.`);
  }
  if (bid > maxBid(state, player.id)) {
    return err('So viel Bargeld hast du nicht.');
  }

  a.highBid = bid;
  a.highBidderId = player.id;
  log(state, 'info', `${player.name} bietet ${money(state, bid)}.`, player.id);
  nextBidder(state);
  settleAuctionIfDone(state);
  return OK;
}

function doPassAuction(state: GameState, player: Player): ActionResult {
  const a = state.auction;
  if (!a) return err('Es läuft gerade keine Auktion.');
  if (auctionBidderId(state) !== player.id) return err('Du bist nicht mit Bieten dran.');

  a.passed.push(player.id);
  log(state, 'info', `${player.name} passt.`, player.id);
  if (!settleAuctionIfDone(state)) nextBidder(state);
  return OK;
}

/**
 * Zeitgesteuerter Fortschritt: Wer die Bedenkzeit verstreichen lässt, passt.
 * Gibt zurück, ob sich der Zustand geändert hat (dann neu broadcasten).
 *
 * Nötig, weil `doForceEndTurn` nur auf den aktuellen Spieler wirkt – ein
 * getrennter BIETER wäre außerhalb seiner Reichweite und würde die Auktion
 * für alle einfrieren.
 */
export function auctionTick(state: GameState, now = Date.now()): boolean {
  const a = state.auction;
  if (!a || a.deadline === null || now < a.deadline) return false;
  const bidder = auctionBidderId(state);
  if (!bidder) return false;
  const p = getPlayer(state, bidder);
  if (!p) return false;
  log(state, 'info', `⏱ ${p.name} lässt die Bedenkzeit verstreichen und passt.`, p.id);
  a.passed.push(bidder);
  if (!settleAuctionIfDone(state)) nextBidder(state);
  return true;
}

/** Nächste Frist der Monopoly-Engine (heute nur Auktionen). */
export function nextDeadline(state: GameState): number | null {
  return state.auction?.deadline ?? null;
}

function doEndTurn(state: GameState, player: Player): ActionResult {
  const guard = requireTurn(state, player);
  if (guard) return guard;
  if (state.turnPhase !== 'awaiting-end') return err('Der Zug kann jetzt nicht beendet werden.');
  if (state.doubles > 0 && !player.inJail) {
    state.turnPhase = 'awaiting-roll';
    log(state, 'info', `${player.name} hat einen Pasch geworfen und ist sofort nochmal dran!`, player.id);
    return OK;
  }
  advanceTurn(state);
  return OK;
}

function doPayJail(state: GameState, player: Player): ActionResult {
  const guard = requireTurn(state, player);
  if (guard) return guard;
  if (!player.inJail) return err('Du bist nicht im Gefängnis.');
  if (state.turnPhase !== 'awaiting-roll') return err('Jetzt nicht möglich.');
  if (player.money < state.rules.jailFine) return err('Nicht genug Geld für die Kaution.');
  player.money -= state.rules.jailFine;
  bankReceives(state, state.rules.jailFine, true);
  player.inJail = false;
  player.jailTurns = 0;
  log(state, 'money', `${player.name} zahlt ${money(state, state.rules.jailFine)} Kaution und ist frei.`, player.id);
  return OK;
}

function doUseJailCard(state: GameState, player: Player): ActionResult {
  const guard = requireTurn(state, player);
  if (guard) return guard;
  if (!player.inJail) return err('Du bist nicht im Gefängnis.');
  if (state.turnPhase !== 'awaiting-roll') return err('Jetzt nicht möglich.');
  if (player.jailCards <= 0) return err('Du hast keine Gefängnis-Frei-Karte.');
  player.jailCards -= 1;
  player.inJail = false;
  player.jailTurns = 0;
  log(state, 'card', `${player.name} setzt die Gefängnis-Frei-Karte ein.`, player.id);
  return OK;
}

function doAckCard(state: GameState, player: Player): ActionResult {
  if (!state.pendingCard) return err('Keine Karte offen.');
  if (state.pendingCard.playerId !== player.id) return err('Das ist nicht deine Karte.');
  applyCard(state, player, state.pendingCard.card);
  return OK;
}

function doManage(
  state: GameState,
  player: Player,
  action: { type: 'build' | 'sellHouse' | 'mortgage' | 'unmortgage'; tileId: number }
): ActionResult {
  const tile = state.edition.tiles[action.tileId];
  if (!tile) return err('Unbekanntes Feld.');
  const isCurrent = cur(state).id === player.id;
  const inDebt = state.debt?.playerId === player.id;
  const managePhase =
    isCurrent && (state.turnPhase === 'awaiting-roll' || state.turnPhase === 'awaiting-end');
  // Verkaufen/Beleihen geht auch in der Schuldenphase, Bauen/Entschulden nicht.
  if (action.type === 'build' || action.type === 'unmortgage') {
    if (!managePhase) return err('Bauen/Entschulden ist nur in deinem Zug möglich.');
  } else if (!managePhase && !inDebt) {
    return err('Verwalten ist nur in deinem Zug (oder bei Schulden) möglich.');
  }

  switch (action.type) {
    case 'build': {
      const check = canBuildOn(state, player.id, action.tileId);
      if (!check.ok) return err(check.reason!);
      doBuild(state, player, action.tileId);
      return OK;
    }
    case 'sellHouse': {
      const check = canSellHouseOn(state, player.id, action.tileId);
      if (!check.ok) return err(check.reason!);
      sellOneLevel(state, player, action.tileId);
      return OK;
    }
    case 'mortgage': {
      const check = canMortgage(state, player.id, action.tileId);
      if (!check.ok) return err(check.reason!);
      doMortgage(state, player, action.tileId);
      return OK;
    }
    case 'unmortgage': {
      const check = canUnmortgage(state, player.id, action.tileId);
      if (!check.ok) return err(check.reason!);
      const cost = unmortgageCost(state, action.tileId);
      player.money -= cost;
      state.properties[action.tileId].mortgaged = false;
      log(state, 'money', `${player.name} löst die Hypothek auf ${tile.name} ab (−${money(state, cost)}).`, player.id);
      return OK;
    }
  }
}

function doPayDebt(state: GameState, player: Player): ActionResult {
  const debt = state.debt;
  if (!debt || debt.playerId !== player.id) return err('Du hast keine offenen Schulden.');
  if (player.money < debt.amount) return err('Immer noch nicht genug Geld – verkaufe Gebäude oder nimm Hypotheken auf.');
  player.money -= debt.amount;
  const creditor = debt.creditorId ? getPlayer(state, debt.creditorId) : undefined;
  if (creditor) creditor.money += debt.amount;
  else bankReceives(state, debt.amount, true);
  log(
    state,
    'money',
    `${player.name} begleicht die Schulden: ${money(state, debt.amount)} ${creditor ? `an ${creditor.name}` : 'an die Bank'}.`,
    player.id
  );
  const then = debt.then;
  state.debt = null;
  state.turnPhase = 'awaiting-end';
  if (then?.kind === 'jailRelease') {
    player.inJail = false;
    player.jailTurns = 0;
    moveBy(state, player, then.total);
    resolveLanding(state, player, then.total);
  }
  return OK;
}

function doResign(state: GameState, player: Player): ActionResult {
  if (state.phase !== 'playing') return err('Das Spiel läuft nicht.');
  if (player.bankrupt) return err('Du bist bereits ausgeschieden.');
  log(state, 'system', `${player.name} gibt auf.`, player.id);
  const creditor = state.debt?.playerId === player.id ? state.debt.creditorId : null;
  bankruptPlayer(state, player, creditor);
  return OK;
}

// ---------------------------------------------------------------------------
// Handel
// ---------------------------------------------------------------------------

function validateTradeSide(
  state: GameState,
  ownerId: string,
  props: number[],
  moneyAmount: number
): string | null {
  const owner = getPlayer(state, ownerId);
  if (!owner || owner.bankrupt) return 'Spieler nicht verfügbar.';
  if (moneyAmount < 0) return 'Ungültiger Geldbetrag.';
  if (owner.money < moneyAmount) return `${owner.name} hat nicht genug Geld.`;
  for (const tileId of props) {
    const tile = state.edition.tiles[tileId];
    const prop = state.properties[tileId];
    if (!tile || !prop) return 'Ungültiges Grundstück.';
    if (prop.ownerId !== ownerId) return `${tile.name} gehört nicht ${owner.name}.`;
    if (tile.type === 'street') {
      const group = groupTiles(state.edition, tile.group!);
      if (group.some((t) => state.properties[t.id].houses > 0)) {
        return `In der Farbgruppe von ${tile.name} stehen Gebäude – erst verkaufen.`;
      }
    }
  }
  return null;
}

function doProposeTrade(
  state: GameState,
  player: Player,
  action: {
    to: string;
    offerMoney: number;
    offerProps: number[];
    requestMoney: number;
    requestProps: number[];
  }
): ActionResult {
  if (state.phase !== 'playing') return err('Das Spiel läuft nicht.');
  if (player.bankrupt) return err('Du bist ausgeschieden.');
  if (state.trade) return err('Es läuft bereits ein Handelsangebot.');
  if (state.auction) return err('Erst muss die Auktion zu Ende gehen.');
  if (state.debt) return err('Erst müssen die offenen Schulden geklärt werden.');
  if (action.to === player.id) return err('Du kannst nicht mit dir selbst handeln.');
  const offerMoney = Math.max(0, Math.floor(action.offerMoney || 0));
  const requestMoney = Math.max(0, Math.floor(action.requestMoney || 0));
  const offerProps = [...new Set(action.offerProps)];
  const requestProps = [...new Set(action.requestProps)];
  if (offerMoney === 0 && requestMoney === 0 && offerProps.length === 0 && requestProps.length === 0) {
    return err('Das Angebot ist leer.');
  }
  const e1 = validateTradeSide(state, player.id, offerProps, offerMoney);
  if (e1) return err(e1);
  const e2 = validateTradeSide(state, action.to, requestProps, requestMoney);
  if (e2) return err(e2);
  const to = getPlayer(state, action.to)!;
  state.trade = {
    id: randomId(8),
    fromId: player.id,
    toId: action.to,
    offerMoney,
    offerProps,
    requestMoney,
    requestProps,
  };
  log(state, 'trade', `${player.name} schlägt ${to.name} einen Handel vor.`, player.id);
  return OK;
}

function doRespondTrade(state: GameState, player: Player, accept: boolean): ActionResult {
  const trade = state.trade;
  if (!trade) return err('Kein Handelsangebot offen.');
  if (trade.toId !== player.id) return err('Dieses Angebot richtet sich nicht an dich.');
  const from = getPlayer(state, trade.fromId);
  if (!accept) {
    state.trade = null;
    log(state, 'trade', `${player.name} lehnt den Handel ab.`, player.id);
    return OK;
  }
  // Zum Zeitpunkt der Annahme erneut komplett validieren
  const e1 = validateTradeSide(state, trade.fromId, trade.offerProps, trade.offerMoney);
  if (e1) {
    state.trade = null;
    return err(`Handel geplatzt: ${e1}`);
  }
  const e2 = validateTradeSide(state, trade.toId, trade.requestProps, trade.requestMoney);
  if (e2) {
    state.trade = null;
    return err(`Handel geplatzt: ${e2}`);
  }
  executeTrade(state, trade);
  log(state, 'trade', `🤝 ${from?.name} und ${player.name} schließen den Handel ab.`, player.id);
  state.trade = null;
  return OK;
}

function executeTrade(state: GameState, trade: TradeOffer): void {
  const from = getPlayer(state, trade.fromId)!;
  const to = getPlayer(state, trade.toId)!;
  from.money -= trade.offerMoney;
  to.money += trade.offerMoney;
  to.money -= trade.requestMoney;
  from.money += trade.requestMoney;
  for (const tileId of trade.offerProps) state.properties[tileId].ownerId = to.id;
  for (const tileId of trade.requestProps) state.properties[tileId].ownerId = from.id;
  const summary: string[] = [];
  if (trade.offerMoney) summary.push(`${money(state, trade.offerMoney)} → ${to.name}`);
  if (trade.requestMoney) summary.push(`${money(state, trade.requestMoney)} → ${from.name}`);
  for (const id of trade.offerProps) summary.push(`${getTile(state, id).name} → ${to.name}`);
  for (const id of trade.requestProps) summary.push(`${getTile(state, id).name} → ${from.name}`);
  log(state, 'trade', `Handel: ${summary.join(', ')}.`);
}

function doCancelTrade(state: GameState, player: Player): ActionResult {
  if (!state.trade) return err('Kein Handelsangebot offen.');
  if (state.trade.fromId !== player.id) return err('Nur der Anbieter kann zurückziehen.');
  state.trade = null;
  log(state, 'trade', `${player.name} zieht das Handelsangebot zurück.`, player.id);
  return OK;
}

// ---------------------------------------------------------------------------
// Host-Werkzeuge (getrennte Spieler, Aufräumen)
// ---------------------------------------------------------------------------

function doForceEndTurn(state: GameState, requester: Player): ActionResult {
  if (!requester.isHost) return err('Nur der Host kann Züge erzwingen.');
  if (state.phase !== 'playing') return err('Das Spiel läuft nicht.');
  const target = cur(state);
  if (target.connected) return err('Der Spieler ist verbunden – er muss selbst ziehen.');
  log(state, 'system', `Host ${requester.name} beendet den Zug von ${target.name} automatisch.`);
  const startIdx = state.currentPlayer;
  for (let i = 0; i < 25; i++) {
    if (state.phase !== 'playing') break;
    if (state.currentPlayer !== startIdx) break; // Zug ist weitergegangen
    const p = cur(state);
    switch (state.turnPhase) {
      case 'awaiting-roll':
        doRoll(state, p);
        break;
      case 'awaiting-buy':
        doSkipBuy(state, p);
        break;
      case 'awaiting-card':
        doAckCard(state, p);
        break;
      case 'debt': {
        const debt = state.debt!;
        autoRaise(state, p, debt.amount);
        if (p.money >= debt.amount) doPayDebt(state, p);
        else bankruptPlayer(state, p, debt.creditorId);
        break;
      }
      case 'awaiting-end': {
        // Pasch-Bonuswürfe eines getrennten Spielers verfallen
        state.doubles = 0;
        doEndTurn(state, p);
        break;
      }
      case 'auction': {
        // Der aktuelle Spieler ist hier nicht zwingend der Bieter. Für ihn
        // passen, den Rest erledigt die Bedenkzeit (auctionTick).
        const bidder = auctionBidderId(state);
        if (bidder === p.id) doPassAuction(state, p);
        else return OK;
        break;
      }
      default:
        assertNever(state.turnPhase, 'Zugphase');
    }
  }
  return OK;
}

function doRemovePlayer(state: GameState, requester: Player, targetId: string): ActionResult {
  if (!requester.isHost) return err('Nur der Host kann Spieler entfernen.');
  const target = getPlayer(state, targetId);
  if (!target) return err('Spieler nicht gefunden.');
  if (target.id === requester.id) return err('Du kannst dich nicht selbst entfernen.');
  if (target.connected) return err('Der Spieler ist noch verbunden.');
  if (state.phase === 'playing' && !target.bankrupt) {
    log(state, 'system', `Host ${requester.name} entfernt ${target.name} aus dem Spiel.`);
    bankruptPlayer(state, target, null);
  }
  return OK;
}
