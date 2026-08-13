/**
 * Service-Worker-Registrierung und Update-Erkennung.
 *
 * Die Build-Kennung wandert als ?v=… in die Worker-URL: Bei jedem Build
 * ändert sich die URL, der Browser erkennt einen neuen Worker und lädt ihn –
 * ohne dass jemand eine Versionsnummer von Hand hochzählen muss.
 *
 * Alle Pfade sind relativ, damit die App auch unter einem Unterpfad
 * (https://example.de/playhub/) funktioniert.
 */

type UpdateCallback = () => void;

let waitingWorker: ServiceWorker | null = null;

export function applyUpdate(): void {
  waitingWorker?.postMessage('skip-waiting');
  waitingWorker = null;
}

/**
 * Registriert den Service Worker. `onUpdateReady` wird aufgerufen, sobald
 * eine neue Version bereitliegt – die UI zeigt dann einen „Neu laden"-Hinweis.
 */
export function registerServiceWorker(onUpdateReady: UpdateCallback): void {
  if (!('serviceWorker' in navigator)) return;
  // Im Dev-Server (Vite) würde der Worker nur stören.
  if (import.meta.env.DEV) return;

  const start = async () => {
    try {
      const swUrl = new URL(`sw.js?v=${__BUILD_ID__}`, document.baseURI);
      const registration = await navigator.serviceWorker.register(swUrl, {
        scope: new URL('./', document.baseURI).pathname,
      });

      // Schon ein Worker in Wartestellung? (Tab war lange offen)
      if (registration.waiting && navigator.serviceWorker.controller) {
        waitingWorker = registration.waiting;
        onUpdateReady();
      }

      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          // "installed" + vorhandener Controller = Update (kein Erstbesuch)
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            waitingWorker = installing;
            onUpdateReady();
          }
        });
      });

      // Nach einem Worker-WECHSEL einmalig neu laden, damit die neuen Assets
      // greifen. Bei der Erstinstallation übernimmt der Worker die Seite
      // ebenfalls (clients.claim), aber dort wäre ein Reload falsch: Die
      // Seite läuft bereits auf den aktuellen Assets, und ein Neuladen
      // mitten im Spielbeitritt würde die Eingaben verwerfen.
      const hadController = navigator.serviceWorker.controller !== null;
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController || reloaded) return;
        reloaded = true;
        window.location.reload();
      });
    } catch (e) {
      // Ohne Service Worker läuft die App ganz normal weiter – nur ohne Offline-Modus.
      console.warn('Service Worker konnte nicht registriert werden:', e);
    }
  };

  // Erst nach dem Laden registrieren, damit die Registrierung nicht mit dem
  // Start der App um Bandbreite konkurriert. Wichtig: React-Effekte laufen
  // nach dem Paint – "load" kann da längst gefeuert haben, ein reiner
  // Listener würde also nie auslösen.
  if (document.readyState === 'complete') void start();
  else window.addEventListener('load', () => void start(), { once: true });
}

// ---------------------------------------------------------------------------
// Installation ("Zum Startbildschirm hinzufügen")
// ---------------------------------------------------------------------------

export interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Läuft die App bereits installiert (Standalone-Fenster)? */
export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS-Safari kennt display-mode nicht, sondern navigator.standalone
    (navigator as { standalone?: boolean }).standalone === true
  );
}

export function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}
