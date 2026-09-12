import { describe, it, expect } from 'vitest';
import { checkInvariants, CONSPIRACY_ID, type OathState } from '../../../src/oath/game/state.js';
import { oath } from '../../../src/oath/game/index.js';
import { byId, cards } from '../../../src/oath/cards/index.js';
import type { Suit } from '../../../src/oath/cards/schema.js';
import { discardRegion } from '../../../src/oath/game/map.js';
import { IllegalAction, type GameAction } from '../../../src/engine/types.js';
import { baseState } from './helpers.js';
import { restrictionsOf } from '../../../src/oath/game/restrictions.js';

function act(state: OathState, type: string, actor: number | null, payload: unknown = {}): OathState {
  const action: GameAction = {
    gameId: 'test',
    seq: state.actionCount + 1,
    type,
    actor,
    payload,
    createdAt: '2026-09-11T00:00:00.000Z',
  };
  return oath.reduce(structuredClone(state), action);
}

// baseState: seat 1 is the active Exile, pawn at sites[5] (River), with a
// single FACEDOWN adviser and 2 warbands at that site. Seat 0's one adviser
// is faceup; seat 2 has none.

describe('adviser.play — faceup (Law §6.1 via §5.1.4)', () => {
  it('turns a facedown denizen over in place: same slot, same count, and NO favor', () => {
    const s = baseState();
    const cardId = s.players[1].advisers[0].id;
    const favorBefore = s.players[1].favor;
    const banksBefore = { ...s.favorBanks };

    const out = act(s, 'adviser.play', 1, { adviserIndex: 0, as: 'faceup' });
    checkInvariants(out);

    expect(out.players[1].advisers).toHaveLength(1);
    expect(out.players[1].advisers[0]).toMatchObject({ id: cardId, facedown: false });
    // Law §5.1.4.1's favor is for playing TO A SITE. §6.1 plays to neither a
    // site nor a new adviser slot, so nothing is gained and no bank moves.
    expect(out.players[1].favor).toBe(favorBefore);
    expect(out.favorBanks).toEqual(banksBefore);
  });

  it('an Exile revealing a facedown Vision moves it to the Revealed Vision space, discarding the old one', () => {
    const s = baseState();
    const visionId = cards.visions[1].id; // not seat 1's already-revealed one
    s.worldDeck = s.worldDeck.filter((id) => id !== visionId);
    s.players[1].advisers[0] = { id: visionId, facedown: true, favor: 0, secrets: 0 };
    const previous = s.players[1].vision!;
    const region = s.sites.find((site) => site.id === s.players[1].pawnSite)!.region;

    const out = act(s, 'adviser.play', 1, { adviserIndex: 0, as: 'faceup' });
    checkInvariants(out);

    expect(out.players[1].vision).toBe(visionId);
    expect(out.players[1].advisers).toHaveLength(0); // it left the adviser row (Law §2.2.1: not an adviser!)
    expect(out.discards[discardRegion(region)][0]).toBe(previous); // Law §5.1.4.3
  });

  it('is illegal for the Chancellor or a Citizen to reveal a Vision (Law §5.1.4.3)', () => {
    const s = baseState();
    const visionId = cards.visions[1].id;
    s.worldDeck = s.worldDeck.filter((id) => id !== visionId);
    s.turn.activeSeat = 0;
    s.players[0].advisers.push({ id: visionId, facedown: true, favor: 0, secrets: 0 });
    expect(() => act(s, 'adviser.play', 0, { adviserIndex: 1, as: 'faceup' })).toThrow(/only an Exile/);

    const c = baseState();
    c.worldDeck = c.worldDeck.filter((id) => id !== visionId);
    c.players[2].citizenship = 'citizen';
    c.players[2].warbands = { bank: 0, board: 0 };
    c.players[0].warbands.bank = 18;
    c.turn.activeSeat = 2;
    c.players[2].advisers.push({ id: visionId, facedown: true, favor: 0, secrets: 0 });
    expect(() => act(c, 'adviser.play', 2, { adviserIndex: 0, as: 'faceup' })).toThrow(/only an Exile/);
  });

  it("leaves the Conspiracy's faceup play to v1 declaration (Law §5.1.4.4)", () => {
    const s = baseState();
    s.worldDeck = s.worldDeck.filter((id) => id !== CONSPIRACY_ID);
    s.players[1].advisers[0] = { id: CONSPIRACY_ID, facedown: true, favor: 0, secrets: 0 };
    expect(() => act(s, 'adviser.play', 1, { adviserIndex: 0, as: 'faceup' })).toThrow(/Conspiracy/);
  });
});

describe('adviser.play — discard (Law §6.1, Glossary "Discard")', () => {
  it('bins it to the pawn region\'s downstream pile', () => {
    const s = baseState();
    const cardId = s.players[1].advisers[0].id;
    const region = s.sites.find((site) => site.id === s.players[1].pawnSite)!.region;
    const out = act(s, 'adviser.play', 1, { adviserIndex: 0, as: 'discard' });
    checkInvariants(out);
    expect(out.players[1].advisers).toHaveLength(0);
    expect(out.discards[discardRegion(region)][0]).toBe(cardId);
  });
});

describe('adviser.play — illegal actors and states', () => {
  it('reaches only FACEDOWN advisers (Law §6.1; cf. §5.1.4.2)', () => {
    const s = baseState();
    s.turn.activeSeat = 0; // seat 0's single adviser is faceup
    expect(() => act(s, 'adviser.play', 0, { adviserIndex: 0, as: 'faceup' })).toThrow(/FACEDOWN/);
    expect(() => act(s, 'adviser.play', 0, { adviserIndex: 0, as: 'discard' })).toThrow(/FACEDOWN/);
  });

  it('rejects an out-of-range index and a malformed payload', () => {
    const s = baseState();
    expect(() => act(s, 'adviser.play', 1, { adviserIndex: 5, as: 'faceup' })).toThrow(/no adviser at index/);
    expect(() => act(s, 'adviser.play', 1, { adviserIndex: 0, as: 'sideways' })).toThrow(/malformed/);
  });

  it('is illegal out of turn, mid-Search, and mid-Campaign', () => {
    const s = baseState();
    expect(() => act(s, 'adviser.play', 2, { adviserIndex: 0, as: 'faceup' })).toThrow(/not seat 2's turn/);

    const searching = baseState();
    searching.players[1].hand = [searching.worldDeck[0]];
    searching.worldDeck = searching.worldDeck.slice(1);
    expect(() => act(searching, 'adviser.play', 1, { adviserIndex: 0, as: 'faceup' })).toThrow(/Search/);

    const campaigning = baseState();
    campaigning.players[2].pawnSite = campaigning.sites[5].id;
    const declared = act(campaigning, 'campaign.declare', 1, {
      defender: 2,
      targets: [{ kind: 'pawnFavor' }],
      attackDice: 1,
    });
    expect(() => act(declared, 'adviser.play', 1, { adviserIndex: 0, as: 'faceup' })).toThrow(/Campaign/);
  });
});

describe('warbands.move — no permission needed (Law §6.5)', () => {
  it('toBoard moves warbands home, but never the last one', () => {
    const s = baseState(); // seat 1 has 2 warbands at their own site
    const out = act(s, 'warbands.move', 1, { direction: 'toBoard', count: 1 });
    checkInvariants(out);
    expect(out.sites[5].warbands[1]).toBe(1);
    expect(out.players[1].warbands.board).toBe(4);

    // The last one may not leave — §7.6.5's Bandit Crown exists to lift this.
    expect(() => act(s, 'warbands.move', 1, { direction: 'toBoard', count: 2 })).toThrow(/must leave one/);
    expect(() => act(out, 'warbands.move', 1, { direction: 'toBoard', count: 1 })).toThrow(/must leave one/);
  });

  it('toSite reinforces a site you rule', () => {
    const s = baseState();
    const out = act(s, 'warbands.move', 1, { direction: 'toSite', count: 3 });
    checkInvariants(out);
    expect(out.sites[5].warbands[1]).toBe(5);
    expect(out.players[1].warbands.board).toBe(0);
  });

  it('toSite is illegal where you do not rule — you cannot bootstrap a garrison', () => {
    const s = baseState();
    s.players[1].pawnSite = s.sites[3].id; // Barren Coast: nobody's warbands
    expect(() => act(s, 'warbands.move', 1, { direction: 'toSite', count: 1 })).toThrow(/must rule your site/);
  });

  it('§6.6.3 counts: a Citizen rules a purple site and may reinforce it', () => {
    const s = baseState();
    s.players[2].citizenship = 'citizen';
    s.players[2].warbands = { bank: 0, board: 3 };
    s.players[0].warbands.bank = 15;
    s.players[2].pawnSite = s.sites[0].id; // garrisoned only by the Chancellor
    s.turn.activeSeat = 2;
    expect(s.sites[0].warbands[2]).toBe(0);
    const out = act(s, 'warbands.move', 2, { direction: 'toSite', count: 2 });
    checkInvariants(out);
    expect(out.sites[0].warbands[2]).toBe(2);
  });

  it('rejects counts beyond what is there', () => {
    const s = baseState();
    expect(() => act(s, 'warbands.move', 1, { direction: 'toSite', count: 4 })).toThrow(IllegalAction);
    expect(() => act(s, 'warbands.move', 1, { direction: 'toBoard', count: 0 })).toThrow(/malformed/);
  });

  it('the Chancellor and Exiles need nobody\'s permission for toBoard', () => {
    const s = baseState();
    s.turn.activeSeat = 0; // the Chancellor, 2 warbands at their own site
    const out = act(s, 'warbands.move', 0, { direction: 'toBoard', count: 1 });
    checkInvariants(out);
    expect(out.warbandRequest).toBeNull();
    expect(out.players[0].warbands.board).toBe(4);
  });
});

describe("warbands.move — a Citizen needs the Chancellor's permission (Law §6.5)", () => {
  function citizenAtSite(): OathState {
    const s = baseState();
    s.players[2].citizenship = 'citizen';
    s.players[2].warbands = { bank: 0, board: 1 };
    s.sites[2].warbands[2] = 2; // the Citizen garrisons their own site
    s.players[0].warbands.bank = 15; // 15 + 3 + 2 + 1 = 21, + the Citizen's 3 = 24
    s.turn.activeSeat = 2;
    checkInvariants(s);
    return s;
  }

  it('records the request instead of moving, and asks the Chancellor', () => {
    const s = citizenAtSite();
    const out = act(s, 'warbands.move', 2, { direction: 'toBoard', count: 1 });
    checkInvariants(out);

    expect(out.sites[2].warbands[2]).toBe(2); // nothing has moved yet
    expect(out.warbandRequest).toEqual({
      seat: 2,
      approver: 0,
      direction: 'toBoard',
      count: 1,
      target: null,
      requestedAt: out.actionCount,
    });
    expect(oath.pending(out)).toContainEqual({
      id: `warbands:0:${out.actionCount}`,
      seat: 0,
      kind: 'warbands',
      prompt: expect.stringContaining('permission'),
      resolves: ['warbands.allow', 'warbands.deny'],
    });
  });

  it('allow applies the move; deny clears it without moving anything', () => {
    const asked = act(citizenAtSite(), 'warbands.move', 2, { direction: 'toBoard', count: 1 });

    const allowed = act(asked, 'warbands.allow', 0);
    checkInvariants(allowed);
    expect(allowed.warbandRequest).toBeNull();
    expect(allowed.sites[2].warbands[2]).toBe(1);
    expect(allowed.players[2].warbands.board).toBe(2);

    const denied = act(asked, 'warbands.deny', 0);
    checkInvariants(denied);
    expect(denied.warbandRequest).toBeNull();
    expect(denied.sites[2].warbands[2]).toBe(2);
    expect(denied.players[2].warbands.board).toBe(1);
  });

  it('only the named approver may answer', () => {
    const asked = act(citizenAtSite(), 'warbands.move', 2, { direction: 'toBoard', count: 1 });
    expect(() => act(asked, 'warbands.allow', 2)).toThrow(/only seat 0/);
    expect(() => act(asked, 'warbands.allow', 1)).toThrow(/only seat 0/);
    expect(() => act(asked, 'warbands.deny', 1)).toThrow(/only seat 0/);
  });

  it('answering with nothing pending is illegal-state', () => {
    const s = citizenAtSite();
    expect(() => act(s, 'warbands.allow', 0)).toThrow(/no warband permission is pending/);
  });

  it('holds one request at a time', () => {
    const asked = act(citizenAtSite(), 'warbands.move', 2, { direction: 'toBoard', count: 1 });
    expect(() => act(asked, 'warbands.move', 2, { direction: 'toBoard', count: 1 })).toThrow(/already pending/);
  });

  it('re-validates on approval — permission is not a snapshot of the board', () => {
    const asked = act(citizenAtSite(), 'warbands.move', 2, { direction: 'toBoard', count: 1 });
    // The request does not lock the game, so the warbands it named can be
    // gone by the time the Chancellor answers.
    const moved = structuredClone(asked);
    moved.sites[2].warbands[2] = 1; // ...and now taking one would take the last
    moved.players[2].warbands.board = 2;
    expect(() => act(moved, 'warbands.allow', 0)).toThrow(/must leave one/);
  });

  it('rejects an illegal move at the asker, before the Chancellor is bothered', () => {
    const s = citizenAtSite();
    expect(() => act(s, 'warbands.move', 2, { direction: 'toBoard', count: 2 })).toThrow(/must leave one/);
  });
});

describe('warbands.move — the Imperial give/take (Law §6.5)', () => {
  function twoImperials(): OathState {
    const s = baseState();
    s.players[2].citizenship = 'citizen';
    s.players[2].warbands = { bank: 0, board: 3 };
    s.players[0].warbands.bank = 15;
    s.players[2].pawnSite = s.sites[0].id; // co-located with the Chancellor's pawn
    s.turn.activeSeat = 0;
    checkInvariants(s);
    return s;
  }

  it('giving needs the recipient\'s permission, and moves board to board on approval', () => {
    const s = twoImperials();
    const asked = act(s, 'warbands.move', 0, { direction: 'give', count: 2, target: 2 });
    checkInvariants(asked);
    expect(asked.warbandRequest).toMatchObject({ seat: 0, approver: 2, direction: 'give', count: 2, target: 2 });
    expect(asked.players[0].warbands.board).toBe(3); // nothing yet

    const out = act(asked, 'warbands.allow', 2);
    checkInvariants(out);
    expect(out.players[0].warbands.board).toBe(1);
    expect(out.players[2].warbands.board).toBe(5);
  });

  it('taking needs the same permission, from the same seat', () => {
    const s = twoImperials();
    const asked = act(s, 'warbands.move', 0, { direction: 'take', count: 3, target: 2 });
    expect(asked.warbandRequest).toMatchObject({ approver: 2, direction: 'take' });
    const out = act(asked, 'warbands.allow', 2);
    checkInvariants(out);
    expect(out.players[2].warbands.board).toBe(0);
    expect(out.players[0].warbands.board).toBe(6);
  });

  it('is illegal with an Exile on either end, or when their pawn is elsewhere', () => {
    const s = twoImperials();
    expect(() => act(s, 'warbands.move', 0, { direction: 'give', count: 1, target: 1 })).toThrow(
      /between two Imperial players/,
    );
    expect(() => act(s, 'warbands.move', 0, { direction: 'give', count: 1, target: 0 })).toThrow(
      /yourself/,
    );

    const apart = twoImperials();
    apart.players[2].pawnSite = apart.sites[5].id; // no longer at the Chancellor's site
    expect(() => act(apart, 'warbands.move', 0, { direction: 'give', count: 1, target: 2 })).toThrow(
      /pawn must be at your site/,
    );
  });

  it('needs a target seat, and toBoard/toSite must not carry one', () => {
    const s = twoImperials();
    expect(() => act(s, 'warbands.move', 0, { direction: 'give', count: 1 })).toThrow(/needs a target seat/);
    expect(() => act(s, 'warbands.move', 0, { direction: 'toSite', count: 1, target: 2 })).toThrow(
      /does not take a target seat/,
    );
  });
});

describe('warbands.move — turn locks', () => {
  it('is illegal out of turn, mid-Search, and mid-Campaign', () => {
    const s = baseState();
    expect(() => act(s, 'warbands.move', 2, { direction: 'toBoard', count: 1 })).toThrow(/not seat 2's turn/);

    const searching = baseState();
    searching.players[1].hand = [searching.worldDeck[0]];
    searching.worldDeck = searching.worldDeck.slice(1);
    expect(() => act(searching, 'warbands.move', 1, { direction: 'toBoard', count: 1 })).toThrow(/Search/);

    const campaigning = baseState();
    campaigning.players[2].pawnSite = campaigning.sites[5].id;
    const declared = act(campaigning, 'campaign.declare', 1, {
      defender: 2,
      targets: [{ kind: 'pawnFavor' }],
      attackDice: 1,
    });
    expect(() => act(declared, 'warbands.move', 1, { direction: 'toBoard', count: 1 })).toThrow(/Campaign/);
  });
});

describe('§7.2 restriction banners (unit 19, scoped data — Q12/D46)', () => {
  // Council Seat is chained AND person-restricted; Ancient Forge is chained
  // and tree-restricted. Both read off their card faces (RULINGS/provenance).
  const COUNCIL_SEAT = 'denizen:council-seat';
  // Keep is the tree-restricted DENIZEN. Ancient Forge carries the same
  // banner but is an edifice, which can never be drawn into a hand (§2.9),
  // so its tree restriction is unreachable from card.play by construction.
  const KEEP = 'denizen:keep';

  /**
   * Put `cardId` in seat 1's hand, mid-Search, so card.play can reach it —
   * lifting it out of wherever baseState happened to deal it first, since a
   * card may only ever be in one zone.
   */
  function inHand(cardId: string): OathState {
    const s = baseState();
    s.worldDeck = s.worldDeck.filter((id) => id !== cardId);
    for (const site of s.sites) {
      site.cards = site.cards.map((c) => (c?.id === cardId ? null : c));
    }
    for (const p of s.players) p.advisers = p.advisers.filter((a) => a.id !== cardId);
    s.players[1].hand = [cardId];
    s.players[1].handDrawnAt = s.actionCount;
    checkInvariants(s);
    return s;
  }

  it('a person-restricted card cannot be played to a site (§7.2.1)', () => {
    const s = inHand(COUNCIL_SEAT);
    expect(() => act(s, 'card.play', 1, { handIndex: 0, as: 'site' })).toThrow(/only.*advisers/);
    const out = act(s, 'card.play', 1, { handIndex: 0, as: 'adviser' });
    checkInvariants(out);
    expect(out.players[1].advisers.some((a) => a.id === COUNCIL_SEAT)).toBe(true);
  });

  it('a tree-restricted card cannot be turned faceup among your advisers (§7.2.1)', () => {
    const s = inHand(KEEP);
    expect(() => act(s, 'card.play', 1, { handIndex: 0, as: 'adviser' })).toThrow(/only.*to a site/);
  });

  it('...but MAY be played facedown — §7.2 applies to faceup cards only', () => {
    const s = inHand(KEEP);
    const out = act(s, 'card.play', 1, { handIndex: 0, as: 'adviser', facedown: true });
    checkInvariants(out);
    const held = out.players[1].advisers.find((a) => a.id === KEEP)!;
    expect(held.facedown).toBe(true);

    // ...and the restriction only bites when §6.1 tries to turn it over,
    // at which point the card's only way out is the discard.
    out.turn.activeSeat = 1;
    const index = out.players[1].advisers.findIndex((a) => a.id === KEEP);
    expect(() => act(out, 'adviser.play', 1, { adviserIndex: index, as: 'faceup' })).toThrow(
      /cannot be turned faceup/,
    );
    const discarded = act(out, 'adviser.play', 1, { adviserIndex: index, as: 'discard' });
    checkInvariants(discarded);
    expect(discarded.players[1].advisers.some((a) => a.id === KEEP)).toBe(false);
  });

  it('a LOCKED card cannot be discarded once faceup, but can while facedown (§7.2.2 + the preamble)', () => {
    const s = baseState();
    s.worldDeck = s.worldDeck.filter((id) => id !== COUNCIL_SEAT);
    // Seat 1 is at the adviser limit, so playing another forces a discard.
    s.players[1].advisers = [
      { id: COUNCIL_SEAT, facedown: false, favor: 0, secrets: 0 },
      { id: s.worldDeck[0], facedown: true, favor: 0, secrets: 0 },
      { id: s.worldDeck[1], facedown: true, favor: 0, secrets: 0 },
    ];
    s.players[1].hand = [s.worldDeck[2]];
    s.players[1].handDrawnAt = s.actionCount;
    s.worldDeck = s.worldDeck.slice(3);
    checkInvariants(s);

    expect(() =>
      act(s, 'card.play', 1, { handIndex: 0, as: 'adviser', facedown: true, discardAdviserIndex: 0 }),
    ).toThrow(/locked/);

    // The same card facedown is discardable — §7.2's preamble again.
    const facedown = structuredClone(s);
    facedown.players[1].advisers[0].facedown = true;
    const out = act(facedown, 'card.play', 1, {
      handIndex: 0,
      as: 'adviser',
      facedown: true,
      discardAdviserIndex: 0,
    });
    checkInvariants(out);
    expect(out.players[1].advisers.some((a) => a.id === COUNCIL_SEAT)).toBe(false);
  });

  it('an UNREAD card is unenforced, not assumed unrestricted', () => {
    // Nothing in the data file, so the engine has no opinion and allows it —
    // the partial-transcription contract (D46).
    const base = baseState();
    const unread = base.worldDeck.find(
      (id) => id.startsWith('denizen:') && restrictionsOf(id) === null,
    )!;
    expect(restrictionsOf(unread)).toBeNull();
    const s = inHand(unread);
    checkInvariants(act(s, 'card.play', 1, { handIndex: 0, as: 'site' }));
  });
});

describe('Glossary §10.5 — a discarded card\'s tokens (unit 20 rules review)', () => {
  it("sends favor to its suit bank and secrets to the acting seat's board, FACEDOWN", () => {
    const s = baseState();
    const adviser = s.players[1].advisers[0];
    adviser.favor = 1;
    adviser.secrets = 2;
    s.sharedBank.favor -= 1; // source it (conservation)
    const suit = (byId(adviser.id) as { suit: Suit }).suit;
    const bankBefore = s.favorBanks[suit];
    const flippedBefore = s.players[1].secrets.flipped;
    checkInvariants(s);

    const out = act(s, 'adviser.play', 1, { adviserIndex: 0, as: 'discard' });
    checkInvariants(out);
    expect(out.favorBanks[suit]).toBe(bankBefore + 1); // §10.5, to the MATCHING bank
    expect(out.players[1].secrets.flipped).toBe(flippedBefore + 2); // facedown, not ready
    expect(out.players[1].secrets.ready).toBe(s.players[1].secrets.ready);
  });

  it('also applies to §5.1.4.2\'s adviser-limit discard, which used to refuse outright', () => {
    const s = baseState();
    s.players[1].advisers = [
      { id: s.worldDeck[0], facedown: true, favor: 0, secrets: 1 },
      { id: s.worldDeck[1], facedown: true, favor: 0, secrets: 0 },
      { id: s.worldDeck[2], facedown: true, favor: 0, secrets: 0 },
    ];
    s.players[1].hand = [s.worldDeck[3]];
    s.players[1].handDrawnAt = s.actionCount;
    s.worldDeck = s.worldDeck.slice(4);
    checkInvariants(s);

    const out = act(s, 'card.play', 1, {
      handIndex: 0,
      as: 'adviser',
      facedown: true,
      discardAdviserIndex: 0,
    });
    checkInvariants(out);
    expect(out.players[1].secrets.flipped).toBe(s.players[1].secrets.flipped + 1);
    expect(out.players[1].advisers).toHaveLength(3);
  });
});
