/**
 * Dateibasierte Persistenz für benutzerdefinierte Editionen (Admin-Panel)
 * und gespeicherte Spielstände. Bewusst ohne externe Datenbank – alles
 * liegt als JSON unter ./data.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BoardEdition, GameState, GroupId, SaveGameMeta } from '../shared/types';
import { BOARD_STRUCTURE, BUILT_IN_EDITIONS, GROUP_ORDER } from '../shared/boards';
import { randomId } from '../shared/util';
import {
  isTriviaCategory,
  isTriviaLevel,
  MAX_ANSWER_LEN,
  MAX_PACK_DESC,
  MAX_PACK_NAME,
  MAX_PROMPT_LEN,
  MAX_QUESTIONS_PER_PACK,
  checkPack,
  type TriviaPack,
  type TriviaQuestion,
} from '../shared/trivia/types';
import { BUILT_IN_PACKS } from '../shared/trivia/packs/standard-de';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const EDITIONS_FILE = path.join(DATA_DIR, 'editions.json');
const PACKS_FILE = path.join(DATA_DIR, 'packs.json');
const SAVES_DIR = path.join(DATA_DIR, 'saves');

const MAX_IMAGE_CHARS = 400_000; // ~300 KB Binärdaten als Data-URL
const MAX_EDITION_JSON = 4_000_000;

function ensureDirs(): void {
  fs.mkdirSync(SAVES_DIR, { recursive: true });
}

// ---------------------------------------------------------------------------
// Editionen
// ---------------------------------------------------------------------------

let customEditions: BoardEdition[] = loadCustomEditions();

function loadCustomEditions(): BoardEdition[] {
  try {
    const raw = fs.readFileSync(EDITIONS_FILE, 'utf8');
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function persistCustomEditions(): void {
  ensureDirs();
  fs.writeFileSync(EDITIONS_FILE, JSON.stringify(customEditions), 'utf8');
}

export function allEditions(): BoardEdition[] {
  return [...BUILT_IN_EDITIONS, ...customEditions];
}

export function getEdition(id: string): BoardEdition | undefined {
  return allEditions().find((e) => e.id === id);
}

const HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/;

function cleanString(v: unknown, maxLen: number, fallback = ''): string {
  return typeof v === 'string' ? v.trim().slice(0, maxLen) : fallback;
}

function cleanImage(v: unknown): string | undefined {
  if (typeof v !== 'string' || !v.startsWith('data:image/')) return undefined;
  if (v.length > MAX_IMAGE_CHARS) return undefined;
  return v;
}

/**
 * Nimmt eine Edition aus dem Admin-Panel entgegen und baut daraus eine
 * garantiert konsistente Edition: Feldstruktur (Typen, Preise, Mieten)
 * kommt immer aus BOARD_STRUCTURE, nur Namen/Farben/Bilder sind frei.
 */
export function upsertEdition(input: unknown): { ok: true; edition: BoardEdition } | { ok: false; error: string } {
  if (typeof input !== 'object' || input === null) return { ok: false, error: 'Ungültige Edition.' };
  const raw = input as Record<string, unknown>;
  const name = cleanString(raw.name, 40);
  if (!name) return { ok: false, error: 'Die Edition braucht einen Namen.' };
  const currency = cleanString(raw.currency, 3, '€') || '€';
  const boardColor = HEX_COLOR.test(String(raw.boardColor)) ? String(raw.boardColor) : '#cfe5cd';

  const groupColors = {} as Record<GroupId, string>;
  const rawColors = (raw.groupColors ?? {}) as Record<string, unknown>;
  for (const g of GROUP_ORDER) {
    const c = String(rawColors[g] ?? '');
    groupColors[g] = HEX_COLOR.test(c) ? c : BUILT_IN_EDITIONS[0].groupColors[g];
  }

  const rawTiles = Array.isArray(raw.tiles) ? raw.tiles : [];
  const tiles = BOARD_STRUCTURE.map((s, i) => {
    const rt = (rawTiles[i] ?? {}) as Record<string, unknown>;
    const fallback = BUILT_IN_EDITIONS[0].tiles[i].name;
    return {
      id: i,
      ...s,
      name: cleanString(rt.name, 40) || fallback,
      image: cleanImage(rt.image),
    };
  });

  const requestedId = cleanString(raw.id, 60);
  const isBuiltInId = BUILT_IN_EDITIONS.some((e) => e.id === requestedId);
  const id = !requestedId || isBuiltInId ? `custom-${randomId(8)}` : requestedId;

  const edition: BoardEdition = {
    id,
    name,
    description: cleanString(raw.description, 200) || undefined,
    builtIn: false,
    currency,
    boardColor,
    centerImage: cleanImage(raw.centerImage),
    groupColors,
    tiles,
  };

  if (JSON.stringify(edition).length > MAX_EDITION_JSON) {
    return { ok: false, error: 'Edition zu groß – bitte kleinere Bilder verwenden.' };
  }

  const idx = customEditions.findIndex((e) => e.id === id);
  if (idx >= 0) customEditions[idx] = edition;
  else customEditions.push(edition);
  persistCustomEditions();
  return { ok: true, edition };
}

export function deleteEdition(id: string): { ok: boolean; error?: string } {
  if (BUILT_IN_EDITIONS.some((e) => e.id === id)) {
    return { ok: false, error: 'Eingebaute Editionen können nicht gelöscht werden.' };
  }
  const before = customEditions.length;
  customEditions = customEditions.filter((e) => e.id !== id);
  if (customEditions.length === before) return { ok: false, error: 'Edition nicht gefunden.' };
  persistCustomEditions();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Fragenpakete
//
// Spiegelt die Editionen-Verwaltung darüber Zeile für Zeile: JSON-Datei im
// DATA_DIR, Modul-Cache, eingebaut + eigene. Derselbe Grundsatz bei der
// Bereinigung – Struktur aus dem Code, Inhalt vom Nutzer: Kategorien und
// Stufen werden erzwungen, alle Texte sind frei (nur längenbegrenzt).
// ---------------------------------------------------------------------------

const MAX_PACK_JSON = 2_000_000;

let customPacks: TriviaPack[] = loadCustomPacks();

function loadCustomPacks(): TriviaPack[] {
  try {
    const raw = fs.readFileSync(PACKS_FILE, 'utf8');
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function persistCustomPacks(): void {
  ensureDirs();
  fs.writeFileSync(PACKS_FILE, JSON.stringify(customPacks), 'utf8');
}

export function allPacks(): TriviaPack[] {
  return [...BUILT_IN_PACKS, ...customPacks];
}

export function getPack(id: string): TriviaPack | undefined {
  return allPacks().find((p) => p.id === id);
}

/** Einzelne Frage bereinigen; `null`, wenn sie unbrauchbar ist. */
function cleanQuestion(raw: unknown, index: number): TriviaQuestion | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;

  const prompt = cleanString(r.prompt, MAX_PROMPT_LEN);
  const answer = cleanString(r.answer, MAX_ANSWER_LEN);
  if (!prompt || !answer) return null;
  if (!isTriviaCategory(r.category)) return null;

  const level = Number(r.level);
  if (!isTriviaLevel(level)) return null;

  const accept = Array.isArray(r.accept)
    ? r.accept.map((a) => cleanString(a, MAX_ANSWER_LEN)).filter(Boolean).slice(0, 8)
    : [];

  return {
    id: cleanString(r.id, 60) || `q-${randomId(6)}-${index}`,
    category: r.category,
    level,
    prompt,
    answer,
    ...(accept.length ? { accept } : {}),
  };
}

export function upsertPack(input: unknown): { ok: true; pack: TriviaPack } | { ok: false; error: string } {
  if (typeof input !== 'object' || input === null) return { ok: false, error: 'Ungültiges Paket.' };
  const raw = input as Record<string, unknown>;

  const name = cleanString(raw.name, MAX_PACK_NAME);
  if (!name) return { ok: false, error: 'Das Paket braucht einen Namen.' };

  const rawQuestions = Array.isArray(raw.questions) ? raw.questions : [];
  if (rawQuestions.length > MAX_QUESTIONS_PER_PACK) {
    return { ok: false, error: `Höchstens ${MAX_QUESTIONS_PER_PACK} Fragen pro Paket.` };
  }

  const questions: TriviaQuestion[] = [];
  const seenIds = new Set<string>();
  rawQuestions.forEach((q, i) => {
    const cleaned = cleanQuestion(q, i);
    if (!cleaned) return;
    // Doppelte IDs würden das Ziehen ohne Zurücklegen aushebeln.
    if (seenIds.has(cleaned.id)) cleaned.id = `${cleaned.id}-${randomId(4)}`;
    seenIds.add(cleaned.id);
    questions.push(cleaned);
  });

  const requestedId = cleanString(raw.id, 60);
  const isBuiltInId = BUILT_IN_PACKS.some((p) => p.id === requestedId);
  const id = !requestedId || isBuiltInId ? `pack-${randomId(8)}` : requestedId;

  const pack: TriviaPack = {
    id,
    name,
    description: cleanString(raw.description, MAX_PACK_DESC),
    builtIn: false,
    language: cleanString(raw.language, 8, 'de') || 'de',
    questions,
  };

  if (JSON.stringify(pack).length > MAX_PACK_JSON) {
    return { ok: false, error: 'Paket zu groß.' };
  }

  const idx = customPacks.findIndex((p) => p.id === id);
  if (idx >= 0) customPacks[idx] = pack;
  else customPacks.push(pack);
  persistCustomPacks();
  return { ok: true, pack };
}

export function deletePack(id: string): { ok: boolean; error?: string } {
  if (BUILT_IN_PACKS.some((p) => p.id === id)) {
    return { ok: false, error: 'Eingebaute Pakete können nicht gelöscht werden.' };
  }
  const before = customPacks.length;
  customPacks = customPacks.filter((p) => p.id !== id);
  if (customPacks.length === before) return { ok: false, error: 'Paket nicht gefunden.' };
  persistCustomPacks();
  return { ok: true };
}

/** Erstes bespielbares Paket – Rückfall, wenn eine Auswahl ins Leere zeigt. */
export function defaultPackId(): string {
  const usable = allPacks().find((p) => checkPack(p).ok);
  return (usable ?? BUILT_IN_PACKS[0]).id;
}

// ---------------------------------------------------------------------------
// Spielstände
// ---------------------------------------------------------------------------

interface SaveFile {
  meta: SaveGameMeta;
  game: GameState;
}

export function saveGame(game: GameState): SaveGameMeta {
  ensureDirs();
  const id = `save-${Date.now()}-${randomId(6)}`;
  const meta: SaveGameMeta = {
    id,
    name: `${game.edition.name} – Runde ${game.turnCount}`,
    savedAt: Date.now(),
    players: game.players.filter((p) => !p.bankrupt).map((p) => p.name),
    editionName: game.edition.name,
    turnCount: game.turnCount,
    phase: game.phase,
  };
  const file: SaveFile = { meta, game };
  fs.writeFileSync(path.join(SAVES_DIR, `${id}.json`), JSON.stringify(file), 'utf8');
  return meta;
}

export function listSaves(): SaveGameMeta[] {
  ensureDirs();
  const metas: SaveGameMeta[] = [];
  for (const f of fs.readdirSync(SAVES_DIR)) {
    if (!f.endsWith('.json')) continue;
    try {
      const file = JSON.parse(fs.readFileSync(path.join(SAVES_DIR, f), 'utf8')) as SaveFile;
      if (file.meta && file.game) metas.push(file.meta);
    } catch {
      // defekte Datei ignorieren
    }
  }
  return metas.sort((a, b) => b.savedAt - a.savedAt);
}

export function loadSave(id: string): GameState | null {
  if (!/^save-[\w-]+$/.test(id)) return null;
  try {
    const file = JSON.parse(fs.readFileSync(path.join(SAVES_DIR, `${id}.json`), 'utf8')) as SaveFile;
    return file.game ?? null;
  } catch {
    return null;
  }
}

export function deleteSave(id: string): boolean {
  if (!/^save-[\w-]+$/.test(id)) return false;
  try {
    fs.unlinkSync(path.join(SAVES_DIR, `${id}.json`));
    return true;
  } catch {
    return false;
  }
}
