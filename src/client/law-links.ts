/**
 * Every reference to the Law on a page links to that section of it (Ben,
 * 2026-10-02): "Law §5.5.5", "(§11.4)", "Glossary §10.5" — wherever the text
 * came from (a template, an affordance note, an engine refusal). Done once,
 * over the finished page, rather than in every string that might cite one.
 *
 * Only TEXT is touched. Tags and their attributes (a `title` tooltip) pass
 * through unchanged, and text where a link cannot go or is already there is
 * left alone: inside <a>, <option>, <textarea>, <title>, <script>, <style>.
 */

import { ruleUrl } from './action-rules.js';

const SKIP = new Set(['a', 'option', 'textarea', 'title', 'script', 'style']);
const REF = /(?:Law\s+)?§(\d+(?:\.\d+)*)/g;

/** The rules library's anchor for a section: "5.4.1" as is, a chapter "5" as "5.". */
const anchor = (section: string): string => (section.includes('.') ? section : `${section}.`);

export function linkLaw(html: string): string {
  const skipping: string[] = [];
  return html
    .split(/(<[^>]*>)/)
    .map((part) => {
      if (part.startsWith('<')) {
        const m = /^<(\/?)([a-zA-Z][\w-]*)/.exec(part);
        if (m) {
          const tag = m[2].toLowerCase();
          if (SKIP.has(tag)) {
            if (m[1]) skipping.splice(skipping.lastIndexOf(tag), 1);
            else if (!part.endsWith('/>')) skipping.push(tag);
          }
        }
        return part;
      }
      if (skipping.length > 0 || !part.includes('§')) return part;
      return part.replace(
        REF,
        (ref: string, section: string) =>
          `<a class="law-ref" href="${ruleUrl(anchor(section)).replace(/&/g, '&amp;')}" target="_blank" rel="noopener">${ref}</a>`,
      );
    })
    .join('');
}
