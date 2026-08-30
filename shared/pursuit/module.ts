/**
 * Trivial Pursuit als Plattform-Modul.
 *
 * Wie die drei anderen nur ein Adapter – `engine.ts` bleibt frei von
 * Plattform-Wissen. Wie Jeopardy braucht es Inhalt zur Laufzeit, also reicht
 * die Plattform `GameDeps` bis in `start`, `apply` und `tick` durch.
 */

import {
  addPursuitChat,
  addPursuitPlayer,
  applyPursuitAction,
  createPursuit,
  getPursuitPlayer,
  localAdjustPursuit,
  pursuitDeadline,
  pursuitLog,
  pursuitTick,
  pursuitView,
  removePursuitLobbyPlayer,
  resetPursuitToLobby,
  startPursuit,
} from './engine';
import { sanitizePursuitRules } from './rules';
import type { PursuitAction, PursuitPlayer, PursuitRules, PursuitState } from './types';
import type { TriviaPack } from '../trivia/types';
import type { GameDeps, GameModule, SeatInfo } from '../registry';

/** Das Paket dieser Partie – exakt, ohne stillen Ersatz (siehe Jeopardy). */
function packOf(s: PursuitState, deps: GameDeps): TriviaPack | null {
  return deps.packs().find((p) => p.id === s.rules.packId) ?? null;
}

function seatOf(p: PursuitPlayer): SeatInfo {
  return {
    id: p.id,
    name: p.name,
    color: p.color,
    isHost: p.isHost,
    connected: p.connected,
    eliminated: p.resigned,
    avatar: p.avatar,
  };
}

export const pursuitModule: GameModule<'pursuit'> = {
  id: 'pursuit',

  create(code, config, deps, now) {
    const rules = sanitizePursuitRules(config.pursuit ?? config.pursuitRules ?? {});
    // Beim Anlegen darf ein unbekanntes Paket noch ersetzt werden – ab jetzt
    // ist die Wahl fest.
    const packs = deps.packs();
    if (!packs.some((p) => p.id === rules.packId)) rules.packId = packs[0]?.id ?? rules.packId;
    return createPursuit(code, rules, now);
  },

  addPlayer(s, id, name, isHost) {
    return addPursuitPlayer(s, id, name, isHost);
  },

  removeLobbyPlayer(s, id) {
    removePursuitLobbyPlayer(s, id);
  },

  start(s, deps, now) {
    return startPursuit(s, packOf(s, deps), now);
  },

  resetForRematch(s, ctx) {
    // Getrennte fliegen raus, Zuschauer rücken nach – wie bei Poker und Jeopardy.
    s.players = s.players.filter((p) => p.connected);
    resetPursuitToLobby(s);
    if (s.players.length > 0 && !s.players.some((p) => p.isHost)) s.players[0].isHost = true;
    for (const spec of ctx.spectators) {
      if (s.players.length >= ctx.maxPlayers) break;
      addPursuitPlayer(s, spec.id, spec.name, s.players.length === 0);
      ctx.onSeated(spec.id);
    }
  },

  phase(s) {
    return s.phase;
  },

  seats(s) {
    return s.players.map(seatOf);
  },

  /**
   * Wer gerade handeln DARF.
   *
   * Beim Werten und beim Wählen der Schlussfrage-Farbe handeln alle AUSSER
   * einem – dort ist `null` die ehrliche Antwort, und die Oberfläche hängt an
   * `turnPhase` statt an „du bist dran".
   */
  activeSeatId(s) {
    if (s.phase !== 'playing') return null;
    if (s.turnPhase === 'awaiting-judge' || s.turnPhase === 'awaiting-category') return null;
    return s.players[s.currentPlayer]?.id ?? null;
  },

  setConnected(s, id, connected) {
    const p = getPursuitPlayer(s, id);
    if (p) p.connected = connected;
  },

  transferHost(s, fromId) {
    const leaving = getPursuitPlayer(s, fromId);
    if (!leaving?.isHost) return null;
    const next = s.players.find((p) => p.connected && !p.resigned && p.id !== fromId);
    if (!next) return null;
    leaving.isHost = false;
    next.isHost = true;
    return seatOf(next);
  },

  apply(s, playerId, action, deps, now) {
    return applyPursuitAction(s, playerId, action as PursuitAction, packOf(s, deps), now);
  },

  chat(s, author, text) {
    return addPursuitChat(s, author, text);
  },

  messages(s) {
    return s.chat;
  },

  systemLog(s, text, playerId) {
    pursuitLog(s, 'system', text, playerId);
  },

  configure(s, patch, deps) {
    const p = patch.pursuit ?? patch.pursuitRules;
    if (!p || typeof p !== 'object') return;
    const merged = sanitizePursuitRules({ ...s.rules, ...(p as Partial<PursuitRules>) });
    // Ein Paket, das es nicht gibt, wird nicht übernommen – sonst ließe sich
    // der Raum in einen unstartbaren Zustand konfigurieren.
    if (!deps.packs().some((x) => x.id === merged.packId)) merged.packId = s.rules.packId;
    s.rules = merged;
  },

  redact: (s) => pursuitView(s),
  /** Einheitlich geschwärzt: die Antwort ist vor jedem verborgen. */
  redactPerViewer: false,

  deadline(s, now) {
    return pursuitDeadline(s, now);
  },

  tick(s, _deps, now) {
    return pursuitTick(s, now);
  },

  localAdjust(s, now) {
    localAdjustPursuit(s, now);
  },

  caps: {
    // Der große Bildschirm zeigt das Rad, die Handys würfeln und antworten.
    spectators: true,
    saveLoad: false,
    rejoinByName: true,
    // Ein rundenbasiertes Brettspiel – das Rad darf sich zum Spieler drehen.
    rotatesToActor: true,
  },
};
