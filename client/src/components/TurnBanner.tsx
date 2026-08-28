/**
 * „X ist dran" – das breite Band über dem Spielfeld im lokalen Modus.
 *
 * Wenn vier Leute um ein Tablet sitzen, ist die häufigste Frage nicht, was
 * erlaubt ist, sondern wer gerade handeln darf. Online beantwortet das der
 * eigene Bildschirm; am geteilten Gerät braucht es eine Ansage, die niemand
 * übersehen kann – deshalb ein dauerhaftes Band statt eines Toasts.
 */

import { useStore } from '../state/store';

export function TurnBanner() {
  const isLocalGame = useStore((s) => s.session?.mode === 'local');
  const game = useStore((s) => s.game);
  const poker = useStore((s) => s.poker);

  if (!isLocalGame) return null;

  let name: string | null = null;
  let color = 'var(--accent)';
  let hint = '';

  if (game && game.phase === 'playing') {
    const p = game.players[game.currentPlayer];
    if (p) {
      name = p.name;
      color = p.color;
      hint = p.token;
    }
  } else if (poker && poker.phase === 'playing' && poker.toActIndex !== null) {
    const p = poker.players[poker.toActIndex];
    if (p) {
      name = p.name;
      color = p.color;
      hint = p.avatar;
    }
  }

  if (!name) return null;

  return (
    <div className="pass-banner" style={{ borderColor: color }} role="status" aria-live="polite">
      <span className="pass-banner-token" style={{ background: color }} aria-hidden>
        {hint}
      </span>
      <strong>{name}</strong>
      <span>ist dran</span>
      <span className="pass-banner-pass" aria-hidden>
        📱 weitergeben
      </span>
    </div>
  );
}
