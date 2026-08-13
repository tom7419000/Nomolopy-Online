/**
 * Zwei dezente Hinweise am unteren Rand:
 *  - „App installieren" (sobald der Browser das Installieren anbietet;
 *     auf iOS mit manueller Anleitung, weil Safari kein Event feuert)
 *  - „Neue Version verfügbar" (wenn der Service Worker ein Update bereithält)
 *
 * Beide sind wegklickbar; die Ablehnung merkt sich die App, damit niemand
 * bei jedem Besuch dieselbe Leiste sieht.
 */

import { useEffect, useState } from 'react';
import {
  applyUpdate,
  isIos,
  isStandalone,
  registerServiceWorker,
  type InstallPromptEvent,
} from '../pwa/register';

const DISMISS_KEY = 'playhub.installDismissedAt';
/** Nach einer Ablehnung 14 Tage Ruhe geben. */
const DISMISS_MS = 14 * 24 * 60 * 60 * 1000;

function dismissedRecently(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    return raw ? Date.now() - Number(raw) < DISMISS_MS : false;
  } catch {
    return false;
  }
}

function rememberDismissal(): void {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    // ignorieren
  }
}

export function InstallBanner() {
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    registerServiceWorker(() => setUpdateReady(true));
  }, []);

  useEffect(() => {
    if (isStandalone() || dismissedRecently()) return;

    const onPrompt = (e: Event) => {
      e.preventDefault(); // Browser-eigene Leiste unterdrücken, eigene zeigen
      setPromptEvent(e as InstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    const onInstalled = () => {
      setPromptEvent(null);
      setShowIosHint(false);
    };
    window.addEventListener('appinstalled', onInstalled);

    // iOS feuert kein beforeinstallprompt → nach kurzer Verzögerung
    // die manuelle Anleitung anbieten.
    let timer: number | undefined;
    if (isIos()) {
      timer = window.setTimeout(() => setShowIosHint(true), 4000);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  function dismiss() {
    rememberDismissal();
    setPromptEvent(null);
    setShowIosHint(false);
  }

  async function install() {
    if (!promptEvent) return;
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice.outcome === 'dismissed') rememberDismissal();
    setPromptEvent(null);
  }

  if (updateReady) {
    return (
      <div className="pwa-banner update" role="status">
        <span className="pwa-banner-text">
          <strong>Neue Version verfügbar</strong>
          <span className="hint">Neu laden, um die Aktualisierung zu übernehmen.</span>
        </span>
        <button className="btn primary small" onClick={applyUpdate}>
          ↻ Neu laden
        </button>
        <button className="btn ghost small" onClick={() => setUpdateReady(false)} aria-label="Später">
          ✕
        </button>
      </div>
    );
  }

  if (promptEvent) {
    return (
      <div className="pwa-banner" role="status">
        <span className="pwa-banner-icon" aria-hidden>
          📲
        </span>
        <span className="pwa-banner-text">
          <strong>PlayHub installieren</strong>
          <span className="hint">Startet im eigenen Fenster – ohne Adressleiste.</span>
        </span>
        <button className="btn primary small" onClick={install}>
          Installieren
        </button>
        <button className="btn ghost small" onClick={dismiss} aria-label="Nicht installieren">
          ✕
        </button>
      </div>
    );
  }

  if (showIosHint) {
    return (
      <div className="pwa-banner" role="status">
        <span className="pwa-banner-icon" aria-hidden>
          📲
        </span>
        <span className="pwa-banner-text">
          <strong>Zum Home-Bildschirm hinzufügen</strong>
          <span className="hint">
            In Safari auf „Teilen" <span aria-hidden>􀈂</span> tippen, dann „Zum Home-Bildschirm".
          </span>
        </span>
        <button className="btn ghost small" onClick={dismiss} aria-label="Hinweis schließen">
          ✕
        </button>
      </div>
    );
  }

  return null;
}
