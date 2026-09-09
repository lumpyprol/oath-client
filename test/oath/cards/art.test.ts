import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  ART_DIR,
  ArtManifestSchema,
  generateArtManifest,
  loadArtManifest,
  missingArt,
  missingAssets,
  requiredArtKeys,
} from '../../../src/oath/cards/art.js';
import { generate } from '../../../src/oath/cards/generate.js';

const db = generate();

describe('requiredArtKeys', () => {
  it('is one key per face: 1 per denizen/site/relic/vision, 2 per edifice, 1 per banner face', () => {
    const keys = requiredArtKeys(db);
    const expected =
      db.denizens.length +
      db.sites.length +
      db.relics.length +
      db.visions.length +
      db.edifices.length * 2 +
      db.banners.reduce((n, b) => n + b.faces.length, 0);
    expect(keys).toHaveLength(expected);
    expect(new Set(keys).size).toBe(keys.length); // no duplicates
    expect(keys).toContain('edifice:sprawling-rampart');
    expect(keys).toContain('edifice:sprawling-rampart#ruin');
    expect(keys).toContain('banner:peoples-favor#1');
  });
});

describe('loadArtManifest', () => {
  it('loads the committed manifest and it schema-validates', () => {
    const manifest = loadArtManifest();
    expect(ArtManifestSchema.safeParse(manifest).success).toBe(true);
  });

  it('throws naming an orphan key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'oath-art-'));
    const path = join(dir, 'art.json');
    writeFileSync(
      path,
      JSON.stringify({ 'denizen:not-a-card': { file: 'x.webp' } }),
    );
    expect(() => loadArtManifest(path)).toThrow(/denizen:not-a-card/);
  });
});

describe('missingArt', () => {
  it('an empty manifest is missing every required key', () => {
    expect(missingArt({}, db)).toEqual(requiredArtKeys(db));
  });

  it('the committed manifest is missing nothing', () => {
    expect(missingArt(loadArtManifest(), db)).toEqual([]);
  });
});

describe('missingAssets', () => {
  it('returns every key except the one whose file is present', () => {
    const manifest = generateArtManifest(db);
    const dir = mkdtempSync(join(tmpdir(), 'oath-assets-'));
    const present = manifest['denizen:wrestlers'].file;
    writeFileSync(join(dir, present), 'fake');

    const missing = missingAssets(manifest, dir);
    expect(missing).not.toContain('denizen:wrestlers');
    expect(missing).toHaveLength(Object.keys(manifest).length - 1);
  });
});

// Real assets aren't in git. This only runs where they've been placed.
describe.skipIf(!existsSync(ART_DIR))('real asset directory', () => {
  it('every required face has art and every art file exists', () => {
    const manifest = loadArtManifest();
    expect(missingArt(manifest, db)).toEqual([]);
    expect(missingAssets(manifest, ART_DIR)).toEqual([]);
  });
});
