import type { BoardEdition, Card } from './types';

/**
 * Vereinfachte Ereignis- und Gemeinschaftskarten: Geldbeträge und einfache
 * Effekte. Texte können {tile:N}-Platzhalter enthalten, die zur Anzeige mit
 * dem Feldnamen der aktiven Edition ersetzt werden.
 */

export const CHANCE_CARDS: Card[] = [
  { id: 'ch-go', deck: 'chance', text: 'Rücke vor bis auf {tile:0}. Kassiere das Gehalt!', effect: { kind: 'moveTo', tile: 0, collectGo: true } },
  { id: 'ch-jail', deck: 'chance', text: 'Gehe in das Gefängnis! Gehe nicht über {tile:0}.', effect: { kind: 'gotojail' } },
  { id: 'ch-dividend', deck: 'chance', text: 'Die Bank zahlt dir eine Dividende von 50.', effect: { kind: 'money', amount: 50 } },
  { id: 'ch-speeding', deck: 'chance', text: 'Strafe für zu schnelles Fahren: Zahle 15.', effect: { kind: 'money', amount: -15 } },
  { id: 'ch-boardwalk', deck: 'chance', text: 'Rücke vor bis {tile:39}.', effect: { kind: 'moveTo', tile: 39, collectGo: false } },
  { id: 'ch-pink', deck: 'chance', text: 'Rücke vor bis {tile:11}. Wenn du über {tile:0} kommst, kassiere das Gehalt.', effect: { kind: 'moveTo', tile: 11, collectGo: true } },
  { id: 'ch-back3', deck: 'chance', text: 'Gehe 3 Felder zurück.', effect: { kind: 'moveBy', steps: -3 } },
  { id: 'ch-jailfree', deck: 'chance', text: 'Du kommst aus dem Gefängnis frei! Diese Karte kannst du behalten.', effect: { kind: 'jailFree' } },
  { id: 'ch-repairs', deck: 'chance', text: 'Lasse deine Gebäude renovieren: Zahle 25 pro Haus und 100 pro Hotel.', effect: { kind: 'perHouse', house: 25, hotel: 100 } },
  { id: 'ch-school', deck: 'chance', text: 'Zahle Schulgeld: 150.', effect: { kind: 'money', amount: -150 } },
  { id: 'ch-crossword', deck: 'chance', text: 'Du gewinnst einen Kreuzworträtsel-Wettbewerb: Kassiere 100.', effect: { kind: 'money', amount: 100 } },
  { id: 'ch-red', deck: 'chance', text: 'Rücke vor bis {tile:24}. Wenn du über {tile:0} kommst, kassiere das Gehalt.', effect: { kind: 'moveTo', tile: 24, collectGo: true } },
  { id: 'ch-building-loan', deck: 'chance', text: 'Dein Bausparvertrag wird fällig: Kassiere 150.', effect: { kind: 'money', amount: 150 } },
  { id: 'ch-chairman', deck: 'chance', text: 'Du wurdest zum Vorstand gewählt: Zahle jedem Spieler 50.', effect: { kind: 'payToEach', amount: 50 } },
];

export const COMMUNITY_CARDS: Card[] = [
  { id: 'cc-go', deck: 'community', text: 'Rücke vor bis auf {tile:0}. Kassiere das Gehalt!', effect: { kind: 'moveTo', tile: 0, collectGo: true } },
  { id: 'cc-bank-error', deck: 'community', text: 'Bank-Irrtum zu deinen Gunsten: Kassiere 200.', effect: { kind: 'money', amount: 200 } },
  { id: 'cc-doctor', deck: 'community', text: 'Arztkosten: Zahle 50.', effect: { kind: 'money', amount: -50 } },
  { id: 'cc-tax-refund', deck: 'community', text: 'Steuerrückzahlung: Kassiere 20.', effect: { kind: 'money', amount: 20 } },
  { id: 'cc-birthday', deck: 'community', text: 'Du hast Geburtstag! Jeder Spieler schenkt dir 10.', effect: { kind: 'collectFromEach', amount: 10 } },
  { id: 'cc-inheritance', deck: 'community', text: 'Du erbst 100.', effect: { kind: 'money', amount: 100 } },
  { id: 'cc-hospital', deck: 'community', text: 'Krankenhauskosten: Zahle 100.', effect: { kind: 'money', amount: -100 } },
  { id: 'cc-jail', deck: 'community', text: 'Gehe in das Gefängnis! Gehe nicht über {tile:0}.', effect: { kind: 'gotojail' } },
  { id: 'cc-jailfree', deck: 'community', text: 'Du kommst aus dem Gefängnis frei! Diese Karte kannst du behalten.', effect: { kind: 'jailFree' } },
  { id: 'cc-stocks', deck: 'community', text: 'Aus dem Verkauf deiner Aktien erhältst du 50.', effect: { kind: 'money', amount: 50 } },
  { id: 'cc-insurance', deck: 'community', text: 'Zahle deine Versicherungsprämie: 50.', effect: { kind: 'money', amount: -50 } },
  { id: 'cc-repairs', deck: 'community', text: 'Straßenausbesserungsarbeiten: Zahle 40 je Haus und 115 je Hotel.', effect: { kind: 'perHouse', house: 40, hotel: 115 } },
  { id: 'cc-beauty', deck: 'community', text: 'Du gewinnst den zweiten Preis in einem Schönheitswettbewerb: Kassiere 10.', effect: { kind: 'money', amount: 10 } },
  { id: 'cc-interest', deck: 'community', text: 'Zinsen aus Sparguthaben: Kassiere 25.', effect: { kind: 'money', amount: 25 } },
];

/** Ersetzt {tile:N}-Platzhalter durch die Feldnamen der Edition. */
export function cardText(card: Card, edition: BoardEdition): string {
  return card.text.replace(/\{tile:(\d+)\}/g, (_, n) => {
    const tile = edition.tiles[Number(n)];
    return tile ? tile.name : `Feld ${n}`;
  });
}

export function getCard(deck: 'chance' | 'community', index: number): Card {
  return deck === 'chance' ? CHANCE_CARDS[index] : COMMUNITY_CARDS[index];
}
