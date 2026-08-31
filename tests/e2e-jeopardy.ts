/**
 * End-to-End-Test für Jeopardy – und vor allem für den Mehrgeräte-Betrieb.
 *
 * Drei Browser-Kontexte, weil genau das der Punkt ist: ein großer Bildschirm
 * zeigt das Brett (als Zuschauer), zwei Handys buzzern. Anders lässt sich
 * nicht prüfen, dass die Brett-Ansicht ohne Sitz funktioniert und dass die
 * richtige Antwort keinen der drei Clients erreicht, bevor aufgelöst ist.
 *
 *   npm run build && npm run test:e2e:jeopardy
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
const BASE_PATH = (process.env.E2E_BASE_PATH ?? '').trim().replace(/\/+$/, '');
const BASE = `http://localhost:${PORT}${BASE_PATH}`;
const SHOTS = process.env.E2E_SHOTS_DIR || 'test-results';

/**
 * tests/ wird ohne DOM-Typen übersetzt (tsconfig.server.json); diese Globals
 * laufen ausschließlich innerhalb von page.evaluate() – also im Browser.
 */
declare const document: {
  querySelector(sel: string): { getBoundingClientRect(): { width: number } } | null;
};
declare const getComputedStyle: (el: unknown) => { color: string };

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

/** Die Seite, die gerade ein Feld wählen darf (dort sind Zellen anklickbar). */
async function pickerPage(pages: Page[]): Promise<Page> {
  for (let i = 0; i < 40; i++) {
    for (const p of pages) {
      if (await p.locator('.jeo-cell:not(:disabled)').first().isVisible().catch(() => false)) return p;
    }
    await pages[0].waitForTimeout(200);
  }
  fail('Niemand darf ein Feld wählen.');
}

/** Die Seite, auf der gerade das Antwortfeld steht. */
async function answererPage(pages: Page[]): Promise<Page> {
  for (let i = 0; i < 40; i++) {
    for (const p of pages) {
      if (await p.locator('.jeo-answer-form').isVisible().catch(() => false)) return p;
    }
    await pages[0].waitForTimeout(200);
  }
  fail('Niemand hat das Wort bekommen.');
}

/** Punktestand eines Spielers, so wie ihn der große Bildschirm zeigt. */
async function scoreOf(board: Page, name: string): Promise<number> {
  const row = board.locator('.jeo-score', { hasText: name }).first();
  const text = (await row.locator('strong').textContent()) ?? '0';
  return Number(text.trim());
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'playhub-jeo-e2e-'));
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

  const watchdog = setTimeout(() => fail('Watchdog: Jeopardy-E2E hängt (> 150 s).'), 150_000);
  watchdog.unref();

  try {
    await waitForServer();
    console.log('✔ Server läuft');
    const browser = await launchBrowser();
    console.log('✔ Browser gestartet');

    // Zwei Handys und ein Fernseher – die Viewports sind Teil des Tests.
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
      ['Brett', board],
    ] as const) {
      page.on('pageerror', (e) => fail(`Seite ${label}: JS-Fehler: ${e.message}`));
      page.on('console', (m) => {
        if (m.type() === 'error') console.warn(`⚠ Konsole ${label}: ${m.text()}`);
      });
    }

    // --- Raum erstellen ------------------------------------------------------
    await pageA.goto(BASE);
    await pageA.getByPlaceholder('z. B. Alex').fill('Anna');
    await pageA.locator('.game-choice.game-jeopardy').getByRole('button', { name: 'Raum erstellen' }).click();
    await pageA.getByText(/300 Fragen/).waitFor();
    await pageA.getByRole('button', { name: '🎯 Raum erstellen' }).click();
    await pageA.locator('.room-code strong').waitFor();
    const code = (await pageA.locator('.room-code strong').textContent())!.trim();
    console.log(`✔ Jeopardy-Raum erstellt: ${code} (mitgeliefertes Paket mit 300 Fragen)`);

    // --- Ben tritt bei -------------------------------------------------------
    await pageB.goto(`${BASE}/#/room/${code}`);
    await pageB.getByPlaceholder('z. B. Alex').fill('Ben');
    await pageB.getByRole('button', { name: 'Beitreten' }).click();
    await pageA.locator('.lobby-players li', { hasText: 'Ben' }).waitFor();
    console.log('✔ Ben ist beigetreten');

    // --- Vorlesezeit abschalten (prüft zugleich lobby:configure) -------------
    const readField = pageA.locator('.rule-row', { hasText: 'Vorlesezeit' }).locator('input');
    await readField.fill('0');
    await readField.blur();
    await pageB.locator('.rule-row', { hasText: 'Vorlesezeit' }).locator('input[value="0"]').waitFor();
    console.log('✔ Vorlesezeit auf 0 gestellt – die Einstellung ist bei Ben angekommen');

    // --- Start ---------------------------------------------------------------
    await pageA.getByRole('button', { name: '▶ Spiel starten' }).click();
    await pageA.locator('.game-table.jeopardy').waitFor();
    await pageB.locator('.game-table.jeopardy').waitFor();
    console.log('✔ Jeopardy gestartet');

    // --- Der Fernseher tritt als Zuschauer bei -------------------------------
    await board.goto(`${BASE}/#/room/${code}`);
    await board.getByPlaceholder('z. B. Alex').fill('Fernseher');
    await board.getByRole('button', { name: 'Beitreten' }).click();
    await board.locator('.spectator-banner').waitFor();
    await board.locator('.jeo-board').waitFor();
    const cells = await board.locator('.jeo-cell').count();
    if (cells !== 30) fail(`Brett zeigt ${cells} Felder (erwartet 30).`);
    const cats = await board.locator('.jeo-cat').count();
    if (cats !== 6) fail(`Brett zeigt ${cats} Kategorien (erwartet 6).`);
    console.log('✔ Der Fernseher zeigt das Brett: 6 Kategorien × 5 Felder, ohne Sitz am Tisch');
    await board.screenshot({ path: `${SHOTS}/jeopardy-01-board.png` });

    // Ein Zuschauer hat keinen Buzzer und kann kein Feld wählen.
    if (await board.locator('.jeo-buzzer').isVisible().catch(() => false)) {
      fail('Der Zuschauer hat einen Buzzer bekommen.');
    }
    if ((await board.locator('.jeo-cell:not(:disabled)').count()) !== 0) {
      fail('Der Zuschauer darf Felder wählen.');
    }

    // --- Feld wählen ---------------------------------------------------------
    const picker = await pickerPage(phones);
    const pickerName = picker === pageA ? 'Anna' : 'Ben';
    // Die zweite Zeile: 200 Punkte, damit ein Abzug klar von 0 unterscheidbar ist.
    await picker.locator('.jeo-col').first().locator('.jeo-cell').nth(1).click();
    for (const p of [...phones, board]) await p.locator('.jeo-prompt').waitFor();
    console.log(`✔ ${pickerName} hat ein Feld gewählt – die Frage steht auf allen drei Geräten`);

    // --- Die Antwort darf nirgends stehen ------------------------------------
    for (const [label, p] of [['Anna', pageA], ['Ben', pageB], ['Brett', board]] as const) {
      if ((await p.locator('.jeo-solution').count()) !== 0) {
        fail(`${label} sieht die Auflösung, bevor gebuzzert wurde.`);
      }
    }
    console.log('✔ Die richtige Antwort ist auf keinem Gerät zu sehen');

    // Die Fragekarte muss die Spalte ausfüllen. Klingt nach Kosmetik, ist
    // aber ein Wächter gegen Klassennamen-Kollisionen: `.jeo-clue board`
    // hätte sich vorher Monopolys `.board` eingefangen (feste Breite,
    // dunkle Schrift auf dunklem Grund).
    const fill = await board.evaluate<number>(() => {
      const main = document.querySelector('.jeo-main')!.getBoundingClientRect().width;
      const card = document.querySelector('.jeo-clue')!.getBoundingClientRect().width;
      return card / main;
    });
    if (fill < 0.9) fail(`Die Fragekarte füllt nur ${Math.round(fill * 100)} % der Spalte.`);
    const promptColor = await board.evaluate<string>(
      () => getComputedStyle(document.querySelector('.jeo-prompt')).color
    );
    if (promptColor !== 'rgb(233, 237, 246)') {
      fail(`Die Frage steht in ${promptColor} statt in der Textfarbe.`);
    }
    console.log('✔ Die Fragekarte füllt den Bildschirm und steht in lesbarer Schrift');

    // --- Beide buzzern -------------------------------------------------------
    await pageA.locator('.jeo-buzzer').waitFor();
    await pageB.locator('.jeo-buzzer').waitFor();
    await pageA.screenshot({ path: `${SHOTS}/jeopardy-02a-phone-buzzer.png` });
    await pageA.locator('.jeo-buzzer').click();
    await pageB.locator('.jeo-buzzer').click();

    const first = await answererPage(phones);
    const second = first === pageA ? pageB : pageA;
    const firstName = first === pageA ? 'Anna' : 'Ben';
    const secondName = firstName === 'Anna' ? 'Ben' : 'Anna';
    if (await second.locator('.jeo-answer-form').isVisible().catch(() => false)) {
      fail('Beide haben gleichzeitig das Wort bekommen.');
    }
    console.log(`✔ Buzzer-Rennen entschieden: ${firstName} hat das Wort, ${secondName} wartet`);
    await board.screenshot({ path: `${SHOTS}/jeopardy-02-buzzed.png` });

    // --- Falsch antworten → Abzug, Sperre, Buzzer wieder auf -----------------
    await first.locator('.jeo-answer-form .input').fill('Ganz sicher falsch');
    await first.getByRole('button', { name: 'Abschicken' }).click();

    // Nur der andere darf werten – der Antwortende nicht.
    await second.locator('.jeo-judge').waitFor();
    if (await first.locator('.jeo-judge').isVisible().catch(() => false)) {
      fail('Der Antwortende darf über seine eigene Antwort abstimmen.');
    }
    await board.locator('.jeo-submitted', { hasText: 'Ganz sicher falsch' }).waitFor();
    if ((await board.locator('.jeo-solution').count()) !== 0) {
      fail('Während der Wertung steht die Auflösung schon da.');
    }
    console.log('✔ Gewertet wird von den anderen; die Auflösung bleibt verborgen');

    await second.screenshot({ path: `${SHOTS}/jeopardy-02b-phone-judge.png` });
    await second.getByRole('button', { name: '✗ Falsch' }).click();
    await board.locator('.jeo-score', { hasText: firstName }).locator('strong.negative').waitFor();
    if ((await scoreOf(board, firstName)) !== -200) {
      fail(`Abzug fehlt: ${firstName} steht bei ${await scoreOf(board, firstName)} statt -200.`);
    }
    console.log(`✔ ${firstName} liegt bei −200, der Buzzer geht für ${secondName} wieder auf`);

    // Wer schon dran war, ist gesperrt.
    await second.locator('.jeo-buzzer').waitFor();
    if (await first.locator('.jeo-buzzer').isVisible().catch(() => false)) {
      fail('Wer falsch geantwortet hat, darf nochmal buzzern.');
    }

    // --- Zweiter Versuch: die Runde lässt es gelten --------------------------
    await second.locator('.jeo-buzzer').click();
    const nextAnswerer = await answererPage(phones);
    if (nextAnswerer !== second) fail('Der falsche Spieler hat das Wort bekommen.');
    await second.locator('.jeo-answer-form .input').fill('Auch geraten');
    await second.getByRole('button', { name: 'Abschicken' }).click();
    await first.locator('.jeo-judge').waitFor();
    await first.getByRole('button', { name: '✓ Richtig' }).click();

    await board.locator('.jeo-solution').waitFor();
    const solution = (await board.locator('.jeo-solution strong').textContent())?.trim() ?? '';
    if (!solution) fail('Die Auflösung ist leer.');
    if ((await scoreOf(board, secondName)) !== 200) {
      fail(`${secondName} hat ${await scoreOf(board, secondName)} statt 200 Punkte.`);
    }
    console.log(`✔ Wertung überstimmt den Vorschlag: ${secondName} bekommt 200, aufgelöst mit „${solution}"`);
    await board.screenshot({ path: `${SHOTS}/jeopardy-03-revealed.png` });

    // --- Zurück zum Brett ----------------------------------------------------
    await second.getByRole('button', { name: 'Weiter zum Brett' }).click();
    await board.locator('.jeo-board').waitFor();
    const used = await board.locator('.jeo-cell.used').count();
    if (used !== 1) fail(`${used} Felder verbraucht (erwartet 1).`);
    await board.getByText('29 von 30 Feldern offen').waitFor();
    console.log('✔ Zurück am Brett, das gespielte Feld ist verbraucht');

    // Wer richtig lag, wählt weiter.
    const nextPicker = await pickerPage(phones);
    if (nextPicker !== second) fail(`${secondName} hätte weiterwählen müssen.`);
    console.log(`✔ ${secondName} wählt das nächste Feld`);

    // --- Chat über alle drei Geräte -----------------------------------------
    await pageB.getByRole('button', { name: 'Gut gebuzzert!' }).click();
    await board.locator('.chat-msg', { hasText: 'Gut gebuzzert!' }).waitFor();
    console.log('✔ Chat kommt auch am Fernseher an');

    // --- Und dasselbe Spiel am gemeinsamen Gerät -----------------------------
    //
    // Der lokale Weg hat eigenen Code: Namensknöpfe statt Buzzer, ein Tipp
    // statt Abstimmung, keine Uhren. Ohne diesen Abschnitt wäre davon nichts
    // geprüft.
    const tablet = await (await browser.newContext({ viewport: { width: 1180, height: 820 } })).newPage();
    tablet.on('pageerror', (e) => fail(`Tablet: JS-Fehler: ${e.message}`));
    await tablet.goto(BASE);
    await tablet.locator('.game-choice.game-jeopardy').getByRole('button', { name: '📱 Am Gerät spielen' }).click();
    await tablet.getByRole('button', { name: '🎯 Spiel starten' }).click();
    await tablet.locator('.game-table.jeopardy').waitFor();
    await tablet.locator('.jeo-board').waitFor();
    console.log('✔ Lokale Jeopardy-Partie gestartet – ohne Server, ohne Namen, ohne Warten');

    await tablet.locator('.jeo-cell:not(:disabled)').first().click();
    await tablet.locator('.jeo-name-buzzers').waitFor();
    if (await tablet.locator('.jeo-buzzer').isVisible().catch(() => false)) {
      fail('Am gemeinsamen Gerät steht ein Buzzer statt der Namensknöpfe.');
    }
    if ((await tablet.locator('.jeo-clock').count()) !== 0) {
      fail('Am gemeinsamen Gerät läuft eine Uhr mit.');
    }
    console.log('✔ Statt eines Buzzers stehen die Namen da, und es tickt keine Uhr');
    await tablet.screenshot({ path: `${SHOTS}/jeopardy-04-local.png` });

    await tablet.locator('.jeo-name-buzzer', { hasText: 'Spieler 2' }).click();
    await tablet.locator('.jeo-answer-form .input').fill('Irgendwas');
    await tablet.getByRole('button', { name: 'Abschicken' }).click();
    await tablet.locator('.jeo-judge').waitFor();
    // Ein Tipp genügt: am Tisch stimmt niemand einzeln ab, und ohne Uhr
    // würde ein Warten auf weitere Stimmen die Partie anhalten.
    await tablet.getByRole('button', { name: '✓ Richtig' }).click();
    await tablet.locator('.jeo-solution').waitFor();
    if ((await scoreOf(tablet, 'Spieler 2')) !== 100) {
      fail(`Spieler 2 hat ${await scoreOf(tablet, 'Spieler 2')} statt 100 Punkte.`);
    }
    console.log('✔ Ein Tipp wertet, Punkte sind vergeben, aufgelöst wird sofort');

    // --- Moderierte Sendung: Fernseher führt, zwei Handys buzzern ------------
    //
    // Der eigentliche Punkt von Schritt 8: der Moderator hat zwar einen Sitz
    // (daran hängen Host-Rechte und Rauswerfen), spielt aber nicht mit. Er
    // wählt die Felder, öffnet den Buzzer und wertet allein.
    const ctxMod = await browser.newContext({ viewport: tv });
    const ctxC = await browser.newContext({ viewport: phone });
    const ctxD = await browser.newContext({ viewport: phone });
    for (const c of [ctxMod, ctxC, ctxD]) c.setDefaultTimeout(15_000);
    const mod = await ctxMod.newPage();
    const pageC = await ctxC.newPage();
    const pageD = await ctxD.newPage();
    const guests = [pageC, pageD];
    for (const [label, page] of [
      ['Mod', mod],
      ['Cara', pageC],
      ['Dora', pageD],
    ] as const) {
      page.on('pageerror', (e) => fail(`Seite ${label}: JS-Fehler: ${e.message}`));
    }

    await mod.goto(BASE);
    await mod.getByPlaceholder('z. B. Alex').fill('Mod');
    await mod.locator('.game-choice.game-jeopardy').getByRole('button', { name: 'Raum erstellen' }).click();
    await mod.getByText(/300 Fragen/).waitFor();
    await mod.locator('.rule-row.boolean', { hasText: 'Ich moderiere nur' }).locator('input').check();
    await mod.getByRole('button', { name: '🎯 Raum erstellen' }).click();
    await mod.locator('.room-code strong').waitFor();
    const showCode = (await mod.locator('.room-code strong').textContent())!.trim();

    // Der Moderator steht in der Liste – aber nicht als Mitspieler.
    await mod.locator('.lobby-players li', { hasText: 'Mod' }).locator('.badge', { hasText: 'MODERIERT' }).waitFor();
    await mod.getByRole('heading', { name: /Spieler \(0\// }).waitFor();
    console.log('✔ Moderierter Raum erstellt – der Moderator zählt nicht als Spieler');

    for (const [name, page] of [
      ['Cara', pageC],
      ['Dora', pageD],
    ] as const) {
      await page.goto(`${BASE}/#/room/${showCode}`);
      await page.getByPlaceholder('z. B. Alex').fill(name);
      await page.getByRole('button', { name: 'Beitreten' }).click();
      await mod.locator('.lobby-players li', { hasText: name }).waitFor();
    }
    // Zwei Mitspieler genügen, obwohl drei Leute im Raum sind.
    await mod.getByRole('heading', { name: /Spieler \(2\// }).waitFor();

    // Die Vorlesezeit steuert, wann der Buzzer von selbst aufgeht. In
    // Schritt 8 war die Zeile moderiert versteckt, weil sie wirkungslos
    // war – jetzt ist sie genau der Knopf dafür und muss wieder da sein.
    const modRead = mod.locator('.rule-row', { hasText: 'Vorlesezeit' }).locator('input');
    if ((await modRead.count()) !== 1) fail('Moderiert fehlt die Vorlesezeit in der Lobby.');
    await modRead.fill('5');
    await modRead.blur();
    await pageC.locator('.rule-row', { hasText: 'Vorlesezeit' }).locator('input[value="5"]').waitFor();

    await mod.getByRole('button', { name: '▶ Spiel starten' }).click();
    for (const p of [mod, pageC, pageD]) await p.locator('.game-table.jeopardy').waitFor();

    // --- Der Moderator präsentiert -------------------------------------------
    await mod.locator('.jeopardy-layout.presenting').waitFor();
    await mod.locator('.jeo-moderator-hint').waitFor();
    if (await mod.locator('.side.right').isVisible().catch(() => false)) {
      fail('In der Präsentation steht noch die Seitenspalte mit dem Chat.');
    }
    // Punktetafel ohne den Moderator: er hat keine Punkte, also keine Zeile.
    const scoreRows = await mod.locator('.jeo-score').count();
    if (scoreRows !== 2) fail(`Die Punktetafel zeigt ${scoreRows} Zeilen (erwartet 2, ohne den Moderator).`);
    console.log('✔ Der Moderator präsentiert formatfüllend, ohne eigene Punktezeile');
    await mod.screenshot({ path: `${SHOTS}/jeopardy-05-presenting.png` });

    // --- Er wählt, nicht die Spieler -----------------------------------------
    for (const [label, p] of [['Cara', pageC], ['Dora', pageD]] as const) {
      if ((await p.locator('.jeo-cell:not(:disabled)').count()) !== 0) {
        fail(`${label} darf ein Feld wählen, obwohl moderiert wird.`);
      }
    }
    if ((await mod.locator('.jeo-cell:not(:disabled)').count()) !== 30) {
      fail('Der Moderator kann nicht alle Felder wählen.');
    }
    await mod.locator('.jeo-col').first().locator('.jeo-cell').first().click();
    for (const p of [mod, pageC, pageD]) await p.locator('.jeo-prompt').waitFor();
    console.log('✔ Nur der Moderator wählt – die Frage steht danach auf allen drei Geräten');

    // --- Er liest vor, und der Buzzer geht von selbst auf --------------------
    //
    // Der Punkt von Schritt 8b: Wer moderiert, spielt am echten Tisch
    // nebenher mit und hat keine Hand für eine Freigabe frei. Stünde der
    // Buzzer still, bis jemand ihn öffnet, stockte jede einzelne Frage.
    for (const p of [mod, pageC, pageD]) await p.locator('.jeo-readclock').waitFor();
    for (const [label, p] of [['Cara', pageC], ['Dora', pageD]] as const) {
      if (await p.locator('.jeo-buzzer').isVisible().catch(() => false)) {
        fail(`${label} kann buzzern, während noch vorgelesen wird.`);
      }
    }
    console.log('✔ Der Countdown steht auf allen drei Geräten, der Buzzer ist noch zu');
    await mod.screenshot({ path: `${SHOTS}/jeopardy-05b-countdown.png` });

    // Und jetzt klickt niemand irgendwo – die Uhr macht das allein.
    for (const p of guests) await p.locator('.jeo-buzzer').waitFor({ timeout: 12_000 });
    if (await mod.locator('.jeo-buzzer').isVisible().catch(() => false)) {
      fail('Der Moderator hat einen eigenen Buzzer bekommen.');
    }
    console.log('✔ Nach der Vorlesezeit geht der Buzzer von selbst auf – ohne Knopfdruck');

    // --- Er wertet allein ----------------------------------------------------
    await pageC.locator('.jeo-buzzer').click();
    const guest = await answererPage(guests);
    const guestName = guest === pageC ? 'Cara' : 'Dora';
    await guest.locator('.jeo-answer-form .input').fill('Meine Antwort');
    await guest.getByRole('button', { name: 'Abschicken' }).click();

    await mod.locator('.jeo-moderator-bar').getByRole('button', { name: '✓ Richtig' }).waitFor();
    for (const [label, p] of [['Cara', pageC], ['Dora', pageD]] as const) {
      if (await p.locator('.jeo-judge').isVisible().catch(() => false)) {
        fail(`${label} darf werten, obwohl der Moderator das tut.`);
      }
    }
    await mod.screenshot({ path: `${SHOTS}/jeopardy-06-judging.png` });
    await pageD.screenshot({ path: `${SHOTS}/jeopardy-07-phone-watching.png` });
    await mod.locator('.jeo-moderator-bar').getByRole('button', { name: '✓ Richtig' }).click();

    await mod.locator('.jeo-solution').waitFor();
    if ((await scoreOf(mod, guestName)) !== 100) {
      fail(`${guestName} hat ${await scoreOf(mod, guestName)} statt 100 Punkte.`);
    }
    console.log(`✔ Der Moderator wertet allein: ${guestName} bekommt 100 Punkte`);

    // --- Und er führt weiter -------------------------------------------------
    for (const [label, p] of [['Cara', pageC], ['Dora', pageD]] as const) {
      if (await p.getByRole('button', { name: 'Weiter zum Brett' }).isVisible().catch(() => false)) {
        fail(`${label} kann die Sendung weiterschalten.`);
      }
    }
    await mod.locator('.jeo-moderator-bar').getByRole('button', { name: 'Weiter zum Brett' }).click();
    await mod.locator('.jeo-board').waitFor();
    await mod.getByText('29 von 30 Feldern offen').waitFor();
    console.log('✔ Nur er schaltet zurück zum Brett');

    // --- Der Knopf bleibt, aber als Abkürzung --------------------------------
    await mod.locator('.jeo-col').first().locator('.jeo-cell').nth(1).click();
    await mod.locator('.jeo-readclock').waitFor();
    await mod.locator('.jeo-moderator-bar').getByRole('button', { name: '🔔 Sofort öffnen' }).click();
    for (const p of guests) await p.locator('.jeo-buzzer').waitFor();
    console.log('✔ … und wer schneller fertig vorgelesen hat, kürzt mit „Sofort öffnen" ab');

    await browser.close();
    console.log('\n🎉 Jeopardy-E2E erfolgreich – Screenshots in ' + SHOTS);
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
