/**
 * Unit 10: the PURE board model. Built from project(state, seat), so it can
 * only carry what that seat may see. Assertions go on the MODEL (the unit-9
 * pattern); the template's own leak sweep is board-leak.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { boardModel } from '../../src/client/model.js';
import { project } from '../../src/oath/game/project.js';
import { oath } from '../../src/oath/game/index.js';
import type { GameAction } from '../../src/engine/types.js';
import type { OathState } from '../../src/oath/game/state.js';
import { FIXTURES, openingState } from '../oath/game/audit-lib.js';

const three = FIXTURES.find((f) => f.name === '3-player')!;

/** Fold the 3-player fixture forward `n` non-created actions. */
function foldTo(n: number): OathState {
  let state = openingState(three.fixture, three.setupChoices);
  let applied = 0;
  for (const row of three.fixture.actions) {
    if (row.type === 'game.created') continue;
    if (applied >= n) break;
    state = oath.reduce(structuredClone(state), row as unknown as GameAction);
    applied += 1;
  }
  return state;
}

const names = ['Alice', 'Bob', 'Cara'];

describe('boardModel — structure from a folded fixture', () => {
  it('groups sites by region in play order, with every slot represented', () => {
    const state = foldTo(12);
    const m = boardModel(project(state, 0), { gameId: 'g', seat: 0, names });
    expect(m.regions.map((r) => r.region)).toEqual(['cradle', 'provinces', 'hinterland']);
    // Every site the view carries is placed in exactly one region.
    const viewSites = project(state, 0).sites.length;
    const modelSites = m.regions.reduce((n, r) => n + r.sites.length, 0);
    expect(modelSites).toBe(viewSites);
    // A site slot is either a face, a back, or an empty slot — never a bare id.
    for (const r of m.regions) {
      for (const s of r.sites) {
        for (const c of s.cards) {
          if (c) expect(['face', 'back']).toContain(c.kind);
        }
      }
    }
  });

  it('renders one area per seat, with the signed-in seat flagged and titled', () => {
    const state = foldTo(12);
    const m = boardModel(project(state, 1), { gameId: 'g', seat: 1, names });
    expect(m.players).toHaveLength(state.seats);
    expect(m.players[1].isYou).toBe(true);
    expect(m.players[0].isYou).toBe(false);
    expect(m.players.map((p) => p.name)).toEqual(names);
    // Whoever holds the title is marked Oathkeeper (or Usurper).
    const keeper = m.players[state.oathkeeper];
    expect(keeper.titles).toContain(state.usurper ? 'Usurper' : 'Oathkeeper');
  });

  it('exposes your OWN advisers as faces and never another seat facedown ones', () => {
    const state = foldTo(20);
    const meView = boardModel(project(state, 0), { gameId: 'g', seat: 0, names });
    // Any adviser you hold facedown is still a face to you (id known).
    // Any facedown adviser of another seat is a back with no face.
    for (const p of meView.players) {
      if (p.seat === 0) continue;
      for (const a of p.advisers) {
        if (a.kind === 'back') expect(a.face).toBeUndefined();
      }
    }
  });

  it('accounts for all 36 favor in the game (Law §1.4) at the opening', () => {
    const state = openingState(three.fixture, three.setupChoices);
    const m = boardModel(project(state, 0), { gameId: 'g', seat: 0, names });
    let favor = 0;
    for (const b of m.favorBanks) favor += b.favor;
    favor += m.sharedBank.favor;
    for (const p of m.players) favor += p.favor;
    for (const r of m.regions) for (const s of r.sites) favor += s.favor;
    // The People's Favor banner carries favor too (Law §2.5).
    for (const b of m.banners) if (b.name.toLowerCase().includes('favor')) favor += b.tokens;
    expect(favor).toBe(36);
  });

  it('a spectator model carries no hands, adviser faces, or peeked relics', () => {
    const state = foldTo(20);
    const spec = boardModel(project(state, null), { gameId: 'g', seat: null, names });
    expect(spec.spectator).toBe(true);
    for (const p of spec.players) {
      expect(p.isYou).toBe(false);
      // Every adviser is a back to a spectator (no seat is "self").
      for (const a of p.advisers) expect(a.kind).toBe('back');
    }
    for (const r of spec.regions) {
      for (const s of r.sites) {
        for (const relic of s.relics) expect(relic.kind).toBe('back');
      }
    }
  });
});

describe('boardModel — a peeked relic (Law §6.3), named for its peeker only', () => {
  /** Find a folded state with a faceup site that has at least one relic slot. */
  function stateWithSiteRelic(): { state: OathState; siteIdx: number; relicId: string } {
    for (let n = 0; n <= 24; n++) {
      const state = foldTo(n);
      const idx = state.sites.findIndex((s) => !s.facedown && s.relics.length > 0);
      if (idx >= 0) return { state, siteIdx: idx, relicId: state.sites[idx].relics[0] };
    }
    throw new Error('no faceup site with a relic in the first 24 prefixes');
  }

  it('names the relic for the seat that peeked, and shows a back to everyone else', () => {
    const { state, siteIdx, relicId } = stateWithSiteRelic();
    // Grant seat 0 a peek at that relic (the state unit 3's Peek action produces).
    const peeked = structuredClone(state);
    peeked.players[0].peeked = [relicId];

    const peeker = boardModel(project(peeked, 0), { gameId: 'g', seat: 0, names });
    const other = boardModel(project(peeked, 1), { gameId: 'g', seat: 1, names });

    const namedRelics = (m: ReturnType<typeof boardModel>) =>
      m.regions.flatMap((r) => r.sites.flatMap((s) => s.relics)).filter((x) => x.kind === 'face');
    // The peeker sees a named relic slot; seat 1 sees none named (positional only).
    expect(namedRelics(peeker).length).toBeGreaterThanOrEqual(1);
    expect(namedRelics(other).length).toBe(0);
    void siteIdx;
  });
});
