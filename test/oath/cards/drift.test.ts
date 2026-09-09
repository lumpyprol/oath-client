import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  COLLECTIONS,
  DATA_DIR,
  generate,
  serializeCollection,
} from '../../../src/oath/cards/generate.js';
import { CardDatabaseSchema } from '../../../src/oath/cards/schema.js';
import {
  ArtManifestSchema,
  generateArtManifest,
  loadArtManifest,
} from '../../../src/oath/cards/art.js';

const db = generate();

describe('committed card data does not drift from the generator', () => {
  for (const name of COLLECTIONS) {
    it(`${name}.json matches generate()`, () => {
      const file = join(DATA_DIR, `${name}.json`);
      const committed = JSON.parse(readFileSync(file, 'utf8'));
      const expected = JSON.parse(serializeCollection(db, name));
      expect(committed, `${name}.json is stale — run: npm run build:cards`).toEqual(
        expected,
      );
    });
  }
});

describe('committed art manifest does not drift from the generator', () => {
  it('art.json matches generateArtManifest()', () => {
    expect(
      loadArtManifest(),
      'art.json is stale — run: npm run build:art',
    ).toEqual(generateArtManifest(db));
  });

  it('art.json is schema-valid', () => {
    expect(ArtManifestSchema.safeParse(loadArtManifest()).success).toBe(true);
  });
});

describe('committed card data', () => {
  it('assembles into a schema-valid CardDatabase', () => {
    const assembled = Object.fromEntries(
      COLLECTIONS.map((name) => [
        name,
        JSON.parse(readFileSync(join(DATA_DIR, `${name}.json`), 'utf8')),
      ]),
    );
    const parsed = CardDatabaseSchema.safeParse(assembled);
    expect(parsed.success, parsed.error?.message).toBe(true);
  });
});
