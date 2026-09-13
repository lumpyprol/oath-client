/**
 * The affordance conformance HARNESS (unit 4 of P4) — a TEST HELPER, like
 * `metrics.ts`, not engine code. It is what stops `affordances()` and
 * `reduce()` drifting apart: the exact failure P3's post-mortem named as
 * the one its risk register missed (three copies of a rule, each subtly
 * wrong). D56's seam is only trustworthy if something proves the server's
 * description of the option space matches what the reducer actually
 * accepts — in BOTH directions.
 *
 * Given a state and a seat (and, optionally, a doctored entry list, so a
 * test can plant a lie and watch this catch it), it folds candidate
 * actions against a CLONE of the state and returns a list of violation
 * strings — empty when the description is honest. Each violation names the
 * action type, so a failure points at the culprit. For every entry it:
 *
 *   - folds every NON-disabled `choose-one` option (holding other fields
 *     at a fixed legal choice) and asserts `reduce` accepts it;
 *   - folds every DISABLED option and asserts `reduce` REFUSES it, with a
 *     message that relates to the stated reason;
 *   - for a `count` field, asserts `max` is accepted and `max + 1` refused;
 *   - for a `flag`, asserts both values are accepted;
 *   - folds a sample of values NOT offered and asserts they are refused
 *     (the negative direction — an honest option list is also a COMPLETE
 *     one for the values it claims to bound);
 *   - confirms the caller's state was never mutated.
 *
 * The cross-product of fields is unbounded and a real form does not explore
 * it either, so this varies ONE field at a time, exactly as a user filling
 * a form moves one control at a time.
 */

import { oath } from '../../../src/oath/game/index.js';
import { IllegalAction, type GameAction } from '../../../src/engine/types.js';
import type { Affordance, Field, Option } from '../../../src/oath/game/affordances.js';
import type { OathState } from '../../../src/oath/game/state.js';

/**
 * Fold one candidate action for `seat` against a clone; return the error
 * message, or null if it was accepted. Runs the SAME prepare→reduce
 * pipeline the append path uses (`actionlog.ts#appendAction`): a client
 * submits the affordance's fields as the payload, and `prepare()` enriches
 * it (rolling the end die at a round-ending Rest, Law §3.3; the campaign
 * dice; etc.) before `reduce` ever sees it. Skipping prepare would make an
 * honestly-legal `turn.rest` look illegal.
 */
function foldError(state: OathState, seat: number, type: string, payload: Record<string, unknown>): string | null {
  try {
    const clone = structuredClone(state);
    const enriched = oath.prepare ? oath.prepare(clone, { type, actor: seat, payload }) : payload;
    const action: GameAction = {
      gameId: 'harness',
      seq: state.actionCount + 1,
      type,
      actor: seat,
      payload: enriched,
      createdAt: '2026-09-13T00:00:00.000Z',
    };
    oath.reduce(clone, action);
    return null;
  } catch (e) {
    if (e instanceof IllegalAction) return e.message;
    throw e; // a non-IllegalAction (a real bug) should surface, not be swallowed
  }
}

/** A fixed LEGAL value for a field, used to hold the OTHER fields still while one varies. `undefined` = omit (no legal fixed value, or a field this harness cannot synthesize). */
function baselineValue(field: Field): unknown {
  switch (field.kind) {
    case 'choose-one': {
      const legal = field.options.find((o) => !o.disabled);
      return legal ? legal.value : undefined;
    }
    case 'choose-many':
      return []; // empty is the neutral hold; per-option legality is exercised when this field is the one varying
    case 'count':
      return field.min;
    case 'flag':
      return false;
    case 'free':
      return undefined; // cannot synthesize a declared-power payload here
  }
}

function baselinePayload(fields: Field[], except?: string): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.name === except) continue;
    const v = baselineValue(f);
    if (v !== undefined) payload[f.name] = v;
  }
  return payload;
}

/** Do the error message and the stated disabled-reason share a meaningful word (≥4 chars)? */
function relatesTo(message: string, reason: string): boolean {
  const words = (s: string) => new Set(s.toLowerCase().match(/[a-z]{4,}/g) ?? []);
  const a = words(message);
  for (const w of words(reason)) if (a.has(w)) return true;
  return false;
}

/** Values that are NOT offered by a choose-one/choose-many field, for the negative direction. */
function unlistedSamples(field: Extract<Field, { kind: 'choose-one' | 'choose-many' }>): unknown[] {
  const listed = new Set(field.options.map((o) => JSON.stringify(o.value)));
  const candidates: unknown[] = [-1, 999, 'not-a-real-value'];
  return candidates.filter((c) => !listed.has(JSON.stringify(c)));
}

export function auditAffordances(
  state: OathState,
  seat: number | null,
  entries: Affordance[] | undefined = seat === null ? [] : (oath.affordances!(state, seat) as Affordance[]),
): string[] {
  const violations: string[] = [];
  if (seat === null) return violations;
  const before = JSON.stringify(state);

  for (const entry of entries) {
    const where = `${entry.type}`;

    if (entry.fields.length === 0) {
      const err = foldError(state, seat, entry.type, {});
      if (err !== null) violations.push(`${where}: no-field action was refused by reduce: ${err}`);
      continue;
    }

    for (const field of entry.fields) {
      if (field.kind === 'choose-one' || field.kind === 'choose-many') {
        for (const opt of field.options) {
          const value = field.kind === 'choose-many' ? [opt.value] : opt.value;
          const payload = { ...baselinePayload(entry.fields, field.name), [field.name]: value };
          const err = foldError(state, seat, entry.type, payload);
          if (opt.disabled) {
            if (err === null) {
              violations.push(`${where}.${field.name}=${label(opt)}: marked disabled ("${opt.disabled}") but reduce ACCEPTED it`);
            } else if (!relatesTo(err, opt.disabled)) {
              violations.push(`${where}.${field.name}=${label(opt)}: refused, but the message ("${err}") does not relate to the stated reason ("${opt.disabled}")`);
            }
          } else if (err !== null) {
            violations.push(`${where}.${field.name}=${label(opt)}: offered as legal but reduce refused it: ${err}`);
          }
        }
        // Negative direction: a value the field never offered must be refused.
        for (const bogus of unlistedSamples(field)) {
          const value = field.kind === 'choose-many' ? [bogus] : bogus;
          const payload = { ...baselinePayload(entry.fields, field.name), [field.name]: value };
          if (foldError(state, seat, entry.type, payload) === null) {
            violations.push(`${where}.${field.name}: an unlisted value ${JSON.stringify(bogus)} was ACCEPTED by reduce`);
          }
        }
      } else if (field.kind === 'count') {
        const atMax = { ...baselinePayload(entry.fields, field.name), [field.name]: field.max };
        if (foldError(state, seat, entry.type, atMax) !== null) {
          violations.push(`${where}.${field.name}: max (${field.max}) was refused by reduce`);
        }
        const overMax = { ...baselinePayload(entry.fields, field.name), [field.name]: field.max + 1 };
        if (foldError(state, seat, entry.type, overMax) === null) {
          violations.push(`${where}.${field.name}: max+1 (${field.max + 1}) was ACCEPTED by reduce`);
        }
      } else if (field.kind === 'flag') {
        for (const value of [true, false]) {
          const payload = { ...baselinePayload(entry.fields, field.name), [field.name]: value };
          if (foldError(state, seat, entry.type, payload) !== null) {
            violations.push(`${where}.${field.name}=${value}: a flag value was refused by reduce`);
          }
        }
      }
      // 'free' fields carry a declared-power payload this harness cannot synthesize — skipped by design.
    }
  }

  if (JSON.stringify(state) !== before) {
    violations.push('auditAffordances MUTATED the caller state — a fold escaped its clone');
  }
  return violations;
}

function label(opt: Option): string {
  return `${JSON.stringify(opt.value)}`;
}
