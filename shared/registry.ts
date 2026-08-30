/**
 * Spiel-Registry: der Vertrag, den jedes Spiel gegenüber der Plattform erfüllt.
 *
 * Warum das existiert: Bis hierher verzweigte die Plattform an rund siebzig
 * Stellen mit `room.monopoly ? … : room.poker ? … : …`. Solche Ketten sind
 * für den Compiler unsichtbar – ein drittes Spiel wäre stumm als eines der
 * beiden gerendert worden. Die Registry dreht das um: `GAME_MODULES` ist ein
 * `Record<GameId, …>`, und ein `Record` über eine Union VERLANGT einen
 * Eintrag pro Mitglied. Sobald `GameStateMap` wächst, bricht der Build genau
 * dort, wo etwas zu implementieren ist.
 *
 * Diese Datei ist frei von DOM- und Node-APIs: sie läuft auf dem Server, im
 * Browser und im Testlauf.
 */

import type { ActionResult, BoardEdition, ChatMessage } from './types';
import type { GameId, GameStateMap } from './games';
import type { TriviaPack } from './trivia/types';
import { monopolyModule } from './monopoly/module';
import { pokerModule } from './poker/module';
import { jeopardyModule } from './jeopardy/module';
import { pursuitModule } from './pursuit/module';

/** Was die Plattform von einem Spieler wissen muss – spielunabhängig. */
export interface SeatInfo {
  id: string;
  name: string;
  color: string;
  isHost: boolean;
  connected: boolean;
  /** Endgültig raus (bankrott bzw. ausgestiegen) */
  eliminated: boolean;
  /** Spielfigur bzw. Avatar als Emoji – wie das Spiel seine Leute zeigt. */
  avatar: string;
}

export interface ChatAuthor {
  id: string;
  name: string;
  color: string;
}

/**
 * Alles, was ein Spiel von außen braucht – beim Anlegen UND zur Laufzeit.
 *
 * Monopoly bettet seine Edition in den Zustand ein, damit Spielstände autark
 * sind. Jeopardy tut das mit seinem Fragenpaket bewusst NICHT (es hat keine
 * Spielstände, und die Antworten lägen sonst in jedem Client offen) – es
 * schlägt jede Frage zur Laufzeit hier nach. Deshalb reichen `start`,
 * `apply` und `tick` die Abhängigkeiten durch.
 */
export interface GameDeps {
  editions(): BoardEdition[];
  preset(id: string): { id: string; rules: Record<string, unknown> };
  /** Fragenpakete für die Trivia-Spiele (eingebaut + eigene). */
  packs(): TriviaPack[];
}

/** Optionen aus dem „Raum erstellen"-Dialog, pro Spiel unterschiedlich. */
export interface CreateConfig {
  editionId?: string;
  presetId?: string;
  [key: string]: unknown;
}

export interface GameModule<K extends GameId = GameId> {
  readonly id: K;

  // -- Aufbau -------------------------------------------------------------
  create(code: string, config: CreateConfig, deps: GameDeps, now: number): GameStateMap[K];
  addPlayer(s: GameStateMap[K], id: string, name: string, isHost: boolean): ActionResult;
  removeLobbyPlayer(s: GameStateMap[K], id: string): void;
  start(s: GameStateMap[K], deps: GameDeps, now: number): ActionResult;
  /** Neue Runde: aufräumen und, falls nötig, Zuschauer nachrücken lassen. */
  resetForRematch(s: GameStateMap[K], ctx: RematchContext): void;

  // -- Sicht der Plattform ------------------------------------------------
  phase(s: GameStateMap[K]): 'lobby' | 'playing' | 'ended';
  seats(s: GameStateMap[K]): SeatInfo[];
  /**
   * Wer gerade handeln DARF. Treibt „du bist dran", das Band am geteilten
   * Gerät und die Sitzrotation im Pass-&-Play-Modus. `null` heißt: niemand
   * (Lobby, Showdown, Spielende).
   */
  activeSeatId(s: GameStateMap[K]): string | null;
  setConnected(s: GameStateMap[K], id: string, connected: boolean): void;
  /**
   * Host-Rechte abgeben, wenn der Host geht. Liefert den neuen Host oder
   * `null`, wenn keiner in Frage kommt.
   */
  transferHost(s: GameStateMap[K], fromId: string): SeatInfo | null;

  // -- Aktionen -----------------------------------------------------------
  apply(s: GameStateMap[K], playerId: string, action: unknown, deps: GameDeps, now: number): ActionResult;
  chat(s: GameStateMap[K], author: ChatAuthor, text: string): ActionResult;
  /**
   * Der bisherige Chat-Verlauf – für die Lobby, die kein Spiel kennt.
   *
   * Die Spieltische lesen ihren eigenen Zustand direkt und typsicher; nur
   * `Room.tsx` steht vor „irgendeinem" Zustand und hätte sonst geraten.
   */
  messages(s: GameStateMap[K]): ChatMessage[];
  /**
   * Systemzeile ins Protokoll des Spiels („X ist wieder verbunden").
   *
   * Die Plattform schreibt sie, die Engines führen ihr Protokoll aber je
   * selbst. Vorher stand dafür ein `if (gameId === 'poker')` im Server, mit
   * einem `as never` und einem stillschweigenden else-Zweig – genau die
   * Sorte Verzweigung, die diese Registry abschaffen soll.
   */
  systemLog(s: GameStateMap[K], text: string, playerId?: string): void;
  /** Raum-Einstellungen aus der Lobby übernehmen (ersetzt die Allowlist). */
  configure(s: GameStateMap[K], patch: Record<string, unknown>, deps: GameDeps): void;
  /** Optional: Spielfigur/Farbe neu würfeln (nur Monopoly). */
  rerollAppearance?(s: GameStateMap[K], playerId: string): ActionResult;

  // -- Geheimnisse und Zeit ------------------------------------------------
  /**
   * Redigierte Sicht für einen Empfänger. `null` = nichts zu verbergen,
   * der Zustand geht unverändert an alle.
   */
  redact: ((s: GameStateMap[K], viewerId: string | null) => GameStateMap[K]) | null;
  /** Muss pro Empfänger neu gerechnet werden? Steuert den Broadcast-Pfad. */
  readonly redactPerViewer: boolean;
  /** Nächste Frist, oder null wenn gerade keine Uhr läuft. */
  deadline(s: GameStateMap[K], now: number): number | null;
  /** Zeit weiterlaufen lassen; true, wenn sich etwas geändert hat. */
  tick(s: GameStateMap[K], deps: GameDeps, now: number): boolean;
  /** Am gemeinsamen Gerät gelten andere Regeln (keine Zuguhr, längere Pausen). */
  localAdjust?(s: GameStateMap[K], now: number): void;

  readonly caps: {
    /** Nimmt das Spiel Zuschauer auf? */
    spectators: boolean;
    /** Gibt es Spielstände auf dem Server? */
    saveLoad: boolean;
    /** Darf jemand mit demselben Namen wieder auf seinen Sitz? */
    rejoinByName: boolean;
    /**
     * Bringt es etwas, die Ansicht am gemeinsamen Gerät zum Handelnden zu
     * drehen? (Feste Plätze, siehe `LocalSeating`.)
     *
     * Bei Monopoly und Poker ja – da schaut einer auf sein Brett bzw. seine
     * Karten. Bei Jeopardy nein: alle lesen dieselbe Frage, und sie zu einem
     * einzelnen zu drehen macht sie für die anderen unlesbar. Ohne dieses
     * Flag stünde im lokalen Setup ein Schalter, der nichts tut.
     */
    rotatesToActor: boolean;
  };
}

export interface RematchContext {
  /** Zuschauer, die einen Sitz bekommen könnten. */
  spectators: ChatAuthor[];
  maxPlayers: number;
  /** Wird für jeden Zuschauer aufgerufen, der einen Sitz bekommen hat. */
  onSeated(spectatorId: string): void;
}

/**
 * Erzwingt Vollständigkeit über eine Union. Anweisungs-Switches im
 * void-Kontext schweigen sonst bei einem neuen Fall.
 */
export function assertNever(x: never, what = 'Fall'): never {
  throw new Error(`Unbehandelter ${what}: ${JSON.stringify(x)}`);
}

// ---------------------------------------------------------------------------
// Die Tabelle
// ---------------------------------------------------------------------------

/**
 * Ein `Record` über `GameId` VERLANGT einen Eintrag pro Spiel. Genau das ist
 * der Zweck: Sobald `GameStateMap` wächst, meldet der Compiler hier, was
 * fehlt – statt dass ein neues Spiel stumm als Monopoly gerendert wird.
 */
export const GAME_MODULES: { [K in GameId]: GameModule<K> } = {
  monopoly: monopolyModule,
  poker: pokerModule,
  jeopardy: jeopardyModule,
  pursuit: pursuitModule,
};

/**
 * Die EINZIGE Typbehauptung im Registry-Pfad.
 *
 * `GAME_MODULES[gameId]` mit einem Union-Schlüssel ergibt eine Union von
 * Modultypen, deren Signaturen sich unterscheiden – die kann TypeScript
 * nicht aufrufen. Dass der Zustand im Raum zu `meta.gameId` passt, gilt per
 * Konstruktion (nur `create` legt ihn an), lässt sich aber nicht ausdrücken.
 */
export function moduleFor(gameId: GameId): GameModule<GameId> {
  return GAME_MODULES[gameId] as GameModule<GameId>;
}
