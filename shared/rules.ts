import type { RulePreset, RuleSet } from './types';

export const CLASSIC_RULES: RuleSet = {
  startingMoney: 1500,
  goSalary: 200,
  freeParkingBonus: false,
  doubleRentFullGroup: true,
  // Vorgabe bewusst AUS: Auktionen sind zwar die Originalregel, aber der
  // Schalter soll bewusst umgelegt werden – so bleibt das Verhalten
  // bestehender Partien und Tests unverändert.
  auctionOnSkip: false,
  auctionBidSeconds: 30,
  jailFine: 50,
  maxJailTurns: 3,
  mortgageInterest: 0.1,
  houseLimit: 32,
  hotelLimit: 12,
  debugMode: false,
};

export const RULE_PRESETS: RulePreset[] = [
  {
    id: 'classic',
    name: 'Originalversion',
    description:
      'Die klassischen Regeln: 1.500 Startkapital, 200 Gehalt, kein Frei-Parken-Bonus – ' +
      'und ausgeschlagene Grundstücke kommen unter den Hammer.',
    rules: { ...CLASSIC_RULES, auctionOnSkip: true },
  },
  {
    id: 'fast',
    name: 'Schnelle Variante',
    description:
      'Mehr Startkapital (2.500), 300 Gehalt und Frei-Parken-Bonus – für kürzere Partien mit mehr Action.',
    rules: {
      ...CLASSIC_RULES,
      startingMoney: 2500,
      goSalary: 300,
      freeParkingBonus: true,
      auctionOnSkip: false,
    },
  },
  {
    id: 'hardcore',
    name: 'Hardcore',
    description:
      'Wenig Startkapital (1.000), hohe Gefängnisstrafe (100) – jede Miete tut weh.',
    rules: {
      ...CLASSIC_RULES,
      startingMoney: 1000,
      jailFine: 100,
      auctionOnSkip: true,
      auctionBidSeconds: 20,
    },
  },
];

export function getPreset(id: string): RulePreset {
  return RULE_PRESETS.find((p) => p.id === id) ?? RULE_PRESETS[0];
}

/** Für die Lobby: einstellbare Regeln mit Beschriftung. */
export const RULE_FIELDS: {
  key: keyof RuleSet;
  label: string;
  kind: 'number' | 'boolean';
  min?: number;
  max?: number;
  step?: number;
}[] = [
  { key: 'startingMoney', label: 'Startkapital', kind: 'number', min: 100, max: 10000, step: 100 },
  { key: 'goSalary', label: 'Gehalt über Los', kind: 'number', min: 0, max: 1000, step: 50 },
  { key: 'jailFine', label: 'Gefängnis-Kaution', kind: 'number', min: 0, max: 500, step: 10 },
  { key: 'freeParkingBonus', label: 'Frei-Parken-Bonus (Steuern in den Topf)', kind: 'boolean' },
  { key: 'doubleRentFullGroup', label: 'Doppelte Miete bei kompletter Farbgruppe', kind: 'boolean' },
  { key: 'auctionOnSkip', label: 'Ausgeschlagene Grundstücke versteigern (Originalregel)', kind: 'boolean' },
  { key: 'auctionBidSeconds', label: 'Bedenkzeit pro Gebot (Sek., 0 = keine)', kind: 'number', min: 0, max: 120, step: 5 },
  { key: 'debugMode', label: 'Debug-Modus (Würfel manuell setzbar)', kind: 'boolean' },
];
