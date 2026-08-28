/**
 * Setup für eine Partie am gemeinsamen Gerät.
 *
 * Bewusst kein Wartezimmer: es gibt niemanden, auf den man warten müsste.
 * Namen eintragen, Regeln wählen, los.
 */

import { useState } from 'react';
import { getGameInfo, type GameId } from '@shared/games';
import { BUILT_IN_EDITIONS } from '@shared/boards';
import { DEFAULT_POKER_RULES } from '@shared/poker/rules';
import type { PokerRules } from '@shared/poker/types';
import { PLAYER_COLORS } from '@shared/util';
import { startLocalGame } from '../net';
import {
  EDGE_LABELS,
  MAX_FIXED_SEATS,
  SEAT_EDGES,
  type SeatEdge,
} from '../net/localRoom';
import { loadName, saveName, useStore } from '../state/store';
import { Modal } from '../components/Modal';
import { CLIENT_GAMES } from '../games/registry';

export function LocalSetup({ gameId, onClose }: { gameId: GameId; onClose: () => void }) {
  const info = getGameInfo(gameId);
  const CreateFields = CLIENT_GAMES[gameId].CreateFields;
  const addToast = useStore((s) => s.addToast);

  const [names, setNames] = useState<string[]>(() => [loadName() || 'Spieler 1', 'Spieler 2']);
  const [seatMode, setSeatMode] = useState<'pass' | 'fixed'>('pass');
  const [editionId, setEditionId] = useState(BUILT_IN_EDITIONS[0]?.id ?? 'classic-de');
  const [presetId, setPresetId] = useState('classic');
  const [poker, setPoker] = useState<PokerRules>({
    ...DEFAULT_POKER_RULES,
    blindIncreaseMinutes: 0,
  });

  // Mehr Spieler als Kanten: „feste Plätze" fällt dann automatisch weg.
  // Bewusst abgeleitet statt per setState im Render – das gäbe eine
  // zusätzliche Renderrunde und im schlechten Fall eine Schleife.
  const tooManyForFixed = names.length > MAX_FIXED_SEATS;
  const effectiveSeatMode = tooManyForFixed ? 'pass' : seatMode;

  const [edges, setEdges] = useState<SeatEdge[]>([0, 180, 270, 90]);
  const edgeOf = (i: number): SeatEdge => edges[i] ?? SEAT_EDGES[i % SEAT_EDGES.length];
  function setEdge(i: number, deg: SeatEdge) {
    setEdges((prev) => {
      const next = [...prev];
      while (next.length <= i) next.push(SEAT_EDGES[next.length % SEAT_EDGES.length]);
      next[i] = deg;
      return next;
    });
  }

  function setName(i: number, value: string) {
    setNames((prev) => prev.map((n, idx) => (idx === i ? value : n)));
  }

  function addRow() {
    setNames((prev) => [...prev, `Spieler ${prev.length + 1}`]);
  }

  function removeRow(i: number) {
    setNames((prev) => prev.filter((_, idx) => idx !== i));
  }

  function start() {
    const cleaned = names.map((n) => n.trim());

    if (cleaned.some((n) => !n)) {
      return addToast('error', 'Bitte für jeden Sitz einen Namen eintragen.');
    }
    const lower = cleaned.map((n) => n.toLowerCase());
    if (new Set(lower).size !== lower.length) {
      return addToast('error', 'Zwei Spieler heißen gleich – am selben Gerät wird das verwirrend.');
    }
    if (cleaned.length < info.minPlayers) {
      return addToast('error', `${info.name} braucht mindestens ${info.minPlayers} Spieler.`);
    }

    // Der erste Name ist typischerweise der Gerätebesitzer – für die Online-
    // Startseite merken.
    saveName(cleaned[0]);

    const r = startLocalGame({
      gameId,
      players: cleaned,
      roomName: `${cleaned[0]}s ${info.name}-Runde`,
      editionId,
      presetId,
      pokerRules: gameId === 'poker' ? poker : undefined,
      seatMode: effectiveSeatMode,
      seatEdges: effectiveSeatMode === 'fixed' ? cleaned.map((_, i) => edgeOf(i)) : undefined,
    });
    if (r.ok) onClose();
  }

  return (
    <Modal title={`📱 ${info.name} an einem Gerät`} onClose={onClose}>
      <p className="hint">
        Alle spielen abwechselnd an diesem Gerät. Es wird nichts über das Internet
        übertragen – die Partie läuft auch im Flugmodus.
      </p>

      <h3 className="setup-title">Wie liegt das Gerät?</h3>
      <div className="seat-mode-row">
        <button
          className={`btn ${effectiveSeatMode === 'pass' ? 'active' : ''}`}
          onClick={() => setSeatMode('pass')}
        >
          📱 Weiterreichen
        </button>
        <button
          className={`btn ${effectiveSeatMode === 'fixed' ? 'active' : ''}`}
          disabled={tooManyForFixed}
          onClick={() => setSeatMode('fixed')}
        >
          🪑 Feste Plätze
        </button>
      </div>
      <p className="hint">
        {effectiveSeatMode === 'fixed'
          ? 'Das Gerät liegt in der Mitte. Wer dran ist, bekommt das Brett zu sich gedreht.'
          : 'Das Gerät wandert reihum. Die Ansicht bleibt, wie sie ist.'}
      </p>
      {tooManyForFixed && (
        <p className="hint">
          Feste Plätze gehen bis {MAX_FIXED_SEATS} Spieler – ein Tisch hat vier Kanten.
        </p>
      )}
      {effectiveSeatMode === 'fixed' && (
        <div className="seat-table-hint">
          oben
          <br />
          links ▢ rechts
          <br />
          unten
        </div>
      )}

      <h3 className="setup-title">Spieler ({names.length})</h3>
      <ul className="seat-setup">
        {names.map((n, i) => (
          <li key={i}>
            <span className="seat-dot" style={{ background: PLAYER_COLORS[i % PLAYER_COLORS.length] }} aria-hidden />
            <input
              className="input"
              maxLength={20}
              value={n}
              onChange={(e) => setName(i, e.target.value)}
              aria-label={`Name Spieler ${i + 1}`}
            />
            {effectiveSeatMode === 'fixed' && (
              <select
                className="input small seat-edge-select"
                value={edgeOf(i)}
                onChange={(e) => setEdge(i, Number(e.target.value) as SeatEdge)}
                aria-label={`Tischkante Spieler ${i + 1}`}
              >
                {SEAT_EDGES.map((deg) => (
                  <option key={deg} value={deg}>
                    {EDGE_LABELS[deg]}
                  </option>
                ))}
              </select>
            )}
            <button
              className="btn ghost small"
              onClick={() => removeRow(i)}
              disabled={names.length <= info.minPlayers}
              aria-label={`Spieler ${i + 1} entfernen`}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>

      {names.length < info.maxPlayers && (
        <button className="btn ghost" onClick={addRow}>
          ➕ Spieler hinzufügen
        </button>
      )}

      <CreateFields
        editionId={editionId}
        setEditionId={setEditionId}
        presetId={presetId}
        setPresetId={setPresetId}
        poker={poker as unknown as Record<string, unknown>}
        setPoker={(v) => setPoker(v as unknown as PokerRules)}
        local
      />

      <button className="btn primary big" onClick={start}>
        {info.emoji} Spiel starten
      </button>
    </Modal>
  );
}
