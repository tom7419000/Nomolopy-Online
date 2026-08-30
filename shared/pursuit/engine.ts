/**
 * Trivial-Pursuit-Engine – serverautoritativ und ohne Seiteneffekte: alle
 * zeitabhängigen Funktionen bekommen `now` übergeben, Timer verwaltet die
 * Laufzeitschicht.
 *
 * Das Fragenpaket wird durchgereicht, nicht gespeichert (Begründung in
 * `types.ts`), und das Rad kommt aus `board.ts` – hier steht nur, was mit
 * beidem passiert.
 *
 * Bewusste Regel-Vereinfachungen (dokumentiert):
 * - **Vorgabe ist Multiple Choice.** Bei Trivial Pursuit ist JEDES Feld eine
 *   Frage; über 45 bis 90 Minuten jede einzelne Antwort abstimmen zu lassen,
 *   zerstört das Tempo. Freitext bleibt als Regelschalter, und greift dann auf
 *   dieselbe Wertung wie Jeopardy zurück.
 * - **Die Nabe ohne alle Käsestücke** stellt eine Frage aus einer zufälligen
 *   Farbe, statt ein totes Feld mitten im Rad zu sein. Im Original ist sie
 *   dann bedeutungslos.
 * - **Kein „Verfolgungsfeld"** und keine Sonderregel für Würfe, die nirgends
 *   hinführen – auf diesem Graphen kann man nicht festsitzen.
 */

import type { ChatMessage, LogEntry } from '../types';
import { PLAYER_COLORS, rollDie } from '../util';
import { autoVerdict, multipleChoice, normalize, tallyVotes } from '../trivia/ask';
import {
  CATEGORY_LABELS,
  TRIVIA_CATEGORIES,
  TRIVIA_LEVELS,
  type TriviaCategory,
  type TriviaLevel,
  type TriviaPack,
  type TriviaQuestion,
} from '../trivia/types';
import { HUB, reachable, WHEEL, type PursuitNode } from './board';
import {
  DISCONNECTED_GRACE_MS,
  LOCAL_REVEAL_PAUSE_MS,
  PURSUIT_MAX_PLAYERS,
  PURSUIT_MIN_PLAYERS,
  REVEAL_PAUSE_MS,
} from './rules';
import type { PursuitAction, PursuitClue, PursuitPlayer, PursuitRules, PursuitState } from './types';

/** Sechs Spielfiguren für sechs Sitze. */
export const PURSUIT_TOKENS = ['🔴', '🔵', '🟢', '🟡', '🟣', '🟠'];

export interface PursuitResult {
  ok: boolean;
  error?: string;
}

const ok: PursuitResult = { ok: true };
const err = (error: string): PursuitResult => ({ ok: false, error });

// ---------------------------------------------------------------------------
// Aufbau & Lobby
// ---------------------------------------------------------------------------

export function createPursuit(code: string, rules: PursuitRules, now = Date.now()): PursuitState {
  return {
    id: code,
    createdAt: now,
    startedAt: 0,
    phase: 'lobby',
    rules,
    players: [],
    currentPlayer: 0,
    turnPhase: 'awaiting-roll',
    die: null,
    nextDie: null,
    moveOptions: [],
    clue: null,
    categoryVotes: {},
    categoryDeadline: null,
    turnDeadline: null,
    usedQuestionIds: [],
    local: false,
    log: [],
    chat: [],
    winnerId: null,
    seq: 1,
  };
}

export function pursuitLog(
  state: PursuitState,
  kind: LogEntry['kind'],
  text: string,
  playerId?: string
): void {
  state.log.push({ id: state.seq++, time: Date.now(), kind, text, playerId });
  if (state.log.length > 300) state.log.splice(0, state.log.length - 300);
}

export function addPursuitChat(
  state: PursuitState,
  author: { id: string; name: string; color: string },
  text: string
): PursuitResult {
  const trimmed = String(text ?? '').trim().slice(0, 300);
  if (!trimmed) return err('Leere Nachricht.');
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
  return ok;
}

export function getPursuitPlayer(state: PursuitState, id: string): PursuitPlayer | undefined {
  return state.players.find((p) => p.id === id);
}

export function addPursuitPlayer(
  state: PursuitState,
  id: string,
  name: string,
  isHost: boolean
): PursuitResult {
  if (state.phase !== 'lobby') return err('Das Spiel läuft bereits.');
  if (state.players.length >= PURSUIT_MAX_PLAYERS) {
    return err(`Es sind schon ${PURSUIT_MAX_PLAYERS} Spieler dabei.`);
  }
  const usedColors = new Set(state.players.map((p) => p.color));
  const usedTokens = new Set(state.players.map((p) => p.avatar));
  const i = state.players.length;
  state.players.push({
    id,
    name,
    color: PLAYER_COLORS.find((c) => !usedColors.has(c)) ?? PLAYER_COLORS[i % PLAYER_COLORS.length],
    avatar: PURSUIT_TOKENS.find((t) => !usedTokens.has(t)) ?? PURSUIT_TOKENS[i % PURSUIT_TOKENS.length],
    isHost,
    connected: true,
    position: HUB,
    wedges: [],
    resigned: false,
  });
  pursuitLog(state, 'system', `${name} ist dabei.`, id);
  return ok;
}

export function removePursuitLobbyPlayer(state: PursuitState, id: string): void {
  const p = getPursuitPlayer(state, id);
  if (!p || state.phase !== 'lobby') return;
  state.players = state.players.filter((x) => x.id !== id);
  pursuitLog(state, 'system', `${p.name} ist wieder weg.`);
  if (p.isHost && state.players.length > 0) {
    state.players[0].isHost = true;
    pursuitLog(state, 'system', `${state.players[0].name} ist jetzt Host.`);
  }
}

export function startPursuit(
  state: PursuitState,
  pack: TriviaPack | null,
  now = Date.now()
): PursuitResult {
  if (state.phase !== 'lobby') return err('Das Spiel läuft bereits.');
  if (state.players.length < PURSUIT_MIN_PLAYERS) {
    return err(`Mindestens ${PURSUIT_MIN_PLAYERS} Spieler nötig.`);
  }
  if (!pack) return err('Das gewählte Fragenpaket gibt es nicht mehr.');

  state.phase = 'playing';
  state.startedAt = now;
  resetRound(state);
  // Alle starten in der Mitte – so beginnt das echte Spiel, und der erste
  // Wurf fächert gleich in sechs Speichen auf.
  for (const p of state.players) {
    p.position = HUB;
    p.wedges = [];
    p.resigned = false;
  }
  state.currentPlayer = Math.floor(Math.random() * state.players.length);

  pursuitLog(state, 'system', `🧀 Trivial Pursuit gestartet – Fragen aus „${pack.name}".`);
  pursuitLog(
    state,
    'info',
    `${cur(state).name} würfelt als Erster. Ziel: ${state.rules.wedgesToWin} Käsestücke.`,
    cur(state).id
  );
  return ok;
}

/** Alles, was zu einer Runde gehört – auch beim Rematch. */
function resetRound(state: PursuitState): void {
  state.turnPhase = 'awaiting-roll';
  state.die = null;
  state.nextDie = null;
  state.moveOptions = [];
  state.clue = null;
  state.categoryVotes = {};
  state.categoryDeadline = null;
  state.turnDeadline = null;
  state.usedQuestionIds = [];
  state.winnerId = null;
}

export function resetPursuitToLobby(state: PursuitState): void {
  state.phase = 'lobby';
  resetRound(state);
  for (const p of state.players) {
    p.position = HUB;
    p.wedges = [];
    p.resigned = false;
  }
}

// ---------------------------------------------------------------------------
// Kleine Helfer
// ---------------------------------------------------------------------------

function cur(state: PursuitState): PursuitPlayer {
  return state.players[state.currentPlayer];
}

function node(id: number): PursuitNode {
  return WHEEL[id];
}

function secondsFrom(state: PursuitState, now: number, seconds: number): number | null {
  // Am gemeinsamen Gerät gibt es keine Uhren – siehe `localAdjustPursuit`.
  return state.local ? null : now + seconds * 1000;
}

/** Wer noch mitspielt. */
function active(state: PursuitState): PursuitPlayer[] {
  return state.players.filter((p) => !p.resigned);
}

function advanceTurn(state: PursuitState): void {
  if (state.phase !== 'playing') return;
  state.clue = null;
  state.die = null;
  state.moveOptions = [];
  state.categoryVotes = {};
  state.categoryDeadline = null;
  state.turnDeadline = null;
  state.turnPhase = 'awaiting-roll';

  let idx = state.currentPlayer;
  for (let i = 0; i < state.players.length; i++) {
    idx = (idx + 1) % state.players.length;
    if (!state.players[idx].resigned) break;
  }
  state.currentPlayer = idx;
  pursuitLog(state, 'system', `▶ ${cur(state).name} ist am Zug.`, cur(state).id);
}

/** Derselbe Spieler darf noch einmal. */
function rollAgain(state: PursuitState, why: string): void {
  state.clue = null;
  state.die = null;
  state.moveOptions = [];
  state.turnDeadline = null;
  state.turnPhase = 'awaiting-roll';
  pursuitLog(state, 'info', why, cur(state).id);
}

// ---------------------------------------------------------------------------
// Fragen ziehen
// ---------------------------------------------------------------------------

/**
 * Zieht eine Frage einer Farbe – dreistufig, damit nie eine Sackgasse entsteht.
 *
 * Eine lange Partie verbraucht mehr Fragen als ein Jeopardy-Brett: gewünschte
 * Stufe ungespielt → beliebige Stufe derselben Kategorie ungespielt →
 * verbrauchte dieser Kategorie wieder freigeben. Gegen Ende sieht man dadurch
 * eine Frage womöglich ein zweites Mal; das ist immer noch besser, als mit
 * einem leeren Feld dazustehen.
 */
function drawFor(
  state: PursuitState,
  pack: TriviaPack,
  category: TriviaCategory
): TriviaQuestion | null {
  const used = new Set(state.usedQuestionIds);
  const inCategory = pack.questions.filter((q) => q.category === category);
  const wanted: TriviaLevel[] =
    state.rules.level === 0 ? [...TRIVIA_LEVELS] : [state.rules.level as TriviaLevel];

  const pick = (pool: TriviaQuestion[]): TriviaQuestion | null =>
    pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;

  return (
    pick(inCategory.filter((q) => wanted.includes(q.level) && !used.has(q.id))) ??
    pick(inCategory.filter((q) => !used.has(q.id))) ??
    pick(inCategory)
  );
}

function askQuestion(
  state: PursuitState,
  pack: TriviaPack,
  category: TriviaCategory,
  opts: { nodeId: number; forWedge: boolean; final: boolean },
  now: number
): PursuitResult {
  const q = drawFor(state, pack, category);
  if (!q) return err(`Für ${CATEGORY_LABELS[category]} gibt es keine Frage.`);
  if (!state.usedQuestionIds.includes(q.id)) state.usedQuestionIds.push(q.id);

  state.clue = {
    nodeId: opts.nodeId,
    category,
    questionId: q.id,
    prompt: q.prompt,
    // Im Freitext-Modus gibt es nichts anzukreuzen.
    options: state.rules.freeText ? [] : multipleChoice(pack, q),
    answer: q.answer,
    submitted: null,
    suggestion: null,
    votes: {},
    correct: null,
    forWedge: opts.forWedge,
    final: opts.final,
    deadline: secondsFrom(state, now, state.rules.answerSeconds),
  };
  state.turnPhase = 'awaiting-answer';
  return ok;
}

// ---------------------------------------------------------------------------
// Würfeln und ziehen
// ---------------------------------------------------------------------------

function doRoll(state: PursuitState, player: PursuitPlayer, pack: TriviaPack | null, now: number): PursuitResult {
  if (state.turnPhase !== 'awaiting-roll') return err('Gerade wird nicht gewürfelt.');
  if (player.id !== cur(state).id) return err('Du bist nicht am Zug.');

  const die = state.rules.debugMode && state.nextDie ? state.nextDie : rollDie();
  state.nextDie = null;
  state.die = die;
  state.moveOptions = reachable(player.position, die);
  pursuitLog(state, 'move', `🎲 ${player.name} würfelt eine ${die}.`, player.id);

  // Auf diesem Graphen hat kein Feld nur einen Nachbarn, es gibt also immer
  // ein Ziel. Bei genau einem gibt es aber nichts zu entscheiden.
  if (state.moveOptions.length === 1) return moveTo(state, player, state.moveOptions[0], pack, now);
  state.turnPhase = 'awaiting-move';
  return ok;
}

function doMove(
  state: PursuitState,
  player: PursuitPlayer,
  to: number,
  pack: TriviaPack | null,
  now: number
): PursuitResult {
  if (state.turnPhase !== 'awaiting-move') return err('Gerade wird nicht gezogen.');
  if (player.id !== cur(state).id) return err('Du bist nicht am Zug.');
  // Ohne diese Prüfung wäre das ganze Wegenetz Dekoration.
  if (!state.moveOptions.includes(to)) return err('Dieses Feld ist von hier nicht erreichbar.');
  return moveTo(state, player, to, pack, now);
}

function moveTo(
  state: PursuitState,
  player: PursuitPlayer,
  to: number,
  pack: TriviaPack | null,
  now: number
): PursuitResult {
  player.position = to;
  state.moveOptions = [];
  const target = node(to);

  if (target.kind === 'rollAgain') {
    rollAgain(state, `${player.name} landet auf einem Freiwurf und darf nochmal.`);
    return ok;
  }
  if (!pack) return err('Das Fragenpaket ist nicht mehr verfügbar.');

  if (target.kind === 'hub') {
    if (player.wedges.length >= state.rules.wedgesToWin) {
      // Die Schlussfrage: die Mitspieler bestimmen die Farbe.
      state.turnPhase = 'awaiting-category';
      state.categoryVotes = {};
      state.categoryDeadline = secondsFrom(state, now, state.rules.judgeSeconds);
      pursuitLog(state, 'card', `🎯 ${player.name} steht in der Mitte – die Runde wählt die Farbe!`, player.id);
      if (categoryVoters(state).length === 0) return settleCategory(state, pack, now);
      return ok;
    }
    // Bewusste Vereinfachung: statt eines toten Feldes eine zufällige Farbe.
    const random = TRIVIA_CATEGORIES[Math.floor(Math.random() * TRIVIA_CATEGORIES.length)];
    pursuitLog(state, 'info', `${player.name} rastet in der Mitte – Frage aus ${CATEGORY_LABELS[random]}.`, player.id);
    return askQuestion(state, pack, random, { nodeId: to, forWedge: false, final: false }, now);
  }

  const category = target.category!;
  const forWedge = target.kind === 'hq' && !player.wedges.includes(category);
  pursuitLog(
    state,
    'move',
    target.kind === 'hq'
      ? `${player.name} erreicht die ${CATEGORY_LABELS[category]}-Ecke${forWedge ? ' – hier gibt es ein Käsestück!' : ' (Käsestück hat er schon).'}`
      : `${player.name} zieht auf ${CATEGORY_LABELS[category]}.`,
    player.id
  );
  return askQuestion(state, pack, category, { nodeId: to, forWedge, final: false }, now);
}

// ---------------------------------------------------------------------------
// Die Schlussfrage: Abstimmung über die Farbe
// ---------------------------------------------------------------------------

/** Alle Verbundenen außer dem, der in der Mitte steht. */
function categoryVoters(state: PursuitState): PursuitPlayer[] {
  return state.players.filter((p) => p.connected && !p.resigned && p.id !== cur(state).id);
}

function doVoteCategory(
  state: PursuitState,
  player: PursuitPlayer,
  category: TriviaCategory,
  pack: TriviaPack | null,
  now: number
): PursuitResult {
  if (state.turnPhase !== 'awaiting-category') return err('Gerade wird nicht abgestimmt.');
  if (player.id === cur(state).id) return err('Über deine eigene Schlussfrage stimmst du nicht ab.');
  if (!TRIVIA_CATEGORIES.includes(category)) return err('Diese Kategorie gibt es nicht.');

  state.categoryVotes[player.id] = category;
  if (state.local) return settleCategory(state, pack, now);
  if (categoryVoters(state).every((p) => p.id in state.categoryVotes)) {
    return settleCategory(state, pack, now);
  }
  return ok;
}

function settleCategory(state: PursuitState, pack: TriviaPack | null, now: number): PursuitResult {
  if (state.turnPhase !== 'awaiting-category') return ok;
  if (!pack) return err('Das Fragenpaket ist nicht mehr verfügbar.');

  const tally = new Map<TriviaCategory, number>();
  for (const c of Object.values(state.categoryVotes)) tally.set(c, (tally.get(c) ?? 0) + 1);

  let chosen: TriviaCategory;
  if (tally.size === 0) {
    // Niemand da oder niemand hat abgestimmt – dann entscheidet das Los, und
    // das Protokoll sagt es auch.
    chosen = TRIVIA_CATEGORIES[Math.floor(Math.random() * TRIVIA_CATEGORIES.length)];
    pursuitLog(state, 'info', `Niemand hat gewählt – das Los entscheidet: ${CATEGORY_LABELS[chosen]}.`);
  } else {
    // Bei Gleichstand die in TRIVIA_CATEGORIES zuerst stehende Farbe. Bewusst
    // nicht per Zufall: so ist das Ergebnis reproduzierbar, und den
    // Unterschied merkt am Tisch niemand.
    let best = -1;
    chosen = TRIVIA_CATEGORIES[0];
    for (const c of TRIVIA_CATEGORIES) {
      const n = tally.get(c) ?? 0;
      if (n > best) {
        best = n;
        chosen = c;
      }
    }
    pursuitLog(state, 'card', `Die Runde wählt ${CATEGORY_LABELS[chosen]} für die Schlussfrage.`);
  }

  state.categoryVotes = {};
  state.categoryDeadline = null;
  return askQuestion(state, pack, chosen, { nodeId: HUB, forWedge: false, final: true }, now);
}

// ---------------------------------------------------------------------------
// Antworten und werten
// ---------------------------------------------------------------------------

function doAnswer(
  state: PursuitState,
  player: PursuitPlayer,
  text: string,
  now: number
): PursuitResult {
  const c = state.clue;
  if (!c || state.turnPhase !== 'awaiting-answer') return err('Gerade ist nicht zu antworten.');
  if (player.id !== cur(state).id) return err('Du bist nicht am Zug.');

  const submitted = String(text ?? '').trim().slice(0, 200);
  c.submitted = submitted;

  if (!state.rules.freeText) {
    // Multiple Choice: nur eine der gelieferten Möglichkeiten zählt – sonst
    // könnte man die richtige Antwort einfach hinschreiben.
    if (!c.options.some((o) => normalize(o) === normalize(submitted))) {
      return err('Bitte eine der Möglichkeiten wählen.');
    }
    return resolve(state, normalize(submitted) === normalize(c.answer ?? ''), now);
  }

  // Leer abgeschickt heißt „weiß ich nicht" – darüber muss niemand abstimmen.
  if (!submitted) {
    pursuitLog(state, 'info', `${player.name} passt.`, player.id);
    return resolve(state, false, now);
  }

  c.suggestion = autoVerdict({ id: '', category: c.category, level: 1, prompt: c.prompt, answer: c.answer ?? '' }, submitted);
  c.votes = {};
  state.turnPhase = 'awaiting-judge';
  c.deadline = secondsFrom(state, now, state.rules.judgeSeconds);
  if (judges(state).length === 0) return settleJudging(state, now);
  return ok;
}

/** Wer werten darf: alle Verbundenen außer dem Antwortenden. */
function judges(state: PursuitState): PursuitPlayer[] {
  return state.players.filter((p) => p.connected && !p.resigned && p.id !== cur(state).id);
}

function doJudge(
  state: PursuitState,
  player: PursuitPlayer,
  correct: boolean,
  now: number
): PursuitResult {
  const c = state.clue;
  if (!c || state.turnPhase !== 'awaiting-judge') return err('Gerade ist nichts zu werten.');
  if (player.id === cur(state).id) return err('Über die eigene Antwort stimmst du nicht ab.');

  c.votes[player.id] = correct;
  // Am gemeinsamen Gerät entscheidet ein Tipp: es tickt keine Uhr, die sonst
  // je auflösen würde.
  if (state.local) return settleJudging(state, now);
  if (judges(state).every((p) => p.id in c.votes)) return settleJudging(state, now);
  return ok;
}

function settleJudging(state: PursuitState, now: number): PursuitResult {
  const c = state.clue;
  if (!c || state.turnPhase !== 'awaiting-judge') return ok;
  return resolve(state, tallyVotes(c.votes, c.suggestion ?? false), now);
}

/** Die Frage ist entschieden: Käsestück, Sieg oder Spielerwechsel. */
function resolve(state: PursuitState, correct: boolean, now: number): PursuitResult {
  const c = state.clue;
  if (!c) return ok;
  const player = cur(state);

  c.correct = correct;
  state.turnPhase = 'revealed';
  c.deadline = (state.local ? LOCAL_REVEAL_PAUSE_MS : REVEAL_PAUSE_MS) + now;

  if (!correct) {
    pursuitLog(state, 'info', `❌ ${player.name} liegt daneben. Richtig wäre: ${c.answer}`, player.id);
    return ok;
  }

  if (c.final) {
    state.winnerId = player.id;
    pursuitLog(state, 'system', `🏆 ${player.name} beantwortet die Schlussfrage und gewinnt!`, player.id);
    return ok;
  }
  if (c.forWedge) {
    player.wedges.push(c.category);
    pursuitLog(
      state,
      'money',
      `🧀 ${player.name} bekommt das ${CATEGORY_LABELS[c.category]}-Käsestück (${player.wedges.length}/${state.rules.wedgesToWin}).`,
      player.id
    );
  } else {
    pursuitLog(state, 'info', `✅ ${player.name} liegt richtig und darf nochmal.`, player.id);
  }
  return ok;
}

/** Auflösung weg – weiter geht es beim selben oder beim nächsten Spieler. */
function doNext(state: PursuitState): PursuitResult {
  const c = state.clue;
  if (!c || state.turnPhase !== 'revealed') return err('Die Frage läuft noch.');
  if (state.winnerId) {
    finish(state);
    return ok;
  }
  if (c.correct) rollAgain(state, `${cur(state).name} darf nochmal würfeln.`);
  else advanceTurn(state);
  return ok;
}

function finish(state: PursuitState): void {
  state.phase = 'ended';
  state.clue = null;
  state.moveOptions = [];
  if (!state.winnerId) {
    // Kein Sieger durch die Schlussfrage: der mit den meisten Käsestücken.
    const best = [...active(state)].sort((a, b) => b.wedges.length - a.wedges.length);
    state.winnerId = best[0]?.id ?? null;
    if (best[0]) {
      pursuitLog(
        state,
        'system',
        `🏁 Partie beendet – ${best[0].name} führt mit ${best[0].wedges.length} Käsestücken.`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Uhr
// ---------------------------------------------------------------------------

export function pursuitDeadline(state: PursuitState, now: number): number | null {
  if (state.phase !== 'playing') return null;
  if (state.turnPhase === 'awaiting-category') return state.categoryDeadline;
  if (state.clue && (state.turnPhase === 'awaiting-answer' || state.turnPhase === 'awaiting-judge' || state.turnPhase === 'revealed')) {
    return state.clue.deadline;
  }
  // Würfeln und Ziehen haben KEINE Uhr – außer der Spieler ist getrennt. Sonst
  // stünde die Partie mitten im Rad still, und anders als bei Monopoly steckt
  // in jedem Zug eine Frage, die niemand für ihn beantworten kann.
  if (state.local) return null;
  const p = state.players[state.currentPlayer];
  if (!p || p.connected) {
    // Wieder da: die Uhr geht wieder aus.
    state.turnDeadline = null;
    return null;
  }
  // Die Frist wird beim ersten Mal FESTGEHALTEN. Würde sie bei jeder Abfrage
  // neu aus `now` gerechnet, liefe sie nie ab. (Poker macht es an derselben
  // Stelle genauso.)
  if (state.turnDeadline === null) state.turnDeadline = now + DISCONNECTED_GRACE_MS;
  return state.turnDeadline;
}

export function pursuitTick(state: PursuitState, now: number): boolean {
  if (state.phase !== 'playing') return false;
  const at = pursuitDeadline(state, now);
  if (at === null || now < at) return false;

  switch (state.turnPhase) {
    case 'awaiting-roll':
    case 'awaiting-move': {
      const p = state.players[state.currentPlayer];
      pursuitLog(state, 'system', `⏱ ${p?.name ?? '?'} ist nicht da – der Zug wird übersprungen.`, p?.id);
      advanceTurn(state);
      return true;
    }
    case 'awaiting-category':
      settleCategory(state, null, now);
      return true;
    case 'awaiting-answer': {
      const p = cur(state);
      state.clue!.submitted = '';
      pursuitLog(state, 'info', `⏱ ${p.name} hat nicht rechtzeitig geantwortet.`, p.id);
      resolve(state, false, now);
      return true;
    }
    case 'awaiting-judge':
      settleJudging(state, now);
      return true;
    case 'revealed':
      doNext(state);
      return true;
  }
}

/**
 * Am gemeinsamen Gerät gelten andere Zeitregeln: keine Uhren (das Gerät
 * wandert, und ein Auto-Falsch beim Weiterreichen wäre die falsche Strafe),
 * dafür eine großzügige Pause auf der Auflösung.
 */
export function localAdjustPursuit(state: PursuitState, now: number): void {
  state.local = true;
  state.categoryDeadline = null;
  const c = state.clue;
  if (!c) return;
  if (state.turnPhase === 'revealed') {
    const min = now + LOCAL_REVEAL_PAUSE_MS;
    if (c.deadline === null || c.deadline < min) c.deadline = min;
  } else {
    c.deadline = null;
  }
}

// ---------------------------------------------------------------------------
// Redaktion
// ---------------------------------------------------------------------------

/**
 * Sicht für die Clients.
 *
 * Einheitlich für alle: die richtige Antwort ist vor jedem verborgen, nicht
 * nur vor manchen – deshalb `redactPerViewer: false` und ein Broadcast statt
 * einem pro Empfänger. Die Antwortmöglichkeiten bleiben sichtbar, sie sind ja
 * der Sinn; verglichen wird serverseitig.
 *
 * Geschwärzt wird auch die `questionId`: der Client hat die Fragenpakete
 * gebündelt dabei und schlüge die Antwort sonst in einer Zeile nach.
 */
export function pursuitView(state: PursuitState): PursuitState {
  if (!state.clue || state.turnPhase === 'revealed') return state;
  return { ...state, clue: { ...state.clue, answer: null, questionId: null } };
}

// ---------------------------------------------------------------------------
// Aktionen
// ---------------------------------------------------------------------------

export function applyPursuitAction(
  state: PursuitState,
  playerId: string,
  action: PursuitAction,
  pack: TriviaPack | null,
  now = Date.now()
): PursuitResult {
  if (!action || typeof action !== 'object') return err('Unbekannte Aktion.');
  const player = getPursuitPlayer(state, playerId);
  if (!player) return err('Du spielst nicht mit.');

  // Host-Werkzeuge laufen auch außerhalb des eigenen Zuges.
  switch (action.type) {
    case 'endGame':
      if (!player.isHost) return err('Nur der Host kann die Partie beenden.');
      finish(state);
      return ok;
    case 'removePlayer': {
      if (!player.isHost) return err('Nur der Host kann Spieler entfernen.');
      const target = getPursuitPlayer(state, String(action.targetId));
      if (!target) return err('Spieler nicht gefunden.');
      if (target.connected) return err('Nur getrennte Spieler lassen sich entfernen.');
      return retire(state, target, `${target.name} wurde entfernt.`);
    }
    case 'resign':
      return retire(state, player, `${player.name} steigt aus.`);
    case 'setDie': {
      if (!state.rules.debugMode) return err('Debug-Modus ist deaktiviert.');
      const d = Number(action.die);
      if (!Number.isInteger(d) || d < 1 || d > 6) return err('Ungültige Augenzahl.');
      state.nextDie = d;
      pursuitLog(state, 'system', `🐞 Debug: Nächster Wurf wird eine ${d}.`);
      return ok;
    }
    default:
      break;
  }

  if (state.phase !== 'playing') return err('Es läuft kein Spiel.');
  if (player.resigned) return err('Du bist ausgestiegen.');

  switch (action.type) {
    case 'roll':
      return doRoll(state, player, pack, now);
    case 'move':
      return doMove(state, player, Number(action.to), pack, now);
    case 'answer':
      return doAnswer(state, player, String(action.text ?? ''), now);
    case 'judge':
      return doJudge(state, player, Boolean(action.correct), now);
    case 'voteCategory':
      return doVoteCategory(state, player, action.category, pack, now);
    case 'next':
      return doNext(state);
    default:
      return err('Unbekannte Aktion.');
  }
}

/** Ein Spieler verlässt die Partie – aussteigen oder vom Host entfernt. */
function retire(state: PursuitState, target: PursuitPlayer, why: string): PursuitResult {
  if (target.resigned) return err('Schon ausgestiegen.');
  target.resigned = true;
  pursuitLog(state, 'system', why, target.id);

  if (state.phase !== 'playing') return ok;
  if (active(state).length < PURSUIT_MIN_PLAYERS) {
    finish(state);
    return ok;
  }
  // War er dran, muss der Zug weiter – sonst hängt die Partie an einem Sitz,
  // der nicht mehr besetzt ist.
  if (cur(state).id === target.id) advanceTurn(state);
  return ok;
}

export type { PursuitClue };
