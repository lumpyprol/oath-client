/**
 * Unit 9: the escaping primitive. A friend group WILL name themselves
 * `<script>alert(1)</script>` on purpose within a week — it must land on a
 * page harmlessly.
 */

import { describe, it, expect } from 'vitest';
import { html, raw, escapeHtml } from '../../src/client/html.js';

describe('html`` — escapes every interpolation by default', () => {
  it('neutralises a script-tag player name', () => {
    const name = '<script>alert(1)</script>';
    const out = html`<span>${name}</span>`.value;
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes quotes so an interpolation cannot break out of an attribute', () => {
    const out = html`<a title="${'a" onmouseover="x'}">z</a>`.value;
    expect(out).toContain('&quot;');
    expect(out).not.toContain('onmouseover="x"');
  });

  it('inserts raw() verbatim, and nested html`` composes without double-escaping', () => {
    expect(html`${raw('<b>ok</b>')}`.value).toBe('<b>ok</b>');
    const nested = html`<p>${html`<i>${'<x>'}</i>`}</p>`.value;
    expect(nested).toBe('<p><i>&lt;x&gt;</i></p>');
  });

  it('renders an array of fragments, and drops null/undefined/false', () => {
    const out = html`<ul>${[html`<li>a</li>`, html`<li>b</li>`]}</ul>`.value;
    expect(out).toBe('<ul><li>a</li><li>b</li></ul>');
    expect(html`${null}${undefined}${false}x`.value).toBe('x');
  });

  it('escapeHtml handles all five entities', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
});
