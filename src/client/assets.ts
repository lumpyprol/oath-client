/**
 * The client's stylesheet and progressive-enhancement script, as strings
 * served by `web.ts` (P4 unit 9). Kept as TS so `tsc` ships them to `dist/`
 * with no bundler and no build-copy step (D57: no toolchain in the runtime
 * image). Desktop only (D66): laid out for desktop and laptop browsers,
 * minimum ~1280px wide; narrow and touch screens are not a v1 target.
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

/* ---- the board (unit 10) — desktop layout (D66) ---- */
.status { color: var(--muted); margin: 0 0 var(--gap); }
.status.done { color: inherit; font-weight: 700; }
.spectator-note { font-style: italic; color: var(--muted); }
.site-grid, .player-grid {
  display: grid; gap: var(--gap);
  grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
}
/* One player board (and its advisers) per full-width row. */
.player-grid { display: flex; flex-direction: column; grid-template-columns: none; }
.site {
  border: 1px solid #8886; border-radius: 6px; padding: 0.5rem;
}
.site h3 { font-size: 0.95rem; margin: 0 0 0.5rem; }
.pmeta { display: block; font-weight: 400; color: var(--muted); font-size: 0.8rem; }
.slots, .advisers { list-style: none; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 0.4rem; }

/* ---- player boards (unit 16 batch 1) ---- */
.pboard { border: 2px solid #8884; border-radius: 8px; padding: 0.4rem; }
.pboard.you { border-color: #8f8; }
.pboard.active { box-shadow: 0 0 0 2px #ffd54a, 0 0 16px #ffd54a88; border-color: #ffd54a; }
.pb-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.25rem 0.6rem; margin-bottom: 0.35rem; }
.pb-head .pname { font-weight: 700; }
.on-clock { color: #d9a400; font-weight: 600; }
.pb-stats { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-left: auto; font-size: 0.85rem; }
.tok { display: inline-flex; align-items: center; gap: 0.2rem; font-variant-numeric: tabular-nums; }
.tok-img { height: 1.1em; width: auto; vertical-align: middle; }
.tok .flip { color: var(--muted); }
/* Board on the left; advisers tuck to its right at the exact height of the
   board's ADVISERS bar (~17%–80% of the board), not the full board height. */
.pb-main { display: flex; align-items: flex-start; }
.pb-frame { position: relative; flex: 0 1 42rem; min-width: 0; }
.pb-bg { width: 100%; height: auto; display: block; border-radius: 6px; }
.pb-supply-marker { position: absolute; top: 90%; transform: translate(-50%, -50%); height: 9%; width: auto; filter: drop-shadow(0 1px 2px #000a); pointer-events: none; }
.pb-vision { position: absolute; left: 4%; top: 29%; width: 24%; }
.pb-vision .face, .pb-vision img.face { width: 100%; height: auto; min-width: 0; min-height: 0; border-radius: 4px; box-shadow: 0 1px 6px #0008; }
.pb-side-advisers {
  position: absolute; left: 100%; top: 17%; height: 63%; margin-left: 0.4rem;
  display: flex; flex-direction: row; gap: 0.3rem; list-style: none; padding: 0;
  max-width: 55vw; overflow-x: auto;
}
.pb-side-advisers:empty { display: none; }
.pb-side-advisers .adviser { flex: 0 0 auto; height: 100%; display: flex; }
.pb-side-advisers img.face, .pb-side-advisers .card-back { height: 100%; width: auto; min-width: 0; min-height: 0; border-radius: 4px; }
.card-back { display: block; border-radius: 4px; box-shadow: 0 1px 3px #0007; }

/* The Imperial Reliquary sits under the Chancellor's board, same width. */
.reliquary-board { position: relative; width: 100%; max-width: 42rem; margin-top: 0.5rem; }
.rq-bg { width: 100%; display: block; border-radius: 6px; }
.rq-slot { position: absolute; transform: translate(-50%, -50%); width: 45%; aspect-ratio: 1 / 1; }
.rq-slot img, .rq-slot .face {
  width: 100%; height: 100%; min-width: 0; min-height: 0; object-fit: fill;
  border: none; border-radius: 4px; box-shadow: 0 1px 5px #000a;
}
.rq-slot.open { border: 0.2rem dashed #ffd54a88; border-radius: 8px; }

/* Banner placards, the Oathkeeper title and the Grand Scepter — drawn at
   their TRUE size against the player board (widths are set inline, as the
   art's own pixels over the board's 1011px width), so a banner under a board
   is as big as it would be on the table. */
.pb-placards, .tf-row {
  display: flex; flex-wrap: wrap; gap: 0.6rem 1rem; align-items: flex-start;
  width: 100%; max-width: 42rem; margin-top: 0.5rem;
}
.placard { margin: 0; }
.tf-art { position: relative; }
.tf-art img, .tf-art .face {
  width: 100%; height: auto; min-width: 0; min-height: 0;
  border: none; border-radius: 4px; box-shadow: 0 1px 5px #0009; display: block;
}
.tf-count {
  position: absolute; right: -0.4rem; bottom: -0.4rem;
  min-width: 1.5rem; height: 1.5rem; padding: 0 0.3rem; border-radius: 0.75rem;
  display: flex; align-items: center; justify-content: center;
  background: #000d; border: 1px solid #e8b53a; color: #ffd98a;
  font-size: 0.85rem; font-weight: 800;
}
.reference-aids .goal-ref { margin-bottom: 0.6rem; }
.ref-sheet { margin: 0.4rem 0; max-width: 42rem; }
.ref-sheet summary { cursor: pointer; color: var(--muted); }
.ref-sheet img { width: 100%; height: auto; display: block; margin-top: 0.4rem; border-radius: 6px; }
.placard figcaption { font-size: 0.8rem; margin-top: 0.3rem; line-height: 1.3; color: var(--muted); }
.held-relics { display: flex; flex-wrap: wrap; gap: 0.3rem; margin-top: 0.4rem; }
.held-relics img.face { width: 3rem; height: auto; min-width: 0; min-height: 0; border-radius: 4px; }
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
.board-map { position: relative; margin: 0 0 var(--gap); container-type: inline-size; }
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
.bcard-tok { position: absolute; left: 1px; bottom: 1px; font-size: 0.55rem; background: #000b; color: #fff; border-radius: 3px; padding: 0 2px; }
/* Pawns and warbands stand ON the site, in the illustration above the title bar. */
.bsite-pieces { position: absolute; left: 5%; right: 5%; bottom: 25%; display: flex; flex-wrap: wrap; align-items: flex-end; gap: 0.4cqw; z-index: 2; }
.pawn-tok { height: 3.2cqw; width: auto; filter: drop-shadow(0 1px 2px #000c); }
.wb-at { display: inline-flex; align-items: center; gap: 0.1cqw; }
.wb-at .wb-tok { height: 2.3cqw; width: auto; filter: drop-shadow(0 1px 2px #000c); }
.wb-at .wb-n { font-size: 1.5cqw; font-weight: 700; color: #fff; text-shadow: 0 0 2px #000, 0 0 2px #000; }
/* Map furniture (unit 16 batch 4): favor on the banks, the round wheel, visions drawn. */
/* The favor count sits centred inside the bank's printed coin circle. */
.bank-fav {
  position: absolute; transform: translate(-50%, -50%);
  width: 2.5cqw; height: 2.5cqw; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: #000d; border: 0.18cqw solid #e8b53a; color: #ffd98a;
  font-size: 1.5cqw; font-weight: 800; line-height: 1;
  box-shadow: 0 0 0.5cqw #000a; pointer-events: none;
}
/* The round marker is the wooden turn token, sitting in its wheel slice. */
.round-marker { position: absolute; transform: translate(-50%, -50%); height: 2.2cqw; width: auto; filter: drop-shadow(0 0.12cqw 0.25cqw #000b); }
.vision-marker { position: absolute; transform: translate(-50%, -50%); height: 2.2cqw; width: auto; filter: drop-shadow(0 0.1cqw 0.2cqw #000b); }
/* Facedown piles on the map: the deck spaces and the regional discards.
   Sizes are the card's true fraction of the board (board aspect 5610:2260,
   so 1% of board height = 0.403cqw). The decks stand upright, scaled to
   their printed box; the discards lie on their side, because that is the
   shape the board prints beside each region name. */
.map-pile { position: absolute; transform: translate(-50%, -50%); }
.map-pile img { height: 6.77cqw; width: auto; display: block; border-radius: 0.3cqw; box-shadow: 0 0.15cqw 0.35cqw #000b; }
.map-pile.discard { width: 9.06cqw; height: 5.81cqw; }
.map-pile.discard img {
  position: absolute; left: 50%; top: 50%;
  height: 9.06cqw; /* becomes the WIDTH once rotated */
  transform: translate(-50%, -50%) rotate(90deg);
}
.pile-n {
  position: absolute; right: -0.7cqw; bottom: -0.5cqw;
  min-width: 2.1cqw; height: 2.1cqw; padding: 0 0.3cqw; border-radius: 1.05cqw;
  display: flex; align-items: center; justify-content: center;
  background: #000d; border: 0.14cqw solid #e8b53a; color: #ffd98a;
  font-size: 1.3cqw; font-weight: 800; line-height: 1;
}
/* A facedown site reads as a solid card back that fully covers its slot. */
.board-map .bsite-card .face.back {
  aspect-ratio: auto;
  background-color: #2e2720;
  background-image: repeating-linear-gradient(45deg, #0003, #0003 6px, transparent 6px, transparent 12px);
}
.board-map .bsite-card img.site-back { width: 100%; height: 100%; object-fit: fill; border-radius: 4px; box-shadow: 0 1px 4px #0008; }
.tokens { font-size: 0.75rem; color: var(--muted); white-space: nowrap; }
.tokens .favor, .tokens .secrets { display: inline-flex; align-items: center; gap: 0.1em; }
.tokens .favor { margin-right: 0.3rem; }
.ruined { font-size: 0.7rem; color: #b00; }
.relics, .warbands, .held-relics { font-size: 0.8rem; margin-top: 0.4rem; display: flex; flex-wrap: wrap; gap: 0.3rem; align-items: center; }
.banks { list-style: none; padding: 0; margin: 0; font-size: 0.85rem; }
.banks li { padding: 0.15rem 0; }
.campaign, .pending { border: 1px solid #b008; border-radius: 6px; padding: 0.5rem; margin: var(--gap) 0; }
.campaign .phase { color: var(--muted); }
.dice-rows { display: flex; flex-direction: column; gap: 0.4rem; margin: 0.5rem 0; }
.dice-row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
.dice-label { min-width: 4.5rem; color: var(--muted); font-size: 0.85rem; }
.dice { display: flex; flex-wrap: wrap; gap: 0.25rem; }
.die { width: 2rem; height: 2rem; border-radius: 4px; display: block; box-shadow: 0 1px 3px #0007; }
.die.blank { background: #1f7fd0; border: 1px solid #0006; }
.dice-total { font-size: 0.85rem; font-weight: 700; }
.casualties { color: #d9a400; }
.muted { color: var(--muted); }

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
