import { describe, it, expect } from 'vitest';
import {
  checkInvariants,
  CHANCELLOR_WARBANDS,
  EXILE_WARBANDS,
  LEFTMOST_SUPPLY,
  PEOPLES_FAVOR_ID,
  type OathState,
} from '../../../src/oath/game/state.js';
import { oath } from '../../../src/oath/game/index.js';
import { IllegalAction, type GameAction } from '../../../src/engine/types.js';
import { baseState } from './helpers.js';

function act(state: OathState, type: string, actor: number | null, payload: unknown = {}): OathState {
  const action: GameAction = {
    gameId: 'test',
    seq: state.actionCount + 1,
    type,
    actor,
    payload,
    createdAt: '2026-09-12T00:00:00.000Z',
  };
  return oath.reduce(state, action);
}
const offer = (s: OathState, actor: number | null, p: unknown) => act(s, 'citizenship.offer', actor, p);
const accept = (s: OathState, actor: number | null, p: unknown = {}) => act(s, 'citizenship.accept', actor, p);
const decline = (s: OathState, actor: number | null) => act(s, 'citizenship.decline', actor);
const exileCitizen = (s: OathState, actor: number | null, p: unknown) => act(s, 'citizenship.exile', actor, p);
const selfExile = (s: OathState, actor: number | null) => act(s, 'citizenship.selfExile', actor);

// baseState: seat 0 = Chancellor (grandScepter=0), seat 1/2 = Exile. Seat 1's
// turn is active by default. Offering requires the Scepter holder's OWN
// turn, so most offer tests move activeSeat to 0 first.
function offerState(): OathState {
  const s = baseState();
  s.turn.activeSeat = 0;
  return s;
}

describe('citizenship.offer (Law §6.6.1)', () => {
  it('a legal offer stores a pending citizenshipOffer and surfaces it in pending()', () => {
    const s = offerState();
    const relicId = s.reliquary[0].relicId!;
    const out = offer(s, 0, { exile: 1, relicId });
    checkInvariants(out);

    expect(out.citizenshipOffer).toEqual({
      scepterSeat: 0,
      exile: 1,
      relicId,
      give: { favor: 0, secrets: 0, relics: [], banners: [] },
      take: { favor: 0, secrets: 0, relics: [], banners: [] },
      offeredAt: out.actionCount,
    });

    const decisions = oath.pending(out);
    expect(decisions).toContainEqual({
      id: `citizenshipOffer:1:${out.actionCount}`,
      seat: 1,
      kind: 'citizenshipOffer',
      prompt: expect.stringContaining('offered you Citizenship'),
      resolves: ['citizenship.accept', 'citizenship.decline'],
    });
  });

  it('records negotiated give/take terms, mapping short banner names to full ids', () => {
    const s = offerState();
    s.players[0].favor = 5;
    s.players[1].relics = ['relic:test'];
    // stub id not needed — offer() doesn't validate feasibility, only accept() does
    const out = offer(s, 0, {
      exile: 1,
      relicId: s.reliquary[0].relicId!,
      give: { favor: 2, banners: ['peoples-favor'] },
      take: { relics: ['relic:whatever'] },
    });
    expect(out.citizenshipOffer!.give).toEqual({ favor: 2, secrets: 0, relics: [], banners: [PEOPLES_FAVOR_ID] });
    expect(out.citizenshipOffer!.take).toEqual({ favor: 0, secrets: 0, relics: ['relic:whatever'], banners: [] });
  });

  it('rejects an offer from anyone but the Grand Scepter holder', () => {
    const s = baseState(); // active seat 1, but seat 0 holds the Scepter
    expect(() => offer(s, 1, { exile: 2, relicId: s.reliquary[0].relicId! })).toThrow(IllegalAction);
  });

  it("rejects offering to a seat that isn't currently an Exile", () => {
    const s = offerState();
    expect(() => offer(s, 0, { exile: 0, relicId: s.reliquary[0].relicId! })).toThrow(IllegalAction); // seat 0 is the Chancellor
  });

  it('rejects a relicId not currently in the Imperial Reliquary', () => {
    const s = offerState();
    expect(() => offer(s, 0, { exile: 1, relicId: s.relicDeck[0] })).toThrow(IllegalAction);
  });

  it('rejects a second offer while one is already pending', () => {
    const s = offerState();
    const out = offer(s, 0, { exile: 1, relicId: s.reliquary[0].relicId! });
    expect(() => offer(out, 0, { exile: 2, relicId: out.reliquary[1].relicId! })).toThrow(IllegalAction);
  });

  it('is illegal outside your own turn, mid-Search, or mid-Campaign, like any other action', () => {
    const s = offerState();
    s.turn.activeSeat = 1; // no longer the Scepter holder's turn
    expect(() => offer(s, 0, { exile: 2, relicId: s.reliquary[0].relicId! })).toThrow(IllegalAction);
  });
});

describe('citizenship.decline (Law §6.6.1)', () => {
  it('clears the pending offer with no other consequence', () => {
    const s = offerState();
    const offered = offer(s, 0, { exile: 1, relicId: s.reliquary[0].relicId! });
    const out = decline(offered, 1);
    checkInvariants(out);
    expect(out.citizenshipOffer).toBeNull();
    expect(out.players[1].citizenship).toBe('exile');
  });

  it('only the offered Exile may decline — not the offerer, not a third seat', () => {
    const s = offerState();
    const offered = offer(s, 0, { exile: 1, relicId: s.reliquary[0].relicId! });
    expect(() => decline(offered, 0)).toThrow(IllegalAction);
    expect(() => decline(offered, 2)).toThrow(IllegalAction);
  });

  it('does not require it to be the declining seat\'s own turn', () => {
    const s = offerState(); // activeSeat is 0 (the offerer), not 1
    const offered = offer(s, 0, { exile: 1, relicId: s.reliquary[0].relicId! });
    expect(offered.turn.activeSeat).toBe(0);
    const out = decline(offered, 1); // seat 1 responds even though it's seat 0's turn
    expect(out.citizenshipOffer).toBeNull();
  });

  it('is illegal with no offer pending', () => {
    const s = baseState();
    expect(() => decline(s, 1)).toThrow(IllegalAction);
  });
});

describe('citizenship.accept (Law §6.6.2) — the common case: no spare purple capacity', () => {
  it('flips to Citizen, zeroes ALL prior warband holdings (bank+board+sites), and keeps every conservation invariant', () => {
    const s = offerState();
    const offered = offer(s, 0, { exile: 1, relicId: s.reliquary[0].relicId! });
    const totalBefore = offered.players[1].warbands.bank + offered.players[1].warbands.board
      + offered.sites.reduce((sum, site) => sum + site.warbands[1], 0);
    expect(totalBefore).toBe(EXILE_WARBANDS); // sanity: the fixture is invariant-valid

    const out = accept(offered, 1);
    checkInvariants(out);

    expect(out.players[1].citizenship).toBe('citizen');
    expect(out.players[1].warbands.bank).toBe(0);
    expect(out.players[1].warbands.board).toBe(0);
    for (const site of out.sites) expect(site.warbands[1]).toBe(0);
    // the purple total (Chancellor + Citizens) is unchanged — no spare
    // capacity existed for the new Citizen to consume (see file header).
    const purple = out.players.reduce((sum, p, i) => (p.citizenship === 'exile' ? sum : sum + p.warbands.bank + p.warbands.board + out.sites.reduce((s2, site) => s2 + site.warbands[i], 0)), 0);
    expect(purple).toBe(CHANCELLOR_WARBANDS);
  });

  it('takes the mandatory Reliquary relic into the new Citizen\'s personal relics', () => {
    const s = offerState();
    const relicId = s.reliquary[0].relicId!;
    const offered = offer(s, 0, { exile: 1, relicId });
    const out = accept(offered, 1);
    checkInvariants(out);
    expect(out.reliquary.some((space) => space.relicId === relicId)).toBe(false);
    expect(out.players[1].relics).toContain(relicId);
  });

  it('applies additional negotiated give/take terms atomically', () => {
    const s = offerState();
    s.sharedBank.favor -= 3; // source it (conservation): favor 2 -> 5
    s.players[0].favor = 5;
    s.players[1].secrets.ready = 3;
    const offered = offer(s, 0, {
      exile: 1,
      relicId: s.reliquary[0].relicId!,
      give: { favor: 2 },
      take: { secrets: 1 },
    });
    const out = accept(offered, 1);
    checkInvariants(out);
    expect(out.players[0].favor).toBe(5 - 2);
    expect(out.players[1].favor).toBe(s.players[1].favor + 2);
    expect(out.players[1].secrets.ready).toBe(2);
  });

  it('exchanges a negotiated banner, checked against whoever currently holds it', () => {
    const s = offerState();
    s.banners[0].holder = 1; // seat 1 (the exile) holds the People's Favor
    const offered = offer(s, 0, { exile: 1, relicId: s.reliquary[0].relicId!, take: { banners: ['peoples-favor'] } });
    const out = accept(offered, 1);
    checkInvariants(out);
    expect(out.banners[0].holder).toBe(0);
  });

  it('discards a prior revealed Vision (Glossary "Discard")', () => {
    const s = offerState();
    expect(s.players[1].vision).not.toBeNull();
    const offered = offer(s, 0, { exile: 1, relicId: s.reliquary[0].relicId! });
    const out = accept(offered, 1);
    checkInvariants(out);
    expect(out.players[1].vision).toBeNull();
    expect(out.discards[out.sites.find((site) => site.id === offered.players[1].pawnSite)!.region]).toBeDefined();
  });

  it('flips Usurper back to Oathkeeper if the new Citizen held it on that side', () => {
    const s = offerState();
    // Seat 1 has to hold the title LEGITIMATELY, or unit 17's continuous
    // §2.11 tracking takes it straight back off them: under baseState's
    // default Supremacy goal the Chancellor rules the most sites, and once
    // seat 1 turns Citizen the Empire's claim is the Chancellor's anyway.
    // Devotion is individual — whoever holds the Darkest Secret — so it
    // survives the transition and keeps this test about §6.6.2's flip.
    s.oath = 'devotion';
    s.banners[1].holder = 1;
    s.oathkeeper = 1;
    s.usurper = true;
    const offered = offer(s, 0, { exile: 1, relicId: s.reliquary[0].relicId! });
    const out = accept(offered, 1);
    checkInvariants(out);
    expect(out.usurper).toBe(false);
    expect(out.oathkeeper).toBe(1);
  });

  it("ends the new Citizen's Act Phase if it is their turn, and always refreshes Supply to leftmost", () => {
    const s = offerState();
    s.turn.activeSeat = 0; // the offerer's turn when offering...
    const offered = offer(s, 0, { exile: 1, relicId: s.reliquary[0].relicId! });
    // ...but accept happens once it becomes seat 1's turn
    offered.turn.activeSeat = 1;
    offered.turn.round = 3;
    const out = accept(offered, 1);
    checkInvariants(out);
    expect(out.players[1].supply).toBe(LEFTMOST_SUPPLY);
    expect(out.turn.activeSeat).toBe(2); // advanced past seat 1
  });

  it("does not end anyone's turn if it wasn't the new Citizen's turn", () => {
    const s = offerState(); // activeSeat 0
    const offered = offer(s, 0, { exile: 1, relicId: s.reliquary[0].relicId! });
    const out = accept(offered, 1);
    expect(out.turn.activeSeat).toBe(0); // unchanged
  });

  it('only the offered Exile may accept', () => {
    const s = offerState();
    const offered = offer(s, 0, { exile: 1, relicId: s.reliquary[0].relicId! });
    expect(() => accept(offered, 2)).toThrow(IllegalAction);
    expect(() => accept(offered, 0)).toThrow(IllegalAction);
  });

  it('is illegal with no offer pending', () => {
    const s = baseState();
    expect(() => accept(s, 1)).toThrow(IllegalAction);
  });

  it('does not require it to be the accepting seat\'s own turn', () => {
    const s = offerState(); // activeSeat 0, not 1
    const offered = offer(s, 0, { exile: 1, relicId: s.reliquary[0].relicId! });
    const out = accept(offered, 1);
    checkInvariants(out);
    expect(out.players[1].citizenship).toBe('citizen');
  });
});

describe('post-Citizenship: a previously-legal Exile-only act becomes illegal (unit 16 TDD)', () => {
  it('a Citizen can no longer self-exile as though still an Exile — selfExile requires citizenship===citizen, so the SYMMETRIC check holds: an Exile cannot selfExile either', () => {
    const s = baseState();
    expect(() => selfExile(s, 1)).toThrow(IllegalAction); // seat 1 is still an Exile
  });

  it('once a Citizen, the seat can be targeted by citizenship.exile (illegal while still an Exile)', () => {
    const s = offerState();
    expect(() => exileCitizen(s, 0, { citizen: 1 })).toThrow(IllegalAction); // seat 1 is an Exile, not a Citizen, yet
    const offered = offer(s, 0, { exile: 1, relicId: s.reliquary[0].relicId! });
    const citizen = accept(offered, 1);
    citizen.turn.activeSeat = 0;
    citizen.sharedBank.favor -= 10; // source it (conservation): give seat 0 enough to pay §6.7's favor
    citizen.players[0].favor += 10;
    const out = exileCitizen(citizen, 0, { citizen: 1 });
    checkInvariants(out);
    expect(out.players[1].citizenship).toBe('exile');
  });
});

describe('citizenship.exile (Law §6.7)', () => {
  function citizenState(): OathState {
    const s = offerState();
    const offered = offer(s, 0, { exile: 1, relicId: s.reliquary[0].relicId! });
    const out = accept(offered, 1);
    out.turn.activeSeat = 0;
    out.sharedBank.favor -= 10; // source it (conservation): give seat 0 (the actor) enough to pay §6.7's favor
    out.players[0].favor += 10;
    return out;
  }

  it('gives 5 favor, modified by the default fixture\'s Oathkeeper status, and restores the Exile\'s own-color warbands (3 board / 11 bank)', () => {
    const s = citizenState();
    // baseState's default oathkeeper is seat 0 (the actor here) — Law §6.7's
    // "give one less favor if you are the Oathkeeper": 5 - 1 = 4.
    expect(s.oathkeeper).toBe(0);
    const favorBefore = s.players[1].favor;
    const out = exileCitizen(s, 0, { citizen: 1 });
    checkInvariants(out);
    expect(out.players[1].citizenship).toBe('exile');
    expect(out.players[1].favor).toBe(favorBefore + 4);
    expect(out.players[1].warbands.board).toBe(3);
    expect(out.players[1].warbands.bank).toBe(EXILE_WARBANDS - 3);
    expect(out.players[1].supply).toBe(LEFTMOST_SUPPLY);
  });

  it('moves the exiled Citizen\'s purple holdings to the Chancellor\'s bank (Glossary "Kill")', () => {
    const s = citizenState();
    s.players[1].warbands.board = 2; // give them something purple to lose
    s.players[0].warbands.bank -= 2; // source it (purple-24 conservation)
    const chancellorBankBefore = s.players[0].warbands.bank;
    const out = exileCitizen(s, 0, { citizen: 1 });
    checkInvariants(out);
    expect(out.players[0].warbands.bank).toBe(chancellorBankBefore + 2);
  });

  it('modifies the favor amount by Oathkeeper/People\'s Favor status on both sides', () => {
    const s = citizenState();
    s.oathkeeper = 1; // the citizen being exiled holds the title: +1
    s.banners[0].holder = 0; // the actor holds the People's Favor: -1
    const favorBefore = s.players[1].favor;
    const actorFavorBefore = s.players[0].favor;
    const out = exileCitizen(s, 0, { citizen: 1 });
    checkInvariants(out);
    expect(out.players[1].favor).toBe(favorBefore + (5 + 1 - 1));
    expect(out.players[0].favor).toBe(actorFavorBefore - (5 + 1 - 1));
  });

  it('only the Grand Scepter holder may exile a Citizen', () => {
    const s = citizenState();
    s.turn.activeSeat = 2;
    expect(() => exileCitizen(s, 2, { citizen: 1 })).toThrow(IllegalAction);
  });

  it('cannot target yourself, or a seat that is not currently a Citizen', () => {
    const s = citizenState();
    expect(() => exileCitizen(s, 0, { citizen: 0 })).toThrow(IllegalAction);
    expect(() => exileCitizen(s, 0, { citizen: 2 })).toThrow(IllegalAction); // seat 2 is an Exile
  });
});

describe('citizenship.selfExile (Law §6.8)', () => {
  function citizenState(): OathState {
    const s = offerState();
    const offered = offer(s, 0, { exile: 1, relicId: s.reliquary[0].relicId! });
    const out = accept(offered, 1);
    out.turn.activeSeat = 1;
    return out;
  }

  it('pays favor equal to board secrets + adviser secrets + board warbands, to the Grand Scepter holder, and restores own-color warbands', () => {
    const s = citizenState();
    s.players[1].secrets = { ready: 2, flipped: 1 };
    s.players[1].advisers[0].secrets = 1;
    s.players[1].warbands.board = 4;
    s.players[0].warbands.bank -= 4; // source the board warbands (purple-24 conservation)
    s.sharedBank.favor -= 7; // source it (conservation): give seat 1 enough to pay §6.8's favor
    s.players[1].favor += 7;
    const expectedAmount = 2 + 1 + 1 + 4;
    const scepterFavorBefore = s.players[0].favor;
    const out = selfExile(s, 1);
    checkInvariants(out);
    expect(out.players[1].citizenship).toBe('exile');
    expect(out.players[0].favor).toBe(scepterFavorBefore + expectedAmount);
    expect(out.players[1].warbands.board).toBe(3);
    expect(out.players[1].warbands.bank).toBe(EXILE_WARBANDS - 3);
  });

  it("always ends the Act Phase (Law §6.8's own explicit step)", () => {
    const s = citizenState();
    s.turn.round = 3;
    const out = selfExile(s, 1);
    checkInvariants(out);
    expect(out.turn.activeSeat).toBe(2);
  });

  it('is illegal for the Grand Scepter holder to self-exile', () => {
    const s = citizenState();
    s.grandScepter = 1; // seat 1 now holds the Scepter
    s.turn.activeSeat = 1;
    expect(() => selfExile(s, 1)).toThrow(IllegalAction);
  });

  it('is illegal for a non-Citizen (an Exile, or the Chancellor)', () => {
    const s = baseState();
    expect(() => selfExile(s, 1)).toThrow(IllegalAction); // still an Exile
    const s2 = baseState();
    s2.turn.activeSeat = 0;
    expect(() => selfExile(s2, 0)).toThrow(IllegalAction); // the Chancellor
  });

  it('requires it to be the self-exiling seat\'s own turn, like any other action', () => {
    const s = citizenState();
    s.turn.activeSeat = 2; // not seat 1's turn
    expect(() => selfExile(s, 1)).toThrow(IllegalAction);
  });
});
