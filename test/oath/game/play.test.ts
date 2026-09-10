import { describe, it, expect } from 'vitest';
import { byId, cards } from '../../../src/oath/cards/index.js';
import { checkInvariants, type OathState } from '../../../src/oath/game/state.js';
import { oath } from '../../../src/oath/game/index.js';
import { IllegalAction, type GameAction } from '../../../src/engine/types.js';
import { discardRegion } from '../../../src/oath/game/map.js';
import { baseState } from './helpers.js';

/** Drive `card.play` straight through the assembled reducer. */
function play(state: OathState, actor: number | null, payload: unknown): OathState {
  const action: GameAction = {
    gameId: 'test',
    seq: state.actionCount + 1,
    type: 'card.play',
    actor,
    payload,
    createdAt: '2026-09-10T00:00:00.000Z',
  };
  return oath.reduce(state, action);
}

/** baseState with a denizen and a vision in the active seat's (seat 1) hand. */
function withHand() {
  const s = baseState();
  const denizenId = s.worldDeck.shift()!; // a denizen (top of deck)
  const visionId = s.worldDeck.pop()!; // a vision (deck ends with visions)
  expect(denizenId.startsWith('denizen:')).toBe(true);
  expect(visionId.startsWith('vision:')).toBe(true);
  s.players[1].hand = [denizenId, visionId];
  return { s, denizenId, visionId };
}

describe('card.play — to a site (Law §5.1.4.1)', () => {
  it('moves the card into a slot at your site and gains one favor of its suit', () => {
    const { s, denizenId } = withHand();
    const siteId = s.players[1].pawnSite;
    const suit = (byId(denizenId) as { suit: string }).suit;
    const bankBefore = s.favorBanks[suit as keyof typeof s.favorBanks];
    const favorBefore = s.players[1].favor;

    const out = play(s, 1, { handIndex: 0, as: 'site', siteId });

    const site = out.sites.find((x) => x.id === siteId)!;
    expect(site.cards.some((c) => c?.id === denizenId)).toBe(true);
    expect(out.players[1].hand).not.toContain(denizenId);
    expect(out.favorBanks[suit as keyof typeof out.favorBanks]).toBe(bankBefore - 1);
    expect(out.players[1].favor).toBe(favorBefore + 1);
    checkInvariants(out);
  });

  it('defaults siteId to your pawn site', () => {
    const { s, denizenId } = withHand();
    const out = play(s, 1, { handIndex: 0, as: 'site' });
    const site = out.sites.find((x) => x.id === s.players[1].pawnSite)!;
    expect(site.cards.some((c) => c?.id === denizenId)).toBe(true);
  });

  it('gains nothing when the matching favor bank is empty (Law §9.3)', () => {
    const { s, denizenId } = withHand();
    const suit = (byId(denizenId) as { suit: string }).suit as keyof typeof s.favorBanks;
    s.sharedBank.favor += s.favorBanks[suit];
    s.favorBanks[suit] = 0;
    const favorBefore = s.players[1].favor;
    const out = play(s, 1, { handIndex: 0, as: 'site' });
    expect(out.players[1].favor).toBe(favorBefore);
    checkInvariants(out);
  });

  it('rejects playing to a site other than your own', () => {
    const { s, denizenId } = withHand();
    const elsewhere = s.sites.find((x) => x.id !== s.players[1].pawnSite && !x.facedown)!;
    expect(() =>
      play(s, 1, { handIndex: 0, as: 'site', siteId: elsewhere.id }),
    ).toThrow(IllegalAction);
  });

  it('rejects playing to a site at capacity (Law §2.8.1)', () => {
    const { s, denizenId } = withHand();
    const site = s.sites.find((x) => x.id === s.players[1].pawnSite)!;
    // fill every slot
    let fill = 0;
    const spare = s.worldDeck.filter((id) => id.startsWith('denizen:'));
    site.cards = site.cards.map((c) => c ?? { id: spare[fill++], favor: 0, secrets: 0 });
    s.worldDeck = s.worldDeck.filter((id) => !site.cards.some((c) => c?.id === id));
    expect(() => play(s, 1, { handIndex: 0, as: 'site' })).toThrow(IllegalAction);
  });

  it('rejects playing a Vision to a site (Law §5.1.4.3)', () => {
    const { s, visionId } = withHand();
    expect(() => play(s, 1, { handIndex: 1, as: 'site' })).toThrow(IllegalAction);
  });
});

describe('card.play — to advisers (Law §5.1.4.2)', () => {
  it('plays a denizen faceup by default', () => {
    const { s, denizenId } = withHand();
    const out = play(s, 1, { handIndex: 0, as: 'adviser' });
    const adv = out.players[1].advisers.find((a) => a.id === denizenId)!;
    expect(adv.facedown).toBe(false);
    expect(out.players[1].hand).not.toContain(denizenId);
    checkInvariants(out);
  });

  it('plays facedown when asked', () => {
    const { s, denizenId } = withHand();
    const out = play(s, 1, { handIndex: 0, as: 'adviser', facedown: true });
    expect(out.players[1].advisers.find((a) => a.id === denizenId)!.facedown).toBe(true);
    checkInvariants(out);
  });

  it('plays a Vision as a FACEDOWN adviser (allowed for anyone, Law §5.1.4.3)', () => {
    const { s, visionId } = withHand();
    const out = play(s, 1, { handIndex: 1, as: 'adviser', facedown: true });
    expect(out.players[1].advisers.find((a) => a.id === visionId)!.facedown).toBe(true);
    checkInvariants(out);
  });

  it('rejects a Vision as a FACEUP adviser (Law §5.1.4.3: "It is not an adviser!")', () => {
    const { s, visionId } = withHand();
    expect(() =>
      play(s, 1, { handIndex: 1, as: 'adviser', facedown: false }),
    ).toThrow(IllegalAction);
  });

  it('rejects a 4th adviser unless the payload names one to discard (Law §5.1.4.2)', () => {
    const { s, denizenId } = withHand();
    while (s.players[1].advisers.length < 3) {
      s.players[1].advisers.push({
        id: s.worldDeck.shift()!,
        facedown: true,
        favor: 0,
        secrets: 0,
      });
    }
    expect(() => play(s, 1, { handIndex: 0, as: 'adviser' })).toThrow(IllegalAction);

    const toDrop = s.players[1].advisers[0].id;
    const out = play(s, 1, { handIndex: 0, as: 'adviser', discardAdviserIndex: 0 });
    expect(out.players[1].advisers.map((a) => a.id)).not.toContain(toDrop);
    expect(out.players[1].advisers.map((a) => a.id)).toContain(denizenId);
    expect(out.players[1].advisers).toHaveLength(3);
    const region = discardRegion(
      out.sites.find((x) => x.id === out.players[1].pawnSite)!.region,
    );
    expect(out.discards[region]).toContain(toDrop);
    checkInvariants(out);
  });
});

describe('card.play — to the Revealed Vision space (Law §5.1.4.3)', () => {
  it('an Exile plays a Vision there, discarding any prior revealed Vision', () => {
    const { s, visionId } = withHand();
    const priorVision = s.players[1].vision!;
    expect(priorVision).not.toBeNull();

    const out = play(s, 1, { handIndex: 1, as: 'vision' });
    expect(out.players[1].vision).toBe(visionId);
    const region = discardRegion(
      out.sites.find((x) => x.id === out.players[1].pawnSite)!.region,
    );
    expect(out.discards[region]).toContain(priorVision);
    checkInvariants(out);
  });

  it('the Chancellor cannot play a Vision faceup (Law §5.1.4.3)', () => {
    const s = baseState();
    s.turn.activeSeat = 0;
    const visionId = s.worldDeck.pop()!;
    expect(visionId.startsWith('vision:')).toBe(true);
    s.players[0].hand = [visionId];
    expect(() => play(s, 0, { handIndex: 0, as: 'vision' })).toThrow(IllegalAction);
  });

  it('rejects a non-Vision card to the Revealed Vision space', () => {
    const { s, denizenId } = withHand();
    expect(() => play(s, 1, { handIndex: 0, as: 'vision' })).toThrow(IllegalAction);
  });

  it('defers the Conspiracy faceup play (Law §5.1.4.4)', () => {
    const s = baseState();
    const conspiracy = cards.visions.find((v) => v.id === 'vision:conspiracy')!;
    // remove it from wherever baseState put it, then hand it to seat 1
    s.worldDeck = s.worldDeck.filter((id) => id !== conspiracy.id);
    s.players[1].vision = s.players[1].vision === conspiracy.id ? null : s.players[1].vision;
    s.players[1].hand = [conspiracy.id];
    expect(() => play(s, 1, { handIndex: 0, as: 'vision' })).toThrow(IllegalAction);
  });
});

describe('card.play — discard the rest of the hand, and general legality', () => {
  it('discards every other card in hand into the pawn-region pile (Search §5.1.3-4)', () => {
    const { s, denizenId, visionId } = withHand();
    const out = play(s, 1, { handIndex: 0, as: 'adviser' });
    expect(out.players[1].hand).toHaveLength(0);
    const region = discardRegion(
      out.sites.find((x) => x.id === out.players[1].pawnSite)!.region,
    );
    expect(out.discards[region]).toContain(visionId);
    checkInvariants(out);
  });

  it("as: 'discard' bins the whole hand", () => {
    const { s, denizenId, visionId } = withHand();
    const out = play(s, 1, { handIndex: 0, as: 'discard' });
    expect(out.players[1].hand).toHaveLength(0);
    const region = discardRegion(
      out.sites.find((x) => x.id === out.players[1].pawnSite)!.region,
    );
    expect(out.discards[region]).toEqual(expect.arrayContaining([denizenId, visionId]));
    checkInvariants(out);
  });

  it('is illegal for a seat that is not the active one', () => {
    const { s, denizenId } = withHand();
    s.players[2].hand = [s.worldDeck.shift()!];
    expect(() => play(s, 2, { handIndex: 0, as: 'adviser' })).toThrow(
      IllegalAction,
    );
  });

  it('is illegal when the hand index is out of range (empty or short hand)', () => {
    const s = baseState();
    expect(() => play(s, 1, { handIndex: 0, as: 'adviser' })).toThrow(
      IllegalAction,
    );
  });

  it('is illegal once the game is complete', () => {
    const { s, denizenId } = withHand();
    s.complete = true;
    expect(() => play(s, 1, { handIndex: 0, as: 'adviser' })).toThrow(IllegalAction);
  });

  it('does not advance the turn (Search is one Act-Phase action)', () => {
    const { s, denizenId } = withHand();
    const out = play(s, 1, { handIndex: 0, as: 'adviser' });
    expect(out.turn.activeSeat).toBe(1);
    expect(out.turn.turnStartedAt).toBe(s.turn.turnStartedAt);
  });
});
