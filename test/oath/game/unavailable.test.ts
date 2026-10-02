/**
 * Every Rest/Major/Minor action is always shown (Ben, 2026-10-02): offered as
 * a form when legal, otherwise greyed with the server's reason. This holds
 * the two lists to each other at every point both frozen games reach, for
 * every seat: together they cover ALWAYS_SHOWN, they never overlap, and a
 * greyed Rest is one the engine refuses.
 */

import { describe, it, expect } from 'vitest';
import { oath } from '../../../src/oath/game/index.js';
import { ALWAYS_SHOWN, shownTo, type Affordance, type Unavailable } from '../../../src/oath/game/affordances.js';
import { IllegalAction, type GameAction } from '../../../src/engine/types.js';
import type { OathState } from '../../../src/oath/game/state.js';
import { FIXTURES, openingState, nameOf } from './audit-lib.js';

function refusesRest(state: OathState, seat: number): boolean {
  try {
    const clone = structuredClone(state);
    const payload = oath.prepare ? oath.prepare(clone, { type: 'turn.rest', actor: seat, payload: {} }) : {};
    oath.reduce(clone, { gameId: 't', seq: state.actionCount + 1, type: 'turn.rest', actor: seat, payload, createdAt: '' });
    return false;
  } catch (e) {
    if (e instanceof IllegalAction) return true;
    throw e;
  }
}

describe.each(FIXTURES)('every always-shown action is offered or greyed, never both — $name', ({ fixture, setupChoices }) => {
  it('at every prefix, for every seat', () => {
    const problems: string[] = [];
    let state = openingState(fixture, setupChoices);
    const check = (where: string) => {
      if (state.complete) return;
      for (let seat = 0; seat < fixture.players; seat++) {
        const offered = new Set((oath.affordances!(state, seat) as Affordance[]).map((e) => e.type));
        const greyed = oath.unavailable!(state, seat) as Unavailable[];
        for (const g of greyed) {
          if (offered.has(g.type)) problems.push(`${where} ${nameOf(seat)}: ${g.type} is both offered and greyed`);
          if (!g.reason) problems.push(`${where} ${nameOf(seat)}: ${g.type} greyed with no reason`);
        }
        for (const t of ALWAYS_SHOWN) {
          const shown = offered.has(t) || greyed.some((g) => g.type === t);
          if (shownTo(state, seat, t) && !shown) problems.push(`${where} ${nameOf(seat)}: ${t} is neither offered nor greyed`);
          // An Imperial action that does not apply to this seat is not shown at all,
          // and the engine would never offer it either.
          if (!shownTo(state, seat, t) && shown) problems.push(`${where} ${nameOf(seat)}: ${t} is shown, but does not apply to this seat`);
        }
        const restGreyed = greyed.some((g) => g.type === 'turn.rest');
        if (restGreyed !== refusesRest(state, seat)) problems.push(`${where} ${nameOf(seat)}: Rest greyed=${restGreyed} but the engine ${restGreyed ? 'accepts' : 'refuses'} it`);
      }
    };
    check('opening');
    for (const row of fixture.actions) {
      if (row.type === 'game.created') continue;
      state = oath.reduce(structuredClone(state), row as unknown as GameAction);
      check(`#${row.seq} ${row.type}`);
    }
    expect(problems).toEqual([]);
  });
});

describe('reasons say what is in the way', () => {
  it("off-turn, every action says whose turn it is", () => {
    const { fixture, setupChoices } = FIXTURES[0];
    let state = openingState(fixture, setupChoices);
    for (const row of fixture.actions.slice(0, 12)) {
      if (row.type === 'game.created') continue;
      state = oath.reduce(structuredClone(state), row as unknown as GameAction);
    }
    const turn = (oath.pending(state) as { kind: string; seat: number }[]).find((d) => d.kind === 'turn');
    if (!turn) return; // not in a plain turn at this prefix
    const other = (turn.seat + 1) % fixture.players;
    const greyed = oath.unavailable!(state, other) as Unavailable[];
    expect(greyed.length).toBe(ALWAYS_SHOWN.filter((t) => shownTo(state, other, t)).length);
    for (const g of greyed) expect(g.reason).toMatch(/^Not your turn: waiting on the /);
  });
});

describe('Imperial minor actions show only where they apply (Ben, 2026-10-02)', () => {
  it('the Scepter holder sees the Scepter\'s actions, a Citizen sees self-exile, an Exile sees none of them', async () => {
    const { baseState } = await import('./helpers.js');
    const s = baseState();
    s.players[2].citizenship = 'citizen'; // only the role matters here; no reducer runs
    const types = (seat: number) => new Set([
      ...(oath.affordances!(s, seat) as Affordance[]).map((e) => e.type),
      ...(oath.unavailable!(s, seat) as Unavailable[]).map((g) => g.type),
    ]);
    const imperial = ['peek.reliquary', 'citizenship.offer', 'citizenship.exile', 'citizenship.selfExile'];
    const scepter = s.grandScepter;
    expect(imperial.filter((t) => types(scepter).has(t))).toEqual(['peek.reliquary', 'citizenship.offer', 'citizenship.exile']);
    expect(imperial.filter((t) => types(2).has(t))).toEqual(['citizenship.selfExile']);
    const exile = s.players.findIndex((p, i) => p.citizenship === 'exile' && i !== scepter);
    expect(imperial.filter((t) => types(exile).has(t))).toEqual([]);
  });
});
