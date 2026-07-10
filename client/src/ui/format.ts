import type { BoardEdition, GameState, TileDef, TurnPhase } from '@shared/types';
import { fmtMoney } from '@shared/util';

export function money(game: GameState | BoardEdition, amount: number): string {
  const currency = 'edition' in game ? game.edition.currency : game.currency;
  return fmtMoney(amount, currency);
}

export function tileIcon(tile: TileDef): string {
  switch (tile.type) {
    case 'go':
      return '➜';
    case 'jail':
      return '🚔';
    case 'freeparking':
      return '🅿️';
    case 'gotojail':
      return '👮';
    case 'railroad':
      return '🚂';
    case 'utility':
      return tile.id === 12 ? '💡' : '💧';
    case 'tax':
      return '💰';
    case 'chance':
      return '❓';
    case 'community':
      return '🎁';
    default:
      return '';
  }
}

export function phaseLabel(phase: TurnPhase, name: string, isMe: boolean): string {
  const who = isMe ? 'Du bist' : `${name} ist`;
  switch (phase) {
    case 'awaiting-roll':
      return `${who} am Zug – würfeln!`;
    case 'awaiting-buy':
      return isMe ? 'Kaufen oder passen?' : `${name} überlegt zu kaufen …`;
    case 'awaiting-card':
      return isMe ? 'Deine Karte!' : `${name} liest eine Karte …`;
    case 'awaiting-end':
      return isMe ? 'Freie Aktionen – dann Zug beenden.' : `${name} ist am Zug.`;
    case 'debt':
      return isMe ? 'Du musst Schulden begleichen!' : `${name} muss Geld beschaffen …`;
  }
}

export function timeHHMM(ts: number): string {
  return new Date(ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Weiche Trennstellen (Soft Hyphens) vor typischen deutschen
 * Kompositagliedern einfügen, damit lange Straßennamen auf den schmalen
 * Brettfeldern sauber umbrechen (RATHAUS-PLATZ statt RATHAUSPLAT-Z).
 */
const HYPHEN_POINTS =
  /(?=(straße|strasse|allee|platz|markt|damm|brücke|steuer|feld|werk|bahnhof|hof|kreuz|park|wall))/gi;

export function softHyphenate(name: string): string {
  return name.replace(HYPHEN_POINTS, '­');
}
