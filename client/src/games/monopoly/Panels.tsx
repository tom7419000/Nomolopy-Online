import { useEffect, useRef, useState } from 'react';
import type { GameState, Player } from '@shared/types';
import {
  canMortgage,
  canSellHouseOn,
  groupTiles,
  liquidationCapacity,
  netWorth,
  ownedTiles,
} from '@shared/engine';
import { GROUP_ORDER } from '@shared/boards';
import { api } from '../../net/socket';
import { useMe, useStore } from '../../state/store';
import { money, phaseLabel, timeHHMM } from '../../ui/format';

// ---------------------------------------------------------------------------
// Spielerliste
// ---------------------------------------------------------------------------

function PlayerCard({ game, player }: { game: GameState; player: Player }) {
  const me = useMe();
  const openDialog = useStore((s) => s.openDialog);
  const isCurrent = game.phase === 'playing' && game.players[game.currentPlayer]?.id === player.id;
  const owned = ownedTiles(game, player.id);

  return (
    <div
      className={`player-card ${isCurrent ? 'current' : ''} ${player.bankrupt ? 'bankrupt' : ''}`}
      style={{ borderLeftColor: player.color }}
    >
      <div className="player-head">
        <span className="token" style={{ background: player.color }}>
          {player.token}
        </span>
        <span className="player-name">
          {player.name}
          {player.isHost && <span className="badge">HOST</span>}
          {player.id === me?.id && <span className="badge you">DU</span>}
        </span>
        <span className="player-flags">
          {!player.connected && !player.bankrupt && (
            <span className="flag offline" title="Verbindung getrennt">
              ⚠
            </span>
          )}
          {player.inJail && (
            <span className="flag" title="Im Gefängnis">
              🔒
            </span>
          )}
          {player.jailCards > 0 && (
            <span className="flag" title={`${player.jailCards} Gefängnis-Frei-Karte(n)`}>
              🃏{player.jailCards}
            </span>
          )}
          {player.bankrupt && (
            <span className="flag" title="Bankrott">
              💀
            </span>
          )}
        </span>
      </div>
      {!player.bankrupt && (
        <>
          <div className="player-money">
            {money(game, player.money)}
            <span className="networth" title="Gesamtvermögen inkl. Grundstücke und Häuser">
              Vermögen: {money(game, netWorth(game, player.id))}
            </span>
          </div>
          <div className="player-props">
            {GROUP_ORDER.map((g) => {
              const tiles = groupTiles(game.edition, g);
              const mine = tiles.filter((t) => game.properties[t.id]?.ownerId === player.id);
              if (mine.length === 0) return null;
              return (
                <span
                  key={g}
                  className={`prop-chip ${mine.length === tiles.length ? 'full' : ''}`}
                  style={{ background: game.edition.groupColors[g] }}
                  title={mine.map((t) => t.name).join(', ')}
                >
                  {mine.length}/{tiles.length}
                </span>
              );
            })}
            {(['railroad', 'utility'] as const).map((type) => {
              const mine = game.edition.tiles.filter(
                (t) => t.type === type && game.properties[t.id]?.ownerId === player.id
              );
              if (mine.length === 0) return null;
              return (
                <span key={type} className="prop-chip special" title={mine.map((t) => t.name).join(', ')}>
                  {type === 'railroad' ? '🚂' : '⚡'} {mine.length}
                </span>
              );
            })}
            {owned.length === 0 && <span className="hint">Kein Besitz</span>}
          </div>
          {owned.length > 0 && (
            <details className="player-details">
              <summary>Besitz anzeigen ({owned.length})</summary>
              <ul>
                {owned.map((t) => {
                  const prop = game.properties[t.id];
                  return (
                    <li key={t.id}>
                      <button className="linkish" onClick={() => openDialog({ type: 'property', tileId: t.id })}>
                        {t.group && (
                          <span className="mini-chip" style={{ background: game.edition.groupColors[t.group] }} />
                        )}
                        {t.name}
                        {prop.houses > 0 && ` ${prop.houses === 5 ? '🏨' : '🏠×' + prop.houses}`}
                        {prop.mortgaged && ' (Hypothek)'}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}

export function PlayersPanel() {
  const game = useStore((s) => s.game)!;
  return (
    <div className="players-panel">
      {game.players.map((p) => (
        <PlayerCard key={p.id} game={game} player={p} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Schulden-Box
// ---------------------------------------------------------------------------

function DebtBox({ game }: { game: GameState }) {
  const me = useMe();
  const debt = game.debt!;
  if (!me || debt.playerId !== me.id) return null;
  const creditor = debt.creditorId ? game.players.find((p) => p.id === debt.creditorId) : null;
  const capacity = liquidationCapacity(game, me.id);
  const canPay = me.money >= debt.amount;
  const hopeless = me.money + capacity < debt.amount;

  const quickActions: { label: string; run: () => void }[] = [];
  for (const t of ownedTiles(game, me.id)) {
    const prop = game.properties[t.id];
    if (t.type === 'street' && prop.houses > 0 && canSellHouseOn(game, me.id, t.id).ok) {
      quickActions.push({
        label: `${prop.houses === 5 ? 'Hotel' : 'Haus'} verkaufen: ${t.name} (+${money(game, Math.floor(t.houseCost! / 2))})`,
        run: () => api.action({ type: 'sellHouse', tileId: t.id }),
      });
    }
    if (canMortgage(game, me.id, t.id).ok) {
      quickActions.push({
        label: `Hypothek: ${t.name} (+${money(game, Math.floor(t.price! / 2))})`,
        run: () => api.action({ type: 'mortgage', tileId: t.id }),
      });
    }
  }

  return (
    <div className="debt-box" role="alert">
      <h3>⚠️ Schulden: {money(game, debt.amount)}</h3>
      <p>
        {debt.reason} – fällig an {creditor ? creditor.name : 'die Bank'}. Du hast{' '}
        {money(game, me.money)}.
      </p>
      {!canPay && !hopeless && (
        <p className="hint">Verkaufe Gebäude oder nimm Hypotheken auf (bis zu +{money(game, capacity)} möglich):</p>
      )}
      {!canPay && quickActions.length > 0 && (
        <div className="quick-actions">
          {quickActions.slice(0, 6).map((a, i) => (
            <button key={i} className="btn small" onClick={a.run}>
              {a.label}
            </button>
          ))}
        </div>
      )}
      {hopeless && <p className="hint">Selbst mit allen Verkäufen reicht es nicht mehr …</p>}
      <div className="btn-row">
        <button className="btn primary" disabled={!canPay} onClick={() => api.action({ type: 'payDebt' })}>
          Schulden bezahlen ({money(game, debt.amount)})
        </button>
        <button
          className="btn danger"
          onClick={() => {
            if (window.confirm('Wirklich Bankrott erklären? Du scheidest damit aus dem Spiel aus.')) {
              api.action({ type: 'declareBankruptcy' });
            }
          }}
        >
          💥 Bankrott erklären
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aktions-Panel
// ---------------------------------------------------------------------------

export function ActionsPanel() {
  const game = useStore((s) => s.game)!;
  const me = useMe();
  const openDialog = useStore((s) => s.openDialog);
  const current = game.players[game.currentPlayer];
  const isMyTurn = game.phase === 'playing' && current?.id === me?.id;
  const tile = current ? game.edition.tiles[current.position] : null;

  if (!me) return null;

  const trade = game.trade;
  const tradeFrom = trade ? game.players.find((p) => p.id === trade.fromId) : null;
  const tradeTo = trade ? game.players.find((p) => p.id === trade.toId) : null;

  return (
    <div className="actions-panel">
      <div className={`turn-banner ${isMyTurn ? 'mine' : ''}`}>
        {game.phase === 'ended' ? (
          <strong>🏆 Spiel beendet</strong>
        ) : (
          <>
            <span className="turn-token" style={{ background: current?.color }}>
              {current?.token}
            </span>
            <strong>{phaseLabel(game.turnPhase, current?.name ?? '', isMyTurn)}</strong>
          </>
        )}
      </div>

      {game.phase === 'playing' && game.turnPhase === 'debt' && game.debt?.playerId === me.id && (
        <DebtBox game={game} />
      )}

      {isMyTurn && game.turnPhase === 'awaiting-roll' && !me.inJail && (
        <div className="action-block">
          {game.doubles > 0 && <p className="hint">🎉 Pasch! Du darfst nochmal würfeln.</p>}
          <button className="btn primary big" onClick={() => api.action({ type: 'roll' })}>
            🎲 Würfeln
          </button>
        </div>
      )}

      {isMyTurn && game.turnPhase === 'awaiting-roll' && me.inJail && (
        <div className="action-block jail">
          <p>
            🔒 Du sitzt im Gefängnis (Versuch {me.jailTurns}/{game.rules.maxJailTurns}). Wirf einen
            Pasch oder kauf dich frei.
          </p>
          <div className="btn-row">
            <button className="btn primary" onClick={() => api.action({ type: 'roll' })}>
              🎲 Würfeln (Pasch?)
            </button>
            <button
              className="btn"
              disabled={me.money < game.rules.jailFine}
              onClick={() => api.action({ type: 'payJail' })}
            >
              {money(game, game.rules.jailFine)} Kaution zahlen
            </button>
            <button
              className="btn"
              disabled={me.jailCards <= 0}
              onClick={() => api.action({ type: 'useJailCard' })}
            >
              🃏 Frei-Karte einsetzen
            </button>
          </div>
        </div>
      )}

      {isMyTurn && game.turnPhase === 'awaiting-buy' && tile && (
        <div className="action-block buy">
          <p>
            <strong>{tile.name}</strong> ist zu haben für <strong>{money(game, tile.price!)}</strong>.
          </p>
          <div className="btn-row">
            <button
              className="btn primary"
              disabled={me.money < tile.price!}
              onClick={() => api.action({ type: 'buy' })}
            >
              Kaufen ({money(game, tile.price!)})
            </button>
            <button className="btn" onClick={() => api.action({ type: 'skipBuy' })}>
              Nicht kaufen
            </button>
          </div>
          {me.money < tile.price! && <p className="hint">Dafür reicht dein Geld nicht.</p>}
        </div>
      )}

      {isMyTurn && game.turnPhase === 'awaiting-card' && (
        <div className="action-block">
          <p>Du hast eine Karte gezogen – lies sie im Fenster und bestätige.</p>
        </div>
      )}

      {isMyTurn && game.turnPhase === 'awaiting-end' && (
        <div className="action-block">
          <p className="hint">
            Du kannst jetzt bauen, Hypotheken verwalten (Klick auf ein Feld) oder handeln.
          </p>
          <button className="btn primary big" onClick={() => api.action({ type: 'endTurn' })}>
            {game.doubles > 0 && !me.inJail ? '🎲 Pasch! Nochmal würfeln' : '✔ Zug beenden'}
          </button>
        </div>
      )}

      {game.phase === 'playing' && !me.bankrupt && !trade && (
        <button className="btn ghost" onClick={() => openDialog({ type: 'trade' })}>
          🤝 Handeln …
        </button>
      )}

      {trade && (
        <div className="action-block trade-banner">
          <p>
            🤝 Handelsangebot: {tradeFrom?.name} → {tradeTo?.name}
          </p>
          <div className="trade-summary">
            <div>
              <span className="hint">Bietet:</span>{' '}
              {[
                trade.offerMoney ? money(game, trade.offerMoney) : null,
                ...trade.offerProps.map((id) => game.edition.tiles[id].name),
              ]
                .filter(Boolean)
                .join(', ') || '–'}
            </div>
            <div>
              <span className="hint">Möchte:</span>{' '}
              {[
                trade.requestMoney ? money(game, trade.requestMoney) : null,
                ...trade.requestProps.map((id) => game.edition.tiles[id].name),
              ]
                .filter(Boolean)
                .join(', ') || '–'}
            </div>
          </div>
          {trade.toId === me.id && (
            <div className="btn-row">
              <button className="btn primary" onClick={() => api.action({ type: 'respondTrade', accept: true })}>
                Annehmen
              </button>
              <button className="btn" onClick={() => api.action({ type: 'respondTrade', accept: false })}>
                Ablehnen
              </button>
            </div>
          )}
          {trade.fromId === me.id && (
            <button className="btn" onClick={() => api.action({ type: 'cancelTrade' })}>
              Angebot zurückziehen
            </button>
          )}
        </div>
      )}

      {/* Host-Werkzeuge */}
      {me.isHost && game.phase === 'playing' && current && !current.connected && (
        <div className="action-block host-tools">
          <p className="hint">
            ⚠ {current.name} ist nicht verbunden. Als Host kannst du den Zug automatisch abschließen.
          </p>
          <button className="btn" onClick={() => api.action({ type: 'forceEndTurn' })}>
            ⏭ Zug von {current.name} automatisch beenden
          </button>
        </div>
      )}
      {me.isHost &&
        game.phase === 'playing' &&
        game.players.filter((p) => !p.connected && !p.bankrupt && p.id !== me.id).length > 0 && (
          <details className="host-tools">
            <summary>Host: Getrennte Spieler verwalten</summary>
            {game.players
              .filter((p) => !p.connected && !p.bankrupt && p.id !== me.id)
              .map((p) => (
                <button
                  key={p.id}
                  className="btn small danger"
                  onClick={() => {
                    if (window.confirm(`${p.name} endgültig entfernen? Der Besitz fällt an die Bank.`)) {
                      api.action({ type: 'removePlayer', targetId: p.id });
                    }
                  }}
                >
                  {p.name} entfernen
                </button>
              ))}
          </details>
        )}

      {game.phase === 'playing' && !me.bankrupt && (
        <button
          className="btn ghost small resign"
          onClick={() => {
            if (window.confirm('Wirklich aufgeben? Du scheidest aus dem Spiel aus.')) {
              api.action({ type: 'resign' });
            }
          }}
        >
          🏳 Aufgeben
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Log & Chat
// ---------------------------------------------------------------------------

export function LogPanel() {
  const game = useStore((s) => s.game)!;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [game.log.length]);

  return (
    <div className="log-panel" ref={ref} aria-label="Spielprotokoll" role="log">
      {game.log.map((entry) => {
        const player = entry.playerId ? game.players.find((p) => p.id === entry.playerId) : null;
        return (
          <div key={entry.id} className={`log-entry kind-${entry.kind}`}>
            <span className="log-time">{timeHHMM(entry.time)}</span>
            {player && <span className="log-dot" style={{ background: player.color }} />}
            <span className="log-text">{entry.text}</span>
          </div>
        );
      })}
      {game.log.length === 0 && <p className="hint">Noch keine Ereignisse.</p>}
    </div>
  );
}

export function ChatPanel() {
  const game = useStore((s) => s.game)!;
  const me = useMe();
  const [text, setText] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [game.chat.length]);

  async function send() {
    const t = text.trim();
    if (!t) return;
    setText('');
    await api.chat(t);
  }

  return (
    <div className="chat-panel">
      <div className="chat-messages" ref={ref}>
        {game.chat.map((m) => (
          <div key={m.id} className={`chat-msg ${m.playerId === me?.id ? 'mine' : ''}`}>
            <span className="chat-name" style={{ color: m.color }}>
              {m.name}
            </span>
            <span className="chat-text">{m.text}</span>
            <span className="chat-time">{timeHHMM(m.time)}</span>
          </div>
        ))}
        {game.chat.length === 0 && <p className="hint">Sag Hallo! 👋</p>}
      </div>
      <div className="chat-input">
        <input
          className="input"
          placeholder="Nachricht …"
          maxLength={500}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          aria-label="Chat-Nachricht"
        />
        <button className="btn" onClick={send} aria-label="Senden">
          ➤
        </button>
      </div>
    </div>
  );
}
