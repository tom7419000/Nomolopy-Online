/**
 * Textvergleich für die Trivia-Spiele: normalisieren und Abstand messen.
 *
 * Warum das eine eigene Datei ist und nicht in `ask.ts` steht: `types.ts`
 * braucht `normalize`, um bei der Paket-Prüfung VERSCHIEDENE Antworten zu
 * zählen – und `ask.ts` importiert seinerseits aus `types.ts`. Ein Import
 * zurück wäre ein Zyklus. Also liegt der reine Textkram hier, ohne jede
 * Abhängigkeit, und beide dürfen ihn haben.
 */

/** Führende Artikel, die für die Bewertung keine Rolle spielen. */
const LEADING_ARTICLES = /^(der|die|das|den|dem|des|ein|eine|einen|einem|einer|eines)\s+/;

/**
 * Bringt eine Antwort auf eine Form, in der sich „Die Elbe", "elbe" und
 * „ELBE!" nicht mehr unterscheiden: Kleinschreibung, Diakritika weg,
 * Satzzeichen weg, führender Artikel weg, Leerraum normalisiert.
 */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    // Kombinierende Akzente entfernen (ä → a, é → e).
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(LEADING_ARTICLES, '')
    .trim();
}

/** Levenshtein-Distanz, abgebrochen sobald `max` überschritten ist. */
export function editDistance(a: string, b: string, max = 2): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      row.push(v);
      if (v < best) best = v;
    }
    // Ganze Zeile schon über der Grenze – es kann nur schlimmer werden.
    if (best > max) return max + 1;
    prev = row;
  }
  return prev[b.length];
}
