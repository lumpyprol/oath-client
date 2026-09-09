import { describe, it, expect } from 'vitest';
import { parseSeed, serializeSeed } from '../../../src/oath/chronicle/seed.js';
import { parseOathTTSSavefileString } from '../../../src/oath/chronicle/vendor/parser.js';
import { findById } from '../../../src/oath/cards/index.js';
import { SUIT_INDEX } from '../../../src/oath/cards/schema.js';

// The two sample seeds are copied verbatim from the vendored parser's own
// tests: vendor/oathparser is Vagabottos/OathParser @ 53b7f53, and these
// strings are in its test/savefile.ts and test/inverseParse.ts.
const SAMPLE_SEEDS = [
  '030100000710Empire and Exile00180234152011FFFFFF21FFFFFF0AFFFFFF25FFFFFF1FFFFFFF05FFFFFF2EFFFFFF2AFFFFFF4107D313A90BC301411BD4B96FBF0509399EA684173132A89AD6D223D53F107F481214751F438CA3352F2A64614B080AAFA20F1D8A727D1EC0332D55605B2C8B3E211E110C222E201A290D261502242803192B2718253004341606000E4A971CAB02E8DE',
  '030301000210Empire and Exile0002010123450CFFFFDF22FFFFFF12FFFFFF2EFFFFFF25FFFFFF05FFFFFF21FFFFFF1EFFFFFF3B3F67266B0488D6A316D5B9A87CD2A0867A9C1966D3337649B268D45401AFB0C04092610DB6937F413996943647B157B7659013A6956C519E89557306C39A64503B3213E0E2E7DBDDDCDEE6E1E9E3EDDAE8E4ECEBE5EA000407UNKNOWN',
];

function allSeedCardIds(parsed: ReturnType<typeof parseSeed>): string[] {
  const ids: string[] = [];
  for (const site of parsed.sites) {
    if (site.id !== null) ids.push(site.id);
    for (const c of site.cards) if (c) ids.push(c.id);
  }
  for (const c of [...parsed.world, ...parsed.dispossessed, ...parsed.relics]) {
    ids.push(c.id);
  }
  return ids;
}

describe.each(SAMPLE_SEEDS)('sample seed %#', (seed) => {
  it('parseSeed succeeds', () => {
    expect(() => parseSeed(seed)).not.toThrow();
  });

  it('every id it produces resolves in the card data', () => {
    for (const id of allSeedCardIds(parseSeed(seed))) {
      expect(findById(id), id).toBeDefined();
    }
  });

  it('serializeSeed(parseSeed(seed)) === seed', () => {
    expect(serializeSeed(parseSeed(seed))).toBe(seed);
  });

  it('suit order round-trips through the enum', () => {
    const parsed = parseSeed(seed);
    const rawOrder = parseOathTTSSavefileString(seed).suitOrder;
    expect(parsed.suitOrder.map((s) => SUIT_INDEX[s])).toEqual(rawOrder);
  });
});

describe('corrupted seeds', () => {
  it('a card byte that maps to no card throws, naming the position', () => {
    const seed = SAMPLE_SEEDS[0];
    // Offset 106 is world[0]'s byte (see the format layout); 0xFD is unused.
    const corrupt = `${seed.slice(0, 106)}FD${seed.slice(108)}`;
    expect(() => parseSeed(corrupt)).toThrow(/world\[0\]/);
  });

  it('a site byte that maps to no site throws, naming the position', () => {
    const seed = SAMPLE_SEEDS[0];
    // Offset 40 is Site1's byte; 0xEE is not a valid site index.
    const corrupt = `${seed.slice(0, 40)}EE${seed.slice(42)}`;
    expect(() => parseSeed(corrupt)).toThrow(/sites\[0\]/);
  });
});
