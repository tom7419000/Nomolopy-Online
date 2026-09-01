/**
 * Hinweise, die nur Jeopardy kennt.
 *
 * Der generische „du bist dran"-Hinweis aus dem Store greift hier zu kurz:
 * Beim Buzzern ist niemand einzeln dran, und genau das ist der Moment, in
 * dem am Handy etwas passieren muss.
 */

import type { AnyGameState } from '@shared/games';
import type { JeopardyView } from '@shared/jeopardy/types';
import type { NotifyContext } from '../registry';

/** Erkennt eine bestimmte Frage über Feld und Zahl der Fehlversuche. */
function clueKey(v: JeopardyView): string {
  const c = v.clue;
  return c ? `${c.col}:${c.row}:${c.lockedOut.length}` : '';
}

export function jeopardyNotify(
  prevAny: AnyGameState | null,
  nextAny: AnyGameState,
  ctx: NotifyContext
): void {
  const prev = prevAny as JeopardyView | null;
  const next = nextAny as JeopardyView;
  // Am gemeinsamen Gerät steht alles ohnehin groß auf dem Bildschirm –
  // Hinweise wären dort nur Flackern.
  if (ctx.local) return;
  // Der große Bildschirm ist Zuschauer und hat weder Buzzer noch Stimme.
  if (!next.players.some((p) => p.id === ctx.playerId)) return;

  const c = next.clue;
  if (!c) return;

  // Sperre und Wertung hängen am TEAM, nicht an der Person: Wenn der Kollege
  // danebenlag, ist der Versuch verbraucht, und über die eigenen Punkte
  // stimmt niemand ab.
  const myTeam = next.players.find((p) => p.id === ctx.playerId)?.teamId;
  const answeringTeam = next.players.find((p) => p.id === c.answererId)?.teamId;

  // Der Buzzer geht auf (auch erneut nach einer falschen Antwort).
  if (c.step === 'buzzing' && (prev?.clue?.step !== 'buzzing' || clueKey(next) !== clueKey(prev))) {
    if (myTeam && !c.lockedOut.includes(myTeam)) ctx.toast('turn', '🔔 Buzzer ist offen!');
  }

  // Gewertet werden muss aktiv – sonst entscheidet die Uhr.
  if (c.step === 'judging' && prev?.clue?.step !== 'judging' && myTeam !== answeringTeam) {
    ctx.toast('info', '⚖️ Bitte werten: richtig oder falsch?');
  }
}
