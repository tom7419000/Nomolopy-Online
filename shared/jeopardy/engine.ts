/**
 * Jeopardy-Engine – serverautoritativ und ohne Seiteneffekte: alle
 * zeitabhängigen Funktionen bekommen `now` übergeben, Timer verwaltet die
 * Server- bzw. die lokale Laufzeitschicht.
 *
 * Das Fragenpaket wird als Parameter durchgereicht, nicht im Zustand
 * gespeichert – siehe die Begründung in `types.ts`. Ohne Paket lässt sich
 * weder ein Feld ziehen noch eine Antwort werten; genau diese Funktionen
 * verlangen es deshalb.
 *
 * Bewusste Vereinfachungen (dokumentiert):
 * - Nur die Grundrunde. Double Jeopardy (zweite Runde mit doppelten Werten)
 *   und Final Jeopardy (verdeckte Einsätze) fehlen bewusst: Wetten heißen
 *   eine weitere Redaktionsschicht pro Empfänger, und die Grundrunde ist für
 *   sich ein vollständiges Spiel.
 * - Kein „Daily Double".
 * - Antworten müssen nicht in Frageform stehen. Das ist im Deutschen ohnehin
 *   unüblich, und die Wertung liegt bei den Mitspielern.
 */

import type { ChatMessage, LogEntry } from '../types';
import { PLAYER_COLORS } from '../util';
import { autoVerdict, drawQuestion, tallyVotes } from '../trivia/ask';
import {
  checkPack,
  TRIVIA_CATEGORIES,
  CATEGORY_LABELS,
  type TriviaLevel,
  type TriviaPack,
  type TriviaQuestion,
} from '../trivia/types';
import {
  BUZZ_GRACE_MS,
  JEOPARDY_MAX_PLAYERS,
  JEOPARDY_MIN_PLAYERS,
  MIN_REACTION_MS,
} from './rules';
import type {
  JeopardyAction,
  JeopardyClue,
  JeopardyPlayer,
  JeopardyRules,
  JeopardyState,
} from './types';

export const JEOPARDY_AVATARS = ['🎯', '💡', '🔔', '🧠', '📚', '🎓', '🔍', '⭐'];

/** Zeilen je Kategorie – zugleich die Stufen des Fragenformats. */
export const ROWS: TriviaLevel[] = [1, 2, 3, 4, 5];
export const COLUMNS = TRIVIA_CATEGORIES.length;

/** Wie lange die Auflösung stehen bleibt, bevor es weitergeht. */
export const REVEAL_PAUSE_MS = 7000;

/** Am gemeinsamen Gerät will die Runde die Auflösung in Ruhe lesen. */
const LOCAL_REVEAL_PAUSE_MS = 40_000;

export interface JeopardyResult {
  ok: boolean;
  error?: string;
}

const ok: JeopardyResult = { ok: true };
const err = (error: string): JeopardyResult => ({ ok: false, error });

// ---------------------------------------------------------------------------
// Aufbau & Lobby
// ---------------------------------------------------------------------------

export function createJeopardy(code: string, rules: JeopardyRules, now = Date.now()): JeopardyState {
  return {
    id: code,
    createdAt: now,
    startedAt: 0,
    phase: 'lobby',
    rules,
    players: [],
    board: [],
    usedQuestionIds: [],
    pickerIndex: 0,
    clue: null,
    local: false,
    log: [],
    chat: [],
    winnerId: null,
    seq: 1,
  };
}

export function jeopardyLog(
  state: JeopardyState,
  kind: LogEntry['kind'],
  text: string,
  playerId?: string
): void {
  state.log.push({ id: state.seq++, time: Date.now(), kind, text, playerId });
  if (state.log.length > 300) state.log.splice(0, state.log.length - 300);
}

export function addJeopardyChat(
  state: JeopardyState,
  author: { id: string; name: string; color: string },
  text: string
): JeopardyResult {
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

export function getJeopardyPlayer(state: JeopardyState, id: string): JeopardyPlayer | undefined {
  return state.players.find((p) => p.id === id);
}

export function addJeopardyPlayer(
  state: JeopardyState,
  id: string,
  name: string,
  isHost: boolean
): JeopardyResult {
  if (state.phase !== 'lobby') return err('Das Spiel läuft bereits.');
  if (state.players.length >= JEOPARDY_MAX_PLAYERS) {
    return err(`Es sind schon ${JEOPARDY_MAX_PLAYERS} Spieler dabei.`);
  }
  const usedColors = new Set(state.players.map((p) => p.color));
  const usedAvatars = new Set(state.players.map((p) => p.avatar));
  const i = state.players.length;
  state.players.push({
    id,
    name,
    color: PLAYER_COLORS.find((c) => !usedColors.has(c)) ?? PLAYER_COLORS[i % PLAYER_COLORS.length],
    avatar: JEOPARDY_AVATARS.find((a) => !usedAvatars.has(a)) ?? JEOPARDY_AVATARS[i % JEOPARDY_AVATARS.length],
    isHost,
    connected: true,
    score: 0,
  });
  jeopardyLog(state, 'system', `${name} ist dabei.`, id);
  return ok;
}

export function removeJeopardyLobbyPlayer(state: JeopardyState, id: string): void {
  const p = getJeopardyPlayer(state, id);
  if (!p || state.phase !== 'lobby') return;
  state.players = state.players.filter((x) => x.id !== id);
  jeopardyLog(state, 'system', `${p.name} ist wieder weg.`);
  if (p.isHost && state.players.length > 0) {
    state.players[0].isHost = true;
    jeopardyLog(state, 'system', `${state.players[0].name} ist jetzt Host.`);
  }
}

/** Sechs Spalten in zufälliger Reihenfolge, fünf Zeilen je Spalte. */
function buildBoard(): JeopardyState['board'] {
  const cats = [...TRIVIA_CATEGORIES];
  for (let i = cats.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cats[i], cats[j]] = [cats[j], cats[i]];
  }
  return cats.map((category) => ({ category, used: ROWS.map(() => false) }));
}

export function startJeopardy(
  state: JeopardyState,
  pack: TriviaPack | null,
  now = Date.now()
): JeopardyResult {
  if (state.phase !== 'lobby') return err('Das Spiel läuft bereits.');
  if (state.players.length < JEOPARDY_MIN_PLAYERS) {
    return err(`Mindestens ${JEOPARDY_MIN_PLAYERS} Spieler nötig.`);
  }
  if (!pack) return err('Das gewählte Fragenpaket gibt es nicht mehr.');

  // Dieselbe Prüfung, die der Editor rot einfärbt: ein Fach ohne Fragen
  // wäre ein totes Feld mitten in der Partie.
  const report = checkPack(pack);
  if (!report.ok) {
    const first = report.thin[0];
    return err(
      `„${pack.name}" ist noch nicht vollständig – ${CATEGORY_LABELS[first.category]} Stufe ${first.level} hat nur ${first.count} Fragen.`
    );
  }

  state.phase = 'playing';
  state.startedAt = now;
  state.board = buildBoard();
  state.usedQuestionIds = [];
  state.clue = null;
  state.winnerId = null;
  for (const p of state.players) p.score = 0;
  state.pickerIndex = Math.floor(Math.random() * state.players.length);

  jeopardyLog(state, 'system', `🎯 Jeopardy gestartet – Fragen aus „${pack.name}".`);
  jeopardyLog(state, 'info', `${state.players[state.pickerIndex].name} wählt das erste Feld.`);
  return ok;
}

export function resetJeopardyToLobby(state: JeopardyState): void {
  state.phase = 'lobby';
  state.board = [];
  state.usedQuestionIds = [];
  state.clue = null;
  state.winnerId = null;
  state.pickerIndex = 0;
  for (const p of state.players) p.score = 0;
}

// ---------------------------------------------------------------------------
// Kleine Helfer
// ---------------------------------------------------------------------------

function picker(state: JeopardyState): JeopardyPlayer | undefined {
  return state.players[state.pickerIndex];
}

function setPicker(state: JeopardyState, playerId: string): void {
  const i = state.players.findIndex((p) => p.id === playerId);
  if (i >= 0) state.pickerIndex = i;
}

/**
 * Wer darf ein Feld wählen?
 *
 * Normalerweise nur der Picker. Ist der aber getrennt, darf jeder – sonst
 * stünde die Partie still, und anders als bei einem laufenden Zug gibt es
 * hier keine Uhr, die das auflösen könnte.
 */
function canPick(state: JeopardyState, playerId: string): boolean {
  const p = picker(state);
  if (!p) return false;
  if (p.id === playerId) return true;
  return !p.connected && state.players.some((x) => x.id === playerId);
}

/** Wer bei dieser Frage noch buzzern darf. */
function eligibleBuzzers(state: JeopardyState, clue: JeopardyClue): JeopardyPlayer[] {
  return state.players.filter((p) => p.connected && !clue.lockedOut.includes(p.id));
}

/** Wer werten darf: alle Verbundenen außer dem, der geantwortet hat. */
function eligibleJudges(state: JeopardyState, clue: JeopardyClue): JeopardyPlayer[] {
  return state.players.filter((p) => p.connected && p.id !== clue.answererId);
}

function secondsFrom(state: JeopardyState, now: number, seconds: number): number | null {
  // Am gemeinsamen Gerät gibt es keine Uhren – siehe `localAdjustJeopardy`.
  return state.local ? null : now + seconds * 1000;
}

// ---------------------------------------------------------------------------
// Feld wählen
// ---------------------------------------------------------------------------

/**
 * Zieht eine Frage für ein Fach. Ist das Fach in dieser Partie erschöpft
 * (kann nur nach vielen Runden im selben Raum passieren), werden die
 * verbrauchten Fragen dieses Fachs wieder freigegeben, statt das Feld
 * unspielbar zu machen.
 */
function drawFor(state: JeopardyState, pack: TriviaPack, col: number, row: number): TriviaQuestion | null {
  const category = state.board[col].category;
  const level = ROWS[row];
  return (
    drawQuestion(pack, category, level, state.usedQuestionIds) ??
    drawQuestion(pack, category, level, [])
  );
}

function doPick(
  state: JeopardyState,
  playerId: string,
  col: number,
  row: number,
  pack: TriviaPack | null,
  now: number
): JeopardyResult {
  if (state.clue) return err('Es läuft schon eine Frage.');
  if (!canPick(state, playerId)) return err(`${picker(state)?.name ?? 'Jemand anderes'} wählt gerade.`);
  if (!Number.isInteger(col) || col < 0 || col >= state.board.length) return err('Dieses Feld gibt es nicht.');
  if (!Number.isInteger(row) || row < 0 || row >= ROWS.length) return err('Dieses Feld gibt es nicht.');
  if (state.board[col].used[row]) return err('Dieses Feld ist schon gespielt.');
  if (!pack) return err('Das Fragenpaket ist nicht mehr verfügbar.');

  const q = drawFor(state, pack, col, row);
  if (!q) return err('Für dieses Feld gibt es keine Frage mehr.');

  // Sofort als gespielt markieren: bricht die Verbindung mitten in der
  // Frage ab, ist das Feld trotzdem verbraucht statt doppelt spielbar.
  state.board[col].used[row] = true;
  state.usedQuestionIds.push(q.id);

  const value = (row + 1) * state.rules.baseValue;
  const reading = state.rules.readSeconds > 0 && !state.local;
  state.clue = {
    col,
    row,
    value,
    category: state.board[col].category,
    questionId: q.id,
    prompt: q.prompt,
    answer: null,
    step: reading ? 'reading' : 'buzzing',
    openedAt: now,
    buzzes: {},
    raceEndsAt: null,
    answererId: null,
    submitted: null,
    suggestion: null,
    lockedOut: [],
    votes: {},
    correct: null,
    deadline: reading
      ? secondsFrom(state, now, state.rules.readSeconds)
      : secondsFrom(state, now, state.rules.buzzSeconds),
  };

  const who = state.players.find((p) => p.id === playerId);
  jeopardyLog(
    state,
    'move',
    `${who?.name ?? '?'} wählt ${CATEGORY_LABELS[state.board[col].category]} für ${value}.`,
    playerId
  );
  return ok;
}

/** Vorlesezeit abkürzen – wer vorgelesen hat, macht den Buzzer auf. */
function doOpenBuzzer(state: JeopardyState, now: number): JeopardyResult {
  const c = state.clue;
  if (!c) return err('Es läuft keine Frage.');
  if (c.step !== 'reading') return err('Der Buzzer ist schon offen.');
  openBuzzer(state, c, now);
  return ok;
}

function openBuzzer(state: JeopardyState, clue: JeopardyClue, now: number): void {
  clue.step = 'buzzing';
  clue.openedAt = now;
  clue.buzzes = {};
  clue.raceEndsAt = null;
  clue.answererId = null;
  clue.submitted = null;
  clue.suggestion = null;
  clue.votes = {};
  clue.deadline = secondsFrom(state, now, state.rules.buzzSeconds);
}

// ---------------------------------------------------------------------------
// Buzzer
// ---------------------------------------------------------------------------

/**
 * Die gemeldete Reaktionszeit auf ein vertretbares Maß bringen.
 *
 * Nach unten der physiologische Boden, nach oben die Zeitspanne, die der
 * Server selbst gemessen hat – länger als „Buzzer auf bis Nachricht da"
 * kann niemand gebraucht haben. Unsinnige Werte (fehlend, negativ, NaN)
 * fallen auf die Server-Messung zurück, was schlicht der alten
 * „Ankunftszeit entscheidet"-Regel entspricht.
 */
function clampReaction(reported: unknown, serverElapsed: number): number {
  const ceiling = Math.max(MIN_REACTION_MS, serverElapsed);
  const n = typeof reported === 'number' && Number.isFinite(reported) ? reported : ceiling;
  return Math.min(ceiling, Math.max(MIN_REACTION_MS, n));
}

function doBuzz(
  state: JeopardyState,
  playerId: string,
  reactionMs: unknown,
  now: number
): JeopardyResult {
  const c = state.clue;
  if (!c) return err('Es läuft keine Frage.');
  // Zu früh gedrückt wird abgelehnt, sperrt aber NICHT – das hier ist ein
  // Partyspiel, kein Quiz-Duell.
  if (c.step === 'reading') return err('Der Buzzer ist noch zu.');
  if (c.step !== 'buzzing') return err('Zu spät.');
  if (c.lockedOut.includes(playerId)) return err('Du hattest schon einen Versuch.');
  const p = getJeopardyPlayer(state, playerId);
  if (!p) return err('Du spielst nicht mit.');
  if (playerId in c.buzzes) return err('Schon gebuzzert.');

  if (state.local) {
    // Am gemeinsamen Gerät gibt es nur ein Eingabegerät – ein Rennen kann es
    // gar nicht geben, und 150 ms Warten wären reine Verzögerung.
    c.buzzes[playerId] = 0;
    resolveRace(state, now);
    return ok;
  }

  c.buzzes[playerId] = clampReaction(reactionMs, now - c.openedAt);

  // Der erste Buzz eröffnet das Gnadenfenster; wer danach innerhalb von
  // BUZZ_GRACE_MS eintrifft, ist noch im Rennen (siehe rules.ts).
  if (c.raceEndsAt === null) c.raceEndsAt = now + BUZZ_GRACE_MS;
  return ok;
}

/**
 * Das Gnadenfenster ist abgelaufen: die KLEINSTE Reaktionszeit bekommt das
 * Wort – nicht die erste Nachricht.
 */
function resolveRace(state: JeopardyState, now: number): void {
  const c = state.clue;
  if (!c) return;
  const entries = Object.entries(c.buzzes);
  if (entries.length === 0) {
    c.raceEndsAt = null;
    return;
  }
  // Gleichstand geht an den, dessen Buzz zuerst eintraf – Objektschlüssel
  // behalten ihre Einfügereihenfolge.
  let winner = entries[0];
  for (const e of entries) if (e[1] < winner[1]) winner = e;

  c.raceEndsAt = null;
  c.answererId = winner[0];
  c.step = 'answering';
  c.deadline = secondsFrom(state, now, state.rules.answerSeconds);

  const p = getJeopardyPlayer(state, winner[0]);
  const others = entries.length - 1;
  jeopardyLog(
    state,
    'info',
    others > 0
      ? `🔔 ${p?.name ?? '?'} war zuerst (${Math.round(winner[1])} ms, vor ${others} weiteren).`
      : `🔔 ${p?.name ?? '?'} hat gebuzzert.`,
    winner[0]
  );
}

// ---------------------------------------------------------------------------
// Antworten und werten
// ---------------------------------------------------------------------------

function doAnswer(
  state: JeopardyState,
  playerId: string,
  text: string,
  pack: TriviaPack | null,
  now: number
): JeopardyResult {
  const c = state.clue;
  if (!c) return err('Es läuft keine Frage.');
  if (c.step !== 'answering') return err('Gerade ist nicht geantwortet.');
  if (c.answererId !== playerId) return err('Du hast nicht gebuzzert.');

  const submitted = String(text ?? '').trim().slice(0, 200);
  c.submitted = submitted;

  // Leer abgeschickt heißt „ich weiß es doch nicht" – darüber muss niemand
  // abstimmen.
  if (!submitted) {
    const p = getJeopardyPlayer(state, playerId);
    jeopardyLog(state, 'info', `${p?.name ?? '?'} passt.`, playerId);
    return wrongAnswer(state, c, playerId, pack, now);
  }

  const q = findQuestion(pack, c.questionId);
  c.suggestion = q ? autoVerdict(q, submitted) : false;
  c.votes = {};
  c.step = 'judging';
  c.deadline = secondsFrom(state, now, state.rules.judgeSeconds);

  // Ist niemand da, der werten könnte, greift der Vorschlag sofort.
  if (eligibleJudges(state, c).length === 0) return settleJudging(state, pack, now);
  return ok;
}

function doJudge(
  state: JeopardyState,
  playerId: string,
  correct: boolean,
  pack: TriviaPack | null,
  now: number
): JeopardyResult {
  const c = state.clue;
  if (!c) return err('Es läuft keine Frage.');
  if (c.step !== 'judging') return err('Gerade ist nichts zu werten.');
  if (c.answererId === playerId) return err('Über die eigene Antwort stimmst du nicht ab.');
  if (!getJeopardyPlayer(state, playerId)) return err('Du spielst nicht mit.');

  c.votes[playerId] = correct;

  // Am gemeinsamen Gerät entscheidet ein Tipp: die Runde einigt sich laut,
  // und es tickt keine Uhr, die sonst je auflösen würde.
  if (state.local) return settleJudging(state, pack, now);

  // Sobald alle gewertet haben, muss niemand auf die Uhr warten.
  if (eligibleJudges(state, c).every((p) => p.id in c.votes)) {
    return settleJudging(state, pack, now);
  }
  return ok;
}

function settleJudging(state: JeopardyState, pack: TriviaPack | null, now: number): JeopardyResult {
  const c = state.clue;
  if (!c || c.step !== 'judging') return ok;
  const verdict = tallyVotes(c.votes, c.suggestion ?? false);
  const answerer = c.answererId;
  if (!answerer) return ok;

  if (verdict) {
    const p = getJeopardyPlayer(state, answerer);
    if (p) p.score += c.value;
    jeopardyLog(state, 'money', `✅ ${p?.name ?? '?'} bekommt ${c.value} Punkte.`, answerer);
    // Wer richtig lag, wählt das nächste Feld.
    setPicker(state, answerer);
    return reveal(state, c, true, pack, now);
  }
  return wrongAnswer(state, c, answerer, pack, now);
}

/** Falsch geantwortet: Abzug, Sperre, und der Buzzer geht für den Rest wieder auf. */
function wrongAnswer(
  state: JeopardyState,
  clue: JeopardyClue,
  playerId: string,
  pack: TriviaPack | null,
  now: number
): JeopardyResult {
  const p = getJeopardyPlayer(state, playerId);
  if (state.rules.penalty && p) p.score -= clue.value;
  if (!clue.lockedOut.includes(playerId)) clue.lockedOut.push(playerId);
  jeopardyLog(
    state,
    'money',
    state.rules.penalty
      ? `❌ ${p?.name ?? '?'} lag daneben (−${clue.value}).`
      : `❌ ${p?.name ?? '?'} lag daneben.`,
    playerId
  );

  if (eligibleBuzzers(state, clue).length === 0) {
    return reveal(state, clue, false, pack, now);
  }
  openBuzzer(state, clue, now);
  return ok;
}

/**
 * Niemand weiß es – auflösen, ohne dass jemand Punkte bekommt.
 *
 * Nur der Picker: sonst könnte ein einzelner Spieler den anderen den Buzzer
 * vor der Nase wegziehen. Wer schon geantwortet hat, gibt statt dessen eine
 * leere Antwort ab.
 */
function doSkip(state: JeopardyState, playerId: string, pack: TriviaPack | null, now: number): JeopardyResult {
  const c = state.clue;
  if (!c) return err('Es läuft keine Frage.');
  if (c.step !== 'reading' && c.step !== 'buzzing') return err('Dafür ist es zu spät.');
  if (!canPick(state, playerId)) return err('Nur wer das Feld gewählt hat, kann auflösen.');
  jeopardyLog(state, 'info', 'Niemand weiß es – aufgelöst.');
  return reveal(state, c, false, pack, now);
}

function reveal(
  state: JeopardyState,
  clue: JeopardyClue,
  correct: boolean,
  pack: TriviaPack | null,
  now: number
): JeopardyResult {
  const q = findQuestion(pack, clue.questionId);
  clue.answer = q?.answer ?? '—';
  clue.correct = correct;
  clue.step = 'revealed';
  clue.raceEndsAt = null;
  clue.deadline = state.local ? now + LOCAL_REVEAL_PAUSE_MS : now + REVEAL_PAUSE_MS;
  if (!correct) jeopardyLog(state, 'card', `Richtig gewesen wäre: ${clue.answer}`);
  return ok;
}

/** Auflösung weg, zurück zum Brett – oder Schluss, wenn alles gespielt ist. */
function doNext(state: JeopardyState): JeopardyResult {
  const c = state.clue;
  if (!c) return err('Es läuft keine Frage.');
  if (c.step !== 'revealed') return err('Die Frage läuft noch.');
  state.clue = null;

  if (state.board.every((col) => col.used.every(Boolean))) {
    finish(state);
    return ok;
  }
  // Ein getrennter Picker würde das Brett blockieren – dann rückt der
  // nächste Verbundene nach.
  if (!picker(state)?.connected) {
    const next = state.players.findIndex((p) => p.connected);
    if (next >= 0) state.pickerIndex = next;
  }
  jeopardyLog(state, 'info', `${picker(state)?.name ?? '?'} wählt.`);
  return ok;
}

function finish(state: JeopardyState): void {
  state.phase = 'ended';
  state.clue = null;
  const best = [...state.players].sort((a, b) => b.score - a.score);
  state.winnerId = best[0]?.id ?? null;
  jeopardyLog(
    state,
    'system',
    best.length > 1 && best[0].score === best[1].score
      ? `🏁 Unentschieden an der Spitze mit ${best[0].score} Punkten.`
      : `🏆 ${best[0]?.name ?? '?'} gewinnt mit ${best[0]?.score ?? 0} Punkten.`
  );
}

function findQuestion(pack: TriviaPack | null, id: string): TriviaQuestion | undefined {
  return pack?.questions.find((q) => q.id === id);
}

// ---------------------------------------------------------------------------
// Uhr
// ---------------------------------------------------------------------------

export function jeopardyDeadline(state: JeopardyState): number | null {
  if (state.phase !== 'playing' || !state.clue) return null;
  // Das Buzzer-Rennen hat Vorrang vor der Frist des Schritts.
  if (state.clue.raceEndsAt !== null) return state.clue.raceEndsAt;
  return state.clue.deadline;
}

/** Zeit weiterlaufen lassen. true, wenn sich etwas geändert hat. */
export function jeopardyTick(state: JeopardyState, now: number, pack: TriviaPack | null = null): boolean {
  const c = state.clue;
  if (state.phase !== 'playing' || !c) return false;

  if (c.raceEndsAt !== null && now >= c.raceEndsAt) {
    resolveRace(state, now);
    return true;
  }
  if (c.deadline === null || now < c.deadline) return false;

  switch (c.step) {
    case 'reading':
      openBuzzer(state, c, now);
      return true;
    case 'buzzing':
      jeopardyLog(state, 'info', '⏱ Niemand hat gebuzzert.');
      reveal(state, c, false, pack, now);
      return true;
    case 'answering': {
      const who = c.answererId;
      if (!who) return false;
      c.submitted = '';
      jeopardyLog(state, 'info', `⏱ ${getJeopardyPlayer(state, who)?.name ?? '?'} hat nicht geantwortet.`, who);
      wrongAnswer(state, c, who, pack, now);
      return true;
    }
    case 'judging':
      settleJudging(state, pack, now);
      return true;
    case 'revealed':
      doNext(state);
      return true;
  }
}

/**
 * Am gemeinsamen Gerät gelten andere Zeitregeln: keine Uhren (das Gerät
 * wandert, und ein Auto-Pass beim Weiterreichen wäre die falsche Strafe),
 * dafür eine großzügige Pause auf der Auflösung.
 */
export function localAdjustJeopardy(state: JeopardyState, now: number): void {
  state.local = true;
  const c = state.clue;
  if (!c) return;
  if (c.step === 'revealed') {
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
 * Die Redaktion ist EINHEITLICH – die richtige Antwort ist vor allen
 * verborgen, nicht nur vor manchen. Deshalb setzt das Modul
 * `redactPerViewer: false` und der Server serialisiert einmal statt pro
 * Empfänger. Erst Final Jeopardy mit seinen verdeckten Einsätzen bräuchte
 * den teuren Pfad; dann wird hier `viewerId` ausgewertet und das Flag
 * umgelegt.
 */
export function jeopardyView(state: JeopardyState): JeopardyState {
  if (!state.clue || state.clue.step === 'revealed') return state;
  return { ...state, clue: { ...state.clue, answer: null } };
}

// ---------------------------------------------------------------------------
// Aktionen
// ---------------------------------------------------------------------------

export function applyJeopardyAction(
  state: JeopardyState,
  playerId: string,
  action: JeopardyAction,
  pack: TriviaPack | null,
  now = Date.now()
): JeopardyResult {
  if (state.phase !== 'playing') return err('Es läuft kein Spiel.');
  if (!action || typeof action !== 'object') return err('Unbekannte Aktion.');

  switch (action.type) {
    case 'pick':
      return doPick(state, playerId, Number(action.col), Number(action.row), pack, now);
    case 'openBuzzer':
      return doOpenBuzzer(state, now);
    case 'buzz':
      return doBuzz(state, playerId, action.reactionMs, now);
    case 'answer':
      return doAnswer(state, playerId, String(action.text ?? ''), pack, now);
    case 'judge':
      return doJudge(state, playerId, Boolean(action.correct), pack, now);
    case 'skip':
      return doSkip(state, playerId, pack, now);
    case 'next':
      return doNext(state);
    case 'endGame': {
      if (!getJeopardyPlayer(state, playerId)?.isHost) return err('Nur der Host kann die Partie beenden.');
      finish(state);
      return ok;
    }
    case 'removePlayer': {
      if (!getJeopardyPlayer(state, playerId)?.isHost) return err('Nur der Host kann Spieler entfernen.');
      const target = getJeopardyPlayer(state, String(action.targetId));
      if (!target) return err('Spieler nicht gefunden.');
      if (target.connected) return err('Nur getrennte Spieler lassen sich entfernen.');
      state.players = state.players.filter((p) => p.id !== target.id);
      jeopardyLog(state, 'system', `${target.name} wurde entfernt.`);
      if (state.players.length < JEOPARDY_MIN_PLAYERS) finish(state);
      else if (state.pickerIndex >= state.players.length) state.pickerIndex = 0;
      return ok;
    }
    default:
      return err('Unbekannte Aktion.');
  }
}
