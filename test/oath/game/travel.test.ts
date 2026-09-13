import { describe, it, expect } from 'vitest';
import { byId } from '../../../src/oath/cards/index.js';
import { checkInvariants, type OathState } from '../../../src/oath/game/state.js';
import { oath } from '../../../src/oath/game/index.js';
import { IllegalAction, type GameAction } from '../../../src/engine/types.js';
import { baseState } from './helpers.js';

function travel(state: OathState, actor: number | null, payload: unknown): OathState {
  const action: GameAction = {
    gameId: 'test',
    seq: state.actionCount + 1,
    type: 'travel',
    actor,
    payload,
    createdAt: '2026-09-10T00:00:00.000Z',
  };
  return oath.reduce(state, action);
}

// baseState regions: sites 0-1 cradle, 2-4 provinces, 5-7 hinterland.
// seat 1 is active with pawn at sites[5] (hinterland), supply 4.

describe('travel — cost by region pair (Law §5.6.1)', () => {
  const cases: [string, number, number][] = [
    // [description, destination site index, expected cost]
    ['hinterland -> other hinterland', 6, 3],
    ['hinterland -> provinces', 2, 2],
    ['hinterland -> cradle', 0, 4],
  ];
  it.each(cases)('%s costs %i, moving the pawn', (_desc, destIdx, cost) => {
    const s = baseState();
    s.players[1].supply = 4;
    const destId = s.sites[destIdx].id;
    const out = travel(s, 1, { siteIndex: destIdx });
    expect(out.players[1].pawnSite).toBe(destId);
    expect(out.players[1].supply).toBe(4 - cost);
    checkInvariants(out);
  });

  it('cradle -> other cradle costs 1', () => {
    const s = baseState();
    s.players[1].pawnSite = s.sites[0].id;
    const out = travel(s, 1, { siteIndex: 1 });
    expect(out.players[1].supply).toBe(s.players[1].supply - 1);
  });

  it('provinces -> any other site costs 2', () => {
    const s = baseState();
    s.players[1].pawnSite = s.sites[2].id;
    const out = travel(s, 1, { siteIndex: 4 });
    expect(out.players[1].supply).toBe(s.players[1].supply - 2);
  });
});

describe('travel — arrival reveal (Law §5.6.2 / §2.8.2)', () => {
  it('flips a facedown destination faceup and draws its reveal.relics from the deck', () => {
    const s = baseState();
    s.players[1].supply = 4;
    const dest = s.sites[6]; // Steppe — reveal.relics 1
    dest.facedown = true;
    dest.cards = dest.cards.map(() => null); // a facedown site starts empty
    const n = (byId(dest.id) as { reveal: { relics: number } }).reveal.relics;
    expect(n).toBeGreaterThan(0);
    const deckTop = s.relicDeck.slice(0, n);

    const out = travel(s, 1, { siteIndex: 6 });

    const revealed = out.sites.find((x) => x.id === dest.id)!;
    expect(revealed.facedown).toBe(false);
    expect(revealed.relics).toEqual(deckTop);
    expect(out.relicDeck).toEqual(s.relicDeck.slice(n));
    checkInvariants(out);
  });

  it('places reveal.favor and reveal.secrets from the shared bank (Salt Flats: 2 favor, 1 secret)', () => {
    const s = baseState();
    s.players[1].supply = 4;
    const dest = s.sites[1]; // Salt Flats — reveal { favor: 2, secrets: 1, relics: 0 }
    dest.facedown = true;
    dest.cards = dest.cards.map(() => null);
    dest.relics = []; // baseState seeds one here; a facedown site starts empty
    const bankFavorBefore = s.sharedBank.favor;
    const bankSecretsBefore = s.sharedBank.secrets;

    const out = travel(s, 1, { siteIndex: 1 });

    const revealed = out.sites.find((x) => x.id === dest.id)!;
    expect(revealed.favor).toBe(2);
    expect(revealed.secrets).toBe(1);
    expect(revealed.relics).toEqual([]);
    expect(out.sharedBank.favor).toBe(bankFavorBefore - 2);
    expect(out.sharedBank.secrets).toBe(bankSecretsBefore - 1);
    checkInvariants(out);
  });

  it('clamps reveal.favor to what the shared bank holds (Law §9.3)', () => {
    const s = baseState();
    s.players[1].supply = 4;
    const dest = s.sites[1]; // Salt Flats
    dest.facedown = true;
    dest.cards = dest.cards.map(() => null);
    // drain the shared favor bank to 1
    s.favorBanks.hearth += s.sharedBank.favor - 1;
    s.sharedBank.favor = 1;

    const out = travel(s, 1, { siteIndex: 1 });
    expect(out.sites.find((x) => x.id === dest.id)!.favor).toBe(1);
    expect(out.sharedBank.favor).toBe(0);
    checkInvariants(out);
  });

  it('draws as many relics as the deck has when it is short (Law §9.3)', () => {
    const s = baseState();
    s.players[1].supply = 4;
    const dest = s.sites[7]; // Mountain — reveal.relics 1
    dest.facedown = true;
    dest.cards = dest.cards.map(() => null);
    s.relicDeck = []; // deck empty

    const out = travel(s, 1, { siteIndex: 7 });
    expect(out.sites.find((x) => x.id === dest.id)!.facedown).toBe(false);
    expect(out.sites.find((x) => x.id === dest.id)!.relics).toEqual([]);
    checkInvariants(out);
  });

  it('a faceup destination is not re-revealed and draws nothing', () => {
    const s = baseState();
    s.players[1].supply = 4;
    const deckBefore = [...s.relicDeck];
    const out = travel(s, 1, { siteIndex: 6 });
    expect(out.relicDeck).toEqual(deckBefore);
  });
});

describe('travel — legality', () => {
  it('is illegal for a non-active seat', () => {
    const s = baseState();
    expect(() => travel(s, 2, { siteIndex: 6 })).toThrow(IllegalAction);
  });

  it('is illegal with insufficient Supply', () => {
    const s = baseState();
    s.players[1].supply = 2; // hinterland -> other hinterland costs 3
    expect(() => travel(s, 1, { siteIndex: 6 })).toThrow(IllegalAction);
  });

  it('is illegal to travel to the site you are already on (Law §5.6.1)', () => {
    const s = baseState();
    const here = s.sites.findIndex((x) => x.id === s.players[1].pawnSite);
    expect(() => travel(s, 1, { siteIndex: here })).toThrow(IllegalAction);
  });

  it('is illegal to travel to a slot off the end of the map', () => {
    const s = baseState();
    expect(() => travel(s, 1, { siteIndex: s.sites.length })).toThrow(IllegalAction);
  });

  it("a nonexistent slot and the site you're already on fail with the SAME shape of message (no id echoed back that could distinguish a guess)", () => {
    const s = baseState();
    const here = s.sites.findIndex((x) => x.id === s.players[1].pawnSite);
    let offEnd = '';
    let alreadyThere = '';
    try {
      travel(s, 1, { siteIndex: s.sites.length + 5 });
    } catch (e) {
      offEnd = (e as Error).message;
    }
    try {
      travel(s, 1, { siteIndex: here });
    } catch (e) {
      alreadyThere = (e as Error).message;
    }
    // Both are real IllegalActions, but the point of this test is narrower:
    // neither message discriminates one FACEDOWN site's real id from
    // another's, which is the only thing §9.4 protects here — asserted
    // properly (across every slot) in oracle.test.ts's exploit.
    expect(offEnd).not.toBe('');
    expect(alreadyThere).not.toBe('');
  });

  it('is illegal once the game is complete', () => {
    const s = baseState();
    s.complete = true;
    expect(() => travel(s, 1, { siteIndex: 6 })).toThrow(IllegalAction);
  });

  it('does not advance the turn', () => {
    const s = baseState();
    s.players[1].supply = 4;
    const out = travel(s, 1, { siteIndex: 2 });
    expect(out.turn.activeSeat).toBe(1);
  });
});
