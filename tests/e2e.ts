/**
 * End-to-End-Test: startet den Server (mit gebautem Client), spielt mit zwei
 * Browser-Seiten ein echtes Spiel an und macht Screenshots.
 *
 *   npm run build && npm run test:e2e
 *
 * Screenshots landen in ./test-results (per E2E_SHOTS_DIR überschreibbar).
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';

/**
 * Browser starten – wenn die zum Playwright-Paket passenden Browser fehlen,
 * auf ein vorinstalliertes Chromium ausweichen (z. B. /opt/pw-browsers).
 */
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

const PORT = 4098;
/** Optional unter einem Unterpfad testen: E2E_BASE_PATH=/monopoly */
const BASE_PATH = (process.env.E2E_BASE_PATH ?? '').trim().replace(/\/+$/, '');
const BASE = `http://localhost:${PORT}${BASE_PATH}`;
const SHOTS = process.env.E2E_SHOTS_DIR || 'test-results';

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

/**
 * Beendet den laufenden Zug robust – egal, welche Phase gerade ansteht.
 * Klicks sind bewusst "fire and forget": Der State-Broadcast ersetzt die
 * Buttons oft, bevor Playwright den Klick verifizieren kann – die Schleife
 * bewertet den Zustand danach ohnehin neu.
 */
async function finishTurn(page: Page): Promise<void> {
  const tap = (locator: ReturnType<Page['locator']>) =>
    locator.click({ timeout: 2000 }).catch(() => {});
  for (let i = 0; i < 12; i++) {
    const mine = await page
      .locator('.turn-banner.mine')
      .isVisible()
      .catch(() => false);
    if (!mine) return;
    if (await page.locator('.game-card').isVisible().catch(() => false)) {
      await tap(page.getByRole('button', { name: 'OK' }));
    } else if (
      await page.getByRole('button', { name: 'Nicht kaufen' }).isVisible().catch(() => false)
    ) {
      await tap(page.getByRole('button', { name: 'Nicht kaufen' }));
    } else if (
      await page
        .getByRole('button', { name: /Zug beenden|Nochmal würfeln/ })
        .isVisible()
        .catch(() => false)
    ) {
      await tap(page.getByRole('button', { name: /Zug beenden|Nochmal würfeln/ }));
    } else if (
      await page.getByRole('button', { name: /Würfeln/ }).first().isVisible().catch(() => false)
    ) {
      await tap(page.getByRole('button', { name: /Würfeln/ }).first());
    }
    await page.waitForTimeout(250);
  }
}

async function setDice(page: Page, d1: number, d2: number): Promise<void> {
  await page.getByTitle('Debug / Spielzustand').click();
  await page.locator('.debug-dice select').first().selectOption(String(d1));
  await page.locator('.debug-dice select').nth(1).selectOption(String(d2));
  await page.getByText('Nächsten Wurf setzen').click();
  await page.getByLabel('Schließen').click();
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'nomolopy-e2e-'));
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

  // Watchdog: Der komplette Lauf darf nicht länger als 2 Minuten dauern
  const watchdog = setTimeout(() => fail('Watchdog: E2E-Test hängt (> 120 s).'), 120_000);
  watchdog.unref();

  try {
    await waitForServer();
    console.log('✔ Server läuft');
    const browser = await launchBrowser();
    console.log('✔ Browser gestartet');
    const ctxA = await browser.newContext({ viewport: { width: 1500, height: 950 } });
    const ctxB = await browser.newContext({ viewport: { width: 1500, height: 950 } });
    ctxA.setDefaultTimeout(15_000);
    ctxB.setDefaultTimeout(15_000);
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    for (const [label, page] of [
      ['A', pageA],
      ['B', pageB],
    ] as const) {
      page.on('pageerror', (e) => fail(`Seite ${label}: JS-Fehler: ${e.message}`));
      page.on('console', (m) => {
        if (m.type() === 'error') console.warn(`⚠ Konsole ${label}: ${m.text()}`);
      });
    }

    // --- Startbildschirm & Raum erstellen -------------------------------
    await pageA.goto(BASE);
    await pageA.getByPlaceholder('z. B. Alex').fill('Anna');
    await pageA.screenshot({ path: `${SHOTS}/01-start.png` });
    await pageA.getByText('Spiel erstellen', { exact: true }).click();
    await pageA.locator('.room-code strong').waitFor();
    const code = (await pageA.locator('.room-code strong').textContent())!.trim();
    if (!/^[A-Z0-9]{5}$/.test(code)) fail(`Unerwarteter Raum-Code: ${code}`);
    console.log(`✔ Raum erstellt: ${code}`);

    // --- Beitreten -------------------------------------------------------
    await pageB.goto(BASE);
    await pageB.getByPlaceholder('z. B. Alex').fill('Ben');
    await pageB.getByPlaceholder('z. B. Q7WK3').fill(code);
    await pageB.getByText('Beitreten', { exact: true }).click();
    await pageB.locator('.lobby-players li', { hasText: 'Ben' }).waitFor();
    await pageA.locator('.lobby-players li', { hasText: 'Ben' }).waitFor();
    console.log('✔ Ben ist der Lobby beigetreten (Live-Sync ok)');

    // --- Debug-Modus aktivieren & starten --------------------------------
    // (kontrollierte Checkbox: Zustand ändert sich erst nach Server-Roundtrip)
    const debugRow = pageA.locator('.rule-row', { hasText: 'Debug-Modus' });
    await debugRow.locator('input[type=checkbox]').click();
    await debugRow.locator('input:checked').waitFor();
    await pageB
      .locator('.rule-row', { hasText: 'Debug-Modus' })
      .locator('input:checked')
      .waitFor(); // Regel-Sync beim Mitspieler sichtbar
    await pageA.screenshot({ path: `${SHOTS}/02-lobby.png` });
    await pageA.getByText('▶ Spiel starten').click();
    await pageA.locator('.board').waitFor();
    await pageB.locator('.board').waitFor();
    console.log('✔ Spiel gestartet, Brett sichtbar');

    // --- Wer ist dran? ----------------------------------------------------
    const aIsFirst = await pageA
      .locator('.turn-banner.mine')
      .isVisible()
      .catch(() => false);
    const first = aIsFirst ? pageA : pageB;
    const second = aIsFirst ? pageB : pageA;
    const firstName = aIsFirst ? 'Anna' : 'Ben';
    const secondName = aIsFirst ? 'Ben' : 'Anna';
    console.log(`✔ ${firstName} beginnt`);

    // --- Zug 1: würfeln (2+3), Südbahnhof kaufen, Zug beenden ------------
    await setDice(first, 2, 3);
    await first.getByRole('button', { name: '🎲 Würfeln' }).click();
    await first.locator('.action-block.buy', { hasText: 'Südbahnhof' }).waitFor();
    await first.getByRole('button', { name: /^Kaufen/ }).click();
    await first.getByRole('button', { name: '✔ Zug beenden' }).click();
    console.log(`✔ ${firstName} kauft den Südbahnhof`);

    // --- Zug 2: zweiter Spieler landet auf dem Bahnhof, zahlt Miete ------
    await second.locator('.turn-banner.mine').waitFor();
    await setDice(second, 2, 3);
    await second.getByRole('button', { name: '🎲 Würfeln' }).click();
    await second.getByRole('button', { name: '✔ Zug beenden' }).waitFor();
    // Vermögen prüfen: Käufer 1500-200+25 = 1325, Mieter 1500-25 = 1475
    await first
      .locator('.player-card', { hasText: firstName })
      .locator('.player-money', { hasText: '1.325' })
      .waitFor();
    await first
      .locator('.player-card', { hasText: secondName })
      .locator('.player-money', { hasText: '1.475' })
      .waitFor();
    console.log('✔ Miete korrekt bezahlt (1.325 / 1.475), Sync auf beiden Seiten');
    await second.getByRole('button', { name: '✔ Zug beenden' }).click();

    // --- Grundstücks-Dialog öffnen ---------------------------------------
    await first.locator('.tile', { hasText: 'Südbahnhof' }).first().click();
    await first.locator('.property-card', { hasText: 'Südbahnhof' }).waitFor();
    await first.screenshot({ path: `${SHOTS}/04-property.png` });
    await first.getByLabel('Schließen').click();

    // --- Ereigniskarte ziehen (Feld 7) -------------------------------------
    await setDice(first, 1, 1); // 5 → 7 (Ereignisfeld), inkl. Pasch
    await first.getByRole('button', { name: '🎲 Würfeln' }).click();
    await first.locator('.game-card').waitFor();
    await first.screenshot({ path: `${SHOTS}/05-card.png` });
    await first.getByRole('button', { name: 'OK' }).click();
    await first.locator('.game-card').waitFor({ state: 'hidden' });
    console.log('✔ Ereigniskarte gezogen und bestätigt');
    await finishTurn(first);

    // --- Chat -------------------------------------------------------------
    await pageB.getByRole('button', { name: /Chat/ }).click();
    await pageB.getByPlaceholder('Nachricht …').fill('Hallo zusammen! 👋');
    await pageB.getByLabel('Senden').click();
    await pageA.getByRole('button', { name: /Chat/ }).click();
    await pageA.locator('.chat-msg', { hasText: 'Hallo zusammen!' }).waitFor();
    console.log('✔ Chat synchronisiert');

    // --- Spielstand speichern (Host) --------------------------------------
    await pageA.getByTitle('Spielstand speichern').click();
    await pageA.locator('.toast.success', { hasText: 'gespeichert' }).waitFor();
    const saveFiles = fs.readdirSync(path.join(dataDir, 'saves'));
    if (saveFiles.length !== 1) fail('Spielstand-Datei wurde nicht angelegt.');
    console.log('✔ Spielstand gespeichert');

    // --- Abschluss-Screenshot ---------------------------------------------
    await pageA.screenshot({ path: `${SHOTS}/03-game.png` });

    await browser.close();
    console.log('\n🎉 E2E-Test erfolgreich – Screenshots in ' + SHOTS);
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
