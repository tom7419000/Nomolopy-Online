/**
 * Erzeugt die PWA-Icons aus einer SVG-Vorlage (Marken-Look der Startseite:
 * vier Brettfarben auf dunklem Grund). Gerendert wird mit dem vorhandenen
 * Chromium, damit die Icons reproduzierbar aus dem Quelltext entstehen.
 *
 *   npx tsx scripts/generate-icons.ts
 *
 * Muss nur neu laufen, wenn sich das Icon-Design ändert – die PNGs sind
 * eingecheckt, der normale Build braucht dieses Skript nicht.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'client/public/icons');

const BRAND = ['#ed1b24', '#f7941d', '#1fb25a', '#0072bb'];

/**
 * @param inset Anteil des Randes, der frei bleibt (maskable braucht ~20 %
 *              Sicherheitszone, damit Android nichts abschneidet).
 * @param rounded Abgerundete Ecken (bei maskable füllt der Grund die Fläche).
 */
function iconSvg(size: number, inset: number, rounded: boolean): string {
  const radius = rounded ? size * 0.22 : 0;
  const pad = size * inset;
  const inner = size - pad * 2;
  const gap = inner * 0.08;
  const cell = (inner - gap) / 2;
  const tileRadius = cell * 0.2;

  const tiles = BRAND.map((color, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = pad + col * (cell + gap);
    const y = pad + row * (cell + gap);
    return `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="${tileRadius}" fill="${color}"/>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#16233f"/>
      <stop offset="100%" stop-color="#0d1322"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${radius}" fill="url(#bg)"/>
  <g transform="rotate(-4 ${size / 2} ${size / 2})">${tiles}</g>
</svg>`;
}

async function render(browser: Browser, svg: string, size: number, file: string): Promise<void> {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${svg}</body></html>`,
    { waitUntil: 'load' }
  );
  await page.screenshot({ path: path.join(OUT_DIR, file), omitBackground: true });
  await page.close();
  console.log(`  ✔ ${file} (${size}×${size})`);
}

async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch({ args: ['--no-sandbox'] });
  } catch (e) {
    const fallback = process.env.E2E_CHROMIUM ?? '/opt/pw-browsers/chromium';
    if (fs.existsSync(fallback)) return chromium.launch({ args: ['--no-sandbox'], executablePath: fallback });
    throw e;
  }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await launchBrowser();
  console.log('PWA-Icons werden erzeugt …');

  // Normale Icons: abgerundet, Motiv nutzt die Fläche aus
  for (const size of [192, 512]) {
    await render(browser, iconSvg(size, 0.16, true), size, `icon-${size}.png`);
  }
  // Maskable: quadratischer Grund, Motiv in der Sicherheitszone (80 %)
  await render(browser, iconSvg(512, 0.26, false), 512, 'icon-512-maskable.png');
  // iOS: kein Alpha, kein Radius (iOS rundet selbst)
  await render(browser, iconSvg(180, 0.16, false), 180, 'apple-touch-icon.png');
  // Klassisches Favicon
  await render(browser, iconSvg(32, 0.1, true), 32, 'favicon-32.png');

  await browser.close();
  console.log(`Fertig – ${OUT_DIR}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
