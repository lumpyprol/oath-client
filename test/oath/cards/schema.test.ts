import { describe, it, expect } from 'vitest';
import {
  SUITS,
  SUIT_INDEX,
  SuitSchema,
  DenizenSchema,
  CardDatabaseSchema,
} from '../../../src/oath/cards/schema.js';

// ---- fake builders (no real card data) -------------------------------------

const denizen = (over: Record<string, unknown> = {}) => ({
  id: 'denizen:fake-one',
  name: 'Fake One',
  set: 'base',
  saveId: 10,
  suit: 'discord',
  ...over,
});

const site = (over: Record<string, unknown> = {}) => ({
  id: 'site:fake-site',
  name: 'Fake Site',
  set: 'base',
  saveId: 1,
  capacity: 2,
  reveal: { favor: 0, secrets: 0, relics: 1 },
  recoverCost: { kind: 'burnFavor' },
  ...over,
});

const relic = (over: Record<string, unknown> = {}) => ({
  id: 'relic:fake-relic',
  name: 'Fake Relic',
  set: 'base',
  saveId: 20,
  defenseDice: 2,
  ...over,
});

const vision = (over: Record<string, unknown> = {}) => ({
  id: 'vision:fake-vision',
  name: 'Fake Vision',
  set: 'base',
  saveId: 30,
  ...over,
});

const edifice = (over: Record<string, unknown> = {}) => ({
  id: 'edifice:fake-edifice',
  name: 'Fake Edifice',
  set: 'base',
  saveId: 40,
  suit: 'hearth',
  faces: {
    edifice: { name: 'Fake Edifice', saveId: 40 },
    ruin: { name: 'Fake Ruin', saveId: 41 },
  },
  ...over,
});

const banner = (over: Record<string, unknown> = {}) => ({
  id: 'banner:fake-banner',
  name: 'Fake Banner A',
  set: 'base',
  saveId: 50,
  faces: ['Fake Banner A', 'Fake Banner B'],
  ...over,
});

const db = (over: Record<string, unknown> = {}) => ({
  denizens: [denizen()],
  sites: [site()],
  relics: [relic()],
  visions: [vision()],
  edifices: [edifice()],
  banners: [banner()],
  ...over,
});

// ---- suit order -----------------------------------------------------------

describe('suit ordering', () => {
  it('SUITS is the seed-format order', () => {
    expect([...SUITS]).toEqual([
      'discord',
      'hearth',
      'nomad',
      'arcane',
      'order',
      'beast',
    ]);
  });

  it('SUIT_INDEX matches that order', () => {
    expect(SUIT_INDEX).toEqual({
      discord: 0,
      hearth: 1,
      nomad: 2,
      arcane: 3,
      order: 4,
      beast: 5,
    });
    SUITS.forEach((s, i) => expect(SUIT_INDEX[s]).toBe(i));
  });

  it('SuitSchema rejects an unknown suit', () => {
    expect(SuitSchema.safeParse('discord').success).toBe(true);
    expect(SuitSchema.safeParse('rainbow').success).toBe(false);
  });
});

// ---- happy path ---------------------------------------------------------

describe('CardDatabaseSchema — valid data', () => {
  it('parses a minimal valid database', () => {
    expect(CardDatabaseSchema.safeParse(db()).success).toBe(true);
  });

  it('a site and a denizen may share a saveId (separate numbering)', () => {
    const res = CardDatabaseSchema.safeParse(
      db({
        sites: [site({ saveId: 10 })], // same as denizen():saveId
        denizens: [denizen({ saveId: 10 })],
      }),
    );
    expect(res.success).toBe(true);
  });
});

// ---- rejections --------------------------------------------------------

describe('CardDatabaseSchema — rejections', () => {
  it('rejects an unknown suit on a denizen', () => {
    expect(DenizenSchema.safeParse(denizen({ suit: 'rainbow' })).success).toBe(
      false,
    );
  });

  it('rejects saveId 255', () => {
    expect(
      CardDatabaseSchema.safeParse(db({ denizens: [denizen({ saveId: 255 })] }))
        .success,
    ).toBe(false);
  });

  it('rejects an id whose prefix does not match its kind', () => {
    expect(DenizenSchema.safeParse(denizen({ id: 'site:foo' })).success).toBe(
      false,
    );
  });

  it('rejects a ruin saveId that is not edifice saveId + 1', () => {
    const bad = edifice({
      faces: {
        edifice: { name: 'E', saveId: 40 },
        ruin: { name: 'R', saveId: 45 },
      },
    });
    expect(
      CardDatabaseSchema.safeParse(db({ edifices: [bad] })).success,
    ).toBe(false);
  });

  it('rejects a duplicate id across two collections', () => {
    const res = CardDatabaseSchema.safeParse(
      db({
        relics: [relic({ id: 'relic:dup', saveId: 20 })],
        visions: [vision({ id: 'relic:dup', saveId: 30 })],
      }),
    );
    expect(res.success).toBe(false);
  });

  it('rejects a duplicate saveId between a denizen and a relic', () => {
    const res = CardDatabaseSchema.safeParse(
      db({
        denizens: [denizen({ saveId: 77 })],
        relics: [relic({ saveId: 77 })],
      }),
    );
    expect(res.success).toBe(false);
  });

  it('rejects a duplicate saveId between a denizen and an edifice ruin face', () => {
    const res = CardDatabaseSchema.safeParse(
      db({
        denizens: [denizen({ saveId: 41 })], // edifice() ruin face is 41
      }),
    );
    expect(res.success).toBe(false);
  });
});
