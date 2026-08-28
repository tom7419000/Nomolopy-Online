/**
 * „X ist dran" – das breite Band über dem Spielfeld im lokalen Modus.
 *
 * Wenn vier Leute um ein Tablet sitzen, ist die häufigste Frage nicht, was
 * erlaubt ist, sondern wer gerade handeln darf. Online beantwortet das der
 * eigene Bildschirm; am geteilten Gerät braucht es eine Ansage, die niemand
 * übersehen kann – deshalb ein dauerhaftes Band statt eines Toasts.
 */

import { moduleFor } from '@shared/registry';
import { useStore, useSeatRotation } from '../state/store';

export function TurnBanner() {
  const isLocalGame = useStore((s) => s.session?.mode === 'local');
  const room = useStore((s) => s.room);
  // Bei festen Plätzen ist das Band die Ansage an eine bestimmte Person –
  // also dreht es sich zu ihr, genau wie das Brett darunter.
  const rotation = useSeatRotation();

  if (!isLocalGame || !room) return null;

  // Über die Registry, damit ein neues Spiel hier nicht stumm leer bleibt.
  const state = room[room.meta.gameId];
  const m = moduleFor(room.meta.gameId);
  const seat = state ? m.seats(state).find((p) => p.id === m.activeSeatId(state)) : undefined;
  const name = seat?.name ?? null;
  const color = seat?.color ?? 'var(--accent)';

  if (!name) return null;

  return (
    <div
      className="pass-banner"
      style={{ borderColor: color, transform: rotation ? `rotate(${rotation}deg)` : undefined }}
      role="status"
      aria-live="polite"
    >
      <span className="pass-banner-token" style={{ background: color }} aria-hidden />
      <strong>{name}</strong>
      <span>ist dran</span>
      <span className="pass-banner-pass" aria-hidden>
        {rotation ? '🪑 dein Platz' : '📱 weitergeben'}
      </span>
    </div>
  );
}
