/**
 * End-to-End-Test für Trivial Pursuit.
 *
 * Drei Browser-Kontexte wie bei Jeopardy: ein Fernseher zeigt das Rad (als
 * Zuschauer), zwei Handys würfeln und antworten. Danach dieselbe Partie am
 * gemeinsamen Gerät, dort im Freitext-Modus – der hat eigenen Code
 * (Wertungsrunde, ein Tipp statt Abstimmung, keine Uhr).
 *
 * Deterministisch wird der Lauf durch zwei Dinge:
 *
 * 1. `debugMode` mit gesetztem Würfel (Vorbild: `setDice` bei Monopoly). Vom
 *    Mittelfeld aus erreicht eine 6 GENAU die sechs Käse-Ecken – damit lässt
 *    sich ein Käsestück gezielt anspielen, statt auf Glück zu warten.
 * 2. Die richtige Antwort schlägt der Test über den FRAGETEXT im
 *    mitgelieferten Paket nach. Sie steht ja bewusst nicht im Zustand – und
 *    dass der Test außen herum muss, ist der beste Beleg dafür.
 *
 *   npm run build && npm run test:e2e:pursuit
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { STANDARD_DE } from '../shared/trivia/packs/standard-de';

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

const PORT = 4095;
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

/** Die Seite, die gerade würfeln darf. */
async function rollerPage(pages: Page[]): Promise<Page> {
  for (let i = 0; i < 40; i++) {
    for (const p of pages) {
      const btn = p.getByRole('button', { name: '🎲 Würfeln' });
      if (await btn.isEnabled().catch(() => false)) return p;
    }
    await pages[0].waitForTimeout(200);
  }
  fail('Niemand kann würfeln.');
}

/** Die richtige Antwort zu einem Fragetext – aus dem mitgelieferten Paket. */
function solutionFor(prompt: string): string {
  const q = STANDARD_DE.questions.find((x) => x.prompt.trim() === prompt.trim());
  if (!q) fail(`Frage nicht im Paket gefunden: „${prompt}"`);
  return q.answer;
}

/** Käsestücke eines Spielers, so wie sie am Rad-Bildschirm stehen. */
async function wedgesOf(board: Page, name: string): Promise<string> {
  const row = board.locator('.tp-player', { hasText: name }).first();
  return (await row.locator('.tp-player-count').textContent())?.trim() ?? '';
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'playhub-tp-e2e-'));
  // `detached` gibt dem Server eine eigene Prozessgruppe. Ohne das trifft
  // `kill()` nur die npx-Hülle: der Node-Prozess darunter überlebt, hält den
  // Port – und der NÄCHSTE Lauf redet dann mit dem alten Server, statt
  // abzubrechen. Ein grüner Test gegen veralteten Code ist schlimmer als
  // ein roter.
  const server = spawn('npx', ['tsx', 'server/index.ts'], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, BASE_PATH },
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

  const watchdog = setTimeout(() => fail('Watchdog: Pursuit-E2E hängt (> 180 s).'), 180_000);
  watchdog.unref();

  try {
    await waitForServer();
    console.log('✔ Server läuft');
    const browser = await launchBrowser();
    console.log('✔ Browser gestartet');

    const phone = { width: 390, height: 844 };
    const tv = { width: 1600, height: 900 };
    const ctxA = await browser.newContext({ viewport: phone });
    const ctxB = await browser.newContext({ viewport: phone });
    const ctxTV = await browser.newContext({ viewport: tv });
    for (const c of [ctxA, ctxB, ctxTV]) c.setDefaultTimeout(15_000);
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    const board = await ctxTV.newPage();
    const phones = [pageA, pageB];

    for (const [label, page] of [
      ['Anna', pageA],
      ['Ben', pageB],
      ['Rad', board],
    ] as const) {
      page.on('pageerror', (e) => fail(`Seite ${label}: JS-Fehler: ${e.message}`));
      page.on('console', (m) => {
        if (m.type() === 'error') console.warn(`⚠ Konsole ${label}: ${m.text()}`);
      });
    }

    // --- Raum erstellen ------------------------------------------------------
    await pageA.goto(BASE);
    await pageA.getByPlaceholder('z. B. Alex').fill('Anna');
    await pageA.locator('.game-choice.game-pursuit').getByRole('button', { name: 'Raum erstellen' }).click();
    await pageA.getByRole('button', { name: '🧀 Raum erstellen' }).click();
    await pageA.locator('.room-code strong').waitFor();
    const code = (await pageA.locator('.room-code strong').textContent())!.trim();
    console.log(`✔ Trivial-Pursuit-Raum erstellt: ${code}`);

    await pageB.goto(`${BASE}/#/room/${code}`);
    await pageB.getByPlaceholder('z. B. Alex').fill('Ben');
    await pageB.getByRole('button', { name: 'Beitreten' }).click();
    await pageA.locator('.lobby-players li', { hasText: 'Ben' }).waitFor();
    console.log('✔ Ben ist beigetreten');

    // --- Debug-Würfel einschalten (prüft zugleich lobby:configure) -----------
    const dbg = pageA.locator('.rule-row', { hasText: 'Debug-Modus' }).locator('input');
    await dbg.click();
    await pageB.locator('.rule-row', { hasText: 'Debug-Modus' }).locator('input:checked').waitFor();
    console.log('✔ Debug-Würfel eingeschaltet – die Einstellung ist bei Ben angekommen');

    // --- Start ---------------------------------------------------------------
    await pageA.getByRole('button', { name: '▶ Spiel starten' }).click();
    for (const p of phones) await p.locator('.game-table.pursuit').waitFor();
    console.log('✔ Trivial Pursuit gestartet – alle stehen in der Mitte');

    // --- Der Fernseher tritt als Zuschauer bei -------------------------------
    await board.goto(`${BASE}/#/room/${code}`);
    await board.getByPlaceholder('z. B. Alex').fill('Fernseher');
    await board.getByRole('button', { name: 'Beitreten' }).click();
    await board.locator('.spectator-banner').waitFor();
    await board.locator('.tp-wheel').waitFor();

    const segs = await board.locator('.tp-seg').count();
    if (segs !== 72) fail(`Rad zeigt ${segs} Felder (erwartet 72 = 42 Ring + 30 Speiche).`);
    const corners = await board.locator('.tp-hq-emoji').count();
    if (corners !== 6) fail(`Rad zeigt ${corners} Käse-Ecken (erwartet 6).`);
    if ((await board.locator('.tp-hub').count()) !== 1) fail('Die Nabe fehlt.');
    console.log('✔ Der Fernseher zeigt das Rad: 72 Felder, 6 Käse-Ecken, eine Nabe');
    await board.screenshot({ path: `${SHOTS}/pursuit-01-wheel.png` });

    // Ein Zuschauer hat keine Knöpfe.
    if (await board.getByRole('button', { name: '🎲 Würfeln' }).isVisible().catch(() => false)) {
      fail('Der Zuschauer darf würfeln.');
    }

    // --- Würfeln: eine 6 führt vom Mittelfeld auf die Käse-Ecken -------------
    const roller = await rollerPage(phones);
    const other = roller === pageA ? pageB : pageA;
    const rollerName = roller === pageA ? 'Anna' : 'Ben';
    const otherName = rollerName === 'Anna' ? 'Ben' : 'Anna';

    // Vom Mittelfeld aus erreicht eine 6 genau die sechs Käse-Ecken.
    await roller.getByRole('button', { name: 'Nächster Wurf 6' }).click();
    await roller.getByRole('button', { name: '🎲 Würfeln' }).click();
    await roller.locator('.tp-targets').waitFor();
    console.log(`✔ ${rollerName} hat gewürfelt`);

    // Die Ziele stehen auf ALLEN Geräten – auch am Fernseher, der nur zuschaut.
    const targetsOnBoard = await board.locator('.tp-seg.pickable, .tp-hub.pickable').count();
    if (targetsOnBoard === 0) fail('Der Fernseher hebt die erreichbaren Felder nicht hervor.');
    const numbered = await board.locator('.tp-target-num').count();
    if (numbered !== targetsOnBoard) {
      fail(`${targetsOnBoard} Ziele, aber ${numbered} Ziffern – die Zuordnung zur Knopfreihe stimmt nicht.`);
    }
    console.log(`✔ ${targetsOnBoard} Ziele sind am Fernseher hervorgehoben und durchnummeriert`);

    // Nur der Würfelnde darf sie antippen.
    if (await other.locator('.tp-target:not([disabled])').first().isVisible().catch(() => false)) {
      fail(`${otherName} kann ein Ziel wählen, obwohl er nicht am Zug ist.`);
    }
    await roller.screenshot({ path: `${SHOTS}/pursuit-02-phone-targets.png` });

    await roller.locator('.tp-target').first().click();
    for (const p of [...phones, board]) await p.locator('.tp-prompt').waitFor();
    console.log('✔ Ziel gewählt – die Frage steht auf allen drei Geräten');

    // --- Die Antwort darf nirgends stehen ------------------------------------
    for (const [label, p] of [['Anna', pageA], ['Ben', pageB], ['Rad', board]] as const) {
      if ((await p.locator('.tp-solution').count()) !== 0) {
        fail(`${label} sieht die Auflösung, bevor geantwortet wurde.`);
      }
    }
    const optionCount = await roller.locator('.tp-option').count();
    if (optionCount !== 4) fail(`${optionCount} Antwortmöglichkeiten (erwartet 4).`);
    console.log('✔ Vier Möglichkeiten, die Auflösung auf keinem Gerät');

    // --- Richtig antworten ---------------------------------------------------
    const prompt = (await roller.locator('.tp-prompt').textContent())!.trim();
    const right = solutionFor(prompt);
    const before = await wedgesOf(board, rollerName);
    await roller.getByRole('button', { name: right, exact: true }).click();

    await board.locator('.tp-verdict.right').waitFor();
    const after = await wedgesOf(board, rollerName);
    if (before === after) fail(`Kein Käsestück: ${rollerName} steht weiter bei ${after}.`);
    console.log(`✔ Richtig beantwortet auf der Käse-Ecke: ${rollerName} geht von ${before} auf ${after}`);
    await board.screenshot({ path: `${SHOTS}/pursuit-03-wedge.png` });

    // Wer richtig lag, würfelt weiter.
    await roller.getByRole('button', { name: 'Weiter' }).click();
    const next = await rollerPage(phones);
    if (next !== roller) fail('Nach einer richtigen Antwort ist der falsche Spieler dran.');
    console.log(`✔ ${rollerName} darf nochmal würfeln`);

    // --- Chat über alle drei Geräte -----------------------------------------
    await other.getByRole('button', { name: 'Käse!' }).click();
    await board.locator('.chat-msg', { hasText: 'Käse!' }).waitFor();
    console.log('✔ Chat kommt auch am Fernseher an');

    // --- Und dasselbe am gemeinsamen Gerät, im Freitext-Modus ---------------
    //
    // Der lokale Weg hat eigenen Code: die Runde wertet mit einem Tipp, und es
    // läuft keine Uhr. Ohne diesen Abschnitt wäre davon nichts geprüft.
    const tablet = await (await browser.newContext({ viewport: { width: 1180, height: 820 } })).newPage();
    tablet.on('pageerror', (e) => fail(`Tablet: JS-Fehler: ${e.message}`));
    await tablet.goto(BASE);
    await tablet.locator('.game-choice.game-pursuit').getByRole('button', { name: '📱 Am Gerät spielen' }).click();
    await tablet.locator('.rule-row', { hasText: 'Frei antworten' }).locator('input').click();
    await tablet.getByRole('button', { name: '🧀 Spiel starten' }).click();
    await tablet.locator('.game-table.pursuit').waitFor();
    await tablet.locator('.tp-wheel').waitFor();
    console.log('✔ Lokale Partie gestartet – ohne Server, ohne Namen, ohne Warten');

    await tablet.getByRole('button', { name: '🎲 Würfeln' }).click();
    if ((await tablet.locator('.tp-clock').count()) !== 0) {
      fail('Am gemeinsamen Gerät läuft eine Uhr mit.');
    }
    await tablet.locator('.tp-target').first().click();
    await tablet.locator('.tp-prompt').waitFor();
    if ((await tablet.locator('.tp-option').count()) !== 0) {
      fail('Im Freitext-Modus stehen Ankreuz-Möglichkeiten da.');
    }
    await tablet.locator('.tp-answer-form .input').fill('Irgendwas');
    await tablet.getByRole('button', { name: 'Abschicken' }).click();

    // Ein Tipp genügt: am Tisch stimmt niemand einzeln ab, und ohne Uhr
    // würde ein Warten auf weitere Stimmen die Partie anhalten.
    await tablet.getByRole('button', { name: '✓ Richtig' }).click();
    await tablet.locator('.tp-verdict.right').waitFor();
    console.log('✔ Freitext gewertet mit einem Tipp, ohne Uhr');
    await tablet.screenshot({ path: `${SHOTS}/pursuit-04-local.png` });

    await browser.close();
    console.log('\n🎉 Trivial-Pursuit-E2E erfolgreich – Screenshots in ' + SHOTS);
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
