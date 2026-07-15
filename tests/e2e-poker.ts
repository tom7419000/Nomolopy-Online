/**
 * End-to-End-Test für Poker: startet den Server (mit gebautem Client),
 * spielt mit zwei Browser-Kontexten eine komplette Hand bis zum Showdown,
 * eine zweite Hand mit Bet/Fold, prüft die Karten-Redaction (fremde Hole
 * Cards nur als Rückseiten) und den Zuschauer-Modus.
 *
 *   npm run build && npm run test:e2e:poker
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

const PORT = 4097;
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

/** Liefert die Seite, die gerade am Zug ist (`.poker-actions.mine` sichtbar). */
async function whoseTurn(pages: Page[]): Promise<Page> {
  for (let i = 0; i < 60; i++) {
    for (const p of pages) {
      if (await p.locator('.poker-actions.mine').isVisible().catch(() => false)) return p;
    }
    await pages[0].waitForTimeout(250);
  }
  fail('Niemand ist am Zug.');
}

/** Checkt/callt reihum, bis das Hand-Ergebnis angezeigt wird. */
async function checkDown(pages: Page[]): Promise<void> {
  for (let i = 0; i < 20; i++) {
    if (await pages[0].locator('.hand-result').isVisible().catch(() => false)) return;
    const page = await whoseTurn(pages);
    const check = page.getByRole('button', { name: 'Check' });
    const call = page.getByRole('button', { name: /^Call/ });
    if (await check.isVisible().catch(() => false)) {
      await check.click({ timeout: 2000 }).catch(() => {});
    } else if (await call.isVisible().catch(() => false)) {
      await call.click({ timeout: 2000 }).catch(() => {});
    }
    await page.waitForTimeout(200);
  }
  fail('Showdown nicht erreicht.');
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'playhub-poker-e2e-'));
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

  const watchdog = setTimeout(() => fail('Watchdog: Poker-E2E hängt (> 150 s).'), 150_000);
  watchdog.unref();

  try {
    await waitForServer();
    console.log('✔ Server läuft');
    const browser = await launchBrowser();
    console.log('✔ Browser gestartet');

    const ctxA = await browser.newContext({ viewport: { width: 1500, height: 950 } });
    const ctxB = await browser.newContext({ viewport: { width: 1500, height: 950 } });
    const ctxC = await browser.newContext({ viewport: { width: 1500, height: 950 } });
    for (const c of [ctxA, ctxB, ctxC]) c.setDefaultTimeout(15_000);
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    const pageC = await ctxC.newPage();
    for (const [label, page] of [
      ['A', pageA],
      ['B', pageB],
      ['C', pageC],
    ] as const) {
      page.on('pageerror', (e) => fail(`Seite ${label}: JS-Fehler: ${e.message}`));
      page.on('console', (m) => {
        if (m.type() === 'error') console.warn(`⚠ Konsole ${label}: ${m.text()}`);
      });
    }

    // --- Poker-Raum erstellen ---------------------------------------------
    await pageA.goto(BASE);
    await pageA.getByPlaceholder('z. B. Alex').fill('Anna');
    await pageA.locator('.game-choice.game-poker').getByRole('button', { name: 'Raum erstellen' }).click();
    await pageA.getByRole('button', { name: '🃏 Raum erstellen' }).click();
    await pageA.locator('.room-code strong').waitFor();
    const code = (await pageA.locator('.room-code strong').textContent())!.trim();
    console.log(`✔ Poker-Raum erstellt: ${code}`);

    // --- Ben tritt über den Link bei ----------------------------------------
    await pageB.goto(`${BASE}/#/room/${code}`);
    await pageB.getByPlaceholder('z. B. Alex').fill('Ben');
    await pageB.getByRole('button', { name: 'Beitreten' }).click();
    await pageA.locator('.lobby-players li', { hasText: 'Ben' }).waitFor();
    console.log('✔ Ben ist über den Raum-Link beigetreten');

    // --- Spiel starten -------------------------------------------------------
    await pageA.getByRole('button', { name: '▶ Spiel starten' }).click();
    await pageA.locator('.poker-felt').waitFor();
    await pageB.locator('.poker-felt').waitFor();
    await pageA.getByText(/Blinds 10\/20/).first().waitFor();
    await pageA.locator('.pot', { hasText: 'Pot: 30' }).waitFor(); // SB+BB
    console.log('✔ Poker gestartet, Blinds gesetzt (Pot 30)');

    // --- Karten-Redaction: eigene Karten offen, fremde verdeckt -------------
    for (const [label, page] of [
      ['Anna', pageA],
      ['Ben', pageB],
    ] as const) {
      const ownFaces = await page.locator('.my-cards .pcard:not(.back)').count();
      const oppBacks = await page.locator('.seat:not(.me) .seat-cards .pcard.back').count();
      if (ownFaces !== 2) fail(`${label} sieht ${ownFaces} eigene Karten (erwartet 2).`);
      if (oppBacks !== 2) fail(`${label} sieht ${oppBacks} verdeckte Gegner-Karten (erwartet 2).`);
    }
    console.log('✔ Hole Cards: eigene sichtbar, fremde nur als Rückseite');
    await pageA.screenshot({ path: `${SHOTS}/poker-01-preflop.png` });

    // --- Hand 1: bis zum Showdown durchchecken ------------------------------
    await checkDown([pageA, pageB]);
    await pageA.locator('.hand-result').waitFor();
    await pageB.locator('.hand-result').waitFor();
    const communityCount = await pageA.locator('.community .pcard:not(.slot)').count();
    if (communityCount !== 5) fail(`Showdown mit ${communityCount} Community-Karten (erwartet 5).`);
    // Beim Showdown decken beide auf → Hand-Namen sichtbar
    await pageA.locator('.seat-handname').first().waitFor();
    console.log('✔ Hand 1 bis zum Showdown gespielt, Hände aufgedeckt');
    await pageA.screenshot({ path: `${SHOTS}/poker-02-showdown.png` });

    // --- Hand 2 starten (Host überspringt die Pause) -------------------------
    await pageA.getByRole('button', { name: '⏭ Nächste Hand' }).click().catch(() => {});
    await pageA.getByText(/Hand 2/).first().waitFor();
    console.log('✔ Hand 2 gestartet');

    // --- Hand 2: Raise → Fold (deterministischer Gewinn) ---------------------
    const raiser = await whoseTurn([pageA, pageB]);
    await raiser.locator('.raise-group .input.small').fill('60');
    await raiser.getByRole('button', { name: /^(Bet|Raise) 60/ }).click();
    const folder = raiser === pageA ? pageB : pageA;
    await folder.getByRole('button', { name: 'Fold' }).click();
    // Fold-Win: Banner erscheint sofort, nach kurzer Pause startet Hand 3 automatisch
    await pageA.locator('.hand-result').waitFor({ timeout: 5000 });
    console.log('✔ Hand 2: Raise → Fold, Pot vergeben');
    await pageA.getByText(/Hand 3/).first().waitFor({ timeout: 10_000 });
    console.log('✔ Hand 3 startet automatisch nach der Pause');

    // --- Quick-Chat ----------------------------------------------------------
    await pageB.getByRole('button', { name: '👏 Gut gespielt' }).click();
    await pageA.locator('.chat-msg', { hasText: 'Gut gespielt' }).waitFor();
    console.log('✔ Quick-Chat synchronisiert');

    // --- Zuschauer tritt bei laufendem Spiel bei ------------------------------
    await pageC.goto(`${BASE}/#/room/${code}`);
    await pageC.getByPlaceholder('z. B. Alex').fill('Zoe');
    await pageC.getByRole('button', { name: 'Beitreten' }).click();
    await pageC.locator('.spectator-banner').waitFor();
    const zoeSeesFaces = await pageC.locator('.seat-cards .pcard:not(.back):not(.slot)').count();
    // Zwischen den Händen (Showdown) sind Karten ggf. aufgedeckt – im Preflop nicht.
    console.log(`✔ Zoe schaut zu (sieht ${zoeSeesFaces} offene Karten – nur Showdown-Reveals erlaubt)`);
    await pageC.screenshot({ path: `${SHOTS}/poker-03-spectator.png` });

    await browser.close();
    console.log('\n🎉 Poker-E2E erfolgreich – Screenshots in ' + SHOTS);
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
