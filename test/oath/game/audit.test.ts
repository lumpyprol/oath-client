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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { oath } from '../../../src/oath/game/index.js';
import { project } from '../../../src/oath/game/project.js';
import { checkInvariants, type OathState } from '../../../src/oath/game/state.js';
import type { GameAction } from '../../../src/engine/types.js';

interface Fixture {
  seed: string;
  players: number;
  actions: {
    seq: number;
    type: string;
    actor: number | null;
    payload: unknown;
  }[];
}

const fixture: Fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', '..', 'fixtures', 'fullgame.log.json'), 'utf8'),
);

/**
 * Anything namespaced like a card id. Matching on the PREFIX rather than on
 * a list of known ids is what makes this an audit: a card that leaks from a
 * zone nobody thought about still matches.
 */
const CARD_ID = /^(denizen|vision|relic|site|edifice|banner):/;

/** Every card id anywhere in a value, with the path that reached it. */
function idsIn(value: unknown, path = '', found = new Map<string, string>()): Map<string, string> {
  if (typeof value === 'string') {
    if (CARD_ID.test(value) && !found.has(value)) found.set(value, path);
    return found;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => idsIn(v, `${path}[${i}]`, found));
    return found;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) idsIn(v, path ? `${path}.${k}` : k, found);
  }
  return found;
}

/**
 * Fold into `known` every card id `seat` can legitimately see in `state`.
 * Read from TRUE state — deriving this from the projection would just
 * assert that the projection equals itself.
 *
 * `seat === null` is a spectator, who learns only the table-public half.
 */
function learn(state: OathState, seat: number | null, known: Set<string>): void {
  // --- public to everyone, Law §9.4 ---
  for (const site of state.sites) {
    if (site.facedown) continue; // a facedown site reveals neither itself nor its slots
    known.add(site.id);
    for (const card of site.cards) if (card) known.add(card.id);
  }
  for (const p of state.players) {
    if (p.vision !== null) known.add(p.vision); // a Revealed Vision is faceup (§2.2.1)
    for (const r of p.relics) known.add(r); // held relics are faceup (§5.4.3)
    for (const a of p.advisers) if (!a.facedown) known.add(a.id);
  }
  for (const b of state.banners) known.add(b.id); // the two banners are on the table

  // The ONE place a hidden card is revealed on purpose. §6.6.1's offer is a
  // relic taken out of the Imperial Reliquary and put on the table, so every
  // seat — and a spectator — sees which one, and goes on knowing it even if
  // the offer is declined and the relic goes back facedown. Run this audit
  // strict and it is the only id that trips it, across all 30 prefixes and
  // all 4 viewers: the deliberate exception is exactly one field wide.
  // (`give`/`take` need no such blessing — those name relics the two parties
  // already hold, which §5.4.3 makes public anyway.)
  if (state.citizenshipOffer) known.add(state.citizenshipOffer.relicId);

  if (seat === null) return;

  // --- yours alone ---
  for (const id of state.players[seat].hand) known.add(id); // mid-Search only (§9.4)
  for (const a of state.players[seat].advisers) known.add(a.id); // incl. your facedown ones
}

/** Rebuild the opening position the fixture's seed produces. */
function openingState(): OathState {
  return oath.init(oath.setup(fixture.players, { seed: fixture.seed }));
}

const VIEWERS: (number | null)[] = [0, 1, 2, null];
const nameOf = (seat: number | null) => (seat === null ? 'spectator' : `seat ${seat}`);

describe('hidden-information audit over a full game', () => {
  it('replays the fixture cleanly, so the audit below is auditing a real game', () => {
    let state = openingState();
    let applied = 0;
    for (const row of fixture.actions) {
      if (row.type === 'game.created') continue;
      state = oath.reduce(structuredClone(state), row as unknown as GameAction);
      checkInvariants(state);
      applied += 1;
    }
    expect(applied).toBeGreaterThan(20);
    expect(state.complete).toBe(true); // the fixture game ends on a Visionary Win
  });

  it('never puts a card id in a view the viewer has not legitimately seen', () => {
    let state = openingState();
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
    let state = openingState();
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
          // Relics beside a site need a Peek to identify (§6.3) — which
          // nobody has yet, so this is a count for EVERY viewer, the site's
          // own ruler included. Tighten when P4 lands Peek.
          if (Object.keys(s.relics).join() !== 'count') fail(`sites[${i}].relics leaked identities`);
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
        // covers them is hidden (§2.3 with §9.4).
        v.reliquary.forEach((sp, i) => {
          if (Object.keys(sp).sort().join() !== 'covered,modifier') {
            fail(`reliquary[${i}] carried more than its modifier and cover`);
          }
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
    const state = openingState();
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
