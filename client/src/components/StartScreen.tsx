import { useState } from 'react';
import { api } from '../net/socket';
import { loadName, saveName, useStore } from '../state/store';

export function StartScreen() {
  const connected = useStore((s) => s.connected);
  const editions = useStore((s) => s.editions);
  const presets = useStore((s) => s.presets);
  const openDialog = useStore((s) => s.openDialog);
  const session = useStore((s) => s.session);

  const [name, setName] = useState(loadName());
  const [code, setCode] = useState('');
  const [editionId, setEditionId] = useState('classic-de');
  const [presetId, setPresetId] = useState('classic');
  const [busy, setBusy] = useState(false);

  const edition = editions.find((e) => e.id === editionId) ?? editions[0];
  const preset = presets.find((p) => p.id === presetId);

  async function create() {
    if (!name.trim()) return useStore.getState().addToast('error', 'Bitte gib zuerst deinen Namen ein.');
    saveName(name.trim());
    setBusy(true);
    await api.createRoom(name.trim(), edition?.id ?? 'classic-de', presetId);
    setBusy(false);
  }

  async function join() {
    if (!name.trim()) return useStore.getState().addToast('error', 'Bitte gib zuerst deinen Namen ein.');
    if (!code.trim()) return useStore.getState().addToast('error', 'Bitte gib den Raum-Code ein.');
    saveName(name.trim());
    setBusy(true);
    await api.joinRoom(code.trim().toUpperCase(), name.trim());
    setBusy(false);
  }

  return (
    <div className="start-screen">
      <header className="start-hero">
        <div className="logo-board" aria-hidden>
          <span style={{ background: '#ed1b24' }} />
          <span style={{ background: '#f7941d' }} />
          <span style={{ background: '#1fb25a' }} />
          <span style={{ background: '#0072bb' }} />
        </div>
        <h1>Nomolopy&nbsp;Online</h1>
        <p className="tagline">Das Brettspiel-Original als Online-Multiplayer – würfeln, kaufen, bauen, gewinnen.</p>
        <div className={`conn-pill ${connected ? 'ok' : 'bad'}`}>
          <span className="dot" /> {connected ? 'Mit Server verbunden' : 'Verbinde mit Server …'}
        </div>
      </header>

      {session && !useStore.getState().game && (
        <div className="resume-banner">Letzte Sitzung wird wiederhergestellt …</div>
      )}

      <div className="start-panels">
        <section className="panel">
          <h2>👤 Dein Name</h2>
          <input
            className="input"
            maxLength={20}
            placeholder="z. B. Alex"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Spielername"
          />
        </section>

        <section className="panel">
          <h2>✨ Neues Spiel erstellen</h2>
          <label className="field">
            <span>Edition</span>
            <select className="input" value={edition?.id ?? ''} onChange={(e) => setEditionId(e.target.value)}>
              {editions.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                  {e.builtIn ? '' : ' (eigene)'}
                </option>
              ))}
            </select>
          </label>
          {edition?.description && <p className="hint">{edition.description}</p>}
          <label className="field">
            <span>Regel-Preset</span>
            <select className="input" value={presetId} onChange={(e) => setPresetId(e.target.value)}>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {preset && <p className="hint">{preset.description}</p>}
          <button className="btn primary big" disabled={!connected || busy} onClick={create}>
            Spiel erstellen
          </button>
        </section>

        <section className="panel">
          <h2>🔑 Spiel beitreten</h2>
          <label className="field">
            <span>Raum-Code</span>
            <input
              className="input code-input"
              maxLength={5}
              placeholder="z. B. Q7WK3"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && join()}
              aria-label="Raum-Code"
            />
          </label>
          <p className="hint">Den 5-stelligen Code bekommst du vom Spiel-Host.</p>
          <button className="btn primary big" disabled={!connected || busy} onClick={join}>
            Beitreten
          </button>
        </section>
      </div>

      <footer className="start-footer">
        <button className="btn ghost" onClick={() => openDialog({ type: 'admin' })}>
          ⚙️ Admin-Bereich (Editionen &amp; Spielstände)
        </button>
        <p className="hint">2–8 Spieler · Spielgeld, keine echten Transaktionen</p>
      </footer>
    </div>
  );
}
