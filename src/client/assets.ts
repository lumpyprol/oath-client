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
img.face { width: 5rem; min-width: 5rem; height: auto; min-height: 0; padding: 0; border-color: #0003; display: block; }

/* ---- the board: the map as the base, sites placed on it at true scale (unit 16) ----
   Every asset shares one scale with the board. A site card is sized to fully
   cover its printed slot (12.3% x 23.6% of the board — a hair larger than the
   card's raw fraction so no yellow outline peeks out) while holding the card
   aspect. Denizens sit beside the site at the SAME height, width from their
   own aspect, so the site↔denizen scale is exactly 1:1 — nothing is resized
   relative to anything else. */
body.board { max-width: 96rem; }
.board-map { position: relative; margin: 0 0 var(--gap); }
.board-base { width: 100%; display: block; border-radius: 8px; }
.board-overlay { position: absolute; inset: 0; }
.bsite { position: absolute; width: 12.3%; height: 23.6%; }
.bsite-card { position: absolute; inset: 0; }
.board-map .face { min-width: 0; min-height: 0; border: none; padding: 0; }
.board-map .bsite-card .face,
.board-map .bsite-card img.face {
  width: 100%; height: 100%; object-fit: fill; border-radius: 4px;
  box-shadow: 0 1px 4px #0008; font-size: 0.7rem;
  display: flex; align-items: center; justify-content: center; text-align: center;
}
.bsite-name {
  position: absolute; left: 4%; bottom: 5%; max-width: 92%;
  padding: 0 3px; border-radius: 3px; background: #000a; color: #fff;
  font-size: 0.7rem; line-height: 1.25; pointer-events: none;
}
.bsite-tokens { position: absolute; right: 3px; top: 3px; font-size: 0.65rem; background: #000a; color: #fff; border-radius: 3px; padding: 0 3px; }
/* Denizens sit beside the site at the SAME height, so they render at the
   identical scale — height 100% of the slot, width from their own aspect. */
.bsite-cards { position: absolute; left: 100%; top: 0; height: 100%; display: flex; align-items: flex-start; gap: 1.5%; padding-left: 2%; }
.bsite-cards .bcard { position: relative; display: inline-flex; height: 100%; }
.board-map .bsite-cards .face,
.board-map .bsite-cards img.face {
  height: 100%; width: auto; object-fit: fill; border-radius: 3px;
  box-shadow: 0 1px 3px #0008; font-size: 0.55rem; overflow: hidden;
  display: flex; align-items: center; justify-content: center; text-align: center;
}
.board-map .bsite-cards .face.back { width: 64%; aspect-ratio: 325 / 508; }
.bsite-cards .bcard .ruined { position: absolute; top: 0; right: 0; font-size: 0.55rem; background: #b00; color: #fff; border-radius: 2px; padding: 0 1px; }
.bsite-warbands { position: absolute; left: 3px; top: 3px; display: flex; gap: 2px; }
.bsite-warbands .wb { font-size: 0.6rem; background: #222c; color: #fff; border-radius: 3px; padding: 0 3px; }
/* A facedown site reads as a solid card back that fully covers its slot. */
.board-map .bsite-card .face.back {
  aspect-ratio: auto;
  background-color: #2e2720;
  background-image: repeating-linear-gradient(45deg, #0003, #0003 6px, transparent 6px, transparent 12px);
}
.board-map .bsite-card img.site-back { width: 100%; height: 100%; object-fit: fill; border-radius: 4px; box-shadow: 0 1px 4px #0008; }
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

/* Hover-to-enlarge preview (progressive enhancement; JS builds #card-zoom). */
#card-zoom { position: fixed; display: none; z-index: 1000; pointer-events: none; }
#card-zoom img { display: block; max-width: 38vw; max-height: 80vh; border-radius: 10px; box-shadow: 0 8px 40px #000c; background: #000; }
@media (max-width: 640px) { #card-zoom img { max-width: 80vw; } }
`.trim();

export const APP_JS = `
// Progressive enhancement (P4 unit 9). The pages work with no JS at all —
// forms POST and the server redirects. Later units add refetch-on-focus and
// inline conflict recovery here.
"use strict";
document.documentElement.classList.add("js");

// Hover-to-enlarge (unit 16): a floating full-size copy of whatever card the
// pointer is over, so the small board cards are readable. Card art only —
// backs and text placeholders are skipped. It shows what is already on the
// page at a bigger size; it never fetches anything the page did not render.
(function () {
  var box = document.createElement("div");
  box.id = "card-zoom";
  box.setAttribute("aria-hidden", "true");
  var big = document.createElement("img");
  box.appendChild(big);
  document.body.appendChild(box);

  function zoomable(t) {
    return (
      t && t.tagName === "IMG" &&
      (t.classList.contains("face") || t.classList.contains("site-back")) &&
      !t.classList.contains("back") &&
      t.getAttribute("src")
    );
  }
  function place(x, y) {
    var pad = 18, w = box.offsetWidth, h = box.offsetHeight;
    var vw = window.innerWidth, vh = window.innerHeight;
    var left = x + pad; if (left + w > vw) left = x - w - pad; if (left < 0) left = pad;
    var top = y + pad; if (top + h > vh) top = vh - h - pad; if (top < 0) top = pad;
    box.style.left = left + "px"; box.style.top = top + "px";
  }
  document.addEventListener("pointerover", function (e) {
    if (!zoomable(e.target)) return;
    big.src = e.target.getAttribute("src");
    box.style.display = "block";
    place(e.clientX, e.clientY);
  });
  document.addEventListener("pointermove", function (e) {
    if (box.style.display === "block") place(e.clientX, e.clientY);
  });
  document.addEventListener("pointerout", function (e) {
    if (zoomable(e.target)) box.style.display = "none";
  });
})();
`.trim();
