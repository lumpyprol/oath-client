import { describe, it, expect } from 'vitest';
import {
  REGION_SITE_COUNTS,
  travelCost,
  discardRegion,
} from '../../../src/oath/game/map.js';
import { REGIONS, type Region } from '../../../src/oath/game/state.js';

describe('REGION_SITE_COUNTS', () => {
  it('has an entry for every region', () => {
    for (const r of REGIONS) expect(REGION_SITE_COUNTS[r]).toBeGreaterThan(0);
  });

  it('sums to the board site count (Law §2.1.1)', () => {
    const total = REGIONS.reduce((sum, r) => sum + REGION_SITE_COUNTS[r], 0);
    expect(total).toBe(8);
  });

  it('matches the rulebook per-region counts exactly (Law §2.1.1)', () => {
    expect(REGION_SITE_COUNTS.cradle).toBe(2);
    expect(REGION_SITE_COUNTS.provinces).toBe(3);
    expect(REGION_SITE_COUNTS.hinterland).toBe(3);
  });
});

describe('travelCost (Law §5.6.1)', () => {
  // [from, to, expected supply cost]
  const table: [Region, Region, number][] = [
    ['cradle', 'cradle', 1],
    ['cradle', 'provinces', 2],
    ['cradle', 'hinterland', 4],
    ['provinces', 'cradle', 2],
    ['provinces', 'provinces', 2],
    ['provinces', 'hinterland', 2],
    ['hinterland', 'cradle', 4],
    ['hinterland', 'provinces', 2],
    ['hinterland', 'hinterland', 3],
  ];

  it.each(table)('from %s to %s costs %i supply', (from, to, expected) => {
    expect(travelCost(from, to)).toBe(expected);
  });

  it('covers exactly the 9 region pairs (table-driven, all asserted)', () => {
    expect(table.length).toBe(REGIONS.length * REGIONS.length);
  });

  it('is asymmetric within a region: cost differs by region (Law §5.6.1)', () => {
    // same-region travel cost differs — 1 in Cradle, 2 in Provinces, 3 in
    // Hinterland — so this is NOT a single symmetric same-region constant
    expect(travelCost('cradle', 'cradle')).not.toBe(travelCost('provinces', 'provinces'));
    expect(travelCost('provinces', 'provinces')).not.toBe(travelCost('hinterland', 'hinterland'));
  });

  it('is symmetric across distinct regions (Law §5.6.1)', () => {
    expect(travelCost('cradle', 'provinces')).toBe(travelCost('provinces', 'cradle'));
    expect(travelCost('cradle', 'hinterland')).toBe(travelCost('hinterland', 'cradle'));
    expect(travelCost('provinces', 'hinterland')).toBe(travelCost('hinterland', 'provinces'));
  });
});

describe('discardRegion (Glossary "Discard")', () => {
  it('sends Cradle discards to the Provinces pile', () => {
    expect(discardRegion('cradle')).toBe('provinces');
  });
  it('sends Provinces discards to the Hinterland pile', () => {
    expect(discardRegion('provinces')).toBe('hinterland');
  });
  it('sends Hinterland discards to the Cradle pile', () => {
    expect(discardRegion('hinterland')).toBe('cradle');
  });
});
