import { useEffect, useMemo, useState } from 'react';
import type { GameState, SaveGameMeta, TileDef } from '@shared/types';
import {
  canBuildOn,
  canMortgage,
  canSellHouseOn,
  canUnmortgage,
  netWorth,
  unmortgageCost,
} from '@shared/engine';
import { cardText } from '@shared/cards';
import { api } from '../net/socket';
import { useIsMyTurn, useMe, useStore } from '../state/store';
import { money, tileIcon } from '../ui/format';
import { RentTable } from './Board';

// ---------------------------------------------------------------------------
// Modal-Grundgerüst
// ---------------------------------------------------------------------------

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose?: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!onClose) return;
    const handler = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <h2>{title}</h2>
          {onClose && (
            <button className="btn ghost small" onClick={onClose} aria-label="Schließen">
              ✕
            </button>
          )}
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ereignis-/Gemeinschaftskarte
// ---------------------------------------------------------------------------

export function CardModal({ game }: { game: GameState }) {
  const me = useMe();
  const pending = game.pendingCard;
  if (!pending) return null;
  const owner = game.players.find((p) => p.id === pending.playerId);
  const isMine = pending.playerId === me?.id;
  const isChance = pending.card.deck === 'chance';

  return (
    <div className="modal-overlay card-overlay">
      <div className={`game-card ${isChance ? 'chance' : 'community'}`} role="dialog" aria-modal="true">
        <header>{isChance ? '❓ Ereigniskarte' : '🎁 Gemeinschaftskarte'}</header>
        <p className="card-text">{cardText(pending.card, game.edition)}</p>
        <footer>
          {isMine ? (
            <button className="btn primary big" onClick={() => api.action({ type: 'ackCard' })} autoFocus>
              OK
            </button>
          ) : (
            <p className="hint">{owner?.name} liest die Karte …</p>
          )}
        </footer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Grundstücks-Dialog
// ---------------------------------------------------------------------------

export function PropertyDialog({ game, tileId }: { game: GameState; tileId: number }) {
  const closeDialog = useStore((s) => s.closeDialog);
  const me = useMe();
  const isMyTurn = useIsMyTurn();
  const tile: TileDef = game.edition.tiles[tileId];
  const prop = game.properties[tileId];
  const owner = prop?.ownerId ? game.players.find((p) => p.id === prop.ownerId) : null;
  const isMine = prop?.ownerId === me?.id;
  const groupColor = tile.group ? game.edition.groupColors[tile.group] : undefined;
  const inDebt = game.debt?.playerId === me?.id;
  const mayManage = isMine && (isMyTurn || inDebt) && game.phase === 'playing';

  const buildCheck = me ? canBuildOn(game, me.id, tileId) : { ok: false };
  const sellCheck = me ? canSellHouseOn(game, me.id, tileId) : { ok: false };
  const mortgageCheck = me ? canMortgage(game, me.id, tileId) : { ok: false };
  const unmortgageCheck = me ? canUnmortgage(game, me.id, tileId) : { ok: false };

  const isProperty = tile.type === 'street' || tile.type === 'railroad' || tile.type === 'utility';

  return (
    <Modal title="" onClose={closeDialog}>
      <div className="property-card">
        <header className="property-head" style={{ background: groupColor ?? 'var(--panel-3)' }}>
          <span className="property-icon">{tileIcon(tile)}</span>
          <h3>{tile.name}</h3>
          {tile.price != null && <span>{money(game, tile.price)}</span>}
        </header>
        {tile.image && <img className="property-img" src={tile.image} alt={tile.name} />}

        {isProperty && (
          <div className="property-status">
            {owner ? (
              <p>
                Besitzer:{' '}
                <strong style={{ color: owner.color }}>
                  {owner.token} {owner.name}
                </strong>
                {prop!.mortgaged && ' · mit Hypothek belastet'}
                {prop!.houses > 0 && ` · ${prop!.houses === 5 ? 'Hotel 🏨' : `${prop!.houses} Häuser`}`}
              </p>
            ) : (
              <p>Noch zu haben – wer zuerst drauf landet, darf kaufen.</p>
            )}
          </div>
        )}

        <RentTable game={game} tile={tile} />

        {tile.type === 'tax' && <p className="hint">Wer hier landet, zahlt {money(game, tile.tax!)} an die Bank.</p>}
        {tile.type === 'chance' && <p className="hint">Ereigniskarte ziehen!</p>}
        {tile.type === 'community' && <p className="hint">Gemeinschaftskarte ziehen!</p>}
        {tile.type === 'go' && (
          <p className="hint">Über {tile.name} ziehen bringt {money(game, game.rules.goSalary)} Gehalt.</p>
        )}
        {tile.type === 'gotojail' && <p className="hint">Wer hier landet, wandert direkt ins Gefängnis.</p>}
        {tile.type === 'jail' && <p className="hint">Nur zu Besuch – oder hinter Gittern.</p>}
        {tile.type === 'freeparking' && (
          <p className="hint">
            {game.rules.freeParkingBonus
              ? `Wer hier landet, kassiert den Topf (aktuell ${money(game, game.freeParkingPot)}).`
              : 'Hier passiert nichts – einfach mal durchatmen.'}
          </p>
        )}

        {isMine && (
          <div className="property-actions">
            {!mayManage && (
              <p className="hint">Verwalten ist nur in deinem Zug (oder bei Schulden) möglich.</p>
            )}
            {tile.type === 'street' && (
              <div className="btn-row">
                <button
                  className="btn"
                  disabled={!mayManage || !isMyTurn || !buildCheck.ok}
                  title={buildCheck.ok ? '' : (buildCheck as { reason?: string }).reason}
                  onClick={() => api.action({ type: 'build', tileId })}
                >
                  🏠 Bauen ({money(game, tile.houseCost!)})
                </button>
                <button
                  className="btn"
                  disabled={!mayManage || !sellCheck.ok}
                  title={sellCheck.ok ? '' : (sellCheck as { reason?: string }).reason}
                  onClick={() => api.action({ type: 'sellHouse', tileId })}
                >
                  Verkaufen (+{money(game, Math.floor(tile.houseCost! / 2))})
                </button>
              </div>
            )}
            <div className="btn-row">
              {!prop!.mortgaged ? (
                <button
                  className="btn"
                  disabled={!mayManage || !mortgageCheck.ok}
                  title={mortgageCheck.ok ? '' : (mortgageCheck as { reason?: string }).reason}
                  onClick={() => api.action({ type: 'mortgage', tileId })}
                >
                  Hypothek aufnehmen (+{money(game, Math.floor(tile.price! / 2))})
                </button>
              ) : (
                <button
                  className="btn"
                  disabled={!mayManage || !isMyTurn || !unmortgageCheck.ok}
                  title={unmortgageCheck.ok ? '' : (unmortgageCheck as { reason?: string }).reason}
                  onClick={() => api.action({ type: 'unmortgage', tileId })}
                >
                  Hypothek ablösen (−{money(game, unmortgageCost(game, tileId))})
                </button>
              )}
            </div>
            {(buildCheck as { reason?: string }).reason && tile.type === 'street' && (
              <p className="hint">{(buildCheck as { reason?: string }).reason}</p>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Handel
// ---------------------------------------------------------------------------

export function TradeDialog({ game }: { game: GameState }) {
  const closeDialog = useStore((s) => s.closeDialog);
  const me = useMe()!;
  const partners = game.players.filter((p) => !p.bankrupt && p.id !== me.id);
  const [partnerId, setPartnerId] = useState(partners[0]?.id ?? '');
  const [offerMoney, setOfferMoney] = useState(0);
  const [requestMoney, setRequestMoney] = useState(0);
  const [offerProps, setOfferProps] = useState<number[]>([]);
  const [requestProps, setRequestProps] = useState<number[]>([]);

  const partner = game.players.find((p) => p.id === partnerId);

  const tradeable = (playerId: string) =>
    game.edition.tiles.filter((t) => {
      const prop = game.properties[t.id];
      if (!prop || prop.ownerId !== playerId) return false;
      if (t.type === 'street') {
        // Farbgruppen mit Gebäuden sind nicht handelbar
        return !game.edition.tiles.some(
          (x) => x.type === 'street' && x.group === t.group && game.properties[x.id].houses > 0
        );
      }
      return true;
    });

  function toggle(list: number[], setList: (v: number[]) => void, id: number) {
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  }

  async function submit() {
    const r = await api.action({
      type: 'proposeTrade',
      to: partnerId,
      offerMoney,
      offerProps,
      requestMoney,
      requestProps,
    });
    if (r.ok) closeDialog();
  }

  if (partners.length === 0) {
    return (
      <Modal title="🤝 Handeln" onClose={closeDialog}>
        <p className="hint">Kein Mitspieler verfügbar.</p>
      </Modal>
    );
  }

  return (
    <Modal title="🤝 Handelsangebot" onClose={closeDialog} wide>
      <label className="field">
        <span>Handelspartner</span>
        <select
          className="input"
          value={partnerId}
          onChange={(e) => {
            setPartnerId(e.target.value);
            setRequestProps([]);
          }}
        >
          {partners.map((p) => (
            <option key={p.id} value={p.id}>
              {p.token} {p.name}
            </option>
          ))}
        </select>
      </label>

      <div className="trade-grid">
        <section>
          <h3>Du gibst</h3>
          <label className="field">
            <span>Geld (max. {money(game, me.money)})</span>
            <input
              type="number"
              className="input"
              min={0}
              max={me.money}
              value={offerMoney}
              onChange={(e) => setOfferMoney(Math.max(0, Math.min(me.money, Number(e.target.value) || 0)))}
            />
          </label>
          <div className="trade-props">
            {tradeable(me.id).map((t) => (
              <label key={t.id} className="trade-prop">
                <input
                  type="checkbox"
                  checked={offerProps.includes(t.id)}
                  onChange={() => toggle(offerProps, setOfferProps, t.id)}
                />
                {t.group && <span className="mini-chip" style={{ background: game.edition.groupColors[t.group] }} />}
                {t.name}
                {game.properties[t.id].mortgaged && ' (Hyp.)'}
              </label>
            ))}
            {tradeable(me.id).length === 0 && <p className="hint">Nichts Handelbares (Gebäude erst verkaufen).</p>}
          </div>
        </section>
        <section>
          <h3>Du bekommst von {partner?.name}</h3>
          <label className="field">
            <span>Geld (max. {money(game, partner?.money ?? 0)})</span>
            <input
              type="number"
              className="input"
              min={0}
              max={partner?.money ?? 0}
              value={requestMoney}
              onChange={(e) =>
                setRequestMoney(Math.max(0, Math.min(partner?.money ?? 0, Number(e.target.value) || 0)))
              }
            />
          </label>
          <div className="trade-props">
            {partner &&
              tradeable(partner.id).map((t) => (
                <label key={t.id} className="trade-prop">
                  <input
                    type="checkbox"
                    checked={requestProps.includes(t.id)}
                    onChange={() => toggle(requestProps, setRequestProps, t.id)}
                  />
                  {t.group && <span className="mini-chip" style={{ background: game.edition.groupColors[t.group] }} />}
                  {t.name}
                  {game.properties[t.id].mortgaged && ' (Hyp.)'}
                </label>
              ))}
            {partner && tradeable(partner.id).length === 0 && (
              <p className="hint">{partner.name} hat nichts Handelbares.</p>
            )}
          </div>
        </section>
      </div>

      <div className="btn-row">
        <button className="btn primary" onClick={submit}>
          Angebot senden
        </button>
        <button className="btn" onClick={closeDialog}>
          Abbrechen
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Spielende
// ---------------------------------------------------------------------------

export function GameOverModal({ game, onClose }: { game: GameState; onClose: () => void }) {
  const me = useMe();
  const winner = game.players.find((p) => p.id === game.winnerId);
  const ranking = [...game.players].sort((a, b) => {
    if (a.bankrupt !== b.bankrupt) return a.bankrupt ? 1 : -1;
    return netWorth(game, b.id) - netWorth(game, a.id);
  });

  return (
    <Modal title="🏆 Spiel beendet" onClose={onClose}>
      {winner && (
        <p className="winner-line">
          <span className="token big" style={{ background: winner.color }}>
            {winner.token}
          </span>{' '}
          <strong>{winner.name}</strong> gewinnt die Partie!
        </p>
      )}
      <ol className="ranking">
        {ranking.map((p) => (
          <li key={p.id}>
            <span style={{ color: p.color }}>
              {p.token} {p.name}
            </span>
            <span>{p.bankrupt ? '💀 bankrott' : money(game, netWorth(game, p.id))}</span>
          </li>
        ))}
      </ol>
      <div className="btn-row">
        {me?.isHost && (
          <button className="btn primary" onClick={() => api.rematch()}>
            🔁 Neue Runde (zurück zur Lobby)
          </button>
        )}
        <button className="btn" onClick={() => api.leaveRoom()}>
          Raum verlassen
        </button>
        <button className="btn ghost" onClick={onClose}>
          Brett ansehen
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Debug
// ---------------------------------------------------------------------------

export function DebugDialog({ game }: { game: GameState }) {
  const closeDialog = useStore((s) => s.closeDialog);
  const session = useStore((s) => s.session);
  const addToast = useStore((s) => s.addToast);
  const [d1, setD1] = useState(1);
  const [d2, setD2] = useState(1);

  const json = useMemo(() => JSON.stringify(game, null, 2), [game]);

  return (
    <Modal title="🐞 Debug / Spielzustand" onClose={closeDialog} wide>
      <p className="hint">
        Raum {game.id} · Phase {game.phase}/{game.turnPhase} · Zug #{game.turnCount} · Häuser in der
        Bank: {game.bankHouses} · Hotels: {game.bankHotels} · Meine Spieler-ID: {session?.playerId}
      </p>
      {game.rules.debugMode ? (
        <div className="btn-row debug-dice">
          <label className="field">
            <span>Würfel 1</span>
            <select className="input small" value={d1} onChange={(e) => setD1(Number(e.target.value))}>
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Würfel 2</span>
            <select className="input small" value={d2} onChange={(e) => setD2(Number(e.target.value))}>
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <button className="btn" onClick={() => api.action({ type: 'setDice', dice: [d1, d2] as [number, number] })}>
            Nächsten Wurf setzen
          </button>
        </div>
      ) : (
        <p className="hint">Debug-Modus ist aus (in der Lobby aktivierbar) – Würfel nicht setzbar.</p>
      )}
      <button
        className="btn small"
        onClick={() => {
          navigator.clipboard?.writeText(json).then(() => addToast('success', 'Zustand kopiert.'));
        }}
      >
        ⧉ JSON kopieren
      </button>
      <pre className="debug-json">{json}</pre>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Spielstände
// ---------------------------------------------------------------------------

export function SavesDialog() {
  const closeDialog = useStore((s) => s.closeDialog);
  const game = useStore((s) => s.game);
  const me = useMe();
  const [saves, setSaves] = useState<SaveGameMeta[] | null>(null);

  async function refresh() {
    const r = await api.listSaves();
    setSaves(((r.saves as SaveGameMeta[]) ?? []).slice());
  }

  useEffect(() => {
    refresh();
  }, []);

  const canLoad = Boolean(game && me?.isHost);

  return (
    <Modal title="📂 Spielstände" onClose={closeDialog}>
      {game && me?.isHost && game.phase !== 'lobby' && (
        <button
          className="btn primary"
          onClick={async () => {
            const r = await api.saveGame();
            if (r.ok) {
              useStore.getState().addToast('success', 'Spielstand gespeichert.');
              refresh();
            }
          }}
        >
          💾 Aktuelles Spiel speichern
        </button>
      )}
      {!canLoad && (
        <p className="hint">
          Zum Laden musst du Host eines Raums sein – erstelle ein Spiel und lade den Stand aus der
          Lobby. Mitspieler treten danach einfach mit ihrem alten Namen bei.
        </p>
      )}
      <ul className="saves-list">
        {(saves ?? []).map((s) => (
          <li key={s.id}>
            <div>
              <strong>{s.name}</strong>
              <span className="hint">
                {new Date(s.savedAt).toLocaleString('de-DE')} · {s.players.join(', ')}
              </span>
            </div>
            <div className="btn-row">
              {canLoad && (
                <button
                  className="btn small primary"
                  onClick={async () => {
                    const r = await api.loadSave(s.id);
                    if (r.ok) closeDialog();
                  }}
                >
                  Laden
                </button>
              )}
              <button
                className="btn small danger"
                onClick={async () => {
                  if (window.confirm(`Spielstand „${s.name}“ löschen?`)) {
                    await api.deleteSave(s.id);
                    refresh();
                  }
                }}
              >
                Löschen
              </button>
            </div>
          </li>
        ))}
        {saves && saves.length === 0 && <p className="hint">Noch keine Spielstände gespeichert.</p>}
        {!saves && <p className="hint">Lade …</p>}
      </ul>
    </Modal>
  );
}
