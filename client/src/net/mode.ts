/**
 * Aktiver Transport der App.
 *
 * Bewusst ein eigenes, winziges Modul: sowohl `socket.ts` als auch `local.ts`
 * müssen den Modus lesen können, und über eine gemeinsame Datei ohne weitere
 * Importe entsteht dabei kein Zyklus.
 */

export type TransportMode = 'online' | 'local';

/** Schlüssel des gespeicherten lokalen Spielstands (siehe `local.ts`). */
export const LOCAL_GAME_KEY = 'playhub.local';

/**
 * Liegt ein lokaler Spielstand vor? Wird beim Modulstart gelesen, noch bevor
 * die Socket-Verbindung aufgebaut wird – wer eine lokale Partie fortsetzt,
 * soll gar nicht erst am Server anklopfen. Ohne Netz (Flugmodus, Zug) wären
 * das sonst endlose Verbindungsversuche im Hintergrund.
 */
function hasStoredLocalGame(): boolean {
  try {
    return localStorage.getItem(LOCAL_GAME_KEY) !== null;
  } catch {
    return false;
  }
}

let current: TransportMode = hasStoredLocalGame() ? 'local' : 'online';

export function getMode(): TransportMode {
  return current;
}

export function setMode(mode: TransportMode): void {
  current = mode;
}

export function isLocal(): boolean {
  return current === 'local';
}
