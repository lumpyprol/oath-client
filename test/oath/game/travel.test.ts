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
    const out = travel(s, 1, { siteId: destId });
    expect(out.players[1].pawnSite).toBe(destId);
    expect(out.players[1].supply).toBe(4 - cost);
    checkInvariants(out);
  });

  it('cradle -> other cradle costs 1', () => {
    const s = baseState();
    s.players[1].pawnSite = s.sites[0].id;
    const out = travel(s, 1, { siteId: s.sites[1].id });
    expect(out.players[1].supply).toBe(s.players[1].supply - 1);
  });

  it('provinces -> any other site costs 2', () => {
    const s = baseState();
    s.players[1].pawnSite = s.sites[2].id;
    const out = travel(s, 1, { siteId: s.sites[4].id });
    expect(out.players[1].supply).toBe(s.players[1].supply - 2);
  });
});

describe('travel — arrival reveal (Law §5.6.2)', () => {
  it('flips a facedown destination faceup and draws its "R"-count relics from the deck', () => {
    const s = baseState();
    s.players[1].supply = 4;
    const dest = s.sites[6]; // Steppe in baseState's slice — relicCount 1
    dest.facedown = true;
    dest.cards = dest.cards.map(() => null); // a facedown site starts empty
    const relicCount = (byId(dest.id) as { relicCount: number }).relicCount;
    expect(relicCount).toBeGreaterThan(0);
    const deckTop = s.relicDeck.slice(0, relicCount);

    const out = travel(s, 1, { siteId: dest.id });

    const revealed = out.sites.find((x) => x.id === dest.id)!;
    expect(revealed.facedown).toBe(false);
    expect(revealed.relics).toEqual(deckTop);
    expect(out.relicDeck).toEqual(s.relicDeck.slice(relicCount));
    checkInvariants(out);
  });

  it('draws as many relics as the deck has when it is short (Law §9.3)', () => {
    const s = baseState();
    s.players[1].supply = 4;
    const dest = s.sites[7]; // Mountain — relicCount 1
    dest.facedown = true;
    dest.cards = dest.cards.map(() => null);
    s.relicDeck = []; // deck empty

    const out = travel(s, 1, { siteId: dest.id });
    expect(out.sites.find((x) => x.id === dest.id)!.facedown).toBe(false);
    expect(out.sites.find((x) => x.id === dest.id)!.relics).toEqual([]);
    checkInvariants(out);
  });

  it('a faceup destination is not re-revealed and draws nothing', () => {
    const s = baseState();
    s.players[1].supply = 4;
    const deckBefore = [...s.relicDeck];
    const out = travel(s, 1, { siteId: s.sites[6].id });
    expect(out.relicDeck).toEqual(deckBefore);
  });
});

describe('travel — legality', () => {
  it('is illegal for a non-active seat', () => {
    const s = baseState();
    expect(() => travel(s, 2, { siteId: s.sites[6].id })).toThrow(IllegalAction);
  });

  it('is illegal with insufficient Supply', () => {
    const s = baseState();
    s.players[1].supply = 2; // hinterland -> other hinterland costs 3
    expect(() => travel(s, 1, { siteId: s.sites[6].id })).toThrow(IllegalAction);
  });

  it('is illegal to travel to the site you are already on (Law §5.6.1)', () => {
    const s = baseState();
    expect(() => travel(s, 1, { siteId: s.players[1].pawnSite })).toThrow(IllegalAction);
  });

  it('is illegal to travel to a site that does not exist', () => {
    const s = baseState();
    expect(() => travel(s, 1, { siteId: 'site:nowhere' })).toThrow(IllegalAction);
  });

  it('is illegal once the game is complete', () => {
    const s = baseState();
    s.complete = true;
    expect(() => travel(s, 1, { siteId: s.sites[6].id })).toThrow(IllegalAction);
  });

  it('does not advance the turn', () => {
    const s = baseState();
    s.players[1].supply = 4;
    const out = travel(s, 1, { siteId: s.sites[2].id });
    expect(out.turn.activeSeat).toBe(1);
  });
});
