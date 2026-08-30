/**
 * Monopoly als Plattform-Modul.
 *
 * Bewusst nur ein Adapter: Die Engine in `shared/engine.ts` bleibt völlig
 * unangetastet, damit die vorhandenen Unit-Tests konstruktionsbedingt
 * weiterlaufen. Hier steht ausschließlich die Übersetzung zwischen dem
 * spielunabhängigen Vertrag und den Engine-Funktionen.
 */

import {
  addChat,
  addPlayer,
  applyAction,
  auctionTick,
  createGame,
  getPlayer,
  log,
  nextDeadline,
  removeLobbyPlayer,
  rerollAppearance,
  resetToLobby,
  startGame,
} from '../engine';
import { BUILT_IN_EDITIONS } from '../boards';
import type { GameAction, GameState, RuleSet } from '../types';
import type { GameModule } from '../registry';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export const monopolyModule: GameModule<'monopoly'> = {
  id: 'monopoly',

  create(code, config, deps) {
    const editions = deps.editions();
    const edition =
      editions.find((e) => e.id === config.editionId) ?? editions[0] ?? BUILT_IN_EDITIONS[0];
    const preset = deps.preset(String(config.presetId ?? 'classic'));
    return createGame(code, edition, preset.id, preset.rules as unknown as RuleSet);
  },

  addPlayer(s, id, name, isHost) {
    return addPlayer(s, id, name, isHost);
  },

  removeLobbyPlayer(s, id) {
    removeLobbyPlayer(s, id);
  },

  start(s) {
    return startGame(s);
  },

  resetForRematch(s) {
    // Getrennte fliegen raus, der Rest spielt weiter. Zuschauer gibt es hier
    // nicht – Monopoly nimmt keine auf.
    s.players = s.players.filter((p) => p.connected);
    resetToLobby(s);
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
      eliminated: p.bankrupt,
      avatar: p.token,
    }));
  },

  activeSeatId(s) {
    if (s.phase !== 'playing') return null;
    // Auktion und Handel geben das Handlungsrecht vorübergehend weiter –
    // sonst könnte am geteilten Gerät niemand darauf antworten.
    if (s.auction) return s.auction.order[s.auction.turnIndex] ?? null;
    if (s.trade) return s.trade.toId;
    return s.players[s.currentPlayer]?.id ?? null;
  },

  setConnected(s, id, connected) {
    const p = getPlayer(s, id);
    if (p) p.connected = connected;
  },

  transferHost(s, fromId) {
    const leaving = getPlayer(s, fromId);
    if (!leaving?.isHost) return null;
    const next = s.players.find((p) => p.connected && !p.bankrupt && p.id !== fromId);
    if (!next) return null;
    leaving.isHost = false;
    next.isHost = true;
    return {
      id: next.id,
      name: next.name,
      color: next.color,
      isHost: true,
      connected: next.connected,
      eliminated: next.bankrupt,
      avatar: next.token,
    };
  },

  apply(s, playerId, action) {
    return applyAction(s, playerId, action as GameAction);
  },

  chat(s, author, text) {
    return addChat(s, author.id, text);
  },

  messages(s) {
    return s.chat;
  },

  systemLog(s, text, playerId) {
    log(s, 'system', text, playerId);
  },

  configure(s, patch, deps) {
    if (typeof patch.editionId === 'string') {
      const edition = deps.editions().find((e) => e.id === patch.editionId);
      if (edition) s.edition = structuredClone(edition);
    }
    if (typeof patch.presetId === 'string') {
      const preset = deps.preset(patch.presetId);
      s.presetId = preset.id;
      s.rules = { ...(preset.rules as unknown as RuleSet) };
    }
    const r = patch.rules as Partial<RuleSet> | undefined;
    if (r && typeof r === 'object') {
      const rules = s.rules;
      if (typeof r.startingMoney === 'number') rules.startingMoney = clamp(r.startingMoney, 100, 10000);
      if (typeof r.goSalary === 'number') rules.goSalary = clamp(r.goSalary, 0, 1000);
      if (typeof r.jailFine === 'number') rules.jailFine = clamp(r.jailFine, 0, 500);
      if (typeof r.freeParkingBonus === 'boolean') rules.freeParkingBonus = r.freeParkingBonus;
      if (typeof r.doubleRentFullGroup === 'boolean') rules.doubleRentFullGroup = r.doubleRentFullGroup;
      if (typeof r.auctionOnSkip === 'boolean') rules.auctionOnSkip = r.auctionOnSkip;
      if (typeof r.auctionBidSeconds === 'number') rules.auctionBidSeconds = clamp(r.auctionBidSeconds, 0, 120);
      if (typeof r.debugMode === 'boolean') rules.debugMode = r.debugMode;
    }
  },

  rerollAppearance(s, playerId) {
    return rerollAppearance(s, playerId);
  },

  // Monopoly hat keine verdeckte Information – alle sehen denselben Zustand.
  redact: null,
  redactPerViewer: false,

  deadline(s) {
    return nextDeadline(s);
  },

  tick(s, _deps, now) {
    return auctionTick(s, now);
  },

  localAdjust(s) {
    // Am gemeinsamen Gerät kann sich niemand „trennen"; ein Auto-Pass beim
    // Weiterreichen wäre die falsche Strafe.
    if (s.auction) s.auction.deadline = null;
  },

  caps: {
    spectators: false,
    saveLoad: true,
    rejoinByName: true,
    rotatesToActor: true,
  },
};

/** Für Aufrufer, die den konkreten Typ brauchen. */
export type MonopolyState = GameState;
