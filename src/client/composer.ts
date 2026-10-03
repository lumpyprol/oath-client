/**
 * The composer (P4 unit 11): an affordance entry → a form, and a submitted
 * form → a payload. This is where D56's "the client never computes a rule"
 * stops being a principle and becomes a property: every form is generated
 * FROM an affordance entry the server computed, by ONE renderer per field
 * KIND — never per action. Nothing here knows what Travel or Muster is; it
 * knows choose-one, choose-many, count, flag and free. No card, site or cost
 * appears in a form unless an affordance option carried it.
 *
 * test/client/forms.test.ts ties the two together in both directions (every
 * entry renders a matching form; every rendered field name is a real field)
 * over both frozen fixtures, prefix by prefix, for every seat — and proves the
 * decoder round-trips a baseline submission into a payload `reduce` accepts.
 *
 * WIRE FORMAT. A form posts urlencoded fields:
 *   - one control per affordance field, NAMED EXACTLY as the field. A
 *     choose-one/choose-many option's value is the JSON of `Option.value`
 *     (values are ids, numbers, objects — JSON is the one encoding that
 *     round-trips all of them); a count is a number; a flag is the checkbox
 *     "true"; a free field is JSON text.
 *   - META fields, all `_`-prefixed (see META): the action type, the seq it
 *     was composed against, the decision it acts within, the page to return
 *     to, and `_kinds` — each field's kind, so the decoder knows that an
 *     ABSENT choose-many means [] and an absent flag means false. `_kinds` is
 *     client-supplied and therefore untrusted, which is fine: it only steers
 *     decoding, and the engine validates whatever payload comes out.
 */

import { html, raw, escapeHtml, type Raw } from './html.js';
import type { Affordance, Field, Option } from '../oath/game/affordances.js';
import { ACTION_RULES, NOT_RULES, ruleUrl } from './action-rules.js';

/** Every meta field a composed form may carry. Anything else must be an affordance field. */
export const META = ['_type', '_prevSeq', '_decision', '_back', '_kinds', '_dryRun'] as const;

export type FieldKind = Field['kind'];
/** choose-one and choose-many share one shape (their `kind` is a union in affordances.ts). */
type ChooseField = Exclude<Extract<Field, { options: Option[] }>, { kind: 'allocate' }>;
type AllocateField = Extract<Field, { kind: 'allocate' }>;

/** An allocate field's per-option control name: `kills:{"kind":"board","seat":1}`. */
export const allocateName = (field: string, value: unknown): string => `${field}:${encodeValue(value)}`;

/** The submitted counts of an allocate field: [option value JSON, raw count] in submission order. */
function allocated(name: string, body: RawBody): [string, string][] {
  const prefix = `${name}:`;
  return Object.entries(body)
    .filter(([k]) => k.startsWith(prefix))
    .map(([k, v]) => [k.slice(prefix.length), asList(v)[0] ?? '']);
}

/** A urlencoded body as Express (extended: false) parses it: repeated keys become arrays. */
export type RawBody = Record<string, string | string[] | undefined>;

/** Where a composed form posts. */
export const actUrl = (gameId: string): string => `/games/${gameId}/act`;

// ---- labels (generic, from names only — never per action) -----------------

/** `campaign.resolve` → "Campaign: resolve"; `travel` → "Travel"; a few take the Law's own name (TITLES). */
/** Where the Law's own name for an action reads better than one built from its type. */
const TITLES: Record<string, string> = {
  'adviser.play': 'Facedown adviser: play or discard', // Law §6.1's own name
  'campaign.declare': 'Campaign', // Law §5.5's own name (Ben)
  'turn.rest': 'Rest', // Law §4.3's own name (Ben)
  'travel.direct': 'Shrouded Wood: choose their destination', // Law §11.7
};

export function typeLabel(type: string): string {
  if (TITLES[type]) return TITLES[type];
  const words = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  const [head, ...rest] = type.split('.');
  const cap = words(head).replace(/^./, (c) => c.toUpperCase());
  return rest.length ? `${cap}: ${rest.map(words).join(' ')}` : cap;
}

/** A field's display heading: its own `label` when the server gave one, else from its name. */
const heading = (field: Field): string => field.label ?? fieldLabel(field.name);

/** `siteId` → "site", `toSiteId` → "to site", `count` → "count". */
function fieldLabel(name: string): string {
  return name
    .replace(/(Id|Index)$/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase();
}

function costText(opt: Option): string {
  const c = opt.cost;
  if (!c) return '';
  const parts = [
    c.supply ? `${c.supply} Supply` : null,
    c.favor ? `${c.favor} favor` : null,
    c.secrets ? `${c.secrets} secret${c.secrets === 1 ? '' : 's'}` : null,
  ].filter((p) => p !== null);
  const law = opt.law ? ` (${opt.law})` : '';
  if (!parts.length && law && c.supply === 0) return ` — no Supply${law}`; // a power made it free
  return parts.length ? ` — ${parts.join(', ')}${law}` : law;
}

/** The JSON an option's control carries; also how a submitted value is matched back to an option. */
export const encodeValue = (v: unknown): string => JSON.stringify(v);

// ---- renderers, one per field kind -----------------------------------------

/** Above this many options a choose-one becomes a <select> rather than radios. */
const RADIO_LIMIT = 8;

const asList = (v: string | string[] | undefined): string[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** The submitted raw value(s) to prefill one field with, if any. */
type Prefill = RawBody | undefined;

/** An option's card face, when the affordance named one and the page can draw it. */
function optFace(o: Option, artFor: ArtFor | undefined): Raw {
  const ref = o.art && artFor ? artFor(o.art) : null;
  if (!ref) return raw('');
  const img = html`<img class="opt-face" src="${ref.src}" alt="" loading="lazy">`;
  return ref.landscape ? html`<span class="land">${img}</span>` : img;
}

/** One radio/checkbox option: the control, its face if any, its label, cost and why-not. */
/** The labels a dependent option's required values go by (for the no-script note). */
type LabelOf = (field: string, value: unknown) => string | undefined;

function optionControl(
  field: ChooseField,
  o: Option,
  type: 'radio' | 'checkbox',
  checked: boolean,
  required: boolean,
  artFor: ArtFor | undefined,
  labelOf?: LabelOf,
): Raw {
  const v = encodeValue(o.value);
  const cls = `opt${o.art ? ' card-opt' : ''}${o.disabled ? ' disabled' : ''}`;
  // A dependent option (`requires`): the script shows it only while the other
  // field holds one of the listed values; without the script it says which.
  const req = o.requires
    ? raw(` data-requires-field="${escapeHtml(o.requires.field)}" data-requires="${escapeHtml(JSON.stringify(o.requires.values.map(encodeValue)))}"`)
    : raw('');
  const reqNote = o.requires
    ? html` <span class="req-note">(for ${o.requires.values.map((x) => labelOf?.(o.requires!.field, x) ?? String(x)).join(', ')})</span>`
    : '';
  return html`<label class="${cls}"${req}><input type="${type}" name="${field.name}" value="${v}"${raw(o.requires ? ' data-dep' : '')}${raw(o.disabled ? ' disabled data-off' : '')}${raw(required ? ' required' : '')}${raw(!o.disabled && checked ? ' checked' : '')}>${optFace(o, artFor)} <span>${o.label}${costText(o)}</span>${reqNote}${o.disabled ? html` <span class="why">${o.disabled}</span>` : ''}</label>`;
}

/** How a one-answer field shows inside a picker box: not at all (the picker says it), or as a line of text. */
type Fixed = 'hidden' | 'text' | null;

function chooseOne(field: ChooseField, prefill: Prefill, artFor?: ArtFor, fixed: Fixed = null, labelOf?: LabelOf): Raw {
  // Inside a picker box (several forms of one action) picking at the top
  // decides every one-answer field of that form, so none is asked again: it
  // rides as a fixed value, shown as text unless it only repeats the picker.
  // Anywhere else, even a one-answer choice is shown and picked like any
  // other (Ben: Muster with one denizen still asks for it).
  if (fixed && field.options.length === 1 && !field.options[0].disabled) {
    const o = field.options[0];
    return html`<input type="hidden" name="${field.name}" value="${encodeValue(o.value)}">${
      fixed === 'text' ? html`<p class="field fixed"><span class="field-name">${heading(field)}</span> ${o.label}${costText(o)}</p>` : ''
    }`;
  }
  const chosen = prefill ? asList(prefill[field.name])[0] : undefined;
  const anyLegal = field.options.some((o) => !o.disabled);
  const control = (o: Option) => optionControl(field, o, 'radio', encodeValue(o.value) === chosen, anyLegal, artFor, labelOf);
  // Grouped options (Travel's regions) read as columns, in the order the
  // groups first appear — the board's own left-to-right order.
  if (field.options.some((o) => o.group)) {
    const groups: string[] = [];
    for (const o of field.options) if (!groups.includes(o.group ?? '')) groups.push(o.group ?? '');
    return html`<fieldset class="field"><legend class="field-name">${heading(field)}</legend>
      <div class="opt-groups">${groups.map(
        (g) => html`<div class="opt-group"><span class="group-name">${g}</span>${field.options.filter((o) => (o.group ?? '') === g).map(control)}</div>`,
      )}</div>
    </fieldset>`;
  }
  if (field.options.length > RADIO_LIMIT && !field.options.some((o) => o.art || o.requires)) {
    return html`<label class="field"><span class="field-name">${heading(field)}</span>
      <select name="${field.name}" ${raw(anyLegal ? 'required' : '')}>
        <option value="">— choose —</option>
        ${field.options.map((o) => {
          const v = encodeValue(o.value);
          return html`<option value="${v}"${raw(o.disabled ? ' disabled' : '')}${raw(!o.disabled && v === chosen ? ' selected' : '')}>${o.label}${costText(o)}${o.disabled ? ` (${o.disabled})` : ''}</option>`;
        })}
      </select></label>`;
  }
  return html`<fieldset class="field"><legend class="field-name">${heading(field)}</legend>
    ${field.options.map(control)}
  </fieldset>`;
}

function chooseMany(field: ChooseField, prefill: Prefill, artFor?: ArtFor): Raw {
  const chosen = new Set(prefill ? asList(prefill[field.name]) : []);
  // The max is enforced by the server; data-max lets the script enforce it as a courtesy.
  return html`<fieldset class="field"${raw(field.max !== undefined ? ` data-max="${field.max}"` : '')}>
    <legend class="field-name">${heading(field)}${field.max !== undefined ? ` (up to ${field.max})` : ''}</legend>
    ${field.options.map((o) => optionControl(field, o, 'checkbox', chosen.has(encodeValue(o.value)), false, artFor))}
  </fieldset>`;
}

function count(field: Extract<Field, { kind: 'count' }>, prefill: Prefill): Raw {
  const submitted = prefill ? Number(asList(prefill[field.name])[0]) : NaN;
  const value = Number.isInteger(submitted) && submitted >= field.min && submitted <= field.max ? submitted : field.min;
  return html`<label class="field"><span class="field-name">${heading(field)}</span>
    <input type="number" name="${field.name}" min="${field.min}" max="${field.max}" step="1" value="${value}" required>
    <span class="muted">(${field.min}–${field.max})</span></label>`;
}

function flag(field: Extract<Field, { kind: 'flag' }>, prefill: Prefill): Raw {
  const on = prefill ? asList(prefill[field.name])[0] === 'true' : false;
  return html`<label class="field opt"><input type="checkbox" name="${field.name}" value="true"${raw(on ? ' checked' : '')}> ${heading(field)}</label>`;
}

/**
 * Allocate: a number box per option (capped at the option's own max), the
 * total bound stated in the legend and enforced by the engine. `data-min` on
 * each box carries the total's lower bound for tooling that fills the form.
 */
function allocate(field: AllocateField, prefill: Prefill, artFor?: ArtFor): Raw {
  const bound = field.min === field.max ? `exactly ${field.max}` : field.min === 0 ? `up to ${field.max}` : `${field.min}–${field.max}`;
  return html`<fieldset class="field allocate"><legend class="field-name">${heading(field)} (${bound} in all)</legend>
    ${field.options.map((o) => {
      const name = allocateName(field.name, o.value);
      const cap = Math.min(o.max ?? field.max, field.max);
      const submitted = prefill ? Number(asList(prefill[name])[0]) : 0;
      const value = Number.isInteger(submitted) && submitted >= 0 && submitted <= cap ? submitted : 0;
      return html`<label class="alloc-row">${optFace(o, artFor)}<span>${o.label}</span>
        <input type="number" name="${name}" min="0" max="${cap}" step="1" value="${value}" data-min="${field.min}"${raw(o.disabled ? ' disabled' : '')}></label>`;
    })}
  </fieldset>`;
}

function free(field: Extract<Field, { kind: 'free' }>, prefill: Prefill, extra: Raw): Raw {
  const text = prefill ? (asList(prefill[field.name])[0] ?? '[]') : '[]';
  return html`<label class="field free"><span class="field-name">${heading(field)}</span>
    <span class="schema">${field.schema}</span>
    <textarea name="${field.name}" rows="4" spellcheck="false">${text}</textarea></label>
    ${extra}`;
}

export interface ComposerOptions {
  gameId: string;
  seq: number;
  /** The in-app page the form returns to after a successful submit. */
  back: string;
  /** A submission to put back into the form it came from (the 409 / illegal re-render). */
  prefill?: { index: number; body: RawBody };
  /** Extra markup rendered under a named `free` field (the effects vocabulary). */
  freeHelp?: Record<string, Raw>;
  /**
   * Draw only the entries this accepts (the board places standing answers,
   * the Search and the rest in separate boxes). Every entry keeps its own
   * index, so a form's `data-entry` never depends on where it is drawn.
   */
  include?: (entry: Affordance) => boolean;
  /** Draw each form already open (the Search's one form). */
  open?: boolean;
  /**
   * Actions this seat cannot take now, with the server's reason: drawn
   * greyed and inert among the forms (Ben: always show every action).
   * Only those passing `include` are drawn.
   */
  greyed?: { type: string; reason: string }[];
  /** A fixed order of action types, so an action never jumps when it becomes available. */
  order?: readonly string[];
  /** Action types not to draw as forms (they are shown greyed instead). */
  hideTypes?: ReadonlySet<string>;
  /** Resolves an option's `art` hint to an image URL (null = draw none). */
  artFor?: ArtFor;
}

/** An option's art hint → an image URL (and whether it is drawn landscape, like a Vision), or null. */
export type ArtFor = (key: string) => { src: string; landscape?: boolean } | null;

/**
 * The entry's first one-answer choice: what tells same-type entries apart
 * (two Recovers, three Campaign declarations) — the fixed choice the server
 * split them by, offered as the picker of their shared box.
 */
function distinguishing(entry: Affordance): Field | null {
  for (const f of entry.fields) if (f.kind === 'choose-one' && f.options.length === 1) return f;
  return null;
}

/** The rule behind an action: our one-line reminder and a link to the Law's own text. */
function ruleLine(type: string): Raw {
  const rule = ACTION_RULES[type];
  if (rule) {
    return html`<p class="rule"><a href="${ruleUrl(rule.section)}" target="_blank" rel="noopener">Law §${rule.section}</a> ${rule.summary}</p>`;
  }
  const setting = NOT_RULES[type];
  return setting ? html`<p class="rule">${setting}</p>` : raw('');
}

/** One form for one affordance entry. `index` is the entry's position in the list. */
export function composeForm(entry: Affordance, index: number, opts: ComposerOptions): Raw {
  const prefill = opts.prefill?.index === index;
  return html`<details class="compose"${raw(prefill || opts.open ? ' open' : '')} id="compose-${index}">
    <summary>${typeLabel(entry.type)}${entry.note ? html` <span class="note">${entry.note}</span>` : ''}</summary>
    ${ruleLine(entry.type)}
    ${formOf(entry, index, opts, null)}
  </details>`;
}

/** Does one label just restate the other ("The Darkest Secret" / "Darkest Secret")? */
function restates(a: string, b: string): boolean {
  const norm = (x: string) => x.toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9 ]/g, '').trim();
  const [x, y] = [norm(a), norm(b)];
  return x.length > 0 && y.length > 0 && (x.includes(y) || y.includes(x));
}

/** Inside a picker box: hide the picker's own field and any one-answer field that restates it; show the rest as text. */
function fixedness(f: ChooseField, picker: Field): Fixed {
  if (f === picker) return 'hidden';
  const pickLabel = 'options' in picker ? picker.options[0]?.label ?? '' : '';
  return f.options.length === 1 && restates(f.options[0].label, pickLabel) ? 'hidden' : 'text';
}

/**
 * The <form> for one entry (no surrounding box): its meta, its controls, its
 * buttons. `picker` is set inside a picker box: the field the box's picker
 * chose by.
 */
function formOf(entry: Affordance, index: number, opts: ComposerOptions, picker: Field | null): Raw {
  const prefill = opts.prefill?.index === index ? opts.prefill.body : undefined;
  const labelOf: LabelOf = (name, value) => {
    const f = entry.fields.find((x) => x.name === name);
    return f && 'options' in f ? f.options.find((o) => encodeValue(o.value) === encodeValue(value))?.label : undefined;
  };
  const kinds = Object.fromEntries(entry.fields.map((f) => [f.name, f.kind]));
  const controls = entry.fields.map((f) => {
    switch (f.kind) {
      case 'choose-one':
        return chooseOne(f, prefill, opts.artFor, picker ? fixedness(f, picker) : null, labelOf);
      case 'choose-many':
        return chooseMany(f, prefill, opts.artFor);
      case 'count':
        return count(f, prefill);
      case 'flag':
        return flag(f, prefill);
      case 'allocate':
        return allocate(f, prefill, opts.artFor);
      case 'free':
        return free(f, prefill, opts.freeHelp?.[f.name] ?? raw(''));
    }
  });
  const label = typeLabel(entry.type);
  return html`<form method="post" action="${actUrl(opts.gameId)}" class="compose-form" data-entry="${index}">
      <input type="hidden" name="_type" value="${entry.type}">
      <input type="hidden" name="_prevSeq" value="${opts.seq}">
      ${entry.decisionId ? html`<input type="hidden" name="_decision" value="${entry.decisionId}">` : ''}
      <input type="hidden" name="_back" value="${opts.back}">
      <input type="hidden" name="_kinds" value="${JSON.stringify(kinds)}">
      ${controls}
      <div class="compose-buttons">
        <button type="submit">${label}</button>
        <button type="submit" name="_dryRun" value="1" formnovalidate class="secondary">Check this</button>
        <button type="reset" class="secondary">Reset</button>
      </div>
    </form>`;
}

/**
 * Several entries of ONE action type (Recover: a relic, or either banner;
 * Move warbands: each direction; Campaign: each defender) as ONE box (Ben,
 * 2026-10-01): pick which at the top, and the box shows that one's form.
 * Each stays its own <form> — the wire format, the decoder and the
 * conformance test are untouched — and without the script every one shows,
 * each under its own heading.
 */
function variantBox(type: string, items: { e: Affordance; i: number }[], opts: ComposerOptions): Raw {
  const first = items[0].i;
  const picks = items.map(({ e }) => distinguishing(e));
  const nameOf = (k: number) => (picks[k] && 'options' in picks[k]! ? picks[k]!.options[0].label : `Option ${k + 1}`);
  const sameField = picks.every((f) => f && f.name === picks[0]?.name);
  const which = sameField && picks[0] ? heading(picks[0]) : 'which';
  const chosen = Math.max(0, items.findIndex(({ i }) => opts.prefill?.index === i));
  const open = items.some(({ i }) => opts.prefill?.index === i) || opts.open;
  return html`<details class="compose"${raw(open ? ' open' : '')} id="compose-${first}">
    <summary>${typeLabel(type)}</summary>
    ${ruleLine(type)}
    <fieldset class="field variant-pick"><legend class="field-name">${which}</legend>
      ${items.map(({ i }, k) => html`<label class="opt"><input type="radio" name="variant-${first}" value="${i}" data-variant-pick${raw(k === chosen ? ' checked' : '')}> ${nameOf(k)}</label>`)}
    </fieldset>
    ${items.map(({ e, i }, k) => html`<div class="variant" data-variant="${i}">
      <h4 class="variant-name">${nameOf(k)}</h4>
      ${e.note ? html`<p class="note">${e.note}</p>` : ''}
      ${formOf(e, i, opts, picks[k])}
    </div>`)}
  </details>`;
}

/** An action this seat cannot take now: greyed, inert, with the server's reason. No form. */
function unavailableBox(g: { type: string; reason: string }): Raw {
  return html`<div class="compose unavailable" aria-disabled="true">
    <div class="u-title">${typeLabel(g.type)}</div>
    <p class="why">${g.reason}</p>
  </div>`;
}

/** Every entry's form, in entry order. */
export function composer(entries: Affordance[], opts: ComposerOptions): Raw {
  const keep = (type: string) => !opts.include || opts.include({ type, fields: [] });
  const shown = entries
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => (!opts.include || opts.include(e)) && !opts.hideTypes?.has(e.type));
  const greyed = (opts.greyed ?? []).filter((g) => keep(g.type) && !shown.some(({ e }) => e.type === g.type));
  if (shown.length === 0 && greyed.length === 0) return opts.include ? raw('') : html`<p class="muted">Nothing for you to do right now.</p>`;
  // One box per action type, in order of first appearance (or the fixed order).
  const byType = new Map<string, { e: Affordance; i: number }[]>();
  for (const x of shown) byType.set(x.e.type, [...(byType.get(x.e.type) ?? []), x]);
  const boxes: { type: string; box: Raw }[] = [
    ...[...byType].map(([type, items]) => ({
      type,
      box: items.length === 1 ? composeForm(items[0].e, items[0].i, opts) : variantBox(type, items, opts),
    })),
    ...greyed.map((g) => ({ type: g.type, box: unavailableBox(g) })),
  ];
  const rank = (t: string) => {
    const i = opts.order?.indexOf(t) ?? -1;
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  boxes.sort((a, b) => rank(a.type) - rank(b.type)); // stable: unranked keep their order
  return html`<div class="composer">${boxes.map((b) => b.box)}</div>`;
}

// ---- the decoder, mirroring the renderers -----------------------------------

export interface Submission {
  type: string;
  prevSeq: number;
  decisionId?: string;
  back: string;
  dryRun: boolean;
  payload: Record<string, unknown>;
}

/** A form that could not be turned into a payload at all (bad JSON, missing meta). */
export class DecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecodeError';
  }
}

const KINDS: readonly FieldKind[] = ['choose-one', 'choose-many', 'count', 'flag', 'free', 'allocate'];

function parseJson(name: string, text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new DecodeError(`The ${fieldLabel(name)} field is not valid JSON.`);
  }
}

/** Decode one field from the body by its kind; `undefined` = leave it out of the payload. */
export function decodeField(name: string, kind: FieldKind, body: RawBody): unknown {
  const values = asList(body[name]);
  switch (kind) {
    case 'allocate': {
      // Each nonzero box becomes `{ ...value, count }` (`{ value, count }` for a non-object value).
      const out: Record<string, unknown>[] = [];
      for (const [valueJson, rawCount] of allocated(name, body)) {
        if (rawCount === '') continue;
        const count = Number(rawCount);
        if (!Number.isInteger(count) || count < 0) throw new DecodeError(`Every ${fieldLabel(name)} number must be a whole number.`);
        if (count === 0) continue;
        const value = parseJson(name, valueJson);
        out.push(typeof value === 'object' && value !== null && !Array.isArray(value) ? { ...value, count } : { value, count });
      }
      return out;
    }
    case 'choose-one':
      return values[0] === undefined || values[0] === '' ? undefined : parseJson(name, values[0]);
    case 'choose-many':
      return values.map((v) => parseJson(name, v));
    case 'count': {
      if (values[0] === undefined || values[0] === '') return undefined;
      const n = Number(values[0]);
      if (!Number.isInteger(n)) throw new DecodeError(`The ${fieldLabel(name)} field must be a whole number.`);
      return n;
    }
    case 'flag':
      return values[0] === 'true';
    case 'free':
      return values[0] === undefined || values[0].trim() === '' ? undefined : parseJson(name, values[0]);
  }
}

/** A posted composer form → the action it describes. Throws DecodeError on a malformed form. */
export function decodeSubmission(body: RawBody): Submission {
  const one = (k: string): string | undefined => asList(body[k])[0];
  const type = one('_type');
  const prevSeq = Number(one('_prevSeq'));
  if (!type || !Number.isInteger(prevSeq) || prevSeq < 0) throw new DecodeError('That form is missing its action or sequence number.');

  let kinds: Record<string, FieldKind>;
  try {
    const parsed = JSON.parse(one('_kinds') ?? '{}') as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error();
    kinds = parsed as Record<string, FieldKind>;
  } catch {
    throw new DecodeError('That form is malformed.');
  }

  const payload: Record<string, unknown> = {};
  for (const [name, kind] of Object.entries(kinds)) {
    if (name.startsWith('_') || !KINDS.includes(kind)) throw new DecodeError('That form is malformed.');
    const v = decodeField(name, kind, body);
    if (v !== undefined) payload[name] = v;
  }
  return {
    type,
    prevSeq,
    decisionId: one('_decision') || undefined,
    back: one('_back') ?? '/',
    dryRun: one('_dryRun') === '1',
    payload,
  };
}

// ---- after a 409: is what they chose still legal? ---------------------------

export interface Reconciled {
  /** The fresh entry the submission still fits (to prefill), or null if none. */
  index: number | null;
  /** Each choice that stopped being legal, in words — empty when it all still fits. */
  problems: string[];
}

/** Why one submitted field no longer fits a fresh field, or null if it still does. */
function fieldProblem(field: Field, body: RawBody): string | null {
  const name = heading(field);
  const values = asList(body[field.name]);
  if (field.kind === 'allocate') {
    let total = 0;
    for (const [valueJson, rawCount] of allocated(field.name, body)) {
      const n = Number(rawCount) || 0;
      if (n === 0) continue;
      const o = field.options.find((x) => encodeValue(x.value) === valueJson);
      if (!o) return `one of your ${name} choices is no longer offered`;
      if (o.max !== undefined && n > o.max) return `“${o.label}” can now take at most ${o.max}`;
      total += n;
    }
    return total < field.min || total > field.max ? `${name} must now total ${field.min === field.max ? field.max : `${field.min}–${field.max}`}` : null;
  }
  const optionFor = (v: string) =>
    field.kind === 'choose-one' || field.kind === 'choose-many' ? field.options.find((o) => encodeValue(o.value) === v) : undefined;
  const check = (v: string): string | null => {
    const o = optionFor(v);
    if (!o) return `your ${name} choice is no longer offered`;
    if (o.disabled) return `“${o.label}” is no longer allowed for ${name}: ${o.disabled}`;
    return null;
  };
  switch (field.kind) {
    case 'choose-one':
      return values[0] === undefined || values[0] === '' ? null : check(values[0]);
    case 'choose-many': {
      for (const v of values) {
        const p = check(v);
        if (p) return p;
      }
      return field.max !== undefined && values.length > field.max ? `you may now choose at most ${field.max} for ${name}` : null;
    }
    case 'count': {
      const n = Number(values[0]);
      return Number.isInteger(n) && (n < field.min || n > field.max) ? `${name} must now be between ${field.min} and ${field.max}` : null;
    }
    case 'flag':
    case 'free':
      return null;
  }
}

/**
 * Match a stale submission against the FRESH affordances: the first entry of
 * the same type it still fits entirely, or else the closest one and what no
 * longer fits. The engine is still the judge on resubmit — this only decides
 * what to put back in the form and what to tell the player.
 */
export function reconcile(entries: Affordance[], body: RawBody): Reconciled {
  const type = asList(body._type)[0] ?? '';
  const candidates = entries.map((e, i) => ({ e, i })).filter(({ e }) => e.type === type);
  if (candidates.length === 0) return { index: null, problems: [`${typeLabel(type)} is no longer available to you.`] };
  let best: { i: number; problems: string[] } | null = null;
  for (const { e, i } of candidates) {
    const problems = e.fields.map((f) => fieldProblem(f, body)).filter((p): p is string => p !== null);
    if (problems.length === 0) return { index: i, problems };
    if (!best || problems.length < best.problems.length) best = { i, problems };
  }
  return { index: best!.i, problems: best!.problems };
}
