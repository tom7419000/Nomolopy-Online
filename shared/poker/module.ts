/**
 * Texas Hold'em als Plattform-Modul.
 *
 * Wie beim Monopoly-Modul nur ein Adapter – `shared/poker/engine.ts` bleibt
 * unverändert.
 *
 * Zwei Besonderheiten gegenüber Monopoly, die den Vertrag überhaupt erst
 * nötig machen: Poker hat verdeckte Information (`redact` pro Empfänger)
 * und eine laufende Uhr (`deadline`/`tick`).
 */

import {
  addPokerChat,
  addPokerPlayer,
  applyPokerAction,
  createPoker,
  getPokerPlayer,
  pokerTick,
  removePokerLobbyPlayer,
  resetPokerToLobby,
  startPoker,
  viewFor,
} from './engine';
import { sanitizePokerRules } from './rules';
import type { PokerAction, PokerRules, PokerState, PokerView } from './types';
import type { GameModule } from '../registry';

/** Getrennte Spieler bekommen nur eine kurze Gnadenfrist statt der vollen Zeit. */
const DISCONNECTED_GRACE_MS = 5000;

/**
 * Pause nach dem Showdown am gemeinsamen Gerät. Online reichen neun
 * Sekunden, weil jeder auf seinen eigenen Bildschirm schaut; am Tisch
 * wollen alle die aufgedeckten Karten in Ruhe sehen.
 */
const LOCAL_SHOWDOWN_PAUSE_MS = 25_000;

/**
 * Die Plattform arbeitet mit `PokerView` (also ohne Deck). Der Raum hält
 * aber den vollen `PokerState` – nur so lässt sich weiterspielen. Diese
 * Umdeutung ist die eine Stelle, an der das zusammenkommt.
 */
const full = (s: PokerView): PokerState => s as PokerState;

export const pokerModule: GameModule<'poker'> = {
  id: 'poker',

  create(code, config, _deps, now) {
    const rules = sanitizePokerRules(config.poker ?? config.pokerRules ?? {});
    return createPoker(code, rules, now) as PokerView;
  },

  addPlayer(s, id, name, isHost) {
    return addPokerPlayer(full(s), id, name, isHost);
  },

  removeLobbyPlayer(s, id) {
    removePokerLobbyPlayer(full(s), id);
  },

  start(s, now) {
    return startPoker(full(s), now);
  },

  resetForRematch(s, ctx) {
    const poker = full(s);
    // Getrennte fliegen raus; wer verbunden ist (auch Ausgeschiedene),
    // spielt die neue Runde mit.
    poker.players = poker.players.filter((p) => p.connected);
    resetPokerToLobby(poker);
    if (poker.players.length > 0 && !poker.players.some((p) => p.isHost)) {
      poker.players[0].isHost = true;
    }
    // Zuschauer bekommen einen Sitz, solange Platz ist.
    for (const spec of ctx.spectators) {
      if (poker.players.length >= ctx.maxPlayers) break;
      addPokerPlayer(poker, spec.id, spec.name, poker.players.length === 0);
      ctx.onSeated(spec.id);
    }
  },

  phase(s) {
    return s.phase;
  },

  seats(s) {
    return s.players.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      isHost: p.isHost,
      connected: p.connected,
      eliminated: p.out,
    }));
  },

  activeSeatId(s) {
    if (s.phase !== 'playing' || s.toActIndex === null) return null;
    return s.players[s.toActIndex]?.id ?? null;
  },

  setConnected(s, id, connected) {
    const p = getPokerPlayer(full(s), id);
    if (p) p.connected = connected;
  },

  transferHost(s, fromId) {
    const leaving = getPokerPlayer(full(s), fromId);
    if (!leaving?.isHost) return null;
    const next = s.players.find((p) => p.connected && !p.out && p.id !== fromId);
    if (!next) return null;
    leaving.isHost = false;
    next.isHost = true;
    return {
      id: next.id,
      name: next.name,
      color: next.color,
      isHost: true,
      connected: next.connected,
      eliminated: next.out,
    };
  },

  apply(s, playerId, action, now) {
    return applyPokerAction(full(s), playerId, action as PokerAction, now);
  },

  chat(s, author, text) {
    return addPokerChat(full(s), author, text);
  },

  configure(s, patch) {
    const p = patch.poker ?? patch.pokerRules;
    if (p && typeof p === 'object') {
      s.rules = sanitizePokerRules({ ...s.rules, ...(p as Partial<PokerRules>) });
      s.smallBlind = s.rules.smallBlind;
      s.bigBlind = s.rules.smallBlind * 2;
    }
  },

  redact(s, viewerId) {
    return viewFor(full(s), viewerId);
  },
  redactPerViewer: true,

  deadline(s, now) {
    if (s.phase !== 'playing') return null;
    if (s.street === 'showdown' && s.nextHandAt !== null) return s.nextHandAt;
    if (s.toActIndex !== null && s.actionDeadline !== null) {
      const actor = s.players[s.toActIndex];
      if (actor && !actor.connected) {
        s.actionDeadline = Math.min(s.actionDeadline, now + DISCONNECTED_GRACE_MS);
      }
      return s.actionDeadline;
    }
    return null;
  },

  tick(s, now) {
    return pokerTick(full(s), now);
  },

  localAdjust(s, now) {
    // Kein Auto-Fold, während das Gerät weitergereicht wird …
    s.actionDeadline = null;
    // … und nach dem Showdown mehr Zeit zum Schauen.
    if (s.nextHandAt !== null) {
      const min = now + LOCAL_SHOWDOWN_PAUSE_MS;
      if (s.nextHandAt < min) s.nextHandAt = min;
    }
  },

  caps: {
    spectators: true,
    saveLoad: false,
    rejoinByName: true,
  },
};
