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

/* ---- the board (unit 10) — phone-first, plain until unit 16's visual pass ---- */
.status { color: var(--muted); margin: 0 0 var(--gap); }
.status.done { color: inherit; font-weight: 700; }
.spectator-note { font-style: italic; color: var(--muted); }
.site-grid, .player-grid {
  display: grid; gap: var(--gap);
  grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
}
.site, .player {
  border: 1px solid #8886; border-radius: 6px; padding: 0.5rem;
}
.player.you { border-color: currentColor; }
.site h3, .player h3 { font-size: 0.95rem; margin: 0 0 0.5rem; }
.pmeta { display: block; font-weight: 400; color: var(--muted); font-size: 0.8rem; }
.slots, .advisers { list-style: none; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 0.4rem; }
.slot.empty { display: none; }
.face {
  display: inline-flex; align-items: center; justify-content: center; text-align: center;
  min-width: 4.5rem; min-height: 3rem; padding: 0.2rem 0.35rem;
  border: 1px solid #8888; border-radius: 4px; font-size: 0.75rem;
}
.face.placeholder { background: #8881; }
.face.back { background: repeating-linear-gradient(45deg, #8883, #8883 4px, transparent 4px, transparent 8px); }
img.face { object-fit: cover; }
.tokens { font-size: 0.75rem; color: var(--muted); white-space: nowrap; }
.tokens .favor { margin-right: 0.3rem; }
.ruined { font-size: 0.7rem; color: #b00; }
.relics, .warbands, .vision, .held-relics { font-size: 0.8rem; margin-top: 0.4rem; display: flex; flex-wrap: wrap; gap: 0.3rem; align-items: center; }
.stats { display: grid; grid-template-columns: 1fr 1fr; gap: 0.2rem 0.75rem; margin: 0 0 0.5rem; font-size: 0.85rem; }
.stats div { display: flex; justify-content: space-between; gap: 0.5rem; }
.stats dt { color: var(--muted); margin: 0; }
.stats dd { margin: 0; font-variant-numeric: tabular-nums; }
.banks, .banners, .reliquary { list-style: none; padding: 0; margin: 0; font-size: 0.85rem; }
.banks li, .banners li, .reliquary li { padding: 0.15rem 0; }
.campaign, .pending { border: 1px solid #b008; border-radius: 6px; padding: 0.5rem; margin: var(--gap) 0; }
`.trim();

export const APP_JS = `
// Progressive enhancement (P4 unit 9). The pages work with no JS at all —
// forms POST and the server redirects. Later units add refetch-on-focus and
// inline conflict recovery here; for now this is intentionally minimal.
"use strict";
document.documentElement.classList.add("js");
`.trim();
