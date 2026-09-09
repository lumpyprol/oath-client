import { describe, it, expect } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadTextOverlay,
  withText,
  type TextOverlay,
} from '../../../src/oath/cards/text.js';
import { generate } from '../../../src/oath/cards/generate.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, '../../fixtures/text.fake.json');
const db = generate();

describe('loadTextOverlay', () => {
  it('returns {} when the file is missing', () => {
    expect(loadTextOverlay(join(here, 'does-not-exist.json'))).toEqual({});
  });

  it('loads and validates the fixture', () => {
    const overlay = loadTextOverlay(FIXTURE);
    expect(Object.keys(overlay).sort()).toEqual([
      'denizen:wrestlers',
      'relic:brass-horse',
    ]);
    expect(overlay['denizen:wrestlers'].powerKind).toBe('battle');
  });
});

describe('withText', () => {
  const overlay = loadTextOverlay(FIXTURE);
  const merged = withText(db, overlay);

  it('attaches text to exactly the cards named in the overlay', () => {
    const withTextCount = [
      ...merged.denizens,
      ...merged.sites,
      ...merged.relics,
      ...merged.visions,
      ...merged.edifices,
      ...merged.banners,
    ].filter((c) => c.text !== undefined);
    expect(withTextCount.map((c) => c.id).sort()).toEqual([
      'denizen:wrestlers',
      'relic:brass-horse',
    ]);
  });

  it('attaches text / powerKind / notes from the entry', () => {
    const wrestlers = merged.denizens.find((d) => d.id === 'denizen:wrestlers')!;
    expect(wrestlers.text).toMatch(/^FAKE TEXT ONE/);
    expect(wrestlers.powerKind).toBe('battle');
    const horse = merged.relics.find((r) => r.id === 'relic:brass-horse')!;
    expect(horse.text).toMatch(/^FAKE TEXT TWO/);
    expect(horse.notes).toBe('FAKE NOTE');
  });

  it('cards without an entry have text === undefined', () => {
    const other = merged.denizens.find((d) => d.id !== 'denizen:wrestlers')!;
    expect(other.text).toBeUndefined();
    expect(other.powerKind).toBeUndefined();
  });

  it('throws naming an unknown card id', () => {
    const bad: TextOverlay = { 'denizen:not-a-real-card': { text: 'x' } };
    expect(() => withText(db, bad)).toThrow(/denizen:not-a-real-card/);
  });

  it('does not mutate the input database', () => {
    expect(db.denizens.find((d) => d.id === 'denizen:wrestlers')!.text).toBeUndefined();
  });
});

describe('engine-facing exports are unaffected in shape', () => {
  it('the loader still exposes the same lookup API', async () => {
    const mod = await import('../../../src/oath/cards/index.js');
    expect(typeof mod.byId).toBe('function');
    expect(typeof mod.byName).toBe('function');
    expect(typeof mod.bySaveId).toBe('function');
    expect(mod.cards.denizens).toHaveLength(198);
    // no real text.json is committed, so nothing carries text
    const anyText = [...mod.cards.denizens, ...mod.cards.relics].some(
      (c) => c.text !== undefined,
    );
    expect(anyText).toBe(false);
  });
});
