/**
 * Unit 2 of Phase 4: the third visibility class, empty.
 *
 * `PlayerState.peeked` and the view shapes it feeds (`SiteView.relics`,
 * `reliquary[].id`) exist now; nothing GRANTS an entry until unit 3's Peek
 * family. This file proves the plumbing works on its own: invariants
 * reject a malformed `peeked`, the projection redacts an unpeeked slot to
 * every viewer and reveals a peeked one to exactly the seat that peeked
 * it, `relicDeck` never reveals one regardless, and both frozen fixtures
 * still fold with `peeked` empty everywhere — the migration story a
 * state-shape change owes (D61).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { oath } from '../../../src/oath/game/index.js';
import { project } from '../../../src/oath/game/project.js';
import { checkInvariants, type OathState } from '../../../src/oath/game/state.js';
import type { GameAction } from '../../../src/engine/types.js';
import { baseState } from './helpers.js';

describe('checkInvariants — players[].peeked (Law §6.3/§6.4)', () => {
  it('accepts a sorted, deduplicated list of real relic ids', () => {
    const s = baseState();
    const relic = s.relicDeck[0];
    s.players[1].peeked = [relic];
    expect(() => checkInvariants(s)).not.toThrow();
  });

  it('accepts empty (every existing game)', () => {
    const s = baseState();
    expect(s.players.every((p) => p.peeked.length === 0)).toBe(true);
    expect(() => checkInvariants(s)).not.toThrow();
  });

  it('rejects an id not in the card database', () => {
    const s = baseState();
    s.players[1].peeked = ['relic:not-a-real-relic'];
    expect(() => checkInvariants(s)).toThrow(/peeked.*card database/);
  });

  it('rejects a real id that is not a relic', () => {
    const s = baseState();
    s.players[1].peeked = [s.sites[0].id]; // a real site id, wrong prefix
    expect(() => checkInvariants(s)).toThrow(/peeked.*not a relic id/);
  });

  it('rejects a duplicate entry', () => {
    const s = baseState();
    const relic = s.relicDeck[0];
    s.players[1].peeked = [relic, relic];
    expect(() => checkInvariants(s)).toThrow(/peeked.*duplicate/);
  });

  it('rejects an unsorted list', () => {
    const s = baseState();
    const sorted = [...s.relicDeck.slice(0, 2)].sort();
    if (sorted[0] === sorted[1]) throw new Error('test fixture needs two distinct relic ids');
    s.players[1].peeked = [...sorted].reverse();
    expect(() => checkInvariants(s)).toThrow(/peeked.*not sorted/);
  });

  it('does NOT flag a relic as a duplicate-zone card merely for being both at a site and peeked', () => {
    // peeked is knowledge, not ownership — checkInvariants's "every card id
    // in exactly one zone" sweep must not treat this as the same class of
    // corruption a card in two OWNERSHIP zones would be.
    const s = baseState();
    const atSite1 = s.sites[1].relics[0];
    s.players[1].peeked = [atSite1];
    expect(() => checkInvariants(s)).not.toThrow();
  });
});

describe('project() — the peeked-gated relic slot (unit 2 of P4)', () => {
  it('with peeked empty, every relic slot at every site is { id: null } for every viewer, ordered by count', () => {
    const s = baseState();
    for (const seat of [0, 1, 2, null]) {
      const view = project(s, seat);
      view.sites.forEach((site, i) => {
        expect(site.relics).toHaveLength(s.sites[i].relics.length);
        for (const slot of site.relics) expect(slot).toEqual({ id: null });
      });
      for (const space of view.reliquary) expect(space.id).toBeNull();
    }
  });

  it("reveals a site's relic ONLY to the seat that peeked it, at the right slot", () => {
    const s = baseState();
    const relic = s.sites[1].relics[0];
    s.players[1].peeked = [relic];
    checkInvariants(s);

    const mine = project(s, 1);
    expect(mine.sites[1].relics[0]).toEqual({ id: relic });

    // Nobody else — not another seat, not a spectator — sees it, even
    // though it is the exact same slot at the exact same site.
    for (const seat of [0, 2, null]) {
      const view = project(s, seat);
      expect(view.sites[1].relics[0]).toEqual({ id: null });
    }
  });

  it('reveals a Reliquary relic ONLY to the seat that peeked it (Law §6.4)', () => {
    const s = baseState();
    const relic = s.reliquary[0].relicId!;
    s.players[2].peeked = [relic];
    checkInvariants(s);

    expect(project(s, 2).reliquary[0]).toEqual({
      modifier: s.reliquary[0].modifier,
      covered: true,
      id: relic,
    });
    for (const seat of [0, 1, null]) {
      expect(project(s, seat).reliquary[0].id).toBeNull();
    }
  });

  it("relicDeck NEVER reveals an id, even for a seat who has peeked other relics (§6.3 grants re-peeking a KNOWN relic, not vision into the deck)", () => {
    const s = baseState();
    s.players[1].peeked = [s.sites[1].relics[0]];
    checkInvariants(s);
    const view = project(s, 1);
    expect(Object.keys(view.relicDeck)).toEqual(['count']);
    expect(view.relicDeck.count).toBe(s.relicDeck.length);
  });

  it('a facedown site still shows a relics array of the right length, never an identity, regardless of peeked', () => {
    const s = baseState();
    const dest = s.sites[6];
    dest.facedown = true;
    dest.relics = [s.relicDeck.shift()!]; // pull it out of the deck to keep ids unique
    s.players[1].peeked = [dest.relics[0]]; // peeked the relic itself, not the site
    checkInvariants(s);

    const view = project(s, 1);
    expect(view.sites[6].id).toBeNull(); // the site is still facedown
    expect(view.sites[6].relics).toEqual([{ id: dest.relics[0] }]); // but the PEEKED RELIC is not the SITE's identity
  });
});

// ---------------------------------------------------------------------
// The migration story D61 requires for a state-shape change: both frozen
// fixtures fold with `peeked` empty for every player at every step, and
// checkInvariants (with its new peeked checks) never trips.
// ---------------------------------------------------------------------

interface Fixture {
  seed: string;
  players: number;
  actions: { seq: number; type: string; actor: number | null; payload: unknown }[];
}

function loadFixture(name: string): Fixture {
  return JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'fixtures', name), 'utf8'));
}

function openingState(f: Fixture): OathState {
  return oath.init({ ...oath.setup(f.players, { seed: f.seed }), setupChoices: 'open' });
}

describe.each([
  { name: '3-player', fixture: loadFixture('fullgame.log.json') },
  { name: '6-player (unit 9)', fixture: loadFixture('sixplayer.log.json') },
])('both frozen fixtures fold with peeked untouched — $name', ({ fixture }) => {
  it('every player stays peeked: [] for the whole replay', () => {
    let state = openingState(fixture);
    expect(state.players.every((p) => p.peeked.length === 0)).toBe(true);

    for (const row of fixture.actions) {
      if (row.type === 'game.created') continue;
      state = oath.reduce(structuredClone(state), row as unknown as GameAction);
      checkInvariants(state);
      expect(
        state.players.every((p) => p.peeked.length === 0),
        `#${row.seq} ${row.type} left a non-empty peeked set — nothing in P4 unit 1 or 2 should grant one`,
      ).toBe(true);
    }
  });
});
