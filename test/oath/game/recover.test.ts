import { describe, it, expect } from 'vitest';
import { cards } from '../../../src/oath/cards/index.js';
import {
  checkInvariants,
  PEOPLES_FAVOR_ID,
  DARKEST_SECRET_ID,
  type OathState,
} from '../../../src/oath/game/state.js';
import { oath } from '../../../src/oath/game/index.js';
import { IllegalAction, type GameAction } from '../../../src/engine/types.js';
import { baseState } from './helpers.js';

function recover(state: OathState, actor: number | null, payload: unknown): OathState {
  const action: GameAction = {
    gameId: 'test',
    seq: state.actionCount + 1,
    type: 'recover',
    actor,
    payload,
    createdAt: '2026-09-10T00:00:00.000Z',
  };
  return oath.reduce(state, action);
}

// baseState: seat 1 active, pawn at sites[5], supply 4. Put a relic there.
function withRelicAtPawn() {
  const s = baseState();
  const site = s.sites.find((x) => x.id === s.players[1].pawnSite)!;
  const relicId = s.relicDeck.shift()!; // pull from the deck to keep ids unique
  site.relics = [relicId];
  return { s, site, relicId };
}

describe('recover — a relic at your site (Law §5.4)', () => {
  it('spends 1 Supply + the declared cost, and the relic reaches your board', () => {
    const { s, relicId } = withRelicAtPawn();
    s.players[1].favor = 5;
    s.sharedBank.favor -= 4; // source the extra favor
    const supplyBefore = s.players[1].supply;

    const out = recover(s, 1, {
      target: 'relic',
      relicId,
      cost: { kind: 'burnFavor' }, // §5.4.2: burn two favor
    });

    expect(out.players[1].relics).toContain(relicId);
    expect(out.sites.find((x) => x.id === out.players[1].pawnSite)!.relics).not.toContain(relicId);
    expect(out.players[1].supply).toBe(supplyBefore - 1);
    expect(out.players[1].favor).toBe(5 - 2);
    checkInvariants(out);
  });

  it("'placeFavor' puts 3 favor in the named suit bank; 'burnFavor' goes to the shared bank", () => {
    const { s, relicId } = withRelicAtPawn();
    s.players[1].favor = 5;
    s.sharedBank.favor -= 4;
    const bankBefore = s.favorBanks.hearth;

    const out = recover(s, 1, {
      target: 'relic',
      relicId,
      cost: { kind: 'placeFavor', suit: 'hearth' },
    });
    expect(out.favorBanks.hearth).toBe(bankBefore + 3);
    expect(out.players[1].favor).toBe(5 - 3);
    checkInvariants(out);
  });

  it("'burnSecret' burns 1 or 2 secrets to the shared bank", () => {
    const { s, relicId } = withRelicAtPawn();
    s.players[1].secrets = { ready: 3, flipped: 0 };
    const sharedBefore = s.sharedBank.secrets;
    const out = recover(s, 1, {
      target: 'relic',
      relicId,
      cost: { kind: 'burnSecret', amount: 2 },
    });
    expect(out.players[1].secrets.ready).toBe(1);
    expect(out.sharedBank.secrets).toBe(sharedBefore + 2);
    checkInvariants(out);
  });

  it('is illegal against a relic that is not at your site', () => {
    const s = baseState();
    // baseState puts a relic at sites[1]; seat 1's pawn is at sites[5]
    const relicId = s.sites[1].relics[0];
    expect(() =>
      recover(s, 1, { target: 'relic', relicId, cost: { kind: 'burnFavor' } }),
    ).toThrow(IllegalAction);
  });

  it("is illegal when you can't pay the declared cost", () => {
    const { s, relicId } = withRelicAtPawn();
    s.sharedBank.favor += s.players[1].favor;
    s.players[1].favor = 1; // needs 2 to burn
    expect(() =>
      recover(s, 1, { target: 'relic', relicId, cost: { kind: 'burnFavor' } }),
    ).toThrow(IllegalAction);
  });

  it('is illegal with insufficient Supply', () => {
    const { s, relicId } = withRelicAtPawn();
    s.players[1].supply = 0;
    s.players[1].favor = 5;
    s.sharedBank.favor -= 4;
    expect(() =>
      recover(s, 1, { target: 'relic', relicId, cost: { kind: 'burnFavor' } }),
    ).toThrow(IllegalAction);
  });
});

describe("recover — the People's Favor (Law §5.4.2 / §5.4.4)", () => {
  it('pays MORE favor than the current stake; that becomes the new stake', () => {
    const s = baseState();
    s.players[1].favor = 5;
    s.sharedBank.favor -= 4;
    const banner = s.banners.find((b) => b.id === PEOPLES_FAVOR_ID)!;
    expect(banner.tokens).toBe(1);

    const out = recover(s, 1, { target: 'banner', bannerId: 'peoples-favor', pay: 2 });

    const nb = out.banners.find((b) => b.id === PEOPLES_FAVOR_ID)!;
    expect(nb.holder).toBe(1);
    expect(nb.tokens).toBe(2); // the favor you paid
    expect(nb.mob).toBe(false);
    expect(out.players[1].favor).toBe(5 - 2);
    checkInvariants(out); // the old 1 favor went back to a bank
  });

  it('rejects paying only as much as the current stake ("more", not "equal")', () => {
    const s = baseState();
    s.players[1].favor = 5;
    s.sharedBank.favor -= 4;
    expect(() =>
      recover(s, 1, { target: 'banner', bannerId: 'peoples-favor', pay: 1 }),
    ).toThrow(IllegalAction);
  });

  it('flips off the Mob side and returns the old stake to the banks', () => {
    const s = baseState();
    s.players[1].favor = 8;
    s.sharedBank.favor -= 7;
    const banner = s.banners.find((b) => b.id === PEOPLES_FAVOR_ID)!;
    banner.mob = true;
    banner.tokens = 3;
    s.sharedBank.favor -= 2; // it started at 1; add 2 more onto the banner
    const banksBefore = Object.values(s.favorBanks).reduce((a, b) => a + b, 0);

    const out = recover(s, 1, { target: 'banner', bannerId: 'peoples-favor', pay: 5 });
    const nb = out.banners.find((b) => b.id === PEOPLES_FAVOR_ID)!;
    expect(nb.mob).toBe(false);
    expect(nb.tokens).toBe(5);
    const banksAfter = Object.values(out.favorBanks).reduce((a, b) => a + b, 0);
    expect(banksAfter).toBe(banksBefore + 3); // the old 3 went back to banks
    checkInvariants(out);
  });
});

describe('recover — the Darkest Secret (Law §5.4.2 / §5.4.4)', () => {
  it('pays MORE secrets than the stake; recoverer takes 1 old secret, new stake is what you paid', () => {
    const s = baseState();
    s.players[1].secrets = { ready: 5, flipped: 0 };
    const banner = s.banners.find((b) => b.id === DARKEST_SECRET_ID)!;
    expect(banner.tokens).toBe(1);

    const out = recover(s, 1, { target: 'banner', bannerId: 'darkest-secret', pay: 3 });

    const nb = out.banners.find((b) => b.id === DARKEST_SECRET_ID)!;
    expect(nb.holder).toBe(1);
    expect(nb.tokens).toBe(3);
    // took 1 of the old stake back, then paid 3
    expect(out.players[1].secrets.ready).toBe(5 + 1 - 3);
    checkInvariants(out);
  });

  it('when recovered from another holder, the rest of the old stake goes to that holder', () => {
    const s = baseState();
    const banner = s.banners.find((b) => b.id === DARKEST_SECRET_ID)!;
    banner.holder = 0;
    banner.tokens = 3;
    s.players[0].secrets = { ready: 0, flipped: 0 };
    s.players[1].secrets = { ready: 6, flipped: 0 };
    // holder (seat 0) has a card at their site whose suit isn't among their
    // advisers, so §5.4.1 permits the recovery — baseState seat 0 pawn is at
    // sites[0] which has a denizen, and seat 0's one adviser is faceup.
    const site0 = s.sites.find((x) => x.id === s.players[0].pawnSite)!;
    expect(site0.cards.some((c) => c !== null)).toBe(true);

    const out = recover(s, 1, { target: 'banner', bannerId: 'darkest-secret', pay: 4 });
    const nb = out.banners.find((b) => b.id === DARKEST_SECRET_ID)!;
    expect(nb.holder).toBe(1);
    expect(nb.tokens).toBe(4);
    expect(out.players[1].secrets.ready).toBe(6 + 1 - 4); // took 1, paid 4
    expect(out.players[0].secrets.ready).toBe(0 + 2); // got the other 2
    checkInvariants(out);
  });

  it("§5.4.1: can't recover the Darkest Secret from a holder whose every site card matches an adviser", () => {
    const s = baseState();
    const banner = s.banners.find((b) => b.id === DARKEST_SECRET_ID)!;
    banner.holder = 0;
    // make seat 0's single site card's suit match seat 0's faceup adviser
    const site0 = s.sites.find((x) => x.id === s.players[0].pawnSite)!;
    const card = site0.cards.find((c) => c !== null)!;
    const suit = (cards.denizens.find((d) => d.id === card.id) as any).suit;
    const matchId = s.worldDeck.find(
      (id) => id.startsWith('denizen:') && (cards.denizens.find((d) => d.id === id) as any).suit === suit,
    )!;
    s.worldDeck = s.worldDeck.filter((id) => id !== matchId);
    s.players[0].advisers = [{ id: matchId, facedown: false, favor: 0, secrets: 0 }];
    s.players[1].secrets = { ready: 5, flipped: 0 };

    expect(() =>
      recover(s, 1, { target: 'banner', bannerId: 'darkest-secret', pay: 3 }),
    ).toThrow(IllegalAction);
  });
});

describe('recover — shared legality', () => {
  it('is illegal for a non-active seat', () => {
    const { s, relicId } = withRelicAtPawn();
    expect(() =>
      recover(s, 2, { target: 'relic', relicId, cost: { kind: 'burnFavor' } }),
    ).toThrow(IllegalAction);
  });

  it('does not advance the turn', () => {
    const s = baseState();
    s.players[1].favor = 5;
    s.sharedBank.favor -= 4;
    const out = recover(s, 1, { target: 'banner', bannerId: 'peoples-favor', pay: 2 });
    expect(out.turn.activeSeat).toBe(1);
  });
});
