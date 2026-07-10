/** Kleine Hilfsfunktionen ohne Abhängigkeiten (Client + Server). */

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ohne I/O/0/1 (Verwechslungsgefahr)

export function randomId(length = 12): string {
  let s = '';
  for (let i = 0; i < length; i++) {
    s += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
  }
  return s;
}

export function randomRoomCode(length = 5): string {
  let s = '';
  for (let i = 0; i < length; i++) {
    s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return s;
}

export function rollDie(): number {
  return 1 + Math.floor(Math.random() * 6);
}

export function shuffled<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 1.234 € / $1,234 – einfache Formatierung mit Währung der Edition. */
export function fmtMoney(amount: number, currency: string): string {
  const n = Math.round(amount);
  const formatted =
    currency === '$'
      ? n.toLocaleString('en-US')
      : n.toLocaleString('de-DE');
  return currency === '$' ? `$${formatted}` : `${formatted} ${currency}`;
}

export const PLAYER_COLORS = [
  '#e63946', // Rot
  '#2a9d8f', // Türkis
  '#4361ee', // Blau
  '#f4a261', // Orange
  '#9d4edd', // Violett
  '#2b9348', // Grün
  '#ff70a6', // Rosa
  '#ffd60a', // Gelb
];

export const PLAYER_TOKENS = ['🎩', '🚗', '🐕', '🚢', '👞', '🐈', '🛞', '💍'];

export const MAX_PLAYERS = 8;
export const MIN_PLAYERS = 2;
