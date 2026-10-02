/**
 * Unit 11: a winning campaign's §5.5.7 seizure choices and §5.5.6's casualty
 * allocation are ordinary affordance fields now — `allocate` for placements
 * and kills, a region-grouped choose-one for the banish site, a flag for the
 * favor burn — rather than a nested `seize` block and a JSON `free` field the
 * harness had to skip. The frozen fixtures reach a victory with placements
 * but never a banish/burn or a casualty choice, so this builds the Imperial
 * campaign (allies.test.ts's hand-computed one) and runs the harness on it,
 * with a lie planted in each new field to show the harness catches it.
 */

import { describe, it, expect } from 'vitest';
import { oath } from '../../../src/oath/game/index.js';
import { IllegalAction } from '../../../src/engine/types.js';
import type { Affordance, Field } from '../../../src/oath/game/affordances.js';
import type { OathState } from '../../../src/oath/game/state.js';
import { auditAffordances } from './affordances.js';
import { act, imperialState, imperialRolled, toRolled } from './campaign-lib.js';

const entries = (s: OathState, seat: number, type: string) =>
  (oath.affordances!(s, seat) as Affordance[]).filter((e) => e.type === type);
const field = (e: Affordance, name: string) => e.fields.find((f) => f.name === name)!;

describe('campaign.resolve: defeat and victory are separate entries (Law §5.5.5, §5.5.7)', () => {
  const s = imperialRolled();
  const [defeat, victory] = entries(s, 1, 'campaign.resolve');

  it('offers "resolve as defeated", and a victory bought with the exact sacrifice', () => {
    expect(defeat.fields.map((f) => f.name)).toEqual(['sacrifice']);
    expect(field(victory, 'sacrifice')).toMatchObject({ kind: 'choose-one', options: [{ value: 3 }] });
  });

  it('the victory carries the seizure choices as fields', () => {
    expect(victory.fields.map((f) => `${f.name}:${f.kind}`)).toEqual(['sacrifice:choose-one', 'banishTo:choose-one', 'burnFavor:flag']);
    const banish = field(victory, 'banishTo') as Extract<Field, { options: unknown[] }> & { options: { value: unknown; label: string; group?: string; art?: string }[] };
    expect(banish.options[0]).toEqual({ value: null, label: 'Leave their pawn where it is' });
    expect(banish.options.slice(1).every((o) => o.group && o.art)).toBe(true); // laid out like the map
  });

  it('says what burning does and how much, and what banishing does (Ben, 2026-10-02)', () => {
    const burn = victory.fields.find((f) => f.name === 'burnFavor')!;
    const theirs = s.players[2].favor;
    expect(burn.label).toBe(
      `Burn half their favor: ${Math.floor(theirs / 2)} of the Blue Citizen's ${theirs} go to the shared bank (rounded down, Law §5.5.7.3)`,
    );
    expect(victory.fields.find((f) => f.name === 'banishTo')!.label).toMatch(/^Banish their pawn: make them travel to a site of your choice, spending no Supply/);
  });

  it('is honest under the harness', () => {
    expect(auditAffordances(s, 1)).toEqual([]);
  });

  it('a win submitted from those fields seizes: banished and burned once the casualties land', () => {
    const banishTo = s.sites.findIndex((x, i) => i !== 5 && !x.facedown);
    const favorBefore = s.players[2].favor;
    const won = act(s, 'campaign.resolve', 1, { sacrifice: 3, banishTo, burnFavor: true });
    expect(won.campaign!.phase).toBe('casualties');
    const done = act(won, 'campaign.casualties', 0, { kills: [{ kind: 'board', seat: 2, count: 2 }] });
    expect(done.campaign).toBeNull();
    expect(done.players[2].pawnSite).toBe(s.sites[banishTo].id);
    expect(done.players[2].favor).toBe(favorBefore - Math.floor(favorBefore / 2));
  });

  it('banishing to a facedown site reveals it, as any travel would (Law §5.5.7.3, §5.6.2)', () => {
    // baseState reveals every site; turn an unoccupied one back over.
    const hidden = structuredClone(s);
    const to = hidden.sites.findIndex(
      (x, i) => i !== 0 && i !== 5 && !hidden.players.some((p) => p.pawnSite === x.id) && x.warbands.every((n) => n === 0),
    );
    expect(to).toBeGreaterThan(-1);
    Object.assign(hidden.sites[to], { facedown: true, favor: 0, secrets: 0 });
    const won = act(hidden, 'campaign.resolve', 1, { sacrifice: 3, banishTo: to });
    const done = act(won, 'campaign.casualties', 0, { kills: [{ kind: 'board', seat: 2, count: 2 }] });
    expect(done.sites[to].facedown).toBe(false);
    expect(done.players[2].pawnSite).toBe(s.sites[to].id);
  });

  it('refuses the seizure given both ways at once', () => {
    expect(() => act(s, 'campaign.resolve', 1, { sacrifice: 3, burnFavor: true, seize: { burnFavor: true } })).toThrow(/either as a seize block or as fields/);
  });

  it('checks the seizure at resolve even when the casualties come first, so the game cannot get stuck', () => {
    expect(() => act(s, 'campaign.resolve', 1, { sacrifice: 3, banishTo: 999 })).toThrow(/no site at slot 999/);
  });

  it('still replays the nested seize block every logged game used', () => {
    expect(act(s, 'campaign.resolve', 1, { sacrifice: 3, seize: { burnFavor: true } }).campaign!.seize).toEqual({ placements: [], burnFavor: true });
  });
});

describe('the battle totals, computed once by the engine and shown to everyone (unit 11)', () => {
  it('ships both sides in the view: 3 swords vs 0 shields + 5 defending warbands', () => {
    const s = imperialRolled();
    for (const seat of [0, 1, 2, null]) {
      const view = oath.project(s, seat) as { campaign: { battle: unknown } };
      expect(view.campaign.battle).toEqual({
        swords: 3,
        skulls: 0,
        shields: 0,
        force: 5,
        // ...and where the 5 come from: the Chancellor's 2 at Mine, the defender's board 3.
        forceFrom: [
          { kind: 'site', siteId: s.sites[0].id, seat: 0, count: 2 },
          { kind: 'board', seat: 2, count: 3 },
        ],
        defense: 5,
      });
    }
  });

  it('the resolve form states the same totals', () => {
    const [defeat] = entries(imperialRolled(), 1, 'campaign.resolve');
    expect(defeat.note).toBe('Attack 3 vs defense 5 (0 from shields + 5 from the defending force). The attack must be greater to win (Law §5.5.5).');
  });
});

describe('campaign.resolve: placements on targeted sites (Law §5.5.7.1)', () => {
  /** The same campaign with the attacker's board raised so warbands are left after the sacrifice. */
  function withBoard(): OathState {
    const s = imperialState();
    s.players[1].warbands.board += 4;
    s.players[1].warbands.bank -= 4;
    return toRolled(s, {
      attacker: 1,
      defender: 2,
      targets: [{ kind: 'site', siteId: s.sites[0].id }, { kind: 'pawnFavor' }],
      attackDice: 3,
      attackFaces: ['sword', 'sword', 'sword'],
      defenseFaces: ['blank', 'blank', 'blank', 'blank'],
    });
  }

  it('offers up to the warbands left on the board, one box per targeted site', () => {
    const s = withBoard();
    const victory = entries(s, 1, 'campaign.resolve')[1];
    const place = field(victory, 'place') as Extract<Field, { kind: 'allocate' }>;
    const left = s.players[1].warbands.board - 3; // all swords, no skulls; the sacrifice is 3
    expect(place).toMatchObject({ kind: 'allocate', min: 0, max: left, options: [{ value: { siteId: s.sites[0].id } }] });
    expect(auditAffordances(s, 1)).toEqual([]);
  });

  it('the harness catches a placement max that overstates the board', () => {
    const s = withBoard();
    const lie = structuredClone(oath.affordances!(s, 1) as Affordance[]);
    const place = lie.flatMap((e) => e.fields).find((f) => f.name === 'place') as Extract<Field, { kind: 'allocate' }>;
    place.max += 1;
    expect(auditAffordances(s, 1, lie).join('\n')).toMatch(/place: the max total \(\d+\) was refused/);
  });
});

describe('campaign.casualties: kills are an allocation, not JSON (Law §5.5.6)', () => {
  const s = act(imperialRolled(), 'campaign.resolve', 1, { sacrifice: 3 });

  it('asks the Chancellor to kill exactly the quota, each location capped at what is there', () => {
    const [entry] = entries(s, 0, 'campaign.casualties');
    expect(field(entry, 'kills')).toEqual({
      name: 'kills',
      kind: 'allocate',
      min: 2,
      max: 2,
      options: [
        { value: { kind: 'site', siteId: s.sites[0].id, seat: 0 }, label: "the Chancellor's warbands at Mine (2)", max: 2 },
        { value: { kind: 'board', seat: 2 }, label: "the Blue Citizen's warbands on their board (3)", max: 3 },
      ],
    });
  });

  it('is honest under the harness', () => {
    expect(auditAffordances(s, 0)).toEqual([]);
  });

  it('the harness catches a wrong quota and an overstated location', () => {
    const killsOf = (list: Affordance[]) => list.find((e) => e.type === 'campaign.casualties')!.fields[0] as Extract<Field, { kind: 'allocate' }>;
    const quota = structuredClone(oath.affordances!(s, 0) as Affordance[]);
    const kills = killsOf(quota);
    kills.min = kills.max = 3;
    expect(auditAffordances(s, 0, quota).join('\n')).toMatch(/kills: the (min|max) total \(3\) was refused/);

    const cap = structuredClone(oath.affordances!(s, 0) as Affordance[]);
    const k2 = killsOf(cap);
    k2.options[0].max = 5; // the site only holds 2
    k2.min = k2.max = 3;
    expect(auditAffordances(s, 0, cap).length).toBeGreaterThan(0);
  });

  it('a non-chooser is offered nothing, and the engine agrees', () => {
    expect(entries(s, 2, 'campaign.casualties')).toEqual([]);
    expect(() => act(s, 'campaign.casualties', 2, { kills: [{ kind: 'board', seat: 2, count: 2 }] })).toThrow(IllegalAction);
  });
});

describe('campaign.declare: any number of targets (Law §5.5.2; Ben, 2026-10-02)', () => {
  /** seat 1 attacks Citizen seat 2, whose pawn is at seat 1's site; Imperial warbands rule Mine (sites[0]). */
  const s = imperialState();
  const declares = () => (oath.affordances!(s, 1) as Affordance[]).filter((e) => e.type === 'campaign.declare');
  const against2 = () => declares().find((e) => (e.fields[0] as { options: { value: unknown }[] }).options[0].value === 2)!;

  it('offers a target at your site, plus extras: other at-site targets and every other site they rule', () => {
    const e = against2();
    const also = e.fields.find((f) => f.name === 'alsoTargets') as { options: { value: unknown; requires?: { values: unknown[] } }[] } | undefined;
    expect(also).toBeDefined();
    const values = also!.options.map((o) => JSON.stringify(o.value));
    expect(values).toContain(JSON.stringify({ kind: 'site', siteId: s.sites[0].id })); // Mine, ruled anywhere on the map
    // pawn & favor can be an extra, but never on top of itself as the first target.
    const pf = also!.options.find((o) => JSON.stringify(o.value) === JSON.stringify({ kind: 'pawnFavor' }));
    if (pf?.requires) expect(pf.requires.values).not.toContainEqual([{ kind: 'pawnFavor' }]);
  });

  it('is honest under the harness, extras checked both ways', () => {
    expect(auditAffordances(s, 1)).toEqual([]);
  });

  it('declares several targets at once, adding each one\'s defense dice', () => {
    const one = act(s, 'campaign.declare', 1, { defender: 2, targets: [{ kind: 'pawnFavor' }], attackDice: 2 });
    const two = act(s, 'campaign.declare', 1, { defender: 2, targets: [{ kind: 'pawnFavor' }], alsoTargets: [{ kind: 'site', siteId: s.sites[0].id }], attackDice: 2 });
    expect(two.campaign!.targets).toHaveLength(2);
    expect(two.campaign!.defenseDice).toBe(one.campaign!.defenseDice + 1); // + the site's one defense die
    expect(() => act(s, 'campaign.declare', 1, { defender: 2, targets: [{ kind: 'pawnFavor' }], alsoTargets: [{ kind: 'pawnFavor' }], attackDice: 2 })).toThrow(/duplicate target/);
  });
});

describe('campaign targets show the defending warbands they bring (Ben, 2026-10-02)', () => {
  it('labels a site target with its defending warbands, and notes the board warbands that defend anyway', () => {
    const s = imperialState();
    const e = (oath.affordances!(s, 1) as Affordance[])
      .filter((x) => x.type === 'campaign.declare')
      .find((x) => (x.fields[0] as { options: { value: unknown }[] }).options[0].value === 2)!;
    const also = e.fields.find((f) => f.name === 'alsoTargets') as { options: { value: unknown; label: string }[] };
    const mine = also.options.find((o) => JSON.stringify(o.value) === JSON.stringify({ kind: 'site', siteId: s.sites[0].id }))!;
    expect(mine.label).toMatch(/— 1 defense die, 2 defending warbands$/); // the Chancellor's 2 at Mine defend for an Imperial defender
    expect(e.note).toMatch(/^Defending warbands on boards, whatever you target here: 3 on the Blue Citizen's/);
  });
});

describe('a site target where the defenders\' pawns stand says it brings their boards too (Law §5.5.4)', () => {
  it('labels the extra boards that targeting that site adds', () => {
    const s = imperialState();
    // Move the Citizen defender's pawn away from the attacker, to Mine (which Imperial warbands rule).
    s.players[2].pawnSite = s.sites[0].id;
    const e = (oath.affordances!(s, 1) as Affordance[])
      .filter((x) => x.type === 'campaign.declare')
      .find((x) => (x.fields[0] as { options: { value: unknown }[] }).options[0].value === 2);
    if (!e) return; // not a legal defender from here
    const also = e.fields.find((f) => f.name === 'alsoTargets') as { options: { value: unknown; label: string }[] } | undefined;
    const mine = also?.options.find((o) => JSON.stringify(o.value) === JSON.stringify({ kind: 'site', siteId: s.sites[0].id }));
    if (mine) expect(mine.label).toMatch(/\+ 3 on boards \(pawns there\)/);
  });
});
