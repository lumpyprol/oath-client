/**
 * Unit 11, THE CONFORMANCE TEST: forms ↔ affordances, in both directions.
 * This is INTERRUPTS.md's bidirectional trick applied to the UI, and it is
 * what keeps a template from quietly inventing an option:
 *
 *   1. every affordance entry the server computes for a seat renders a form
 *      whose method, action URL, type and field names match it;
 *   2. every field name in every rendered form names a real field of a real
 *      affordance entry, and every option a form offers is an option of
 *      that field — nothing invented, nothing dropped.
 *
 * It runs over BOTH frozen fixtures, prefix by prefix, for every seat — so it
 * covers whatever the games actually reach rather than what was remembered.
 * And it closes the loop the renderers open: the submission a browser would
 * send for a baseline choice decodes (composer.ts's decoder) to EXACTLY the
 * harness's baseline payload, which prepare+reduce then accepts.
 *
 * Violations are planted in each direction below (a dropped form, an
 * invented field, an invented option) to prove the check bites.
 */

import { describe, it, expect } from 'vitest';
import { oath } from '../../src/oath/game/index.js';
import { IllegalAction, type GameAction } from '../../src/engine/types.js';
import type { Affordance, Field } from '../../src/oath/game/affordances.js';
import type { OathState } from '../../src/oath/game/state.js';
import { composer, decodeSubmission, encodeValue, actUrl, allocateName, META } from '../../src/client/composer.js';
import { EffectSchema } from '../../src/oath/game/effects.js';
import { effectExamples, effectsHelp } from '../../src/client/effects-help.js';
import { boardModel } from '../../src/client/model.js';
import { boardPage, type DryRunView } from '../../src/client/pages/board.js';
import { project } from '../../src/oath/game/project.js';
import { FIXTURES, openingState, nameOf } from '../oath/game/audit-lib.js';
import { baselinePayload } from '../oath/game/affordances.js';
import { act, imperialRolled } from '../oath/game/campaign-lib.js';
import { parseForms, baselineSubmission, metaValue, offeredValues } from './form-lib.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const GAME = 'g';
const opts = { gameId: GAME, seq: 7, back: `/games/${GAME}` };

// ---- the checker, both directions -------------------------------------------

function formViolations(entries: Affordance[], doc: string, where = ''): string[] {
  const v: string[] = [];
  const forms = parseForms(doc);
  const at = (i: number, e?: Affordance) => `${where}entry ${i}${e ? ` (${e.type})` : ''}`;

  // Direction 1: every entry has its form, and the form matches it.
  if (forms.length !== entries.length) v.push(`${where}${entries.length} affordance entries but ${forms.length} forms`);
  entries.forEach((entry, i) => {
    const form = forms.find((f) => f.attrs['data-entry'] === String(i));
    if (!form) return void v.push(`${at(i, entry)}: no form rendered`);
    if (form.attrs.method !== 'post') v.push(`${at(i, entry)}: method is ${form.attrs.method}, not post`);
    if (form.attrs.action !== actUrl(GAME)) v.push(`${at(i, entry)}: action is ${form.attrs.action}`);
    if (metaValue(form, '_type') !== entry.type) v.push(`${at(i, entry)}: _type is ${metaValue(form, '_type')}`);
    if (metaValue(form, '_decision') !== entry.decisionId) v.push(`${at(i, entry)}: _decision is ${metaValue(form, '_decision')}, entry acts within ${entry.decisionId}`);
    const kinds = JSON.parse(metaValue(form, '_kinds') ?? '{}') as Record<string, string>;
    for (const f of entry.fields) {
      if (f.kind === 'allocate') {
        for (const o of f.options) {
          if (!form.controls.some((c) => c.attrs.name === allocateName(f.name, o.value))) v.push(`${at(i, entry)}: option ${encodeValue(o.value)} of ${f.name} has no box`);
        }
      } else if (!form.controls.some((c) => c.attrs.name === f.name)) v.push(`${at(i, entry)}: field ${f.name} has no control`);
      if (kinds[f.name] !== f.kind) v.push(`${at(i, entry)}: field ${f.name} declared as ${kinds[f.name]}, is ${f.kind}`);
      if (f.kind === 'choose-one' || f.kind === 'choose-many') {
        const offered = new Set(offeredValues(form, f.name));
        for (const o of f.options) if (!offered.has(encodeValue(o.value))) v.push(`${at(i, entry)}: option ${encodeValue(o.value)} of ${f.name} was dropped`);
      }
    }
  });

  // Direction 2: every name in every form is a real field of its entry, and
  // every option offered is a real option of that field.
  forms.forEach((form, k) => {
    const i = Number(form.attrs['data-entry']);
    const entry = entries[i];
    if (!entry) return void v.push(`${where}form ${k}: claims entry ${form.attrs['data-entry']}, which does not exist`);
    for (const c of form.controls) {
      const name = c.attrs.name;
      if (name === undefined) continue;
      if ((META as readonly string[]).includes(name)) continue;
      // An allocate box is `field:{option value}`; anything else is the field name itself.
      const colon = name.indexOf(':');
      const base = colon === -1 ? name : name.slice(0, colon);
      const field: Field | undefined = entry.fields.find((f) => f.name === base);
      if (!field) {
        v.push(`${at(i, entry)}: control "${name}" names no field of the entry`);
        continue;
      }
      if ((colon !== -1) !== (field.kind === 'allocate')) {
        v.push(`${at(i, entry)}: control "${name}" does not match ${field.name}'s kind (${field.kind})`);
        continue;
      }
      if (field.kind === 'allocate') {
        if (!field.options.some((o) => encodeValue(o.value) === name.slice(colon + 1))) {
          v.push(`${at(i, entry)}: ${field.name} has a box for ${name.slice(colon + 1)}, which the affordance never offered`);
        }
        continue;
      }
      if (field.kind === 'choose-one' || field.kind === 'choose-many') {
        const real = new Set(field.options.map((o) => encodeValue(o.value)));
        for (const val of offeredValues(form, name)) if (!real.has(val)) v.push(`${at(i, entry)}: ${name} offers ${val}, which the affordance never did`);
      }
    }
    const kinds = JSON.parse(metaValue(form, '_kinds') ?? '{}') as Record<string, string>;
    for (const name of Object.keys(kinds)) {
      if (!entry.fields.some((f) => f.name === name)) v.push(`${at(i, entry)}: _kinds declares "${name}", which is no field of the entry`);
    }
  });
  return v;
}

/** prepare + reduce on a clone, exactly as appendAction does; the refusal message, or null. */
function foldError(state: OathState, seat: number, type: string, payload: unknown): string | null {
  try {
    const clone = structuredClone(state);
    const enriched = oath.prepare ? oath.prepare(clone, { type, actor: seat, payload }) : payload;
    oath.reduce(clone, { gameId: GAME, seq: state.actionCount + 1, type, actor: seat, payload: enriched, createdAt: '2026-09-30T00:00:00.000Z' });
    return null;
  } catch (e) {
    if (e instanceof IllegalAction) return e.message;
    throw e;
  }
}

/** Every (fixture, prefix, seat) the games reach, with that seat's affordances — plus the built campaign states the games never reach. */
function* reached(): Generator<{ where: string; state: OathState; seat: number; entries: Affordance[] }> {
  // A won campaign with banish/burn, and its casualty allocation (seize-affordances.test.ts).
  const rolled = imperialRolled();
  const casualties = act(rolled, 'campaign.resolve', 1, { sacrifice: 3 });
  for (const [label, state] of [['built: campaign rolled', rolled], ['built: casualties', casualties]] as const) {
    for (let seat = 0; seat < state.players.length; seat++) {
      yield { where: `${label} ${nameOf(seat)}: `, state, seat, entries: oath.affordances!(state, seat) as Affordance[] };
    }
  }
  for (const { name, fixture, setupChoices } of FIXTURES) {
    let state = openingState(fixture, setupChoices);
    let label = 'opening';
    const visit = function* () {
      for (let seat = 0; seat < fixture.players; seat++) {
        yield { where: `${name} ${label} ${nameOf(seat)}: `, state, seat, entries: oath.affordances!(state, seat) as Affordance[] };
      }
    };
    yield* visit();
    for (const row of fixture.actions) {
      if (row.type === 'game.created') continue;
      state = oath.reduce(structuredClone(state), row as unknown as GameAction);
      label = `#${row.seq} ${row.type}`;
      yield* visit();
    }
  }
}

// ---- the tests ----------------------------------------------------------------

describe('forms ↔ affordances, both directions, over both fixtures (unit 11)', () => {
  it('every entry renders a matching form, and every form field is a real affordance field', () => {
    const violations: string[] = [];
    let forms = 0;
    for (const { where, entries, seat } of reached()) {
      const doc = composer(entries, { ...opts, freeHelp: { effects: effectsHelp(seat) } }).value;
      forms += entries.length;
      violations.push(...formViolations(entries, doc, where));
    }
    expect(violations).toEqual([]);
    expect(forms).toBeGreaterThan(100); // the games really were walked
  });

  it('a baseline browser submission decodes to the harness baseline payload, and reduce accepts the form\'s first legal choice', () => {
    const problems: string[] = [];
    let folded = 0;
    for (const { where, state, seat, entries } of reached()) {
      const forms = parseForms(composer(entries, opts).value);
      entries.forEach((entry, i) => {
        // A `free` field (declared effects, wake steps, kill allocations) has
        // no synthesizable baseline — the harness skips these entries too.
        if (entry.fields.some((f) => f.kind === 'free')) return;
        const sub = decodeSubmission(baselineSubmission(forms[i]));
        const expected = baselinePayload(entry.fields);
        if (sub.type !== entry.type) problems.push(`${where}${entry.type}: decoded as ${sub.type}`);
        if (sub.prevSeq !== opts.seq) problems.push(`${where}${entry.type}: prevSeq decoded as ${sub.prevSeq}`);
        if (JSON.stringify(sub.payload) !== JSON.stringify(expected)) {
          problems.push(`${where}${entry.type}: decoded ${JSON.stringify(sub.payload)}, harness baseline is ${JSON.stringify(expected)}`);
        }
        // Reduce must accept the smallest legal submission whenever the form
        // has a legal choice in every field (a field with every option
        // disabled cannot be submitted).
        const submittable = entry.fields.every((f) => (f.kind === 'choose-one' ? f.options.some((o) => !o.disabled) : true));
        if (submittable) {
          const legal = decodeSubmission(baselineSubmission(forms[i], true));
          const err = foldError(state, seat, entry.type, legal.payload);
          folded++;
          if (err !== null) problems.push(`${where}${entry.type}: the decoded baseline was refused: ${err}`);
        }
      });
    }
    expect(problems).toEqual([]);
    expect(folded).toBeGreaterThan(100);
  });

  it('renders a form for every field kind somewhere in the two games', () => {
    const kinds = new Set<string>();
    const controls = new Set<string>();
    for (const { entries } of reached()) {
      for (const e of entries) for (const f of e.fields) kinds.add(f.kind);
      for (const form of parseForms(composer(entries, opts).value)) {
        for (const c of form.controls) controls.add(c.tag === 'input' ? `input:${c.attrs.type}` : c.tag);
      }
    }
    expect([...kinds].sort()).toEqual(['allocate', 'choose-many', 'choose-one', 'count', 'flag', 'free']);
    // radios (choose-one), checkboxes (choose-many, flag), numbers (count), textareas (free)
    for (const c of ['input:radio', 'input:checkbox', 'input:number', 'textarea']) expect(controls).toContain(c);
  });

  it('the board page carries the same composer the conformance test checks', () => {
    const { fixture, setupChoices } = FIXTURES[0];
    const state = openingState(fixture, setupChoices);
    const entries = oath.affordances!(state, 0) as Affordance[];
    expect(entries.length).toBeGreaterThan(0);
    const model = boardModel(project(state, 0), { gameId: GAME, seat: 0, names: ['A', 'B', 'C'] });
    const page = boardPage(model, { compose: { entries, seq: 7, back: `/games/${GAME}` } });
    expect(formViolations(entries, page)).toEqual([]);
    // A spectator gets no composer at all.
    const spectator = boardPage(boardModel(project(state, null), { gameId: GAME, seat: null, names: ['A', 'B', 'C'] }), {
      compose: { entries, seq: 7, back: `/games/${GAME}` },
    });
    expect(parseForms(spectator)).toEqual([]);
  });
});

describe('the dry-run panel', () => {
  const { fixture, setupChoices } = FIXTURES[0];
  const state = openingState(fixture, setupChoices);
  const model = boardModel(project(state, 0), { gameId: GAME, seat: 0, names: ['A', 'B', 'C'] });
  const page = (dryRun: DryRunView) =>
    boardPage(model, { compose: { entries: [], seq: 1, back: '/', dryRun } });

  it('never shows a roll: an action that rolls dice gets no outcome preview at all', () => {
    const out = page({ ok: true, type: 'campaign.respond', changes: [{ what: 'Warbands on your board', before: '3', after: '1' }], rollsDice: true });
    expect(out).toContain('Campaign: respond would be accepted.');
    expect(out).toContain('there is no preview of the result: the dice are rolled once, when you submit');
    expect(out).not.toContain('class="die');
    expect(out).not.toContain('dryrun-changes');
  });

  it("shows the engine's refusal verbatim", () => {
    expect(page({ ok: false, type: 'power.use', message: 'applyEffects: effect 0 (supply) is infeasible: x' })).toContain(
      '<strong>Power: use would be refused:</strong> applyEffects: effect 0 (supply) is infeasible: x',
    );
  });
});

describe('the conformance check bites (planted violations)', () => {
  const { fixture, setupChoices } = FIXTURES[0];
  const state = openingState(fixture, setupChoices);
  const entries = oath.affordances!(state, 0) as Affordance[];
  const doc = composer(entries, opts).value;
  const choose = entries.find((e) => e.fields.some((f) => f.kind === 'choose-one'))!;

  it('is clean before planting anything', () => {
    expect(formViolations(entries, doc)).toEqual([]);
  });

  it('direction 1: an entry with no form is caught', () => {
    const extra: Affordance = { type: 'invented.action', fields: [] };
    const v = formViolations([...entries, extra], doc);
    expect(v.join('\n')).toMatch(/invented\.action\): no form rendered/);
  });

  it('direction 1: a dropped option is caught', () => {
    const fewer = doc.replace(/<label class="opt"><input type="radio"[^>]*> <span>[^<]*<\/span><\/label>/, '');
    expect(fewer).not.toBe(doc);
    expect(formViolations(entries, fewer).join('\n')).toMatch(/was dropped/);
  });

  it('direction 2: a control naming no field is caught', () => {
    const planted = doc.replace('<input type="hidden" name="_prevSeq"', '<input name="bogus"><input type="hidden" name="_prevSeq"');
    expect(formViolations(entries, planted).join('\n')).toMatch(/control "bogus" names no field/);
  });

  it('direction 2: an invented option is caught', () => {
    const field = choose.fields.find((f) => f.kind === 'choose-one')!;
    const i = entries.indexOf(choose);
    const formStart = doc.indexOf(`data-entry="${i}"`);
    const planted =
      doc.slice(0, formStart) +
      doc.slice(formStart).replace('<fieldset class="field">', `<fieldset class="field"><input type="radio" name="${field.name}" value="&quot;site:invented&quot;">`);
    expect(formViolations(entries, planted).join('\n')).toMatch(/offers "site:invented", which the affordance never did/);
  });
});

describe('the conformance check bites on allocate boxes too', () => {
  const casualties = act(imperialRolled(), 'campaign.resolve', 1, { sacrifice: 3 });
  const entries = (oath.affordances!(casualties, 0) as Affordance[]);
  const doc = composer(entries, opts).value;

  it('is clean before planting anything', () => {
    expect(doc).toContain('name="kills:{&quot;kind&quot;:&quot;board&quot;,&quot;seat&quot;:2}"');
    expect(formViolations(entries, doc)).toEqual([]);
  });

  it('catches a dropped box', () => {
    const dropped = doc.replace(/<label class="alloc-row">(?:(?!<\/label>)[\s\S])*?&quot;board&quot;[\s\S]*?<\/label>/, '');
    expect(dropped).not.toBe(doc);
    expect(formViolations(entries, dropped).join('\n')).toMatch(/option \{"kind":"board","seat":2\} of kills has no box/);
  });

  it('catches an invented box', () => {
    const planted = doc.replace('<label class="alloc-row">', '<input type="number" name="kills:{&quot;kind&quot;:&quot;board&quot;,&quot;seat&quot;:9}"><label class="alloc-row">');
    expect(formViolations(entries, planted).join('\n')).toMatch(/kills has a box for \{"kind":"board","seat":9\}, which the affordance never offered/);
  });
});

describe('the decoder, per kind', () => {
  const kinds = (o: Record<string, string>) => JSON.stringify(o);
  const base = { _type: 't', _prevSeq: '3', _back: '/games/g' };

  it('decodes each field kind from what a browser sends', () => {
    const sub = decodeSubmission({
      ...base,
      _kinds: kinds({ one: 'choose-one', many: 'choose-many', n: 'count', on: 'flag', off: 'flag', effects: 'free', none: 'choose-many' }),
      one: '"site:x"',
      many: ['1', '{"a":2}'],
      n: '2',
      on: 'true',
      effects: '[{"kind":"supply","seat":0,"delta":1}]',
    });
    expect(sub).toMatchObject({ type: 't', prevSeq: 3, back: '/games/g', dryRun: false });
    expect(sub.payload).toEqual({
      one: 'site:x',
      many: [1, { a: 2 }],
      n: 2,
      on: true,
      off: false,
      effects: [{ kind: 'supply', seat: 0, delta: 1 }],
      none: [],
    });
  });

  it('decodes an allocation: nonzero boxes become { ...value, count }, in order', () => {
    const sub = decodeSubmission({
      ...base,
      _kinds: kinds({ kills: 'allocate', place: 'allocate' }),
      'kills:{"kind":"site","siteId":"site:mine","seat":0}': '1',
      'kills:{"kind":"board","seat":2}': '0',
      'kills:3': '2',
    });
    expect(sub.payload).toEqual({ kills: [{ kind: 'site', siteId: 'site:mine', seat: 0, count: 1 }, { value: 3, count: 2 }], place: [] });
    expect(() => decodeSubmission({ ...base, _kinds: kinds({ kills: 'allocate' }), 'kills:1': '1.5' })).toThrow(/whole number/);
  });

  it('a single checked choose-many value still decodes as a list', () => {
    expect(decodeSubmission({ ...base, _kinds: kinds({ many: 'choose-many' }), many: '"x"' }).payload).toEqual({ many: ['x'] });
  });

  it('flags a dry run', () => {
    expect(decodeSubmission({ ...base, _kinds: '{}', _dryRun: '1' }).dryRun).toBe(true);
  });

  it('refuses bad JSON and malformed meta with a readable message', () => {
    expect(() => decodeSubmission({ ...base, _kinds: kinds({ effects: 'free' }), effects: '[{' })).toThrow(/effects field is not valid JSON/);
    expect(() => decodeSubmission({ ...base, _kinds: 'nope' })).toThrow(/malformed/);
    expect(() => decodeSubmission({ ...base, _kinds: kinds({ _type: 'free' }) })).toThrow(/malformed/);
    expect(() => decodeSubmission({ _type: 't', _kinds: '{}' })).toThrow(/sequence number/);
  });
});

describe('the declared-power vocabulary', () => {
  it('every example is a valid Effect', () => {
    for (const x of effectExamples(2)) expect(EffectSchema.safeParse(x.effect).success, x.kind).toBe(true);
  });

  it('covers every Effect kind, and names every zone kind the schema has', () => {
    const src = readFileSync(join(import.meta.dirname, '..', '..', 'src', 'oath', 'game', 'effects.ts'), 'utf8');
    const effectBlock = src.slice(src.indexOf('export const EffectSchema'), src.indexOf('export const EffectsSchema'));
    const effectKinds = [...effectBlock.matchAll(/kind: z\.literal\('(\w+)'\)/g)].map((m) => m[1]);
    expect(effectExamples(0).map((x) => x.kind).sort()).toEqual([...effectKinds].sort());

    const zoneBlock = src.slice(src.indexOf('const FavorZoneSchema'), src.indexOf('const FlipTargetSchema'));
    const zoneKinds = new Set([...zoneBlock.matchAll(/kind: z\.literal\('(\w+)'\)/g)].map((m) => m[1]));
    const help = effectsHelp(0).value;
    for (const z of zoneKinds) expect(help, z).toContain(z);
  });
});
