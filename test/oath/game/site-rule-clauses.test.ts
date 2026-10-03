import { describe, it, expect } from 'vitest';
import { byId } from '../../../src/oath/cards/index.js';
import { checkInvariants, type OathState } from '../../../src/oath/game/state.js';
import { oath } from '../../../src/oath/game/index.js';
import type { Affordance, Field } from '../../../src/oath/game/affordances.js';
import { baseState } from './helpers.js';
import { auditAffordances } from './affordances.js';
import { act, toRolled } from './campaign-lib.js';

// The site clauses that hand a choice to someone else or limit campaign
// targets (Ben, 2026-10-02): Shrouded Wood's ruler picks a traveller's
// destination (Law §11.7, also over a banish, §5.5.7.3); Narrow Pass must
// be targeted along with anything in its region (§11.8); The Hidden Place
// takes a flipped secret to declare targets there (card text).
//
// baseState: slots 0-1 Cradle, 2-4 Provinces, 5-7 Hinterland; seat 0 is the
// Chancellor, seats 1 and 2 Exiles; seat 1 is active on slot 5 with 4 Supply,
// 1 ready secret, 3 warbands on its board and 2 at slot 5.

/** Put site card `id` in map slot `slot` (empty, faceup), moving any pawn on the old card with it. */
function put(s: OathState, slot: number, id: string, facedown = false): void {
  const old = s.sites[slot].id;
  const capacity = (byId(id) as { capacity: number }).capacity;
  s.sites[slot] = { ...s.sites[slot], id, facedown, cards: Array.from({ length: capacity }, () => null), relics: [] };
  for (const p of s.players) if (p.pawnSite === old) p.pawnSite = id;
}

/** Move `n` of `seat`'s warbands from its bank to map slot `slot`. */
function garrison(s: OathState, slot: number, seat: number, n: number): void {
  s.players[seat].warbands.bank -= n;
  s.sites[slot].warbands[seat] += n;
}

/** Bank all of `seat`'s board warbands, so their pawn's defence is the dice alone. */
function disarm(s: OathState, seat: number): void {
  s.players[seat].warbands.bank += s.players[seat].warbands.board;
  s.players[seat].warbands.board = 0;
}

const entry = (s: OathState, seat: number, type: string): Affordance | undefined =>
  (oath.affordances!(s, seat) as Affordance[]).find((a) => a.type === type);
const field = (e: Affordance, name: string) => e.fields.find((f) => f.name === name) as Extract<Field, { kind: 'choose-one' | 'choose-many' }>;

/** Send `seat`'s warbands at map slot `slot` back to its bank. */
function withdraw(s: OathState, slot: number, seat: number): void {
  s.players[seat].warbands.bank += s.sites[slot].warbands[seat];
  s.sites[slot].warbands[seat] = 0;
}

/** Seat 1 on a Shrouded Wood (slot 5) that the exile seat 2 rules. A site holds one faction (Law §6.5, §5.5.6). */
function shrouded(): OathState {
  const s = baseState();
  put(s, 5, 'site:shrouded-wood');
  withdraw(s, 5, 1);
  garrison(s, 5, 2, 2);
  checkInvariants(s);
  return s;
}

describe('Shrouded Wood: an enemy ruler chooses where you go (Law §11.7)', () => {
  it('Travel takes no destination: you pay 2 Supply and the ruler is asked', () => {
    const s = shrouded();
    const travel = entry(s, 1, 'travel')!;
    expect(travel.fields).toEqual([]);
    expect(travel.note).toMatch(/rules it, so they choose where you go \(Law §11\.7\)/);
    expect(() => act(s, 'travel', 1, { siteIndex: 0 })).toThrow(/name no destination/);

    const out = act(s, 'travel', 1, {});
    expect(out.players[1].supply).toBe(2);
    expect(out.players[1].pawnSite).toBe('site:shrouded-wood');
    expect(out.shroudedTravel).toMatchObject({ traveller: 1, chooser: 2, via: 'travel' });
    expect(oath.pending(out)).toEqual([expect.objectContaining({ seat: 2, kind: 'shrouded', resolves: ['travel.direct'] })]);
    expect(auditAffordances(s, 1)).toEqual([]);
  });

  it('locks the traveller until the ruler chooses; then the pawn arrives and play goes on', () => {
    const s = shrouded();
    s.sites[0].facedown = true;
    const waiting = act(s, 'travel', 1, {});
    expect(() => act(waiting, 'turn.rest', 1)).toThrow(/Shrouded Wood/);
    expect(() => act(waiting, 'travel.direct', 1, { siteIndex: 0 })).toThrow(/chooses/);
    expect(() => act(waiting, 'travel.direct', 2, { siteIndex: 5 })).toThrow(/other than/);

    const form = entry(waiting, 2, 'travel.direct')!;
    expect(field(form, 'siteIndex').options.map((o) => o.value)).toEqual([0, 1, 2, 3, 4, 6, 7]);
    expect(auditAffordances(waiting, 2)).toEqual([]);
    expect(oath.unavailable!(waiting, 1)).toContainEqual({ type: 'muster', reason: expect.stringMatching(/Waiting on the .* Shrouded Wood/) });

    const arrived = act(waiting, 'travel.direct', 2, { siteIndex: 0 });
    expect(arrived.players[1].pawnSite).toBe(arrived.sites[0].id);
    expect(arrived.sites[0].facedown).toBe(false); // arriving reveals it (Law §5.6.2)
    expect(arrived.shroudedTravel).toBeNull();
    checkInvariants(arrived);
    expect(act(arrived, 'turn.rest', 1).turn.activeSeat).not.toBe(1);
  });

  it('a ruler who is no enemy chooses nothing: Travel is as usual', () => {
    const s = baseState();
    put(s, 5, 'site:shrouded-wood');
    s.sites[5].warbands[1] = 2; // only the traveller's own warbands
    expect(field(entry(s, 1, 'travel')!, 'siteIndex')).toBeDefined();
    expect(act(s, 'travel', 1, { siteIndex: 0 }).players[1].supply).toBe(2);
  });

  it('the Empire chooses through the Chancellor, and only against an Exile', () => {
    const s = baseState();
    put(s, 5, 'site:shrouded-wood');
    withdraw(s, 5, 1);
    garrison(s, 5, 0, 1);
    checkInvariants(s);
    expect(act(s, 'travel', 1, {}).shroudedTravel).toMatchObject({ chooser: 0 });

    const citizen = baseState();
    put(citizen, 5, 'site:shrouded-wood');
    citizen.players[1].citizenship = 'citizen'; // now Imperial: the Empire is no enemy
    citizen.players[1].warbands = { bank: 0, board: 0 };
    citizen.sites[5].warbands[1] = 0;
    citizen.players[0].warbands.bank -= 1;
    citizen.sites[5].warbands[0] = 1;
    expect(act(citizen, 'travel', 1, { siteIndex: 0 }).players[1].pawnSite).toBe(citizen.sites[0].id);
  });

  it("a Citizen's purple there is the Empire's too: the Chancellor chooses", () => {
    const s = baseState();
    put(s, 5, 'site:shrouded-wood');
    withdraw(s, 5, 1);
    s.players[2].citizenship = 'citizen';
    s.players[2].warbands = { bank: 0, board: 1 };
    s.sites[5].warbands[2] = 2;
    s.players[0].warbands.bank -= 3; // the purple pool is shared (Law §1.15)
    expect(act(s, 'travel', 1, {}).shroudedTravel).toMatchObject({ chooser: 0 });
  });
});

describe("Shrouded Wood's power beats the attacker's banish (Law §5.5.7.3)", () => {
  /** Seat 1 beats exile seat 2 on a Shrouded Wood the Empire rules. */
  function rolled(): OathState {
    const s = baseState();
    put(s, 5, 'site:shrouded-wood');
    withdraw(s, 5, 1);
    garrison(s, 5, 0, 3);
    s.players[2].pawnSite = 'site:shrouded-wood';
    disarm(s, 2);
    checkInvariants(s);
    return toRolled(s, {
      attacker: 1,
      defender: 2,
      targets: [{ kind: 'pawnFavor' }],
      attackDice: 3,
      attackFaces: ['sword', 'sword', 'sword'],
      defenseFaces: ['blank', 'blank'],
    });
  }

  it('the form offers "banish, the ruler picks", not a list of sites', () => {
    const s = rolled();
    const resolve = entry(s, 1, 'campaign.resolve')!;
    const banish = field(resolve, 'banishTo');
    expect(banish.options.map((o) => o.value)).toEqual([null, 'ruler']);
    expect(banish.label).toMatch(/Chancellor chooses where/);
    expect(auditAffordances(s, 1)).toEqual([]);
  });

  it('a named site is refused; "ruler" hands the choice to them', () => {
    const s = rolled();
    expect(() => act(s, 'campaign.resolve', 1, { banishTo: 0 })).toThrow(/Shrouded Wood/);
    const out = act(s, 'campaign.resolve', 1, { banishTo: 'ruler' });
    expect(out.campaign).toBeNull();
    expect(out.shroudedTravel).toMatchObject({ traveller: 2, chooser: 0, via: 'banish' });
    const moved = act(out, 'travel.direct', 0, { siteIndex: 3 });
    expect(moved.players[2].pawnSite).toBe(moved.sites[3].id);
    expect(moved.players[2].supply).toBe(s.players[2].supply); // a banish spends none
  });

  it('when the attacker is that ruler, they name the site as usual', () => {
    const s = baseState();
    put(s, 5, 'site:shrouded-wood');
    s.sites[5].warbands[1] = 2; // seat 1 alone rules it
    s.players[2].pawnSite = 'site:shrouded-wood';
    disarm(s, 2);
    const r = toRolled(s, { attacker: 1, defender: 2, targets: [{ kind: 'pawnFavor' }], attackDice: 3, attackFaces: ['sword', 'sword', 'sword'], defenseFaces: ['blank', 'blank'] });
    expect(() => act(r, 'campaign.resolve', 1, { banishTo: 'ruler' })).toThrow(/name the site/);
    expect(act(r, 'campaign.resolve', 1, { banishTo: 0 }).players[2].pawnSite).toBe(r.sites[0].id);
  });
});

describe('Narrow Pass: target it with anything in its region (Law §11.8)', () => {
  /** Seat 1 (Hinterland, slot 5) against exile seat 2, who rules slot 3 and maybe Narrow Pass (slot 2), Provinces. */
  function npState(defenderRulesPass: boolean): OathState {
    const s = baseState();
    put(s, 2, 'site:narrow-pass');
    s.sites[2].warbands[0] = 0;
    s.players[0].warbands.bank += 1;
    garrison(s, 3, 2, 1);
    if (defenderRulesPass) garrison(s, 2, 2, 1);
    s.players[2].pawnSite = s.sites[5].id; // the defender stands at the attacker's site
    checkInvariants(s);
    return s;
  }
  const declare = { defender: 2, targets: [{ kind: 'pawnFavor' }], attackDice: 2 };

  it('declaring a target in its region brings Narrow Pass in as a target', () => {
    const s = npState(true);
    const out = act(s, 'campaign.declare', 1, { ...declare, alsoTargets: [{ kind: 'site', siteId: s.sites[3].id }] });
    expect(out.campaign!.targets).toContainEqual({ kind: 'site', siteId: 'site:narrow-pass' });
    expect(out.campaign!.defenseDice).toBe(2 + 1 + 1); // pawn & favor, the target, Narrow Pass
    const extra = field(entry(s, 1, 'campaign.declare')!, 'alsoTargets').options.find((o) => (o.value as { siteId?: string }).siteId === s.sites[3].id)!;
    expect(extra.label).toMatch(/Narrow Pass joins the targets/);
    expect(auditAffordances(s, 1)).toEqual([]);
  });

  it('and cannot be declared when the defender does not rule Narrow Pass', () => {
    const s = npState(false);
    expect(() => act(s, 'campaign.declare', 1, { ...declare, alsoTargets: [{ kind: 'site', siteId: s.sites[3].id }] })).toThrow(/Narrow Pass/);
    const extra = field(entry(s, 1, 'campaign.declare')!, 'alsoTargets').options.find((o) => (o.value as { siteId?: string }).siteId === s.sites[3].id)!;
    expect(extra.disabled).toMatch(/Narrow Pass/);
    expect(auditAffordances(s, 1)).toEqual([]);
  });

  it('ruling Narrow Pass yourself lifts it', () => {
    const s = npState(false);
    garrison(s, 2, 1, 1);
    const out = act(s, 'campaign.declare', 1, { ...declare, alsoTargets: [{ kind: 'site', siteId: s.sites[3].id }] });
    expect(out.campaign!.targets).not.toContainEqual({ kind: 'site', siteId: 'site:narrow-pass' });
  });
});

describe('The Hidden Place: declaring targets there flips a secret', () => {
  it('a target at it flips one ready secret, and none means no', () => {
    const s = baseState();
    put(s, 3, 'site:hidden-place');
    garrison(s, 3, 2, 1);
    s.players[2].pawnSite = s.sites[5].id;
    const declare = { defender: 2, targets: [{ kind: 'pawnFavor' }], alsoTargets: [{ kind: 'site', siteId: 'site:hidden-place' }], attackDice: 2 };
    const out = act(s, 'campaign.declare', 1, declare);
    expect(out.players[1].secrets).toEqual({ ready: 0, flipped: 1 });
    const extra = () => field(entry(s, 1, 'campaign.declare')!, 'alsoTargets').options.find((o) => (o.value as { siteId?: string }).siteId === 'site:hidden-place')!;
    expect(extra().label).toMatch(/flips one of your secrets/);
    expect(auditAffordances(s, 1)).toEqual([]);

    s.players[1].secrets = { ready: 0, flipped: 1 };
    expect(() => act(s, 'campaign.declare', 1, declare)).toThrow(/Hidden Place/);
    expect(extra().disabled).toMatch(/ready secret/);
    expect(auditAffordances(s, 1)).toEqual([]);
  });

  it('standing on it, every campaign there costs a secret — one, however many targets', () => {
    const s = baseState();
    put(s, 5, 'site:hidden-place');
    s.sites[5].warbands[1] = 2;
    s.players[2].pawnSite = 'site:hidden-place';
    s.players[2].relics = [s.players[2].relics[0]];
    const out = act(s, 'campaign.declare', 1, { defender: 2, targets: [{ kind: 'pawnFavor' }], alsoTargets: [{ kind: 'relic', relicId: s.players[2].relics[0] }], attackDice: 2 });
    expect(out.players[1].secrets).toEqual({ ready: 0, flipped: 1 });
    expect(entry(s, 1, 'campaign.declare')!.note).toMatch(/The Hidden Place/);

    s.players[1].secrets = { ready: 0, flipped: 1 };
    expect(entry(s, 1, 'campaign.declare')).toBeUndefined();
    expect(oath.unavailable!(s, 1)).toContainEqual({ type: 'campaign.declare', reason: expect.stringMatching(/Hidden Place/) });
  });
});

describe('the bandits are one faction: any of their sites can be a target (Law §10.21, §5.5.2)', () => {
  it('declaring against the bandits offers every other faceup site with no warbands', () => {
    const s = baseState();
    s.players[1].pawnSite = s.sites[1].id; // no warbands here: the bandits rule it
    s.sites[6].facedown = true; // a facedown site rules nothing
    const declare = (oath.affordances!(s, 1) as Affordance[]).find(
      (a) => a.type === 'campaign.declare' && field(a, 'defender').options[0].value === 'bandits',
    )!;
    const also = field(declare, 'alsoTargets').options.map((o) => (o.value as { siteId: string }).siteId);
    expect(also.sort()).toEqual([s.sites[3].id, s.sites[4].id, s.sites[7].id].sort());
    expect(auditAffordances(s, 1)).toEqual([]);

    const out = act(s, 'campaign.declare', 1, {
      defender: 'bandits',
      targets: [{ kind: 'site', siteId: s.sites[1].id }],
      alsoTargets: [{ kind: 'site', siteId: s.sites[3].id }, { kind: 'site', siteId: s.sites[7].id }],
      attackDice: 3, // −1 for targeting the Mountain (slot 7, Law §11.4)
      attackFaces: ['sword', 'sword'],
      defenseFaces: ['blank', 'blank', 'blank'],
    });
    expect(out.campaign!.targets).toHaveLength(3);
    expect(out.campaign!.defenseDice).toBe(3); // one die per site (§2.8.3)
    expect(oath.project(out, 1).campaign!.battle).toMatchObject({ force: 3 }); // a bandit per site
  });
});
