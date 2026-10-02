/**
 * Test helpers for the composer (unit 11): a tiny parser for the forms THIS
 * app renders (no HTML dependency — the markup is our own and regular), and
 * the body a browser would submit for one. Shared by forms.test.ts (the
 * conformance test) and compose-http.test.ts (forms driven over HTTP with no
 * script at all).
 */

import type { RawBody } from '../../src/client/composer.js';

const unescape = (s: string): string =>
  s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([a-zA-Z_:][\w:-]*)(?:="([^"]*)")?/g)) out[m[1]] = m[2] === undefined ? '' : unescape(m[2]);
  return out;
}

export interface Control {
  tag: 'input' | 'select' | 'textarea';
  attrs: Record<string, string>;
  /** A select's <option>s; a textarea's text. */
  options?: Record<string, string>[];
  text?: string;
}

export interface ParsedForm {
  attrs: Record<string, string>;
  controls: Control[];
}

export function parseForms(doc: string): ParsedForm[] {
  const forms: ParsedForm[] = [];
  for (const f of doc.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)) {
    const controls: Control[] = [];
    const body = f[2];
    for (const m of body.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>|<textarea\b([^>]*)>([\s\S]*?)<\/textarea>|<input\b([^>]*)>/g)) {
      if (m[1] !== undefined) {
        controls.push({ tag: 'select', attrs: attrs(m[1]), options: [...m[2].matchAll(/<option\b([^>]*)>/g)].map((o) => attrs(o[1])) });
      } else if (m[3] !== undefined) {
        controls.push({ tag: 'textarea', attrs: attrs(m[3]), text: unescape(m[4]) });
      } else {
        controls.push({ tag: 'input', attrs: attrs(m[5]) });
      }
    }
    forms.push({ attrs: attrs(f[1]), controls });
  }
  return forms;
}

/** The values a form's controls offer for one field name (radio/checkbox values, select options). */
export function offeredValues(form: ParsedForm, name: string): string[] {
  const out: string[] = [];
  for (const c of form.controls) {
    if (c.attrs.name !== name) continue;
    if (c.tag === 'select') out.push(...c.options!.map((o) => o.value).filter((v) => v !== ''));
    // radios and checkboxes; and a hidden input carrying a one-answer choice as a fixed value
    else if (c.tag === 'input' && (c.attrs.type === 'radio' || c.attrs.type === 'checkbox' || c.attrs.type === 'hidden')) out.push(c.attrs.value);
  }
  return out;
}


export const metaValue = (form: ParsedForm, name: string): string | undefined =>
  form.controls.find((c) => c.attrs.name === name && c.attrs.type === 'hidden')?.attrs.value;

/**
 * The urlencoded body a browser submits for this form with its BASELINE
 * choice: the first enabled radio / select option, every checkbox left
 * unchecked, every number at its rendered value, every textarea as rendered.
 * Shaped as Express's `urlencoded({ extended: false })` parses it.
 *
 * With `firstOfEach`, the first enabled box of each choose-many group is
 * ticked instead — the smallest LEGAL submission where a choose-many needs at
 * least one pick (an empty Peek is refused), which the harness's [] baseline
 * is not meant to be on its own.
 */
export function baselineSubmission(form: ParsedForm, firstOfEach = false): RawBody {
  const pairs: [string, string][] = [];
  // Allocate boxes (`name:{value}`, carrying data-min): fill greedily, in
  // order and each up to its own max, to the field's least legal total.
  const allocLeft = new Map<string, number>();
  const radiosDone = new Set<string>();
  const boxesDone = new Set<string>();
  const kinds = JSON.parse(metaValue(form, '_kinds') ?? '{}') as Record<string, string>;
  for (const c of form.controls) {
    const { name, type, value, disabled } = c.attrs;
    if (name === undefined || disabled !== undefined) continue;
    if (c.tag === 'select') {
      const o = c.options!.find((x) => x.value !== '' && x.disabled === undefined);
      if (o) pairs.push([name, o.value]);
    } else if (c.tag === 'textarea') {
      pairs.push([name, c.text ?? '']);
    } else if (type === 'radio') {
      // The first radio legal on its own: skip a dependent one (data-dep,
      // from an option's `requires`) unless the group has nothing else.
      if (!radiosDone.has(name)) {
        const group = form.controls.filter((x) => x.attrs.name === name && x.attrs.type === 'radio' && x.attrs.disabled === undefined);
        const pick = group.find((x) => x.attrs['data-dep'] === undefined) ?? group[0];
        radiosDone.add(name);
        pairs.push([name, pick.attrs.value]);
      }
    } else if (type === 'number' && c.attrs['data-min'] !== undefined) {
      const field = name.slice(0, name.indexOf(':'));
      if (!allocLeft.has(field)) allocLeft.set(field, Number(c.attrs['data-min']));
      const n = Math.min(allocLeft.get(field)!, Number(c.attrs.max));
      allocLeft.set(field, allocLeft.get(field)! - n);
      pairs.push([name, String(n)]);
    } else if (type === 'checkbox') {
      const tick = c.attrs.checked !== undefined || (firstOfEach && kinds[name] === 'choose-many' && !boxesDone.has(name));
      if (tick) {
        boxesDone.add(name);
        pairs.push([name, value]);
      }
    } else {
      pairs.push([name, value ?? '']);
    }
  }
  const body: RawBody = {};
  for (const [k, val] of pairs) {
    const prev = body[k];
    body[k] = prev === undefined ? val : Array.isArray(prev) ? [...prev, val] : [prev, val];
  }
  return body;
}


/** A RawBody as the urlencoded string a browser POSTs. */
export function encodeBody(body: RawBody): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) for (const x of v === undefined ? [] : Array.isArray(v) ? v : [v]) p.append(k, x);
  return p.toString();
}
