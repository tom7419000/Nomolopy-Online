/**
 * Typen für Texas Hold'em. Wie beim Monopoly-Teil gilt: Der Zustand ist
 * reines JSON und wird nach jeder Aktion komplett synchronisiert – mit dem
 * Unterschied, dass jeder Client nur eine REDIGIERTE Sicht bekommt
 * (kein Deck, fremde Hole Cards nur bei Showdown).
 */

import type { ChatMessage, LogEntry } from '../types';

export type PokerStreet = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';

export interface PokerRules {
  /** Start-Chips pro Spieler (1.000–10.000) */
  buyIn: number;
  /** Basis-Small-Blind der ersten Stufe */
  smallBlind: number;
  /** Blinds verdoppeln sich alle X Minuten (0 = konstant) */
  blindIncreaseMinutes: number;
  /** Bedenkzeit pro Aktion in Sekunden (30–120) */
  actionTimeoutSec: number;
  /** Pleite-Spieler dürfen sich neu einkaufen (Cash-Game-Stil) */
  allowRebuy: boolean;
}

export interface PokerPlayer {
  id: string;
  name: string;
  color: string;
  avatar: string; // Emoji
  isHost: boolean;
  connected: boolean;
  chips: number;
  /** 2 Hole Cards – in redigierten Sichten nur für den Besitzer/bei Showdown gefüllt */
  hole: number[] | null;
  /** Einsatz in der laufenden Setzrunde */
  bet: number;
  /** Gesamteinsatz in der laufenden Hand (für Side-Pots) */
  committed: number;
  folded: boolean;
  allIn: boolean;
  /** Endgültig ausgeschieden (pleite ohne Rebuy oder aufgegeben) */
  out: boolean;
  /** Karten beim Showdown aufgedeckt */
  revealed: boolean;
  /** Letzte Aktion für die Anzeige („Call", „Raise 200", …) */
  lastAction: string | null;
  rebuys: number;
}

export interface PotResult {
  amount: number;
  winners: { playerId: string; amount: number }[];
  handName: string | null;
}

export interface HandResult {
  pots: PotResult[];
  /** Aufgedeckte Hände (leer, wenn alle bis auf einen gefoldet haben) */
  reveal: { playerId: string; hole: number[]; handName: string; best: number[] }[];
  foldWin: boolean;
}

export type PokerPhase = 'lobby' | 'playing' | 'ended';

export interface PokerState {
  id: string; // Raum-Code
  createdAt: number;
  startedAt: number;
  phase: PokerPhase;
  rules: PokerRules;
  players: PokerPlayer[]; // Reihenfolge = Sitzordnung
  handNumber: number;
  blindLevel: number;
  smallBlind: number; // aktuelle Blinds (aus Level berechnet)
  bigBlind: number;
  street: PokerStreet;
  /** GEHEIM – wird vor dem Broadcast entfernt */
  deck: number[];
  community: number[];
  dealerIndex: number;
  toActIndex: number | null;
  currentBet: number;
  minRaise: number;
  /** Spieler-IDs, die in dieser Setzrunde noch handeln müssen */
  needToAct: string[];
  /** Epoch-ms, bis wann der aktive Spieler handeln muss (für Countdown) */
  actionDeadline: number | null;
  handResult: HandResult | null;
  /** Epoch-ms, wann die nächste Hand automatisch startet */
  nextHandAt: number | null;
  log: LogEntry[];
  chat: ChatMessage[];
  winnerId: string | null;
  seq: number;
}

/** Redigierte Sicht: identisch, aber ohne Deck und mit ausgeblendeten Hole Cards. */
export type PokerView = Omit<PokerState, 'deck'>;

export type PokerAction =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  /** Erhöhen AUF den Gesamtbetrag dieser Setzrunde (Bet = Raise von 0) */
  | { type: 'raise'; to: number }
  | { type: 'allin' }
  | { type: 'rebuy' }
  | { type: 'nextHand' } // Host: Wartezeit nach Showdown überspringen
  | { type: 'resign' } // Spieler steigt endgültig aus
  | { type: 'removePlayer'; targetId: string } // Host
  | { type: 'endGame' }; // Host: Partie beenden (Cash-Game)

export interface PokerActionResult {
  ok: boolean;
  error?: string;
}
