import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { CardDatabase } from './schema.js';
import { cards } from './index.js';
import { parseCardsLua } from './lua.js';
import { CARDS_LUA } from './generate.js';
import artManifestJson from './data/art.json' with { type: 'json' };

export const ArtEntrySchema = z.object({
  // TTS asset filenames include a capitalised deck (edificeFront/edificeBack).
  file: z.string().regex(/^[A-Za-z0-9._-]+\.(webp|png|jpg)$/),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});
export type ArtEntry = z.infer<typeof ArtEntrySchema>;

/**
 * Key is a card id, or `${id}#ruin` for an edifice/ruin's ruin face, or
 * `${id}#1` (`#2`, …) for a two-faced banner's later faces. Sites use their
 * normal id.
 */
export const ArtManifestSchema = z.record(z.string(), ArtEntrySchema);
export type ArtManifest = z.infer<typeof ArtManifestSchema>;

export const DEFAULT_ART_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  'data/art.json',
);

/** The directory the real asset files live in. Not in git. */
export const ART_DIR = process.env.ART_DIR ?? join(process.cwd(), 'assets/art');

/** One key per card face that needs art, in collection / saveId order. */
export function requiredArtKeys(db: CardDatabase): string[] {
  const keys: string[] = [];
  for (const d of db.denizens) keys.push(d.id);
  for (const s of db.sites) keys.push(s.id);
  for (const r of db.relics) keys.push(r.id);
  for (const v of db.visions) keys.push(v.id);
  for (const e of db.edifices) {
    keys.push(e.id);
    keys.push(`${e.id}#ruin`);
  }
  for (const b of db.banners) {
    keys.push(b.id);
    for (let i = 1; i < b.faces.length; i++) keys.push(`${b.id}#${i}`);
  }
  return keys;
}

// --- Tabletop Simulator asset naming (the mod's per-card renders) ----------
//
// The real art (permission of Leder Games) ships as individual PNGs named by
// their TTS deck + slot, e.g. `cards_04.png`. The mod's `ttscardid` encodes
// exactly that: the first three digits are the deck id, the last two the
// 0-based slot within it. `cards.lua` carries a `ttscardid` for every card
// keyed by the same `saveid` our database is built from, so the join is by
// saveId — slot-stable, and immune to the name reconciliation P1 applies
// (a card renamed by an override still lives in the same slot, so its art is
// still correct).

/** TTS deck id → the filename prefix the sliced assets use. */
const DECK_PREFIX: Record<number, string> = {
  100: 'lands1',
  101: 'lands2',
  102: 'lands3',
  110: 'cards',
  111: 'cards2',
  112: 'cards3',
  113: 'cards4',
  114: 'cards5',
  115: 'cards6',
  116: 'cards7',
  117: 'cards8',
  118: 'cards9',
  119: 'cards10',
  120: 'visions',
  121: 'edificeFront', // ruin faces override to edificeBack
  131: 'relics',
};

/**
 * The two banners are SuperRelics in the mod with no `ttscardid`, so they are
 * hand-mapped to their dedicated renders. Face 0 is the base id; face 1 (the
 * People's Favor's Mob side, Law §2.5.3) is the back.
 */
const BANNER_FILES: Record<string, string> = {
  'banner:darkest-secret': 'darkestsecret_front.png',
  'banner:peoples-favor': 'peoplesfavor_front.png',
  'banner:peoples-favor#1': 'peoplesfavor_back.png',
};

/**
 * Non-card assets the art route may serve: the board mat, the site back
 * (`lands3_08.png` — the deck's unused 24th slot, the facedown-site face),
 * the player boards, the wooden pieces (warbands, pawns) and the tokens
 * (vision, turn, secret), and the deck backs. Kept as an explicit allowlist
 * so the route never serves a name it was not told to — the same membership
 * discipline the manifest gives card files.
 */
export const SITE_BACK_FILE = 'lands3_08.png';
export const DENIZEN_BACK_FILE = 'denizen card backv2.png';

/** Every wooden-piece colour. Purple is the Chancellor; the rest are Exiles. */
export const SEAT_COLORS = ['red', 'blue', 'yellow', 'white', 'black', 'purple'] as const;
/** The five Exile colours, assigned to non-Chancellor seats in order. */
export const EXILE_COLORS = ['red', 'blue', 'yellow', 'white', 'black'] as const;

const PLAYER_BOARDS = [
  'player_board_chancellor.png',
  ...EXILE_COLORS.flatMap((c) => [`player_board_${c}_citizen.png`, `player_board_${c}_exile.png`]),
];
const PIECES = [
  ...SEAT_COLORS.map((c) => `warband ${c}.png`),
  ...EXILE_COLORS.map((c) => `player ${c}.png`),
  'chancellor.png', // the Chancellor's (purple) pawn
  ...SEAT_COLORS.map((c) => `supply ${c} shadow.png`), // supply markers
  'favour.png', // the gold favor coin
  'Vision marker.png',
  'turn marker.png',
  'secret.png',
  DENIZEN_BACK_FILE,
  'relicBack.png',
];

export const UI_ASSETS: readonly string[] = ['full_board.png', SITE_BACK_FILE, ...PLAYER_BOARDS, ...PIECES];

/** The filename the sliced TTS asset for a `ttscardid` carries. */
function ttsFile(ttscardid: string, opts?: { ruin?: boolean }): string {
  const deck = Number(ttscardid.slice(0, 3));
  const slot = Number(ttscardid.slice(3));
  const prefix = deck === 121 && opts?.ruin ? 'edificeBack' : DECK_PREFIX[deck];
  if (prefix === undefined) throw new Error(`art: unknown TTS deck ${deck} in ttscardid ${ttscardid}`);
  return `${prefix}_${String(slot + 1).padStart(2, '0')}.png`;
}

interface SaveIdMaps {
  /** Sites have their own saveId namespace (cards.lua's own note). */
  sites: Map<number, string>;
  /** Denizens, visions, relics and edifice/ruins share one namespace. */
  cards: Map<number, string>;
}

/** saveId → ttscardid, parsed from the vendored cards.lua. */
function ttsSaveIdMaps(): SaveIdMaps {
  const records = parseCardsLua(readFileSync(CARDS_LUA, 'utf8'));
  const sites = new Map<number, string>();
  const cardsBySaveId = new Map<number, string>();
  for (const r of records) {
    const tts = r.fields.ttscardid;
    const saveid = r.fields.saveid;
    if (typeof tts !== 'string' || typeof saveid !== 'number') continue;
    (r.fields.cardtype === 'Site' ? sites : cardsBySaveId).set(saveid, tts);
  }
  return { sites, cards: cardsBySaveId };
}

/** A manifest naming the real TTS asset for every required key. */
export function generateArtManifest(db: CardDatabase): ArtManifest {
  const maps = ttsSaveIdMaps();
  const manifest: ArtManifest = {};

  const put = (key: string, table: Map<number, string>, saveId: number, opts?: { ruin?: boolean }) => {
    const tts = table.get(saveId);
    if (tts === undefined) throw new Error(`art: no TTS card for ${key} (saveId ${saveId})`);
    manifest[key] = { file: ttsFile(tts, opts) };
  };

  for (const d of db.denizens) put(d.id, maps.cards, d.saveId);
  for (const s of db.sites) put(s.id, maps.sites, s.saveId);
  for (const r of db.relics) put(r.id, maps.cards, r.saveId);
  for (const v of db.visions) put(v.id, maps.cards, v.saveId);
  for (const e of db.edifices) {
    put(e.id, maps.cards, e.faces.edifice.saveId);
    put(`${e.id}#ruin`, maps.cards, e.faces.edifice.saveId, { ruin: true });
  }
  for (const b of db.banners) {
    const keys = [b.id, ...Array.from({ length: b.faces.length - 1 }, (_, i) => `${b.id}#${i + 1}`)];
    for (const key of keys) {
      const file = BANNER_FILES[key];
      if (file === undefined) throw new Error(`art: no banner image mapped for ${key}`);
      manifest[key] = { file };
    }
  }
  return manifest;
}

export function loadArtManifest(path = DEFAULT_ART_PATH): ArtManifest {
  const manifest = ArtManifestSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  const required = new Set(requiredArtKeys(cards));
  const orphans = Object.keys(manifest).filter((k) => !required.has(k));
  if (orphans.length > 0) {
    throw new Error(`art manifest: keys that are not card faces: ${orphans.join(', ')}`);
  }
  return manifest;
}

/**
 * The committed manifest, BUNDLED as a module (not read from disk) so it
 * ships into `dist/` the same way the card data does and needs no cwd- or
 * path-sensitive fs read at runtime. Tooling and tests still use
 * `loadArtManifest(path)` for the on-disk file.
 */
export const ART_MANIFEST: ArtManifest = ArtManifestSchema.parse(artManifestJson);

/**
 * Every filename the art route may serve: the card faces the manifest names,
 * plus the UI assets. Used as the route's membership check — a request for
 * anything outside this set is a 404, which is also the traversal defense.
 */
export function servableArtFiles(manifest: ArtManifest = ART_MANIFEST): Set<string> {
  const files = new Set<string>(UI_ASSETS);
  for (const entry of Object.values(manifest)) files.add(entry.file);
  return files;
}

/** Required keys with no entry in the manifest. */
export function missingArt(manifest: ArtManifest, db: CardDatabase): string[] {
  return requiredArtKeys(db).filter((k) => manifest[k] === undefined);
}

/** Manifest keys whose asset file is not present in `dir`. */
export function missingAssets(manifest: ArtManifest, dir: string): string[] {
  return Object.entries(manifest)
    .filter(([, entry]) => !existsSync(join(dir, entry.file)))
    .map(([key]) => key);
}
