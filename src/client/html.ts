/**
 * The one HTML templating primitive (P4 unit 9). A tagged template that
 * ESCAPES every interpolation by default, so a value can never become
 * markup by accident — a player named `<script>alert(1)</script>` is a real
 * thing a friend group does on purpose within a week. Composed fragments
 * (another `html` result, or an explicit `raw()`) are inserted verbatim.
 *
 * No dependency; ~30 lines. This is the D57 "server-rendered HTML, no
 * framework" spine.
 */

/** A pre-escaped/trusted fragment, inserted without further escaping. */
export class Raw {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

/** Mark a string as already-safe HTML. Use only on strings you built, never on input. */
export function raw(value: string): Raw {
  return new Raw(value);
}

const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ENTITIES[c]);
}

/** Render one interpolated value: Raw verbatim, arrays concatenated, everything else escaped. */
function render(value: unknown): string {
  if (value instanceof Raw) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  if (value === null || value === undefined || value === false) return '';
  return escapeHtml(typeof value === 'string' ? value : String(value));
}

/**
 * Tagged template producing a `Raw`. Interpolations are escaped unless they
 * are themselves `Raw` (or arrays of `Raw`/strings), so nesting `html`…`
 * inside `html`… composes safely.
 */
export function html(strings: TemplateStringsArray, ...values: unknown[]): Raw {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return new Raw(out);
}
