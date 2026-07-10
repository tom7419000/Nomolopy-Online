import type { BoardEdition, GroupId, TileDef, TileType } from './types';

/**
 * Klassisches Monopoly-Layout: Feldtypen, Preise und Mieten sind für alle
 * Editionen identisch – Editionen unterscheiden sich in Namen, Farben,
 * Währung und Grafiken (im Admin-Panel anpassbar).
 */

interface StructEntry {
  type: TileType;
  group?: GroupId;
  price?: number;
  rent?: number[];
  houseCost?: number;
  tax?: number;
}

const S = (group: GroupId, price: number, rent: number[], houseCost: number): StructEntry => ({
  type: 'street',
  group,
  price,
  rent,
  houseCost,
});

/** Feldstruktur 0..39 (klassische Preise der deutschen Ausgabe) */
export const BOARD_STRUCTURE: StructEntry[] = [
  { type: 'go' }, // 0
  S('brown', 60, [2, 10, 30, 90, 160, 250], 50), // 1
  { type: 'community' }, // 2
  S('brown', 60, [4, 20, 60, 180, 320, 450], 50), // 3
  { type: 'tax', tax: 200 }, // 4
  { type: 'railroad', price: 200, rent: [25, 50, 100, 200] }, // 5
  S('lightblue', 100, [6, 30, 90, 270, 400, 550], 50), // 6
  { type: 'chance' }, // 7
  S('lightblue', 100, [6, 30, 90, 270, 400, 550], 50), // 8
  S('lightblue', 120, [8, 40, 100, 300, 450, 600], 50), // 9
  { type: 'jail' }, // 10
  S('pink', 140, [10, 50, 150, 450, 625, 750], 100), // 11
  { type: 'utility', price: 150, rent: [4, 10] }, // 12
  S('pink', 140, [10, 50, 150, 450, 625, 750], 100), // 13
  S('pink', 160, [12, 60, 180, 500, 700, 900], 100), // 14
  { type: 'railroad', price: 200, rent: [25, 50, 100, 200] }, // 15
  S('orange', 180, [14, 70, 200, 550, 750, 950], 100), // 16
  { type: 'community' }, // 17
  S('orange', 180, [14, 70, 200, 550, 750, 950], 100), // 18
  S('orange', 200, [16, 80, 220, 600, 800, 1000], 100), // 19
  { type: 'freeparking' }, // 20
  S('red', 220, [18, 90, 250, 700, 875, 1050], 150), // 21
  { type: 'chance' }, // 22
  S('red', 220, [18, 90, 250, 700, 875, 1050], 150), // 23
  S('red', 240, [20, 100, 300, 750, 925, 1100], 150), // 24
  { type: 'railroad', price: 200, rent: [25, 50, 100, 200] }, // 25
  S('yellow', 260, [22, 110, 330, 800, 975, 1150], 150), // 26
  S('yellow', 260, [22, 110, 330, 800, 975, 1150], 150), // 27
  { type: 'utility', price: 150, rent: [4, 10] }, // 28
  S('yellow', 280, [24, 120, 360, 850, 1025, 1200], 150), // 29
  { type: 'gotojail' }, // 30
  S('green', 300, [26, 130, 390, 900, 1100, 1275], 200), // 31
  S('green', 300, [26, 130, 390, 900, 1100, 1275], 200), // 32
  { type: 'community' }, // 33
  S('green', 320, [28, 150, 450, 1000, 1200, 1400], 200), // 34
  { type: 'railroad', price: 200, rent: [25, 50, 100, 200] }, // 35
  { type: 'chance' }, // 36
  S('darkblue', 350, [35, 175, 500, 1100, 1300, 1500], 200), // 37
  { type: 'tax', tax: 100 }, // 38
  S('darkblue', 400, [50, 200, 600, 1400, 1700, 2000], 200), // 39
];

export const CLASSIC_GROUP_COLORS: Record<GroupId, string> = {
  brown: '#955436',
  lightblue: '#aae0fa',
  pink: '#d93a96',
  orange: '#f7941d',
  red: '#ed1b24',
  yellow: '#fef200',
  green: '#1fb25a',
  darkblue: '#0072bb',
};

/**
 * Namenssatz einer Edition: Index = Feldposition.
 * Sonderfelder (Los, Gefängnis, …) sind ebenfalls benannt, damit Editionen
 * auch dort eigene Begriffe verwenden können (z. B. Englisch).
 */
function buildTiles(names: string[]): TileDef[] {
  return BOARD_STRUCTURE.map((s, i) => ({ id: i, name: names[i], ...s }));
}

const DE_SPECIALS = {
  go: 'Los',
  community: 'Gemeinschaftsfeld',
  chance: 'Ereignisfeld',
  incomeTax: 'Einkommensteuer',
  luxuryTax: 'Zusatzsteuer',
  jail: 'Gefängnis – Nur zu Besuch',
  freeparking: 'Frei Parken',
  gotojail: 'Gehen Sie ins Gefängnis',
  electric: 'Elektrizitätswerk',
  water: 'Wasserwerk',
};

function deNames(
  streets: Record<number, string>,
  railroads: [string, string, string, string]
): string[] {
  const n: string[] = [];
  const rr = [...railroads];
  for (let i = 0; i < 40; i++) {
    const s = BOARD_STRUCTURE[i];
    switch (s.type) {
      case 'go':
        n.push(DE_SPECIALS.go);
        break;
      case 'community':
        n.push(DE_SPECIALS.community);
        break;
      case 'chance':
        n.push(DE_SPECIALS.chance);
        break;
      case 'tax':
        n.push(i === 4 ? DE_SPECIALS.incomeTax : DE_SPECIALS.luxuryTax);
        break;
      case 'jail':
        n.push(DE_SPECIALS.jail);
        break;
      case 'freeparking':
        n.push(DE_SPECIALS.freeparking);
        break;
      case 'gotojail':
        n.push(DE_SPECIALS.gotojail);
        break;
      case 'railroad':
        n.push(rr.shift() ?? 'Bahnhof');
        break;
      case 'utility':
        n.push(i === 12 ? DE_SPECIALS.electric : DE_SPECIALS.water);
        break;
      case 'street':
        n.push(streets[i] ?? `Straße ${i}`);
        break;
    }
  }
  return n;
}

const CLASSIC_STREETS: Record<number, string> = {
  1: 'Badstraße',
  3: 'Turmstraße',
  6: 'Chausseestraße',
  8: 'Elisenstraße',
  9: 'Poststraße',
  11: 'Seestraße',
  13: 'Hafenstraße',
  14: 'Neue Straße',
  16: 'Münchner Straße',
  18: 'Wiener Straße',
  19: 'Berliner Straße',
  21: 'Theaterstraße',
  23: 'Museumstraße',
  24: 'Opernplatz',
  26: 'Lessingstraße',
  27: 'Schillerstraße',
  29: 'Goethestraße',
  31: 'Rathausplatz',
  32: 'Hauptstraße',
  34: 'Bahnhofstraße',
  37: 'Parkstraße',
  39: 'Schlossallee',
};

const BERLIN_STREETS: Record<number, string> = {
  1: 'Skalitzer Straße',
  3: 'Wrangelstraße',
  6: 'Müllerstraße',
  8: 'Badstraße',
  9: 'Seestraße',
  11: 'Karl-Marx-Allee',
  13: 'Frankfurter Allee',
  14: 'Warschauer Straße',
  16: 'Schönhauser Allee',
  18: 'Prenzlauer Allee',
  19: 'Kastanienallee',
  21: 'Oranienstraße',
  23: 'Bergmannstraße',
  24: 'Mehringdamm',
  26: 'Friedrichstraße',
  27: 'Leipziger Straße',
  29: 'Potsdamer Platz',
  31: 'Alexanderplatz',
  32: 'Unter den Linden',
  34: 'Tauentzienstraße',
  37: 'Kurfürstendamm',
  39: 'Pariser Platz',
};

const MUENCHEN_STREETS: Record<number, string> = {
  1: 'Landsberger Straße',
  3: 'Schleißheimer Straße',
  6: 'Rosenheimer Straße',
  8: 'Lindwurmstraße',
  9: 'Nymphenburger Straße',
  11: 'Schwanthalerstraße',
  13: 'Isartorplatz',
  14: 'Sendlinger Straße',
  16: 'Hohenzollernstraße',
  18: 'Türkenstraße',
  19: 'Leopoldstraße',
  21: 'Gärtnerplatz',
  23: 'Viktualienmarkt',
  24: 'Odeonsplatz',
  26: 'Kaufingerstraße',
  27: 'Theatinerstraße',
  29: 'Karlsplatz (Stachus)',
  31: 'Promenadeplatz',
  32: 'Residenzstraße',
  34: 'Maximilianstraße',
  37: 'Königsplatz',
  39: 'Marienplatz',
};

const USA_NAMES: string[] = (() => {
  const streets: Record<number, string> = {
    1: 'Mediterranean Avenue',
    3: 'Baltic Avenue',
    6: 'Oriental Avenue',
    8: 'Vermont Avenue',
    9: 'Connecticut Avenue',
    11: 'St. Charles Place',
    13: 'States Avenue',
    14: 'Virginia Avenue',
    16: 'St. James Place',
    18: 'Tennessee Avenue',
    19: 'New York Avenue',
    21: 'Kentucky Avenue',
    23: 'Indiana Avenue',
    24: 'Illinois Avenue',
    26: 'Atlantic Avenue',
    27: 'Ventnor Avenue',
    29: 'Marvin Gardens',
    31: 'Pacific Avenue',
    32: 'North Carolina Avenue',
    34: 'Pennsylvania Avenue',
    37: 'Park Place',
    39: 'Boardwalk',
  };
  const rr = ['Reading Railroad', 'Pennsylvania Railroad', 'B. & O. Railroad', 'Short Line'];
  const n: string[] = [];
  for (let i = 0; i < 40; i++) {
    const s = BOARD_STRUCTURE[i];
    switch (s.type) {
      case 'go':
        n.push('GO');
        break;
      case 'community':
        n.push('Community Chest');
        break;
      case 'chance':
        n.push('Chance');
        break;
      case 'tax':
        n.push(i === 4 ? 'Income Tax' : 'Luxury Tax');
        break;
      case 'jail':
        n.push('Jail – Just Visiting');
        break;
      case 'freeparking':
        n.push('Free Parking');
        break;
      case 'gotojail':
        n.push('Go To Jail');
        break;
      case 'railroad':
        n.push(rr.shift() ?? 'Railroad');
        break;
      case 'utility':
        n.push(i === 12 ? 'Electric Company' : 'Water Works');
        break;
      case 'street':
        n.push(streets[i]);
        break;
    }
  }
  return n;
})();

export const BUILT_IN_EDITIONS: BoardEdition[] = [
  {
    id: 'classic-de',
    name: 'Klassisch (Deutschland)',
    description: 'Die klassische deutsche Ausgabe – von der Badstraße bis zur Schlossallee.',
    builtIn: true,
    currency: '€',
    boardColor: '#cfe5cd',
    groupColors: { ...CLASSIC_GROUP_COLORS },
    tiles: buildTiles(
      deNames(CLASSIC_STREETS, ['Südbahnhof', 'Westbahnhof', 'Nordbahnhof', 'Hauptbahnhof'])
    ),
  },
  {
    id: 'berlin',
    name: 'Berlin',
    description: 'Hauptstadt-Edition: vom Kreuzberger Kiez bis zum Pariser Platz.',
    builtIn: true,
    currency: '€',
    boardColor: '#dbe7f2',
    groupColors: { ...CLASSIC_GROUP_COLORS, darkblue: '#1d3f8f', red: '#d0021b' },
    tiles: buildTiles(
      deNames(BERLIN_STREETS, ['Bahnhof Zoo', 'Ostbahnhof', 'Südkreuz', 'Hauptbahnhof'])
    ),
  },
  {
    id: 'muenchen',
    name: 'München',
    description: 'Weißwurst-Edition: von der Landsberger Straße bis zum Marienplatz.',
    builtIn: true,
    currency: '€',
    boardColor: '#e8e2f4',
    groupColors: { ...CLASSIC_GROUP_COLORS, lightblue: '#9cc3e5', darkblue: '#005baa' },
    tiles: buildTiles(
      deNames(MUENCHEN_STREETS, [
        'Ostbahnhof',
        'Bahnhof Pasing',
        'Donnersbergerbrücke',
        'Hauptbahnhof',
      ])
    ),
  },
  {
    id: 'usa',
    name: 'USA (Atlantic City)',
    description: 'Das amerikanische Original von 1935 – from Mediterranean Avenue to Boardwalk.',
    builtIn: true,
    currency: '$',
    boardColor: '#cde6c7',
    groupColors: { ...CLASSIC_GROUP_COLORS },
    tiles: buildTiles(USA_NAMES),
  },
];

export const GROUP_ORDER: GroupId[] = [
  'brown',
  'lightblue',
  'pink',
  'orange',
  'red',
  'yellow',
  'green',
  'darkblue',
];

export const GROUP_LABELS: Record<GroupId, string> = {
  brown: 'Braun',
  lightblue: 'Hellblau',
  pink: 'Pink',
  orange: 'Orange',
  red: 'Rot',
  yellow: 'Gelb',
  green: 'Grün',
  darkblue: 'Dunkelblau',
};
