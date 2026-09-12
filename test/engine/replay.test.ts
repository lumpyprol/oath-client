/**
 * The store's guarantees (`src/actionlog.ts`): deterministic replay,
 * snapshots as a disposable cache, optimistic concurrency, rollback, and
 * pending decisions that can block on a seat who is not the active player.
 *
 * These are properties of the ENGINE, not of any game, so this file brings
 * its own toy definition rather than reaching for a real one. That is the
 * whole point of the exercise: if the only game the store is ever tested
 * against is Oath, "the store works" and "Oath works" stop being separable,
 * and a store bug reads as a rules bug.
 *
 * The toy used to live in `src/engine/cradle.ts` and shipped in the server's
 * `DEFS` registry, which meant production could create games of a fake game.
 * Unit 20 deleted it; it survives here, in test scope, where it belongs.
 *
 * It is deliberately tiny and deliberately NOT Oath. What it has to have is
 * one of each thing the store cares about:
 *   - hidden information (private hands, a deck whose order never ships)
 *   - a shuffle at setup, stored explicitly rather than reseeded on replay
 *   - dice rolled in `prepare`, persisted into the payload (HLD D14)
 *   - a pending decision that blocks on a non-active seat
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  IllegalAction as IllegalActionClass,
  type GameAction,
  type GameDefinition,
  type PendingDecision,
  type ProposedAction,
} from '../../src/engine/types.js';
import { rollDice, shuffle } from '../../src/engine/random.js';

// db.ts reads DB_PATH at import time, so this must be set first.
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'oath-replay-')), 'test.db');

let store: typeof import('../../src/actionlog.js');
let db: typeof import('../../src/db.js')['db'];
let StaleSeq: typeof import('../../src/engine/types.js')['StaleSeq'];
let IllegalAction: typeof import('../../src/engine/types.js')['IllegalAction'];

beforeAll(async () => {
  store = await import('../../src/actionlog.js');
  ({ db } = await import('../../src/db.js'));
  ({ StaleSeq, IllegalAction } = await import('../../src/engine/types.js'));
});

// ---------------------------------------------------------------------------
// The toy game
// ---------------------------------------------------------------------------

const DIE_FACES = [0, 0, 1, 1, 2, 3] as const;
const ROUNDS = 3;

interface ToySetup {
  seats: number;
  /** Full deck order, decided once. Never leaves the server. */
  deck: string[];
}

interface ToyState {
  seats: number;
  turn: number;
  round: number;
  deck: string[];
  discard: string[];
  hands: string[][];
  favor: number[];
  pendingGift: { from: number; to: number; card: string } | null;
  log: string[];
  complete: boolean;
}

function requireActor(action: GameAction): number {
  if (action.actor === null) throw new IllegalActionClass(`${action.type} requires a seated actor`);
  return action.actor;
}

function endTurn(s: ToyState): void {
  s.turn = (s.turn + 1) % s.seats;
  if (s.turn === 0) s.round += 1;
  if (s.round > ROUNDS) s.complete = true;
}

const toy: GameDefinition<ToyState, ToySetup> = {
  kind: 'toy',

  setup(seats) {
    return {
      seats,
      deck: shuffle(Array.from({ length: 24 }, (_, i) => `card-${String(i + 1).padStart(2, '0')}`)),
    };
  },

  init(setup) {
    const deck = setup.deck.slice();
    const hands: string[][] = [];
    for (let i = 0; i < setup.seats; i++) hands.push([deck.pop()!, deck.pop()!]);
    return {
      seats: setup.seats,
      turn: 0,
      round: 1,
      deck,
      discard: [],
      hands,
      favor: new Array(setup.seats).fill(0),
      pendingGift: null,
      log: ['game created'],
      complete: false,
    };
  },

  prepare(_state, proposed: ProposedAction) {
    // The only action that consumes randomness. Roll now and persist the
    // result, so every later replay reuses these exact dice (HLD D14).
    if (proposed.type === 'roll') {
      return { ...(proposed.payload as object), dice: rollDice(DIE_FACES, 2) };
    }
    return proposed.payload;
  },

  reduce(s, action) {
    if (s.complete) throw new IllegalActionClass('game is already complete');
    if (s.pendingGift && !['gift.accept', 'gift.decline'].includes(action.type)) {
      throw new IllegalActionClass('waiting on a gift response');
    }

    switch (action.type) {
      case 'draw': {
        const seat = requireActor(action);
        if (seat !== s.turn) throw new IllegalActionClass('not your turn');
        if (s.deck.length === 0) throw new IllegalActionClass('deck is empty');
        s.hands[seat].push(s.deck.pop()!);
        s.log.push(`seat ${seat} drew a card`);
        endTurn(s);
        return s;
      }

      case 'roll': {
        const seat = requireActor(action);
        if (seat !== s.turn) throw new IllegalActionClass('not your turn');
        const { dice } = action.payload as { dice?: number[] };
        if (!Array.isArray(dice) || dice.length !== 2) {
          throw new IllegalActionClass('roll action is missing its dice');
        }
        const gained = dice[0] + dice[1];
        s.favor[seat] += gained;
        s.log.push(`seat ${seat} rolled ${dice.join('+')} for ${gained} favor`);
        endTurn(s);
        return s;
      }

      case 'gift': {
        const seat = requireActor(action);
        if (seat !== s.turn) throw new IllegalActionClass('not your turn');
        const { to, card } = action.payload as { to: number; card: string };
        if (to === seat || to < 0 || to >= s.seats) throw new IllegalActionClass('bad recipient');
        const idx = s.hands[seat].indexOf(card);
        if (idx === -1) throw new IllegalActionClass('card not in hand');
        s.hands[seat].splice(idx, 1);
        s.pendingGift = { from: seat, to, card };
        s.log.push(`seat ${seat} offered a card to seat ${to}`);
        return s; // turn does NOT end until the gift resolves
      }

      case 'gift.accept':
      case 'gift.decline': {
        const seat = requireActor(action);
        const gift = s.pendingGift;
        if (!gift) throw new IllegalActionClass('no gift pending');
        if (seat !== gift.to) throw new IllegalActionClass('not your gift to answer');
        if (action.type === 'gift.accept') s.hands[gift.to].push(gift.card);
        else s.discard.push(gift.card);
        s.pendingGift = null;
        endTurn(s);
        return s;
      }

      default:
        throw new IllegalActionClass(`unknown action: ${action.type}`);
    }
  },

  project(s, seat) {
    return {
      seats: s.seats,
      turn: s.turn,
      round: s.round,
      complete: s.complete,
      favor: s.favor,
      deckCount: s.deck.length,
      discard: s.discard,
      hands: s.hands.map((h, i) => (i === seat ? h : { count: h.length })),
      pendingGift: s.pendingGift
        ? {
            from: s.pendingGift.from,
            to: s.pendingGift.to,
            card:
              seat === s.pendingGift.to || seat === s.pendingGift.from ? s.pendingGift.card : null,
          }
        : null,
      log: s.log,
    };
  },

  pending(s) {
    if (s.complete) return [];
    const g = s.pendingGift;
    const out: PendingDecision[] = [];
    if (g) {
      out.push({
        id: `gift:${g.from}:${g.to}:${g.card}`,
        seat: g.to,
        kind: 'gift',
        prompt: `Seat ${g.from} is offering you a card.`,
        resolves: ['gift.accept', 'gift.decline'],
      });
    } else {
      out.push({
        id: `turn:${s.round}:${s.turn}`,
        seat: s.turn,
        kind: 'turn',
        prompt: `It is your turn (round ${s.round}).`,
        resolves: ['draw', 'roll', 'gift'],
      });
    }
    return out;
  },

  isComplete(s) {
    return s.complete;
  },
};

// ---------------------------------------------------------------------------

/** Play a short scripted game so the tests below have a real log to chew on. */
function playScriptedGame() {
  const { gameId } = store.createGame(toy, ['ben', 'friend', 'other']);
  let seq = store.headSeq(gameId);

  const act = (seat: number, type: string, payload: unknown = {}) => {
    const r = store.appendAction(toy, gameId, seq, { type, actor: seat, payload });
    seq = r.seq;
    return r;
  };

  act(0, 'draw');
  act(1, 'roll');
  act(2, 'draw');
  act(0, 'roll');

  // Seat 1 offers a card; the turn does not advance until seat 2 answers.
  const hand1 = (store.loadState(toy, gameId).state as ToyState).hands[1];
  act(1, 'gift', { to: 2, card: hand1[0] });
  act(2, 'gift.accept');

  return { gameId, seq };
}

describe('replay', () => {
  it('is deterministic: folding the same log twice gives the same state', () => {
    const { gameId } = playScriptedGame();
    const a = store.loadState(toy, gameId).state as ToyState;
    const b = store.loadState(toy, gameId).state as ToyState;
    expect(a).toEqual(b);
    // Randomness actually happened, so this is a real test and not a
    // tautology. Asserted on the rolls being RECORDED rather than on what
    // they came up: the toy die has two blank faces, so a two-dice roll
    // legitimately gains 0 favor about 1 time in 9, and asserting
    // `favor > 0` failed roughly 1 run in 80.
    expect(a.log.filter((line) => line.includes('rolled'))).toHaveLength(2);
  });

  it('folds identically with and without a snapshot', () => {
    const { gameId, seq } = playScriptedGame();
    const full = store.loadState(toy, gameId).state;

    // Plant a mid-log snapshot, then reload: the fold now starts from it.
    const mid = 3;
    const midState = store.loadState(toy, gameId, mid).state;
    db.prepare('INSERT OR REPLACE INTO snapshots (game_id, seq, state) VALUES (?, ?, ?)').run(
      gameId,
      mid,
      JSON.stringify(midState),
    );

    const fromSnapshot = store.loadState(toy, gameId);
    expect(fromSnapshot.seq).toBe(seq);
    expect(fromSnapshot.state).toEqual(full);
  });

  it('rebuilds the same state after snapshots are wiped', () => {
    const { gameId } = playScriptedGame();
    const before = store.loadState(toy, gameId).state;
    db.prepare('DELETE FROM snapshots WHERE game_id = ?').run(gameId);
    expect(store.loadState(toy, gameId).state).toEqual(before);
  });
});

describe('concurrency', () => {
  it('rejects an action computed against stale state', () => {
    const { gameId, seq } = playScriptedGame();
    expect(() =>
      store.appendAction(toy, gameId, seq - 1, { type: 'draw', actor: 0, payload: {} }),
    ).toThrow(StaleSeq);
  });

  it('does not persist an illegal action', () => {
    const { gameId, seq } = playScriptedGame();
    // The scripted game leaves the turn with seat 2, so seat 1 is out of turn.
    expect(() =>
      store.appendAction(toy, gameId, seq, { type: 'draw', actor: 1, payload: {} }),
    ).toThrow(IllegalAction);
    expect(store.headSeq(gameId)).toBe(seq);
  });
});

describe('the action log', () => {
  it('leaks no hidden information', () => {
    const { gameId } = playScriptedGame();
    const { state } = store.loadState(toy, gameId);
    const log = JSON.stringify(store.history(gameId));

    // Deck order lives in `setups`, which is never part of the log.
    for (const card of (state as ToyState).deck) {
      expect(log).not.toContain(card);
    }
  });

  it('persists dice results so replay reuses them', () => {
    const { gameId } = playScriptedGame();
    const roll = store.history(gameId).find((a) => a.type === 'roll');
    expect(Array.isArray((roll?.payload as { dice?: unknown })?.dice)).toBe(true);

    const favorBefore = [...(store.loadState(toy, gameId).state as ToyState).favor];
    db.prepare('DELETE FROM snapshots WHERE game_id = ?').run(gameId);
    const favorAfter = (store.loadState(toy, gameId).state as ToyState).favor;
    expect(favorAfter).toEqual(favorBefore);
  });
});

describe('hidden information', () => {
  it('redacts other seats hands and the deck order', () => {
    const { gameId } = playScriptedGame();
    const { state } = store.loadState(toy, gameId);
    const view = toy.project(state, 0) as {
      hands: (string[] | { count: number })[];
      deck?: unknown;
    };

    expect(Array.isArray(view.hands[0])).toBe(true);
    expect(view.hands[1]).toEqual({ count: (state as ToyState).hands[1].length });
    expect(view.deck).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain((state as ToyState).deck[0]);
  });
});

describe('rollback', () => {
  it('restores the exact prior state', () => {
    const { gameId } = playScriptedGame();
    const target = 3;
    const expected = store.loadState(toy, gameId, target).state;

    store.rollback(gameId, target);

    expect(store.headSeq(gameId)).toBe(target);
    expect(store.loadState(toy, gameId).state).toEqual(expected);
  });
});

describe('pending decisions', () => {
  it('routes a pending gift to the recipient, not the active player', () => {
    const { gameId } = store.createGame(toy, ['a', 'b', 'c']);
    let seq = store.headSeq(gameId);
    const hand0 = (store.loadState(toy, gameId).state as ToyState).hands[0];
    seq = store.appendAction(toy, gameId, seq, {
      type: 'gift',
      actor: 0,
      payload: { to: 2, card: hand0[0] },
    }).seq;

    const { state } = store.loadState(toy, gameId);
    const pending = toy.pending!(state);
    expect(pending).toHaveLength(1);
    expect(pending[0].seat).toBe(2);
    expect(pending[0].kind).toBe('gift');
    // And the game is frozen for everyone else meanwhile.
    expect(() =>
      store.appendAction(toy, gameId, seq, { type: 'draw', actor: 0, payload: {} }),
    ).toThrow(IllegalAction);
  });
});
