import { useEffect, useMemo, useRef, useState } from 'react';
import type { GameState, Player, TileDef } from '@shared/types';
import { computeRent } from '@shared/engine';
import { money, softHyphenate, tileIcon } from '../../ui/format';
import { tileCenterPct, tileGridPos, tileSide, tokenOffset } from '../../ui/layout';
import { useStore } from '../../state/store';
import { useRotatedStyle } from '../../hooks/useRotatedStyle';

/**
 * Figuren laufen Feld für Feld: Wir halten pro Spieler eine "angezeigte"
 * Position und nähern sie der echten Position schrittweise an.
 */
function useAnimatedPositions(game: GameState): Record<string, number> {
  const [positions, setPositions] = useState<Record<string, number>>({});
  const target = useMemo(() => {
    const t: Record<string, number> = {};
    for (const p of game.players) t[p.id] = p.position;
    return t;
  }, [game.players]);
  const positionsRef = useRef(positions);
  positionsRef.current = positions;

  useEffect(() => {
    const timer = setInterval(() => {
      const current = positionsRef.current;
      let changed = false;
      const next: Record<string, number> = {};
      for (const [id, tgt] of Object.entries(target)) {
        const cur = current[id];
        if (cur === undefined) {
          next[id] = tgt;
          changed = changed || cur !== tgt;
          continue;
        }
        if (cur === tgt) {
          next[id] = cur;
          continue;
        }
        const forward = (tgt - cur + 40) % 40;
        // Vorwärtsbewegungen bis 12 Felder laufen Schritt für Schritt,
        // alles andere (Gefängnis, Karten rückwärts) springt direkt.
        next[id] = forward >= 1 && forward <= 12 ? (cur + 1) % 40 : tgt;
        changed = true;
      }
      // Entfernte Spieler aufräumen
      if (Object.keys(current).some((id) => !(id in target))) changed = true;
      if (changed) setPositions(next);
    }, 160);
    return () => clearInterval(timer);
  }, [target]);

  return positions;
}

function Die({ value, rolling }: { value: number; rolling: boolean }) {
  const pips: Record<number, number[]> = {
    1: [4],
    2: [0, 8],
    3: [0, 4, 8],
    4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8],
    6: [0, 2, 3, 5, 6, 8],
  };
  return (
    <span className={`die ${rolling ? 'rolling' : ''}`} aria-label={`Würfel: ${value}`}>
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className={pips[value]?.includes(i) ? 'pip' : 'pip empty'} />
      ))}
    </span>
  );
}

export function DicePair({ dice, rolling }: { dice: [number, number] | null; rolling?: boolean }) {
  if (!dice) return null;
  return (
    <span className="dice-pair">
      <Die value={dice[0]} rolling={!!rolling} />
      <Die value={dice[1]} rolling={!!rolling} />
    </span>
  );
}

function TileView({
  game,
  tile,
  onClick,
}: {
  game: GameState;
  tile: TileDef;
  onClick: (id: number) => void;
}) {
  const side = tileSide(tile.id);
  const pos = tileGridPos(tile.id);
  const prop = game.properties[tile.id];
  const owner = prop?.ownerId ? game.players.find((p) => p.id === prop.ownerId) : undefined;
  const groupColor = tile.group ? game.edition.groupColors[tile.group] : undefined;

  const style: React.CSSProperties = {
    gridRow: pos.row,
    gridColumn: pos.col,
    ...(owner ? { boxShadow: `inset 0 0 0 2.5px ${owner.color}` } : {}),
  };

  const classes = ['tile', `side-${side}`, `type-${tile.type}`];
  if (prop?.mortgaged) classes.push('mortgaged');
  if (side === 'corner') classes.push(`corner-${tile.id}`);

  const houses = prop?.houses ?? 0;

  return (
    <button
      className={classes.join(' ')}
      style={style}
      onClick={() => onClick(tile.id)}
      title={`${tile.name}${tile.price ? ` – ${money(game, tile.price)}` : ''}`}
      aria-label={`Feld ${tile.id}: ${tile.name}`}
    >
      {tile.image && <img className="tile-img" src={tile.image} alt="" aria-hidden />}
      {groupColor && (
        <span className="tile-bar" style={{ background: groupColor }}>
          {houses > 0 && (
            <span className="tile-houses" aria-label={houses === 5 ? 'Hotel' : `${houses} Häuser`}>
              {houses === 5 ? '🏨' : '🏠'.repeat(houses)}
            </span>
          )}
        </span>
      )}
      {!groupColor && side !== 'corner' && <span className="tile-icon">{tileIcon(tile)}</span>}
      {side === 'corner' && <span className="tile-icon big">{tileIcon(tile)}</span>}
      <span className="tile-name">{softHyphenate(tile.name)}</span>
      {tile.price != null && <span className="tile-price">{money(game, tile.price)}</span>}
      {tile.tax != null && <span className="tile-price">{money(game, tile.tax)}</span>}
      {tile.id === 20 && game.rules.freeParkingBonus && game.freeParkingPot > 0 && (
        <span className="tile-pot">💰 {money(game, game.freeParkingPot)}</span>
      )}
      {prop?.mortgaged && <span className="mortgage-ribbon">HYPOTHEK</span>}
    </button>
  );
}

function TokenLayer({ game }: { game: GameState }) {
  const displayed = useAnimatedPositions(game);
  const byTile = new Map<number, Player[]>();
  for (const p of game.players) {
    if (p.bankrupt) continue;
    const pos = displayed[p.id] ?? p.position;
    if (!byTile.has(pos)) byTile.set(pos, []);
    byTile.get(pos)!.push(p);
  }
  const current = game.players[game.currentPlayer];

  return (
    <div className="token-layer" aria-hidden>
      {[...byTile.entries()].flatMap(([tileId, players]) =>
        players.map((p, idx) => {
          const c = tileCenterPct(tileId);
          const o = tokenOffset(idx, players.length);
          return (
            <span
              key={p.id}
              className={`token-piece ${current?.id === p.id ? 'current' : ''} ${p.inJail ? 'jailed' : ''}`}
              style={{
                left: `${c.x + o.dx}%`,
                top: `${c.y + o.dy}%`,
                background: p.color,
              }}
              title={p.name}
            >
              {p.token}
            </span>
          );
        })
      )}
    </div>
  );
}

export function Board({ game }: { game: GameState }) {
  const rotated = useRotatedStyle();
  const openDialog = useStore((s) => s.openDialog);
  const current = game.players[game.currentPlayer];
  const lastLog = game.log.length ? game.log[game.log.length - 1] : null;

  const groupVars: Record<string, string> = {};
  for (const [g, c] of Object.entries(game.edition.groupColors)) groupVars[`--group-${g}`] = c;

  return (
    <div
      className="board"
      style={
        {
          '--board-color': game.edition.boardColor,
          ...groupVars,
          ...rotated,
        } as React.CSSProperties
      }
    >
      <div className="board-grid">
        {game.edition.tiles.map((t) => (
          <TileView key={t.id} game={game} tile={t} onClick={(id) => openDialog({ type: 'property', tileId: id })} />
        ))}

        <div className="board-center">
          {game.edition.centerImage ? (
            <img className="center-image" src={game.edition.centerImage} alt={game.edition.name} />
          ) : (
            <div className="center-logo">
              <span className="center-title">NOMOLOPY</span>
              <span className="center-sub">{game.edition.name}</span>
            </div>
          )}

          <div className="center-status">
            {game.phase === 'ended' ? (
              <span className="center-turn">🏆 Spiel beendet</span>
            ) : (
              <span className="center-turn">
                <span className="turn-token" style={{ background: current?.color }}>
                  {current?.token}
                </span>
                {current?.name} ist am Zug
              </span>
            )}
            <DicePair dice={game.dice} />
            {game.rules.freeParkingBonus && (
              <span className="center-pot">Frei-Parken-Topf: {money(game, game.freeParkingPot)}</span>
            )}
            {lastLog && <span className="center-lastlog">{lastLog.text}</span>}
          </div>

          <div className="center-decks" aria-hidden>
            <span className="deck chance">? EREIGNIS</span>
            <span className="deck community">🎁 GEMEINSCHAFT</span>
          </div>
        </div>
      </div>
      <TokenLayer game={game} />
    </div>
  );
}

/** Kompakte Mieten-Tabelle für den Grundstücks-Dialog. */
export function RentTable({ game, tile }: { game: GameState; tile: TileDef }) {
  if (tile.type === 'street') {
    const labels = ['Grundmiete', '1 Haus', '2 Häuser', '3 Häuser', '4 Häuser', 'Hotel'];
    return (
      <table className="rent-table">
        <tbody>
          {tile.rent!.map((r, i) => (
            <tr key={i}>
              <td>{labels[i]}</td>
              <td>{money(game, r)}</td>
            </tr>
          ))}
          <tr>
            <td>Haus kaufen</td>
            <td>{money(game, tile.houseCost!)}</td>
          </tr>
          <tr>
            <td>Hypothekenwert</td>
            <td>{money(game, Math.floor(tile.price! / 2))}</td>
          </tr>
        </tbody>
      </table>
    );
  }
  if (tile.type === 'railroad') {
    return (
      <table className="rent-table">
        <tbody>
          {tile.rent!.map((r, i) => (
            <tr key={i}>
              <td>{i === 0 ? '1 Bahnhof' : `${i + 1} Bahnhöfe`}</td>
              <td>{money(game, r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  if (tile.type === 'utility') {
    return (
      <table className="rent-table">
        <tbody>
          <tr>
            <td>1 Werk</td>
            <td>{tile.rent![0]} × Augenzahl</td>
          </tr>
          <tr>
            <td>2 Werke</td>
            <td>{tile.rent![1]} × Augenzahl</td>
          </tr>
        </tbody>
      </table>
    );
  }
  return null;
}

export function currentRentInfo(game: GameState, tileId: number): string | null {
  const prop = game.properties[tileId];
  if (!prop?.ownerId || prop.mortgaged) return null;
  const rent = computeRent(game, tileId, 7);
  const tile = game.edition.tiles[tileId];
  if (tile.type === 'utility') return 'Miete: Augenzahl-abhängig';
  return `Aktuelle Miete: ${money(game, rent)}`;
}
