/**
 * Unit 6 of P4: the bidirectional tie between the dispatch table,
 * `pending()`'s decision catalogue, and the affordance table. After this,
 * "the client never computes a rule" is a CHECKABLE claim: every action
 * type is either described by the server or explicitly never-offered, and
 * every live decision's resolvers are exactly what the server offers its
 * owning seat.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { oath, RESOLVABLE_TYPES } from '../../../src/oath/game/index.js';
import { DESCRIBED_TYPES, type Affordance } from '../../../src/oath/game/affordances.js';
import { type OathState } from '../../../src/oath/game/state.js';
import type { GameAction, PendingDecision } from '../../../src/engine/types.js';

/** Types that intentionally have NO affordance, each with a reason. */
const NEVER_OFFERED: Record<string, string> = {
  'game.created': 'the inert creation marker (turn.ts) — never replayed through reduce, never a move',
};

const affordancesOf = (s: OathState, seat: number | null) =>
  (seat === null ? [] : (oath.affordances!(s, seat) as Affordance[]));

// ---- Property 1: every dispatch type is described or never-offered --------

describe('property 1 — every dispatch-table type is described or explicitly never-offered', () => {
  const DISPATCH_TYPES = [...RESOLVABLE_TYPES, 'game.created'];

  it('holds for the real table', () => {
    const unaccounted = DISPATCH_TYPES.filter(
      (t) => !DESCRIBED_TYPES.includes(t) && !(t in NEVER_OFFERED),
    );
    expect(unaccounted).toEqual([]);
    // ...and nothing is BOTH described and never-offered (a contradiction).
    expect(DESCRIBED_TYPES.filter((t) => t in NEVER_OFFERED)).toEqual([]);
  });

  it('catches a new action type with neither a describer nor a never-offered reason (planted)', () => {
    const withBogus = [...DISPATCH_TYPES, 'bogus.newAction'];
    const unaccounted = withBogus.filter(
      (t) => !DESCRIBED_TYPES.includes(t) && !(t in NEVER_OFFERED),
    );
    expect(unaccounted).toEqual(['bogus.newAction']);
  });
});

// ---- Property 2: pending().resolves and affordances agree, over fixtures --

interface Fixture {
  seed: string;
  players: number;
  actions: { seq: number; type: string; actor: number | null; payload: unknown }[];
}
const loadFixture = (name: string): Fixture =>
  JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'fixtures', name), 'utf8'));
const openingState = (f: Fixture): OathState =>
  oath.init({ ...oath.setup(f.players, { seed: f.seed }), setupChoices: 'open' });

const FIXTURES = [
  { name: '3-player', fixture: loadFixture('fullgame.log.json') },
  { name: '6-player (unit 9)', fixture: loadFixture('sixplayer.log.json') },
];

/**
 * The forward direction, as a pure check so a planted violation can be
 * fed to it directly: for a SPECIFIC decision (not the broad `turn`/`play`
 * menu), every type it resolves must have an entry for its owning seat.
 */
function missingEntries(decision: PendingDecision, entries: Affordance[]): string[] {
  const offered = new Set(entries.map((e) => e.type));
  return decision.resolves.filter((t) => !offered.has(t)).map((t) => `${decision.kind}:${decision.seat} missing ${t}`);
}

// The `turn` decision's resolves is the whole dispatch table (a menu whose
// items are conditionally available) — excluded from the "must offer every
// resolver" direction; every OTHER decision's resolvers are always available.
const MENU_KINDS = new Set(['turn']);

describe.each(FIXTURES)('property 2 — decision resolvers ⟷ affordances agree — $name', ({ fixture }) => {
  it('every specific decision has an entry for each of its resolvers, and an idle seat gets only standing.set', () => {
    let state = openingState(fixture);
    const forward: string[] = [];
    const converse: string[] = [];

    const check = (after: string) => {
      const pending = oath.pending(state);
      for (const d of pending) {
        if (MENU_KINDS.has(d.kind)) continue;
        for (const v of missingEntries(d, affordancesOf(state, d.seat))) forward.push(`${after}: ${v}`);
      }
      // Converse: a seat named by NO pending decision has no standing to
      // act — so it is offered only the universal standing.set (P4 unit 6).
      for (let seat = 0; seat < fixture.players; seat++) {
        if (pending.some((d) => d.seat === seat)) continue;
        const types = affordancesOf(state, seat).map((e) => e.type);
        if (types.some((t) => t !== 'standing.set')) {
          converse.push(`${after}: idle seat ${seat} offered ${types.join(',')}`);
        }
      }
    };

    check('opening');
    for (const row of fixture.actions) {
      if (row.type === 'game.created') continue;
      state = oath.reduce(structuredClone(state), row as unknown as GameAction);
      check(`#${row.seq} ${row.type}`);
    }
    expect(forward).toEqual([]);
    expect(converse).toEqual([]);
  });
});

describe('property 2 — the check itself catches a violation (planted)', () => {
  it('a decision whose resolver has no matching entry is flagged', () => {
    const decision: PendingDecision = {
      id: 'wake:0:1',
      seat: 0,
      kind: 'wake',
      prompt: 'x',
      resolves: ['wake.resolve'],
    };
    // No entry offered → the resolver is missing.
    expect(missingEntries(decision, [])).toEqual(['wake:0 missing wake.resolve']);
    // An entry of the right type → satisfied.
    expect(missingEntries(decision, [{ type: 'wake.resolve', fields: [] }])).toEqual([]);
  });
});
