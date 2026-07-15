/**
 * Generischer Chat: wird für Raum-Chat (Monopoly & Poker), Lobby-Chat und
 * im Spiel benutzt. Nachrichten kommen von außen, Senden läuft über onSend.
 */

import { useEffect, useRef, useState } from 'react';

export interface ChatEntry {
  id: number;
  time: number;
  name: string;
  color: string;
  text: string;
  mine?: boolean;
}

function timeHHMM(t: number): string {
  return new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

export function Chat({
  messages,
  onSend,
  quickMessages,
  placeholder = 'Nachricht …',
  emptyHint = 'Sag Hallo! 👋',
}: {
  messages: ChatEntry[];
  onSend: (text: string) => void | Promise<unknown>;
  quickMessages?: string[];
  placeholder?: string;
  emptyHint?: string;
}) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [messages.length]);

  async function send(raw?: string) {
    const t = (raw ?? text).trim();
    if (!t) return;
    if (!raw) setText('');
    await onSend(t);
  }

  return (
    <div className="chat-panel">
      <div className="chat-messages" ref={ref}>
        {messages.map((m) => (
          <div key={m.id} className={`chat-msg ${m.mine ? 'mine' : ''}`}>
            <span className="chat-name" style={{ color: m.color }}>
              {m.name}
            </span>
            <span className="chat-text">{m.text}</span>
            <span className="chat-time">{timeHHMM(m.time)}</span>
          </div>
        ))}
        {messages.length === 0 && <p className="hint">{emptyHint}</p>}
      </div>
      {quickMessages && quickMessages.length > 0 && (
        <div className="chat-quick">
          {quickMessages.map((q) => (
            <button key={q} className="btn ghost small" onClick={() => send(q)}>
              {q}
            </button>
          ))}
        </div>
      )}
      <div className="chat-input">
        <input
          className="input"
          maxLength={300}
          placeholder={placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          aria-label="Chat-Nachricht"
        />
        <button className="btn" onClick={() => send()} aria-label="Senden">
          ➤
        </button>
      </div>
    </div>
  );
}
