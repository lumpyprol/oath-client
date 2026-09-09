import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { CardDatabase } from './schema.js';
import { cards } from './index.js';

export const ArtEntrySchema = z.object({
  file: z.string().regex(/^[a-z0-9._-]+\.(webp|png|jpg)$/),
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

/** The asset filename this manifest generator assigns to a key. */
export function fileForKey(key: string, ext: 'webp' | 'png' | 'jpg' = 'webp'): string {
  return `${key.replace(/[:#]/g, '-')}.${ext}`;
}

/** A manifest with a derived filename for every required key. */
export function generateArtManifest(db: CardDatabase): ArtManifest {
  const manifest: ArtManifest = {};
  for (const key of requiredArtKeys(db)) manifest[key] = { file: fileForKey(key) };
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
