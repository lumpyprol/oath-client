import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCardsLua } from '../../../src/oath/cards/lua.js';
import { buildDatabase } from '../../../src/oath/cards/build.js';
import { loadSiteReveals } from '../../../src/oath/cards/generate.js';
import {
  findDiscrepancies,
  applyOverrides,
  isCovered,
  type Override,
} from '../../../src/oath/cards/reconcile.js';
import { loadTsCardNames, loadTsSiteNames } from '../../../src/oath/cards/tsNames.js';
import { CardDatabaseSchema, ID_RE } from '../../../src/oath/cards/schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '../../../');

const realDb = buildDatabase(
  parseCardsLua(readFileSync(join(repo, 'vendor/oathparser/cards.lua'), 'utf8')),
  loadSiteReveals(),
);
const tsCardNames = loadTsCardNames();
const tsSiteNames = loadTsSiteNames();
const overrides: Override[] = JSON.parse(
  readFileSync(join(repo, 'src/oath/cards/data/overrides.json'), 'utf8'),
);

// ---- unit: tiny fake witnesses -------------------------------------------

describe('findDiscrepancies — fake witnesses', () => {
  const fakeDb = CardDatabaseSchema.parse({
    denizens: [
      { id: 'denizen:aardvark', name: 'Aardvark', set: 'base', saveId: 0, suit: 'discord' },
      { id: 'denizen:badger', name: 'Badger', set: 'base', saveId: 1, suit: 'hearth' },
      { id: 'denizen:camel', name: 'Camel', set: 'base', saveId: 2, suit: 'nomad' },
    ],
    sites: [],
    relics: [],
    visions: [],
    edifices: [],
    banners: [],
  });

  it('reports exactly one swap and one rename', () => {
    const ds = findDiscrepancies(
      fakeDb,
      { Badger: 0, Aardvark: 1, Dromedary: 2 }, // 0/1 swapped, 2 renamed
      {},
    );
    expect(ds).toEqual([
      { numbering: 'card', saveId: 0, lua: 'Aardvark', ts: 'Badger' },
      { numbering: 'card', saveId: 1, lua: 'Badger', ts: 'Aardvark' },
      { numbering: 'card', saveId: 2, lua: 'Camel', ts: 'Dromedary' },
    ]);
  });
});

// ---- unit: applyOverrides ------------------------------------------------

describe('applyOverrides — fake db', () => {
  const fakeDb = CardDatabaseSchema.parse({
    denizens: [
      { id: 'denizen:camel', name: 'Camel', set: 'base', saveId: 2, suit: 'nomad' },
    ],
    sites: [],
    relics: [],
    visions: [],
    edifices: [],
    banners: [],
  });

  it('sets name, recomputes id, keeps saveId, records aliases', () => {
    const out = applyOverrides(fakeDb, [
      { numbering: 'card', saveId: 2, name: 'Dromedary', aliases: ['Camel'], reason: 'test' },
    ]);
    const card = out.denizens[0];
    expect(card.name).toBe('Dromedary');
    expect(card.id).toBe('denizen:dromedary');
    expect(card.id).toMatch(ID_RE);
    expect(card.saveId).toBe(2);
    expect(card.aliases).toEqual(['Camel']);
  });

  it('throws when no card matches the saveId', () => {
    expect(() =>
      applyOverrides(fakeDb, [
        { numbering: 'card', saveId: 99, name: 'Nope', aliases: [], reason: 'x' },
      ]),
    ).toThrow(/saveId 99/);
  });
});

// ---- data: overrides.json integrity ------------------------------------

describe('overrides.json', () => {
  it('every override has a nonempty reason', () => {
    for (const o of overrides) {
      expect(o.reason.trim().length).toBeGreaterThan(0);
    }
  });
});

// ---- integration: real data reconciles to zero uncovered --------------

describe('reconciliation of the real data', () => {
  it('leaves no uncovered discrepancy after applyOverrides', () => {
    const reconciled = applyOverrides(realDb, overrides);
    const remaining = findDiscrepancies(reconciled, tsCardNames, tsSiteNames);
    const uncovered = remaining.filter((d) => !isCovered(d, reconciled));

    if (uncovered.length > 0) {
      const lines = uncovered
        .map(
          (d) =>
            `  [${d.numbering} ${String(d.saveId).padStart(3)}]  lua=${JSON.stringify(d.lua)}  ts=${JSON.stringify(d.ts)}`,
        )
        .join('\n');
      throw new Error(
        `${uncovered.length} uncovered name discrepancies — resolve each in ` +
          `src/oath/cards/data/overrides.json:\n${lines}`,
      );
    }
    expect(uncovered).toEqual([]);
  });
});
