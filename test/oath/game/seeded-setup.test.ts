import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';
import { checkInvariants, type OathState } from '../../../src/oath/game/state.js';
import { init, oathSetup, specFromSeed } from '../../../src/oath/game/setup.js';
import { parseSeed } from '../../../src/oath/chronicle/seed.js';
import { IllegalAction } from '../../../src/engine/types.js';

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'oath-seeded-')), 'test.db');
let store: typeof import('../../../src/actionlog.js');
let db: typeof import('../../../src/db.js')['db'];
let oath: typeof import('../../../src/oath/game/index.js')['oath'];

beforeAll(async () => {
  store = await import('../../../src/actionlog.js');
  ({ db } = await import('../../../src/db.js'));
  ({ oath } = await import('../../../src/oath/game/index.js'));
});

// The same two strings test/oath/chronicle/seed.test.ts uses, copied with
// its comment: vendor/oathparser is Vagabottos/OathParser @ 53b7f53, and
// these are from its own test/savefile.ts and test/inverseParse.ts.
//
// They are PARSER fixtures, not curated games, and they differ usefully:
// seed 1 is a plausible complete chronicle (20 relics accounted for, a
// relic sitting at a site), while seed 0 is degenerate — two Citizens, no
// cards in play, and only 2 loose relics, which is fewer than the Imperial
// Reliquary's four spaces. Both must still boot.
const SEEDS = [
  '030100000710Empire and Exile00180234152011FFFFFF21FFFFFF0AFFFFFF25FFFFFF1FFFFFFF05FFFFFF2EFFFFFF2AFFFFFF4107D313A90BC301411BD4B96FBF0509399EA684173132A89AD6D223D53F107F481214751F438CA3352F2A64614B080AAFA20F1D8A727D1EC0332D55605B2C8B3E211E110C222E201A290D261502242803192B2718253004341606000E4A971CAB02E8DE',
  '030301000210Empire and Exile0002010123450CFFFFDF22FFFFFF12FFFFFF2EFFFFFF25FFFFFF05FFFFFF21FFFFFF1EFFFFFF3B3F67266B0488D6A316D5B9A87CD2A0867A9C1966D3337649B268D45401AFB0C04092610DB6937F413996943647B157B7659013A6956C519E89557306C39A64503B3213E0E2E7DBDDDCDEE6E1E9E3EDDAE8E4ECEBE5EA000407UNKNOWN',
];

describe.each(SEEDS.map((s, i) => [i, s] as const))('sample seed %i boots', (_i, seed) => {
  it.each([2, 3, 4, 5, 6])('at %i seats, into an invariant-clean game', (seats) => {
    const state = init(oathSetup(seats, { seed }));
    checkInvariants(state);
    expect(state.seats).toBe(seats);
    expect(state.players).toHaveLength(seats);
    expect(state.players[0].citizenship).toBe('chancellor');
    expect(state.complete).toBe(false);
  });
});

describe('what a seed carries through to state', () => {
  it('the Oath, the suit order, and per-seat citizenship', () => {
    const parsed = parseSeed(SEEDS[0]);
    const state = init(oathSetup(4, { seed: SEEDS[0] }));
    checkInvariants(state);
    expect(state.oath).toBe('devotion'); // the seed names "Devotion"
    // Seed 0 records Brown and Yellow as Citizens; they are seats 1 and 2.
    expect(parsed.playerCitizenship).toMatchObject({ Brown: 'Citizen', Yellow: 'Citizen' });
    expect(state.players.map((p) => p.citizenship)).toEqual([
      'chancellor',
      'citizen',
      'citizen',
      'exile',
    ]);
  });

  it('the board: every slot filled, facedown flags, and a relic kept beside its site', () => {
    const parsed = parseSeed(SEEDS[1]);
    const state = init(oathSetup(3, { seed: SEEDS[1] }));
    checkInvariants(state);
    expect(state.sites.map((s) => s.id)).toEqual(parsed.sites.map((s) => s.id));
    expect(state.sites.map((s) => s.facedown)).toEqual(parsed.sites.map((s) => s.ruined));
    // Seed 1 puts relic:horned-mask in the FIRST site's card slots. The Law
    // keeps relics beside a site (§2.8.2), not in its capacity (§2.8.1), so
    // specFromSeed splits them out.
    expect(state.sites[0].relics).toContain('relic:horned-mask');
    expect(state.sites[0].cards.some((c) => c?.id === 'relic:horned-mask')).toBe(false);
  });

  it('§1.13 reads the SEED\'s oath, not a default', () => {
    // Seed 1 is a People game, so the Chancellor starts holding that banner.
    const people = init(oathSetup(3, { seed: SEEDS[1] }));
    expect(people.banners.find((b) => b.id === 'banner:peoples-favor')!.holder).toBe(0);
    // Seed 0 is Devotion, so it is the Darkest Secret instead.
    const devotion = init(oathSetup(3, { seed: SEEDS[0] }));
    expect(devotion.banners.find((b) => b.id === 'banner:darkest-secret')!.holder).toBe(0);
    expect(devotion.banners.find((b) => b.id === 'banner:peoples-favor')!.holder).toBeNull();
  });

  it("a Chronicled Citizen's 3 warbands come out of the Chancellor's 24 (Law §1.15)", () => {
    const state = init(oathSetup(4, { seed: SEEDS[0] })); // two Citizens
    checkInvariants(state); // the purple total is what this really asserts
    expect(state.players[1].warbands).toEqual({ bank: 0, board: 3 });
    expect(state.players[2].warbands).toEqual({ bank: 0, board: 3 });
    const purple = state.players
      .filter((p) => p.citizenship !== 'exile')
      .reduce(
        (sum, p, i) =>
          sum + p.warbands.bank + p.warbands.board + state.sites.reduce((n, s) => n + s.warbands[i], 0),
        0,
      );
    expect(purple).toBeLessThanOrEqual(24);
  });

  it('fills the Reliquary as far as the seed allows (§1.17 with §9.3)', () => {
    // Seed 1 has relics to spare; seed 0 carries only two.
    const full = init(oathSetup(3, { seed: SEEDS[1] }));
    expect(full.reliquary.filter((s) => s.relicId !== null)).toHaveLength(4);

    const short = init(oathSetup(3, { seed: SEEDS[0] }));
    checkInvariants(short);
    expect(short.reliquary).toHaveLength(4); // the four printed spaces always exist
    expect(short.reliquary.filter((s) => s.relicId !== null)).toHaveLength(2);
  });
});

describe('what the seed fixes vs what setup rolls (D30/D37)', () => {
  it("preserves the chronicle's deck ORDER — §8.8 built it deliberately", () => {
    const a = oathSetup(3, { seed: SEEDS[1] });
    const b = oathSetup(3, { seed: SEEDS[1] });
    // Same seed, same deck: no reshuffle, unlike a first game.
    expect(a.worldDeck).toEqual(b.worldDeck);
    expect(a.relicDeck).toEqual(b.relicDeck);
    expect(a.startingAdviser).toEqual(b.startingAdviser);
    // ...and that order really is the seed's, minus what setup dealt away.
    const seeded = parseSeed(SEEDS[1]).world.map((c) => c.id);
    expect(seeded).toEqual(expect.arrayContaining(a.worldDeck));
    expect(a.worldDeck).toEqual(seeded.filter((id) => a.worldDeck.includes(id)));
  });

  it('a first game still reshuffles, so the two paths stay distinguishable', () => {
    const decks = new Set(
      Array.from({ length: 6 }, () => JSON.stringify(oathSetup(4, undefined).worldDeck)),
    );
    expect(decks.size).toBeGreaterThan(1);
  });
});

describe('rejections', () => {
  it('a seat count the seed cannot seat', () => {
    expect(() => oathSetup(7, { seed: SEEDS[0] })).toThrow(/2-6/);
    expect(() => oathSetup(1, { seed: SEEDS[0] })).toThrow(/2-6/);
  });

  it('a non-string seed, and a corrupted one', () => {
    expect(() => oathSetup(3, { seed: 42 })).toThrow(IllegalAction);
    expect(() => oathSetup(3, { seed: `${SEEDS[0].slice(0, -6)}ZZZZZZ` })).toThrow(IllegalAction);
  });

  it('an Oath the seed names that is not one of the four goals', () => {
    const parsed = { ...parseSeed(SEEDS[0]), oath: 'Conspiracy' };
    expect(() => specFromSeed(parsed, 3)).toThrow(/not one of the four/);
  });

  it('a board with an empty slot, or with every site facedown', () => {
    const base = parseSeed(SEEDS[1]);
    const holed = { ...base, sites: base.sites.map((s, i) => (i === 2 ? { ...s, id: null } : s)) };
    expect(() => specFromSeed(holed, 3)).toThrow(/slot 2 is empty/);

    const dark = { ...base, sites: base.sites.map((s) => ({ ...s, ruined: true })) };
    expect(() => specFromSeed(dark, 3)).toThrow(/every site facedown/);
  });

  it('still refuses a seatless first game, now pointing at seeds', () => {
    expect(() => oathSetup(3, undefined)).toThrow(/pass a chronicle seed/);
  });
});

describe('through the store (the route hands `options` straight to setup, HLD D31)', () => {
  it('creates a seeded game that loads back', () => {
    const { gameId } = store.createGame(oath, ['Chancellor', 'Red', 'Blue'], { seed: SEEDS[1] });
    const { state } = store.loadState(oath, gameId);
    checkInvariants(state as OathState);
    expect((state as OathState).oath).toBe('people');
  });

  it('a corrupted seed aborts the whole create — no game row is left behind', () => {
    const count = () => (db.prepare('SELECT COUNT(*) AS n FROM games').get() as { n: number }).n;
    const before = count();
    // `createGame` runs inside one transaction, so a throw from `setup()`
    // rolls back the game, player and marker rows with it. The 400 itself is
    // routes.ts's shared IllegalAction handler, exercised by the smoke script.
    expect(() =>
      store.createGame(oath, ['Chancellor', 'Red', 'Blue'], {
        seed: `${SEEDS[0].slice(0, -6)}ZZZZZZ`,
      }),
    ).toThrow(IllegalAction);
    expect(count()).toBe(before);
  });
});
