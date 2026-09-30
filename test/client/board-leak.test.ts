/**
 * Unit 10, THE TEST THAT MATTERS. The board is D59's third hidden-info
 * channel — after the projection (audit.test.ts) and the affordances — and
 * the one a template makes easiest to get wrong. So it runs audit.test.ts's
 * OWN whole-string id sweep over the RENDERED HTML: fold each frozen fixture
 * prefix by prefix, render the board for every seat and a spectator, and
 * flag any card id in the HTML that the viewer has not legitimately seen.
 *
 * Proven against a planted leak: rendering a facedown adviser's id (drop the
 * `a.id !== null` guard in board.ts's `adviser`, or have the model emit the
 * id as a face) makes this fail, naming the seat and prefix. Re-plant one if
 * you change the template and this stays quiet.
 */

import { existsSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { boardModel } from '../../src/client/model.js';
import { boardPage } from '../../src/client/pages/board.js';
import { makeArtResolver } from '../../src/client/art.js';
import { ART_DIR } from '../../src/oath/cards/art.js';
import { project } from '../../src/oath/game/project.js';
import { oath } from '../../src/oath/game/index.js';
import type { GameAction } from '../../src/engine/types.js';
import { FIXTURES, CARD_ID_ANYWHERE, learn, openingState, nameOf } from '../oath/game/audit-lib.js';

// An empty asset dir → every face is a placeholder. That is the repo today,
// and the state this unit must render correctly (unit 15 owns the files).
const art = makeArtResolver({ dir: '/does/not/exist' });

const names = ['A', 'B', 'C', 'D', 'E', 'F'];

describe.each(FIXTURES)('board HTML leak sweep — $name', ({ fixture, setupChoices }) => {
  const VIEWERS: (number | null)[] = [...Array(fixture.players).keys(), null];

  it('never renders a card id the viewer has not legitimately seen', () => {
    let state = openingState(fixture, setupChoices);
    const known = new Map<number | null, Set<string>>(VIEWERS.map((v) => [v, new Set<string>()]));
    const leaks: string[] = [];

    const sweep = (after: string) => {
      for (const seat of VIEWERS) {
        const seen = known.get(seat)!;
        learn(state, seat, seen);
        const model = boardModel(project(state, seat), { gameId: 'g', seat, names });
        const htmlOut = boardPage(model, { art });
        for (const m of htmlOut.matchAll(CARD_ID_ANYWHERE)) {
          if (!seen.has(m[0])) leaks.push(`${after}: ${nameOf(seat)} saw ${m[0]} in the board HTML`);
        }
      }
    };

    sweep('opening');
    for (const row of fixture.actions) {
      if (row.type === 'game.created') continue;
      state = oath.reduce(structuredClone(state), row as unknown as GameAction);
      sweep(`#${row.seq} ${row.type}`);
    }
    expect(leaks).toEqual([]);
  });
});

// With real assets present, faces render as <img src="/art/<file>">. The
// filenames are deck-slot names (cards_04.png), never colon-ids, so the sweep
// must still find nothing — this guards that turning art ON did not open the
// channel. Only runs where the corpus has been placed.
describe.skipIf(!existsSync(ART_DIR)).each(FIXTURES)('board HTML leak sweep WITH art — $name', ({ fixture, setupChoices }) => {
  const VIEWERS: (number | null)[] = [...Array(fixture.players).keys(), null];
  const realArt = makeArtResolver(); // default dir = ART_DIR

  it('renders real <img> art and still leaks no card id', () => {
    let state = openingState(fixture, setupChoices);
    const known = new Map<number | null, Set<string>>(VIEWERS.map((v) => [v, new Set<string>()]));
    const leaks: string[] = [];
    let sawImg = false;

    const sweep = (after: string) => {
      for (const seat of VIEWERS) {
        const seen = known.get(seat)!;
        learn(state, seat, seen);
        const htmlOut = boardPage(boardModel(project(state, seat), { gameId: 'g', seat, names }), { art: realArt });
        if (htmlOut.includes('<img')) sawImg = true;
        for (const m of htmlOut.matchAll(CARD_ID_ANYWHERE)) {
          if (!seen.has(m[0])) leaks.push(`${after}: ${nameOf(seat)} saw ${m[0]} in the board HTML`);
        }
      }
    };

    sweep('opening');
    for (const row of fixture.actions) {
      if (row.type === 'game.created') continue;
      state = oath.reduce(structuredClone(state), row as unknown as GameAction);
      sweep(`#${row.seq} ${row.type}`);
    }
    expect(leaks).toEqual([]);
    expect(sawImg).toBe(true); // the art path was actually exercised
  });
});

describe('board HTML — the placeholder path with no assets', () => {
  it('renders faces as named placeholders, not <img>, when ART_DIR is empty', () => {
    const three = FIXTURES.find((f) => f.name === '3-player')!;
    let state = openingState(three.fixture, three.setupChoices);
    // Fold a few actions so some sites are faceup with named cards.
    let n = 0;
    for (const row of three.fixture.actions) {
      if (row.type === 'game.created') continue;
      if (n++ >= 12) break;
      state = oath.reduce(structuredClone(state), row as unknown as GameAction);
    }
    const model = boardModel(project(state, 0), { gameId: 'g', seat: 0, names });
    const htmlOut = boardPage(model, { art });
    expect(htmlOut).toContain('class="face placeholder"');
    // A card FACE with no asset degrades to a placeholder, never an <img class="face">.
    // (UI chrome — player boards, tokens — is always imagery and is unrelated.)
    expect(htmlOut).not.toContain('<img class="face"');
  });
});

/**
 * Law §9.4 makes the NUMBER of cards in the world deck private — it is the one
 * zone whose size never appears, which is why `project()` gives `worldDeck` no
 * key at all. Unit 16 batch 5 draws a world-deck back ON the map, so the
 * board is now a place that rule could be broken; every other pile's size is
 * public and must still show.
 */
describe('board HTML — the world deck shows a back but never a size', () => {
  const three = FIXTURES.find((f) => f.name === '3-player')!;

  function foldedModel(n: number, seat: number | null) {
    let state = openingState(three.fixture, three.setupChoices);
    let i = 0;
    for (const row of three.fixture.actions) {
      if (row.type === 'game.created') continue;
      if (i++ >= n) break;
      state = oath.reduce(structuredClone(state), row as unknown as GameAction);
    }
    return { model: boardModel(project(state, seat), { gameId: 'g', seat, names }), state };
  }

  it('never renders a count on the world-deck pile, for any viewer', () => {
    for (const seat of [0, 1, 2, null]) {
      const { model } = foldedModel(20, seat);
      const out = boardPage(model, { art: makeArtResolver(), boardImageUrl: '/art/full_board.png' });
      const worldDeck = /<div class="map-pile world-deck"[\s\S]*?<\/div>/.exec(out);
      expect(worldDeck, `seat ${seat}: world deck pile missing`).not.toBeNull();
      expect(worldDeck![0]).not.toContain('pile-n');
      // The model carries no world-deck size to render in the first place.
      expect(Object.keys(model)).not.toContain('worldDeckCount');
    }
  });

  it('still shows the public pile sizes (relic deck, discards)', () => {
    const { model, state } = foldedModel(20, 0);
    const out = boardPage(model, { art: makeArtResolver(), boardImageUrl: '/art/full_board.png' });
    expect(model.relicDeckCount).toBe(state.relicDeck.length);
    const relic = /<div class="map-pile relic-deck"[\s\S]*?<\/div>/.exec(out)!;
    expect(relic[0]).toContain('pile-n');
    for (const dc of model.discardCounts) {
      expect(dc.count).toBe(state.discards[dc.region as 'cradle'].length);
    }
  });
});
