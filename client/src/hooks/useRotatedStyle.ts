/**
 * Drehung der Spielansicht für feste Sitzplätze.
 *
 * Gedreht wird bewusst nur das Spielfeld, nicht die App-Hülle. Alles
 * darüber – Toasts, Modale, Reconnect-Overlay, PWA-Leiste – ist
 * `position: fixed` und verlöre in einem transformierten Vorfahren seine
 * Verankerung; dazu lösen Viewport-Einheiten und `env(safe-area-inset-*)`
 * immer gegen den PHYSISCHEN Bildschirm auf, und Media Queries messen
 * dessen Breite. Ein Toast, der immer gleich steht, ist kein Verlust; ein
 * querliegender Modal-Hintergrund wäre einer.
 *
 * Das Brett selbst ist dagegen praktisch gratis drehbar: `aspect-ratio: 1`
 * (bei 90/180/270° identische Bounding-Box) und `container-type: inline-size`
 * (Transforms verändern das Layout nicht, alle `cqw`-Größen bleiben gültig).
 */

import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { useSeatRotation } from '../state/store';

/**
 * Liefert den Style für den Dreh-Container.
 *
 * Der Winkel wird AUFSUMMIERT geführt: von 270° auf 0° soll die Ansicht um
 * +90° weiterdrehen, nicht um −270° zurückrauschen.
 */
export function useRotatedStyle(): CSSProperties {
  const edge = useSeatRotation();
  const unwrapped = useRef(0);
  const last = useRef<number>(0);

  useEffect(() => {
    let delta = (edge - last.current) % 360;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    unwrapped.current += delta;
    last.current = edge;
  }, [edge]);

  // Beim ersten Rendern nach einem Wechsel liegt der Ref noch auf dem alten
  // Wert; die Differenz wird deshalb hier direkt mitgerechnet.
  let delta = (edge - last.current) % 360;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  const angle = unwrapped.current + delta;

  return { '--seat-rotation': `${angle}deg` } as CSSProperties;
}
