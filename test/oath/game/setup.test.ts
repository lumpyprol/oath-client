import { describe, it, expect } from 'vitest';
import { byId, byName, cards } from '../../../src/oath/cards/index.js';
import { checkInvariants, REGIONS } from '../../../src/oath/game/state.js';
import { REGION_SITE_COUNTS } from '../../../src/oath/game/map.js';
import {
  FIRST_GAME,
  oathSetup,
  init,
  type OathSetup,
  type SetupSpec,
} from '../../../src/oath/game/setup.js';

describe('FIRST_GAME', () => {
  it('every referenced id exists in the card database', () => {
    for (const site of FIRST_GAME.sites) {
      expect(() => byId(site.id)).not.toThrow();
      for (const d of site.denizens) expect(cards.denizens.some((c) => c.id === d) || cards.edifices.some((c) => c.id === d)).toBe(true);
      for (const r of site.relics) expect(cards.relics.some((c) => c.id === r)).toBe(true);
    }
    for (const r of FIRST_GAME.reliquary) expect(cards.relics.some((c) => c.id === r)).toBe(true);
    for (const id of FIRST_GAME.worldPool) {
      expect(
        cards.denizens.some((c) => c.id === id) || cards.visions.some((c) => c.id === id),
      ).toBe(true);
    }
  });

  it('site count and regions match REGION_SITE_COUNTS', () => {
    expect(FIRST_GAME.sites.length).toBe(
      REGIONS.reduce((n, r) => n + REGION_SITE_COUNTS[r], 0),
    );
    for (const r of REGIONS) {
      expect(FIRST_GAME.sites.filter((s) => s.region === r).length).toBe(
        REGION_SITE_COUNTS[r],
      );
    }
  });

  it('fixes the box first-game layout (Law §1.1, Oath Deck Order packet A)', () => {
    const byId = (id: string) => FIRST_GAME.sites.find((s) => s.id === id)!;
    expect(byId(byName('Plains').id).facedown).toBe(false);
    expect(byId(byName('Mountain').id).facedown).toBe(false);
    expect(byId(byName('Rocky Coast').id).facedown).toBe(false);
    for (const name of ['Lush Coast', 'Buried Giant', 'Wastes', 'Salt Flats', 'Great Slum']) {
      expect(byId(byName(name).id).facedown).toBe(true);
    }
    expect(byId(byName('Plains').id).denizens).toEqual([byName('Longbows').id]);
    expect(byId(byName('Mountain').id).denizens).toEqual([byName('Taming Charm').id]);
    expect(byId(byName('Rocky Coast').id).denizens).toEqual([byName('Elders').id]);
  });

  it('oath is Supremacy and seat 0 is the chancellor (Law §1.13, Playbook p8)', () => {
    expect(FIRST_GAME.oath).toBe('supremacy');
    expect(FIRST_GAME.citizenship[0]).toBe('chancellor');
    for (let i = 1; i < FIRST_GAME.citizenship.length; i++) {
      expect(FIRST_GAME.citizenship[i]).toBe('exile');
    }
  });
});

describe('oathSetup', () => {
  it('rejects a seat count FIRST_GAME was not built for', () => {
    expect(() => oathSetup(FIRST_GAME.citizenship.length + 1)).toThrow();
  });

  it('two runs differ in world deck order (a real shuffle happened)', () => {
    const a = oathSetup(FIRST_GAME.citizenship.length);
    const b = oathSetup(FIRST_GAME.citizenship.length);
    expect(a.worldDeck).not.toEqual(b.worldDeck);
  });

  it('the un-dealt world deck + advisers + discards partition worldPool (nothing lost, nothing duplicated)', () => {
    const setup = oathSetup(FIRST_GAME.citizenship.length);
    const all = [
      ...setup.worldDeck,
      ...setup.startingAdviser,
      ...REGIONS.flatMap((r) => setup.discards[r]),
    ];
    expect(new Set(all).size).toBe(all.length); // no duplicates
    expect([...all].sort()).toEqual([...FIRST_GAME.worldPool].sort()); // nothing lost or added
  });

  it('shuffles the relic pool into a reliquary + relic deck partitioning relicPool', () => {
    const setup = oathSetup(FIRST_GAME.citizenship.length);
    expect(setup.reliquary.length).toBe(4);
    const all = [...setup.reliquary, ...setup.relicDeck];
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual([...FIRST_GAME.relicPool].sort());
  });
});

describe('init', () => {
  it('is deterministic: two calls on the same setup deep-equal', () => {
    const setup = oathSetup(FIRST_GAME.citizenship.length);
    expect(init(setup)).toEqual(init(setup));
  });

  it('FIRST_GAME output passes checkInvariants', () => {
    const setup = oathSetup(FIRST_GAME.citizenship.length);
    const state = init(setup);
    checkInvariants(state);
  });

  it('per-seat starting resources match the rulebook table (Law §1.8, §1.9, §1.11, §1.15)', () => {
    const setup = oathSetup(FIRST_GAME.citizenship.length);
    const state = init(setup);
    // Chancellor: 2 favor, 1 secret, 3 warbands on board (Law §1.11-1.12)
    expect(state.players[0].favor).toBe(2);
    expect(state.players[0].secrets.ready).toBe(1);
    expect(state.players[0].warbands.board).toBe(3);
    // Each Exile: 1 favor, 1 secret, 3 warbands on board (Law §1.15)
    for (let seat = 1; seat < state.seats; seat++) {
      expect(state.players[seat].favor).toBe(1);
      expect(state.players[seat].secrets.ready).toBe(1);
      expect(state.players[seat].warbands.board).toBe(3);
    }
    // map warbands: 2 on the Cradle top site, 1 on each other faceup site
    // with a denizen (Law §1.12) — here Mountain and Rocky Coast
    const plains = state.sites.find((s) => s.id === byName('Plains').id)!;
    const mountain = state.sites.find((s) => s.id === byName('Mountain').id)!;
    const rockyCoast = state.sites.find((s) => s.id === byName('Rocky Coast').id)!;
    expect(plains.warbands[0]).toBe(2);
    expect(mountain.warbands[0]).toBe(1);
    expect(rockyCoast.warbands[0]).toBe(1);
    // favor banks: 3 per suit at <=4 players (Law §1.6)
    for (const suit of Object.keys(state.favorBanks) as (keyof typeof state.favorBanks)[]) {
      expect(state.favorBanks[suit]).toBe(3);
    }
    // 1 favor on the People's Favor, 1 secret on the Darkest Secret (Law §1.5)
    expect(state.banners.find((b) => b.id.includes('peoples-favor'))!.tokens).toBe(1);
    expect(state.banners.find((b) => b.id.includes('darkest-secret'))!.tokens).toBe(1);
  });

  it('favor banks hold 4 per suit at 5-6 players (Law §1.6)', () => {
    // init() must generalize even though FIRST_GAME itself is 4p-fixed —
    // build a synthetic 5-seat OathSetup by hand to exercise this path.
    const base = oathSetup(FIRST_GAME.citizenship.length);
    const synthetic: OathSetup = {
      ...base,
      spec: {
        ...base.spec,
        citizenship: [...base.spec.citizenship, 'exile'],
        startingPawnSite: [...base.spec.startingPawnSite, base.spec.startingPawnSite[1]],
      } as SetupSpec,
      startingAdviser: [...base.startingAdviser, base.worldDeck[0]],
    };
    synthetic.worldDeck = base.worldDeck.slice(1);
    const state = init(synthetic);
    checkInvariants(state);
    for (const suit of Object.keys(state.favorBanks) as (keyof typeof state.favorBanks)[]) {
      expect(state.favorBanks[suit]).toBe(4);
    }
  });

  it('init output passes checkInvariants for 2..6 seats', () => {
    for (const seats of [2, 3, 4, 5, 6]) {
      const base = oathSetup(FIRST_GAME.citizenship.length);
      // Reuse FIRST_GAME's board/world facts but retarget the seat count by
      // hand — init() must not hardcode 4 seats.
      const citizenship = Array.from({ length: seats }, (_, i) =>
        i === 0 ? ('chancellor' as const) : ('exile' as const),
      );
      const startingPawnSite = Array.from(
        { length: seats },
        (_, i) => base.spec.startingPawnSite[i % base.spec.startingPawnSite.length],
      );
      const needed = seats - base.startingAdviser.length;
      const startingAdviser =
        needed >= 0
          ? [...base.startingAdviser, ...base.worldDeck.slice(0, needed)]
          : base.startingAdviser.slice(0, seats);
      const worldDeck = needed >= 0 ? base.worldDeck.slice(needed) : base.worldDeck;
      const setup: OathSetup = {
        ...base,
        spec: { ...base.spec, citizenship, startingPawnSite } as SetupSpec,
        startingAdviser,
        worldDeck,
      };
      checkInvariants(init(setup));
    }
  });
});
