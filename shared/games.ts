/**
 * Plattform-Ebene von PlayHub: Spiele-Katalog, Raum-Metadaten und die
 * Zustands-Hülle, die der Server an die Clients schickt. Jedes Spiel bringt
 * seine eigene Engine mit; die Plattform kennt nur Räume, Spieler und Chat.
 */

import type { GameState } from './types';
import type { PokerView } from './poker/types';

/**
 * Zustandstyp je Spiel – die EINE Stelle, an der die Spiele-Liste steht.
 *
 * `GameId` und `RoomEnvelope` leiten sich daraus ab. Ein neues Spiel wird
 * hier eingetragen, und der Compiler zeigt danach jede Stelle, die es noch
 * nicht kennt: jede `Record<GameId, …>`-Tabelle verlangt einen Eintrag.
 */
export interface GameStateMap {
  monopoly: GameState;
  poker: PokerView;
}

export type GameId = keyof GameStateMap;

/** Irgendeiner der Spielzustände – für Code, der alle Spiele gleich behandelt. */
export type AnyGameState = GameStateMap[GameId];

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

export const GAME_INFOS: Record<GameId, GameInfo> = {
  monopoly: {
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
  poker: {
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
};

/** Reihenfolge auf der Startseite. */
export const GAME_CATALOG: GameInfo[] = Object.values(GAME_INFOS);

/** Kann nicht mehr auf das falsche Spiel zurückfallen. */
export function getGameInfo(id: GameId): GameInfo {
  return GAME_INFOS[id];
}

/** Ist das eine bekannte Spiel-Kennung? (Eingaben vom Client prüfen) */
export function isGameId(v: unknown): v is GameId {
  return typeof v === 'string' && v in GAME_INFOS;
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
 *
 * Bewusst benannte Felder statt eines generischen `state: unknown`: so
 * behält der Client seine Typsicherheit pro Spiel. Über `GameStateMap`
 * wächst die Hülle automatisch mit, wenn ein Spiel dazukommt.
 */
export type RoomEnvelope = {
  meta: RoomMeta;
  spectators: SpectatorInfo[];
} & Partial<GameStateMap>;

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
