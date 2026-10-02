/**
 * The Wake Phase as ordinary fields (Ben, 2026-10-02: it was a JSON box).
 * The fixtures reach step 1 and the Opportunity Site take; this builds the
 * Mob-side two-step Wake they never reach, where step 2's options depend on
 * step 1 (`requires`), and runs the harness on it.
 */

import { describe, it, expect } from 'vitest';
import { oath } from '../../../src/oath/game/index.js';
import { beginWake } from '../../../src/oath/game/victory.js';
import { PEOPLES_FAVOR_ID, type OathState } from '../../../src/oath/game/state.js';
import type { Affordance } from '../../../src/oath/game/affordances.js';
import { auditAffordances } from './affordances.js';
import { act } from './campaign-lib.js';
import { baseState } from './helpers.js';

/** Seat 1 holds the People's Favor on its Mob side with 2 favor on it, and has 3 favor itself. */
function mobWake(): OathState {
  const s = baseState();
  const pf = s.banners.find((b) => b.id === PEOPLES_FAVOR_ID)!;
  const extraOnBanner = 2 - pf.tokens;
  pf.holder = 1;
  pf.mob = true;
  pf.tokens = 2;
  s.sharedBank.favor -= extraOnBanner; // conservation
  s.players[1].favor += 3;
  s.sharedBank.favor -= 3;
  return beginWake(s, 1);
}

const wakeEntry = (s: OathState) => (oath.affordances!(s, 1) as Affordance[]).find((e) => e.type === 'wake.resolve')!;

describe('wake.resolve as fields', () => {
  it('asks two People\'s Favor steps on the Mob side, step 2 depending on step 1', () => {
    const s = mobWake();
    expect(s.wake).toMatchObject({ seat: 1, stepsRemaining: 2 });
    const e = wakeEntry(s);
    expect(e.fields.map((f) => f.name)).toEqual(['step1', 'step2']);
    const step2 = e.fields[1] as { options: { value: { choice: string }; requires?: unknown }[] };
    // After returning 1 (leaving 1 on it), step 2 must place: so a return in
    // step 2 is only possible after step 1 placed.
    expect(step2.options.some((o) => o.value.choice === 'return' && o.requires)).toBe(true);
  });

  it('is honest under the harness, `requires` checked both ways', () => {
    expect(auditAffordances(mobWake(), 1)).toEqual([]);
  });

  it('a flat answer is exactly the nested one logged games used', () => {
    const s = mobWake();
    const flat = act(s, 'wake.resolve', 1, { step1: { choice: 'place' }, step2: { choice: 'place' } });
    const nested = act(s, 'wake.resolve', 1, { steps: [{ choice: 'place' }, { choice: 'place' }] });
    expect(flat).toEqual(nested);
    expect(flat.banners.find((b) => b.id === PEOPLES_FAVOR_ID)!.tokens).toBe(4);
  });
});
