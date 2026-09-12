/**
 * P3 unit 6: standing responses (HLD D52).
 *
 * The correctness claim these tests exist to prove is SAME-OUTCOME: a
 * policy-driven short-circuit must land the game in exactly the state the
 * explicit action it replaces would have, and must do so without appending
 * an action. Everything else here — rollback, revocation, the log's shape —
 * follows from the policy being ordinary state written by an ordinary
 * logged action.
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';
import {
  checkInvariants,
  DEFAULT_STANDING,
  TOTAL_FAVOR,
  type OathState,
} from '../../../src/oath/game/state.js';
import { oath } from '../../../src/oath/game/index.js';
import { IllegalAction, type GameAction } from '../../../src/engine/types.js';
import { baseState } from './helpers.js';

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'oath-standing-')), 'test.db');
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
    createdAt: '2026-09-12T00:00:00.000Z',
  };
  return oath.reduce(structuredClone(state), action);
}

/**
 * Two states are the same OUTCOME if they agree on everything but the
 * bookkeeping that necessarily differs when one path took fewer actions.
 *
 * That is `actionCount` itself plus every DECISION-ID ANCHOR, since each is
 * stamped from `actionCount` at the moment its decision arose — an explicit
 * path that logged one more action stamps them one higher. Normalising them
 * is not hiding a difference; it is naming the only difference a
 * short-circuit is allowed to make, and the assertion is worthless unless
 * this list is exhaustive, so it is kept in step with `state.ts`.
 */
function sameOutcome(a: OathState, b: OathState) {
  const strip = (s: OathState) => {
    const c = structuredClone(s);
    c.actionCount = 0;
    c.turn.turnStartedAt = 0;
    for (const p of c.players) p.handDrawnAt = 0;
    if (c.campaign) c.campaign.declaredAt = 0;
    if (c.citizenshipOffer) c.citizenshipOffer.offeredAt = 0;
    if (c.warbandRequest) c.warbandRequest.requestedAt = 0;
    if (c.wake) c.wake.startedAt = 0;
    if (c.titleChoice) c.titleChoice.raisedAt = 0;
    return c;
  };
  expect(strip(a)).toEqual(strip(b));
}

describe('standing.set — an ordinary logged action with its own guard', () => {
  it('merges a PARTIAL policy, leaving the other channels alone', () => {
    const s = baseState();
    expect(s.players[1].standing).toEqual(DEFAULT_STANDING);
    const out = act(s, 'standing.set', 1, { ally: 'pass' });
    checkInvariants(out);
    expect(out.players[1].standing).toEqual({ defense: 'ask', ally: 'pass', warbands: 'ask' });

    const both = act(out, 'standing.set', 1, { warbands: 'deny' });
    expect(both.players[1].standing).toEqual({ defense: 'ask', ally: 'pass', warbands: 'deny' });
  });

  it('is legal OUTSIDE your own turn — the one action that is', () => {
    const s = baseState(); // seat 1 is active
    const out = act(s, 'standing.set', 2, { ally: 'pass' });
    checkInvariants(out);
    expect(out.players[2].standing.ally).toBe('pass');
    expect(out.turn.activeSeat).toBe(1); // it did not steal the turn either
  });

  it('is legal while a Campaign holds the game locked, and while a Wake does', () => {
    const s = baseState();
    s.players[2].pawnSite = s.sites[5].id;
    const declared = act(s, 'campaign.declare', 1, {
      defender: 2,
      targets: [{ kind: 'pawnFavor' }],
      attackDice: 2,
    });
    expect(declared.campaign).not.toBeNull();
    const out = act(declared, 'standing.set', 0, { warbands: 'allow' });
    checkInvariants(out);
    expect(out.players[0].standing.warbands).toBe('allow');
    expect(out.campaign).not.toBeNull(); // the campaign is untouched
  });

  it('changes no game object at all — only the policy moves', () => {
    const s = baseState();
    const out = act(s, 'standing.set', 1, { ally: 'pass', warbands: 'deny', defense: 'close' });
    const bare = (x: OathState) => ({
      ...structuredClone(x),
      actionCount: 0,
      players: x.players.map((p) => ({ ...structuredClone(p), standing: DEFAULT_STANDING })),
    });
    expect(bare(out)).toEqual(bare(s));
  });

  it('rejects an unseated actor, a bad seat, and an unknown or invalid channel', () => {
    const s = baseState();
    expect(() => act(s, 'standing.set', null, { ally: 'pass' })).toThrow(/seated actor/);
    expect(() => act(s, 'standing.set', 9, { ally: 'pass' })).toThrow(/no such seat/);
    expect(() => act(s, 'standing.set', 1, { ally: 'sometimes' })).toThrow(/malformed/);
    expect(() => act(s, 'standing.set', 1, { nonsense: 'pass' })).toThrow(/malformed/);
  });

  it('is visible to its owner and to nobody else', () => {
    const s = act(baseState(), 'standing.set', 1, { defense: 'close', ally: 'pass' });
    const own = oath.project(s, 1) as { players: { standing: unknown }[] };
    expect(own.players[1].standing).toEqual({ defense: 'close', ally: 'pass', warbands: 'ask' });

    // A rival learns nothing: knowing seat 1 will not use a battle plan is
    // worth real tempo, so the policy itself stays private even though its
    // effects are public once they fire.
    for (const viewer of [0, 2, null]) {
      const view = oath.project(s, viewer) as { players: { standing: unknown }[] };
      expect(view.players[1].standing, `seat ${viewer} saw seat 1's policy`).toBeNull();
    }
  });

  it('checkInvariants rejects a malformed policy', () => {
    const s = baseState();
    (s.players[1] as unknown as { standing: unknown }).standing = { ally: 'pass' };
    expect(() => checkInvariants(s)).toThrow(/standing\.defense/);

    const s2 = baseState();
    (s2.players[1].standing as unknown as Record<string, string>).extra = 'x';
    expect(() => checkInvariants(s2)).toThrow(/unknown channel/);
  });
});

describe("ally: 'pass' — §5.5.2's join question, answered before it is asked", () => {
  /** seat 1 (Exile) attacks the Chancellor; seat 2 is an eligible Citizen. */
  function chancellorDefends(): OathState {
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
  const declaration = { defender: 0, targets: [{ kind: 'pawnFavor' }], attackDice: 2 };

  it('produces the SAME end state as the explicit decline it replaces', () => {
    // The explicit path: declare opens the join window, seat 2 declines.
    const explicit = act(act(chancellorDefends(), 'campaign.declare', 1, declaration), 'campaign.ally', 2, {
      join: false,
    });

    // The policy path: seat 2 has already said no, so declare alone does it.
    const policied = act(
      act(chancellorDefends(), 'standing.set', 2, { ally: 'pass' }),
      'campaign.declare',
      1,
      declaration,
    );
    checkInvariants(policied);

    // Same outcome but for the policy itself and the action bookkeeping.
    const normalise = (s: OathState) => {
      const c = structuredClone(s);
      c.players[2].standing = { ...DEFAULT_STANDING };
      return c;
    };
    sameOutcome(normalise(explicit), normalise(policied));
    expect(policied.campaign!.phase).toBe('respond'); // the window opened and closed in one reduce
  });

  it('takes ZERO actions to do it — the short-circuit never appends one', () => {
    const opening = act(chancellorDefends(), 'standing.set', 2, { ally: 'pass' });
    const { gameId } = store.createGame(oath, ['Chancellor', 'Red', 'Blue', 'Yellow']);
    db.prepare('INSERT OR REPLACE INTO snapshots (game_id, seq, state) VALUES (?, ?, ?)').run(
      gameId,
      0,
      JSON.stringify(opening),
    );
    let seq = store.headSeq(gameId);
    const r = store.appendAction(oath, gameId, seq, {
      type: 'campaign.declare',
      actor: 1,
      payload: declaration,
    });
    seq = r.seq;

    // The log holds the declare and NOTHING else — no synthetic decline.
    const campaignActions = store.history(gameId).filter((a) => a.type.startsWith('campaign.'));
    expect(campaignActions.map((a) => a.type)).toEqual(['campaign.declare']);
    expect((r.state as OathState).campaign!.phase).toBe('respond');

    // ...and a refold reproduces the same skip, because the policy is state.
    const first = store.loadState(oath, gameId).state;
    db.prepare('DELETE FROM snapshots WHERE game_id = ? AND seq > 0').run(gameId);
    expect(store.loadState(oath, gameId).state).toEqual(first);
  });

  it('revocation affects FUTURE raises only', () => {
    const passing = act(chancellorDefends(), 'standing.set', 2, { ally: 'pass' });
    const skipped = act(passing, 'campaign.declare', 1, declaration);
    expect(skipped.campaign!.phase).toBe('respond'); // window never opened

    // Revoke, then run a fresh campaign: the question comes back.
    const revoked = act(passing, 'standing.set', 2, { ally: 'ask' });
    const asked = act(revoked, 'campaign.declare', 1, declaration);
    expect(asked.campaign!.phase).toBe('join');
    expect(oath.pending(asked).some((d) => d.seat === 2 && d.resolves.includes('campaign.ally'))).toBe(
      true,
    );
  });

  it('rolls back cleanly: rewinding past the standing.set restores ask-behaviour', () => {
    const { gameId } = store.createGame(oath, ['Chancellor', 'Red', 'Blue', 'Yellow']);
    db.prepare('INSERT OR REPLACE INTO snapshots (game_id, seq, state) VALUES (?, ?, ?)').run(
      gameId,
      0,
      JSON.stringify(chancellorDefends()),
    );
    let seq = store.headSeq(gameId);
    const beforePolicy = seq;
    seq = store.appendAction(oath, gameId, seq, {
      type: 'standing.set',
      actor: 2,
      payload: { ally: 'pass' },
    }).seq;
    const withPolicy = store.appendAction(oath, gameId, seq, {
      type: 'campaign.declare',
      actor: 1,
      payload: declaration,
    });
    expect((withPolicy.state as OathState).campaign!.phase).toBe('respond'); // skipped

    // Roll back past BOTH, then redeclare with no policy in force.
    store.rollback(gameId, beforePolicy);
    const after = store.appendAction(oath, gameId, store.headSeq(gameId), {
      type: 'campaign.declare',
      actor: 1,
      payload: declaration,
    });
    const c = (after.state as OathState);
    expect(c.players[2].standing).toEqual(DEFAULT_STANDING); // the policy is gone
    expect(c.campaign!.phase).toBe('join'); // ...and so the question is asked again
    checkInvariants(c);
  });
});

describe("warbands: 'allow' / 'deny' — §6.5's permission, answered at the request", () => {
  /** seat 2 is a Citizen garrisoning their own site; the Chancellor's permission is required. */
  function citizenAtSite(): OathState {
    const s = baseState();
    s.players[2].citizenship = 'citizen';
    s.players[2].warbands = { bank: 0, board: 1 };
    s.sites[2].warbands[2] = 2;
    s.players[0].warbands.bank = 15;
    s.turn.activeSeat = 2;
    checkInvariants(s);
    return s;
  }
  const move = { direction: 'toBoard', count: 1 };

  it("'allow' produces the SAME end state as the explicit warbands.allow it replaces", () => {
    const explicit = act(act(citizenAtSite(), 'warbands.move', 2, move), 'warbands.allow', 0);
    const policied = act(
      act(citizenAtSite(), 'standing.set', 0, { warbands: 'allow' }),
      'warbands.move',
      2,
      move,
    );
    checkInvariants(policied);
    expect(policied.warbandRequest).toBeNull(); // never raised at all

    const normalise = (s: OathState) => {
      const c = structuredClone(s);
      c.players[0].standing = { ...DEFAULT_STANDING };
      return c;
    };
    sameOutcome(normalise(explicit), normalise(policied));
  });

  it("'deny' bounces the move at the asker, so nothing reaches the log", () => {
    const denying = act(citizenAtSite(), 'standing.set', 0, { warbands: 'deny' });
    expect(() => act(denying, 'warbands.move', 2, move)).toThrow(/standing response denying/);
    // The board is untouched, exactly as after an explicit warbands.deny.
    const explicit = act(act(citizenAtSite(), 'warbands.move', 2, move), 'warbands.deny', 0);
    expect(explicit.sites[2].warbands[2]).toBe(2);
    expect(denying.sites[2].warbands[2]).toBe(2);
  });

  it("'ask' is unchanged — the request is raised as it always was", () => {
    const asked = act(citizenAtSite(), 'warbands.move', 2, move);
    expect(asked.warbandRequest).toMatchObject({ seat: 2, approver: 0, direction: 'toBoard' });
    expect(oath.pending(asked).some((d) => d.kind === 'warbands' && d.seat === 0)).toBe(true);
  });

  it('an ALLOWED move is still re-validated — a policy is not a blank cheque', () => {
    const allowing = act(citizenAtSite(), 'standing.set', 0, { warbands: 'allow' });
    // §6.5 forbids moving the last warband off your site; the policy does
    // not override the Law, it only answers the permission question.
    expect(() => act(allowing, 'warbands.move', 2, { direction: 'toBoard', count: 2 })).toThrow(
      /must leave one/,
    );
  });
});

/**
 * P3 unit 7 — THE PHASE'S HEADLINE EXIT CRITERION, named after it:
 *
 *   "a campaign against a defender who has a standing response resolves in
 *    one round trip"
 *
 * Asserted from the RAW LOG's actor sequence, not from state, because the
 * claim is about who had to come online — and only the log can say that.
 */
describe('EXIT CRITERION: a campaign against a standing defence costs the defender zero actions', () => {
  /** seat 1 (Exile) attacks the Chancellor, with seat 2 an eligible Citizen. */
  function chancellorDefends(): OathState {
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
  const declaration = { defender: 0, targets: [{ kind: 'pawnFavor' }], attackDice: 2 };

  function gameFrom(initial: OathState) {
    const { gameId } = store.createGame(oath, ['Chancellor', 'Red', 'Blue', 'Yellow']);
    db.prepare('INSERT OR REPLACE INTO snapshots (game_id, seq, state) VALUES (?, ?, ?)').run(
      gameId,
      0,
      JSON.stringify(initial),
    );
    let seq = store.headSeq(gameId);
    const append = (type: string, actor: number, payload: unknown = {}) => {
      const r = store.appendAction(oath, gameId, seq, { type, actor, payload });
      seq = r.seq;
      return r.state as OathState;
    };
    return { gameId, append };
  }

  /** The campaign's actor sequence, straight off the persisted log. */
  function campaignActors(gameId: string) {
    return store
      .history(gameId)
      .filter((a) => a.type.startsWith('campaign.'))
      .map((a) => `${a.type}/${a.actor}`);
  }

  /**
   * Law §5.5.5's exact sacrifice, from the faces the engine actually rolled,
   * AND whether the attacker can actually afford it.
   *
   * The affordability half is the subtle one: §5.5.5 kills the attacker's
   * own skulls BEFORE the sacrifice is paid, so the board to compare
   * against is the POST-SKULL one. Checking the pre-skull board made these
   * tests fail on roughly one roll in three — a real flake, caught by
   * running the suite in a loop rather than once.
   */
  function planResolve(s: OathState, boardBonus: number) {
    const c = s.campaign!;
    const attack = c.attackFaces!;
    const defense = c.defenseFaces!;
    const swords =
      attack.filter((f) => f === 'sword').length +
      Math.floor(attack.filter((f) => f === 'hollowSword').length / 2);
    const base = defense.reduce((t, f) => t + (f === 'shield' ? 1 : f === 'doubleShield' ? 2 : 0), 0);
    const total = base * 2 ** defense.filter((f) => f === 'shieldX2').length + boardBonus;
    const needed = Math.max(0, total - swords + 1);
    const skulls = attack.filter((f) => f === 'skull').length;
    const affordable = needed <= s.players[c.attackerSeat].warbands.board - skulls;
    return { sacrifice: affordable ? needed : 0 };
  }

  it('declare -> resolve, and NOTHING in between: the defender never acts', () => {
    let opening = chancellorDefends();
    opening = act(opening, 'standing.set', 0, { defense: 'close' }); // the defender
    opening = act(opening, 'standing.set', 2, { ally: 'pass' }); // the one Citizen
    checkInvariants(opening);

    const { gameId, append } = gameFrom(opening);
    const declared = append('campaign.declare', 1, declaration);

    // Every window opened and closed inside declare's own reduce, and the
    // dice rode ITS payload — D14 held, the roll just moved again.
    expect(declared.campaign!.phase).toBe('rolled');
    const declareRow = store.history(gameId).find((a) => a.type === 'campaign.declare')!;
    expect((declareRow.payload as { attackFaces: string[] }).attackFaces).toHaveLength(2);

    const final = append('campaign.resolve', 1, planResolve(declared, declared.players[0].warbands.board));
    checkInvariants(final);

    // THE ASSERTION. Two actions, both the attacker's; the defender and the
    // Citizen submitted nothing at all.
    expect(campaignActors(gameId)).toEqual(['campaign.declare/1', 'campaign.resolve/1']);

    // Replay: the dice moved again, so prove D14 still holds.
    const first = store.loadState(oath, gameId).state;
    db.prepare('DELETE FROM snapshots WHERE game_id = ? AND seq > 0').run(gameId);
    expect(store.loadState(oath, gameId).state).toEqual(first);
  });

  it('the mixed case: a Citizen who still asks closes the window, and carries the dice', () => {
    // Defender closes by policy; seat 2 has NO policy, so they still answer.
    const opening = act(chancellorDefends(), 'standing.set', 0, { defense: 'close' });
    const { gameId, append } = gameFrom(opening);

    const declared = append('campaign.declare', 1, declaration);
    expect(declared.campaign!.phase).toBe('join'); // seat 2 still owes an answer
    expect((store.history(gameId).at(-1)!.payload as { attackFaces?: unknown }).attackFaces).toBeUndefined();

    // Seat 2 joins. That answer closes the join window, and because the
    // defender auto-permits nobody and auto-closes the plan window, it is
    // the LAST window-closer — so the dice land in the ALLY's payload.
    const joined = append('campaign.ally', 2, { join: true });
    expect(joined.campaign!.phase).toBe('rolled');
    expect(joined.campaign!.allies).toEqual([]); // auto-permitted nobody (RULINGS.md)
    const allyRow = store.history(gameId).find((a) => a.type === 'campaign.ally')!;
    expect((allyRow.payload as { attackFaces: string[] }).attackFaces).toHaveLength(2);

    append('campaign.resolve', 1, planResolve(joined, joined.players[0].warbands.board));

    // The defender still submitted NOTHING — no permit, no respond.
    expect(campaignActors(gameId)).toEqual([
      'campaign.declare/1',
      'campaign.ally/2',
      'campaign.resolve/1',
    ]);
    expect(campaignActors(gameId).filter((a) => a.endsWith('/0'))).toEqual([]);

    const first = store.loadState(oath, gameId).state;
    db.prepare('DELETE FROM snapshots WHERE game_id = ? AND seq > 0').run(gameId);
    expect(store.loadState(oath, gameId).state).toEqual(first);
  });

  it('without the policy, the same campaign costs the defender a visit — the control', () => {
    const { gameId, append } = gameFrom(act(chancellorDefends(), 'standing.set', 2, { ally: 'pass' }));
    const declared = append('campaign.declare', 1, declaration);
    expect(declared.campaign!.phase).toBe('respond'); // join skipped, but the defender is asked
    const rolled = append('campaign.respond', 0, {});
    append('campaign.resolve', 1, planResolve(rolled, rolled.players[0].warbands.board));
    expect(campaignActors(gameId)).toEqual([
      'campaign.declare/1',
      'campaign.respond/0', // <- the visit unit 7 removes
      'campaign.resolve/1',
    ]);
  });

  it('a defender who permits an Ally and then closes still spends only that one visit', () => {
    // defense:'close' auto-permits nobody, so to reach `campaign.permit` at
    // all the defender must have been on 'ask' when the join window closed.
    const { gameId, append } = gameFrom(chancellorDefends());
    append('campaign.declare', 1, declaration);
    const joined = append('campaign.ally', 2, { join: true });
    expect(joined.campaign!.phase).toBe('permit');

    // They permit, and in the same sitting adopt the policy. Their permit
    // action closes the plan window too, so it carries the dice.
    const withPolicy = append('standing.set', 0, { defense: 'close' });
    expect(withPolicy.players[0].standing.defense).toBe('close');
    const permitted = append('campaign.permit', 0, { allies: [2] });
    expect(permitted.campaign!.phase).toBe('rolled');
    expect(permitted.campaign!.allies).toContain(2); // an explicit permit still stands
    const permitRow = store.history(gameId).find((a) => a.type === 'campaign.permit')!;
    expect((permitRow.payload as { attackFaces: string[] }).attackFaces).toHaveLength(2);

    const first = store.loadState(oath, gameId).state;
    db.prepare('DELETE FROM snapshots WHERE game_id = ? AND seq > 0').run(gameId);
    expect(store.loadState(oath, gameId).state).toEqual(first);
  });

  it('a policy set mid-campaign does not retract a decision already raised', () => {
    const { gameId, append } = gameFrom(act(chancellorDefends(), 'standing.set', 2, { ally: 'pass' }));
    const declared = append('campaign.declare', 1, declaration);
    expect(declared.campaign!.phase).toBe('respond'); // the defender's window is OPEN

    // Adopting 'close' now does not close the window that is already open —
    // D52's "future raises only", which keeps a pending decision's meaning
    // stable while its owner is looking at it.
    const after = append('standing.set', 0, { defense: 'close' });
    expect(after.campaign!.phase).toBe('respond');
    expect(oath.pending(after).some((d) => d.seat === 0 && d.resolves.includes('campaign.respond'))).toBe(
      true,
    );
  });
});

describe('a six-seat campaign where every Citizen passes', () => {
  /**
   * Seat 1 (Exile) attacks the Chancellor with four Citizens all eligible to
   * join. With `ally: 'pass'` on every one of them, §5.5.2's window opens
   * and closes inside `campaign.declare`'s own reduce — four decisions that
   * are never raised, and four visits that are never spent.
   */
  function sixSeats(): OathState {
    const s = baseState({ seats: 6 });
    const site = s.sites[5].id;
    s.players = [
      s.players[0], // Chancellor
      s.players[1], // the attacking Exile
      s.players[2],
      structuredClone(s.players[2]),
      structuredClone(s.players[2]),
      structuredClone(s.players[2]),
    ].map((p) => structuredClone(p));
    for (const site2 of s.sites) site2.warbands = Array.from({ length: 6 }, () => 0);

    // Seats 2-5 are Citizens with their pawns at the contested site, which
    // is §5.5.2's eligibility test; seat 0 defends, seat 1 attacks.
    s.players[0].citizenship = 'chancellor';
    s.players[0].pawnSite = site;
    s.players[0].warbands = { bank: 4, board: 4 };
    s.players[0].relics = [];
    s.players[1].citizenship = 'exile';
    s.players[1].pawnSite = site;
    s.players[1].warbands = { bank: 10, board: 4 };
    s.players[1].relics = [];
    s.players[1].vision = null;
    for (const seat of [2, 3, 4, 5]) {
      s.players[seat].citizenship = 'citizen';
      s.players[seat].pawnSite = site;
      s.players[seat].warbands = { bank: 0, board: 4 }; // purple: 4 + 4*4 = 20, + bank 4 = 24
      s.players[seat].relics = [];
      s.players[seat].vision = null;
      s.players[seat].advisers = [];
      s.players[seat].hand = [];
      s.players[seat].secrets = { ready: 0, flipped: 0 };
    }
    s.sites[5].warbands[1] = 2;
    s.players[1].warbands.bank = 8;
    s.turn.activeSeat = 1;
    s.oathkeeper = 0;
    s.usurper = false;

    // Favor is component-limited (Law §1.4/§9.3), and cloning seat 2 into
    // three more seats duplicated their favor along with everything else.
    // Rebalance the shared bank so the total is exactly TOTAL_FAVOR again.
    const placed =
      Object.values(s.favorBanks).reduce((a, b) => a + b, 0) +
      s.players.reduce((a, p) => a + p.favor, 0) +
      s.sites.reduce((a, x) => a + x.favor, 0) +
      s.banners.reduce((a, b) => a + b.tokens, 0) -
      s.banners[1].tokens; // the Darkest Secret holds secrets, not favor
    s.sharedBank.favor = TOTAL_FAVOR - placed;
    checkInvariants(s);
    return s;
  }
  const declaration = { defender: 0, targets: [{ kind: 'pawnFavor' }], attackDice: 2 };

  it('opens and closes the join window inside declare alone, raising nothing', () => {
    let s = sixSeats();
    // Every Citizen sets the policy (four ordinary logged actions).
    for (const seat of [2, 3, 4, 5]) s = act(s, 'standing.set', seat, { ally: 'pass' });
    checkInvariants(s);

    const declared = act(s, 'campaign.declare', 1, declaration);
    checkInvariants(declared);
    expect(declared.campaign!.allyEligible).toEqual([2, 3, 4, 5]); // all four WERE eligible
    expect(declared.campaign!.allyAnswered).toEqual([2, 3, 4, 5]); // ...and all four answered
    expect(declared.campaign!.allyVolunteers).toEqual([]);
    expect(declared.campaign!.phase).toBe('respond'); // straight past join AND permit

    // Not one ally decision was ever raised.
    expect(oath.pending(declared).filter((d) => d.resolves.includes('campaign.ally'))).toEqual([]);
    expect(oath.pending(declared)).toHaveLength(1);
    expect(oath.pending(declared)[0]).toMatchObject({ seat: 0, resolves: ['campaign.respond'] });
  });

  it('one Citizen who still asks keeps the window open for exactly that seat', () => {
    let s = sixSeats();
    for (const seat of [2, 3, 5]) s = act(s, 'standing.set', seat, { ally: 'pass' });
    const declared = act(s, 'campaign.declare', 1, declaration);
    checkInvariants(declared);
    expect(declared.campaign!.phase).toBe('join');
    const owed = oath.pending(declared).filter((d) => d.resolves.includes('campaign.ally'));
    expect(owed).toHaveLength(1);
    expect(owed[0].seat).toBe(4);

    // Their answer alone closes it — and joining raises the permit window.
    const joined = act(declared, 'campaign.ally', 4, { join: true });
    expect(joined.campaign!.phase).toBe('permit');
    expect(joined.campaign!.allyVolunteers).toEqual([4]);
  });
});
