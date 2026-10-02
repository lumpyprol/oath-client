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
 *   - for an `allocate`, asserts the least and the greatest legal total are
 *     accepted, that every option can carry part of a legal allocation,
 *     that one past the total's max is refused, and that an unlisted
 *     option is refused;
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
      // Prefer an option legal on its own — one with no `requires` on another field.
      const legal = field.options.find((o) => !o.disabled && !o.requires) ?? field.options.find((o) => !o.disabled);
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
    case 'allocate':
      return allocation(field, field.min);
  }
}

/** An option's share of an allocation, as the payload carries it. */
function share(value: unknown, count: number): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? { ...value, count } : { value, count };
}

/**
 * Fill an allocate field to `total`, greedily in option order (each option
 * up to its own cap), optionally starting with `first`. Null when the
 * options cannot hold that many.
 */
export function allocation(field: Extract<Field, { kind: 'allocate' }>, total: number, first?: number): Record<string, unknown>[] | null {
  const order = field.options.map((_, i) => i).filter((i) => !field.options[i].disabled);
  if (first !== undefined) order.sort((a, b) => (a === first ? -1 : b === first ? 1 : 0));
  const out: Record<string, unknown>[] = [];
  let left = total;
  for (const i of order) {
    if (left === 0) break;
    const o = field.options[i];
    const n = Math.min(left, o.max ?? left);
    if (n > 0) out.push(share(o.value, n));
    left -= n;
  }
  return left === 0 ? out : null;
}

export function baselinePayload(fields: Field[], except?: string): Record<string, unknown> {
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

    // A `free` field carries a declared-power payload (power.use's effects,
    // D9/D28) this harness cannot synthesize — so it cannot build a legal
    // action for the entry at all, and skips it whole. power.use's fidelity
    // is checked by its own dry run (unit 7), not here.
    if (entry.fields.some((f) => f.kind === 'free')) continue;

    if (entry.fields.length === 0) {
      const err = foldError(state, seat, entry.type, {});
      if (err !== null) violations.push(`${where}: no-field action was refused by reduce: ${err}`);
      continue;
    }

    for (const field of entry.fields) {
      if (field.kind === 'choose-one' || field.kind === 'choose-many') {
        for (const opt of field.options) {
          const value = field.kind === 'choose-many' ? [opt.value] : opt.value;
          if (opt.requires) {
            // A dependent option: accepted with EVERY value it lists for the
            // other field, refused with every other option of that field.
            const other = entry.fields.find((f) => f.name === opt.requires!.field);
            if (!other || other.kind !== 'choose-one') {
              violations.push(`${where}.${field.name}=${label(opt)}: requires ${opt.requires.field}, which is not a choose-one field of the entry`);
              continue;
            }
            const listed = new Set(opt.requires.values.map((v) => JSON.stringify(v)));
            for (const o of other.options) {
              const payload = { ...baselinePayload(entry.fields, field.name), [field.name]: value, [other.name]: o.value };
              const err = foldError(state, seat, entry.type, payload);
              if (listed.has(JSON.stringify(o.value)) && err !== null) {
                violations.push(`${where}.${field.name}=${label(opt)} with ${other.name}=${label(o)}: listed as allowed but reduce refused it: ${err}`);
              }
              if (!listed.has(JSON.stringify(o.value)) && err === null) {
                violations.push(`${where}.${field.name}=${label(opt)} with ${other.name}=${label(o)}: not listed, but reduce ACCEPTED it`);
              }
            }
            continue;
          }
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
        // A `deferred` bound is enforced on a later action (a §6.5 warband
        // permission), not at submit — so reduce accepting max+1 here is
        // correct, and the harness cannot assert otherwise.
        if (!field.deferred) {
          const overMax = { ...baselinePayload(entry.fields, field.name), [field.name]: field.max + 1 };
          if (foldError(state, seat, entry.type, overMax) === null) {
            violations.push(`${where}.${field.name}: max+1 (${field.max + 1}) was ACCEPTED by reduce`);
          }
        }
      } else if (field.kind === 'allocate') {
        const fold = (value: unknown) => foldError(state, seat, entry.type, { ...baselinePayload(entry.fields, field.name), [field.name]: value });
        for (const [what, total] of [['min', field.min], ['max', field.max]] as const) {
          const value = allocation(field, total);
          if (value === null) violations.push(`${where}.${field.name}: its options cannot hold the ${what} total (${total})`);
          else {
            const err = fold(value);
            if (err !== null) violations.push(`${where}.${field.name}: the ${what} total (${total}) was refused: ${err}`);
          }
        }
        // Every option must be usable: a legal allocation that leads with it.
        field.options.forEach((o, i) => {
          if (o.disabled) return;
          const value = allocation(field, Math.max(field.min, 1), i);
          if (value === null) return;
          const err = fold(value);
          if (err !== null) violations.push(`${where}.${field.name}=${label(o)}: offered, but an allocation using it was refused: ${err}`);
        });
        const over = allocation(field, field.max + 1);
        if (over !== null && fold(over) === null) {
          violations.push(`${where}.${field.name}: one past the max total (${field.max + 1}) was ACCEPTED by reduce`);
        }
        const base = allocation(field, field.min) ?? [];
        if (fold([...base, share('not-a-real-value', 1)]) === null) {
          violations.push(`${where}.${field.name}: an unlisted option was ACCEPTED by reduce`);
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
