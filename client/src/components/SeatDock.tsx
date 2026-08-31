/**
 * Die Bedienung an der Tischkante dessen, der gerade dran ist – zu ihm
 * gedreht.
 *
 * Das ist das Bild, um das es geht: **ein Bildschirm liegt in der Tischmitte,
 * jeder schaut aus seiner Richtung darauf.** Das Spielfeld liegt und bleibt
 * liegen, wie ein echtes Brett. Was sich dreht, ist das, womit man hantiert –
 * Würfel, Knöpfe, Frage –, und es kommt dorthin, wo der Spieler sitzt, wie ein
 * Zettel, den man ihm hinschiebt.
 *
 * (Bis Schritt 6 war es genau andersherum: das Brett drehte sich und die
 * Bedienung blieb aufrecht. Das war falsch herum gedacht.)
 *
 * Ein `SeatDock` braucht einen Vorfahren mit `position: relative` – bei
 * Monopoly und Trivial Pursuit ist das der Spielbereich im Tischmodus.
 */

import { useState, type ReactNode } from 'react';
import { Modal } from './Modal';
import type { SeatEdge } from '../net/localRoom';

export function SeatDock({
  edge,
  place = 'center',
  className = '',
  children,
}: {
  edge: SeatEdge;
  /**
   * Wo an der Kante das Dock hängt.
   *
   * `center` – mittig. Richtig, wo unter dem Dock nichts Wichtiges liegt:
   *            bei Poker deckt es nur den eigenen Sitz ab.
   * `hand`   – am Ende der Kante, das zur RECHTEN HAND des Spielers liegt.
   *            Bei einem Brett ist das der Unterschied zwischen „mitten im
   *            Spielfeld" und „neben sich gelegt": die Brettmitte bleibt
   *            frei, verdeckt wird höchstens eine Ecke.
   */
  place?: 'center' | 'hand';
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`seat-dock place-${place} ${className}`} data-edge={edge}>
      {children}
    </div>
  );
}

/**
 * Verlauf und Chat im Tischmodus – hinter einem Knopf.
 *
 * Am Tisch zählt die Spielfläche; eine dauerhafte Seitenspalte fräße die
 * Hälfte davon. Der Dialog dreht sich bewusst NICHT mit: `position: fixed`
 * verliert seine Verankerung in einem gedrehten Vorfahren. Wer nachschaut,
 * lehnt sich hinüber.
 */
export function TableSideSheet({ title = 'Verlauf und Chat', children }: { title?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className="btn ghost small table-side-toggle"
        onClick={() => setOpen(true)}
        title={title}
        aria-label={title}
      >
        📜
      </button>
      {open && (
        <Modal title={title} onClose={() => setOpen(false)} wide>
          {children}
        </Modal>
      )}
    </>
  );
}
