import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expectHidden } from './helpers.js';

// db.ts reads DB_PATH at import time, so this must be set first (mirrors
// replay.test.ts's own pattern).
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'oath-turn-')), 'test.db');

let store: typeof import('../../../src/actionlog.js');
let db: typeof import('../../../src/db.js')['db'];
let oath: typeof import('../../../src/oath/game/index.js')['oath'];
let StaleSeq: typeof import('../../../src/engine/types.js')['StaleSeq'];
let IllegalAction: typeof import('../../../src/engine/types.js')['IllegalAction'];
let checkInvariants: typeof import('../../../src/oath/game/state.js')['checkInvariants'];

beforeAll(async () => {
  store = await import('../../../src/actionlog.js');
  ({ db } = await import('../../../src/db.js'));
  ({ oath } = await import('../../../src/oath/game/index.js'));
  ({ StaleSeq, IllegalAction } = await import('../../../src/engine/types.js'));
  ({ checkInvariants } = await import('../../../src/oath/game/state.js'));
});

// FIRST_GAME is fixed at 4 seats (unit 4).
function createFirstGame() {
  return store.createGame(oath, ['Chancellor', 'Red', 'Blue', 'Yellow']);
}

/** Replaces the head state via a snapshot, mirroring replay.test.ts's trick. */
function forceState(gameId: string, state: unknown): void {
  const seq = store.headSeq(gameId);
  db.prepare('INSERT OR REPLACE INTO snapshots (game_id, seq, state) VALUES (?, ?, ?)').run(
    gameId,
    seq,
    JSON.stringify(state),
  );
}

describe('turn.rest', () => {
  it('is legal for the active seat and advances activeSeat (Law §4)', () => {
    const { gameId } = createFirstGame();
    const seq = store.headSeq(gameId);
    const before = store.loadState(oath, gameId).state as any;
    expect(before.turn.activeSeat).toBe(0);

    const r = store.appendAction(oath, gameId, seq, {
      type: 'turn.rest',
      actor: 0,
      payload: {},
    });
    expect((r.state as any).turn.activeSeat).toBe(1);
    checkInvariants(r.state as any);
  });

  it('is illegal for a seat other than the active one', () => {
    const { gameId } = createFirstGame();
    const seq = store.headSeq(gameId);
    expect(() =>
      store.appendAction(oath, gameId, seq, { type: 'turn.rest', actor: 1, payload: {} }),
    ).toThrow(IllegalAction);
  });

  it('is illegal once the game is complete', () => {
    const { gameId } = createFirstGame();
    const { state } = store.loadState(oath, gameId);
    forceState(gameId, { ...(state as any), complete: true });
    const seq = store.headSeq(gameId);
    expect(() =>
      store.appendAction(oath, gameId, seq, { type: 'turn.rest', actor: 0, payload: {} }),
    ).toThrow(IllegalAction);
  });

  it("wraps activeSeat back to 0 and advances the round (Law §4: 'once each player has taken a turn, the round ends')", () => {
    const { gameId } = createFirstGame();
    let seq = store.headSeq(gameId);
    for (let seat = 0; seat < 4; seat++) {
      const r = store.appendAction(oath, gameId, seq, {
        type: 'turn.rest',
        actor: seat,
        payload: {},
      });
      seq = r.seq;
    }
    const { state } = store.loadState(oath, gameId);
    expect((state as any).turn.activeSeat).toBe(0);
    expect((state as any).turn.round).toBe(2);
  });

  it('refreshes supply to the leftmost space on the very first rest (Law §4.3.3-4.3.4)', () => {
    // Nothing has been spent yet, so "Save Supply" (§4.3.4) adds the full
    // starting value back on top of the §4.3.3 bracket, capping at the
    // leftmost space (7) for both the Chancellor and an Exile.
    const { gameId } = createFirstGame();
    let seq = store.headSeq(gameId);
    for (let seat = 0; seat < 4; seat++) {
      const r = store.appendAction(oath, gameId, seq, {
        type: 'turn.rest',
        actor: seat,
        payload: {},
      });
      seq = r.seq;
    }
    const { state } = store.loadState(oath, gameId);
    for (const p of (state as any).players) expect(p.supply).toBe(7);
  });

  it('applies the warband-bracket refresh distinctly from the Save Supply cap (Law §4.3.3)', () => {
    const { gameId } = createFirstGame();
    const { state } = store.loadState(oath, gameId);
    const s = state as any;
    // Chancellor: drop supply to 0 (as if fully spent) and set the bank to
    // 2 warbands, landing in the "3 to 0" bracket -> refresh target 3.
    s.players[0].supply = 0;
    s.players[0].warbands.bank = 2;
    forceState(gameId, s);
    const seq = store.headSeq(gameId);
    const r = store.appendAction(oath, gameId, seq, {
      type: 'turn.rest',
      actor: 0,
      payload: {},
    });
    expect((r.state as any).players[0].supply).toBe(3);
  });

  it("a Citizen's refresh copies the Chancellor's current Supply, ignoring their own warbands (Law §4.3.3)", () => {
    const { gameId } = createFirstGame();
    const { state } = store.loadState(oath, gameId);
    const s = state as any;
    s.players[0].supply = 5; // whatever the Chancellor currently holds
    s.players[1].citizenship = 'citizen';
    s.players[1].supply = 0;
    s.players[1].warbands.bank = 999; // must be ignored entirely for a Citizen
    forceState(gameId, s);
    const seq = store.headSeq(gameId);
    const r = store.appendAction(oath, gameId, seq, {
      type: 'turn.rest',
      actor: 0,
      payload: {},
    }); // seat 0 rests first so it's seat 1's turn
    const seq2 = r.seq;
    const r2 = store.appendAction(oath, gameId, seq2, {
      type: 'turn.rest',
      actor: 1,
      payload: {},
    });
    expect((r2.state as any).players[1].supply).toBe((r.state as any).players[0].supply);
  });

  it('returns favor on cards to the matching suit bank (Law §4.3.1)', async () => {
    const { byId } = await import('../../../src/oath/cards/index.js');
    const { gameId } = createFirstGame();
    const { state } = store.loadState(oath, gameId);
    const s = state as any;
    const site = s.sites.find((site: any) => site.cards.some((c: any) => c !== null));
    const card = site.cards.find((c: any) => c !== null);
    const suit = (byId(card.id) as any).suit;
    card.favor = 1;
    s.favorBanks[suit] -= 1; // source the token from its own bank, keeping the total conserved
    forceState(gameId, s);
    const seq = store.headSeq(gameId);
    const r = store.appendAction(oath, gameId, seq, {
      type: 'turn.rest',
      actor: 0,
      payload: {},
    });
    const after = r.state as any;
    const returnedCard = after.sites
      .find((x: any) => x.id === site.id)
      .cards.find((c: any) => c?.id === card.id);
    expect(returnedCard.favor).toBe(0);
    expect(after.favorBanks[suit]).toBe(s.favorBanks[suit] + 1);
    checkInvariants(after);
  });

  it("flips the resting player's spent secrets back up (Law §4.3.2)", () => {
    const { gameId } = createFirstGame();
    const { state } = store.loadState(oath, gameId);
    const s = state as any;
    s.players[0].secrets = { ready: 0, flipped: 1 };
    forceState(gameId, s);
    const seq = store.headSeq(gameId);
    const r = store.appendAction(oath, gameId, seq, {
      type: 'turn.rest',
      actor: 0,
      payload: {},
    });
    expect((r.state as any).players[0].secrets).toEqual({ ready: 1, flipped: 0 });
  });
});

describe('pending', () => {
  it('returns exactly one decision for the active seat with a stable id that changes after the turn passes', () => {
    const { gameId } = createFirstGame();
    const { state } = store.loadState(oath, gameId);
    const p1 = oath.pending(state);
    expect(p1).toHaveLength(1);
    expect(p1[0].seat).toBe(0);
    expect(p1[0].kind).toBe('turn');
    expect(p1[0].resolves).toContain('turn.rest');
    expect(p1[0].resolves).not.toContain('game.created');

    // stable across repeated polls of the same state
    const { state: reloaded } = store.loadState(oath, gameId);
    expect(oath.pending(reloaded)[0].id).toBe(p1[0].id);

    // changes once the turn actually passes
    const seq = store.headSeq(gameId);
    store.appendAction(oath, gameId, seq, { type: 'turn.rest', actor: 0, payload: {} });
    const { state: next } = store.loadState(oath, gameId);
    const p2 = oath.pending(next);
    expect(p2).toHaveLength(1);
    expect(p2[0].seat).toBe(1);
    expect(p2[0].id).not.toBe(p1[0].id);
  });
});

describe('project', () => {
  it("shows the viewer's own hand as ids but redacts other seats to a count", () => {
    const { gameId } = createFirstGame();
    const { state } = store.loadState(oath, gameId);
    const s = state as any;
    s.players[0].hand = ['denizen:x', 'denizen:y'];
    const view0 = oath.project(s, 0) as any;
    const view1 = oath.project(s, 1) as any;
    expect(view0.players[0].hand).toEqual(['denizen:x', 'denizen:y']);
    expect(view1.players[0].hand).toEqual({ count: 2 });
    expectHidden(view1, 'denizen:x');
  });

  it('redacts a facedown adviser identity for other seats but not the owner', () => {
    const { gameId } = createFirstGame();
    const { state } = store.loadState(oath, gameId);
    const trueId = (state as any).players[1].advisers[0].id;
    const viewSelf = oath.project(state, 1) as any;
    const viewOther = oath.project(state, 0) as any;
    expect(viewSelf.players[1].advisers[0].id).toBe(trueId);
    expect(viewOther.players[1].advisers[0].id).toBeNull();
    expect(viewOther.players[1].advisers[0].facedown).toBe(true);
    expectHidden(viewOther, trueId);
  });

  it('hides the world deck entirely, including its size (Law §9.4: deck count is private)', () => {
    const { gameId } = createFirstGame();
    const { state } = store.loadState(oath, gameId);
    const view = oath.project(state, 0) as any;
    expect((state as any).worldDeck.length).toBeGreaterThan(0); // sanity
    expect(JSON.stringify(view.worldDeck)).not.toMatch(/[0-9]/);
    for (const id of (state as any).worldDeck) {
      expectHidden(view, id);
    }
  });

  it('shows discard pile counts (public, Law §9.4) but never their card identities', () => {
    const { gameId } = createFirstGame();
    const { state } = store.loadState(oath, gameId);
    const view = oath.project(state, 0) as any;
    for (const region of ['cradle', 'provinces', 'hinterland'] as const) {
      expect(view.discards[region].count).toBe((state as any).discards[region].length);
      for (const id of (state as any).discards[region]) {
        expectHidden(view, id);
      }
    }
  });

  it('a spectator (seat null) sees no private information at all', () => {
    const { gameId } = createFirstGame();
    const { state } = store.loadState(oath, gameId);
    const trueId = (state as any).players[0].advisers[0].id;
    const view = oath.project(state, null) as any;
    expect(view.players[0].hand).toEqual({ count: 0 });
    expect(view.players[0].advisers[0].id).toBeNull();
    expectHidden(view, trueId);
  });

  it('passes public numbers through unchanged (favor banks, warbands, supply)', () => {
    const { gameId } = createFirstGame();
    const { state } = store.loadState(oath, gameId);
    const s = state as any;
    const view = oath.project(s, null) as any;
    expect(view.favorBanks).toEqual(s.favorBanks);
    expect(view.players[0].supply).toBe(s.players[0].supply);
    expect(view.players[0].warbands).toEqual(s.players[0].warbands);
  });
});

describe('through the storage layer (in-process, like P0)', () => {
  it('creates a kind-oath game; views differ by seat; rest advances seq; stale replay 409s', () => {
    const { gameId, players } = store.createGame(oath, [
      'Chancellor',
      'Red',
      'Blue',
      'Yellow',
    ]);
    expect(players).toHaveLength(4);
    const seq0 = store.headSeq(gameId);
    expect(seq0).toBe(0);

    const rawState = store.loadState(oath, gameId).state;
    const viewA = oath.project(rawState, 0);
    const viewB = oath.project(rawState, 1);
    expect(viewA).not.toEqual(viewB);

    const r = store.appendAction(oath, gameId, seq0, {
      type: 'turn.rest',
      actor: 0,
      payload: {},
    });
    expect(r.seq).toBe(seq0 + 1);

    expect(() =>
      store.appendAction(oath, gameId, seq0, { type: 'turn.rest', actor: 0, payload: {} }),
    ).toThrow(StaleSeq);
  });
});
