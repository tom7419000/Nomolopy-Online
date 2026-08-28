/**
 * Aktiver Transport der App.
 *
 * Bewusst ein eigenes, winziges Modul: sowohl `socket.ts` als auch `local.ts`
 * müssen den Modus lesen können, und über eine gemeinsame Datei ohne weitere
 * Importe entsteht dabei kein Zyklus.
 */

export type TransportMode = 'online' | 'local';

let current: TransportMode = 'online';

export function getMode(): TransportMode {
  return current;
}

export function setMode(mode: TransportMode): void {
  current = mode;
}

export function isLocal(): boolean {
  return current === 'local';
}
