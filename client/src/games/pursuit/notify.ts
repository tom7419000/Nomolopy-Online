/**
 * Hinweise, die nur Trivial Pursuit kennt.
 *
 * Der generische „du bist dran"-Hinweis aus dem Store greift beim Werten und
 * beim Wählen der Schlussfrage-Farbe nicht: dort handeln alle AUSSER einem,
 * `activeSeatId` ist also `null` – und genau da muss am Handy etwas passieren.
 */

import type { AnyGameState } from '@shared/games';
import type { PursuitView } from '@shared/pursuit/types';
import type { NotifyContext } from '../registry';

export function pursuitNotify(
  prevAny: AnyGameState | null,
  nextAny: AnyGameState,
  ctx: NotifyContext
): void {
  const prev = prevAny as PursuitView | null;
  const next = nextAny as PursuitView;
  // Am gemeinsamen Gerät steht alles groß auf dem Bildschirm – Hinweise wären
  // dort nur Flackern.
  if (ctx.local) return;
  // Der große Bildschirm ist Zuschauer und hat weder Stimme noch Würfel.
  if (!next.players.some((p) => p.id === ctx.playerId)) return;

  const current = next.players[next.currentPlayer];
  if (current?.id === ctx.playerId) return;

  if (next.turnPhase === 'awaiting-judge' && prev?.turnPhase !== 'awaiting-judge') {
    ctx.toast('info', '⚖️ Bitte werten: richtig oder falsch?');
  }
  if (next.turnPhase === 'awaiting-category' && prev?.turnPhase !== 'awaiting-category') {
    ctx.toast('turn', `🎯 ${current?.name} will gewinnen – wählt die Farbe!`);
  }
}
