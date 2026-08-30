/**
 * Typen für Trivial Pursuit.
 *
 * Wie bei Jeopardy gilt: Der Zustand ist reines JSON und wird nach jeder
 * Aktion komplett synchronisiert, die richtige Antwort aber erst bei der
 * Auflösung mitgeschickt.
 *
 * Was hier bewusst NICHT steht:
 *
 * - **Das Brett.** `buildWheel()` ist deterministisch und liegt in `shared/`,
 *   also baut der Client dieselben 73 Knoten selbst. Im Zustand stehen nur
 *   Positions-Indizes; das Rad wandert nie über die Leitung.
 * - **Das Fragenpaket.** Nur `rules.packId`; jede Frage wird zur Laufzeit über
 *   `deps.packs()` nachgeschlagen. Einbetten hieße, jede Antwort in die
 *   Entwicklerwerkzeuge jedes Clients zu schicken.
 */

import type { ChatMessage, LogEntry } from '../types';
import type { TriviaCategory, TriviaLevel } from '../trivia/types';

export type PursuitPhase = 'lobby' | 'playing' | 'ended';

/**
 * Der Ablauf eines Zuges.
 *
 * `awaiting-roll`     – würfeln
 * `awaiting-move`     – eines der erreichbaren Ziele antippen
 * `awaiting-category` – Finale: die Mitspieler stimmen über die Farbe ab
 * `awaiting-answer`   – antworten (Multiple Choice oder frei)
 * `awaiting-judge`    – nur im Freitext-Modus: die anderen werten
 * `revealed`          – die Auflösung steht
 */
export type PursuitTurnPhase =
  | 'awaiting-roll'
  | 'awaiting-move'
  | 'awaiting-category'
  | 'awaiting-answer'
  | 'awaiting-judge'
  | 'revealed';

export interface PursuitRules {
  /** Welches Fragenpaket gespielt wird (siehe `deps.packs()`). */
  packId: string;
  /** Käsestücke zum Sieg. 6 ist das Original, weniger kürzt die Partie ab. */
  wedgesToWin: number;
  /** Frei antworten statt ankreuzen – dann werten die Mitspieler. */
  freeText: boolean;
  /** Feste Schwierigkeitsstufe, oder 0 für gemischt. */
  level: 0 | TriviaLevel;
  /** Bedenkzeit zum Antworten (Sekunden). */
  answerSeconds: number;
  /** Zeit zum Werten bzw. zum Abstimmen über die Schlussfrage. */
  judgeSeconds: number;
  /** Würfel manuell setzbar – für Tests und zum Vorführen. */
  debugMode: boolean;
}

export interface PursuitPlayer {
  id: string;
  name: string;
  color: string;
  /** Emoji-Spielfigur. */
  avatar: string;
  isHost: boolean;
  connected: boolean;
  /** Knoten-ID im Rad. Alle starten in der Nabe. */
  position: number;
  /** Gesammelte Käsestücke, je Farbe höchstens eins. */
  wedges: TriviaCategory[];
  /** Endgültig ausgestiegen. */
  resigned: boolean;
}

/** Die Frage, die gerade läuft. */
export interface PursuitClue {
  /** Feld, auf dem sie gestellt wurde. */
  nodeId: number;
  category: TriviaCategory;
  /**
   * GEHEIM bis zur Auflösung – wie `answer`.
   *
   * Der Client hat die Fragenpakete gebündelt dabei: Wer die Kennung sieht,
   * schlägt die Antwort in einer Zeile nach. Die Antwort zu verbergen und den
   * Schlüssel dazu mitzuliefern wäre Theater.
   */
  questionId: string | null;
  prompt: string;
  /** Multiple Choice: vier Möglichkeiten. Im Freitext-Modus leer. */
  options: string[];
  /** GEHEIM bis `step === 'revealed'`. */
  answer: string | null;
  /** Was abgegeben wurde. */
  submitted: string | null;
  /** Freitext: Vorschlag der automatischen Vorprüfung, den Richtern vorausgewählt. */
  suggestion: boolean | null;
  /** Freitext: Wertung der Mitspieler. */
  votes: Record<string, boolean>;
  correct: boolean | null;
  /** Diese Frage bringt ein Käsestück (Käse-Ecke, Farbe noch nicht im Besitz). */
  forWedge: boolean;
  /** Die Schlussfrage in der Mitte. */
  final: boolean;
  /** Frist des aktuellen Schritts; null = keine Uhr (lokaler Modus). */
  deadline: number | null;
}

export interface PursuitState {
  id: string; // Raum-Code
  createdAt: number;
  startedAt: number;
  phase: PursuitPhase;
  rules: PursuitRules;
  players: PursuitPlayer[]; // Reihenfolge = Zugreihenfolge
  currentPlayer: number;
  turnPhase: PursuitTurnPhase;
  /** Zuletzt gewürfelt. */
  die: number | null;
  /** Debug: nächster Wurf (wird vom Würfeln verbraucht). */
  nextDie: number | null;
  /** Erreichbare Ziele – das Ergebnis von `reachable(position, die)`. */
  moveOptions: number[];
  clue: PursuitClue | null;
  /** Finale: playerId → gewählte Kategorie. */
  categoryVotes: Record<string, TriviaCategory>;
  categoryDeadline: number | null;
  /**
   * Frist für einen GETRENNTEN Spieler beim Würfeln oder Ziehen.
   *
   * Muss festgehalten werden, statt bei jeder Abfrage neu aus `now` gerechnet
   * zu werden – sonst wanderte sie mit der Uhr mit und liefe nie ab.
   * `null` heißt: der Spieler ist da und darf sich Zeit lassen.
   */
  turnDeadline: number | null;
  /** Schon gestellte Fragen, damit sich in einer Partie möglichst nichts wiederholt. */
  usedQuestionIds: string[];
  /** Am gemeinsamen Gerät gibt es keine Uhren. */
  local: boolean;
  log: LogEntry[];
  chat: ChatMessage[];
  winnerId: string | null;
  seq: number;
}

/**
 * Die Sicht, die an die Clients geht – formgleich mit dem Zustand.
 * Redigiert wird durch Nullen einzelner Felder, nicht durch Weglassen.
 */
export type PursuitView = PursuitState;

export type PursuitAction =
  /** Würfeln – nur der aktuelle Spieler. */
  | { type: 'roll' }
  /** Ziel wählen; muss in `moveOptions` stehen. */
  | { type: 'move'; to: number }
  /** Multiple Choice: eine der gelieferten Möglichkeiten. Freitext: der Text. */
  | { type: 'answer'; text: string }
  /** Freitext: werten – alle außer dem Antwortenden. */
  | { type: 'judge'; correct: boolean }
  /** Finale: Kategorie der Schlussfrage wählen – alle außer dem Spieler in der Mitte. */
  | { type: 'voteCategory'; category: TriviaCategory }
  /** Auflösung wegklicken. */
  | { type: 'next' }
  /** Debug: nächsten Wurf setzen. */
  | { type: 'setDie'; die: number }
  /** Endgültig aussteigen. */
  | { type: 'resign' }
  /** Host: Partie beenden. */
  | { type: 'endGame' }
  /** Host: getrennten Spieler entfernen. */
  | { type: 'removePlayer'; targetId: string };
