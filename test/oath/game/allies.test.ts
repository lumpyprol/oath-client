import { describe, it, expect } from 'vitest';
import { checkInvariants, type OathState } from '../../../src/oath/game/state.js';
import { oath } from '../../../src/oath/game/index.js';
import { IllegalAction, type GameAction } from '../../../src/engine/types.js';
import { baseState } from './helpers.js';

function act(state: OathState, type: string, actor: number | null, payload: unknown = {}): OathState {
  const action: GameAction = {
    gameId: 'test',
    seq: state.actionCount + 1,
    type,
    actor,
    payload,
    createdAt: '2026-09-11T00:00:00.000Z',
  };
  return oath.reduce(structuredClone(state), action);
}

interface RollOpts {
  attacker: number;
  defender: number | 'bandits';
  targets: unknown[];
  attackDice: number;
  attackFaces: string[];
  defenseFaces: string[];
}

/** declare -> (respond) -> roll, leaving the campaign in phase 'rolled'. */
function toRolled(s: OathState, o: RollOpts): OathState {
  let out = act(s, 'campaign.declare', o.attacker, {
    defender: o.defender,
    targets: o.targets,
    attackDice: o.attackDice,
  });
  if (out.campaign!.phase === 'respond') out = act(out, 'campaign.respond', o.defender as number);
  return act(out, 'campaign.roll', o.attacker, {
    attackFaces: o.attackFaces,
    defenseFaces: o.defenseFaces,
  });
}

/**
 * baseState with seat 2 flipped to Citizen, and seat 1 (an Exile, already
 * the active seat with 2 warbands at their own site) set up to attack them.
 *
 * Purple is ONE 24-warband pool shared by the Chancellor and every Citizen
 * (Law §1.15), so the Chancellor's bank is rebalanced to keep conservation
 * exact: seat 0 holds 21 (bank 15 + board 3 + 2 at sites[0] + 1 at sites[2]),
 * seat 2 holds 3 (all on their board).
 *
 * Sites, for the hand-computed totals below: sites[0] = Mine (2 Chancellor
 * warbands), sites[5] = River (2 of seat 1's, and both pawns). Neither is
 * Plains or Mountain, so §11.4's attack-die modifier stays out of the way.
 */
function imperialState(): OathState {
  const s = baseState();
  s.players[2].citizenship = 'citizen';
  s.players[2].warbands = { bank: 0, board: 3 };
  s.players[0].warbands.bank = 15;
  s.players[2].pawnSite = s.sites[5].id; // the defender's pawn, at the attacker's site
  s.turn.activeSeat = 1;
  checkInvariants(s);
  return s;
}

describe('unit 16a part 1 — the Imperial defending force (Law §5.5.4)', () => {
  it("counts the Chancellor's warbands at a site a Citizen defends — the seam D42 opened", () => {
    const s = imperialState();
    const rolled = toRolled(s, {
      attacker: 1,
      defender: 2,
      targets: [{ kind: 'site', siteId: s.sites[0].id }, { kind: 'pawnFavor' }],
      attackDice: 3,
      attackFaces: ['sword', 'sword', 'sword'],
      defenseFaces: ['blank', 'blank', 'blank'],
    });

    // Hand-computed. Shields 0. The force is the Chancellor's 2 warbands at
    // the targeted site PLUS the Citizen's own 3 board warbands (their pawn
    // is at the attacker's site) = 5. Attack is 3 swords, so §5.5.5's exact
    // sacrifice is 5 - 3 + 1 = 3.
    //
    // Before this unit the site bonus read only `site.warbands[defender]`,
    // which is 0 here — it would have seen defense 3 and demanded 1.
    expect(() => act(rolled, 'campaign.resolve', 1, { sacrifice: 1 })).toThrow(/must be exactly 3\b/);

    const out = act(rolled, 'campaign.resolve', 1, { sacrifice: 3 });
    checkInvariants(out);
    expect(out.campaign!.phase).toBe('casualties'); // 3 + 3 = 6 > 5: victorious
  });

  it('leaves an Exile defender exactly as it was: no site warbands but their own', () => {
    const s = baseState(); // seats 1 and 2 both Exiles
    s.players[2].pawnSite = s.sites[5].id;
    const rolled = toRolled(s, {
      attacker: 1,
      defender: 2,
      targets: [{ kind: 'pawnFavor' }],
      attackDice: 3,
      attackFaces: ['sword', 'sword', 'sword'],
      defenseFaces: ['blank', 'blank'],
    });
    // Force is seat 2's 3 board warbands alone; the Chancellor's warbands
    // elsewhere are irrelevant to an Exile's defense. 3 - 3 + 1 = 1.
    expect(() => act(rolled, 'campaign.resolve', 1, { sacrifice: 2 })).toThrow(/must be exactly 1\b/);
    const out = act(rolled, 'campaign.resolve', 1, { sacrifice: 1 });
    checkInvariants(out);
    expect(out.campaign!.phase).toBe('seize'); // one destination: no casualty choice
  });

  it('leaves bandits exactly as they were: one die per targeted site, never warbands', () => {
    const s = baseState();
    s.players[1].pawnSite = s.sites[3].id; // Barren Coast — no warbands anywhere on it
    const rolled = toRolled(s, {
      attacker: 1,
      defender: 'bandits',
      targets: [{ kind: 'site', siteId: s.sites[3].id }],
      attackDice: 2,
      attackFaces: ['sword', 'sword'],
      defenseFaces: ['blank'],
    });
    // Glossary §10.3: bandits are not warbands, so the force is empty and
    // the site contributes 1 bandit. 2 swords > 1: victorious, nothing dies.
    const out = act(rolled, 'campaign.resolve', 1, {});
    checkInvariants(out);
    expect(out.campaign!.phase).toBe('seize');
    expect(out.players[1].warbands.board).toBe(3); // no skulls rolled, nothing sacrificed
  });
});

describe('unit 16a part 1 — casualty destinations (Law §5.5.6 + §5.5.7\'s purple aside)', () => {
  /** The imperialState campaign, resolved to the point of the allocation. */
  function toCasualties(): OathState {
    const s = imperialState();
    const rolled = toRolled(s, {
      attacker: 1,
      defender: 2,
      targets: [{ kind: 'site', siteId: s.sites[0].id }, { kind: 'pawnFavor' }],
      attackDice: 3,
      attackFaces: ['sword', 'sword', 'sword'],
      defenseFaces: ['blank', 'blank', 'blank'],
    });
    return act(rolled, 'campaign.resolve', 1, { sacrifice: 3 });
  }

  it('raises the phase with the force and an engine-computed quota', () => {
    const out = toCasualties();
    checkInvariants(out);
    expect(out.campaign!.casualties).toEqual({
      force: [
        { kind: 'site', siteId: out.sites[0].id, seat: 0, count: 2 },
        { kind: 'board', seat: 2, count: 3 },
      ],
      quota: 2, // floor(5 / 2)
    });
  });

  it('asks the CHANCELLOR, not the defeated Citizen and not the attacker', () => {
    const out = toCasualties();
    expect(oath.pending(out)).toContainEqual({
      id: `campaign:0:${out.campaign!.declaredAt}`,
      seat: 0,
      kind: 'campaign',
      prompt: expect.stringContaining('2 warbands'),
      resolves: ['campaign.casualties'],
    });
    const kills = [{ kind: 'board', seat: 2, count: 2 }];
    expect(() => act(out, 'campaign.casualties', 2, { kills })).toThrow(IllegalAction);
    expect(() => act(out, 'campaign.casualties', 1, { kills })).toThrow(IllegalAction);
  });

  it('killing at the SITE: survivors there would have gone to the Chancellor, so nothing does', () => {
    const pending = toCasualties();
    const out = act(pending, 'campaign.casualties', 0, {
      kills: [{ kind: 'site', siteId: pending.sites[0].id, seat: 0, count: 2 }],
    });
    checkInvariants(out);
    expect(out.sites[0].warbands[0]).toBe(0); // both killed
    expect(out.players[0].warbands.bank).toBe(17); // 15 + 2, purple to the Chancellor (Glossary "Kill")
    expect(out.players[0].warbands.board).toBe(3); // unchanged — nothing survived at the site
    expect(out.players[2].warbands.board).toBe(3); // the Citizen's own board is untouched
    expect(out.campaign!.phase).toBe('seize');
    expect(out.campaign!.casualties).toBeUndefined();
  });

  it("killing on the CITIZEN's board: the site survivors consolidate onto the Chancellor's board", () => {
    const out = act(toCasualties(), 'campaign.casualties', 0, {
      kills: [{ kind: 'board', seat: 2, count: 2 }],
    });
    checkInvariants(out);
    expect(out.players[2].warbands.board).toBe(1); // 3 - 2 killed; the survivor stays put
    expect(out.players[0].warbands.bank).toBe(17); // killed purple still goes to the Chancellor
    expect(out.sites[0].warbands[0]).toBe(0); // the site is vacated either way (§5.5.6)
    expect(out.players[0].warbands.board).toBe(5); // 3 + the 2 site survivors (§5.5.7's aside)
  });

  it('rejects an allocation that does not sum to the quota, or over-draws one location', () => {
    const out = toCasualties();
    const siteId = out.sites[0].id;
    expect(() => act(out, 'campaign.casualties', 0, { kills: [{ kind: 'board', seat: 2, count: 1 }] })).toThrow(
      /exactly 2 kills/,
    );
    expect(() => act(out, 'campaign.casualties', 0, { kills: [{ kind: 'board', seat: 2, count: 3 }] })).toThrow(
      /exactly 2 kills/,
    );
    expect(() =>
      act(out, 'campaign.casualties', 0, { kills: [{ kind: 'site', siteId, seat: 0, count: 3 }] }),
    ).toThrow(/only 2/);
    expect(() =>
      act(out, 'campaign.casualties', 0, { kills: [{ kind: 'site', siteId, seat: 1, count: 2 }] }),
    ).toThrow(/not part of the defeated force/);
  });

  it('every other action stays locked out while the allocation is pending', () => {
    const out = toCasualties();
    expect(() => act(out, 'campaign.seize', 1, {})).toThrow(IllegalAction);
    expect(() => act(out, 'turn.rest', 1, {})).toThrow(IllegalAction);
  });
});

describe('unit 16a part 1 — the casualties phase is skipped when it cannot matter', () => {
  it('skips it for a Chancellor defender: site survivors and board survivors share one board', () => {
    const s = baseState();
    s.players[0].pawnSite = s.sites[5].id; // the Chancellor defends at the attacker's site
    s.turn.activeSeat = 1;
    const rolled = toRolled(s, {
      attacker: 1,
      defender: 0,
      targets: [{ kind: 'site', siteId: s.sites[0].id }, { kind: 'pawnFavor' }],
      attackDice: 3,
      attackFaces: ['sword', 'sword', 'sword'],
      defenseFaces: ['blank', 'blank', 'blank'],
    });
    // Force: 2 at sites[0] + the Chancellor's 3 board = 5, quota 2.
    const out = act(rolled, 'campaign.resolve', 1, { sacrifice: 3 });
    checkInvariants(out);
    expect(out.campaign!.phase).toBe('seize'); // no choice to make
    // Unit 13's sites-first default, still correct here: both kills come off
    // the site, and every survivor was already heading to the same board.
    expect(out.sites[0].warbands[0]).toBe(0);
    expect(out.players[0].warbands.bank).toBe(20); // 18 + 2
    expect(out.players[0].warbands.board).toBe(3);
  });

  it('skips it when the quota is 0', () => {
    const s = imperialState();
    s.players[2].warbands = { bank: 2, board: 1 }; // a 1-warband board contribution
    s.sites[0].warbands[0] = 0; // and no site warbands at all in the force
    s.players[0].warbands.bank = 17; // 17 + 3 board + 1 at sites[2] = 21 purple
    checkInvariants(s);
    const rolled = toRolled(s, {
      attacker: 1,
      defender: 2,
      targets: [{ kind: 'pawnFavor' }],
      attackDice: 2,
      attackFaces: ['sword', 'sword'],
      defenseFaces: ['blank', 'blank'],
    });
    // Force is 1 warband, quota floor(1/2) = 0 — nothing to allocate.
    const out = act(rolled, 'campaign.resolve', 1, {});
    checkInvariants(out);
    expect(out.campaign!.phase).toBe('seize');
    expect(out.players[2].warbands.board).toBe(1);
  });

  it('skips it when the whole force sits at sites (one destination: the Chancellor)', () => {
    const s = imperialState();
    s.players[2].pawnSite = s.sites[2].id; // NOT the attacker's site, and not targeted
    s.sites[5].warbands[0] = 3; // a Chancellor garrison at the attacker's site
    s.players[0].warbands.bank = 12; // 12 + 3 board + 2 + 1 + 3 = 21 purple
    checkInvariants(s);
    const rolled = toRolled(s, {
      attacker: 1,
      defender: 2,
      targets: [{ kind: 'site', siteId: s.sites[5].id }],
      attackDice: 3,
      attackFaces: ['sword', 'sword', 'sword'],
      defenseFaces: ['blank'],
    });
    // Force: the Chancellor's 3 warbands at sites[5]. The Citizen's board is
    // out (their pawn fails §5.5.4's test). Quota 1, but one destination.
    const out = act(rolled, 'campaign.resolve', 1, { sacrifice: 1 });
    checkInvariants(out);
    expect(out.campaign!.phase).toBe('seize');
    expect(out.sites[5].warbands[0]).toBe(0);
    expect(out.players[0].warbands.bank).toBe(13); // 12 + 1 killed
    expect(out.players[0].warbands.board).toBe(5); // 3 + 2 survivors (§5.5.7's aside)
  });
});
