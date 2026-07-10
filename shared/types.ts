/**
 * Gemeinsame Typdefinitionen für Client, Server und Engine.
 * Der komplette Spielzustand ist ein reines JSON-Objekt (serialisierbar),
 * damit er 1:1 über Socket.io synchronisiert und als Spielstand gespeichert
 * werden kann.
 */

export type GroupId =
  | 'brown'
  | 'lightblue'
  | 'pink'
  | 'orange'
  | 'red'
  | 'yellow'
  | 'green'
  | 'darkblue';

export type TileType =
  | 'go'
  | 'jail'
  | 'freeparking'
  | 'gotojail'
  | 'street'
  | 'railroad'
  | 'utility'
  | 'tax'
  | 'chance'
  | 'community';

export interface TileDef {
  id: number; // Position 0..39, 0 = Los
  type: TileType;
  name: string;
  group?: GroupId; // nur Straßen
  price?: number; // Straße / Bahnhof / Werk
  /**
   * Straßen: [Grundmiete, 1 Haus, 2, 3, 4 Häuser, Hotel]
   * Bahnhöfe: [1, 2, 3, 4 Bahnhöfe im Besitz]
   * Werke:    [Multiplikator bei 1 Werk, bei 2 Werken] (× Augenzahl)
   */
  rent?: number[];
  houseCost?: number; // Straßen
  tax?: number; // Steuerfelder
  image?: string; // optionale Grafik (Data-URL), im Admin-Panel konfigurierbar
}

export interface BoardEdition {
  id: string;
  name: string;
  description?: string;
  builtIn: boolean;
  currency: string; // z. B. "€" oder "$"
  boardColor: string; // Grundfarbe des Bretts
  centerImage?: string; // optionales Logo/Bild in der Brettmitte (Data-URL)
  groupColors: Record<GroupId, string>;
  tiles: TileDef[]; // genau 40 Felder
}

export interface RuleSet {
  startingMoney: number;
  goSalary: number;
  /** Steuern/Strafen wandern in den Frei-Parken-Topf und werden dort kassiert */
  freeParkingBonus: boolean;
  /** Doppelte Grundmiete bei vollständiger, unbebauter Farbgruppe */
  doubleRentFullGroup: boolean;
  jailFine: number;
  maxJailTurns: number;
  /** Zinsaufschlag beim Aufheben einer Hypothek (z. B. 0.1 = 10 %) */
  mortgageInterest: number;
  houseLimit: number; // Häuservorrat der Bank
  hotelLimit: number; // Hotelvorrat der Bank
  /** Debug-Modus: Würfel setzbar, für Tests */
  debugMode: boolean;
}

export interface RulePreset {
  id: string;
  name: string;
  description: string;
  rules: RuleSet;
}

export type CardEffect =
  | { kind: 'money'; amount: number } // positiv = erhalten, negativ = zahlen
  | { kind: 'moveTo'; tile: number; collectGo: boolean }
  | { kind: 'moveBy'; steps: number }
  | { kind: 'gotojail' }
  | { kind: 'jailFree' }
  | { kind: 'perHouse'; house: number; hotel: number } // Reparaturen (zahlen)
  | { kind: 'collectFromEach'; amount: number }
  | { kind: 'payToEach'; amount: number };

export interface Card {
  id: string;
  deck: 'chance' | 'community';
  /** Text kann Platzhalter {tile:N} enthalten, der mit dem Editionsnamen des Feldes N ersetzt wird */
  text: string;
  effect: CardEffect;
}

export interface Player {
  id: string;
  name: string;
  color: string;
  token: string; // Spielfigur (Emoji)
  money: number;
  position: number; // 0..39
  inJail: boolean;
  jailTurns: number;
  jailCards: number; // "Du kommst aus dem Gefängnis frei"-Karten
  bankrupt: boolean;
  connected: boolean;
  isHost: boolean;
}

export interface PropertyState {
  ownerId: string | null;
  /** 0–4 = Häuser, 5 = Hotel */
  houses: number;
  mortgaged: boolean;
}

export type GamePhase = 'lobby' | 'playing' | 'ended';

export type TurnPhase =
  | 'awaiting-roll' // aktueller Spieler muss würfeln
  | 'awaiting-buy' // Kaufentscheidung für das Feld, auf dem er steht
  | 'awaiting-card' // gezogene Karte muss bestätigt werden
  | 'awaiting-end' // freie Aktionen (bauen, handeln, …), dann Zug beenden
  | 'debt'; // Spieler muss Schulden begleichen oder Bankrott erklären

export interface PendingCard {
  card: Card;
  playerId: string;
}

export interface Debt {
  playerId: string;
  amount: number;
  creditorId: string | null; // null = Bank
  reason: string;
  /** Fortsetzung nach Bezahlung (z. B. Gefängnis verlassen und ziehen) */
  then?: { kind: 'jailRelease'; total: number };
}

export interface TradeOffer {
  id: string;
  fromId: string;
  toId: string;
  offerMoney: number;
  offerProps: number[]; // Feld-IDs
  requestMoney: number;
  requestProps: number[];
}

export type LogKind = 'info' | 'move' | 'money' | 'card' | 'trade' | 'system' | 'chat-hint';

export interface LogEntry {
  id: number;
  time: number;
  kind: LogKind;
  text: string;
  playerId?: string;
}

export interface ChatMessage {
  id: number;
  time: number;
  playerId: string;
  name: string;
  color: string;
  text: string;
}

export interface GameState {
  id: string; // Raum-Code
  createdAt: number;
  phase: GamePhase;
  rules: RuleSet;
  presetId: string;
  edition: BoardEdition; // eingebettete Kopie → Spielstände sind autark
  players: Player[]; // Reihenfolge = Zugreihenfolge
  currentPlayer: number; // Index in players
  turnPhase: TurnPhase;
  turnCount: number;
  dice: [number, number] | null;
  /** Anzahl aufeinanderfolgender Päsche des aktuellen Spielers */
  doubles: number;
  /** Debug: nächster Wurf (wird von 'roll' konsumiert) */
  nextDice: [number, number] | null;
  properties: Record<number, PropertyState>;
  /** Kartendecks als Index-Listen (oberste Karte vorn), zyklisch */
  chanceDeck: number[];
  communityDeck: number[];
  pendingCard: PendingCard | null;
  debt: Debt | null;
  trade: TradeOffer | null;
  freeParkingPot: number;
  bankHouses: number;
  bankHotels: number;
  log: LogEntry[];
  chat: ChatMessage[];
  winnerId: string | null;
  seq: number; // fortlaufende Nummer für Log/Chat-IDs
}

/** Aktionen, die Spieler an die Engine schicken (Server validiert alles). */
export type GameAction =
  | { type: 'roll' }
  | { type: 'buy' }
  | { type: 'skipBuy' }
  | { type: 'endTurn' }
  | { type: 'payJail' }
  | { type: 'useJailCard' }
  | { type: 'ackCard' }
  | { type: 'build'; tileId: number }
  | { type: 'sellHouse'; tileId: number }
  | { type: 'mortgage'; tileId: number }
  | { type: 'unmortgage'; tileId: number }
  | { type: 'payDebt' }
  | { type: 'declareBankruptcy' }
  | { type: 'resign' }
  | {
      type: 'proposeTrade';
      to: string;
      offerMoney: number;
      offerProps: number[];
      requestMoney: number;
      requestProps: number[];
    }
  | { type: 'respondTrade'; accept: boolean }
  | { type: 'cancelTrade' }
  | { type: 'setDice'; dice: [number, number] } // nur debugMode
  | { type: 'forceEndTurn' } // Host: Zug eines getrennten Spielers abschließen
  | { type: 'removePlayer'; targetId: string }; // Host

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export interface SaveGameMeta {
  id: string;
  name: string;
  savedAt: number;
  players: string[];
  editionName: string;
  turnCount: number;
  phase: GamePhase;
}
