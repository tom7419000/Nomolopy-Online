/**
 * End-to-End-Test des lokalen Pass-&-Play-Modus.
 *
 *   npm run build && npm run test:e2e:local
 *
 * Der Server wird nur gebraucht, um die gebaute App AUSZULIEFERN. Sobald die
 * Seite geladen ist, wird das Netz abgeschaltet – alles danach beweist die
 * Offline-Behauptung. Am Ende wird geprüft, dass kein einziges Byte an
 * Socket.io gegangen ist.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';

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

const PORT = 4099;
const BASE = `http://localhost:${PORT}`;
const SHOTS = process.env.E2E_SHOTS_DIR || 'test-results';

/** Tablet quer – das Zielgerät dieses Modus. */
const TABLET = { width: 1180, height: 820 };

/**
 * tests/ wird ohne DOM-Typen übersetzt (tsconfig.server.json); die Globals
 * laufen ausschließlich innerhalb von page.waitForFunction().
 */
declare const navigator: { serviceWorker: { controller: unknown } };
declare const document: {
  querySelector(sel: string): { getAttribute(name: string): string | null } | null;
};
declare const getComputedStyle: (el: unknown) => { transform: string };

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

/** Trägt die Namen in den Setup-Bildschirm ein und startet. */
async function setupLocalGame(
  page: Page,
  names: string[],
  seatMode: 'pass' | 'fixed' = 'pass'
): Promise<void> {
  if (seatMode === 'fixed') await page.getByRole('button', { name: /Feste Plätze/ }).click();
  for (let i = 2; i < names.length; i++) {
    await page.getByRole('button', { name: /Spieler hinzufügen/ }).click();
  }
  for (let i = 0; i < names.length; i++) {
    await page.getByLabel(`Name Spieler ${i + 1}`).fill(names[i]);
  }
  await page.getByRole('button', { name: /Spiel starten/ }).click();
}

/**
 * Liest die Ausrichtung des Bretts als Winkel in [0, 360).
 */
async function dockEdge(page: Page): Promise<string> {
  return page.evaluate<string>(() => {
    const el = document.querySelector('.seat-dock');
    return el ? (el.getAttribute('data-edge') ?? '?') : 'kein Dock';
  });
}

/**
 * Die Transformation des Bretts.
 *
 * Muss `none` sein: ein Brett liegt auf dem Tisch und bleibt liegen. Bis
 * Schritt 6 drehte sich hier genau das Falsche – deshalb ist das die
 * Zusicherung, um die es geht.
 */
async function boardTransform(page: Page): Promise<string> {
  return page.evaluate<string>(() => {
    const el = document.querySelector('.board');
    return el ? getComputedStyle(el).transform : 'kein Brett';
  });
}

/** Beendet den laufenden Monopoly-Zug, egal welche Phase ansteht. */
async function finishTurn(page: Page): Promise<void> {
  const tap = (l: ReturnType<Page['locator']>) => l.click({ timeout: 2000 }).catch(() => {});
  for (let i = 0; i < 20; i++) {
    if (await page.locator('.game-card').isVisible().catch(() => false)) {
      await tap(page.getByRole('button', { name: 'OK' }));
    } else if (await page.locator('.auction-box').isVisible().catch(() => false)) {
      // Das „Originalversion"-Preset versteigert ausgeschlagene Grundstücke.
      // Am geteilten Gerät wandert die Identität zu jedem Bieter, also reicht
      // wiederholtes Passen, bis die Auktion durch ist.
      await tap(page.getByRole('button', { name: 'Passen' }));
    } else if (await page.getByRole('button', { name: 'Nicht kaufen' }).isVisible().catch(() => false)) {
      await tap(page.getByRole('button', { name: 'Nicht kaufen' }));
    } else if (
      await page.getByRole('button', { name: /Zug beenden|Nochmal würfeln/ }).isVisible().catch(() => false)
    ) {
      await tap(page.getByRole('button', { name: /Zug beenden|Nochmal würfeln/ }));
      return;
    } else if (await page.getByRole('button', { name: /Würfeln/ }).first().isVisible().catch(() => false)) {
      await tap(page.getByRole('button', { name: /Würfeln/ }).first());
    }
    await page.waitForTimeout(250);
  }
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'playhub-local-e2e-'));
  // `detached` gibt dem Server eine eigene Prozessgruppe. Ohne das trifft
  // `kill()` nur die npx-Hülle: der Node-Prozess darunter überlebt, hält den
  // Port – und der NÄCHSTE Lauf redet dann mit dem alten Server, statt
  // abzubrechen. Ein grüner Test gegen veralteten Code ist schlimmer als
  // ein roter.
  const server = spawn('npx', ['tsx', 'server/index.ts'], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir },
    stdio: 'inherit',
    detached: true,
  });
  const stopServer = () => {
    try {
      // Negative PID = die ganze Prozessgruppe, also auch das Kind von npx.
      if (server.pid) process.kill(-server.pid, 'SIGKILL');
    } catch {
      // schon beendet
    }
  };
  process.on('exit', stopServer);

  const watchdog = setTimeout(() => fail('Watchdog: Lokal-E2E hängt (> 150 s).'), 150_000);
  watchdog.unref();

  try {
    await waitForServer();
    console.log('✔ Server läuft (liefert nur die App aus)');

    const browser = await launchBrowser();
    const context = await browser.newContext({ viewport: TABLET });
    context.setDefaultTimeout(15_000);
    const page = await context.newPage();
    page.on('pageerror', (e) => fail(`JS-Fehler: ${e.message}`));

    // Jeder Socket.io-Kontakt WÄHREND einer lokalen Partie wäre ein
    // Widerspruch zur Behauptung „läuft ohne Server". Beim Verlassen des
    // lokalen Modus darf die Verbindung dagegen wieder aufgebaut werden –
    // der Spieler landet dann in der Online-Lobby.
    let socketTraffic: string | null = null;
    let watchSocket = false;
    page.on('request', (r) => {
      if (watchSocket && r.url().includes('/socket.io/')) socketTraffic = r.url();
    });

    // --- 1) App laden, dann Netz kappen -----------------------------------
    await page.goto(BASE);
    await page.locator('.home').waitFor();

    // Der Reload in Schritt 4 kommt ohne Netz nur durch, wenn der Service
    // Worker die Seite bereits kontrolliert und index.html im Cache liegt.
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
      timeout: 20_000,
    });
    await page.reload();
    await page.locator('.home').waitFor();
    await page.waitForTimeout(600);

    await context.setOffline(true);
    watchSocket = true;
    console.log('✔ Netz abgeschaltet – ab hier läuft alles lokal');

    // --- 2) Monopoly lokal starten ----------------------------------------
    await page.locator('.game-monopoly').getByRole('button', { name: /Am Gerät spielen/ }).click();
    await setupLocalGame(page, ['Anna', 'Ben', 'Clara', 'Dora']);

    await page.locator('.board').waitFor();
    await page.locator('.pass-banner').waitFor();
    const pill = await page.locator('.conn-pill.local').textContent();
    if (!pill?.includes('am Gerät')) fail(`Statusanzeige falsch: ${pill}`);
    if (await page.locator('.reconnect-overlay').isVisible().catch(() => false)) {
      fail('Reconnect-Overlay im lokalen Modus sichtbar.');
    }
    console.log('✔ Monopoly läuft offline, Band und Statusanzeige stimmen');

    // --- 3) Züge spielen, Sitz muss wandern -------------------------------
    const seatNow = () => page.locator('.pass-banner strong').textContent();
    const first = await seatNow();
    for (let i = 0; i < 3; i++) await finishTurn(page);
    const later = await seatNow();
    if (!first || !later) fail('Kein aktiver Spieler im Band.');
    if (first === later) fail(`Der Zug ist nicht weitergewandert (immer ${first}).`);
    console.log(`✔ Zug wandert weiter: ${first} → ${later}`);

    await page.screenshot({ path: path.join(SHOTS, 'local-monopoly.png') });

    // --- 4) Reload OHNE Netz: die Partie muss zurückkommen ----------------
    const moneyBefore = await page.locator('.player-card').first().innerText();
    await page.reload();
    await page.locator('.board').waitFor({ timeout: 20_000 });
    const moneyAfter = await page.locator('.player-card').first().innerText();
    if (moneyBefore !== moneyAfter) {
      fail(`Spielstand nach Reload verändert:\n${moneyBefore}\n---\n${moneyAfter}`);
    }
    console.log('✔ Reload ohne Netz: Partie unverändert wiederhergestellt');

    // --- 5) Partie beenden, dann Poker ------------------------------------
    // Beim Verlassen wird die Verbindung bewusst wieder aufgenommen; für
    // diesen Moment ist Socket-Verkehr also richtig und nicht zu beanstanden.
    watchSocket = false;
    page.on('dialog', (d) => d.accept());
    await page.getByTitle('Partie beenden').click();
    await page.locator('.home').waitFor();

    await page.locator('.game-poker').getByRole('button', { name: /Am Gerät spielen/ }).click();
    await setupLocalGame(page, ['Anna', 'Ben', 'Clara']);
    await page.locator('.poker-felt').waitFor();
    watchSocket = true;
    console.log('✔ Poker läuft offline');

    // --- 6) Handkarten: verdeckt, bis gehalten wird ------------------------
    const myCards = page.locator('.my-cards .pcard');
    const backs = () => page.locator('.my-cards .pcard.back').count();

    await myCards.first().waitFor();
    if ((await backs()) !== 2) fail(`Handkarten liegen offen (${await backs()} verdeckt statt 2).`);
    if (await page.locator('.hand-hint').isVisible().catch(() => false)) {
      fail('Der Handname verrät die Stärke, obwohl die Karten verdeckt sind.');
    }

    const peek = page.getByRole('button', { name: /Karten ansehen/ });
    const box = await peek.boundingBox();
    if (!box) fail('Peek-Knopf nicht gefunden.');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(200);
    if ((await backs()) !== 0) fail('Karten bleiben beim Halten verdeckt.');
    await page.screenshot({ path: path.join(SHOTS, 'local-poker-peek.png') });
    await page.mouse.up();
    await page.waitForTimeout(200);
    if ((await backs()) !== 2) fail('Karten bleiben nach dem Loslassen offen.');
    console.log('✔ Halten deckt die Karten auf, Loslassen deckt sie wieder zu');

    // --- 7) Feste Plätze: die Ansicht dreht sich zum aktiven Spieler -------
    watchSocket = false;
    await page.getByTitle('Partie beenden').click();
    await page.locator('.home').waitFor();
    watchSocket = true;

    await page.locator('.game-monopoly').getByRole('button', { name: /Am Gerät spielen/ }).click();
    await setupLocalGame(page, ['Anna', 'Ben', 'Clara', 'Dora'], 'fixed');
    await page.locator('.board').waitFor();

    await page.locator('.seat-dock').waitFor();

    // Das Brett bleibt liegen. Bis Schritt 6 drehte es sich – und die
    // Bedienung blieb aufrecht, also genau falsch herum.
    const transform = await boardTransform(page);
    if (transform !== 'none') fail(`Das Brett dreht sich (${transform}) – es soll liegen bleiben.`);

    // Und die Seitenspalten sind weg: am Tisch gehört die Fläche dem Brett.
    if ((await page.locator('.game-layout').count()) !== 0) {
      fail('Im Tischmodus steht noch das Spaltenlayout.');
    }

    const seen = new Set<string>();
    const firstEdge = await dockEdge(page);
    seen.add(firstEdge);
    let edgeChanged = false;
    for (let i = 0; i < 6 && !edgeChanged; i++) {
      await finishTurn(page);
      const now = await dockEdge(page);
      seen.add(now);
      if (now !== firstEdge) edgeChanged = true;
    }
    if (!edgeChanged) {
      fail(`Das Dock bleibt immer an Kante ${firstEdge}° – es soll dem Spieler folgen.`);
    }
    if (await boardTransform(page) !== 'none') fail('Das Brett hat sich doch gedreht.');

    // Nach einem Reload muss die Sitzordnung noch stehen
    const before = await dockEdge(page);
    await page.reload();
    await page.locator('.seat-dock').waitFor({ timeout: 20_000 });
    const after = await dockEdge(page);
    if (before !== after) fail(`Sitzordnung nach Reload verloren: ${before}° → ${after}°`);
    await page.screenshot({ path: path.join(SHOTS, 'local-fixed-seats.png') });
    console.log(
      `✔ Feste Plätze: Brett liegt still, die Bedienung wandert an die Kante (${[...seen]
        .map((d) => `${d}°`)
        .join(', ')}) und überlebt einen Reload`
    );

    // --- 8) Kein einziger Socket.io-Kontakt --------------------------------
    if (socketTraffic) fail(`Socket.io-Verkehr während einer lokalen Partie: ${socketTraffic}`);
    console.log('✔ Kein Socket.io-Verkehr – der Modus kommt wirklich ohne Server aus');

    await context.setOffline(false);
    await browser.close();
    console.log('\n🎉 Lokal-E2E erfolgreich – Pass & Play läuft offline an einem Gerät');
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
