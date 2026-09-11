import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCardsLua } from '../../../src/oath/cards/lua.js';
import { buildDatabase, MOD_BANNER_CARDTYPE } from '../../../src/oath/cards/build.js';
import { loadSiteReveals } from '../../../src/oath/cards/generate.js';
import { CardDatabaseSchema, SUITS, type SiteRecoverCost } from '../../../src/oath/cards/schema.js';
import type { RawRecord } from '../../../src/oath/cards/lua.js';
import type { SiteReveal } from '../../../src/oath/cards/build.js';

const rec = (name: string, fields: Record<string, string | number>): RawRecord => ({
  name,
  fields,
});

/** A reveal map that answers any saveId, overridable per id. */
const reveals = (
  over: Record<
    number,
    { favor?: number; secrets?: number; relics?: number; recoverCost?: SiteRecoverCost | null }
  > = {},
) =>
  new Proxy({} as Record<number, SiteReveal>, {
    get: (_t, key) => ({ favor: 0, secrets: 0, relics: 0, recoverCost: null, ...over[Number(key)] }),
  });

describe('buildDatabase — per-cardtype mapping', () => {
  it('maps each cardtype to the right kind with the right fields', () => {
    const db = buildDatabase(
      [
        rec('Fake Site', { saveid: 1, cardtype: 'Site', capacity: 3 }),
        rec('Fake Denizen', { saveid: 5, cardtype: 'Denizen', suit: 'Hearth' }),
        rec('Fake Relic', { saveid: 100, cardtype: 'Relic' }),
        rec('Fake Vision', { saveid: 101, cardtype: 'Vision' }),
        rec('Fake Edifice / Fake Ruin', { saveid: 102, cardtype: 'EdificeRuin', suit: 'Beast' }),
        rec('Fake Front / Fake Back', { saveid: 110, cardtype: MOD_BANNER_CARDTYPE }),
        rec('Fake Lone Banner', { saveid: 120, cardtype: MOD_BANNER_CARDTYPE }),
      ],
      reveals({ 1: { favor: 1, secrets: 0, relics: 2, recoverCost: { kind: 'burnFavor' } } }),
    );

    expect(db.sites[0]).toMatchObject({
      id: 'site:fake-site',
      name: 'Fake Site',
      set: 'base',
      saveId: 1,
      capacity: 3,
      reveal: { favor: 1, secrets: 0, relics: 2 },
      recoverCost: { kind: 'burnFavor' },
    });
    expect(db.denizens[0]).toMatchObject({ id: 'denizen:fake-denizen', suit: 'hearth', saveId: 5 });
    expect(db.relics[0]).toMatchObject({ id: 'relic:fake-relic', saveId: 100 });
    expect(db.visions[0]).toMatchObject({ id: 'vision:fake-vision', saveId: 101 });
    expect(db.edifices[0]).toMatchObject({
      id: 'edifice:fake-edifice',
      name: 'Fake Edifice',
      suit: 'beast',
      saveId: 102,
      faces: {
        edifice: { name: 'Fake Edifice', saveId: 102 },
        ruin: { name: 'Fake Ruin', saveId: 103 },
      },
    });
    expect(db.banners[0]).toMatchObject({
      id: 'banner:fake-front',
      name: 'Fake Front',
      saveId: 110,
      faces: ['Fake Front', 'Fake Back'],
    });
    expect(db.banners[1]).toMatchObject({ name: 'Fake Lone Banner', faces: ['Fake Lone Banner'] });
  });

  it('drops UNUSED sites and None records', () => {
    const db = buildDatabase(
      [
        rec('UNUSED', { saveid: 23, cardtype: 'Site', capacity: 0 }),
        rec('NONE', { saveid: 255, cardtype: 'None' }),
        rec('Fake Site', { saveid: 1, cardtype: 'Site', capacity: 1 }),
      ],
      reveals(),
    );
    expect(db.sites).toHaveLength(1);
    expect(db.sites[0].name).toBe('Fake Site');
  });

  it('throws on an unknown cardtype', () => {
    expect(() => buildDatabase([rec('X', { saveid: 1, cardtype: 'Wormhole' })], reveals())).toThrow(
      /Wormhole/,
    );
  });

  it('throws on an edifice/ruin name without " / "', () => {
    expect(() =>
      buildDatabase([rec('Just One Name', { saveid: 4, cardtype: 'EdificeRuin', suit: 'Order' })], reveals()),
    ).toThrow(/ \/ /);
  });
});

describe('buildDatabase — real vendored file', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, '../../../vendor/oathparser/cards.lua'), 'utf8');
  const db = buildDatabase(parseCardsLua(source), loadSiteReveals());

  it('has the expected counts', () => {
    expect(db.denizens).toHaveLength(198);
    expect(db.sites).toHaveLength(23);
    expect(db.relics).toHaveLength(20);
    expect(db.visions).toHaveLength(5);
    expect(db.edifices).toHaveLength(6);
    expect(db.banners).toHaveLength(2);
  });

  it('every suit appears among denizens', () => {
    const seen = new Set(db.denizens.map((d) => d.suit));
    for (const s of SUITS) expect(seen.has(s)).toBe(true);
  });

  it('every suit appears exactly once among edifices', () => {
    expect(db.edifices.map((e) => e.suit).sort()).toEqual([...SUITS].sort());
  });

  it('passes the schema', () => {
    expect(CardDatabaseSchema.safeParse(db).success).toBe(true);
  });
});
