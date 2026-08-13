/**
 * PlayHub Service Worker – App-Shell-Caching für Offline-Fähigkeit der
 * Oberfläche. Multiplayer braucht weiterhin eine Verbindung; offline
 * funktionieren die UI, die Assets und der lokale Pass-&-Play-Modus.
 *
 * Cache-Busting-Strategie (wichtig: keine veralteten Assets nach Updates):
 *
 *  - Die Version kommt als ?v=<BUILD_ID> aus der Registrierungs-URL. Bei
 *    jedem Build ändert sich die URL → der Browser sieht einen NEUEN Service
 *    Worker und installiert ihn, ganz ohne manuelles Hochzählen.
 *  - Navigations-/HTML-Anfragen laufen NETWORK-FIRST. Online bekommt man
 *    also immer das frische index.html, das auf die neuen, gehashten
 *    Asset-Namen zeigt. Offline greift die Kopie aus dem Cache.
 *  - Gehashte Assets (/assets/index-ABC123.js) laufen CACHE-FIRST. Sie sind
 *    unveränderlich – ändert sich der Inhalt, ändert sich der Dateiname.
 *  - Beim Aktivieren werden alle Caches fremder Versionen gelöscht. Das
 *    kostet einmalig pro Deployment ein erneutes Laden der Assets und
 *    garantiert dafür, dass nichts Altes überlebt.
 *  - Socket.io und alles außer GET werden nie angefasst.
 */

const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const SHELL_CACHE = `playhub-shell-${VERSION}`;
const ASSET_CACHE = `playhub-assets-${VERSION}`;

/** Basispfad der App (funktioniert auch unter einem Unterpfad wie /playhub/). */
const BASE = new URL('./', self.location.href).pathname;
const INDEX_URL = `${BASE}index.html`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // index.html vorwärmen, damit der erste Offline-Start klappt.
      await cache.add(new Request(INDEX_URL, { cache: 'reload' })).catch(() => {});
      // BEWUSST kein skipWaiting(): Ein Update darf eine laufende Partie
      // niemals ungefragt neu laden. Der neue Worker wartet, die App zeigt
      // ein "Neue Version"-Banner, und erst ein Klick löst den Wechsel aus
      // (siehe message-Handler unten). Bei der Erstinstallation gibt es
      // nichts zu verdrängen – der Worker wird ohnehin sofort aktiv.
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith('playhub-') && k !== SHELL_CACHE && k !== ASSET_CACHE)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

/** Der Client kann ein sofortiges Update anstoßen ("Neu laden"-Banner). */
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

function isHashedAsset(url) {
  // Vite erzeugt content-gehashte Namen: index-4yDlAJ8w.js
  return /\/assets\/.+-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Echtzeit-Verkehr und Healthcheck niemals cachen
  if (url.pathname.includes('/socket.io/') || url.pathname.endsWith('/healthz')) return;

  // 1) Navigation → network-first (frisches HTML, offline aus dem Cache)
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(SHELL_CACHE);
          cache.put(INDEX_URL, fresh.clone());
          return fresh;
        } catch {
          const cached = (await caches.match(INDEX_URL)) || (await caches.match(request));
          return cached || new Response('Offline', { status: 503, statusText: 'Offline' });
        }
      })()
    );
    return;
  }

  // 2) Gehashte Assets → cache-first (unveränderlich)
  if (isHashedAsset(url)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        const fresh = await fetch(request);
        if (fresh.ok) {
          const cache = await caches.open(ASSET_CACHE);
          cache.put(request, fresh.clone());
        }
        return fresh;
      })()
    );
    return;
  }

  // 3) Übriges Statisches (Icons, Manifest) → stale-while-revalidate
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      const network = fetch(request)
        .then(async (fresh) => {
          if (fresh.ok) {
            const cache = await caches.open(ASSET_CACHE);
            cache.put(request, fresh.clone());
          }
          return fresh;
        })
        .catch(() => null);
      return cached || (await network) || new Response('Offline', { status: 503 });
    })()
  );
});
