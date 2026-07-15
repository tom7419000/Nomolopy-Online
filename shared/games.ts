/**
 * Plattform-Ebene von PlayHub: Spiele-Katalog, Raum-Metadaten und die
 * Zustands-Hülle, die der Server an die Clients schickt. Jedes Spiel bringt
 * seine eigene Engine mit; die Plattform kennt nur Räume, Spieler und Chat.
 */

import type { GameState } from './types';
import type { PokerView } from './poker/types';

export type GameId = 'monopoly' | 'poker';

export interface GameInfo {
  id: GameId;
  name: string;
  tagline: string;
  description: string;
  emoji: string;
  minPlayers: number;
  maxPlayers: number;
  /** Ungefähre Spieldauer, nur für die Anzeige */
  duration: string;
}

export const GAME_CATALOG: GameInfo[] = [
  {
    id: 'monopoly',
    name: 'Monopoly',
    tagline: 'Würfeln, kaufen, bauen – wer bleibt zahlungsfähig?',
    description:
      'Das Brettspiel-Original mit Originalregeln: Grundstücke, Häuser & Hotels, Ereigniskarten, Hypotheken, Handel und Bankrott. Mit eigenen Editionen (Berlin, München, USA …).',
    emoji: '🎲',
    minPlayers: 2,
    maxPlayers: 8,
    duration: '45–120 min',
  },
  {
    id: 'poker',
    name: "Texas Hold'em Poker",
    tagline: 'Zwei Karten, fünf in der Mitte – wer blufft am besten?',
    description:
      'Klassisches No-Limit Texas Hold\'em: Small/Big Blind mit steigenden Stufen, Check/Bet/Call/Raise/Fold/All-In, Side-Pots und Showdown mit automatischer Hand-Bewertung.',
    emoji: '🃏',
    minPlayers: 2,
    maxPlayers: 9,
    duration: '20–90 min',
  },
];

export function getGameInfo(id: GameId): GameInfo {
  return GAME_CATALOG.find((g) => g.id === id) ?? GAME_CATALOG[0];
}

/** Raum-Metadaten, die unabhängig vom laufenden Spiel sind. */
export interface RoomMeta {
  code: string;
  name: string;
  description: string;
  gameId: GameId;
  isPublic: boolean;
  maxPlayers: number;
  createdAt: number;
}

/** Zuschauer sind Raum-Mitglieder ohne Sitz am Tisch (nur Poker). */
export interface SpectatorInfo {
  id: string;
  name: string;
  color: string;
}

/**
 * Die Hülle, die per 'state'-Event an Clients geht. Genau eines der
 * Spiel-Felder ist gesetzt (passend zu meta.gameId). Poker-Sichten sind
 * pro Empfänger redigiert.
 */
export interface RoomEnvelope {
  meta: RoomMeta;
  spectators: SpectatorInfo[];
  monopoly?: GameState;
  poker?: PokerView;
}

/** Eintrag in der öffentlichen Raumliste der Lobby. */
export interface PublicRoomInfo {
  code: string;
  name: string;
  gameId: GameId;
  hostName: string;
  playerCount: number;
  maxPlayers: number;
  phase: 'lobby' | 'playing' | 'ended';
  createdAt: number;
}

export interface LobbyChatMessage {
  id: number;
  time: number;
  name: string;
  color: string;
  text: string;
}

/** Obergrenze gleichzeitiger Räume (Schutz vor Missbrauch). */
export const MAX_ROOMS = 200;
export const MAX_ROOM_NAME = 40;
export const MAX_ROOM_DESC = 120;
