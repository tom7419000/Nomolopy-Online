/**
 * Hinweise, die nur Monopoly kennt: neues Handelsangebot, gestartete
 * Auktion, überboten worden.
 *
 * Lag vorher direkt in `store.ts` und machte den Store spielabhängig. Der
 * „du bist dran"-Hinweis ist dort geblieben – den braucht jedes Spiel.
 */

import type { GameState } from '@shared/types';
import type { AnyGameState } from '@shared/games';
import type { NotifyContext } from '../registry';

export function monopolyNotify(
  prevAny: AnyGameState | null,
  nextAny: AnyGameState,
  ctx: NotifyContext
): void {
  const prev = prevAny as GameState | null;
  const game = nextAny as GameState;
  if (game.phase !== 'playing') return;

  // Der Vergleich über die id feuert einmal pro Vorgang statt bei jedem
  // Broadcast – dasselbe Muster für Auktion und Handel.
  if (game.auction && prev?.auction?.id !== game.auction.id) {
    const tile = game.edition.tiles[game.auction.tileId];
    ctx.toast('info', `🔨 ${tile?.name ?? 'Ein Grundstück'} wird versteigert.`);
  } else if (
    game.auction &&
    prev?.auction &&
    game.auction.highBidderId !== prev.auction.highBidderId &&
    prev.auction.highBidderId === ctx.playerId
  ) {
    ctx.toast('info', '🔨 Du wurdest überboten.');
  }

  if (game.trade && game.trade.toId === ctx.playerId && prev?.trade?.id !== game.trade.id) {
    const from = game.players.find((p) => p.id === game.trade!.fromId);
    ctx.toast('info', `🤝 ${from?.name ?? 'Jemand'} schlägt dir einen Handel vor.`);
  }
}
