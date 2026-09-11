import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// db.ts reads DB_PATH at import time, so this must be set first.
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'oath-')), 'test.db');

let store: typeof import('../src/actionlog.js');
let cradle: typeof import('../src/engine/cradle.js')['cradle'];
let db: typeof import('../src/db.js')['db'];
let StaleSeq: typeof import('../src/engine/types.js')['StaleSeq'];
let IllegalAction: typeof import('../src/engine/types.js')['IllegalAction'];

beforeAll(async () => {
  store = await import('../src/actionlog.js');
  ({ cradle } = await import('../src/engine/cradle.js'));
  ({ db } = await import('../src/db.js'));
  ({ StaleSeq, IllegalAction } = await import('../src/engine/types.js'));
});

/** Play a short scripted game so the tests below have a real log to chew on. */
function playScriptedGame() {
  const { gameId } = store.createGame(cradle, ['ben', 'friend', 'other']);
  let seq = store.headSeq(gameId);

  const act = (seat: number, type: string, payload: unknown = {}) => {
    const r = store.appendAction(cradle, gameId, seq, { type, actor: seat, payload });
    seq = r.seq;
    return r;
  };

  act(0, 'draw');
  act(1, 'roll');
  act(2, 'draw');
  act(0, 'roll');

  // Seat 1 offers a card; the turn does not advance until seat 2 answers.
  const hand1 = (store.loadState(cradle, gameId).state as any).hands[1] as string[];
  act(1, 'gift', { to: 2, card: hand1[0] });
  act(2, 'gift.accept');

  return { gameId, seq };
}

describe('replay', () => {
  it('is deterministic: folding the same log twice gives the same state', () => {
    const { gameId } = playScriptedGame();
    const a = store.loadState(cradle, gameId).state;
    const b = store.loadState(cradle, gameId).state;
    expect(a).toEqual(b);
    // Randomness actually happened, so this is a real test and not a
    // tautology. Asserted on the rolls being RECORDED rather than on what
    // they came up: the cradle die has two blank faces, so a two-dice roll
    // legitimately gains 0 favor about 1 time in 9, and asserting
    // `favor > 0` failed roughly 1 run in 80.
    const rolls = (a as any).log.filter((line: string) => line.includes('rolled'));
    expect(rolls).toHaveLength(2);
  });

  it('folds identically with and without a snapshot', () => {
    const { gameId, seq } = playScriptedGame();
    const full = store.loadState(cradle, gameId).state;

    // Plant a mid-log snapshot, then reload: the fold now starts from it.
    const mid = 3;
    const midState = store.loadState(cradle, gameId, mid).state;
    db.prepare('INSERT OR REPLACE INTO snapshots (game_id, seq, state) VALUES (?, ?, ?)').run(
      gameId,
      mid,
      JSON.stringify(midState),
    );

    const fromSnapshot = store.loadState(cradle, gameId);
    expect(fromSnapshot.seq).toBe(seq);
    expect(fromSnapshot.state).toEqual(full);
  });

  it('rebuilds the same state after snapshots are wiped', () => {
    const { gameId } = playScriptedGame();
    const before = store.loadState(cradle, gameId).state;
    db.prepare('DELETE FROM snapshots WHERE game_id = ?').run(gameId);
    expect(store.loadState(cradle, gameId).state).toEqual(before);
  });
});

describe('concurrency', () => {
  it('rejects an action computed against stale state', () => {
    const { gameId, seq } = playScriptedGame();
    expect(() =>
      store.appendAction(cradle, gameId, seq - 1, { type: 'draw', actor: 0, payload: {} }),
    ).toThrow(StaleSeq);
  });

  it('does not persist an illegal action', () => {
    const { gameId, seq } = playScriptedGame();
    // The scripted game leaves the turn with seat 2, so seat 1 is out of turn.
    expect(() =>
      store.appendAction(cradle, gameId, seq, { type: 'draw', actor: 1, payload: {} }),
    ).toThrow(IllegalAction);
    expect(store.headSeq(gameId)).toBe(seq);
  });
});

describe('the action log', () => {
  it('leaks no hidden information', () => {
    const { gameId } = playScriptedGame();
    const { state } = store.loadState(cradle, gameId);
    const log = JSON.stringify(store.history(gameId));

    // Deck order lives in `setups`, which is never part of the log.
    for (const card of (state as any).deck) {
      expect(log).not.toContain(card);
    }
  });

  it('persists dice results so replay reuses them', () => {
    const { gameId } = playScriptedGame();
    const roll = store.history(gameId).find((a) => a.type === 'roll');
    expect(Array.isArray((roll?.payload as any)?.dice)).toBe(true);

    const favorBefore = [...(store.loadState(cradle, gameId).state as any).favor];
    db.prepare('DELETE FROM snapshots WHERE game_id = ?').run(gameId);
    const favorAfter = (store.loadState(cradle, gameId).state as any).favor;
    expect(favorAfter).toEqual(favorBefore);
  });
});

describe('hidden information', () => {
  it('redacts other seats hands and the deck order', () => {
    const { gameId } = playScriptedGame();
    const { state } = store.loadState(cradle, gameId);
    const view = cradle.project(state, 0) as any;

    expect(Array.isArray(view.hands[0])).toBe(true);
    expect(view.hands[1]).toEqual({ count: (state as any).hands[1].length });
    expect(view.deck).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain((state as any).deck[0]);
  });
});

describe('rollback', () => {
  it('restores the exact prior state', () => {
    const { gameId } = playScriptedGame();
    const target = 3;
    const expected = store.loadState(cradle, gameId, target).state;

    store.rollback(gameId, target);

    expect(store.headSeq(gameId)).toBe(target);
    expect(store.loadState(cradle, gameId).state).toEqual(expected);
  });
});

describe('pending decisions', () => {
  it('routes a pending gift to the recipient, not the active player', () => {
    const { gameId } = store.createGame(cradle, ['a', 'b', 'c']);
    let seq = store.headSeq(gameId);
    const hand0 = (store.loadState(cradle, gameId).state as any).hands[0] as string[];
    seq = store.appendAction(cradle, gameId, seq, {
      type: 'gift',
      actor: 0,
      payload: { to: 2, card: hand0[0] },
    }).seq;

    const { state } = store.loadState(cradle, gameId);
    const pending = cradle.pending(state);
    expect(pending).toHaveLength(1);
    expect(pending[0].seat).toBe(2);
    expect(pending[0].kind).toBe('gift');
    // And the game is frozen for everyone else meanwhile.
    expect(() =>
      store.appendAction(cradle, gameId, seq, { type: 'draw', actor: 0, payload: {} }),
    ).toThrow(IllegalAction);
  });
});
