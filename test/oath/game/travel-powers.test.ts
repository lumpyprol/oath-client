import { describe, it, expect } from 'vitest';
import { byId } from '../../../src/oath/cards/index.js';
import { checkInvariants, type OathState } from '../../../src/oath/game/state.js';
import { oath } from '../../../src/oath/game/index.js';
import { IllegalAction, type GameAction } from '../../../src/engine/types.js';
import type { Affordance, Field } from '../../../src/oath/game/affordances.js';
import { baseState } from './helpers.js';
import { auditAffordances } from './affordances.js';

// Site powers that change Travel (Ben, 2026-10-02): Coast §11.3, Charming
// Valley §11.6, Shrouded Wood §11.7, Narrow Pass §11.8, and the card texts of
// Buried Giant and The Hidden Place.
//
// baseState: slots 0-1 Cradle, 2-4 Provinces, 5-7 Hinterland; seat 1 is
// active with its pawn on slot 5, 4 Supply and 1 ready secret.

function travel(state: OathState, payload: unknown): OathState {
  const action: GameAction = {
    gameId: 'test',
    seq: state.actionCount + 1,
    type: 'travel',
    actor: 1,
    payload,
    createdAt: '2026-10-02T00:00:00.000Z',
  };
  return oath.reduce(state, action);
}

/** Put site card `id` in map slot `slot` (empty, faceup), moving any pawn on the old card with it. */
function put(s: OathState, slot: number, id: string, facedown = false): void {
  const old = s.sites[slot].id;
  const capacity = (byId(id) as { capacity: number }).capacity;
  s.sites[slot] = { ...s.sites[slot], id, facedown, cards: Array.from({ length: capacity }, () => null), relics: [] };
  for (const p of s.players) if (p.pawnSite === old) p.pawnSite = id;
}

function travelForm(s: OathState): Affordance | undefined {
  return (oath.affordances!(s, 1) as Affordance[]).find((a) => a.type === 'travel');
}
function field(entry: Affordance, name: string): Extract<Field, { kind: 'choose-one' }> {
  return entry.fields.find((f) => f.name === name) as Extract<Field, { kind: 'choose-one' }>;
}

describe('Coast sites (Law §11.3)', () => {
  it('from a Coast to a Coast costs 1 Supply, not the region table', () => {
    const s = baseState();
    put(s, 5, 'site:lush-coast');
    put(s, 0, 'site:rocky-coast'); // Hinterland → Cradle is normally 4
    const out = travel(s, { siteIndex: 0 });
    expect(out.players[1].supply).toBe(3);
    checkInvariants(out);
  });

  it('a facedown Coast is no Coast yet: the table cost applies', () => {
    const s = baseState();
    put(s, 5, 'site:lush-coast');
    put(s, 0, 'site:rocky-coast', true);
    expect(travel(s, { siteIndex: 0 }).players[1].supply).toBe(0);
  });

  it('ignores Narrow Pass', () => {
    const s = baseState();
    put(s, 5, 'site:lush-coast');
    put(s, 2, 'site:narrow-pass');
    // slot 3 is Barren Coast, in Narrow Pass's region
    expect(travel(s, { siteIndex: 3 }).players[1].supply).toBe(3);
  });
});

describe('Charming Valley (Law §11.6)', () => {
  it('adds 1 Supply to travel from it', () => {
    const s = baseState();
    put(s, 5, 'site:charming-valley');
    expect(travel(s, { siteIndex: 2 }).players[1].supply).toBe(1); // 2 + 1
  });

  it('labels the increase on the form', () => {
    const s = baseState();
    put(s, 5, 'site:charming-valley');
    const dest = field(travelForm(s)!, 'siteIndex').options.find((o) => o.value === 2)!;
    expect(dest.cost).toEqual({ supply: 3 });
    expect(dest.label).toBe('Fertile Valley');
    expect(dest.law).toBe('Law §11.6');
  });
});

describe('Shrouded Wood (Law §11.7)', () => {
  it('travel from it costs 2 Supply wherever you go', () => {
    const s = baseState();
    put(s, 5, 'site:shrouded-wood');
    expect(travel(s, { siteIndex: 0 }).players[1].supply).toBe(2); // Cradle, normally 4
  });

  it('ignores Narrow Pass and The Hidden Place', () => {
    const s = baseState();
    put(s, 5, 'site:shrouded-wood');
    put(s, 2, 'site:narrow-pass');
    put(s, 3, 'site:hidden-place');
    s.players[1].secrets = { ready: 0, flipped: 0 };
    const out = travel(s, { siteIndex: 3 });
    expect(out.players[1].pawnSite).toBe('site:hidden-place');
    expect(out.players[1].secrets).toEqual({ ready: 0, flipped: 0 });
  });

  it('when an enemy rules it, the form says they choose', () => {
    const s = baseState();
    put(s, 5, 'site:shrouded-wood');
    s.sites[5].warbands = [0, 0, 2];
    s.players[2].warbands.board -= 2;
    expect(travelForm(s)!.note).toMatch(/§11\.7/);
  });
});

describe('Narrow Pass (Law §11.8)', () => {
  it('entering its region from another region, you must go to Narrow Pass', () => {
    const s = baseState();
    put(s, 2, 'site:narrow-pass');
    expect(() => travel(s, { siteIndex: 4 })).toThrow(/Narrow Pass/);
    expect(travel(s, { siteIndex: 2 }).players[1].pawnSite).toBe('site:narrow-pass');
  });

  it('moving within its region is free of it', () => {
    const s = baseState();
    put(s, 2, 'site:narrow-pass');
    s.players[1].pawnSite = s.sites[3].id;
    expect(travel(s, { siteIndex: 4 }).players[1].pawnSite).toBe(s.sites[4].id);
  });

  it('a facedown Narrow Pass has no power', () => {
    const s = baseState();
    put(s, 2, 'site:narrow-pass', true);
    expect(travel(s, { siteIndex: 4 }).players[1].pawnSite).toBe(s.sites[4].id);
  });

  it('the form greys the blocked sites with the reason', () => {
    const s = baseState();
    put(s, 2, 'site:narrow-pass');
    const opt = field(travelForm(s)!, 'siteIndex').options.find((o) => o.value === 4)!;
    expect(opt.disabled).toMatch(/must travel to Narrow Pass/);
  });
});

describe('Buried Giant', () => {
  it('flipping a ready secret spends no Supply', () => {
    const s = baseState();
    put(s, 5, 'site:buried-giant');
    const out = travel(s, { siteIndex: 0, pay: 'secret' });
    expect(out.players[1].supply).toBe(4);
    expect(out.players[1].secrets).toEqual({ ready: 0, flipped: 1 });
    checkInvariants(out);
  });

  it('and ignores Narrow Pass', () => {
    const s = baseState();
    put(s, 5, 'site:buried-giant');
    put(s, 2, 'site:narrow-pass');
    expect(() => travel(s, { siteIndex: 4 })).toThrow(/Narrow Pass/);
    expect(travel(s, { siteIndex: 4, pay: 'secret' }).players[1].pawnSite).toBe(s.sites[4].id);
  });

  it('needs a ready secret, and works only from Buried Giant', () => {
    const s = baseState();
    put(s, 5, 'site:buried-giant');
    s.players[1].secrets = { ready: 0, flipped: 1 };
    expect(() => travel(s, { siteIndex: 0, pay: 'secret' })).toThrow(IllegalAction);
    const t = baseState();
    expect(() => travel(t, { siteIndex: 0, pay: 'secret' })).toThrow(/Buried Giant/);
  });

  it('the form asks how to pay, and sites reachable only one way say so', () => {
    const s = baseState();
    put(s, 5, 'site:buried-giant');
    put(s, 2, 'site:narrow-pass');
    s.players[1].supply = 2; // the Cradle (4) is out of reach on Supply
    const entry = travelForm(s)!;
    expect(field(entry, 'pay').options.map((o) => o.value)).toEqual(['supply', 'secret']);
    const sites = field(entry, 'siteIndex').options;
    expect(sites.find((o) => o.value === 0)!.requires).toEqual({ field: 'pay', values: ['secret'] });
    expect(sites.find((o) => o.value === 4)!.requires).toEqual({ field: 'pay', values: ['secret'] });
    expect(sites.find((o) => o.value === 2)!.requires).toBeUndefined();
    expect(auditAffordances(s, 1)).toEqual([]);
  });

  it('with no Supply at all, the secret is the only way to pay', () => {
    const s = baseState();
    put(s, 5, 'site:buried-giant');
    s.players[1].supply = 0;
    const entry = travelForm(s)!;
    expect(field(entry, 'pay').options.map((o) => o.value)).toEqual(['secret']);
    expect(auditAffordances(s, 1)).toEqual([]);
  });

  it('without a ready secret there is no choice to make', () => {
    const s = baseState();
    put(s, 5, 'site:buried-giant');
    s.players[1].secrets = { ready: 0, flipped: 1 };
    expect(travelForm(s)!.fields.map((f) => f.name)).toEqual(['siteIndex']);
  });
});

describe('The Hidden Place', () => {
  it('you flip a ready secret to travel there', () => {
    const s = baseState();
    put(s, 6, 'site:hidden-place');
    const out = travel(s, { siteIndex: 6 });
    expect(out.players[1].secrets).toEqual({ ready: 0, flipped: 1 });
    expect(out.players[1].supply).toBe(1);
  });

  it('and cannot without one', () => {
    const s = baseState();
    put(s, 6, 'site:hidden-place');
    s.players[1].secrets = { ready: 0, flipped: 1 };
    expect(() => travel(s, { siteIndex: 6 })).toThrow(/secret/);
    const opt = field(travelForm(s)!, 'siteIndex').options.find((o) => o.value === 6)!;
    expect(opt.disabled).toMatch(/secret/);
  });

  it('from Buried Giant paying with a secret, it takes two', () => {
    const s = baseState();
    put(s, 5, 'site:buried-giant');
    put(s, 6, 'site:hidden-place');
    expect(() => travel(s, { siteIndex: 6, pay: 'secret' })).toThrow(/2 ready secrets/);
    s.players[1].secrets = { ready: 2, flipped: 0 };
    expect(travel(s, { siteIndex: 6, pay: 'secret' }).players[1].secrets).toEqual({ ready: 0, flipped: 2 });
    expect(auditAffordances(s, 1)).toEqual([]);
  });

  it('the form shows the secret as part of the cost', () => {
    const s = baseState();
    put(s, 6, 'site:hidden-place');
    const opt = field(travelForm(s)!, 'siteIndex').options.find((o) => o.value === 6)!;
    expect(opt.cost).toEqual({ supply: 3, secrets: 1 });
    expect(auditAffordances(s, 1)).toEqual([]);
  });
});

describe('Decadent, the Imperial Reliquary space, once uncovered (Law §2.3, §7.1.1)', () => {
  /** The Chancellor (seat 0) active on Hinterland slot 5, with Decadent uncovered or not. */
  function chancellorTravels(uncovered: boolean): OathState {
    const s = baseState();
    s.turn.activeSeat = 0;
    s.players[0].pawnSite = s.sites[5].id;
    if (uncovered) {
      const space = s.reliquary.find((sp) => sp.modifier === 'decadent')!;
      s.players[2].relics.push(space.relicId!); // taken by a new Citizen, say (§6.6.2)
      space.relicId = null;
    }
    checkInvariants(s);
    return s;
  }
  const go = (s: OathState, siteIndex: number) =>
    oath.reduce(s, { gameId: 't', seq: s.actionCount + 1, type: 'travel', actor: 0, payload: { siteIndex }, createdAt: '' });
  const option = (s: OathState, i: number) =>
    ((oath.affordances!(s, 0) as Affordance[]).find((a) => a.type === 'travel')!.fields[0] as Extract<Field, { kind: 'choose-one' }>).options.find((o) => o.value === i)!;

  it('to the Cradle from elsewhere spends no Supply', () => {
    const s = chancellorTravels(true);
    expect(go(s, 0).players[0].supply).toBe(4); // Hinterland → Cradle, normally 4
    expect(option(s, 0)).toMatchObject({ cost: { supply: 0 }, law: 'Decadent' });
  });

  it('to the Hinterland costs 1 more', () => {
    const s = chancellorTravels(true);
    expect(go(s, 6).players[0].supply).toBe(0); // Hinterland → Hinterland, 3 + 1
    expect(option(s, 6)).toMatchObject({ cost: { supply: 4 }, law: 'Decadent' });
    expect(option(s, 2).law).toBeUndefined(); // the Provinces: unchanged
    expect(auditAffordances(s, 0)).toEqual([]);
  });

  it('within the Cradle it changes nothing', () => {
    const s = chancellorTravels(true);
    s.players[0].pawnSite = s.sites[0].id;
    expect(go(s, 1).players[0].supply).toBe(3);
  });

  it('applies only to the Chancellor, and only once uncovered', () => {
    expect(go(chancellorTravels(false), 0).players[0].supply).toBe(0);
    const exile = chancellorTravels(true);
    exile.turn.activeSeat = 1;
    expect(travel(exile, { siteIndex: 0 }).players[1].supply).toBe(0); // seat 1, Hinterland → Cradle: 4
  });

  it('from a Shrouded Wood the ruler chooses, the Chancellor pays for the site chosen', () => {
    const s = chancellorTravels(true);
    put(s, 5, 'site:shrouded-wood'); // seat 1, an Exile and so an enemy, rules it
    s.players[0].supply = 2;
    const waiting = oath.reduce(s, { gameId: 't', seq: s.actionCount + 1, type: 'travel', actor: 0, payload: {}, createdAt: '' });
    const form = (oath.affordances!(waiting, 1) as Affordance[]).find((a) => a.type === 'travel.direct')!;
    const opts = (form.fields[0] as Extract<Field, { kind: 'choose-one' }>).options;
    expect(opts.find((o) => o.value === 0)).toMatchObject({ cost: { supply: 0 }, law: 'Law §11.7, Decadent' });
    expect(opts.find((o) => o.value === 6)!.disabled).toMatch(/costs 3 Supply, they have 2/);
    expect(auditAffordances(waiting, 1)).toEqual([]);
    const sent = (i: number) => oath.reduce(waiting, { gameId: 't', seq: waiting.actionCount + 1, type: 'travel.direct', actor: 1, payload: { siteIndex: i }, createdAt: '' });
    expect(sent(0).players[0].supply).toBe(2);
    expect(sent(2).players[0].supply).toBe(0);
    expect(() => sent(6)).toThrow(/they have 2/);
  });
});
