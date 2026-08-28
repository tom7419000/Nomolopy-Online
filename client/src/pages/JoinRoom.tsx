/**
 * Beitritts-Seite für geteilte Links (#/room/CODE): Name eingeben → rein.
 * Läuft bei Poker bereits ein Spiel, wird man automatisch Zuschauer
 * (oder übernimmt den eigenen getrennten Sitz per Namen).
 */

import { useState } from 'react';
import { api } from '../net';
import { loadName, saveName, useStore } from '../state/store';
import { navigate } from '../hooks/useHashRoute';

export function JoinRoom({ code }: { code: string }) {
  const connected = useStore((s) => s.connected);
  const addToast = useStore((s) => s.addToast);
  const session = useStore((s) => s.session);
  const [name, setName] = useState(loadName());
  const [busy, setBusy] = useState(false);

  const restoring = session?.code === code;

  async function join() {
    const n = name.trim();
    if (!n) return addToast('error', 'Bitte gib deinen Namen ein.');
    saveName(n);
    setBusy(true);
    await api.joinRoom(code, n);
    setBusy(false);
  }

  return (
    <div className="join-screen">
      <div className="panel join-card">
        <h1>🎮 PlayHub</h1>
        <p>
          Du wurdest in den Raum <strong className="code">{code}</strong> eingeladen.
        </p>
        {restoring ? (
          <p className="hint">Sitzung wird wiederhergestellt …</p>
        ) : (
          <>
            <label className="field">
              <span>Dein Name</span>
              <input
                className="input"
                maxLength={20}
                placeholder="z. B. Alex"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && join()}
              />
            </label>
            <button className="btn primary big" disabled={!connected || busy} onClick={join}>
              Beitreten
            </button>
          </>
        )}
        <button className="btn ghost" onClick={() => navigate({ page: 'home' })}>
          ← Zur Startseite
        </button>
      </div>
    </div>
  );
}
