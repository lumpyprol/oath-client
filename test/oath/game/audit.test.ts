/**
 * Unit 20: the hidden-information audit.
 *
 * Every other test checks redaction at a state someone deliberately built.
 * That is exactly the wrong shape for a leak: you only write a fixture for
 * a case you already thought of, so the zones you forgot are the zones that
 * never get a fixture. The whole of P2 bears this out — seven of its ten
 * rules bugs were invisible because `FIRST_GAME` never reached them.
 *
 * So this replays a REAL game (test/fixtures/fullgame.log.json, written by
 * fullgame.test.ts) and re-audits the projection after EVERY action, for
 * EVERY seat and for a spectator. A leak has to survive all 30 prefixes x 4
 * viewers, not one hand-built state.
 *
 * The audit is in two halves, and they fail for different reasons:
 *
 *   1. `knownTo` — a per-seat, ACCUMULATING set of the card ids that seat
 *      has legitimately seen, derived from TRUE state, never from the view.
 *      Then: every card id anywhere in the view must be in that set. This
 *      is deliberately a whole-JSON string sweep rather than a field-by-
 *      field check, because a field-by-field check can only ever cover the
 *      fields I thought to list — and an audit's job is the other ones.
 *
 *      Knowledge accumulates because knowledge is monotonic: a card you saw
 *      faceup as someone's adviser is one you still know after it is played
 *      facedown. Re-hiding it would be the fiction, not the leak.
 *
 *   2. Structural invariants that do NOT accumulate — the world deck's size
 *      never appears at all, discards are counts, a facedown thing has a
 *      null id. These stay absolute for the whole game.
 *
 * A green audit proves nothing on its own, so this one was checked against
 * planted leaks before being believed: exposing facedown advisers' ids,
 * exposing site relic identities, and giving `worldDeck` a count each made
 * it fail, naming the exact seat, action and view path. Re-plant one if you
 * ever change `project.ts` and this file stays quiet.
 */

import { describe, it, expect } from 'vitest';
import { oath } from '../../../src/oath/game/index.js';
import { project } from '../../../src/oath/game/project.js';
import { checkInvariants } from '../../../src/oath/game/state.js';
import type { GameAction } from '../../../src/engine/types.js';
import {
  FIXTURES,
  CARD_ID_ANYWHERE,
  idsIn,
  learn,
  openingState,
  nameOf,
} from './audit-lib.js';

describe.each(FIXTURES)('hidden-information audit over a full game — $name', ({ fixture, setupChoices, endsComplete }) => {
  const VIEWERS: (number | null)[] = [...Array(fixture.players).keys(), null];
  it('replays the fixture cleanly, so the audit below is auditing a real game', () => {
    let state = openingState(fixture, setupChoices);
    let applied = 0;
    for (const row of fixture.actions) {
      if (row.type === 'game.created') continue;
      state = oath.reduce(structuredClone(state), row as unknown as GameAction);
      checkInvariants(state);
      applied += 1;
    }
    expect(applied).toBeGreaterThan(20);
    expect(state.complete).toBe(endsComplete);
  });

  it('never puts a card id in a view the viewer has not legitimately seen', () => {
    let state = openingState(fixture, setupChoices);
    // One accumulating set per viewer — knowledge is monotonic.
    const known = new Map<number | null, Set<string>>(VIEWERS.map((v) => [v, new Set<string>()]));
    const leaks: string[] = [];

    const audit = (after: string) => {
      for (const seat of VIEWERS) {
        const seen = known.get(seat)!;
        learn(state, seat, seen);
        for (const [id, path] of idsIn(project(state, seat))) {
          if (!seen.has(id)) leaks.push(`${after}: ${nameOf(seat)} saw ${id} at view.${path}`);
        }
        // P4 unit 4: affordances ride the SAME leak sweep — a brand-new
        // channel otherwise, and an affordance naming a card this seat
        // cannot see is exactly the leak unit 1 closed on the action
        // interface. Labels are generated PROSE ("Mine (Provinces)"), so
        // unlike `project()`'s output an id could only sneak in EMBEDDED in
        // a string, which `idsIn`'s whole-value match would miss — so this
        // scans the serialized affordances for any card id as a SUBSTRING.
        // A spectator is served none (the route omits them).
        if (seat !== null) {
          const serialized = JSON.stringify(oath.affordances!(state, seat));
          for (const m of serialized.matchAll(CARD_ID_ANYWHERE)) {
            if (!seen.has(m[0])) leaks.push(`${after}: ${nameOf(seat)} saw ${m[0]} in affordances`);
          }
        }
      }
    };

    audit('opening');
    for (const row of fixture.actions) {
      if (row.type === 'game.created') continue;
      state = oath.reduce(structuredClone(state), row as unknown as GameAction);
      audit(`#${row.seq} ${row.type}`);
    }
    expect(leaks).toEqual([]);
  });

  it('holds the absolute structural guarantees at every step', () => {
    let state = openingState(fixture, setupChoices);
    const broken: string[] = [];

    const audit = (after: string) => {
      for (const seat of VIEWERS) {
        const v = project(state, seat);
        const fail = (msg: string) => broken.push(`${after}: ${nameOf(seat)} — ${msg}`);

        // The world deck is the one zone whose SIZE is private (§9.4), so
        // the view carries no key at all, not a zeroed one.
        if (Object.keys(v.worldDeck).length !== 0) fail('worldDeck exposed a key');

        // Every other hidden zone shows a count and nothing else.
        for (const [region, d] of Object.entries(v.discards)) {
          if (Object.keys(d).join() !== 'count') fail(`discards.${region} carried more than a count`);
        }
        if (Object.keys(v.relicDeck).join() !== 'count') fail('relicDeck carried more than a count');
        if (Object.keys(v.dispossessed).join() !== 'count') fail('dispossessed carried more than a count');

        v.sites.forEach((s, i) => {
          // Relics beside a site need a Peek to identify (§6.3; unit 2 of
          // P4's shape, `{ id: string | null }[]`, one slot per relic —
          // still a count in every way that matters until unit 3 grants a
          // peek). Neither frozen fixture ever plays a peek action (that
          // action does not exist yet), and never will — these two logs
          // are frozen — so every slot's id stays null for EVERY viewer,
          // the site's own ruler included, permanently for this replay.
          s.relics.forEach((slot, j) => {
            if (Object.keys(slot).join() !== 'id') {
              fail(`sites[${i}].relics[${j}] carried more than an id`);
            }
            if (slot.id !== null) fail(`sites[${i}].relics[${j}] leaked an unpeeked relic's id`);
          });
          if (s.facedown) {
            if (s.id !== null) fail(`facedown sites[${i}] leaked its id`);
            if (s.cards.some((c) => c && c.id !== null)) fail(`facedown sites[${i}] leaked a card`);
          }
        });

        v.players.forEach((p, i) => {
          const isSelf = i === seat;
          if (!isSelf && Array.isArray(p.hand)) fail(`players[${i}].hand was not redacted`);
          if (isSelf && !Array.isArray(p.hand)) fail('your own hand was redacted from you');
          p.advisers.forEach((a, j) => {
            if (a.facedown && !isSelf && a.id !== null) {
              fail(`players[${i}].advisers[${j}] leaked a facedown card`);
            }
          });
        });

        // The Reliquary's four spaces are public board furniture; only what
        // covers them is hidden (§2.3 with §9.4). `id` (unit 2 of P4) is
        // the same peeked-only rule as a site's relic slots — null for
        // every viewer here, permanently, for the same reason: no peek
        // action exists yet, and neither frozen fixture ever will play one.
        v.reliquary.forEach((sp, i) => {
          if (Object.keys(sp).sort().join() !== 'covered,id,modifier') {
            fail(`reliquary[${i}] carried more than its modifier, cover and id`);
          }
          if (sp.id !== null) fail(`reliquary[${i}] leaked an unpeeked relic's id`);
        });
      }
    };

    audit('opening');
    for (const row of fixture.actions) {
      if (row.type === 'game.created') continue;
      state = oath.reduce(structuredClone(state), row as unknown as GameAction);
      audit(`#${row.seq} ${row.type}`);
    }
    expect(broken).toEqual([]);
  });

  it('a view never aliases live state — mutating it cannot reach the game', () => {
    // Projection copies every array and object it passes through. If one
    // were handed out by reference, a client mutation would corrupt the
    // server's state, which no amount of redaction would catch.
    const state = openingState(fixture, setupChoices);
    const before = JSON.stringify(state);
    const view = project(state, 0) as unknown as Record<string, unknown>;

    const scribble = (value: unknown) => {
      if (Array.isArray(value)) {
        value.push('SCRIBBLE' as never);
        value.forEach(scribble);
      } else if (value && typeof value === 'object') {
        for (const v of Object.values(value)) scribble(v);
        (value as Record<string, unknown>).SCRIBBLE = true;
      }
    };
    scribble(view);

    expect(JSON.stringify(state)).toBe(before);
  });
});
