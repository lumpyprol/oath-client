import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { oath } from '../../../src/oath/game/index.js';
import { type OathState } from '../../../src/oath/game/state.js';
import type { Effect } from '../../../src/oath/game/effects.js';
import {
  register,
  lookup,
  registrySize,
  __resetRegistryForTests,
  type PowerImpl,
} from '../../../src/oath/powers/registry.js';
import { IllegalAction, type GameAction, type ProposedAction } from '../../../src/engine/types.js';
import { baseState } from './helpers.js';

function act(state: OathState, actor: number | null, payload: unknown): OathState {
  const action: GameAction = {
    gameId: 'test',
    seq: state.actionCount + 1,
    type: 'power.use',
    actor,
    payload,
    createdAt: '2026-09-12T00:00:00.000Z',
  };
  return oath.reduce(state, action);
}

beforeEach(() => __resetRegistryForTests());
afterEach(() => __resetRegistryForTests());

describe('the shipped registry (HLD §9 — enforcement-creep guard)', () => {
  it('is empty', () => {
    expect(registrySize()).toBe(0);
    expect(lookup('denizen:anything')).toBeUndefined();
  });
});

describe('the enforcement seam (unit 15; HLD D28/D34)', () => {
  /**
   * A mechanically-simple real card, made usable as seat 1's own faceup
   * adviser (whichever denizen `baseState` happened to deal there — its
   * IDENTITY, not its printed power text, is all this test uses). The demo
   * impl produces one effect: gain 1 favor from a bank named by
   * `choices.suit`, given explicitly by every test below — deliberately
   * not derived from "what the card actually does."
   */
  function setup(): { s: OathState; cardId: string } {
    const s = baseState();
    s.players[1].advisers[0].facedown = false; // now it has a power to use at all
    return { s, cardId: s.players[1].advisers[0].id };
  }

  const makeImpl = (): PowerImpl => (_state, seat, choices) => {
    const suit = (choices as { suit: string }).suit;
    const effect: Effect = {
      kind: 'favor',
      from: { kind: 'favorBank', suit: suit as never },
      to: { kind: 'seatFavor', seat },
      amount: 1,
    };
    return [effect];
  };

  it("a registered impl's payload is shape-equal to a declared payload — same keys, same effect tags", () => {
    const { s, cardId } = setup();
    register(cardId, makeImpl());

    const proposed: ProposedAction = {
      type: 'power.use',
      actor: 1,
      payload: { cardId, choices: { suit: 'hearth' } },
    };
    const enforced = oath.prepare!(s, proposed) as { cardId: string; effects: Effect[]; choices?: unknown };
    const declared = {
      cardId,
      effects: [{ kind: 'favor', from: { kind: 'favorBank', suit: 'hearth' }, to: { kind: 'seatFavor', seat: 1 }, amount: 1 }],
    };

    expect(Object.keys(enforced).sort()).toEqual(['cardId', 'choices', 'effects']);
    expect(enforced.effects.map((e) => e.kind)).toEqual(declared.effects.map((e) => e.kind));
    expect(enforced.cardId).toBe(declared.cardId);
  });

  it('declared and enforced uses are indistinguishable to reduce() — folding either produces the same state', () => {
    const { s, cardId } = setup();
    register(cardId, makeImpl());

    const enforcedPayload = oath.prepare!(s, {
      type: 'power.use',
      actor: 1,
      payload: { cardId, choices: { suit: 'hearth' } },
    });
    const enforcedOut = act(structuredClone(s), 1, enforcedPayload);

    __resetRegistryForTests(); // the declared path must not depend on the registry at all
    const declaredOut = act(structuredClone(s), 1, {
      cardId,
      effects: [{ kind: 'favor', from: { kind: 'favorBank', suit: 'hearth' }, to: { kind: 'seatFavor', seat: 1 }, amount: 1 }],
    });

    expect(enforcedOut).toEqual(declaredOut);
  });

  it("a registered card's client-declared effects are ignored — the impl's output wins (D34)", () => {
    const { s, cardId } = setup();
    register(cardId, makeImpl());

    // the client declares something wildly different; prepare() must not use it
    const bogus = [
      { kind: 'favor', from: { kind: 'favorBank', suit: 'beast' }, to: { kind: 'seatFavor', seat: 1 }, amount: 5 },
    ];
    const prepared = oath.prepare!(s, {
      type: 'power.use',
      actor: 1,
      payload: { cardId, effects: bogus, choices: { suit: 'order' } },
    }) as { effects: Effect[] };

    expect(prepared.effects).toEqual([
      { kind: 'favor', from: { kind: 'favorBank', suit: 'order' }, to: { kind: 'seatFavor', seat: 1 }, amount: 1 },
    ]);
  });

  it('register() throws on a duplicate id', () => {
    const { cardId } = setup();
    register(cardId, makeImpl());
    expect(() => register(cardId, makeImpl())).toThrow();
  });

  it('with the registry empty (reset), the same {cardId, choices} payload is rejected — the default path still requires declared effects', () => {
    const { s, cardId } = setup();
    register(cardId, makeImpl());
    __resetRegistryForTests(); // back to shipped (empty) behavior

    const prepared = oath.prepare!(s, {
      type: 'power.use',
      actor: 1,
      payload: { cardId, choices: { suit: 'hearth' } },
    });
    expect(prepared).toEqual({ cardId, choices: { suit: 'hearth' } }); // passed through, still no effects

    expect(() => act(s, 1, prepared)).toThrow(IllegalAction);
  });

  it('a full round trip through prepare() + reduce() applies the impl\'s effect', () => {
    const { s, cardId } = setup();
    register(cardId, makeImpl());
    const favorBefore = s.players[1].favor;

    const prepared = oath.prepare!(s, {
      type: 'power.use',
      actor: 1,
      payload: { cardId, choices: { suit: 'hearth' } },
    });
    const out = act(s, 1, prepared);
    expect(out.players[1].favor).toBe(favorBefore + 1);
  });
});
