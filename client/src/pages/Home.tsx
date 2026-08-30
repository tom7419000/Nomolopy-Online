/**
 * PlayHub-Startseite: Nickname, Spiele-Katalog, Raum erstellen/beitreten,
 * öffentliche Räume und globaler Lobby-Chat.
 */

import { useMemo, useState } from 'react';
import { GAME_CATALOG, getGameInfo, type GameId, type GameInfo } from '@shared/games';
import { DEFAULT_POKER_RULES } from '@shared/poker/rules';
import type { PokerRules } from '@shared/poker/types';
import { DEFAULT_JEOPARDY_RULES } from '@shared/jeopardy/rules';
import type { JeopardyRules } from '@shared/jeopardy/types';
import { moduleFor } from '@shared/registry';
import { api } from '../net';
import { loadName, saveName, useStore } from '../state/store';
import { Chat } from '../components/Chat';
import { Modal } from '../components/Modal';
import { LocalSetup } from './LocalSetup';
import { CLIENT_GAMES } from '../games/registry';

function GameCard({
  info,
  onCreate,
  onLocal,
}: {
  info: GameInfo;
  onCreate: () => void;
  onLocal: () => void;
}) {
  return (
    <article className={`game-choice game-${info.id}`}>
      <div className="game-choice-emoji" aria-hidden>
        {info.emoji}
      </div>
      <h3>{info.name}</h3>
      <p className="tagline">{info.tagline}</p>
      <p className="game-choice-desc">{info.description}</p>
      <div className="game-choice-meta">
        <span>👥 {info.minPlayers}–{info.maxPlayers} Spieler</span>
        <span>⏱ {info.duration}</span>
      </div>
      <div className="game-choice-actions">
        <button className="btn primary" onClick={onCreate}>
          Raum erstellen
        </button>
        {/* Braucht weder Name noch Verbindung – das ist der ganze Punkt. */}
        <button className="btn" onClick={onLocal}>
          📱 Am Gerät spielen
        </button>
      </div>
    </article>
  );
}

function CreateRoomDialog({
  gameId,
  name,
  onClose,
}: {
  gameId: GameId;
  name: string;
  onClose: () => void;
}) {
  const info = getGameInfo(gameId);
  const CreateFields = CLIENT_GAMES[gameId].CreateFields;
  const [roomName, setRoomName] = useState(`${name}s ${info.name}-Runde`);
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [maxPlayers, setMaxPlayers] = useState(info.maxPlayers);
  const [editionId, setEditionId] = useState('classic-de');
  const [presetId, setPresetId] = useState('classic');
  const [poker, setPoker] = useState<PokerRules>({ ...DEFAULT_POKER_RULES });
  const [jeopardy, setJeopardy] = useState<JeopardyRules>({ ...DEFAULT_JEOPARDY_RULES });
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    const r = await api.createRoom({
      name,
      gameId,
      roomName,
      description,
      isPublic,
      maxPlayers,
      editionId,
      presetId,
      pokerRules: poker,
      jeopardyRules: jeopardy,
    });
    setBusy(false);
    if (r.ok) onClose();
  }

  return (
    <Modal title={`${info.emoji} ${info.name}-Raum erstellen`} onClose={onClose}>
      <label className="field">
        <span>Raumname</span>
        <input className="input" maxLength={40} value={roomName} onChange={(e) => setRoomName(e.target.value)} />
      </label>
      <label className="field">
        <span>Beschreibung (optional)</span>
        <input
          className="input"
          maxLength={120}
          placeholder="z. B. Feierabendrunde – alle willkommen!"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <div className="field-row">
        <label className="field">
          <span>Max. Spieler</span>
          <input
            type="number"
            className="input small"
            min={info.minPlayers}
            max={info.maxPlayers}
            value={maxPlayers}
            onChange={(e) => setMaxPlayers(Number(e.target.value))}
          />
        </label>
        <label className="rule-row boolean grow">
          <span>Öffentlich sichtbar (Raumliste)</span>
          <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
        </label>
      </div>

      <CreateFields
        editionId={editionId}
        setEditionId={setEditionId}
        presetId={presetId}
        setPresetId={setPresetId}
        poker={poker as unknown as Record<string, unknown>}
        setPoker={(v) => setPoker(v as unknown as PokerRules)}
        jeopardy={jeopardy as unknown as Record<string, unknown>}
        setJeopardy={(v) => setJeopardy(v as unknown as JeopardyRules)}
      />

      <button className="btn primary big" disabled={busy} onClick={create}>
        {info.emoji} Raum erstellen
      </button>
    </Modal>
  );
}

export function Home() {
  const connected = useStore((s) => s.connected);
  const lobbyRooms = useStore((s) => s.lobbyRooms);
  const lobbyChat = useStore((s) => s.lobbyChat);
  const openDialog = useStore((s) => s.openDialog);
  const session = useStore((s) => s.session);
  const addToast = useStore((s) => s.addToast);

  const [name, setName] = useState(loadName());
  const [code, setCode] = useState('');
  const [createFor, setCreateFor] = useState<GameId | null>(null);
  const [localFor, setLocalFor] = useState<GameId | null>(null);
  const [busy, setBusy] = useState(false);

  const cleanedName = name.trim();

  function requireName(): boolean {
    if (!cleanedName) {
      addToast('error', 'Bitte gib zuerst deinen Namen ein.');
      return false;
    }
    saveName(cleanedName);
    return true;
  }

  async function join(joinCode: string) {
    if (!requireName()) return;
    if (!joinCode.trim()) return addToast('error', 'Bitte gib den Raum-Code ein.');
    setBusy(true);
    await api.joinRoom(joinCode.trim().toUpperCase(), cleanedName);
    setBusy(false);
  }

  const chatEntries = useMemo(
    () =>
      lobbyChat.map((m) => ({
        id: m.id,
        time: m.time,
        name: m.name,
        color: m.color,
        text: m.text,
        mine: m.name === cleanedName,
      })),
    [lobbyChat, cleanedName]
  );

  return (
    <div className="home">
      <header className="start-hero">
        <div className="logo-board" aria-hidden>
          <span style={{ background: '#ed1b24' }} />
          <span style={{ background: '#f7941d' }} />
          <span style={{ background: '#1fb25a' }} />
          <span style={{ background: '#0072bb' }} />
        </div>
        <h1>
          PlayHub <span className="hero-sub">Spieleabend, online.</span>
        </h1>
        <p className="tagline">Erstelle einen Raum, teile den Link – und spiel mit deinen Freunden.</p>
        <div className={`conn-pill ${connected ? 'ok' : 'bad'}`}>
          <span className="dot" /> {connected ? 'Mit Server verbunden' : 'Verbinde mit Server …'}
        </div>
      </header>

      {session && !useStore.getState().room && (
        <div className="resume-banner">Letzte Sitzung wird wiederhergestellt …</div>
      )}

      <div className="home-name-row">
        <section className="panel name-panel">
          <h2>👤 Dein Name</h2>
          <input
            className="input"
            maxLength={20}
            placeholder="z. B. Alex"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => cleanedName && saveName(cleanedName)}
            aria-label="Spielername"
          />
        </section>
        <section className="panel join-panel">
          <h2>🔑 Mit Code beitreten</h2>
          <div className="join-row">
            <input
              className="input code-input"
              maxLength={5}
              placeholder="Q7WK3"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && join(code)}
              aria-label="Raum-Code"
            />
            <button className="btn primary" disabled={!connected || busy} onClick={() => join(code)}>
              Beitreten
            </button>
          </div>
          <p className="hint">Code oder Link bekommst du vom Host.</p>
        </section>
      </div>

      <h2 className="home-section-title">🎮 Spiele</h2>
      <div className="game-grid">
        {GAME_CATALOG.map((info) => (
          <GameCard
            key={info.id}
            info={info}
            onCreate={() => {
              if (requireName()) setCreateFor(info.id);
            }}
            onLocal={() => setLocalFor(info.id)}
          />
        ))}
      </div>

      <div className="home-lower">
        <section className="panel rooms-panel">
          <h2>🌐 Öffentliche Räume</h2>
          {lobbyRooms.length === 0 && (
            <p className="hint">
              Gerade ist kein öffentlicher Raum offen. Erstelle einen und mach ihn „öffentlich" –
              oder teile deinen Raum-Link privat.
            </p>
          )}
          <ul className="room-list">
            {lobbyRooms.map((r) => {
              const info = getGameInfo(r.gameId);
              const joinable = r.phase === 'lobby' && r.playerCount < r.maxPlayers;
              return (
                <li key={r.code}>
                  <span className="room-emoji" aria-hidden>
                    {info.emoji}
                  </span>
                  <span className="room-name">
                    {r.name}
                    <span className="hint">
                      {info.name} · Host: {r.hostName} · {r.playerCount}/{r.maxPlayers}
                      {r.phase === 'playing' && ' · läuft'}
                    </span>
                  </span>
                  <button
                    className="btn small"
                    disabled={!joinable && !moduleFor(r.gameId).caps.spectators}
                    onClick={() => join(r.code)}
                  >
                    {r.phase === 'lobby'
                      ? 'Beitreten'
                      : moduleFor(r.gameId).caps.spectators
                        ? 'Zuschauen'
                        : 'Läuft'}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="panel lobby-chat-panel">
          <h2>💬 Lobby-Chat</h2>
          <Chat
            messages={chatEntries}
            emptyHint="Noch ganz ruhig hier – sag Hallo! 👋"
            onSend={(text) => {
              if (!requireName()) return;
              return api.lobbyChat(cleanedName, text);
            }}
          />
        </section>
      </div>

      <footer className="start-footer">
        <button className="btn ghost" onClick={() => openDialog({ type: 'packs' })}>
          📚 Fragenpakete (Trivia)
        </button>
        <button className="btn ghost" onClick={() => openDialog({ type: 'admin' })}>
          ⚙️ Admin-Bereich (Monopoly-Editionen)
        </button>
        <p className="hint">Spielgeld only – keine echten Transaktionen.</p>
      </footer>

      {createFor && <CreateRoomDialog gameId={createFor} name={cleanedName} onClose={() => setCreateFor(null)} />}
      {localFor && <LocalSetup gameId={localFor} onClose={() => setLocalFor(null)} />}
    </div>
  );
}
