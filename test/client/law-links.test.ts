/**
 * Every reference to the Law on a page links to that section (Ben,
 * 2026-10-02), done once over the finished page by linkLaw.
 */

import { describe, it, expect } from 'vitest';
import { linkLaw } from '../../src/client/law-links.js';
import { layout } from '../../src/client/layout.js';
import { html } from '../../src/client/html.js';

const URL = 'https://rules.buriedgiant.com/?product=oath&amp;locale=en-US&amp;printing=p1';

describe('linkLaw', () => {
  it('links "Law §x.y" and a bare "§x.y" in text, to that section', () => {
    expect(linkLaw('<p>Kill half (Law §5.5.6) or see §11.4.</p>')).toBe(
      `<p>Kill half (<a class="law-ref" href="${URL}#5.5.6" target="_blank" rel="noopener">Law §5.5.6</a>) or see <a class="law-ref" href="${URL}#11.4" target="_blank" rel="noopener">§11.4</a>.</p>`,
    );
  });

  it('a chapter links to its chapter anchor ("5.")', () => {
    expect(linkLaw('<h3>Major actions (Law §5)</h3>')).toContain(`href="${URL}#5."`);
  });

  it('leaves attributes, existing links, options, textareas and the title alone', () => {
    const untouched = [
      '<span title="see Law §5.4">x</span>',
      '<a href="#">Law §5.6</a>',
      '<select><option>Mountain (Law §11.4)</option></select>',
      '<textarea>§1.2</textarea>',
      '<title>Law §3</title>',
    ];
    for (const h of untouched) expect(linkLaw(h)).toBe(h);
  });

  it('every page gets it through the layout', () => {
    const page = layout({ title: 't', body: html`<p class="note">Costs 2 Supply (Law §5.5.1).</p>` });
    expect(page).toContain('<a class="law-ref" href="');
    expect(page).toContain('#5.5.1"');
  });
});
