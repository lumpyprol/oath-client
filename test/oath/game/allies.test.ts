import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';
import { checkInvariants, type OathState } from '../../../src/oath/game/state.js';
import { oath } from '../../../src/oath/game/index.js';
import { IllegalAction, type GameAction } from '../../../src/engine/types.js';
import { baseState } from './helpers.js';

// A separate DB per test file (store.test.ts's own convention), needed only
// by the end-to-end Imperial-defence test at the bottom.
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'oath-allies-')), 'test.db');
let store: typeof import('../../../src/actionlog.js');
let db: typeof import('../../../src/db.js')['db'];

beforeAll(async () => {
  store = await import('../../../src/actionlog.js');
  ({ db } = await import('../../../src/db.js'));
});

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
  // The Chancellor mandatorily joins as an Ally (part 2, §5.5.2), but their
  // pawn is parked at an untargeted site, so §5.5.4's own pawn test keeps
  // their BOARD out of the force — the "Ally who contributes nothing" case.
  // That keeps part 1's hand-computed totals about part 1's concern; the
  // part 2 describes below move this pawn deliberately.
  s.players[0].pawnSite = s.sites[2].id;
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

// ---- part 2: Imperial Allies (Law §5.5.2) ---------------------------------

/**
 * The mirror of `imperialState`: the CHANCELLOR defends (so they are nobody's
 * Ally — you are not your own), seat 1 attacks, and seat 2 is a Citizen
 * eligible to volunteer. Both defender and volunteer have their pawns at the
 * attacker's site, so §5.5.4's board test passes for both.
 *
 * Purple: seat 0 holds 14 bank + 3 board + 2 at sites[0] + 1 at sites[2] = 20,
 * seat 2 holds 4, totalling the required 24.
 */
function chancellorDefendsState(): OathState {
  const s = baseState();
  s.players[2].citizenship = 'citizen';
  s.players[2].warbands = { bank: 0, board: 4 };
  s.players[0].warbands.bank = 14;
  s.players[0].pawnSite = s.sites[5].id;
  s.players[2].pawnSite = s.sites[5].id;
  s.turn.activeSeat = 1;
  checkInvariants(s);
  return s;
}

describe('unit 16a part 2 — who is an Ally (Law §5.5.2)', () => {
  it('the Chancellor joins automatically, with no action and no permission, when a Citizen defends', () => {
    const s = imperialState();
    const out = act(s, 'campaign.declare', 1, {
      defender: 2,
      targets: [{ kind: 'site', siteId: s.sites[0].id }, { kind: 'pawnFavor' }],
      attackDice: 3,
    });
    checkInvariants(out);
    expect(out.campaign!.allies).toEqual([0]);
    expect(out.campaign!.allyVolunteers).toEqual([]);
  });

  it('the Chancellor is not their own Ally when they are the defender', () => {
    const s = chancellorDefendsState();
    const out = act(s, 'campaign.declare', 1, {
      defender: 0,
      targets: [{ kind: 'pawnFavor' }],
      attackDice: 2,
    });
    expect(out.campaign!.allies).toEqual([]);
  });

  it('no Allies exist at all when the CHANCELLOR attacks a Citizen — §5.5.1 leaves no Imperial defender', () => {
    const s = imperialState();
    s.turn.activeSeat = 0;
    s.players[0].pawnSite = s.sites[5].id; // the Chancellor marches on the Citizen
    const out = act(s, 'campaign.declare', 0, {
      defender: 2,
      targets: [{ kind: 'pawnFavor' }],
      attackDice: 3,
    });
    checkInvariants(out);
    expect(out.campaign!.allies).toEqual([]);
    // ...and the suspended Citizen may not be joined by anyone, either.
    expect(oath.pending(out).filter((d) => d.resolves.includes('campaign.ally'))).toEqual([]);
  });

  it('an Exile defender and a bandits defence never have Allies', () => {
    const s = baseState();
    s.players[2].pawnSite = s.sites[5].id;
    const vsExile = act(s, 'campaign.declare', 1, {
      defender: 2,
      targets: [{ kind: 'pawnFavor' }],
      attackDice: 2,
    });
    expect(vsExile.campaign!.allies).toEqual([]);

    const b = baseState();
    b.players[1].pawnSite = b.sites[3].id;
    const vsBandits = act(b, 'campaign.declare', 1, {
      defender: 'bandits',
      targets: [{ kind: 'site', siteId: b.sites[3].id }],
      attackDice: 2,
    });
    expect(vsBandits.campaign!.allies).toEqual([]);
  });
});

describe('unit 16a part 2 — §5.5.4\'s per-Ally board bonus', () => {
  it("a mandatory Chancellor Ally contributes NOTHING when their pawn fails §5.5.4's test", () => {
    const s = imperialState(); // the Chancellor's pawn is parked at an untargeted site
    const rolled = toRolled(s, {
      attacker: 1,
      defender: 2,
      targets: [{ kind: 'site', siteId: s.sites[0].id }, { kind: 'pawnFavor' }],
      attackDice: 3,
      attackFaces: ['sword', 'sword', 'sword'],
      defenseFaces: ['blank', 'blank', 'blank'],
    });
    expect(rolled.campaign!.allies).toEqual([0]); // an Ally all the same
    // Force is still just 2 (site) + 3 (the Citizen's board) = 5.
    expect(() => act(rolled, 'campaign.resolve', 1, { sacrifice: 1 })).toThrow(/must be exactly 3\b/);
  });

  it('...and contributes their whole board when their pawn IS at a targeted site', () => {
    const s = imperialState();
    s.players[0].pawnSite = s.sites[0].id; // the site this campaign targets
    const rolled = toRolled(s, {
      attacker: 1,
      defender: 2,
      targets: [{ kind: 'site', siteId: s.sites[0].id }, { kind: 'pawnFavor' }],
      attackDice: 3,
      attackFaces: ['sword', 'sword', 'sword'],
      defenseFaces: ['blank', 'blank', 'blank'],
    });
    // 2 (site) + 3 (Citizen's board) + 3 (the Chancellor Ally's board) = 8.
    expect(() => act(rolled, 'campaign.resolve', 1, { sacrifice: 1 })).toThrow(/must be exactly 6\b/);
  });

  it("a permitted Citizen Ally's board joins the defense; an unpermitted volunteer's does not", () => {
    const s = chancellorDefendsState();
    const declared = act(s, 'campaign.declare', 1, {
      defender: 0,
      targets: [{ kind: 'pawnFavor' }],
      attackDice: 3,
    });
    const offered = act(declared, 'campaign.ally', 2);
    expect(offered.campaign!.allyVolunteers).toEqual([2]);
    expect(offered.campaign!.allies).toEqual([]); // offering is not joining

    const faces = { attackFaces: ['sword', 'sword', 'sword'], defenseFaces: ['blank', 'blank'] };

    // Declined: the force is the Chancellor's 3 board warbands alone.
    const declined = act(act(offered, 'campaign.respond', 0, { allies: [] }), 'campaign.roll', 1, faces);
    expect(declined.campaign!.allies).toEqual([]);
    expect(() => act(declined, 'campaign.resolve', 1, { sacrifice: 2 })).toThrow(/must be exactly 1\b/);

    // Permitted: + the Citizen's 4 = 7.
    const permitted = act(act(offered, 'campaign.respond', 0, { allies: [2] }), 'campaign.roll', 1, faces);
    expect(permitted.campaign!.allies).toEqual([2]);
    expect(() => act(permitted, 'campaign.resolve', 1, { sacrifice: 2 })).toThrow(/must be exactly 5\b/);
  });
});

describe('unit 16a part 2 — joining is illegal without both consents', () => {
  it('surfaces the offer as its own pending decision for each eligible Citizen', () => {
    const s = chancellorDefendsState();
    const declared = act(s, 'campaign.declare', 1, {
      defender: 0,
      targets: [{ kind: 'pawnFavor' }],
      attackDice: 2,
    });
    expect(oath.pending(declared)).toContainEqual({
      id: `campaign-ally:2:${declared.campaign!.declaredAt}`,
      seat: 2,
      kind: 'campaign',
      prompt: expect.stringContaining('Ally'),
      resolves: ['campaign.ally'],
    });
    // Once offered, the decision is gone (naive one-at-a-time; P3 batches).
    const offered = act(declared, 'campaign.ally', 2);
    expect(oath.pending(offered).filter((d) => d.resolves.includes('campaign.ally'))).toEqual([]);
    expect(() => act(offered, 'campaign.ally', 2)).toThrow(/already offered/);
  });

  it('rejects a volunteer whose pawn is at neither a targeted site nor the attacker\'s site', () => {
    const s = chancellorDefendsState();
    s.players[2].pawnSite = s.sites[2].id; // away from the fight
    const declared = act(s, 'campaign.declare', 1, {
      defender: 0,
      targets: [{ kind: 'pawnFavor' }],
      attackDice: 2,
    });
    expect(() => act(declared, 'campaign.ally', 2)).toThrow(IllegalAction);
  });

  it('rejects the attacker and any Exile as a volunteer', () => {
    const s = chancellorDefendsState();
    const declared = act(s, 'campaign.declare', 1, {
      defender: 0,
      targets: [{ kind: 'pawnFavor' }],
      attackDice: 2,
    });
    expect(() => act(declared, 'campaign.ally', 1)).toThrow(IllegalAction); // the attacker
    // Positive control: as a Citizen, seat 2 IS eligible in this same state.
    expect(act(declared, 'campaign.ally', 2).campaign!.allyVolunteers).toEqual([2]);

    const s2 = chancellorDefendsState();
    s2.players[2].citizenship = 'exile'; // an Exile cannot be an Imperial Ally
    s2.players[2].warbands = { bank: 10, board: 4 };
    s2.players[0].warbands.bank = 18;
    const declared2 = act(s2, 'campaign.declare', 1, {
      defender: 0,
      targets: [{ kind: 'pawnFavor' }],
      attackDice: 2,
    });
    expect(() => act(declared2, 'campaign.ally', 2)).toThrow(IllegalAction);
  });

  it('rejects permission for a seat that never offered', () => {
    const s = chancellorDefendsState();
    const declared = act(s, 'campaign.declare', 1, {
      defender: 0,
      targets: [{ kind: 'pawnFavor' }],
      attackDice: 2,
    });
    expect(() => act(declared, 'campaign.respond', 0, { allies: [2] })).toThrow(/did not offer/);
  });

  it('closes the window: no offers once the defender has responded', () => {
    const s = chancellorDefendsState();
    const declared = act(s, 'campaign.declare', 1, {
      defender: 0,
      targets: [{ kind: 'pawnFavor' }],
      attackDice: 2,
    });
    const responded = act(declared, 'campaign.respond', 0, {});
    expect(() => act(responded, 'campaign.ally', 2)).toThrow(IllegalAction);
  });
});

describe('unit 16a part 2 — §5.5.3\'s battle-plan window membership', () => {
  it('a permitted Ally may use a power inside the response window; the attacker may not', () => {
    const s = imperialState();
    const declared = act(s, 'campaign.declare', 1, {
      defender: 2,
      targets: [{ kind: 'site', siteId: s.sites[0].id }, { kind: 'pawnFavor' }],
      attackDice: 3,
    });
    expect(declared.campaign!.allies).toEqual([0]);
    // Seat 0's own faceup adviser, a card they always have access to (§7.1.1).
    const cardId = declared.players[0].advisers[0].id;
    const used = act(declared, 'power.use', 0, { cardId, effects: [] });
    checkInvariants(used);
    // The attacker has no standing in the defender's window.
    const attackerCard = declared.players[1].relics[0] ?? declared.sites[5].cards[0]!.id;
    expect(() => act(declared, 'power.use', 1, { cardId: attackerCard, effects: [] })).toThrow(IllegalAction);
  });

  it('a volunteer who was never permitted may not', () => {
    const s = chancellorDefendsState();
    const declared = act(s, 'campaign.declare', 1, {
      defender: 0,
      targets: [{ kind: 'pawnFavor' }],
      attackDice: 2,
    });
    const offered = act(declared, 'campaign.ally', 2);
    const cardId = offered.players[2].relics[0];
    expect(() => act(offered, 'power.use', 2, { cardId, effects: [] })).toThrow(IllegalAction);
  });
});

describe('unit 16a — a full Imperial defence, end to end through the store', () => {
  /** Law §5.5.4's shield arithmetic, recomputed independently of the engine. */
  function shieldsOf(faces: string[]): number {
    const base = faces.reduce((sum, f) => sum + (f === 'shield' ? 1 : f === 'doubleShield' ? 2 : 0), 0);
    return base * 2 ** faces.filter((f) => f === 'shieldX2').length;
  }

  it('declare -> ally -> respond -> roll -> resolve -> casualties -> seize, and the log refolds identically', () => {
    const opening = chancellorDefendsState();
    // A deep attacker board, so the exact sacrifice is always affordable
    // whatever the two defense dice come up as.
    opening.players[1].warbands = { bank: 0, board: 12 };
    checkInvariants(opening);

    const { gameId } = store.createGame(oath, ['Chancellor', 'Red', 'Blue', 'Yellow']);
    db.prepare('INSERT OR REPLACE INTO snapshots (game_id, seq, state) VALUES (?, ?, ?)').run(
      gameId,
      0,
      JSON.stringify(opening),
    );

    let seq = store.headSeq(gameId);
    const append = (type: string, actor: number, payload: unknown) => {
      const r = store.appendAction(oath, gameId, seq, { type, actor, payload });
      seq = r.seq;
      return r.state as OathState;
    };

    append('campaign.declare', 1, { defender: 0, targets: [{ kind: 'pawnFavor' }], attackDice: 0 });
    append('campaign.ally', 2, {});
    append('campaign.respond', 0, { allies: [2] });
    const rolled = append('campaign.roll', 1, {});

    // Force: the Chancellor's 3 board warbands + the Ally Citizen's 4 = 7.
    // Zero attack dice, so the attack is whatever is sacrificed, and §9.5
    // makes that exactly defense + 1.
    const defense = shieldsOf(rolled.campaign!.defenseFaces!) + 7;
    const pending = append('campaign.resolve', 1, { sacrifice: defense + 1 });
    expect(pending.campaign!.phase).toBe('casualties');
    expect(pending.campaign!.casualties!.quota).toBe(3); // floor(7 / 2)

    const allocated = append('campaign.casualties', 0, {
      kills: [
        { kind: 'board', seat: 0, count: 1 },
        { kind: 'board', seat: 2, count: 2 },
      ],
    });
    expect(allocated.campaign!.phase).toBe('seize');
    const final = append('campaign.seize', 1, { burnFavor: true });
    checkInvariants(final);

    expect(final.campaign).toBeNull();
    expect(final.players[0].warbands.board).toBe(2); // 3 - 1 killed; survivors stay on their board
    expect(final.players[2].warbands.board).toBe(2); // 4 - 2 killed
    expect(final.players[0].warbands.bank).toBe(17); // 14 + 3 killed purple (Glossary "Kill")
    expect(final.players[0].favor).toBe(1); // §5.5.7: half of 2, rounded down, burned

    const first = store.loadState(oath, gameId).state;
    db.prepare('DELETE FROM snapshots WHERE game_id = ? AND seq > 0').run(gameId);
    expect(store.loadState(oath, gameId).state).toEqual(first);
  });
});
