import { describe, it, expect } from 'vitest';
import { cards } from '../../../src/oath/cards/index.js';
import {
  checkInvariants,
  PEOPLES_FAVOR_ID,
  DARKEST_SECRET_ID,
  type OathState,
} from '../../../src/oath/game/state.js';
import { oath } from '../../../src/oath/game/index.js';
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

describe('power.use — declared effects apply and are visible in the log (Law §7.1.3)', () => {
  it('spends favor and moves warbands, from a card the actor rules at their own site', () => {
    const s = baseState();
    const cardId = s.sites[5].cards[0]!.id; // seat 1 rules sites[5] (2 warbands there)
    const favorBefore = s.players[1].favor;
    const bankBefore = s.players[1].warbands.bank;
    const boardBefore = s.players[1].warbands.board;

    const out = act(s, 1, {
      cardId,
      effects: [
        { kind: 'favor', from: { kind: 'seatFavor', seat: 1 }, to: { kind: 'sharedFavor' }, amount: 1 },
        {
          kind: 'warbands',
          from: { kind: 'seatWarbandBank', seat: 1 },
          to: { kind: 'seatWarbandBoard', seat: 1 },
          amount: 1,
        },
      ],
      note: 'test power',
    });

    expect(out.players[1].favor).toBe(favorBefore - 1);
    expect(out.players[1].warbands.bank).toBe(bankBefore - 1);
    expect(out.players[1].warbands.board).toBe(boardBefore + 1);
    checkInvariants(out);
  });

  it('applies zero effects (a power with no cost/no immediate effect) as a no-op', () => {
    const s = baseState();
    const cardId = s.sites[5].cards[0]!.id;
    const beforeCount = s.actionCount;
    const beforeFavor = s.players[1].favor;
    const out = act(s, 1, { cardId, effects: [] });
    expect(out.actionCount).toBe(beforeCount + 1);
    expect(out.players[1].favor).toBe(beforeFavor);
    checkInvariants(out);
  });
});

describe('power.use — access (Law §7.1.1)', () => {
  // These tests are about ACCESS, not TIMING (that's its own describe
  // block below) — set activeSeat to whichever seat is under test so
  // requireActiveSeat's own check never gets in the way here.

  it('is legal: a relic the actor holds', () => {
    const s = baseState();
    s.turn.activeSeat = 2;
    const heldRelicId = s.players[2].relics[0]; // baseState gives seat 2 a held relic
    const out = act(s, 2, { cardId: heldRelicId, effects: [] });
    checkInvariants(out);
  });

  it('is legal: a banner the actor holds', () => {
    const s = baseState();
    s.turn.activeSeat = 0;
    s.banners.find((b) => b.id === PEOPLES_FAVOR_ID)!.holder = 0;
    const out = act(s, 0, { cardId: PEOPLES_FAVOR_ID, effects: [] });
    checkInvariants(out);
  });

  it('is illegal: a banner nobody holds, or the actor does not hold', () => {
    const s = baseState();
    s.turn.activeSeat = 0;
    expect(() => act(s, 0, { cardId: PEOPLES_FAVOR_ID, effects: [] })).toThrow(IllegalAction);
    s.banners.find((b) => b.id === DARKEST_SECRET_ID)!.holder = 1;
    expect(() => act(s, 0, { cardId: DARKEST_SECRET_ID, effects: [] })).toThrow(IllegalAction);
  });

  it('is legal: the actor\'s own FACEUP adviser', () => {
    const s = baseState();
    s.turn.activeSeat = 0;
    const cardId = s.players[0].advisers[0].id; // seat 0's adviser is faceup
    const out = act(s, 0, { cardId, effects: [] });
    checkInvariants(out);
  });

  it('is illegal: a FACEDOWN adviser — it structurally has no power (Law §5.1.4.II)', () => {
    const s = baseState();
    const cardId = s.players[1].advisers[0].id; // seat 1's adviser is facedown
    expect(() => act(s, 1, { cardId, effects: [] })).toThrow(IllegalAction);
  });

  it("is illegal: another seat's adviser, even faceup", () => {
    const s = baseState();
    const cardId = s.players[0].advisers[0].id;
    expect(() => act(s, 1, { cardId, effects: [] })).toThrow(IllegalAction);
  });

  it('is legal: a site itself, or a denizen at it, if the actor RULES it (even away from it)', () => {
    const s = baseState();
    s.turn.activeSeat = 0;
    // seat 0 rules sites[0] (2 warbands) but pawn 2 is elsewhere by default;
    // move seat 0's pawn away to prove ruling-from-afar is what grants access.
    s.players[0].pawnSite = s.sites[5].id;
    const siteOut = act(s, 0, { cardId: s.sites[0].id, effects: [] });
    checkInvariants(siteOut);
    const denizenOut = act(s, 0, { cardId: s.sites[0].cards[0]!.id, effects: [] });
    checkInvariants(denizenOut);
  });

  it('is legal: a site itself, or a denizen at it, if the actor\'s PAWN is there (without ruling)', () => {
    const s = baseState();
    s.turn.activeSeat = 2;
    // seat 2's pawn is at sites[2]; seat 2 has no warbands there.
    expect(s.sites[2].warbands[2]).toBe(0);
    const out = act(s, 2, { cardId: s.sites[2].id, effects: [] });
    checkInvariants(out);
  });

  it("is illegal: a site the actor neither rules nor has their pawn at", () => {
    const s = baseState();
    expect(() => act(s, 2, { cardId: s.sites[0].id, effects: [] })).toThrow(IllegalAction);
  });

  it('is illegal: a facedown site (nothing revealed there yet)', () => {
    const s = baseState();
    s.sites[5].facedown = true;
    s.sites[5].warbands[1] = 2; // still "rules" it structurally, but it's facedown
    expect(() => act(s, 1, { cardId: s.sites[5].id, effects: [] })).toThrow(IllegalAction);
  });

  it('is illegal: a card in hand, the world deck, or a discard pile', () => {
    const s = baseState();
    expect(() => act(s, 1, { cardId: s.worldDeck[0], effects: [] })).toThrow(IllegalAction);
    expect(() => act(s, 1, { cardId: s.discards.cradle[0], effects: [] })).toThrow(IllegalAction);
  });

  it('is illegal: a facedown relic sitting at a site (not yet recovered)', () => {
    const s = baseState();
    const relicId = s.sites[1].relics[0];
    s.players[1].pawnSite = s.sites[1].id; // even with the pawn right there
    expect(() => act(s, 1, { cardId: relicId, effects: [] })).toThrow(IllegalAction);
  });
});

describe('power.use — access via §6.6.3 (every Imperial player rules every purple site; unit 16 follow-up)', () => {
  it('a Citizen gets access to a card at a site ONLY the Chancellor has direct warbands at', () => {
    const s = baseState();
    s.players[2].citizenship = 'citizen'; // now Imperial alongside seat 0
    // Rebalance purple-24 conservation for the flip: seat 2 contributes 0
    // (matching what a fresh citizenship.accept would leave them with —
    // see citizenship.ts's file header), so the Chancellor's existing 24
    // alone still satisfies the invariant.
    s.players[2].warbands.bank = 0;
    s.players[2].warbands.board = 0;
    s.turn.activeSeat = 2;
    // seat 0 has direct warbands at sites[0]; seat 2 has none there and its
    // pawn is elsewhere — only the §6.6.3 extension can grant access.
    expect(s.sites[0].warbands[2]).toBe(0);
    expect(s.players[2].pawnSite).not.toBe(s.sites[0].id);
    const out = act(s, 2, { cardId: s.sites[0].cards[0]!.id, effects: [] });
    checkInvariants(out);
  });

  it('an Exile does NOT gain access this way — the extension is Imperial-only', () => {
    const s = baseState(); // seat 1 stays an Exile
    expect(() => act(s, 1, { cardId: s.sites[0].cards[0]!.id, effects: [] })).toThrow(IllegalAction);
  });
});

describe('power.use — the Imperial Reliquary\'s 4 modifiers (Law §2.3, §6.6.2, §7.1.1; unit 16 follow-up)', () => {
  it('is illegal for the Chancellor while every space is still covered', () => {
    const s = baseState();
    s.turn.activeSeat = 0;
    expect(() => act(s, 0, { cardId: 'reliquary:brutal', effects: [] })).toThrow(IllegalAction);
  });

  it('is legal for the Chancellor once a space is uncovered', () => {
    const s = baseState();
    s.turn.activeSeat = 0;
    const space = s.reliquary.find((sp) => sp.modifier === 'brutal')!;
    space.relicId = null; // e.g. taken by citizenship.accept
    const out = act(s, 0, { cardId: 'reliquary:brutal', effects: [] });
    checkInvariants(out);
  });

  it('is illegal for anyone other than the Chancellor, even once uncovered', () => {
    const s = baseState();
    s.reliquary.find((sp) => sp.modifier === 'decadent')!.relicId = null;
    s.turn.activeSeat = 1;
    expect(() => act(s, 1, { cardId: 'reliquary:decadent', effects: [] })).toThrow(IllegalAction);
  });

  it('each of the 4 modifiers is independently gated by its OWN space', () => {
    const s = baseState();
    s.turn.activeSeat = 0;
    s.reliquary.find((sp) => sp.modifier === 'careless')!.relicId = null;
    const out = act(s, 0, { cardId: 'reliquary:careless', effects: [] });
    checkInvariants(out);
    // greedy's own space is still covered — no access yet
    expect(() => act(out, 0, { cardId: 'reliquary:greedy', effects: [] })).toThrow(IllegalAction);
  });
});

describe('power.use — infeasible effects reject the whole action (HLD D34)', () => {
  it('rejects: more favor than the actor has', () => {
    const s = baseState();
    const cardId = s.sites[5].cards[0]!.id;
    expect(() =>
      act(s, 1, {
        cardId,
        effects: [{ kind: 'favor', from: { kind: 'seatFavor', seat: 1 }, to: { kind: 'sharedFavor' }, amount: 999 }],
      }),
    ).toThrow(IllegalAction);
  });

  it('rejects: warbands not present in the source zone', () => {
    const s = baseState();
    const cardId = s.sites[5].cards[0]!.id;
    expect(() =>
      act(s, 1, {
        cardId,
        effects: [
          {
            kind: 'warbands',
            from: { kind: 'seatWarbandBank', seat: 1 },
            to: { kind: 'seatWarbandBoard', seat: 1 },
            amount: 999,
          },
        ],
      }),
    ).toThrow(IllegalAction);
  });

  it('rejects: a card not where claimed (moving a card that is not actually in the declared "from" zone)', () => {
    const s = baseState();
    const cardId = s.sites[5].cards[0]!.id;
    const wrongId = cards.denizens.find((d) => d.id !== cardId)!.id;
    expect(() =>
      act(s, 1, {
        cardId,
        effects: [
          {
            kind: 'card',
            id: wrongId,
            from: { kind: 'seatAdvisers', seat: 1 },
            to: { kind: 'seatAdvisers', seat: 1 },
          },
        ],
      }),
    ).toThrow(IllegalAction);
  });

  it('applies nothing when one of several effects is infeasible (atomic)', () => {
    const s = baseState();
    const cardId = s.sites[5].cards[0]!.id;
    expect(() =>
      act(s, 1, {
        cardId,
        effects: [
          { kind: 'favor', from: { kind: 'seatFavor', seat: 1 }, to: { kind: 'sharedFavor' }, amount: 1 },
          { kind: 'favor', from: { kind: 'seatFavor', seat: 1 }, to: { kind: 'sharedFavor' }, amount: 999 },
        ],
      }),
    ).toThrow(IllegalAction);
  });
});

describe('power.use — malformed payload rejected in prepare() (nothing persisted)', () => {
  it('throws for a payload missing cardId', () => {
    const s = baseState();
    const proposed: ProposedAction = { type: 'power.use', actor: 1, payload: { effects: [] } };
    expect(() => oath.prepare!(s, proposed)).toThrow(IllegalAction);
  });

  it('throws for a payload with a malformed effect', () => {
    const s = baseState();
    const proposed: ProposedAction = {
      type: 'power.use',
      actor: 1,
      payload: { cardId: 'denizen:x', effects: [{ kind: 'favor', from: {}, to: {}, amount: -1 }] },
    };
    expect(() => oath.prepare!(s, proposed)).toThrow(IllegalAction);
  });

  it('reduce() also rejects a malformed payload directly (every test above bypasses prepare())', () => {
    const s = baseState();
    expect(() => act(s, 1, { cardId: 123, effects: [] })).toThrow(IllegalAction);
  });
});

describe('power.use — timing (Law §7.3.2; the Campaign response window, unit 12)', () => {
  function respondingCampaign() {
    const s = baseState();
    s.players[2].pawnSite = s.sites[5].id; // so pawnFavor is a legal target
    const declareAction: GameAction = {
      gameId: 'test',
      seq: s.actionCount + 1,
      type: 'campaign.declare',
      actor: 1,
      payload: { defender: 2, targets: [{ kind: 'pawnFavor' }], attackDice: 1 },
      createdAt: '2026-09-12T00:00:00.000Z',
    };
    return oath.reduce(s, declareAction); // phase 'respond', defender seat 2
  }

  it("is legal on your own turn (normal Act-Phase timing, no campaign in progress)", () => {
    const s = baseState();
    const cardId = s.sites[5].cards[0]!.id;
    const out = act(s, 1, { cardId, effects: [] }); // seat 1 is the active seat
    checkInvariants(out);
  });

  it('is illegal off-turn with no campaign in progress', () => {
    const s = baseState();
    const cardId = s.sites[2].id;
    expect(() => act(s, 2, { cardId, effects: [] })).toThrow(IllegalAction);
  });

  it("is legal for the response window's owner (the defender) while it is open", () => {
    const s = respondingCampaign();
    expect(s.campaign).toMatchObject({ phase: 'respond', defenderSeat: 2 });
    const cardId = s.players[2].relics[0];
    const out = act(s, 2, { cardId, effects: [] });
    checkInvariants(out);
  });

  it('is illegal for the attacker during the window (they are not its owner)', () => {
    const s = respondingCampaign();
    const cardId = s.sites[5].cards[0]!.id;
    expect(() => act(s, 1, { cardId, effects: [] })).toThrow(IllegalAction);
  });

  it('is illegal for a third seat during the window', () => {
    const s = respondingCampaign();
    const cardId = s.players[0].advisers[0].id;
    expect(() => act(s, 0, { cardId, effects: [] })).toThrow(IllegalAction);
  });

  it('is illegal for the defender once the window has closed (phase advanced past "respond")', () => {
    const s = respondingCampaign();
    const respondAction: GameAction = {
      gameId: 'test',
      seq: s.actionCount + 1,
      type: 'campaign.respond',
      actor: 2,
      payload: {},
      createdAt: '2026-09-12T00:00:00.000Z',
    };
    const responded = oath.reduce(s, respondAction);
    expect(responded.campaign).toMatchObject({ phase: 'roll' });
    const cardId = responded.players[2].relics[0];
    expect(() => act(responded, 2, { cardId, effects: [] })).toThrow(IllegalAction);
  });
});
