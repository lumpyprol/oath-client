import { describe, it, expect } from 'vitest';
import { checkInvariants } from '../../../src/oath/game/state.js';
import { cards } from '../../../src/oath/cards/index.js';
import { baseState } from './helpers.js';
import {
  applyEffects,
  EffectSchema,
  type Effect,
} from '../../../src/oath/game/effects.js';
import { IllegalAction } from '../../../src/engine/types.js';

describe('favor mover', () => {
  it('lands a legal move: seat favor to a suit favor bank (both zones change)', () => {
    const s = baseState();
    const before = { seat: s.players[0].favor, bank: s.favorBanks.hearth };
    const out = applyEffects(s, 0, [
      { kind: 'favor', from: { kind: 'seatFavor', seat: 0 }, to: { kind: 'favorBank', suit: 'hearth' }, amount: 1 },
    ]);
    expect(out.players[0].favor).toBe(before.seat - 1);
    expect(out.favorBanks.hearth).toBe(before.bank + 1);
    checkInvariants(out);
  });

  it('places favor onto a denizen at a site (Law §5.2.1 Muster cost)', () => {
    const s = baseState();
    const siteId = s.sites[0].id;
    const cardId = s.sites[0].cards.find((c) => c !== null)!.id;
    const out = applyEffects(s, 0, [
      {
        kind: 'favor',
        from: { kind: 'seatFavor', seat: 0 },
        to: { kind: 'siteCardFavor', siteId, cardId },
        amount: 1,
      },
    ]);
    const card = out.sites[0].cards.find((c) => c?.id === cardId)!;
    expect(card!.favor).toBe(1);
    expect(out.players[0].favor).toBe(s.players[0].favor - 1);
    checkInvariants(out);
  });

  it('rejects a card zone as a favor endpoint (illegal endpoint kind)', () => {
    const s = baseState();
    expect(() =>
      applyEffects(s, 0, [
        // @ts-expect-error seatHand is a CardZone, not a FavorZone
        { kind: 'favor', from: { kind: 'seatFavor', seat: 0 }, to: { kind: 'seatHand', seat: 0 }, amount: 1 },
      ]),
    ).toThrow(IllegalAction);
  });

  it('throws naming the index when the source zone lacks the amount', () => {
    const s = baseState({});
    s.players[0].favor = 0;
    expect(() =>
      applyEffects(s, 0, [
        { kind: 'favor', from: { kind: 'seatFavor', seat: 0 }, to: { kind: 'favorBank', suit: 'hearth' }, amount: 1 },
      ]),
    ).toThrow(/effect 0/);
  });
});

describe('secret mover', () => {
  it('lands a legal move: seat secrets to the shared bank (Recover burn cost)', () => {
    const s = baseState();
    const before = { seat: s.players[2].secrets.ready, shared: s.sharedBank.secrets };
    const out = applyEffects(s, 2, [
      { kind: 'secret', from: { kind: 'seatSecrets', seat: 2 }, to: { kind: 'sharedSecrets' }, amount: 1 },
    ]);
    expect(out.players[2].secrets.ready).toBe(before.seat - 1);
    expect(out.sharedBank.secrets).toBe(before.shared + 1);
    checkInvariants(out);
  });

  it('throws naming the index and reason when the seat lacks secrets', () => {
    const s = baseState();
    s.players[1].secrets = { ready: 0, flipped: 0 };
    expect(() =>
      applyEffects(s, 1, [
        { kind: 'secret', from: { kind: 'seatSecrets', seat: 1 }, to: { kind: 'sharedSecrets' }, amount: 1 },
      ]),
    ).toThrow(/effect 0/);
  });
});

describe('warbands mover', () => {
  it('lands a legal move: personal bank to board (Law §5.2.2 Muster gain)', () => {
    const s = baseState();
    const before = { bank: s.players[0].warbands.bank, board: s.players[0].warbands.board };
    const out = applyEffects(s, 0, [
      { kind: 'warbands', from: { kind: 'seatWarbandBank', seat: 0 }, to: { kind: 'seatWarbandBoard', seat: 0 }, amount: 2 },
    ]);
    expect(out.players[0].warbands.bank).toBe(before.bank - 2);
    expect(out.players[0].warbands.board).toBe(before.board + 2);
    checkInvariants(out);
  });

  it('lands board-to-site (a ruled-site minor action)', () => {
    const s = baseState();
    const siteId = s.sites[0].id; // seat 0 already has warbands there
    const before = { board: s.players[0].warbands.board, site: s.sites[0].warbands[0] };
    const out = applyEffects(s, 0, [
      { kind: 'warbands', from: { kind: 'seatWarbandBoard', seat: 0 }, to: { kind: 'siteWarbands', siteId, seat: 0 }, amount: 1 },
    ]);
    expect(out.players[0].warbands.board).toBe(before.board - 1);
    expect(out.sites[0].warbands[0]).toBe(before.site + 1);
    checkInvariants(out);
  });

  it('throws naming the index when the bank is empty', () => {
    const s = baseState();
    s.players[0].warbands.bank = 0;
    expect(() =>
      applyEffects(s, 0, [
        { kind: 'warbands', from: { kind: 'seatWarbandBank', seat: 0 }, to: { kind: 'seatWarbandBoard', seat: 0 }, amount: 1 },
      ]),
    ).toThrow(/effect 0/);
  });
});

describe('card mover', () => {
  it('lands a legal move: hand to seat advisers, faceup by default', () => {
    const s = baseState();
    const id = s.worldDeck.shift()!; // remove from the deck: it's moving to hand
    s.players[1].hand = [id];
    const out = applyEffects(s, 1, [
      { kind: 'card', id, from: { kind: 'seatHand', seat: 1 }, to: { kind: 'seatAdvisers', seat: 1 } },
    ]);
    expect(out.players[1].hand).not.toContain(id);
    const adviser = out.players[1].advisers.find((a) => a.id === id);
    expect(adviser).toBeDefined();
    expect(adviser!.facedown).toBe(false);
    checkInvariants(out);
  });

  it('composes with flip to play a facedown adviser', () => {
    const s = baseState();
    const id = s.worldDeck.shift()!;
    s.players[1].hand = [id];
    const out = applyEffects(s, 1, [
      { kind: 'card', id, from: { kind: 'seatHand', seat: 1 }, to: { kind: 'seatAdvisers', seat: 1 } },
      { kind: 'flip', target: { kind: 'adviser', seat: 1, cardId: id } },
    ]);
    const adviser = out.players[1].advisers.find((a) => a.id === id);
    expect(adviser!.facedown).toBe(true);
    checkInvariants(out);
  });

  it('lands a legal move: relic from a site to the seat holding it (Recover)', () => {
    const s = baseState();
    const siteId = s.sites[1].id;
    const relicId = s.sites[1].relics[0];
    const out = applyEffects(s, 0, [
      { kind: 'card', id: relicId, from: { kind: 'siteRelics', siteId }, to: { kind: 'seatRelics', seat: 0 } },
    ]);
    expect(out.sites[1].relics).not.toContain(relicId);
    expect(out.players[0].relics).toContain(relicId);
    checkInvariants(out);
  });

  it('rejects a favor bank as a card endpoint (illegal endpoint kind)', () => {
    const s = baseState();
    const id = s.worldDeck.shift()!;
    s.players[1].hand = [id];
    expect(() =>
      applyEffects(s, 1, [
        // @ts-expect-error favorBank is not a CardZone
        { kind: 'card', id, from: { kind: 'seatHand', seat: 1 }, to: { kind: 'favorBank', suit: 'hearth' } },
      ]),
    ).toThrow(IllegalAction);
  });

  it('throws naming the index when the card is not in the from-zone', () => {
    const s = baseState();
    expect(() =>
      applyEffects(s, 1, [
        { kind: 'card', id: 'denizen:not-there', from: { kind: 'seatHand', seat: 1 }, to: { kind: 'seatAdvisers', seat: 1 } },
      ]),
    ).toThrow(/effect 0/);
  });

  it('throws on an over-capacity destination (site slots full)', () => {
    const s = baseState();
    const site = s.sites[2];
    const emptySlots = site.cards.reduce((n, c) => n + (c === null ? 1 : 0), 0);
    const filler = s.worldDeck.slice(0, emptySlots);
    s.worldDeck = s.worldDeck.slice(emptySlots);
    let next = 0;
    site.cards = site.cards.map((c) => c ?? { id: filler[next++], favor: 0, secrets: 0 });
    checkInvariants(s); // the site is now full but otherwise valid
    const overflow = s.worldDeck.shift()!;
    s.players[1].hand = [overflow];
    expect(() =>
      applyEffects(s, 1, [
        { kind: 'card', id: overflow, from: { kind: 'seatHand', seat: 1 }, to: { kind: 'siteSlot', siteId: site.id } },
      ]),
    ).toThrow(/effect 0/);
  });
});

describe('draw', () => {
  it('moves the top of the world deck to hand without the effect naming the id', () => {
    const s = baseState();
    const topId = s.worldDeck[0];
    const out = applyEffects(s, 1, [
      { kind: 'draw', from: { kind: 'worldDeck' }, to: { kind: 'seatHand', seat: 1 } },
    ]);
    expect(out.worldDeck[0]).not.toBe(topId);
    expect(out.players[1].hand).toContain(topId);
    checkInvariants(out);
  });

  it('throws naming the index when the source is empty', () => {
    const s = baseState();
    s.worldDeck = [];
    expect(() =>
      applyEffects(s, 1, [{ kind: 'draw', from: { kind: 'worldDeck' }, to: { kind: 'seatHand', seat: 1 } }]),
    ).toThrow(/effect 0/);
  });
});

describe('flip', () => {
  it('toggles an edifice to its ruin face and back', () => {
    // no edifice in baseState's sites, so plant one directly
    const s = baseState();
    const siteId = s.sites[3].id;
    const edificeId = cards.edifices[0].id;
    s.sites[3].cards[0] = { id: edificeId, favor: 0, secrets: 0, ruined: false };
    const out = applyEffects(s, 0, [
      { kind: 'flip', target: { kind: 'edifice', siteId, cardId: edificeId } },
    ]);
    const card = out.sites[3].cards.find((c) => c?.id === edificeId);
    expect(card!.ruined).toBe(true);
    checkInvariants(out);
  });

  it('toggles a site facedown/faceup (Law §5.6.2 reveal)', () => {
    const s = baseState();
    s.sites[3].facedown = true;
    const out = applyEffects(s, 0, [
      { kind: 'flip', target: { kind: 'site', siteId: s.sites[3].id } },
    ]);
    expect(out.sites[3].facedown).toBe(false);
    checkInvariants(out);
  });
});

describe('ordering', () => {
  it('a sequence where step 2 is only feasible because of step 1 succeeds', () => {
    const s = baseState();
    s.favorBanks.hearth += s.players[0].favor; // keep the total conserved
    s.players[0].favor = 0;
    const effects: Effect[] = [
      { kind: 'favor', from: { kind: 'favorBank', suit: 'hearth' }, to: { kind: 'seatFavor', seat: 0 }, amount: 1 },
      { kind: 'favor', from: { kind: 'seatFavor', seat: 0 }, to: { kind: 'favorBank', suit: 'nomad' }, amount: 1 },
    ];
    const out = applyEffects(s, 0, effects);
    expect(out.players[0].favor).toBe(0);
    checkInvariants(out);
  });

  it('the reverse order throws', () => {
    const s = baseState();
    s.favorBanks.hearth += s.players[0].favor;
    s.players[0].favor = 0;
    const effects: Effect[] = [
      { kind: 'favor', from: { kind: 'seatFavor', seat: 0 }, to: { kind: 'favorBank', suit: 'nomad' }, amount: 1 },
      { kind: 'favor', from: { kind: 'favorBank', suit: 'hearth' }, to: { kind: 'seatFavor', seat: 0 }, amount: 1 },
    ];
    expect(() => applyEffects(s, 0, effects)).toThrow(/effect 0/);
  });
});

describe('purity', () => {
  it('does not mutate its input state', () => {
    const s = baseState();
    const snapshot = JSON.parse(JSON.stringify(s));
    applyEffects(s, 0, [
      { kind: 'favor', from: { kind: 'seatFavor', seat: 0 }, to: { kind: 'favorBank', suit: 'hearth' }, amount: 1 },
    ]);
    expect(s).toEqual(snapshot);
  });
});

describe('EffectSchema', () => {
  it('accepts a well-formed favor mover', () => {
    const effect = {
      kind: 'favor',
      from: { kind: 'seatFavor', seat: 0 },
      to: { kind: 'favorBank', suit: 'hearth' },
      amount: 1,
    };
    expect(EffectSchema.safeParse(effect).success).toBe(true);
  });

  it('rejects a malformed payload: unknown zone kind', () => {
    const effect = {
      kind: 'favor',
      from: { kind: 'seatFavor', seat: 0 },
      to: { kind: 'nonsense' },
      amount: 1,
    };
    expect(EffectSchema.safeParse(effect).success).toBe(false);
  });

  it('rejects a favor mover with a card-zone endpoint', () => {
    const effect = {
      kind: 'favor',
      from: { kind: 'seatFavor', seat: 0 },
      to: { kind: 'seatHand', seat: 0 },
      amount: 1,
    };
    expect(EffectSchema.safeParse(effect).success).toBe(false);
  });

  it('rejects a non-positive amount', () => {
    const effect = {
      kind: 'favor',
      from: { kind: 'seatFavor', seat: 0 },
      to: { kind: 'favorBank', suit: 'hearth' },
      amount: 0,
    };
    expect(EffectSchema.safeParse(effect).success).toBe(false);
  });
});
