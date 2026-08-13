/**
 * End-to-End-Test der PWA-Fähigkeit: Manifest, Icons, Service-Worker-
 * Registrierung, Offline-Start der App-Shell und Cache-Regeln.
 *
 *   npm run build && npm run test:e2e:pwa
 *
 * Getestet wird mit Chromium (deckt Chrome/Edge/Android ab – dieselbe
 * Engine). iOS/Safari lässt sich hier nicht automatisiert prüfen; dafür
 * verifiziert der Test die Bausteine, auf die iOS angewiesen ist
 * (apple-touch-icon, apple-mobile-web-app-*-Metatags).
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';

/**
 * tests/ wird mit tsconfig.server.json übersetzt – also ohne DOM-Typen, damit
 * Servercode nicht versehentlich Browser-APIs benutzt. Die wenigen Globals,
 * die hier ausschließlich INNERHALB von page.evaluate() laufen, werden
 * deshalb lokal deklariert.
 */
declare const caches: {
  keys(): Promise<string[]>;
  open(name: string): Promise<{ keys(): Promise<{ url: string }[]> }>;
};
declare const navigator: {
  serviceWorker: {
    controller: unknown;
    getRegistration(): Promise<
      { active: { scriptURL: string; state: string } | null; scope: string } | undefined
    >;
  };
};

interface WebManifest {
  name?: string;
  short_name?: string;
  start_url?: string;
  display?: string;
  theme_color?: string;
  icons: { src: string; sizes: string; type?: string; purpose?: string }[];
  [key: string]: unknown;
}

async function launchBrowser(): Promise<Browser> {
  const args = ['--no-sandbox'];
  try {
    return await chromium.launch({ args });
  } catch (e) {
    const fallback = process.env.E2E_CHROMIUM ?? '/opt/pw-browsers/chromium';
    if (fs.existsSync(fallback)) {
      console.warn(`⚠ Standard-Chromium fehlt, nutze ${fallback}`);
      return chromium.launch({ args, executablePath: fallback });
    }
    throw e;
  }
}

const PORT = 4096;
const BASE_PATH = (process.env.E2E_BASE_PATH ?? '').trim().replace(/\/+$/, '');
const BASE = `http://localhost:${PORT}${BASE_PATH}`;

function fail(msg: string): never {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/healthz`);
      if (r.ok) return;
    } catch {
      // noch nicht bereit
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  fail('Server nicht erreichbar.');
}

/** Wartet, bis ein Service Worker die Seite kontrolliert. */
async function waitForServiceWorker(page: Page): Promise<void> {
  await page.waitForFunction(
    () => navigator.serviceWorker.controller !== null,
    undefined,
    { timeout: 20_000 }
  );
}

async function main() {
  const dataDir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'playhub-pwa-e2e-'));
  const server = spawn('npx', ['tsx', 'server/index.ts'], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, BASE_PATH },
    stdio: 'inherit',
  });
  const stopServer = () => {
    try {
      server.kill();
    } catch {
      // schon beendet
    }
  };
  process.on('exit', stopServer);

  const watchdog = setTimeout(() => fail('Watchdog: PWA-E2E hängt (> 120 s).'), 120_000);
  watchdog.unref();

  try {
    await waitForServer();
    console.log('✔ Server läuft');

    // --- 1) Manifest prüfen ------------------------------------------------
    const manifestRes = await fetch(`${BASE}/manifest.webmanifest`);
    if (!manifestRes.ok) fail('manifest.webmanifest nicht erreichbar.');
    const contentType = manifestRes.headers.get('content-type') ?? '';
    if (!/manifest\+json|application\/json/.test(contentType)) {
      fail(`Manifest mit falschem Content-Type ausgeliefert: ${contentType}`);
    }
    const manifest = (await manifestRes.json()) as WebManifest;
    for (const field of ['name', 'short_name', 'start_url', 'display', 'icons', 'theme_color']) {
      if (!(field in manifest)) fail(`Manifest-Feld fehlt: ${field}`);
    }
    if (manifest.display !== 'standalone') fail('display muss "standalone" sein.');
    const sizes = manifest.icons.map((i) => i.sizes);
    if (!sizes.includes('192x192') || !sizes.includes('512x512')) {
      fail(`Icons 192/512 fehlen im Manifest (vorhanden: ${sizes.join(', ')}).`);
    }
    const hasMaskable = manifest.icons.some((i) => i.purpose === 'maskable');
    if (!hasMaskable) fail('Maskable-Icon fehlt (Android schneidet sonst ab).');
    console.log(`✔ Manifest gültig (${manifest.icons.length} Icons, inkl. maskable)`);

    // --- 2) Icons wirklich abrufbar? ---------------------------------------
    for (const icon of manifest.icons) {
      const r = await fetch(new URL(icon.src, `${BASE}/manifest.webmanifest`).href);
      if (!r.ok) fail(`Icon nicht erreichbar: ${icon.src}`);
      const buf = Buffer.from(await r.arrayBuffer());
      // PNG-Signatur prüfen
      if (buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') fail(`Kein gültiges PNG: ${icon.src}`);
    }
    const appleIcon = await fetch(`${BASE}/icons/apple-touch-icon.png`);
    if (!appleIcon.ok) fail('apple-touch-icon.png fehlt (iOS-Installation).');
    console.log('✔ Alle Icons erreichbar und valide PNGs (inkl. apple-touch-icon für iOS)');

    const browser = await launchBrowser();
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    context.setDefaultTimeout(15_000);
    const page = await context.newPage();
    page.on('pageerror', (e) => fail(`JS-Fehler: ${e.message}`));

    // --- 3) iOS-Metatags im HTML -------------------------------------------
    await page.goto(BASE);
    const iosCapable = await page.locator('meta[name="apple-mobile-web-app-capable"]').getAttribute('content');
    const themeColor = await page.locator('meta[name="theme-color"]').getAttribute('content');
    const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
    if (iosCapable !== 'yes') fail('apple-mobile-web-app-capable fehlt/falsch.');
    if (!themeColor) fail('theme-color fehlt.');
    if (!manifestHref) fail('Manifest-Link fehlt im HTML.');
    console.log('✔ HTML-Metatags für iOS/Android vorhanden');

    // --- 4) Service Worker registriert sich --------------------------------
    await waitForServiceWorker(page);
    const swInfo = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return {
        scriptURL: reg?.active?.scriptURL ?? '',
        state: reg?.active?.state ?? '',
        scope: reg?.scope ?? '',
      };
    });
    if (swInfo.state !== 'activated') fail(`Service Worker nicht aktiv: ${swInfo.state}`);
    if (!/sw\.js\?v=.+/.test(swInfo.scriptURL)) {
      fail(`Service Worker ohne Build-Kennung registriert: ${swInfo.scriptURL}`);
    }
    console.log(`✔ Service Worker aktiv (${swInfo.scriptURL.split('/').pop()})`);

    // --- 5) Caches gefüllt, aber ohne Echtzeit-Verkehr ---------------------
    // Kurz warten, bis die Assets durch den Worker gelaufen sind.
    await page.reload();
    await waitForServiceWorker(page);
    await page.waitForTimeout(800);
    // Hinweis: tests/ wird ohne DOM-Typen kompiliert (tsconfig.server.json),
    // deshalb ist der Rückgabetyp hier explizit annotiert.
    const cacheReport = await page.evaluate<{ names: string[]; urls: string[] }>(async () => {
      const names: string[] = await caches.keys();
      const urls: string[] = [];
      for (const n of names) {
        const keys = await (await caches.open(n)).keys();
        urls.push(...keys.map((k: { url: string }) => k.url));
      }
      return { names, urls };
    });
    if (!cacheReport.names.some((n) => n.startsWith('playhub-'))) {
      fail(`Keine PlayHub-Caches angelegt: ${cacheReport.names.join(', ')}`);
    }
    if (!cacheReport.urls.some((u) => /\/assets\/.*\.js$/.test(u))) {
      fail('Gehashte JS-Assets wurden nicht gecacht.');
    }
    if (cacheReport.urls.some((u) => u.includes('/socket.io/'))) {
      fail('Socket.io-Verkehr darf niemals gecacht werden!');
    }
    console.log(`✔ Caches korrekt befüllt (${cacheReport.urls.length} Einträge, kein Socket.io)`);

    // --- 6) Offline-Start der App-Shell ------------------------------------
    await context.setOffline(true);
    await page.reload();
    // Die Startseite muss auch ohne Netz erscheinen (Multiplayer natürlich nicht).
    await page.locator('.home').waitFor({ timeout: 15_000 });
    await page.getByText('PlayHub').first().waitFor();
    const offlineGamesVisible = await page.locator('.game-choice').count();
    if (offlineGamesVisible < 2) fail('Spiele-Katalog ist offline nicht sichtbar.');
    // Verbindungsanzeige muss ehrlich "offline" melden
    await page.locator('.conn-pill.bad').waitFor();
    console.log(`✔ Offline: App-Shell lädt, ${offlineGamesVisible} Spiele sichtbar, Status ehrlich "getrennt"`);
    await context.setOffline(false);

    // --- 7) Update-Erkennung: neue Build-Kennung = neuer Worker ------------
    const swSource = await (await fetch(`${BASE}/sw.js`)).text();
    if (!swSource.includes("searchParams.get('v')")) {
      fail('Service Worker liest die Build-Kennung nicht aus der URL.');
    }
    if (!/network-first|networkFirst/i.test(swSource) && !swSource.includes("request.mode === 'navigate'")) {
      fail('Service Worker behandelt Navigation nicht network-first (Gefahr veralteter HTML).');
    }
    console.log('✔ Cache-Busting: Worker versioniert sich über die Build-Kennung, HTML läuft network-first');

    await browser.close();
    console.log('\n🎉 PWA-E2E erfolgreich – installierbar, offline-fähig, update-sicher');
    stopServer();
    process.exit(0);
  } catch (e) {
    stopServer();
    throw e;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
