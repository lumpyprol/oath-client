/**
 * The client's stylesheet and progressive-enhancement script, as strings
 * served by `web.ts` (P4 unit 9). Kept as TS so `tsc` ships them to `dist/`
 * with no bundler and no build-copy step (D57: no toolchain in the runtime
 * image). Phone-first: designed at ~380px, allowed to look plain at 1024px.
 */

export const APP_CSS = `
:root { color-scheme: light dark; --gap: 0.75rem; --muted: #666; }
* { box-sizing: border-box; }
body {
  margin: 0; padding: var(--gap);
  font: 16px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  max-width: 44rem; margin-inline: auto;
}
.skip-link {
  position: absolute; left: -999px;
}
.skip-link:focus { left: var(--gap); top: var(--gap); background: Canvas; padding: 0.25rem 0.5rem; }
.app-header {
  display: flex; justify-content: space-between; align-items: baseline;
  border-bottom: 1px solid currentColor; padding-bottom: 0.25rem; margin-bottom: var(--gap);
}
.app-title { font-weight: 700; }
.seat { color: var(--muted); }
h1 { font-size: 1.25rem; }
h2 { font-size: 1rem; color: var(--muted); margin-top: 1.5rem; }
ul.inbox { list-style: none; padding: 0; margin: 0; }
ul.inbox li {
  display: flex; justify-content: space-between; gap: var(--gap);
  padding: var(--gap) 0; border-bottom: 1px solid #8884;
}
ul.inbox a { font-weight: 600; text-decoration: none; }
.age { color: var(--muted); white-space: nowrap; }
.empty { color: var(--muted); }
.others ul { color: var(--muted); }
.page-nav { display: flex; gap: 1rem; margin-top: 1.5rem; }
`.trim();

export const APP_JS = `
// Progressive enhancement (P4 unit 9). The pages work with no JS at all —
// forms POST and the server redirects. Later units add refetch-on-focus and
// inline conflict recovery here; for now this is intentionally minimal.
"use strict";
document.documentElement.classList.add("js");
`.trim();
