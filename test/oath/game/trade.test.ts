import { describe, it, expect } from 'vitest';
import { byId, cards } from '../../../src/oath/cards/index.js';
import { checkInvariants, type OathState } from '../../../src/oath/game/state.js';
import type { Suit } from '../../../src/oath/cards/schema.js';
import { oath } from '../../../src/oath/game/index.js';
import { IllegalAction, type GameAction } from '../../../src/engine/types.js';
import { matchingFaceupAdvisers } from '../../../src/oath/game/actions/trade.js';
import { baseState } from './helpers.js';

function trade(state: OathState, actor: number | null, payload: unknown): OathState {
  const action: GameAction = {
    gameId: 'test',
    seq: state.actionCount + 1,
    type: 'trade',
    actor,
    payload,
    createdAt: '2026-09-10T00:00:00.000Z',
  };
  return oath.reduce(state, action);
}

/**
 * baseState with seat 1's target denizen identified, and `matches` faceup
 * advisers of the target's suit given to seat 1 (plus one of another suit
 * that must not count).
 */
function ready(matches: number) {
  const s = baseState();
  const site = s.sites.find((x) => x.id === s.players[1].pawnSite)!;
  const cardId = site.cards.find((c) => c !== null)!.id;
  const suit = (byId(cardId) as { suit: Suit }).suit;

  // Only pull adviser cards from the free world-deck pool, so removing them
  // from it keeps every id in exactly one zone.
  const free = new Set(s.worldDeck);
  const suitOf = (id: string) => {
    const c = byId(id);
    return 'suit' in c ? c.suit : undefined;
  };
  const sameSuit = [...free].filter((id) => suitOf(id) === suit).slice(0, matches);
  const otherSuit = [...free].find((id) => id.startsWith('denizen:') && suitOf(id) !== suit)!;

  const planted = [...sameSuit, otherSuit];
  s.worldDeck = s.worldDeck.filter((id) => !planted.includes(id));
  s.players[1].advisers = [
    ...sameSuit.map((id) => ({ id, facedown: false, favor: 0, secrets: 0 })),
    { id: otherSuit, facedown: false, favor: 0, secrets: 0 },
  ].slice(0, 3); // adviser limit

  return { s, cardId, suit, site };
}

describe('matchingFaceupAdvisers (Trade suit-count helper, Law §5.3.2 / Glossary "Match")', () => {
  it('counts faceup advisers of the given suit, ignoring facedown and other suits', () => {
    const s = baseState();
    const suit: Suit = 'hearth';
    const hearthOne = cards.denizens.find((d) => d.suit === 'hearth')!.id;
    const hearthTwo = cards.denizens.filter((d) => d.suit === 'hearth')[1].id;
    const nomad = cards.denizens.find((d) => d.suit === 'nomad')!.id;
    s.worldDeck = s.worldDeck.filter((id) => ![hearthOne, hearthTwo, nomad].includes(id));
    s.players[1].advisers = [
      { id: hearthOne, facedown: false, favor: 0, secrets: 0 }, // counts
      { id: hearthTwo, facedown: true, favor: 0, secrets: 0 }, // facedown → no
      { id: nomad, facedown: false, favor: 0, secrets: 0 }, // wrong suit → no
    ];
    expect(matchingFaceupAdvisers(s.players[1], suit)).toBe(1);
  });
});

describe('trade — for favor (Law §5.3.2)', () => {
  it('places 1 secret on the card and gains 1 + matches favor from that suit bank', () => {
    const { s, cardId, suit, site } = ready(2);
    const bankBefore = s.favorBanks[suit];
    const favorBefore = s.players[1].favor;
    const readyBefore = s.players[1].secrets.ready;

    const out = trade(s, 1, { for: 'favor', cardId });

    const card = out.sites.find((x) => x.id === site.id)!.cards.find((c) => c?.id === cardId)!;
    expect(card.secrets).toBe(1);
    expect(out.players[1].secrets.ready).toBe(readyBefore - 1);
    expect(out.players[1].favor).toBe(favorBefore + 3); // 1 + 2 matches
    expect(out.favorBanks[suit]).toBe(bankBefore - 3);
    expect(out.players[1].supply).toBe(s.players[1].supply - 1);
    checkInvariants(out);
  });

  it('clamps the favor gain to what the bank holds (Law §9.3)', () => {
    const { s, cardId, suit } = ready(2);
    s.sharedBank.favor += s.favorBanks[suit] - 1;
    s.favorBanks[suit] = 1; // wants 3, only 1 available
    const favorBefore = s.players[1].favor;
    const out = trade(s, 1, { for: 'favor', cardId });
    expect(out.players[1].favor).toBe(favorBefore + 1);
    expect(out.favorBanks[suit]).toBe(0);
    checkInvariants(out);
  });

  it('is illegal without a secret to place', () => {
    const { s, cardId } = ready(1);
    s.players[1].secrets = { ready: 0, flipped: 0 };
    expect(() => trade(s, 1, { for: 'favor', cardId })).toThrow(IllegalAction);
  });
});

describe('trade — for secrets (Law §5.3.2)', () => {
  it('places 2 favor on the card and gains one secret per matching faceup adviser', () => {
    const { s, cardId, site } = ready(2);
    s.sharedBank.favor -= 5 - s.players[1].favor;

    s.players[1].favor = 5;
    const sharedBefore = s.sharedBank.secrets;
    const readyBefore = s.players[1].secrets.ready;

    const out = trade(s, 1, { for: 'secrets', cardId });

    const card = out.sites.find((x) => x.id === site.id)!.cards.find((c) => c?.id === cardId)!;
    expect(card.favor).toBe(2);
    expect(out.players[1].favor).toBe(5 - 2);
    expect(out.players[1].secrets.ready).toBe(readyBefore + 2);
    expect(out.sharedBank.secrets).toBe(sharedBefore - 2);
    expect(out.players[1].supply).toBe(s.players[1].supply - 1);
    checkInvariants(out);
  });

  it('gains zero secrets with no matching faceup advisers, still paying', () => {
    const { s, cardId } = ready(0);
    s.sharedBank.favor -= 5 - s.players[1].favor;

    s.players[1].favor = 5;
    const readyBefore = s.players[1].secrets.ready;
    const out = trade(s, 1, { for: 'secrets', cardId });
    expect(out.players[1].secrets.ready).toBe(readyBefore);
    expect(out.players[1].favor).toBe(3);
    expect(out.players[1].supply).toBe(s.players[1].supply - 1);
    checkInvariants(out);
  });

  it('gains secrets even if the shared bank shows zero (Law §9.3: secrets are unlimited)', () => {
    const { s, cardId } = ready(3);
    s.sharedBank.favor -= 5 - s.players[1].favor;

    s.players[1].favor = 5;
    s.sharedBank.secrets = 0;
    const out = trade(s, 1, { for: 'secrets', cardId });
    expect(out.players[1].secrets.ready).toBe(s.players[1].secrets.ready + 3);
    expect(out.sharedBank.secrets).toBe(-3); // tally goes "negative"; harmless
  });

  it('is illegal with fewer than 2 favor to place', () => {
    const { s, cardId } = ready(1);
    s.sharedBank.favor += s.players[1].favor;
    s.players[1].favor = 1;
    expect(() => trade(s, 1, { for: 'secrets', cardId })).toThrow(IllegalAction);
  });
});

describe('trade — shared legality', () => {
  it('is illegal for a non-active seat', () => {
    const { s, cardId } = ready(1);
    expect(() => trade(s, 2, { for: 'favor', cardId })).toThrow(IllegalAction);
  });

  it('is illegal with insufficient Supply', () => {
    const { s, cardId } = ready(1);
    s.players[1].supply = 0;
    expect(() => trade(s, 1, { for: 'favor', cardId })).toThrow(IllegalAction);
  });

  it('is illegal against a card that already carries favor or secrets (Law §5.3.2)', () => {
    const { s, cardId, site, suit } = ready(1);
    site.cards.find((c) => c?.id === cardId)!.favor = 1;
    s.favorBanks[suit] -= 1; // source it, keep the total conserved
    expect(() => trade(s, 1, { for: 'favor', cardId })).toThrow(IllegalAction);
  });

  it('is illegal against a card that is not at your site', () => {
    const { s } = ready(1);
    const elsewhere = s.sites.find(
      (x) => x.id !== s.players[1].pawnSite && x.cards.some((c) => c !== null),
    )!;
    const cardId = elsewhere.cards.find((c) => c !== null)!.id;
    expect(() =>
      trade(s, 1, { for: 'favor', cardId, siteId: elsewhere.id }),
    ).toThrow(IllegalAction);
  });

  it('is illegal against a ruined edifice (Law §2.9)', () => {
    const { s, site } = ready(1);
    const edificeId = cards.edifices[0].id;
    site.cards[0] = { id: edificeId, favor: 0, secrets: 0, ruined: true };
    expect(() => trade(s, 1, { for: 'favor', cardId: edificeId })).toThrow(IllegalAction);
  });

  it('does not advance the turn', () => {
    const { s, cardId } = ready(1);
    const out = trade(s, 1, { for: 'favor', cardId });
    expect(out.turn.activeSeat).toBe(1);
  });
});
