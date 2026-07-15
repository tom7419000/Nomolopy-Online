/**
 * Texas-Hold'em-Engine – serverautoritativ und ohne Seiteneffekte:
 * Alle zeitabhängigen Funktionen bekommen `now` übergeben, Timer verwaltet
 * die Server-Schicht. Für Tests kann `startHand` ein präpariertes Deck
 * erhalten.
 *
 * Bewusste Regel-Vereinfachungen (dokumentiert):
 * - Jede Erhöhung (auch ein kurzer All-In) eröffnet die Setzrunde für alle
 *   anderen neu (kein „incomplete raise doesn't reopen betting").
 * - Verlierer im Showdown decken immer auf (transparentes Spielgeld-Spiel).
 * - Rebuy ist nur in der Pause zwischen zwei Händen möglich.
 */

import type { ChatMessage, LogEntry } from '../types';
import { PLAYER_COLORS } from '../util';
import { bestHand, cardLabel, handName } from './hands';
import { MAX_BLIND_LEVEL, POKER_MAX_PLAYERS, POKER_MIN_PLAYERS } from './rules';
import type {
  HandResult,
  PokerAction,
  PokerActionResult,
  PokerPlayer,
  PokerRules,
  PokerState,
  PokerView,
  PotResult,
} from './types';

export const POKER_AVATARS = ['🦊', '🐻', '🦁', '🐸', '🦉', '🐙', '🐺', '🦄', '🐹'];

/** Pause nach einer Hand, bevor die nächste automatisch startet (ms). */
export const SHOWDOWN_PAUSE_MS = 9000;
export const FOLDWIN_PAUSE_MS = 4000;

// ---------------------------------------------------------------------------
// Aufbau & Lobby
// ---------------------------------------------------------------------------

function secureShuffledDeck(): number[] {
  const deck = Array.from({ length: 52 }, (_, i) => i);
  const c = (globalThis as { crypto?: { getRandomValues?: (b: Uint32Array) => Uint32Array } }).crypto;
  const rnd = (n: number): number => {
    if (c?.getRandomValues) {
      const buf = new Uint32Array(1);
      c.getRandomValues(buf);
      return buf[0] % n;
    }
    return Math.floor(Math.random() * n);
  };
  for (let i = deck.length - 1; i > 0; i--) {
    const j = rnd(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export function createPoker(code: string, rules: PokerRules, now = Date.now()): PokerState {
  return {
    id: code,
    createdAt: now,
    startedAt: 0,
    phase: 'lobby',
    rules,
    players: [],
    handNumber: 0,
    blindLevel: 0,
    smallBlind: rules.smallBlind,
    bigBlind: rules.smallBlind * 2,
    street: 'preflop',
    deck: [],
    community: [],
    dealerIndex: 0,
    toActIndex: null,
    currentBet: 0,
    minRaise: 0,
    needToAct: [],
    actionDeadline: null,
    handResult: null,
    nextHandAt: null,
    log: [],
    chat: [],
    winnerId: null,
    seq: 1,
  };
}

export function pokerLog(state: PokerState, kind: LogEntry['kind'], text: string, playerId?: string): void {
  state.log.push({ id: state.seq++, time: Date.now(), kind, text, playerId });
  if (state.log.length > 300) state.log.splice(0, state.log.length - 300);
}

export function addPokerChat(
  state: PokerState,
  author: { id: string; name: string; color: string },
  text: string
): PokerActionResult {
  const trimmed = String(text ?? '').trim().slice(0, 300);
  if (!trimmed) return { ok: false, error: 'Leere Nachricht.' };
  const msg: ChatMessage = {
    id: state.seq++,
    time: Date.now(),
    playerId: author.id,
    name: author.name,
    color: author.color,
    text: trimmed,
  };
  state.chat.push(msg);
  if (state.chat.length > 200) state.chat.splice(0, state.chat.length - 200);
  return { ok: true };
}

export function getPokerPlayer(state: PokerState, id: string): PokerPlayer | undefined {
  return state.players.find((p) => p.id === id);
}

export function addPokerPlayer(
  state: PokerState,
  id: string,
  name: string,
  isHost: boolean
): PokerActionResult {
  if (state.phase !== 'lobby') return { ok: false, error: 'Das Spiel läuft bereits.' };
  if (state.players.length >= POKER_MAX_PLAYERS) {
    return { ok: false, error: `Der Tisch ist voll (max. ${POKER_MAX_PLAYERS}).` };
  }
  const usedColors = new Set(state.players.map((p) => p.color));
  const usedAvatars = new Set(state.players.map((p) => p.avatar));
  const color = PLAYER_COLORS.find((c) => !usedColors.has(c)) ?? PLAYER_COLORS[state.players.length % PLAYER_COLORS.length];
  const avatar = POKER_AVATARS.find((a) => !usedAvatars.has(a)) ?? POKER_AVATARS[state.players.length % POKER_AVATARS.length];
  state.players.push({
    id,
    name,
    color,
    avatar,
    isHost,
    connected: true,
    chips: 0,
    hole: null,
    bet: 0,
    committed: 0,
    folded: false,
    allIn: false,
    out: false,
    revealed: false,
    lastAction: null,
    rebuys: 0,
  });
  pokerLog(state, 'system', `${name} hat den Tisch betreten.`, id);
  return { ok: true };
}

export function removePokerLobbyPlayer(state: PokerState, id: string): void {
  const p = getPokerPlayer(state, id);
  if (!p || state.phase !== 'lobby') return;
  state.players = state.players.filter((x) => x.id !== id);
  pokerLog(state, 'system', `${p.name} hat den Tisch verlassen.`);
  if (p.isHost && state.players.length > 0) {
    state.players[0].isHost = true;
    pokerLog(state, 'system', `${state.players[0].name} ist jetzt Host.`);
  }
}

export function startPoker(state: PokerState, now = Date.now(), presetDeck?: number[]): PokerActionResult {
  if (state.phase !== 'lobby') return { ok: false, error: 'Das Spiel läuft bereits.' };
  if (state.players.length < POKER_MIN_PLAYERS) {
    return { ok: false, error: `Mindestens ${POKER_MIN_PLAYERS} Spieler nötig.` };
  }
  state.phase = 'playing';
  state.startedAt = now;
  state.handNumber = 0;
  state.blindLevel = 0;
  state.winnerId = null;
  for (const p of state.players) {
    p.chips = state.rules.buyIn;
    p.out = false;
    p.rebuys = 0;
  }
  state.dealerIndex = Math.floor(Math.random() * state.players.length);
  pokerLog(state, 'system', `🃏 Poker gestartet – Buy-in ${state.rules.buyIn} Chips, Blinds ${state.rules.smallBlind}/${state.rules.smallBlind * 2}.`);
  startHand(state, now, presetDeck);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Hand-Ablauf
// ---------------------------------------------------------------------------

function eligibleForDeal(p: PokerPlayer): boolean {
  return !p.out && p.chips > 0;
}

/** In der laufenden Hand noch beteiligt (Karten, nicht gefoldet). */
function inHand(p: PokerPlayer): boolean {
  return p.hole !== null && !p.folded && !p.out;
}

function canStillBet(p: PokerPlayer): boolean {
  return inHand(p) && !p.allIn;
}

function nextIndex(state: PokerState, from: number, pred: (p: PokerPlayer) => boolean): number {
  const n = state.players.length;
  for (let step = 1; step <= n; step++) {
    const i = (from + step) % n;
    if (pred(state.players[i])) return i;
  }
  return -1;
}

function refreshBlinds(state: PokerState, now: number): void {
  const { smallBlind, blindIncreaseMinutes } = state.rules;
  let level = 0;
  if (blindIncreaseMinutes > 0 && state.startedAt > 0) {
    level = Math.min(MAX_BLIND_LEVEL, Math.floor((now - state.startedAt) / (blindIncreaseMinutes * 60_000)));
  }
  const sb = smallBlind * 2 ** level;
  if (level !== state.blindLevel) {
    state.blindLevel = level;
    pokerLog(state, 'system', `📈 Blinds erhöht auf ${sb}/${sb * 2} (Stufe ${level + 1}).`);
  }
  state.smallBlind = sb;
  state.bigBlind = sb * 2;
}

function post(p: PokerPlayer, amount: number, label: string): void {
  const actual = Math.min(p.chips, amount);
  p.chips -= actual;
  p.bet += actual;
  p.committed += actual;
  if (p.chips === 0) p.allIn = true;
  p.lastAction = `${label} ${actual}`;
}

export function startHand(state: PokerState, now = Date.now(), presetDeck?: number[]): void {
  if (state.phase !== 'playing') return;

  // Pleite-Spieler ohne Rebuy scheiden endgültig aus
  for (const p of state.players) {
    if (!p.out && p.chips === 0 && !state.rules.allowRebuy) {
      p.out = true;
      pokerLog(state, 'system', `💀 ${p.name} ist ausgeschieden.`, p.id);
    }
  }

  const eligible = state.players.filter(eligibleForDeal);
  if (eligible.length <= 1) {
    endPokerGame(state, eligible[0]?.id ?? richestPlayer(state)?.id ?? null);
    return;
  }

  refreshBlinds(state, now);
  state.handNumber++;
  state.street = 'preflop';
  state.community = [];
  state.handResult = null;
  state.nextHandAt = null;
  state.currentBet = 0;
  state.minRaise = state.bigBlind;

  for (const p of state.players) {
    p.hole = null;
    p.bet = 0;
    p.committed = 0;
    p.folded = false;
    p.allIn = false;
    p.revealed = false;
    p.lastAction = null;
  }

  // Dealer-Button weiterreichen
  state.dealerIndex = nextIndex(state, state.dealerIndex, eligibleForDeal);

  // Karten geben: je zwei am Stück, beginnend links vom Dealer
  state.deck = presetDeck ? [...presetDeck] : secureShuffledDeck();
  let i = state.dealerIndex;
  for (let k = 0; k < state.players.length; k++) {
    i = nextIndex(state, i, eligibleForDeal);
    const p = state.players[i];
    if (p.hole === null) p.hole = [state.deck.shift()!, state.deck.shift()!];
    if (i === state.dealerIndex) break;
  }

  // Blinds setzen (Heads-up: Dealer ist Small Blind)
  const headsUp = eligible.length === 2;
  const sbIndex = headsUp ? state.dealerIndex : nextIndex(state, state.dealerIndex, eligibleForDeal);
  const bbIndex = nextIndex(state, sbIndex, eligibleForDeal);
  post(state.players[sbIndex], state.smallBlind, 'SB');
  post(state.players[bbIndex], state.bigBlind, 'BB');
  state.currentBet = state.bigBlind;

  pokerLog(
    state,
    'info',
    `— Hand ${state.handNumber} — Dealer: ${state.players[state.dealerIndex].name}, Blinds ${state.smallBlind}/${state.bigBlind}`
  );

  // Preflop beginnt links vom Big Blind (Heads-up: der Dealer/SB)
  state.needToAct = orderedFrom(state, bbIndex, canStillBet).map((p) => p.id);
  if (state.needToAct.length === 0) {
    // Alle schon durch die Blinds all-in → direkt bis zum Showdown durchgeben
    state.toActIndex = null;
    state.actionDeadline = null;
    advanceStreet(state, now);
    return;
  }
  setToAct(state, state.players.findIndex((p) => p.id === state.needToAct[0]), now);
}

/** Alle Spieler in Sitzreihenfolge, beginnend NACH `from`, gefiltert. */
function orderedFrom(state: PokerState, from: number, pred: (p: PokerPlayer) => boolean): PokerPlayer[] {
  const out: PokerPlayer[] = [];
  const n = state.players.length;
  for (let step = 1; step <= n; step++) {
    const p = state.players[(from + step) % n];
    if (pred(p)) out.push(p);
  }
  return out;
}

function setToAct(state: PokerState, index: number, now: number): void {
  state.toActIndex = index;
  state.actionDeadline = now + state.rules.actionTimeoutSec * 1000;
}

function clearToAct(state: PokerState): void {
  state.toActIndex = null;
  state.actionDeadline = null;
}

// ---------------------------------------------------------------------------
// Aktionen
// ---------------------------------------------------------------------------

export function applyPokerAction(
  state: PokerState,
  playerId: string,
  action: PokerAction,
  now = Date.now()
): PokerActionResult {
  const player = getPokerPlayer(state, playerId);
  if (!player) return { ok: false, error: 'Du sitzt nicht an diesem Tisch.' };

  switch (action.type) {
    case 'rebuy':
      return doRebuy(state, player);
    case 'nextHand':
      if (!player.isHost) return { ok: false, error: 'Nur der Host kann die nächste Hand starten.' };
      if (state.phase !== 'playing' || state.street !== 'showdown') {
        return { ok: false, error: 'Gerade läuft eine Hand.' };
      }
      startHand(state, now);
      return { ok: true };
    case 'resign':
      return doResign(state, player, now, 'hat den Tisch verlassen');
    case 'removePlayer': {
      if (!player.isHost) return { ok: false, error: 'Nur der Host kann Spieler entfernen.' };
      const target = getPokerPlayer(state, action.targetId);
      if (!target) return { ok: false, error: 'Spieler nicht gefunden.' };
      if (target.id === player.id) return { ok: false, error: 'Du kannst dich nicht selbst entfernen.' };
      return doResign(state, target, now, 'wurde vom Host entfernt');
    }
    case 'endGame': {
      if (!player.isHost) return { ok: false, error: 'Nur der Host kann das Spiel beenden.' };
      if (state.phase !== 'playing') return { ok: false, error: 'Es läuft kein Spiel.' };
      if (state.street !== 'showdown') return { ok: false, error: 'Bitte erst die laufende Hand zu Ende spielen.' };
      endPokerGame(state, richestPlayer(state)?.id ?? null);
      return { ok: true };
    }
    default:
      break;
  }

  // Ab hier: Setz-Aktionen
  if (state.phase !== 'playing') return { ok: false, error: 'Es läuft kein Spiel.' };
  if (state.street === 'showdown') return { ok: false, error: 'Die Hand ist vorbei.' };
  if (state.toActIndex === null || state.players[state.toActIndex]?.id !== playerId) {
    return { ok: false, error: 'Du bist nicht am Zug.' };
  }
  if (!inHand(player) || player.allIn) return { ok: false, error: 'Du kannst nicht mehr handeln.' };

  switch (action.type) {
    case 'fold': {
      player.folded = true;
      player.lastAction = 'Fold';
      pokerLog(state, 'move', `${player.name} foldet.`, player.id);
      return afterAction(state, player, now);
    }
    case 'check': {
      if (player.bet !== state.currentBet) {
        return { ok: false, error: 'Check nicht möglich – es liegt ein Einsatz vor.' };
      }
      player.lastAction = 'Check';
      pokerLog(state, 'move', `${player.name} checkt.`, player.id);
      return afterAction(state, player, now);
    }
    case 'call': {
      const owed = state.currentBet - player.bet;
      if (owed <= 0) return { ok: false, error: 'Nichts zu callen – du kannst checken.' };
      const pay = Math.min(owed, player.chips);
      player.chips -= pay;
      player.bet += pay;
      player.committed += pay;
      if (player.chips === 0) player.allIn = true;
      player.lastAction = player.allIn && pay < owed ? `All-In ${player.bet}` : `Call ${pay}`;
      pokerLog(state, 'move', `${player.name} callt ${pay}.`, player.id);
      return afterAction(state, player, now);
    }
    case 'allin':
      return doRaise(state, player, player.bet + player.chips, now);
    case 'raise':
      return doRaise(state, player, Math.floor(action.to), now);
    default:
      return { ok: false, error: 'Unbekannte Aktion.' };
  }
}

function doRaise(state: PokerState, player: PokerPlayer, to: number, now: number): PokerActionResult {
  if (!Number.isFinite(to) || to <= 0) return { ok: false, error: 'Ungültiger Betrag.' };
  const maxTo = player.bet + player.chips;
  if (to > maxTo) return { ok: false, error: 'So viele Chips hast du nicht.' };

  if (to <= state.currentBet) {
    // All-In unterhalb des aktuellen Einsatzes = Call für den Rest
    if (to === maxTo) {
      const pay = player.chips;
      player.chips = 0;
      player.bet += pay;
      player.committed += pay;
      player.allIn = true;
      player.lastAction = `All-In ${player.bet}`;
      pokerLog(state, 'move', `${player.name} ist all-in mit ${player.bet}.`, player.id);
      return afterAction(state, player, now);
    }
    return { ok: false, error: `Die Erhöhung muss über ${state.currentBet} liegen.` };
  }

  const raiseBy = to - state.currentBet;
  const isAllIn = to === maxTo;
  if (!isAllIn && raiseBy < state.minRaise) {
    return { ok: false, error: `Mindest-Erhöhung: auf ${state.currentBet + state.minRaise}.` };
  }

  const pay = to - player.bet;
  player.chips -= pay;
  player.bet = to;
  player.committed += pay;
  if (player.chips === 0) player.allIn = true;

  const wasBet = state.currentBet === 0;
  if (raiseBy >= state.minRaise) state.minRaise = raiseBy;
  state.currentBet = to;
  player.lastAction = player.allIn ? `All-In ${to}` : wasBet ? `Bet ${to}` : `Raise ${to}`;
  pokerLog(
    state,
    'move',
    `${player.name} ${player.allIn ? 'ist all-in mit' : wasBet ? 'setzt' : 'erhöht auf'} ${to}.`,
    player.id
  );

  // Erhöhung eröffnet die Runde für alle anderen neu
  state.needToAct = orderedFrom(state, state.players.indexOf(player), canStillBet)
    .filter((p) => p.id !== player.id)
    .map((p) => p.id);
  return afterAction(state, player, now, true);
}

function afterAction(state: PokerState, player: PokerPlayer, now: number, keptNeedToAct = false): PokerActionResult {
  if (!keptNeedToAct) {
    state.needToAct = state.needToAct.filter((id) => id !== player.id);
  }

  // Nur noch einer übrig? → gewinnt sofort
  const contenders = state.players.filter(inHand);
  if (contenders.length === 1) {
    finishByFold(state, contenders[0], now);
    return { ok: true };
  }

  // Gefoldete/All-In-Spieler können aus needToAct herausgefallen sein
  state.needToAct = state.needToAct.filter((id) => {
    const p = getPokerPlayer(state, id);
    return p ? canStillBet(p) : false;
  });

  if (state.needToAct.length === 0) {
    clearToAct(state);
    advanceStreet(state, now);
    return { ok: true };
  }

  const fromIndex = state.players.indexOf(player);
  const nextId = orderedFrom(state, fromIndex, (p) => state.needToAct.includes(p.id))[0]?.id;
  const idx = state.players.findIndex((p) => p.id === nextId);
  setToAct(state, idx, now);
  return { ok: true };
}

function advanceStreet(state: PokerState, now: number): void {
  for (const p of state.players) {
    p.bet = 0;
    if (inHand(p)) p.lastAction = null;
  }
  state.currentBet = 0;
  state.minRaise = state.bigBlind;

  if (state.street === 'river') {
    doShowdown(state, now);
    return;
  }

  if (state.street === 'preflop') {
    state.community.push(state.deck.shift()!, state.deck.shift()!, state.deck.shift()!);
    state.street = 'flop';
  } else if (state.street === 'flop') {
    state.community.push(state.deck.shift()!);
    state.street = 'turn';
  } else {
    state.community.push(state.deck.shift()!);
    state.street = 'river';
  }
  pokerLog(
    state,
    'card',
    `${state.street === 'flop' ? 'Flop' : state.street === 'turn' ? 'Turn' : 'River'}: ${state.community.map(cardLabel).join(' ')}`
  );

  const bettors = state.players.filter(canStillBet);
  if (bettors.length <= 1) {
    // Alle (bis auf höchstens einen) sind all-in → ohne Setzrunde weitergeben
    state.needToAct = [];
    clearToAct(state);
    advanceStreet(state, now);
    return;
  }

  state.needToAct = orderedFrom(state, state.dealerIndex, canStillBet).map((p) => p.id);
  const idx = state.players.findIndex((p) => p.id === state.needToAct[0]);
  setToAct(state, idx, now);
}

// ---------------------------------------------------------------------------
// Pot-Verteilung & Showdown
// ---------------------------------------------------------------------------

export function potTotal(state: Pick<PokerState, 'players'>): number {
  return state.players.reduce((sum, p) => sum + p.committed, 0);
}

function richestPlayer(state: PokerState): PokerPlayer | undefined {
  return [...state.players].filter((p) => !p.out).sort((a, b) => b.chips - a.chips)[0];
}

/** Side-Pots aus den Gesamteinsätzen berechnen (gefoldete zahlen ein, gewinnen nie). */
function buildPots(state: PokerState): { amount: number; eligible: string[] }[] {
  const levels = [...new Set(state.players.filter((p) => p.committed > 0).map((p) => p.committed))].sort(
    (a, b) => a - b
  );
  const pots: { amount: number; eligible: string[] }[] = [];
  let prev = 0;
  for (const lvl of levels) {
    let amount = 0;
    for (const p of state.players) amount += Math.max(0, Math.min(p.committed, lvl) - prev);
    const eligible = state.players.filter((p) => inHand(p) && p.committed >= lvl).map((p) => p.id);
    if (amount > 0) pots.push({ amount, eligible });
    prev = lvl;
  }
  // Benachbarte Pots mit identischen Berechtigten zusammenfassen
  const merged: { amount: number; eligible: string[] }[] = [];
  for (const pot of pots) {
    const last = merged[merged.length - 1];
    if (last && last.eligible.length === pot.eligible.length && last.eligible.every((id, i) => id === pot.eligible[i])) {
      last.amount += pot.amount;
    } else {
      merged.push(pot);
    }
  }
  return merged;
}

function finishByFold(state: PokerState, winner: PokerPlayer, now: number): void {
  const amount = potTotal(state);
  winner.chips += amount;
  const result: HandResult = {
    pots: [{ amount, winners: [{ playerId: winner.id, amount }], handName: null }],
    reveal: [],
    foldWin: true,
  };
  pokerLog(state, 'money', `💰 ${winner.name} gewinnt ${amount} – alle anderen haben gefoldet.`, winner.id);
  endHand(state, result, now, FOLDWIN_PAUSE_MS);
}

function doShowdown(state: PokerState, now: number): void {
  const contenders = state.players.filter(inHand);
  const values = new Map<string, ReturnType<typeof bestHand>>();
  for (const p of contenders) {
    values.set(p.id, bestHand([...p.hole!, ...state.community]));
    p.revealed = true;
  }

  const potResults: PotResult[] = [];
  for (const pot of buildPots(state)) {
    const eligible = pot.eligible.filter((id) => values.has(id));
    if (eligible.length === 0) continue; // sollte nicht passieren
    const bestScore = Math.max(...eligible.map((id) => values.get(id)!.score));
    // Gewinner in Sitzreihenfolge ab links vom Dealer (für Rest-Chips)
    const winnersOrdered = orderedFrom(state, state.dealerIndex, (p) => eligible.includes(p.id))
      .filter((p) => values.get(p.id)!.score === bestScore)
      .map((p) => p.id);
    const share = Math.floor(pot.amount / winnersOrdered.length);
    let remainder = pot.amount - share * winnersOrdered.length;
    const winners = winnersOrdered.map((playerId) => {
      const extra = remainder > 0 ? 1 : 0;
      remainder -= extra;
      return { playerId, amount: share + extra };
    });
    for (const w of winners) getPokerPlayer(state, w.playerId)!.chips += w.amount;
    potResults.push({
      amount: pot.amount,
      winners,
      handName: handName(values.get(winnersOrdered[0])!),
    });
  }

  const result: HandResult = {
    pots: potResults,
    reveal: contenders.map((p) => ({
      playerId: p.id,
      hole: p.hole!,
      handName: handName(values.get(p.id)!),
      best: values.get(p.id)!.cards,
    })),
    foldWin: false,
  };

  for (const pot of potResults) {
    const names = pot.winners
      .map((w) => `${getPokerPlayer(state, w.playerId)?.name} (+${w.amount})`)
      .join(', ');
    pokerLog(state, 'money', `💰 ${names} – ${pot.handName}.`);
  }
  endHand(state, result, now, SHOWDOWN_PAUSE_MS);
}

function endHand(state: PokerState, result: HandResult, now: number, pauseMs: number): void {
  state.street = 'showdown';
  state.handResult = result;
  clearToAct(state);
  state.needToAct = [];
  // Etwas mehr Zeit, wenn jemand pleite ist und Rebuy erlaubt ist
  const someoneBroke = state.rules.allowRebuy && state.players.some((p) => !p.out && p.chips === 0);
  state.nextHandAt = now + (someoneBroke ? SHOWDOWN_PAUSE_MS + 6000 : pauseMs);

  // Ohne Rebuy: Steht der Gesamtsieger schon fest, Partie direkt beenden
  if (!state.rules.allowRebuy) {
    const withChips = state.players.filter((p) => !p.out && p.chips > 0);
    if (withChips.length <= 1) {
      for (const p of state.players) {
        if (!p.out && p.chips === 0) {
          p.out = true;
          pokerLog(state, 'system', `💀 ${p.name} ist ausgeschieden.`, p.id);
        }
      }
      endPokerGame(state, withChips[0]?.id ?? null);
    }
  }
}

function endPokerGame(state: PokerState, winnerId: string | null): void {
  state.phase = 'ended';
  state.winnerId = winnerId;
  state.nextHandAt = null;
  clearToAct(state);
  const winner = winnerId ? getPokerPlayer(state, winnerId) : null;
  pokerLog(state, 'system', winner ? `🏆 ${winner.name} gewinnt die Partie!` : 'Partie beendet.');
}

// ---------------------------------------------------------------------------
// Rebuy, Aufgeben, Timeout, Rematch
// ---------------------------------------------------------------------------

function doRebuy(state: PokerState, player: PokerPlayer): PokerActionResult {
  if (state.phase !== 'playing') return { ok: false, error: 'Es läuft kein Spiel.' };
  if (!state.rules.allowRebuy) return { ok: false, error: 'Rebuy ist in diesem Raum deaktiviert.' };
  if (player.out) return { ok: false, error: 'Du bist endgültig ausgeschieden.' };
  if (player.chips > 0) return { ok: false, error: 'Du hast noch Chips.' };
  if (state.street !== 'showdown') return { ok: false, error: 'Rebuy nur zwischen zwei Händen möglich.' };
  player.chips = state.rules.buyIn;
  player.rebuys++;
  pokerLog(state, 'money', `🔄 ${player.name} kauft sich neu ein (${state.rules.buyIn} Chips).`, player.id);
  return { ok: true };
}

function doResign(state: PokerState, player: PokerPlayer, now: number, verb: string): PokerActionResult {
  if (player.out) return { ok: false, error: 'Spieler ist bereits ausgeschieden.' };
  const wasToAct = state.toActIndex !== null && state.players[state.toActIndex]?.id === player.id;
  const wasInHand = inHand(player);
  player.out = true;
  player.folded = true;
  const takeaway = player.chips;
  player.chips = 0;
  pokerLog(state, 'system', `🚪 ${player.name} ${verb}${takeaway > 0 ? ` (${takeaway} Chips)` : ''}.`, player.id);

  if (player.isHost) {
    const next = state.players.find((p) => !p.out && p.connected && p.id !== player.id);
    if (next) {
      player.isHost = false;
      next.isHost = true;
      pokerLog(state, 'system', `${next.name} ist jetzt Host.`);
    }
  }

  if (state.phase !== 'playing') return { ok: true };

  if (state.street !== 'showdown' && wasInHand) {
    state.needToAct = state.needToAct.filter((id) => id !== player.id);
    const contenders = state.players.filter(inHand);
    if (contenders.length === 1) {
      finishByFold(state, contenders[0], now);
      return { ok: true };
    }
    if (wasToAct) {
      if (state.needToAct.length === 0) {
        clearToAct(state);
        advanceStreet(state, now);
      } else {
        const fromIndex = state.players.indexOf(player);
        const nextId = orderedFrom(state, fromIndex, (p) => state.needToAct.includes(p.id))[0]?.id;
        setToAct(state, state.players.findIndex((p) => p.id === nextId), now);
      }
    }
  } else if (state.street === 'showdown') {
    // Zwischen den Händen: prüfen, ob die Partie damit entschieden ist
    const withChips = state.players.filter((p) => !p.out && p.chips > 0);
    if (withChips.length <= 1) endPokerGame(state, withChips[0]?.id ?? null);
  }
  return { ok: true };
}

/**
 * Zeitgesteuerte Übergänge – wird von der Server-Schicht regelmäßig (und nach
 * jedem Broadcast) aufgerufen. Liefert true, wenn sich der Zustand geändert hat.
 */
export function pokerTick(state: PokerState, now = Date.now()): boolean {
  if (state.phase !== 'playing') return false;

  // Nächste Hand automatisch starten
  if (state.street === 'showdown' && state.nextHandAt !== null && now >= state.nextHandAt) {
    startHand(state, now);
    return true;
  }

  // Bedenkzeit abgelaufen → Check, sonst Fold
  if (state.toActIndex !== null && state.actionDeadline !== null && now >= state.actionDeadline) {
    const p = state.players[state.toActIndex];
    if (p) {
      pokerLog(state, 'system', `⏱ Zeit abgelaufen für ${p.name}.`, p.id);
      const action: PokerAction = p.bet === state.currentBet ? { type: 'check' } : { type: 'fold' };
      applyPokerAction(state, p.id, action, now);
      return true;
    }
  }
  return false;
}

/** Nach Spielende zurück in die Lobby (alle verbliebenen Spieler bleiben sitzen). */
export function resetPokerToLobby(state: PokerState): void {
  state.phase = 'lobby';
  state.street = 'preflop';
  state.handNumber = 0;
  state.blindLevel = 0;
  state.smallBlind = state.rules.smallBlind;
  state.bigBlind = state.rules.smallBlind * 2;
  state.deck = [];
  state.community = [];
  state.handResult = null;
  state.nextHandAt = null;
  state.currentBet = 0;
  state.minRaise = 0;
  state.needToAct = [];
  clearToAct(state);
  state.winnerId = null;
  for (const p of state.players) {
    p.chips = 0;
    p.hole = null;
    p.bet = 0;
    p.committed = 0;
    p.folded = false;
    p.allIn = false;
    p.out = false;
    p.revealed = false;
    p.lastAction = null;
    p.rebuys = 0;
  }
  pokerLog(state, 'system', '🔁 Zurück in der Lobby – der Host kann eine neue Partie starten.');
}

// ---------------------------------------------------------------------------
// Redigierte Sichten
// ---------------------------------------------------------------------------

/** Platzhalter für verdeckte Karten in redigierten Sichten. */
export const HIDDEN_CARD = -1;

export function viewFor(state: PokerState, viewerId: string | null): PokerView {
  const { deck: _deck, ...rest } = state;
  return {
    ...rest,
    players: state.players.map((p) => {
      if (!p.hole) return { ...p, hole: null };
      if (p.id === viewerId || p.revealed) return { ...p, hole: [...p.hole] };
      return { ...p, hole: [HIDDEN_CARD, HIDDEN_CARD] };
    }),
  };
}

// ---------------------------------------------------------------------------
// UI-Helfer (laufen auch im Client auf der redigierten Sicht)
// ---------------------------------------------------------------------------

export function pokerCallAmount(view: Pick<PokerView, 'currentBet'>, p: Pick<PokerPlayer, 'bet' | 'chips'>): number {
  return Math.min(Math.max(0, view.currentBet - p.bet), p.chips);
}

export function pokerMinRaiseTo(view: Pick<PokerView, 'currentBet' | 'minRaise' | 'bigBlind'>): number {
  return view.currentBet === 0 ? Math.max(view.minRaise, view.bigBlind) : view.currentBet + view.minRaise;
}
