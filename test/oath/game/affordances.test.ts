/**
 * Unit 4 of P4: `affordances()` and the harness that keeps it honest.
 *
 * The harness (`./affordances.ts`) is this unit's real product — it proves
 * the server's description of the option space matches what `reduce`
 * actually accepts. Here we (1) run it over both frozen fixtures prefix by
 * prefix for every seat, (2) prove it CATCHES a planted lie, and (3) pin
 * the three wired shapes and the pending-driven contract directly.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { oath } from '../../../src/oath/game/index.js';
import { checkInvariants, type OathState } from '../../../src/oath/game/state.js';
import type { GameAction } from '../../../src/engine/types.js';
import type { Affordance } from '../../../src/oath/game/affordances.js';
import { baseState } from './helpers.js';
import { auditAffordances } from './affordances.js';

const affordancesOf = (s: OathState, seat: number | null) =>
  (seat === null ? [] : (oath.affordances!(s, seat) as Affordance[]));

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

const FIXTURES = [
  { name: '3-player', fixture: loadFixture('fullgame.log.json') },
  { name: '6-player (unit 9)', fixture: loadFixture('sixplayer.log.json') },
];

describe.each(FIXTURES)('the harness over a full game — $name', ({ fixture }) => {
  it('every affordance the server offers, at every prefix, for every seat, is one reduce accepts', () => {
    let state = openingState(fixture);
    const seats = [...Array(fixture.players).keys()];
    const violations: string[] = [];

    const check = (after: string) => {
      for (const seat of seats) {
        for (const v of auditAffordances(state, seat)) violations.push(`${after}: ${v}`);
      }
    };

    check('opening');
    for (const row of fixture.actions) {
      if (row.type === 'game.created') continue;
      state = oath.reduce(structuredClone(state), row as unknown as GameAction);
      checkInvariants(state);
      check(`#${row.seq} ${row.type}`);
    }
    expect(violations).toEqual([]);
  });

  it('every offered action type is named by one of that seat\'s own pending decisions (entries ⊆ resolves)', () => {
    let state = openingState(fixture);
    const seats = [...Array(fixture.players).keys()];
    const wrong: string[] = [];

    const check = (after: string) => {
      for (const seat of seats) {
        const resolvable = new Set(
          oath.pending(state).filter((d) => d.seat === seat).flatMap((d) => d.resolves),
        );
        for (const entry of affordancesOf(state, seat)) {
          if (!resolvable.has(entry.type)) {
            wrong.push(`${after}: seat ${seat} was offered ${entry.type}, which no pending decision of theirs resolves`);
          }
        }
      }
    };

    check('opening');
    for (const row of fixture.actions) {
      if (row.type === 'game.created') continue;
      state = oath.reduce(structuredClone(state), row as unknown as GameAction);
      check(`#${row.seq} ${row.type}`);
    }
    expect(wrong).toEqual([]);
  });
});

describe('the harness catches a planted lie', () => {
  it('a disabled option stripped of its disabled flag (now claimed legal) is caught, naming the action', () => {
    const s = baseState(); // seat 1 active, pawn in Hinterland
    s.players[1].supply = 3; // a Cradle destination costs 4 → appears disabled

    const honest = affordancesOf(s, 1);
    const travel = honest.find((e) => e.type === 'travel')!;
    const field = travel.fields[0];
    expect(field.kind).toBe('choose-one');
    if (field.kind !== 'choose-one') throw new Error('unreachable');
    const disabledOpt = field.options.find((o) => o.disabled);
    expect(disabledOpt, 'the fixture needs an unaffordable destination').toBeDefined();

    // Plant the lie: drop the disabled flag, so the harness treats it as legal.
    const lie: Affordance[] = structuredClone(honest);
    const lieField = lie.find((e) => e.type === 'travel')!.fields[0];
    if (lieField.kind !== 'choose-one') throw new Error('unreachable');
    delete lieField.options.find((o) => JSON.stringify(o.value) === JSON.stringify(disabledOpt!.value))!.disabled;

    const violations = auditAffordances(s, 1, lie);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some((v) => v.startsWith('travel'))).toBe(true);
  });

  it('an out-of-range destination added without a disabled flag is caught', () => {
    const s = baseState();
    const honest = affordancesOf(s, 1);
    const lie: Affordance[] = structuredClone(honest);
    const field = lie.find((e) => e.type === 'travel')!.fields[0];
    if (field.kind !== 'choose-one') throw new Error('unreachable');
    field.options.push({ value: s.sites.length + 5, label: 'a lie' });

    const violations = auditAffordances(s, 1, lie);
    expect(violations.some((v) => v.startsWith('travel'))).toBe(true);
  });

  it('is quiet on the honest, unmodified affordances (the lie tests mean something)', () => {
    const s = baseState();
    s.players[1].supply = 3;
    expect(auditAffordances(s, 1)).toEqual([]);
  });
});

describe('the three wired shapes', () => {
  it('turn.rest is a no-field entry on the active seat, carrying the turn decision id', () => {
    const s = baseState();
    const rest = affordancesOf(s, 1).find((e) => e.type === 'turn.rest');
    expect(rest).toBeDefined();
    expect(rest!.fields).toEqual([]);
    const turnDecision = oath.pending(s).find((d) => d.seat === 1 && d.kind === 'turn')!;
    expect(rest!.decisionId).toBe(turnDecision.id);
  });

  it('travel is a choose-one over destinations, excluding your own site, each carrying its §5.6.1 Supply cost', () => {
    const s = baseState();
    s.players[1].supply = 3; // Hinterland pawn: same-region 3, Provinces 2, Cradle 4
    const travel = affordancesOf(s, 1).find((e) => e.type === 'travel')!;
    const field = travel.fields[0];
    if (field.kind !== 'choose-one') throw new Error('unreachable');

    const myIndex = s.sites.findIndex((x) => x.id === s.players[1].pawnSite);
    expect(field.options.some((o) => o.value === myIndex)).toBe(false); // never your own site

    for (const opt of field.options) {
      expect(typeof opt.cost?.supply).toBe('number');
      const i = opt.value as number;
      // A Cradle destination (cost 4) is unaffordable at supply 3 → disabled.
      if (opt.cost!.supply! > 3) expect(opt.disabled).toBeDefined();
      else expect(opt.disabled).toBeUndefined();
    }
  });

  it('a label never leaks a facedown site identity — it uses the position', () => {
    const s = baseState();
    s.sites[6].facedown = true;
    const travel = affordancesOf(s, 1).find((e) => e.type === 'travel')!;
    const field = travel.fields[0];
    if (field.kind !== 'choose-one') throw new Error('unreachable');
    const facedownOpt = field.options.find((o) => o.value === 6)!;
    expect(facedownOpt.label).not.toContain(s.sites[6].id);
    expect(facedownOpt.label.toLowerCase()).toContain('facedown');
  });

  it('standing.set offers all three channels as choose-one, marking the current answer', () => {
    const s = baseState();
    s.players[1].standing = { defense: 'close', ally: 'ask', warbands: 'ask' };
    const standing = affordancesOf(s, 1).find((e) => e.type === 'standing.set')!;
    expect(standing.fields.map((f) => f.name).sort()).toEqual(['ally', 'defense', 'warbands']);
    const defense = standing.fields.find((f) => f.name === 'defense')!;
    if (defense.kind !== 'choose-one') throw new Error('unreachable');
    expect(defense.options.map((o) => o.value).sort()).toEqual(['ask', 'close']);
    expect(defense.options.find((o) => o.value === 'close')!.label).toMatch(/current/);
  });
});

describe('the pending-driven contract', () => {
  it('a spectator (seat === null) is offered nothing', () => {
    const s = baseState();
    expect(oath.affordances!(s, null)).toEqual([]);
  });

  it('a completed game offers nothing, even to the seat whose turn it was', () => {
    const s = baseState();
    s.complete = true;
    expect(affordancesOf(s, 1)).toEqual([]);
  });

  it('a non-active seat with no pending decision is offered nothing (not even the always-legal standing.set)', () => {
    const s = baseState(); // seat 1 active
    expect(affordancesOf(s, 2)).toEqual([]);
    expect(oath.pending(s).some((d) => d.seat === 2)).toBe(false);
  });

  it('a locked Campaign phase yields only what that decision resolves — none of the wired shapes', () => {
    const s = baseState();
    s.campaign = {
      attackerSeat: 1,
      defenderSeat: 2,
      targets: [{ kind: 'pawnFavor' }],
      attackDice: 0,
      defenseDice: 2,
      allies: [],
      allyEligible: [],
      allyAnswered: [],
      allyVolunteers: [],
      phase: 'respond',
      declaredAt: s.actionCount,
    };
    // The defender owes the only decision; it resolves campaign.respond,
    // which this unit does not describe — so nothing is offered to anyone.
    const respond = oath.pending(s).find((d) => d.seat === 2)!;
    expect(respond.resolves).toEqual(['campaign.respond']);
    expect(affordancesOf(s, 2)).toEqual([]);
    expect(affordancesOf(s, 1)).toEqual([]); // the attacker is locked out mid-campaign
    expect(auditAffordances(s, 2)).toEqual([]);
  });
});
