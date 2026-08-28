/**
 * Versteigerung eines ausgeschlagenen Grundstücks.
 *
 * Alle sehen dasselbe Panel – Feldkarte, Höchstgebot und wer dran ist. Nur
 * wer gerade bieten darf, bekommt zusätzlich Betragsfeld und Knöpfe. Das ist
 * dieselbe Form wie beim Handelsangebot, nur mit N Handelnden statt einem.
 */

import { useEffect, useState } from 'react';
import type { GameState } from '@shared/types';
import { auctionBidderId, maxBid, minBid } from '@shared/engine';
import { api } from '../../net';
import { useStore } from '../../state/store';
import { money } from '../../ui/format';

export function AuctionBox({ game }: { game: GameState }) {
  const session = useStore((s) => s.session);
  const auction = game.auction!;
  const tile = game.edition.tiles[auction.tileId];

  const bidderId = auctionBidderId(game);
  const isMyBid = bidderId === session?.playerId;
  const min = minBid(game);
  const max = maxBid(game, session?.playerId ?? '');
  const bidder = game.players.find((p) => p.id === bidderId);
  const leader = game.players.find((p) => p.id === auction.highBidderId);

  const [amount, setAmount] = useState(min);

  // Neues Höchstgebot: den Vorschlag nachziehen, solange der Spieler das Feld
  // nicht selbst angefasst hat (sonst risse es die Eingabe weg).
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    setTouched(false);
  }, [auction.id, bidderId]);
  useEffect(() => {
    if (!touched) setAmount(Math.min(Math.max(min, min), Math.max(min, max)));
  }, [min, max, touched]);

  const canAfford = max >= min;
  const valid = amount >= min && amount <= max;

  function bid(v: number) {
    setTouched(true);
    setAmount(Math.max(min, Math.min(max, v)));
  }

  return (
    <div className="action-block auction-box">
      <p className="auction-head">
        🔨 <strong>{tile.name}</strong> wird versteigert
        {tile.price ? <span className="hint"> (Listenpreis {money(game, tile.price)})</span> : null}
      </p>

      <p className="auction-bid">
        {leader ? (
          <>
            Höchstgebot: <strong>{money(game, auction.highBid)}</strong>{' '}
            <span style={{ color: leader.color }}>{leader.name}</span>
          </>
        ) : (
          <span className="hint">Noch kein Gebot.</span>
        )}
      </p>

      {isMyBid ? (
        <>
          <div className="auction-controls">
            <input
              type="number"
              className="input small"
              min={min}
              max={max}
              step={1}
              value={amount}
              onChange={(e) => bid(Number(e.target.value))}
              aria-label="Gebot"
            />
            <button className="btn ghost small" disabled={!canAfford} onClick={() => bid(min)}>
              Min
            </button>
            <button className="btn ghost small" disabled={!canAfford} onClick={() => bid(amount + 10)}>
              +10
            </button>
            <button className="btn ghost small" disabled={!canAfford} onClick={() => bid(amount + 50)}>
              +50
            </button>
            <button className="btn ghost small" disabled={!canAfford} onClick={() => bid(amount + 100)}>
              +100
            </button>
          </div>
          <div className="btn-row">
            <button
              className="btn primary"
              disabled={!valid}
              onClick={() => api.action({ type: 'bid', amount })}
            >
              {money(game, amount)} bieten
            </button>
            <button className="btn" onClick={() => api.action({ type: 'passAuction' })}>
              Passen
            </button>
          </div>
          {!canAfford && (
            <p className="hint">Dein Bargeld reicht für das Mindestgebot nicht – du kannst nur passen.</p>
          )}
        </>
      ) : (
        <p className="hint">
          {bidder ? (
            <>
              <span style={{ color: bidder.color }}>{bidder.name}</span> ist mit Bieten dran …
            </>
          ) : (
            'Die Auktion wird ausgewertet …'
          )}
        </p>
      )}

      {auction.passed.length > 0 && (
        <p className="hint auction-passed">
          Ausgestiegen:{' '}
          {auction.passed
            .map((id) => game.players.find((p) => p.id === id)?.name ?? '?')
            .join(', ')}
        </p>
      )}
    </div>
  );
}
