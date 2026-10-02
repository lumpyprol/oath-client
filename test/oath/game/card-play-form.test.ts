/**
 * Unit 11 (Ben, browser check): a drawn card's destinations are ONE choice —
 * discard, site, faceup adviser, Vision space, or facedown adviser — not one
 * form for the faceup destinations and another for facedown. The engine
 * takes `as: 'facedown'` as shorthand for `as: 'adviser', facedown: true`,
 * and the long form still replays.
 */

import { describe, it, expect } from 'vitest';
import { oath } from '../../../src/oath/game/index.js';
import type { Affordance } from '../../../src/oath/game/affordances.js';
import type { OathState } from '../../../src/oath/game/state.js';
import type { GameAction } from '../../../src/engine/types.js';
import { FIXTURES, openingState } from './audit-lib.js';
import { auditAffordances } from './affordances.js';
import { act } from './campaign-lib.js';

/** The first point in either fixture where some seat is mid-Search, with that seat. */
function midSearch(): { state: OathState; seat: number } {
  for (const { fixture, setupChoices } of FIXTURES) {
    let state = openingState(fixture, setupChoices);
    for (const row of fixture.actions) {
      if (row.type === 'game.created') continue;
      state = oath.reduce(structuredClone(state), row as unknown as GameAction);
      // A Search's 'play' decision (setup also deals a hand, which is not this).
      const play = oath.pending(state).find((d) => d.kind === 'play');
      if (play && state.players[play.seat].advisers.length < 3) return { state, seat: play.seat };
    }
  }
  throw new Error('no mid-Search state in the fixtures');
}

describe('card.play: one form for the whole Search', () => {
  const { state, seat } = midSearch();
  const plays = (oath.affordances!(state, seat) as Affordance[]).filter((e) => e.type === 'card.play');

  it('is ONE entry: a card choice, and destinations that say which cards they fit', () => {
    expect(plays).toHaveLength(1);
    const [entry] = plays;
    expect(entry.fields.map((f) => f.name)).toEqual(['handIndex', 'as']);
    const hand = entry.fields[0] as { options: { value: unknown }[] };
    expect(hand.options).toHaveLength(state.players[seat].hand.length);
    const as = entry.fields[1] as { options: { value: unknown; requires?: unknown }[] };
    expect(as.options.map((o) => o.value)).toEqual(expect.arrayContaining(['discard', 'facedown']));
    expect(as.options.find((o) => o.value === 'discard')!.requires).toBeUndefined(); // fits every card
  });

  it('says plainly that unpicked cards are discarded, and offers "keep none" last (Ben, 2026-10-01)', () => {
    const [entry] = plays;
    expect(entry.fields[0].label).toMatch(/every card you do not pick is discarded/);
    const as = (entry.fields[1] as { options: { value: unknown; label: string }[] }).options;
    expect(as.at(-1)).toMatchObject({ value: 'discard', label: 'Keep none: discard all of them' });
  });

  it("'Play to your site' shows the site's face, so it is plain which site", () => {
    const site = (plays[0].fields[1] as { options: { value: unknown; art?: string }[] }).options.find((o) => o.value === 'site');
    if (site) expect(site.art).toBe(state.players[seat].pawnSite);
  });

  it('is honest under the harness', () => {
    expect(auditAffordances(state, seat)).toEqual([]);
  });

  it("'facedown' is exactly the long form: a facedown adviser", () => {
    const short = act(state, 'card.play', seat, { handIndex: 0, as: 'facedown' });
    const long = act(state, 'card.play', seat, { handIndex: 0, as: 'adviser', facedown: true });
    expect(short).toEqual(long);
    expect(short.players[seat].advisers.at(-1)!.facedown).toBe(true);
  });
});

describe('the harness checks `requires` both ways (planted lies)', () => {
  const { state, seat } = midSearch();
  const base = () => structuredClone(oath.affordances!(state, seat) as Affordance[]);
  const asField = (list: Affordance[]) =>
    list.find((e) => e.type === 'card.play')!.fields[1] as { options: { value: unknown; requires?: { field: string; values: unknown[] } }[] };

  it('catches a destination claimed for a card it does not fit', () => {
    const lie = base();
    // "Reveal on your Vision space" for every card, including non-Visions.
    const as = asField(lie);
    as.options.push({ value: 'vision', label: 'lie', requires: { field: 'handIndex', values: state.players[seat].hand.map((_, i) => i) } } as never);
    expect(auditAffordances(state, seat, lie).join('\n')).toMatch(/as="vision" with handIndex=\d+: listed as allowed but reduce refused it/);
  });

  it('catches a destination that hides a card it does fit', () => {
    const lie = base();
    const discard = asField(lie).options.find((o) => o.value === 'discard')!;
    discard.requires = { field: 'handIndex', values: [0] }; // discard fits every card, not just the first
    expect(auditAffordances(state, seat, lie).join('\n')).toMatch(/as="discard" with handIndex=\d+: not listed, but reduce ACCEPTED it/);
  });
});
