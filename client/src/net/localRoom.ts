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

import {
  addChat,
  addPlayer,
  applyAction,
  createGame,
  resetToLobby,
  startGame,
} from '@shared/engine';
import {
  addPokerChat,
  addPokerPlayer,
  applyPokerAction,
  createPoker,
  getPokerPlayer,
  pokerTick,
  resetPokerToLobby,
  startPoker,
  viewFor,
} from '@shared/poker/engine';
import { BUILT_IN_EDITIONS } from '@shared/boards';
import { getPreset } from '@shared/rules';
import { sanitizePokerRules } from '@shared/poker/rules';
import { randomId, randomRoomCode } from '@shared/util';
import type { ActionResult, BoardEdition, GameAction, GameState } from '@shared/types';
import type { GameId, RoomEnvelope, RoomMeta } from '@shared/games';
import type { PokerAction, PokerRules, PokerState } from '@shared/poker/types';

export interface LocalRoom {
  meta: RoomMeta;
  monopoly: GameState | null;
  poker: PokerState | null;
}

export interface LocalRoomOptions {
  gameId: GameId;
  /** Namen in Sitzreihenfolge – das ist zugleich die Zugreihenfolge. */
  players: string[];
  roomName?: string;
  editionId?: string;
  presetId?: string;
  pokerRules?: Partial<PokerRules>;
  /** Eigene Editionen aus dem Admin-Bereich, falls vorhanden. */
  editions?: BoardEdition[];
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

export function createLocalRoom(opts: LocalRoomOptions): LocalRoom {
  const names = opts.players.map((n) => n.trim()).filter(Boolean);
  const code = randomRoomCode();
  const meta: RoomMeta = {
    code,
    name: opts.roomName?.trim() || (opts.gameId === 'poker' ? 'Lokale Pokerrunde' : 'Lokale Runde'),
    description: 'Pass & Play an einem Gerät',
    gameId: opts.gameId,
    isPublic: false,
    maxPlayers: Math.max(names.length, 2),
    createdAt: Date.now(),
  };

  const room: LocalRoom = { meta, monopoly: null, poker: null };

  if (opts.gameId === 'poker') {
    const rules = sanitizePokerRules({ ...opts.pokerRules });
    room.poker = createPoker(code, rules);
    for (const name of names) addPokerPlayer(room.poker, randomId(), name, true);
  } else {
    const editions = opts.editions?.length ? opts.editions : BUILT_IN_EDITIONS;
    const edition =
      editions.find((e) => e.id === opts.editionId) ?? editions[0] ?? BUILT_IN_EDITIONS[0];
    const preset = getPreset(opts.presetId ?? 'classic');
    room.monopoly = createGame(code, edition, preset.id, preset.rules);
    for (const name of names) addPlayer(room.monopoly, randomId(), name, true);
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
  const g = room.monopoly;
  if (g) {
    if (g.phase !== 'playing') return null;
    return g.players[g.currentPlayer]?.id ?? null;
  }
  const p = room.poker;
  if (p) {
    if (p.phase !== 'playing' || p.toActIndex === null) return null;
    return p.players[p.toActIndex]?.id ?? null;
  }
  return null;
}

/**
 * Der Sitz, unter dessen Identität Aktionen an die Engine gehen. Zwischen den
 * Händen bzw. außerhalb des Spiels handelt Sitz 0 stellvertretend, damit
 * Buttons wie „Nächste Hand" oder „Neue Runde" nie ins Leere laufen.
 */
function actingSeatId(room: LocalRoom): string | null {
  const active = activeSeatId(room);
  if (active) return active;
  const players = room.monopoly?.players ?? room.poker?.players ?? [];
  return players[0]?.id ?? null;
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
  const env: RoomEnvelope = { meta: room.meta, spectators: [] };

  if (room.monopoly) {
    env.monopoly = structuredClone(room.monopoly);
  } else if (room.poker) {
    // Erst klonen, dann redigieren: viewFor liefert eine flache Kopie, die
    // sonst Referenzen in den lebenden Zustand behielte.
    env.poker = viewFor(structuredClone(room.poker), seat);
  }

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
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(room: LocalRoom, hooks: LocalRoomHooks) {
    this.room = room;
    this.hooks = hooks;
  }

  private now(): number {
    return this.hooks.now?.() ?? Date.now();
  }

  /** Sicht bauen, veröffentlichen und den Poker-Takt neu stellen. */
  publish(): void {
    if (this.stopped) return;
    // Die Zug-Uhr gilt am gemeinsamen Gerät nicht: ein Auto-Fold, weil das
    // Tablet gerade weitergereicht wird, wäre die falsche Strafe.
    if (this.room.poker) this.room.poker.actionDeadline = null;
    const { env, activeSeatId: seat } = buildEnvelope(this.room);
    this.hooks.publish(env, seat);
    this.scheduleTick();
  }

  /**
   * Poker-Takt. Ohne ihn hinge die Partie nach dem Showdown für immer, weil
   * `nextHandAt` nie ausgewertet würde (Vorbild: `server/rooms.ts`).
   */
  private scheduleTick(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const p = this.room.poker;
    if (this.stopped || !p || p.nextHandAt === null) return;

    const delay = Math.max(50, p.nextHandAt - this.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.stopped) return;
      if (pokerTick(p, this.now())) this.publish();
      else this.scheduleTick();
    }, delay);
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
    const r = this.room.monopoly
      ? startGame(this.room.monopoly)
      : this.room.poker
        ? startPoker(this.room.poker, this.now())
        : err('Kein Spiel im Raum.');
    if (r.ok) this.publish();
    return r;
  }

  action(action: GameAction | PokerAction): ActionResult {
    const seat = actingSeatId(this.room);
    if (!seat) return err('Kein aktiver Spieler.');

    const r = this.room.monopoly
      ? applyAction(this.room.monopoly, seat, action as GameAction)
      : this.room.poker
        ? applyPokerAction(this.room.poker, seat, action as PokerAction, this.now())
        : err('Kein Spiel im Raum.');
    if (r.ok) this.publish();
    return r;
  }

  chat(text: string): ActionResult {
    const seat = actingSeatId(this.room);
    if (!seat) return err('Kein aktiver Spieler.');

    let r: ActionResult;
    if (this.room.monopoly) {
      r = addChat(this.room.monopoly, seat, text);
    } else if (this.room.poker) {
      const p = getPokerPlayer(this.room.poker, seat);
      if (!p) return err('Kein aktiver Spieler.');
      r = addPokerChat(this.room.poker, { id: p.id, name: p.name, color: p.color }, text);
    } else {
      return err('Kein Spiel im Raum.');
    }
    if (r.ok) this.publish();
    return r;
  }

  /** Neue Runde mit derselben Besetzung. */
  rematch(): ActionResult {
    if (this.room.monopoly) {
      if (this.room.monopoly.phase !== 'ended') return err('Die Partie läuft noch.');
      resetToLobby(this.room.monopoly);
      const r = startGame(this.room.monopoly);
      if (r.ok) this.publish();
      return r;
    }
    if (this.room.poker) {
      if (this.room.poker.phase !== 'ended') return err('Die Partie läuft noch.');
      resetPokerToLobby(this.room.poker);
      const r = startPoker(this.room.poker, this.now());
      if (r.ok) this.publish();
      return r;
    }
    return err('Kein Spiel im Raum.');
  }
}
