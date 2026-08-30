/**
 * Typen für Jeopardy.
 *
 * Wie bei Poker ist der Zustand reines JSON und wird nach jeder Aktion
 * komplett synchronisiert – mit dem Unterschied, dass die richtige Antwort
 * bis zur Auflösung herausredigiert wird.
 *
 * Zwei Entscheidungen, die je ein Leck schließen, das die naheliegende
 * Bauweise hätte:
 *
 * 1. Das Fragenpaket wird NICHT eingebettet, anders als bei Monopoly die
 *    Edition. Gespeichert ist nur `packId`; die Frage löst das Modul über
 *    `deps.packs()` auf. Monopoly bettet ein, damit Spielstände autark sind –
 *    Jeopardy hat keine Spielstände (`caps.saveLoad: false`), das Einbetten
 *    brächte also nichts und schickte jede Antwort in die
 *    Entwicklerwerkzeuge jedes Clients.
 * 2. Die Brettzellen enthalten KEINE `questionId`, nur „schon gespielt".
 *    Gezogen wird erst beim Anklicken. Für ungespielte Felder gibt es damit
 *    überhaupt nichts zu verraten, und dasselbe Brett ist wiederspielbar.
 */

import type { ChatMessage, LogEntry } from '../types';
import type { TriviaCategory } from '../trivia/types';

export type JeopardyPhase = 'lobby' | 'playing' | 'ended';

/**
 * Der Ablauf einer einzelnen Frage.
 *
 * `reading`  – die Frage steht, der Buzzer ist noch zu (Vorlesezeit)
 * `buzzing`  – der Buzzer ist offen
 * `answering`– jemand hat das Wort und tippt seine Antwort
 * `judging`  – die Mitspieler werten
 * `revealed` – die Auflösung steht, weiter geht es mit dem nächsten Feld
 */
export type JeopardyStep = 'reading' | 'buzzing' | 'answering' | 'judging' | 'revealed';

export interface JeopardyRules {
  /** Welches Fragenpaket gespielt wird (siehe `deps.packs()`). */
  packId: string;
  /** Punktwert der obersten Zeile; Zeile n ist n-mal so viel wert. */
  baseValue: number;
  /** Vorlesezeit, bevor der Buzzer aufgeht (Sekunden). */
  readSeconds: number;
  /** Wie lange der Buzzer offen bleibt, bevor das Feld verfällt. */
  buzzSeconds: number;
  /** Bedenkzeit zum Antworten, nachdem jemand gebuzzert hat. */
  answerSeconds: number;
  /** Wie lange die Mitspieler werten dürfen, bevor der Vorschlag greift. */
  judgeSeconds: number;
  /** Kostet eine falsche Antwort Punkte? (Originalregel: ja) */
  penalty: boolean;
}

export interface JeopardyPlayer {
  id: string;
  name: string;
  color: string;
  /** Emoji – am großen Bildschirm ist das die schnellste Unterscheidung. */
  avatar: string;
  isHost: boolean;
  connected: boolean;
  score: number;
}

/** Eine Spalte des Bretts: eine Kategorie mit fünf Feldern. */
export interface JeopardyColumn {
  category: TriviaCategory;
  /** Index 0–4 = Zeile 1–5. true heißt: schon gespielt. */
  used: boolean[];
}

/** Die Frage, die gerade läuft. `null`, wenn das Brett offen ist. */
export interface JeopardyClue {
  col: number;
  /** 0-basiert; der Wert ist `(row + 1) * baseValue`. */
  row: number;
  value: number;
  category: TriviaCategory;
  /** GEHEIM bis zur Auflösung – siehe `jeopardyView`. */
  questionId: string | null;
  prompt: string;
  /** GEHEIM – erst bei `step === 'revealed'` gefüllt. */
  answer: string | null;
  step: JeopardyStep;
  /** Server-Zeit, zu der der Buzzer aufging – Bezugspunkt der Reaktionszeit. */
  openedAt: number;
  /**
   * Eingegangene Buzz-REAKTIONSZEITEN in ms (playerId → gebraucht).
   *
   * Nicht die Ankunftszeit: die wäre nur eine andere Schreibweise für
   * „erste Nachricht gewinnt" und machte das Gnadenfenster zur Dekoration.
   * Jedes Gerät misst für sich, wie lange es vom angezeigten offenen Buzzer
   * bis zum Tastendruck gebraucht hat; der Server deckelt den Wert auf die
   * selbst gemessene Spanne und auf einen physiologischen Boden.
   */
  buzzes: Record<string, number>;
  /** Ende des Gnadenfensters; null = gerade läuft kein Rennen. */
  raceEndsAt: number | null;
  /** Wer das Wort hat. */
  answererId: string | null;
  /** Die freie Antwort, sobald sie abgeschickt ist. */
  submitted: string | null;
  /** Vorschlag der automatischen Vorprüfung – den Richtern vorausgewählt. */
  suggestion: boolean | null;
  /** Wer diese Frage schon falsch beantwortet hat und nicht mehr darf. */
  lockedOut: string[];
  /** Wertung der Mitspieler: playerId → richtig? */
  votes: Record<string, boolean>;
  /** Ergebnis der Wertung, sobald sie steht. */
  correct: boolean | null;
  /** Frist des aktuellen Schritts; null = keine Uhr (lokaler Modus). */
  deadline: number | null;
}

export interface JeopardyState {
  id: string; // Raum-Code
  createdAt: number;
  startedAt: number;
  phase: JeopardyPhase;
  rules: JeopardyRules;
  players: JeopardyPlayer[];
  /** Sechs Spalten – so viele Kategorien hat das Fragenformat. */
  board: JeopardyColumn[];
  /** Schon gestellte Fragen, damit sich in einer Partie nichts wiederholt. */
  usedQuestionIds: string[];
  /** Wer das nächste Feld wählt (Index in `players`). */
  pickerIndex: number;
  clue: JeopardyClue | null;
  /** Am gemeinsamen Gerät gibt es keine Uhren und keinen Buzzer. */
  local: boolean;
  log: LogEntry[];
  chat: ChatMessage[];
  winnerId: string | null;
  seq: number;
}

/**
 * Die Sicht, die an die Clients geht.
 *
 * Formgleich mit dem Zustand – redigiert wird durch Nullen von `answer`,
 * nicht durch Weglassen von Feldern. Das hält den Client typgleich mit der
 * Engine und macht `redact` zu einer offensichtlich vollständigen Funktion.
 */
export type JeopardyView = JeopardyState;

export type JeopardyAction =
  /** Feld wählen – nur der Picker. */
  | { type: 'pick'; col: number; row: number }
  /**
   * Buzzer drücken – alle außer den schon Gesperrten.
   *
   * `reactionMs` ist die vom eigenen Gerät gemessene Zeit zwischen
   * angezeigtem Buzzer und Tastendruck. Fehlt sie, entscheidet die
   * Ankunftszeit.
   */
  | { type: 'buzz'; reactionMs?: number }
  /** Vorlesezeit überspringen und den Buzzer sofort öffnen. */
  | { type: 'openBuzzer' }
  /** Freie Antwort abgeben – nur wer das Wort hat. */
  | { type: 'answer'; text: string }
  /** Werten – alle außer dem Antwortenden. */
  | { type: 'judge'; correct: boolean }
  /** Niemand weiß es: auflösen, ohne dass jemand Punkte bekommt. */
  | { type: 'skip' }
  /** Auflösung wegklicken und zurück zum Brett. */
  | { type: 'next' }
  /** Host: Partie beenden. */
  | { type: 'endGame' }
  /** Host: getrennten Spieler entfernen. */
  | { type: 'removePlayer'; targetId: string };
