/**
 * Die eigenen Handkarten – und der „gedrückt halten"-Knopf dazu.
 *
 * Online zeigt der eigene Bildschirm sie einfach an; niemand sonst sieht ihn.
 * Am gemeinsamen Gerät geht das nicht: Dort bleiben die Karten verdeckt, und
 * wer dran ist, hält kurz den Knopf. Loslassen deckt wieder zu, und jeder
 * Sitzwechsel schließt den Blick von selbst – sonst läge die Hand offen,
 * während das Tablet schon beim Nächsten ist.
 *
 * Der Blick ist eine Anzeige-Sperre, keine Sicherheitsgrenze: Die Karten des
 * aktiven Sitzes liegen ohnehin im Tab (`viewFor` deckt sie für ihn auf). Wer
 * die Entwicklerwerkzeuge öffnet, sieht sie – genau wie jemand, der am realen
 * Tisch dem Nachbarn auf die Hand schaut. Dagegen hilft kein Frontend.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { HIDDEN_CARD } from '@shared/poker/engine';
import type { PokerPlayer } from '@shared/poker/types';
import { PlayingCard } from './PlayingCard';

/** Notbremse: Bleibt ein „pointerup" aus (iOS verschluckt es gelegentlich), */
/** decken die Karten sich nach dieser Zeit von selbst wieder zu. */
const MAX_PEEK_MS = 10_000;

export interface Peek {
  peeking: boolean;
  start(): void;
  stop(): void;
}

/**
 * Der Blick-Zustand. Liegt in `PokerTable`, weil zwei Stellen ihn brauchen:
 * die großen Karten unten UND der eigene Sitz auf dem Filz.
 */
export function usePeek(seatId: string | undefined, street: string): Peek {
  const [peeking, setPeeking] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setPeeking(false);
  }, []);

  const start = useCallback(() => {
    setPeeking(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setPeeking(false), MAX_PEEK_MS);
  }, []);

  // Wandert das Gerät weiter oder beginnt eine neue Setzrunde: zudecken.
  useEffect(() => stop(), [seatId, street, stop]);

  // Weggewischt, Tab gewechselt, Bildschirm gesperrt: ebenfalls zudecken.
  useEffect(() => {
    if (!peeking) return;
    window.addEventListener('blur', stop);
    document.addEventListener('visibilitychange', stop);
    return () => {
      window.removeEventListener('blur', stop);
      document.removeEventListener('visibilitychange', stop);
    };
  }, [peeking, stop]);

  useEffect(() => () => stop(), [stop]);

  return { peeking, start, stop };
}

export function HoleCards({
  me,
  hint,
  local,
  peek,
}: {
  me: PokerPlayer;
  hint: string | null;
  local: boolean;
  peek: Peek;
}) {
  const cards = me.hole ?? [];
  const covered = local && !peek.peeking;
  const canPeek = local && cards.length > 0 && !me.folded && cards.some((c) => c !== HIDDEN_CARD);

  return (
    <div className="my-cards">
      {cards.map((c, i) => (
        <PlayingCard key={i} card={covered ? HIDDEN_CARD : c} size="lg" dimmed={me.folded} />
      ))}

      {canPeek && (
        <button
          className={`btn peek ${peek.peeking ? 'active' : ''}`}
          onPointerDown={(e) => {
            // Zeiger festhalten: sonst verliert ein leicht wandernder Finger
            // das „pointerup" und die Karten blieben offen liegen.
            e.currentTarget.setPointerCapture?.(e.pointerId);
            peek.start();
          }}
          onPointerUp={peek.stop}
          onPointerCancel={peek.stop}
          onLostPointerCapture={peek.stop}
          onContextMenu={(e) => e.preventDefault()}
          // Tastatur-Gleichwertigkeit (und damit im E2E-Test ansteuerbar)
          onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && peek.start()}
          onKeyUp={peek.stop}
          onBlur={peek.stop}
        >
          {peek.peeking ? '👀 loslassen zum Verdecken' : '🔍 Karten ansehen (halten)'}
        </button>
      )}

      {/* Der Handname verrät die Stärke – er muss mit den Karten verschwinden. */}
      {hint && !covered && <span className="hand-hint">{hint}</span>}
    </div>
  );
}
