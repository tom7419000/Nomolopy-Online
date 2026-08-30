/**
 * Lokaler Raum – die Pass-&-Play-Variante von `server/rooms.ts`.
 *
 * Alle vier bis acht Spieler sitzen an EINEM Gerät. Es gibt keine Sockets,
 * keine Tokens und keinen Server; die Engines aus `shared/` laufen direkt im
 * Browser-Tab. Übrig bleibt genau das, was die Server-Schicht sonst leistet:
 * Aktionen an die Engine geben, daraus eine Sicht bauen und veröffentlichen.
 *
 * Diese Datei ist bewusst FREI VON DOM-APIs (kein window, kein localStorage),
 * damit sie unter `tsconfig.server.json` – also ohne DOM-Typen – von
 * `tests/local-room.test.ts` importiert und getestet werden kann. Die
 * Verdrahtung mit Store und Speicher liegt in `local.ts`.
 */

import { BUILT_IN_EDITIONS } from '@shared/boards';
import { BUILT_IN_PACKS } from '@shared/trivia/packs/standard-de';
import type { TriviaPack } from '@shared/trivia/types';
import { getPreset } from '@shared/rules';
import { randomId, randomRoomCode } from '@shared/util';
import { getGameInfo, type AnyGameState, type GameId, type RoomEnvelope, type RoomMeta } from '@shared/games';
import { moduleFor, type GameDeps } from '@shared/registry';
import type { ActionResult, BoardEdition } from '@shared/types';
import type { PokerRules } from '@shared/poker/types';
import type { JeopardyRules } from '@shared/jeopardy/types';
import type { PursuitRules } from '@shared/pursuit/types';

/** Tischkante, an der ein Spieler sitzt – als Drehwinkel der Ansicht. */
export type SeatEdge = 0 | 90 | 180 | 270;

/**
 * Wie das Gerät am Tisch benutzt wird.
 *
 * `pass`  – es wandert reihum, die Ansicht bleibt wie sie ist (Vorgabe).
 * `fixed` – es liegt in der Mitte, jeder sitzt an einer Kante, und die
 *           Ansicht dreht sich zu dem, der gerade handelt.
 *
 * Das ist reine Darstellung und gehört deshalb NICHT in den Spielzustand:
 * keine Engine und kein Envelope wissen davon.
 */
export interface LocalSeating {
  mode: 'pass' | 'fixed';
  /** playerId → Kante. Nur bei `fixed` gefüllt. */
  edges: Record<string, SeatEdge>;
}

/** Vier Kanten – mehr Sitze als Kanten geht bei festen Plätzen nicht. */
export const SEAT_EDGES: SeatEdge[] = [0, 270, 180, 90];
export const MAX_FIXED_SEATS = SEAT_EDGES.length;

export const EDGE_LABELS: Record<SeatEdge, string> = {
  0: 'unten',
  90: 'links',
  180: 'oben',
  270: 'rechts',
};

/** Vorbelegung: gegenübersitzend beginnen, dann die Seiten dazu. */
export function defaultEdges(playerIds: string[]): Record<string, SeatEdge> {
  const order: SeatEdge[] = playerIds.length <= 2 ? [0, 180] : SEAT_EDGES;
  const edges: Record<string, SeatEdge> = {};
  playerIds.forEach((id, i) => {
    edges[id] = order[i % order.length];
  });
  return edges;
}

/** Drehwinkel für den gerade handelnden Sitz. 0 = nichts drehen. */
export function rotationFor(seating: LocalSeating | null, seatId: string | null): SeatEdge {
  if (!seating || seating.mode !== 'fixed' || !seatId) return 0;
  return seating.edges[seatId] ?? 0;
}

export interface LocalRoom {
  meta: RoomMeta;
  /** Zustand des Spiels, das dieser Raum spielt (siehe `meta.gameId`). */
  state: AnyGameState;
  /** null = klassisches Weiterreichen */
  seating: LocalSeating | null;
}

/** Inhalte, die nicht Teil des Spielzustands sind (Editionen, Fragenpakete). */
export interface LocalContent {
  /** Eigene Editionen aus dem Admin-Bereich, falls vorhanden. */
  editions?: BoardEdition[];
  /** Eigene Fragenpakete aus dem Browser-Speicher. */
  packs?: TriviaPack[];
}

export interface LocalRoomOptions extends LocalContent {
  gameId: GameId;
  /** Namen in Sitzreihenfolge – das ist zugleich die Zugreihenfolge. */
  players: string[];
  roomName?: string;
  editionId?: string;
  presetId?: string;
  pokerRules?: Partial<PokerRules>;
  jeopardyRules?: Partial<JeopardyRules>;
  pursuitRules?: Partial<PursuitRules>;
  /** Feste Plätze statt Weiterreichen (siehe `LocalSeating`). */
  seatMode?: LocalSeating['mode'];
  /** Kante je Sitz, in derselben Reihenfolge wie `players`. */
  seatEdges?: SeatEdge[];
}

export interface LocalRoomHooks {
  /** Wird nach jeder Zustandsänderung mit einer frischen Sicht aufgerufen. */
  publish(env: RoomEnvelope, activeSeatId: string | null): void;
  /** Injizierbar für Tests. */
  now?(): number;
}

const err = (error: string): ActionResult => ({ ok: false, error });

// ---------------------------------------------------------------------------
// Aufbau
// ---------------------------------------------------------------------------

/**
 * Die Inhalte, auf die die Spiele zur Laufzeit zugreifen.
 *
 * Wird an zwei Stellen gebraucht: beim Anlegen einer Partie und bei jeder
 * Aktion (Jeopardy schlägt seine Fragen hier nach, statt sie in den Zustand
 * einzubetten). Deshalb eine Funktion und kein Nebenprodukt von
 * `createLocalRoom` – nach einem Reload gibt es kein Setup mehr, aus dem sie
 * fallen könnte.
 */
export function localDeps(content: LocalContent = {}): GameDeps {
  return {
    // Lokal gibt es nur die eingebauten Editionen – der Katalog kommt sonst
    // vom Server, und der ist hier bewusst nicht im Spiel.
    editions: () => (content.editions?.length ? content.editions : BUILT_IN_EDITIONS),
    preset: (id) => getPreset(id) as unknown as { id: string; rules: Record<string, unknown> },
    // Lokal: eingebaute Pakete plus die, die im Browser gespeichert wurden.
    packs: () => (content.packs?.length ? content.packs : BUILT_IN_PACKS),
  };
}

export function createLocalRoom(opts: LocalRoomOptions): LocalRoom {
  const names = opts.players.map((n) => n.trim()).filter(Boolean);
  const code = randomRoomCode();
  const info = getGameInfo(opts.gameId);
  const meta: RoomMeta = {
    code,
    name: opts.roomName?.trim() || `Lokale ${info.name}-Runde`,
    description: 'Pass & Play an einem Gerät',
    gameId: opts.gameId,
    isPublic: false,
    maxPlayers: info.maxPlayers,
    createdAt: Date.now(),
  };

  const m = moduleFor(opts.gameId);
  const deps = localDeps(opts);

  const state = m.create(
    code,
    {
      editionId: opts.editionId,
      presetId: opts.presetId,
      poker: opts.pokerRules,
      jeopardy: opts.jeopardyRules,
      pursuit: opts.pursuitRules,
    },
    deps,
    Date.now()
  );
  const room: LocalRoom = { meta, state, seating: null };

  // Jeder Sitz ist Host – Begründung siehe unten.
  for (const name of names) m.addPlayer(state, randomId(), name, true);

  // Sitzordnung erst NACH dem Anlegen: die Spieler-IDs entstehen oben.
  if (opts.seatMode === 'fixed') {
    const ids = m.seats(state).map((p) => p.id);
    const edges = defaultEdges(ids);
    opts.seatEdges?.forEach((deg, i) => {
      if (ids[i]) edges[ids[i]] = deg;
    });
    room.seating = { mode: 'fixed', edges };
  }

  return room;
}

/**
 * Warum ist JEDER Sitz Host?
 *
 * Die dispatchende Identität rotiert im lokalen Modus mit dem aktiven Sitz
 * (siehe `activeSeatId`). Die Engines prüfen für einige Aktionen intern auf
 * `isHost` – `nextHand`, `endGame`, `removePlayer`, `forceEndTurn`. Wäre nur
 * Sitz 0 Host, würden diese Aktionen je nachdem, wer gerade dran ist,
 * scheitern. Am Tablet ist ohnehin „wer das Gerät hält, darf alles" die
 * richtige Semantik.
 */

// ---------------------------------------------------------------------------
// Wer ist gerade dran?
// ---------------------------------------------------------------------------

/**
 * Der Sitz, dessen Sicht gerade gezeigt wird. Bei Poker steuert dieser Wert
 * zugleich `viewFor` – nur die Karten dieses Sitzes werden aufgedeckt.
 * `null` bedeutet: niemand handelt (Lobby, Showdown, Spielende) – dann liegen
 * auch keine Handkarten offen.
 */
export function activeSeatId(room: LocalRoom): string | null {
  return moduleFor(room.meta.gameId).activeSeatId(room.state);
}

/**
 * Der Sitz, unter dessen Identität Aktionen an die Engine gehen. Zwischen den
 * Händen bzw. außerhalb des Spiels handelt Sitz 0 stellvertretend, damit
 * Knöpfe wie „Nächste Hand" oder „Neue Runde" nie ins Leere laufen.
 */
function actingSeatId(room: LocalRoom): string | null {
  const active = activeSeatId(room);
  if (active) return active;
  return moduleFor(room.meta.gameId).seats(room.state)[0]?.id ?? null;
}

// ---------------------------------------------------------------------------
// Sicht bauen
// ---------------------------------------------------------------------------

/**
 * Baut eine frische Sicht auf den Raum.
 *
 * Der `structuredClone` ist nicht optional: die Engines mutieren ihren
 * Zustand in-place und geben nur `{ok, error}` zurück. Ohne Klon bliebe die
 * Objekt-Identität gleich – React würde nicht neu rendern, und der
 * Prev/Next-Vergleich in `store.ts` vergliche ein Objekt mit sich selbst.
 * Über den Socket erledigt das sonst die JSON-Serialisierung.
 */
export function buildEnvelope(room: LocalRoom): {
  env: RoomEnvelope;
  activeSeatId: string | null;
} {
  const seat = activeSeatId(room);
  const m = moduleFor(room.meta.gameId);

  // Erst klonen, dann redigieren: `redact` liefert eine flache Kopie, die
  // sonst Referenzen in den lebenden Zustand behielte.
  const snapshot = structuredClone(room.state);
  const view = m.redact ? m.redact(snapshot, seat) : snapshot;

  const env = {
    meta: room.meta,
    spectators: [],
    [room.meta.gameId]: view,
  } as RoomEnvelope;

  return { env, activeSeatId: seat };
}

// ---------------------------------------------------------------------------
// Laufzeit
// ---------------------------------------------------------------------------

/**
 * Hält einen lokalen Raum am Leben: nimmt Aktionen entgegen, veröffentlicht
 * nach jeder Änderung und treibt bei Poker die zeitgesteuerten Übergänge.
 */
export class LocalRoomRunner {
  readonly room: LocalRoom;
  private readonly hooks: LocalRoomHooks;
  private readonly deps: GameDeps;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(room: LocalRoom, hooks: LocalRoomHooks, content: LocalContent = {}) {
    this.room = room;
    this.hooks = hooks;
    // Nach einem Reload gibt es kein Setup mehr – die Inhalte kommen dann aus
    // dem Browser-Speicher und werden hier neu zusammengesetzt.
    this.deps = localDeps(content);
  }

  private now(): number {
    return this.hooks.now?.() ?? Date.now();
  }

  /** Sicht bauen, veröffentlichen und die Uhr neu stellen. */
  publish(): void {
    if (this.stopped) return;
    // Am gemeinsamen Gerät gelten andere Zeitregeln (keine Zuguhr, längere
    // Showdown-Pause) – was genau, weiß nur das Spiel selbst.
    moduleFor(this.room.meta.gameId).localAdjust?.(this.room.state, this.now());
    const { env, activeSeatId: seat } = buildEnvelope(this.room);
    this.hooks.publish(env, seat);
    this.scheduleTick();
  }

  /**
   * Zeitgesteuerte Übergänge. Ohne sie hinge Poker nach dem Showdown für
   * immer, weil `nextHandAt` nie ausgewertet würde (Vorbild: `server/rooms.ts`).
   */
  private scheduleTick(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.stopped) return;
    const m = moduleFor(this.room.meta.gameId);
    if (m.phase(this.room.state) !== 'playing') return;

    const at = m.deadline(this.room.state, this.now());
    if (at === null) return;

    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.stopped) return;
      if (m.tick(this.room.state, this.deps, this.now())) this.publish();
      else this.scheduleTick();
    }, Math.max(50, at - this.now()));
    // Im Node-Testlauf darf der Timer den Prozess nicht offen halten.
    (this.timer as unknown as { unref?: () => void }).unref?.();
  }

  /** Räumt den Takt ab – beim Verlassen der Partie aufzurufen. */
  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  // -- Aktionen ------------------------------------------------------------

  start(): ActionResult {
    const r = moduleFor(this.room.meta.gameId).start(this.room.state, this.deps, this.now());
    if (r.ok) this.publish();
    return r;
  }

  /**
   * Aktion an die Engine geben.
   *
   * `seatId` ist der Ausweg für Aktionen, die NICHT der gerade aktive Sitz
   * auslöst: Jeopardys Buzzer („wer war zuerst?") und die Wertung durch die
   * Mitspieler. Am gemeinsamen Gerät gibt es keine Identität zu umgehen – wer
   * das Tablet hält, handelt ohnehin für alle. Online existiert dieser Weg
   * deshalb bewusst nicht: dort kommt die Identität aus dem Socket.
   */
  action(action: unknown, seatId?: string): ActionResult {
    const seat = seatId ?? actingSeatId(this.room);
    if (!seat) return err('Kein aktiver Spieler.');
    const r = moduleFor(this.room.meta.gameId).apply(this.room.state, seat, action, this.deps, this.now());
    if (r.ok) this.publish();
    return r;
  }

  chat(text: string): ActionResult {
    const seat = actingSeatId(this.room);
    if (!seat) return err('Kein aktiver Spieler.');
    const m = moduleFor(this.room.meta.gameId);
    const p = m.seats(this.room.state).find((x) => x.id === seat);
    if (!p) return err('Kein aktiver Spieler.');
    const r = m.chat(this.room.state, { id: p.id, name: p.name, color: p.color }, text);
    if (r.ok) this.publish();
    return r;
  }

  /** Neue Runde mit derselben Besetzung. */
  rematch(): ActionResult {
    const m = moduleFor(this.room.meta.gameId);
    if (m.phase(this.room.state) !== 'ended') return err('Die Partie läuft noch.');
    // Lokal gibt es keine Zuschauer, die nachrücken könnten.
    m.resetForRematch(this.room.state, {
      spectators: [],
      maxPlayers: this.room.meta.maxPlayers,
      onSeated: () => {},
    });
    const r = m.start(this.room.state, this.deps, this.now());
    if (r.ok) this.publish();
    return r;
  }
}
