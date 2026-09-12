/**
 * P3 unit 8: Law §1.23's setup choices are the players' own (HLD D54).
 *
 * The unusual shape this unit adds: a pending decision that exists from
 * `init`, before any action has been taken. Everything else in the engine
 * raises decisions as a consequence of someone acting.
 */

import { describe, it, expect } from 'vitest';
import { checkInvariants, type OathState } from '../../../src/oath/game/state.js';
import { oath } from '../../../src/oath/game/index.js';
import { FIRST_GAME, init, oathSetup } from '../../../src/oath/game/setup.js';
import { discardRegion } from '../../../src/oath/game/map.js';
import type { GameAction } from '../../../src/engine/types.js';
import { completeSetup, containsId } from './helpers.js';

function act(state: OathState, type: string, actor: number | null, payload: unknown = {}): OathState {
  const action: GameAction = {
    gameId: 'test',
    seq: state.actionCount + 1,
    type,
    actor,
    payload,
    createdAt: '2026-09-12T00:00:00.000Z',
  };
  return oath.reduce(structuredClone(state), action);
}

/** A fresh FIRST_GAME opening — 4 seats, §1.23 choices open. */
function opening(): OathState {
  const s = init(oathSetup(4, undefined));
  checkInvariants(s);
  return s;
}

const faceup = (s: OathState) => s.sites.filter((x) => !x.facedown);
const topCradle = (s: OathState) => faceup(s).find((x) => x.region === 'cradle')!.id;

describe('the opening position, before anyone has chosen', () => {
  it('deals three cards to every seat and places no pawn at all (Law §1.20, §1.23.1)', () => {
    const s = opening();
    expect(s.setupChoices).toEqual({ remaining: [0, 1, 2, 3] });
    for (const p of s.players) {
      expect(p.hand).toHaveLength(3);
      expect(p.pawnSite).toBeNull();
      expect(p.advisers).toEqual([]); // §1.23.2's keep has not happened yet
    }
    // The unplaced-pawn window is legal ONLY here, and checkInvariants knows it.
    checkInvariants(s);
  });

  it('raises ONE decision — the Chancellor first, per §1.23\'s turn order', () => {
    const pending = oath.pending(opening());
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ seat: 0, kind: 'setup', resolves: ['setup.choose'] });
  });

  it('locks everything: no other action is legal, not even standing.set', () => {
    const s = opening();
    for (const [type, actor, payload] of [
      ['turn.rest', 0, {}],
      ['search', 0, { from: 'deck' }],
      ['standing.set', 1, { ally: 'pass' }], // the one action legal everywhere else
      ['travel', 0, { siteId: faceup(s)[1].id }],
    ] as const) {
      expect(() => act(s, type, actor, payload), `${type} escaped the setup lock`).toThrow(/§1.23/);
    }
  });

  it('defers the opening Wake Phase until setup completes (§1.23 precedes §4)', () => {
    const s = opening();
    expect(s.wake).toBeNull();
    expect(s.turn.activeSeat).toBe(0);
    const done = completeSetup(oath, s);
    expect(done.setupChoices).toBeNull();
    // Now §4.1 has run for seat 0 — this FIRST_GAME is Supremacy, so §1.13
    // hands out no banner and the Wake resolves to nothing, as it always did.
    expect(oath.pending(done)[0]).toMatchObject({ seat: 0, kind: 'turn' });
    checkInvariants(done);
  });
});

describe('setup.choose — Law §1.23.1, the pawn', () => {
  it('places the pawn and advances to the next seat', () => {
    const s = opening();
    const out = act(s, 'setup.choose', 0, { siteId: topCradle(s), keepIndex: 0 });
    checkInvariants(out);
    expect(out.players[0].pawnSite).toBe(topCradle(s));
    expect(out.setupChoices).toEqual({ remaining: [1, 2, 3] });
    expect(oath.pending(out)[0]).toMatchObject({ seat: 1, kind: 'setup' });
  });

  it('the CHANCELLOR must use the top Cradle site (§1.23.1), and everyone else may not be made to', () => {
    const s = opening();
    const otherFaceup = faceup(s).find((x) => x.id !== topCradle(s))!;
    expect(() => act(s, 'setup.choose', 0, { siteId: otherFaceup.id, keepIndex: 0 })).toThrow(
      /top Cradle site/,
    );

    // Seat 1 has no such restriction — any faceup site will do.
    const afterChancellor = act(s, 'setup.choose', 0, { siteId: topCradle(s), keepIndex: 0 });
    const out = act(afterChancellor, 'setup.choose', 1, { siteId: otherFaceup.id, keepIndex: 0 });
    checkInvariants(out);
    expect(out.players[1].pawnSite).toBe(otherFaceup.id);
  });

  it('rejects a facedown site and a nonexistent one', () => {
    const s = opening();
    const afterChancellor = act(s, 'setup.choose', 0, { siteId: topCradle(s), keepIndex: 0 });
    const hidden = afterChancellor.sites.find((x) => x.facedown)!;
    expect(() => act(afterChancellor, 'setup.choose', 1, { siteId: hidden.id, keepIndex: 0 })).toThrow(
      /facedown/,
    );
    expect(() => act(afterChancellor, 'setup.choose', 1, { siteId: 'site:nope', keepIndex: 0 })).toThrow(
      /no site/,
    );
  });

  it('enforces §1.23\'s turn order — seat 2 cannot act before seat 1', () => {
    const s = act(opening(), 'setup.choose', 0, { siteId: topCradle(opening()), keepIndex: 0 });
    expect(() => act(s, 'setup.choose', 2, { siteId: faceup(s)[0].id, keepIndex: 0 })).toThrow(
      /turn order — seat 1 chooses next/,
    );
    expect(() => act(s, 'setup.choose', 0, { siteId: faceup(s)[0].id, keepIndex: 0 })).toThrow(
      /turn order/,
    );
  });
});

describe('setup.choose — Law §1.23.2/.3, the adviser and the two discards', () => {
  it('keeps the named card and discards the other two, to the CHOSEN site\'s region', () => {
    const s = opening();
    const afterChancellor = act(s, 'setup.choose', 0, { siteId: topCradle(s), keepIndex: 0 });

    // Seat 1 picks a Provinces site and keeps the middle card.
    const provinces = faceup(afterChancellor).find((x) => x.region === 'provinces')!;
    const drawn = [...afterChancellor.players[1].hand];
    const before = afterChancellor.discards[discardRegion('provinces')].length;

    const out = act(afterChancellor, 'setup.choose', 1, { siteId: provinces.id, keepIndex: 1 });
    checkInvariants(out);
    expect(out.players[1].advisers).toEqual([
      { id: drawn[1], facedown: true, favor: 0, secrets: 0 },
    ]);
    expect(out.players[1].hand).toEqual([]);

    const pile = out.discards[discardRegion('provinces')];
    expect(pile).toHaveLength(before + 2);
    expect(pile.slice(-2).sort()).toEqual([drawn[0], drawn[2]].sort());
  });

  it('...and the region really follows the pawn: the same seat, a different site, a different pile', () => {
    const s = opening();
    const afterChancellor = act(s, 'setup.choose', 0, { siteId: topCradle(s), keepIndex: 0 });
    const drawn = [...afterChancellor.players[1].hand];

    const provinces = faceup(afterChancellor).find((x) => x.region === 'provinces')!;
    const cradle = faceup(afterChancellor).find((x) => x.region === 'cradle')!;
    expect(discardRegion('provinces')).not.toBe(discardRegion('cradle')); // the test only means something if these differ

    const toProvinces = act(afterChancellor, 'setup.choose', 1, { siteId: provinces.id, keepIndex: 0 });
    const toCradle = act(afterChancellor, 'setup.choose', 1, { siteId: cradle.id, keepIndex: 0 });

    expect(toProvinces.discards[discardRegion('provinces')].slice(-2).sort()).toEqual(
      drawn.slice(1).sort(),
    );
    expect(toCradle.discards[discardRegion('cradle')].slice(-2).sort()).toEqual(drawn.slice(1).sort());
  });

  it('rejects a keepIndex out of range', () => {
    const s = opening();
    expect(() => act(s, 'setup.choose', 0, { siteId: topCradle(s), keepIndex: 3 })).toThrow(
      /keepIndex 3 is out of range/,
    );
    expect(() => act(s, 'setup.choose', 0, { siteId: topCradle(s), keepIndex: -1 })).toThrow(
      /malformed/,
    );
  });

  it('names an INDEX, never a card id — the two discards stay out of the log and out of every other view', () => {
    const s = opening();
    const drawn = [...s.players[0].hand];
    const payload = { siteId: topCradle(s), keepIndex: 0 };
    const out = act(s, 'setup.choose', 0, payload);

    // The payload that goes in the shared log carries no card id at all
    // (unit 10's `card.play` precedent).
    for (const id of drawn) {
      expect(containsId(payload, id), `${id} leaked into the action payload`).toBe(false);
    }
    // ...and the two discarded cards are invisible to every other seat.
    for (const viewer of [1, 2, 3, null]) {
      const view = oath.project(out, viewer);
      for (const id of drawn.slice(1)) {
        expect(containsId(view, id), `${id} leaked into seat ${viewer}'s view`).toBe(false);
      }
    }
    // The keeper knows their own facedown adviser, as they always do.
    expect(containsId(oath.project(out, 0), drawn[0])).toBe(true);
  });

  it('a seat mid-setup shows no pawn to anyone, rather than a fake one', () => {
    const s = opening();
    for (const viewer of [0, 1, null]) {
      const view = oath.project(s, viewer) as { players: { pawnSite: string | null }[] };
      expect(view.players.map((p) => p.pawnSite)).toEqual([null, null, null, null]);
    }
  });
});

describe('D54 back-compat: a setup record that predates unit 8', () => {
  /**
   * The old shape: `setupChoices` absent entirely (which reads as
   * 'applied'), and `startingAdviser` naming the one card `oathSetup` chose,
   * with its two rejects already filed into the discards.
   */
  function legacySetup(modern = oathSetup(4, undefined)) {
    const hands = modern.startingHand!;
    const discards = {
      cradle: [...modern.discards.cradle],
      provinces: [...modern.discards.provinces],
      hinterland: [...modern.discards.hinterland],
    };
    hands.forEach((drawn, seat) => {
      const site = modern.spec.startingPawnSite[seat];
      const region = modern.spec.sites.find((x) => x.id === site)!.region;
      for (const id of drawn.slice(1)) discards[discardRegion(region)].push(id);
    });
    const legacy = {
      ...modern,
      discards,
      startingAdviser: hands.map((drawn) => drawn[0]),
    } as Record<string, unknown>;
    delete legacy.startingHand;
    delete legacy.setupChoices; // the pre-unit-8 record has no such field
    return legacy as unknown as ReturnType<typeof oathSetup>;
  }

  it('raises no setup decision, and starts exactly as a P2 game did', () => {
    const legacy = init(legacySetup());
    checkInvariants(legacy);
    expect(legacy.setupChoices).toBeNull();
    for (const p of legacy.players) {
      expect(p.pawnSite).not.toBeNull();
      expect(p.hand).toEqual([]);
      expect(p.advisers).toHaveLength(1);
    }
    // §4.1 ran at init, as it used to — the game is already under way.
    expect(oath.pending(legacy)[0]).toMatchObject({ seat: 0, kind: 'turn' });
  });

  it('keeps the same card every seat would have kept by default', () => {
    // ONE deal, read two ways — FIRST_GAME shuffles, so two `oathSetup`
    // calls would be two different games and prove nothing.
    const modern = oathSetup(4, undefined);
    const legacy = init(legacySetup(modern));
    const driven = completeSetup(oath, init(modern));

    // `completeSetup` keeps index 0, which is exactly what `oathSetup` used
    // to keep — so the advisers, the deck and the Visions count all agree.
    expect(driven.players.map((p) => p.advisers)).toEqual(legacy.players.map((p) => p.advisers));
    expect(driven.worldDeck).toEqual(legacy.worldDeck);
    expect(driven.visionsDrawn).toEqual(legacy.visionsDrawn);

    // Every card is still accounted for, whichever path built the state: the
    // two discards per seat land in SOME pile either way, just not always
    // the same one (the driven pawns all go to the first faceup site, where
    // the spec spread them across three regions — which is the whole point
    // of §1.23.1 being a choice).
    const allCards = (s: OathState) =>
      [
        ...s.worldDeck,
        ...s.players.flatMap((p) => p.advisers.map((a) => a.id)),
        ...(['cradle', 'provinces', 'hinterland'] as const).flatMap((r) => s.discards[r]),
      ].sort();
    expect(allCards(driven)).toEqual(allCards(legacy));
  });
});

describe('FIRST_GAME raises these too — §1.23 applies to any game', () => {
  it('the box prescribes the map, not your pawn', () => {
    const s = init(oathSetup(FIRST_GAME.citizenship.length, undefined));
    expect(s.setupChoices).not.toBeNull();
    expect(oath.pending(s)[0]).toMatchObject({ kind: 'setup', seat: 0 });
  });
});
