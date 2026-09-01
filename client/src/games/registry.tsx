/**
 * Client-Registry: welche Oberfläche gehört zu welchem Spiel.
 *
 * Das Gegenstück zu `shared/registry.ts`. Auch hier ist der Typ
 * `Record<GameId, …>` das eigentliche Werkzeug: Sobald ein Spiel zur
 * `GameStateMap` kommt, meldet der Compiler an dieser Tabelle, dass
 * Bildschirm, Lobby-Einstellungen und Setup-Felder noch fehlen — statt dass
 * der bisherige Ternary (`game ? <GameTable/> : <PokerTable/>`) es stumm als
 * Poker gerendert hätte.
 */

import type { ComponentType } from 'react';
import type { AnyGameState, GameId } from '@shared/games';
import { GameTable } from './monopoly/GameTable';
import { PokerTable } from './poker/PokerTable';
import { JeopardyTable } from './jeopardy/JeopardyTable';
import { JeopardyLobbyTeams } from './jeopardy/LobbyTeams';
import { PursuitTable } from './pursuit/PursuitTable';
import {
  MonopolySettings,
  PokerSettings,
  JeopardySettings,
  PursuitSettings,
} from '../pages/lobbySettings';
import {
  MonopolyCreateFields,
  PokerCreateFields,
  JeopardyCreateFields,
  PursuitCreateFields,
} from '../pages/createFields';
import { monopolyNotify } from './monopoly/notify';
import { jeopardyNotify } from './jeopardy/notify';
import { pursuitNotify } from './pursuit/notify';

/** Kontext für spielspezifische Hinweise beim Zustandswechsel. */
export interface NotifyContext {
  /** Wessen Sicht das ist (im lokalen Modus der gerade handelnde Sitz). */
  playerId: string;
  local: boolean;
  toast(kind: 'info' | 'error' | 'success' | 'turn', text: string): void;
}

export interface ClientGame {
  /** Der Spieltisch, sobald die Partie läuft. */
  Table: ComponentType;
  /** Einstellungen im Wartezimmer (nur online). */
  LobbySettings: ComponentType<{ isHost: boolean }>;
  /**
   * Optionaler Block unter der Spielerliste im Wartezimmer.
   *
   * Anders als `LobbySettings` NICHT host-gesperrt: Jeopardys Teams sucht
   * sich jeder selbst aus. Ohne diesen Steckplatz hätte `Room.tsx` wieder
   * Jeopardy-Wissen bekommen, das die Registry gerade abschaffen soll.
   */
  LobbyExtras?: ComponentType;
  /** Felder im „Raum erstellen"- und im lokalen Setup-Dialog. */
  CreateFields: ComponentType<CreateFieldsProps>;
  /**
   * Optionale Hinweise, die nur dieses Spiel kennt (Handelsangebot,
   * überboten …). Der „du bist dran"-Hinweis kommt generisch aus dem Store.
   */
  notify?(prev: AnyGameState | null, next: AnyGameState, ctx: NotifyContext): void;
}

export interface CreateFieldsProps {
  editionId: string;
  setEditionId(v: string): void;
  presetId: string;
  setPresetId(v: string): void;
  poker: Record<string, unknown>;
  setPoker(v: Record<string, unknown>): void;
  jeopardy: Record<string, unknown>;
  setJeopardy(v: Record<string, unknown>): void;
  pursuit: Record<string, unknown>;
  setPursuit(v: Record<string, unknown>): void;
  /** Lokal gibt es keine Bedenkzeit – das Feld entfällt dort. */
  local?: boolean;
}

export const CLIENT_GAMES: Record<GameId, ClientGame> = {
  monopoly: {
    Table: GameTable,
    LobbySettings: MonopolySettings,
    CreateFields: MonopolyCreateFields,
    notify: monopolyNotify,
  },
  poker: {
    Table: PokerTable,
    LobbySettings: PokerSettings,
    CreateFields: PokerCreateFields,
  },
  jeopardy: {
    Table: JeopardyTable,
    LobbySettings: JeopardySettings,
    LobbyExtras: JeopardyLobbyTeams,
    CreateFields: JeopardyCreateFields,
    notify: jeopardyNotify,
  },
  pursuit: {
    Table: PursuitTable,
    LobbySettings: PursuitSettings,
    CreateFields: PursuitCreateFields,
    notify: pursuitNotify,
  },
};
