/**
 * Unit 3 of Phase 4: Law §6.3/§6.4, the Peek family.
 *
 * `peek.relic` (§6.3) and `peek.reliquary` (§6.4) are the first actions
 * that produce KNOWLEDGE rather than board state — see `peek.ts`'s header
 * for the design (slot addressing, D60's payload-never-carries-the-id,
 * permanence via `PlayerState.peeked`, unit 2's shape).
 */

import { describe, it, expect } from 'vitest';
import { oath } from '../../../src/oath/game/index.js';
import { project } from '../../../src/oath/game/project.js';
import { checkInvariants, type OathState } from '../../../src/oath/game/state.js';
import { IllegalAction, type GameAction } from '../../../src/engine/types.js';
import { baseState, containsId, expectHidden } from './helpers.js';

function act(state: OathState, actor: number | null, type: string, payload: unknown = {}): OathState {
  const action: GameAction = {
    gameId: 'test',
    seq: state.actionCount + 1,
    type,
    actor,
    payload,
    createdAt: '2026-09-13T00:00:00.000Z',
  };
  return oath.reduce(state, action);
}

// baseState: seat 1 active, pawn at sites[5] (no relic there); sites[1]
// holds one relic. seat 2 pawn at sites[2]; grandScepter defaults to 0.

describe('peek.relic (Law §6.3)', () => {
  it('reveals exactly one id to exactly one seat — every other seat and a spectator still see null', () => {
    const s = baseState();
    s.players[1].pawnSite = s.sites[1].id; // move seat 1 onto the relic's site
    const relic = s.sites[1].relics[0];

    const out = act(s, 1, 'peek.relic', { relicIndex: 0 });
    checkInvariants(out);
    expect(out.players[1].peeked).toEqual([relic]);

    const mine = project(out, 1);
    expect(mine.sites[1].relics[0]).toEqual({ id: relic });
    for (const seat of [0, 2, null]) {
      expect(project(out, seat).sites[1].relics[0]).toEqual({ id: null });
      expectHidden(project(out, seat), relic);
    }
  });

  it('is illegal-state with no relics at your site (out-of-range index)', () => {
    const s = baseState();
    // seat 1's pawn is at sites[5], which has none.
    expect(s.sites[5].relics).toHaveLength(0);
    expect(() => act(s, 1, 'peek.relic', { relicIndex: 0 })).toThrow(IllegalAction);
  });

  it('an out-of-range index and a relic-free site share the SAME message (unit-1 style)', () => {
    const s = baseState();
    s.players[1].pawnSite = s.sites[1].id; // one relic, slot 0
    let outOfRange = '';
    let onEmptySite = '';
    try {
      act(s, 1, 'peek.relic', { relicIndex: 1 });
    } catch (e) {
      outOfRange = (e as Error).message;
    }
    const empty = baseState(); // seat 1's site has none
    try {
      act(empty, 1, 'peek.relic', { relicIndex: 0 });
    } catch (e) {
      onEmptySite = (e as Error).message;
    }
    expect(outOfRange).toMatch(/no facedown relic at slot/);
    expect(onEmptySite).toMatch(/no facedown relic at slot/);
  });

  it('is illegal for a non-active seat', () => {
    const s = baseState();
    s.players[2].pawnSite = s.sites[1].id;
    expect(() => act(s, 2, 'peek.relic', { relicIndex: 0 })).toThrow(IllegalAction);
  });

  it('re-peeking the same relic is legal and idempotent — the set does not grow', () => {
    const s = baseState();
    s.players[1].pawnSite = s.sites[1].id;
    const once = act(s, 1, 'peek.relic', { relicIndex: 0 });
    const twice = act(once, 1, 'peek.relic', { relicIndex: 0 });
    checkInvariants(twice);
    expect(twice.players[1].peeked).toEqual(once.players[1].peeked);
    expect(twice.players[1].peeked).toHaveLength(1);
  });

  it('costs no Supply and does not advance the turn (Law §6\'s opening line)', () => {
    const s = baseState();
    s.players[1].pawnSite = s.sites[1].id;
    const before = s.players[1].supply;
    const out = act(s, 1, 'peek.relic', { relicIndex: 0 });
    expect(out.players[1].supply).toBe(before);
    expect(out.turn.activeSeat).toBe(1);
  });

  it('raises no pending decision — peek resolves the ordinary turn decision like any other minor action', () => {
    const s = baseState();
    s.players[1].pawnSite = s.sites[1].id;
    const before = oath.pending(s);
    const out = act(s, 1, 'peek.relic', { relicIndex: 0 });
    const after = oath.pending(out);
    expect(after).toEqual(before);
  });

  it('is illegal once the game is complete', () => {
    const s = baseState();
    s.players[1].pawnSite = s.sites[1].id;
    s.complete = true;
    expect(() => act(s, 1, 'peek.relic', { relicIndex: 0 })).toThrow(IllegalAction);
  });
});

describe('peek.reliquary (Law §6.4)', () => {
  it('reveals the named spaces and no others, only to the Grand Scepter holder', () => {
    const s = baseState();
    s.turn.activeSeat = 0;
    expect(s.grandScepter).toBe(0);
    const spaceZeroRelic = s.reliquary[0].relicId!;
    const spaceTwoRelic = s.reliquary[2].relicId!;

    const out = act(s, 0, 'peek.reliquary', { spaces: [0, 2] });
    checkInvariants(out);
    expect(out.players[0].peeked).toEqual([spaceTwoRelic, spaceZeroRelic].sort());

    const mine = project(out, 0);
    expect(mine.reliquary[0].id).toBe(spaceZeroRelic);
    expect(mine.reliquary[2].id).toBe(spaceTwoRelic);
    // Spaces 1 and 3 were NOT named — still hidden, even to the peeker.
    expect(mine.reliquary[1].id).toBeNull();
    expect(mine.reliquary[3].id).toBeNull();

    for (const seat of [1, 2, null]) {
      const view = project(out, seat);
      expect(view.reliquary[0].id).toBeNull();
      expect(view.reliquary[2].id).toBeNull();
      expectHidden(view, spaceZeroRelic);
      expectHidden(view, spaceTwoRelic);
    }
  });

  it('is illegal-actor without the Grand Scepter', () => {
    const s = baseState();
    s.turn.activeSeat = 1;
    expect(s.grandScepter).toBe(0);
    expect(() => act(s, 1, 'peek.reliquary', { spaces: [0] })).toThrow(IllegalAction);
  });

  it('is illegal-state for an out-of-range space index', () => {
    const s = baseState();
    s.turn.activeSeat = 0;
    expect(() => act(s, 0, 'peek.reliquary', { spaces: [4] })).toThrow(IllegalAction);
  });

  it('is illegal-state for an uncovered space, with a distinct message (covered is already public, so this is not an oracle)', () => {
    const s = baseState();
    s.turn.activeSeat = 0;
    s.reliquary[1].relicId = null; // already taken
    expect(() => act(s, 0, 'peek.reliquary', { spaces: [1] })).toThrow(/uncovered/);
  });

  it('rejects the whole batch atomically — one bad space fails the lot, nothing peeked', () => {
    const s = baseState();
    s.turn.activeSeat = 0;
    s.reliquary[1].relicId = null;
    expect(() => act(s, 0, 'peek.reliquary', { spaces: [0, 1] })).toThrow(IllegalAction);
  });

  it('re-peeking is idempotent, batched with a fresh space in the same action', () => {
    const s = baseState();
    s.turn.activeSeat = 0;
    const once = act(s, 0, 'peek.reliquary', { spaces: [0] });
    const twice = act(once, 0, 'peek.reliquary', { spaces: [0, 3] });
    checkInvariants(twice);
    expect(twice.players[0].peeked).toHaveLength(2);
    expect(twice.players[0].peeked).toContain(s.reliquary[0].relicId);
    expect(twice.players[0].peeked).toContain(s.reliquary[3].relicId);
  });

  it('raises no pending decision', () => {
    const s = baseState();
    s.turn.activeSeat = 0;
    const before = oath.pending(s);
    const out = act(s, 0, 'peek.reliquary', { spaces: [0] });
    expect(oath.pending(out)).toEqual(before);
  });
});

describe('permanence (Law §6.3\'s parenthetical: "you may peek at it again from any site")', () => {
  it('a relic peeked at your site stays visible after you travel away', () => {
    const s = baseState();
    s.players[1].pawnSite = s.sites[1].id;
    const relic = s.sites[1].relics[0];
    const peeked = act(s, 1, 'peek.relic', { relicIndex: 0 });

    const traveled = act(peeked, 1, 'travel', { siteIndex: 6 });
    checkInvariants(traveled);
    expect(traveled.players[1].peeked).toEqual([relic]);
    expect(project(traveled, 1).sites[1].relics[0]).toEqual({ id: relic });
    // Still hidden from everyone else, unchanged by the travel.
    for (const seat of [0, 2, null]) {
      expect(project(traveled, seat).sites[1].relics[0]).toEqual({ id: null });
    }
  });

  it('a relic peeked in the Reliquary stays visible if it later moves to a site (any future mover) — the memory tracks the ID, not the zone', () => {
    // No action in P4 unit 3 relocates a Reliquary relic, so this is
    // exercised directly against state: peeked is keyed on the id alone,
    // and project.ts's gate (`peeked.has(id)`) is checked against
    // WHATEVER zone the id currently occupies — a site's relics array
    // here, a Reliquary space there, unconditionally on identity.
    const s = baseState();
    s.turn.activeSeat = 0;
    const relic = s.reliquary[0].relicId!;
    const peeked = act(s, 0, 'peek.reliquary', { spaces: [0] });

    const moved = structuredClone(peeked);
    moved.reliquary[0].relicId = null;
    moved.sites[5].relics.push(relic); // relocate it "by hand"
    checkInvariants(moved);

    expect(project(moved, 0).sites[5].relics.at(-1)).toEqual({ id: relic });
    expect(project(moved, 0).reliquary[0].id).toBeNull(); // the space itself is empty now
  });

  it('never appears identity-wise in relicDeck, even for a seat who has peeked other relics', () => {
    const s = baseState();
    s.players[1].pawnSite = s.sites[1].id;
    const out = act(s, 1, 'peek.relic', { relicIndex: 0 });
    const view = project(out, 1);
    expect(Object.keys(view.relicDeck)).toEqual(['count']);
  });
});

describe('D60 — the payload never carries the peeked relic id', () => {
  it('serializing the whole action log after a game containing both peeks never contains a peeked relic id', () => {
    const relicSite = baseState();
    relicSite.players[1].pawnSite = relicSite.sites[1].id;
    const siteRelic = relicSite.sites[1].relics[0];

    const reliquarySeat = baseState();
    reliquarySeat.turn.activeSeat = 0;
    const reliquaryRelic = reliquarySeat.reliquary[0].relicId!;

    const actions: GameAction[] = [];
    const record = (state: OathState, actor: number | null, type: string, payload: unknown = {}): OathState => {
      const action: GameAction = {
        gameId: 'test',
        seq: state.actionCount + 1,
        type,
        actor,
        payload,
        createdAt: '2026-09-13T00:00:00.000Z',
      };
      actions.push(action);
      return oath.reduce(state, action);
    };

    const afterRelic = record(relicSite, 1, 'peek.relic', { relicIndex: 0 });
    const afterReliquary = record(reliquarySeat, 0, 'peek.reliquary', { spaces: [0] });
    checkInvariants(afterRelic);
    checkInvariants(afterReliquary);
    expect(afterRelic.players[1].peeked).toEqual([siteRelic]);
    expect(afterReliquary.players[0].peeked).toEqual([reliquaryRelic]);

    const serializedLog = JSON.stringify(actions);
    expect(serializedLog).not.toContain(siteRelic);
    expect(serializedLog).not.toContain(reliquaryRelic);
    // The payloads really are index-only, not merely id-free by accident.
    expect(actions.find((a) => a.type === 'peek.relic')!.payload).toEqual({ relicIndex: 0 });
    expect(actions.find((a) => a.type === 'peek.reliquary')!.payload).toEqual({ spaces: [0] });
  });
});

describe('the audit, over a short game containing peeks', () => {
  it('shows a peeked id to the peeking seat alone, at every subsequent step', () => {
    const s = baseState();
    s.players[1].pawnSite = s.sites[1].id;
    const relic = s.sites[1].relics[0];

    let working = act(s, 1, 'peek.relic', { relicIndex: 0 });
    working = act(working, 1, 'turn.rest');
    working = act(working, 2, 'travel', { siteIndex: 6 }); // an unrelated action by another seat
    checkInvariants(working);

    expect(containsId(project(working, 1), relic)).toBe(true);
    for (const seat of [0, 2, null]) {
      expectHidden(project(working, seat), relic);
    }
  });
});
