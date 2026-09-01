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
import { PLAYER_COLORS, randomId } from '../util';
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
  JeopardyTeam,
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
    teams: [],
    board: [],
    usedQuestionIds: [],
    pickerTeamId: null,
    clue: null,
    local: false,
    log: [],
    chat: [],
    winnerTeamId: null,
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
  // Nur der Ersteller moderiert, und nur wenn der Raum so angelegt wurde.
  const moderator = state.rules.moderated && isHost && i === 0;
  const color =
    PLAYER_COLORS.find((c) => !usedColors.has(c)) ?? PLAYER_COLORS[i % PLAYER_COLORS.length];
  state.players.push({
    id,
    name,
    color,
    avatar: moderator
      ? '🎙'
      : JEOPARDY_AVATARS.find((a) => !usedAvatars.has(a)) ?? JEOPARDY_AVATARS[i % JEOPARDY_AVATARS.length],
    isHost,
    connected: true,
    // Wer dazukommt, ist erst mal sein eigenes Team – so sieht es aus wie
    // ohne Teams, und wer zusammenspielen will, tritt einem bei.
    teamId: moderator ? '' : newTeamFor(state, color),
    moderator,
  });
  jeopardyLog(state, 'system', moderator ? `🎙 ${name} moderiert.` : `${name} ist dabei.`, id);
  return ok;
}

/** Legt ein leeres Team an und liefert seine ID. */
function newTeamFor(state: JeopardyState, color: string): string {
  const team: JeopardyTeam = { id: randomId(8), name: '', color, score: 0 };
  state.teams.push(team);
  return team.id;
}

/**
 * Teams ohne Mitglieder verschwinden.
 *
 * Sonst sammelten sich beim Wechseln leere Hüllen an, die in der Punktetafel
 * und in der Wahlreihenfolge mitliefen.
 */
function pruneTeams(state: JeopardyState): void {
  const used = new Set(state.players.filter((p) => !p.moderator).map((p) => p.teamId));
  state.teams = state.teams.filter((t) => used.has(t.id));
  if (state.pickerTeamId && !used.has(state.pickerTeamId)) {
    state.pickerTeamId = state.teams[0]?.id ?? null;
  }
}

export function removeJeopardyLobbyPlayer(state: JeopardyState, id: string): void {
  const p = getJeopardyPlayer(state, id);
  if (!p || state.phase !== 'lobby') return;
  state.players = state.players.filter((x) => x.id !== id);
  pruneTeams(state);
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
  // Der Moderator zählt nicht mit – er spielt ja nicht.
  if (contestants(state).length < JEOPARDY_MIN_PLAYERS) {
    return err(`Mindestens ${JEOPARDY_MIN_PLAYERS} Mitspieler nötig.`);
  }
  pruneTeams(state);
  // Ein einziges Team spielte gegen sich selbst.
  if (state.teams.length < 2) return err('Mindestens zwei Teams nötig – teilt euch auf.');
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
  state.winnerTeamId = null;
  for (const t of state.teams) t.score = 0;
  const first = state.teams[Math.floor(Math.random() * state.teams.length)];
  state.pickerTeamId = first.id;

  jeopardyLog(state, 'system', `🎯 Jeopardy gestartet – Fragen aus „${pack.name}".`);
  jeopardyLog(
    state,
    'info',
    moderatorOf(state)
      ? `${moderatorOf(state)!.name} moderiert. ${teamLabel(state, first)} darf sich das erste Feld wünschen.`
      : `${teamLabel(state, first)} wählt das erste Feld.`
  );
  return ok;
}

export function resetJeopardyToLobby(state: JeopardyState): void {
  state.phase = 'lobby';
  state.board = [];
  state.usedQuestionIds = [];
  state.clue = null;
  state.winnerTeamId = null;
  state.pickerTeamId = null;
  // Die Teams selbst bleiben: Wer für eine Runde zusammengespielt hat, will
  // das in der nächsten meistens auch.
  for (const t of state.teams) t.score = 0;
}

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

export function teamOf(state: JeopardyState, playerId: string): JeopardyTeam | undefined {
  const p = getJeopardyPlayer(state, playerId);
  return p ? state.teams.find((t) => t.id === p.teamId) : undefined;
}

export function membersOf(state: JeopardyState, teamId: string): JeopardyPlayer[] {
  return state.players.filter((p) => !p.moderator && p.teamId === teamId);
}

/**
 * Wie das Team heißt – eigener Name oder aus den Mitgliedern gebaut.
 *
 * Allein steht damit einfach der Spielername da, wie vor den Teams; zu zweit
 * „Anna & Ben". Kein Umbenennen nötig, damit es stimmt, und wer doch einen
 * eigenen Namen will, überschreibt ihn im Wartezimmer.
 */
export function teamLabel(state: JeopardyState, team: JeopardyTeam): string {
  if (team.name) return team.name;
  const names = membersOf(state, team.id).map((p) => p.name);
  if (names.length === 0) return 'Leeres Team';
  if (names.length <= 3) return names.join(' & ');
  return `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
}

function pickerTeam(state: JeopardyState): JeopardyTeam | undefined {
  return state.teams.find((t) => t.id === state.pickerTeamId);
}

/**
 * Der Moderator, sofern er da ist.
 *
 * Ist er getrennt, gelten wieder die normalen Regeln – sonst stünde die
 * Sendung still, weil nur er ein Feld wählen dürfte.
 */
export function moderatorOf(state: JeopardyState): JeopardyPlayer | null {
  return state.players.find((p) => p.moderator && p.connected) ?? null;
}

/** Die Mitspielenden – ohne den Moderator. */
function contestants(state: JeopardyState): JeopardyPlayer[] {
  return state.players.filter((p) => !p.moderator);
}

/**
 * Wer darf ein Feld wählen?
 *
 * Gibt es einen Moderator, führt er durch die Sendung und wählt allein.
 * Sonst JEDES Mitglied des Teams, das dran ist – wer von den beiden tippt,
 * machen sie unter sich aus. Ist von dem Team niemand verbunden, darf jeder,
 * sonst stünde die Partie still (anders als bei einem laufenden Zug gibt es
 * hier keine Uhr, die das auflösen könnte).
 */
function canPick(state: JeopardyState, playerId: string): boolean {
  const mod = moderatorOf(state);
  if (mod) return mod.id === playerId;
  const team = pickerTeam(state);
  if (!team) return false;
  const members = membersOf(state, team.id);
  if (members.some((p) => p.id === playerId)) return true;
  return !members.some((p) => p.connected) && contestants(state).some((x) => x.id === playerId);
}

/**
 * Wer bei dieser Frage noch buzzern darf – der Moderator nie.
 *
 * Gesperrt ist das TEAM: Sonst hätte ein Dreierteam drei Versuche auf
 * dieselbe Frage und ein Alleinspieler einen.
 */
function eligibleBuzzers(state: JeopardyState, clue: JeopardyClue): JeopardyPlayer[] {
  return contestants(state).filter((p) => p.connected && !clue.lockedOut.includes(p.teamId));
}

/**
 * Wer werten darf: alle Verbundenen, die nicht im Team des Antwortenden sind.
 *
 * Nicht bloß „außer dem Antwortenden": Sein Teamkollege wäre sonst Richter
 * über die eigenen Punkte.
 *
 * Mit Moderator wertet ER allein – das ist das Sendungsformat und spart die
 * Abstimmungsrunde.
 */
function eligibleJudges(state: JeopardyState, clue: JeopardyClue): JeopardyPlayer[] {
  const mod = moderatorOf(state);
  if (mod) return [mod];
  const answering = clue.answererId ? getJeopardyPlayer(state, clue.answererId)?.teamId : undefined;
  return contestants(state).filter((p) => p.connected && p.teamId !== answering);
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
  if (!canPick(state, playerId)) {
    const t = pickerTeam(state);
    return err(`${t ? teamLabel(state, t) : 'Jemand anderes'} wählt gerade.`);
  }
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
  // Die Vorlesezeit läuft auch moderiert. Sie an einen Knopf zu hängen war
  // ein Fehler: Wer moderiert, spielt am echten Tisch nebenher mit und hat
  // keine Hand für eine Freigabe – die Sendung stockte dann bei jeder Frage.
  // Der Knopf bleibt, aber als Abkürzung (`doOpenBuzzer`), nicht als Pflicht.
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
function doOpenBuzzer(state: JeopardyState, playerId: string, now: number): JeopardyResult {
  const c = state.clue;
  if (!c) return err('Es läuft keine Frage.');
  if (c.step !== 'reading') return err('Der Buzzer ist schon offen.');
  // Mit Moderator liest er vor und entscheidet, wann der Buzzer aufgeht.
  const mod = moderatorOf(state);
  if (mod && mod.id !== playerId) return err(`${mod.name} macht den Buzzer auf.`);
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
  const p = getJeopardyPlayer(state, playerId);
  if (!p) return err('Du spielst nicht mit.');
  if (p.moderator) return err('Du moderierst – du buzzerst nicht mit.');
  // Gesperrt ist das TEAM: Wenn der Kollege schon danebenlag, ist der
  // Versuch verbraucht – sonst hätte ein Dreierteam drei davon.
  if (c.lockedOut.includes(p.teamId)) return err('Dein Team hatte schon einen Versuch.');
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
  // Wer nicht werten darf, darf auch nicht abstimmen. Ohne diese Sperre
  // landete die Stimme zwar nur in `votes`, würde von `tallyVotes` aber
  // trotzdem mitgezählt – `eligibleJudges` wartet ja nur auf die anderen.
  // Das betrifft den Moderator (er wertet allein) und den Teamkollegen des
  // Antwortenden (er wäre Richter über die eigenen Punkte).
  if (!eligibleJudges(state, c).some((p) => p.id === playerId)) {
    const mod = moderatorOf(state);
    return err(mod ? `${mod.name} wertet.` : 'Über die Punkte deines Teams stimmst du nicht ab.');
  }

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
    const team = teamOf(state, answerer);
    // Die Punkte gehen aufs Team, nicht auf die Person: Der Punktestand IST
    // das Team, und nur so gibt es einen einzigen Codepfad.
    if (team) team.score += c.value;
    jeopardyLog(
      state,
      'money',
      team && membersOf(state, team.id).length > 1
        ? `✅ ${p?.name ?? '?'} holt ${c.value} Punkte für ${teamLabel(state, team)}.`
        : `✅ ${p?.name ?? '?'} bekommt ${c.value} Punkte.`,
      answerer
    );
    // Wer richtig lag, wählt weiter – genauer: sein Team.
    if (team) state.pickerTeamId = team.id;
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
  const team = teamOf(state, playerId);
  if (state.rules.penalty && team) team.score -= clue.value;
  // Gesperrt ist das TEAM – sein Kollege bekommt keinen zweiten Versuch.
  if (team && !clue.lockedOut.includes(team.id)) clue.lockedOut.push(team.id);
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
function doNext(state: JeopardyState, playerId: string): JeopardyResult {
  const c = state.clue;
  if (!c) return err('Es läuft keine Frage.');
  if (c.step !== 'revealed') return err('Die Frage läuft noch.');
  const mod = moderatorOf(state);
  if (mod && mod.id !== playerId) return err(`${mod.name} führt weiter.`);
  state.clue = null;

  if (state.board.every((col) => col.used.every(Boolean))) {
    finish(state);
    return ok;
  }
  // Ein Team, von dem niemand verbunden ist, würde das Brett blockieren –
  // dann rückt das nächste nach.
  const team = pickerTeam(state);
  if (!team || !membersOf(state, team.id).some((p) => p.connected)) {
    const next = state.teams.find((t) => membersOf(state, t.id).some((p) => p.connected));
    if (next) state.pickerTeamId = next.id;
  }
  const now = pickerTeam(state);
  jeopardyLog(state, 'info', `${now ? teamLabel(state, now) : '?'} wählt.`);
  return ok;
}

function finish(state: JeopardyState): void {
  state.phase = 'ended';
  state.clue = null;
  const best = [...state.teams].sort((a, b) => b.score - a.score);
  state.winnerTeamId = best[0]?.id ?? null;
  jeopardyLog(
    state,
    'system',
    best.length > 1 && best[0].score === best[1].score
      ? `🏁 Unentschieden an der Spitze mit ${best[0].score} Punkten.`
      : `🏆 ${best[0] ? teamLabel(state, best[0]) : '?'} gewinnt mit ${best[0]?.score ?? 0} Punkten.`
  );
}

function findQuestion(pack: TriviaPack | null, id: string | null): TriviaQuestion | undefined {
  return id ? pack?.questions.find((q) => q.id === id) : undefined;
}

// ---------------------------------------------------------------------------
// Teams im Wartezimmer
// ---------------------------------------------------------------------------

/** Wer im Wartezimmer an den Teams schrauben darf. */
function lobbyContestant(state: JeopardyState, playerId: string): JeopardyPlayer | string {
  if (state.phase !== 'lobby') return 'Teams lassen sich nur im Wartezimmer ändern.';
  const p = getJeopardyPlayer(state, playerId);
  if (!p) return 'Du bist nicht im Raum.';
  if (p.moderator) return 'Du moderierst – du spielst in keinem Team.';
  return p;
}

function doJoinTeam(state: JeopardyState, playerId: string, teamId: string): JeopardyResult {
  const p = lobbyContestant(state, playerId);
  if (typeof p === 'string') return err(p);
  const team = state.teams.find((t) => t.id === teamId);
  if (!team) return err('Dieses Team gibt es nicht.');
  if (p.teamId === team.id) return ok;
  p.teamId = team.id;
  pruneTeams(state);
  jeopardyLog(state, 'system', `${p.name} spielt jetzt bei ${teamLabel(state, team)}.`, p.id);
  return ok;
}

function doNewTeam(state: JeopardyState, playerId: string): JeopardyResult {
  const p = lobbyContestant(state, playerId);
  if (typeof p === 'string') return err(p);
  if (membersOf(state, p.teamId).length === 1) return err('Du bist schon allein in einem Team.');
  p.teamId = newTeamFor(state, p.color);
  pruneTeams(state);
  jeopardyLog(state, 'system', `${p.name} spielt jetzt allein.`, p.id);
  return ok;
}

function doRenameTeam(
  state: JeopardyState,
  playerId: string,
  teamId: string,
  name: string
): JeopardyResult {
  const p = lobbyContestant(state, playerId);
  if (typeof p === 'string') return err(p);
  const team = state.teams.find((t) => t.id === teamId);
  if (!team) return err('Dieses Team gibt es nicht.');
  // Umbenennen darf, wer drin ist – oder der Host, der den Raum führt.
  if (p.teamId !== team.id && !p.isHost) return err('Nur wer im Team ist, benennt es um.');
  // Leer heißt „wieder aus den Mitgliedern ableiten" – ein Weg zurück.
  team.name = name.trim().slice(0, 24);
  jeopardyLog(state, 'system', `Das Team heißt jetzt ${teamLabel(state, team)}.`, p.id);
  return ok;
}

/**
 * Host: alle abwechselnd auf zwei Teams verteilen.
 *
 * Abwechselnd und nicht in Blöcken, damit die Reihenfolge im Wartezimmer
 * nicht zufällig beide Vielwisser in dasselbe Team steckt. Danach kann jeder
 * noch von Hand wechseln.
 */
function doSplitTeams(state: JeopardyState, playerId: string): JeopardyResult {
  const p = lobbyContestant(state, playerId);
  if (typeof p === 'string') return err(p);
  if (!p.isHost) return err('Nur der Host teilt die Runde auf.');
  const players = contestants(state);
  if (players.length < 2) return err('Dafür sind zu wenige da.');

  state.teams = [];
  const a = newTeamFor(state, players[0].color);
  const b = newTeamFor(state, players[1].color);
  players.forEach((x, i) => (x.teamId = i % 2 === 0 ? a : b));
  state.pickerTeamId = null;
  jeopardyLog(state, 'system', '👥 Aufgeteilt auf zwei Teams.');
  return ok;
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
      // Die Uhr handelt für die Sendung: sie hat immer das Recht.
      doNext(state, moderatorOf(state)?.id ?? contestants(state)[0]?.id ?? '');
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
 *
 * Geschwärzt wird auch die `questionId`. Der Client hat die Fragenpakete
 * gebündelt dabei – wer die Kennung sieht, schlägt die Antwort in einer Zeile
 * in den Entwicklerwerkzeugen nach. Die Antwort zu verbergen und den
 * Schlüssel dazu mitzuschicken wäre Theater. Gebraucht wird sie im Client
 * ohnehin nicht.
 */
export function jeopardyView(state: JeopardyState): JeopardyState {
  if (!state.clue || state.clue.step === 'revealed') return state;
  return { ...state, clue: { ...state.clue, answer: null, questionId: null } };
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
  if (!action || typeof action !== 'object') return err('Unbekannte Aktion.');

  // Die Team-Aktionen laufen im WARTEZIMMER, also vor der Phasenprüfung.
  // `game:action` prüft selbst keine Phase (nur, ob jemand Zuschauer ist) –
  // und `lobby:configure` wäre der falsche Weg, weil der host-gesperrt ist,
  // sein Team sich aber jeder selbst aussucht.
  switch (action.type) {
    case 'joinTeam':
      return doJoinTeam(state, playerId, String(action.teamId));
    case 'newTeam':
      return doNewTeam(state, playerId);
    case 'renameTeam':
      return doRenameTeam(state, playerId, String(action.teamId), String(action.name ?? ''));
    case 'splitTeams':
      return doSplitTeams(state, playerId);
  }

  if (state.phase !== 'playing') return err('Es läuft kein Spiel.');

  switch (action.type) {
    case 'pick':
      return doPick(state, playerId, Number(action.col), Number(action.row), pack, now);
    case 'openBuzzer':
      return doOpenBuzzer(state, playerId, now);
    case 'buzz':
      return doBuzz(state, playerId, action.reactionMs, now);
    case 'answer':
      return doAnswer(state, playerId, String(action.text ?? ''), pack, now);
    case 'judge':
      return doJudge(state, playerId, Boolean(action.correct), pack, now);
    case 'skip':
      return doSkip(state, playerId, pack, now);
    case 'next':
      return doNext(state, playerId);
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
      // Wird sein Team dadurch leer, verschwindet es – und `pruneTeams`
      // rückt die Wahl weiter, falls es gerade dran war.
      pruneTeams(state);
      jeopardyLog(state, 'system', `${target.name} wurde entfernt.`);
      if (contestants(state).length < JEOPARDY_MIN_PLAYERS || state.teams.length < 2) finish(state);
      return ok;
    }
    default:
      return err('Unbekannte Aktion.');
  }
}
