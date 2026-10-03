import { createHash } from 'node:crypto';

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
.status .waiting { color: #d9a400; } /* an off-turn reaction the game is waiting on */
.status .waiting.you { font-weight: 700; }
.end-die { margin: -0.4rem 0 var(--gap); font-size: 0.9rem; } /* the Stable Regime end die (Law §3.3) */
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
.pboard {
  border: 2px solid #8884; border-radius: 8px; padding: 0.4rem;
  /* The box holds the board AND a full row of advisers (the limit is 3,
     Law §2.2.2), so the advisers never spill past its edge. An adviser is
     63% of the board's height (the ADVISERS bar) at the card's 326:508, i.e.
     0.3195 board-widths; three plus 1rem of gaps make 1.9586 board-widths.
     So the board's width comes FROM the box: --pb-w. */
  container-type: inline-size; max-width: 84rem;
  --pb-w: calc((100cqw - 1.2rem) / 1.9586);
}
.pboard.you { border-color: #8f8; }
.pboard.active { box-shadow: 0 0 0 2px #ffd54a, 0 0 16px #ffd54a88; border-color: #ffd54a; }
.pb-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.25rem 0.6rem; margin-bottom: 0.35rem; }
.pb-head .pname { font-weight: 700; }
.on-clock { color: #d9a400; font-weight: 600; }
.pb-stats { display: flex; flex-wrap: wrap; gap: 0.5rem; font-size: 0.85rem; } /* follows the name and role, left-aligned */
.tok { display: inline-flex; align-items: center; gap: 0.2rem; font-variant-numeric: tabular-nums; }
.tok-img { height: 1.1em; width: auto; vertical-align: middle; }
.tok .flip { color: var(--muted); }
/* Board on the left; advisers tuck to its right at the exact height of the
   board's ADVISERS bar (~17%–80% of the board), not the full board height. */
.pb-main { display: flex; align-items: flex-start; }
.pb-frame { position: relative; flex: 0 0 var(--pb-w); min-width: 0; }
.pb-bg { width: 100%; height: auto; display: block; border-radius: 6px; }
.pb-supply-marker { position: absolute; transform: translate(-50%, -50%); height: 11%; width: auto; filter: drop-shadow(0 1px 2px #000a); pointer-events: none; }
.card-back.peek { cursor: zoom-in; outline: 2px dashed #d9a400aa; outline-offset: -2px; }
.pb-vision { position: absolute; left: 2.95%; top: 28.8%; width: 48.4%; } /* the board's Revealed Vision box, fitted to the card's height */
.pb-vision .face, .pb-vision img.face { width: 100%; height: auto; min-width: 0; min-height: 0; border-radius: 4px; box-shadow: 0 1px 6px #0008; }
.pb-side-advisers {
  position: absolute; left: 100%; top: 17%; height: 63%; margin-left: 0.4rem;
  display: flex; flex-direction: row; flex-wrap: nowrap; gap: 0.3rem; list-style: none; padding: 0;
  /* Absolutely placed at left:100%, it has no width of its own to lay out in;
     without these, the base .advisers wrap rule stacks each card on its own
     line. One row, as wide as its cards, each the height of the ADVISERS bar. */
  width: max-content;
}
.pb-side-advisers:empty { display: none; }
.pb-side-advisers .adviser { flex: 0 0 auto; height: 100%; display: flex; }
.pb-side-advisers img.face, .pb-side-advisers .card-back { height: 100%; width: auto; min-width: 0; min-height: 0; border-radius: 4px; }
.card-back { display: block; border-radius: 4px; box-shadow: 0 1px 3px #0007; }

/* The Imperial Reliquary sits under the Chancellor's board, same width. */
.reliquary-board { position: relative; width: var(--pb-w); margin-top: 0.5rem; }
.rq-bg { width: 100%; display: block; border-radius: 6px; }
.rq-slot { position: absolute; transform: translate(-50%, -50%); width: 45%; aspect-ratio: 1 / 1; }
.rq-slot img, .rq-slot .face {
  width: 100%; height: 100%; min-width: 0; min-height: 0; object-fit: fill;
  border: none; border-radius: 4px; box-shadow: 0 1px 5px #000a;
}
.rq-slot.open { border: 0.2rem dashed #ffd54a88; border-radius: 8px; }
/* The four printed modifiers, readable whether covered or not (Law §2.3). */
.rq-powers { width: var(--pb-w); margin: 0.4rem 0 0; padding-left: 1.1rem; font-size: 0.8rem; }
.rq-powers li { margin-bottom: 0.25rem; }
.rq-powers li.covered { color: var(--muted); }

/* Banner placards, the Oathkeeper title and the Grand Scepter — drawn at
   their TRUE size against the player board (widths are set inline, as the
   art's own pixels over the board's 1011px width), so a banner under a board
   is as big as it would be on the table. */
.pb-placards, .tf-row {
  display: flex; flex-wrap: wrap; gap: 0.6rem 1rem; align-items: flex-start;
  width: 100%; max-width: 42rem; margin-top: 0.5rem;
}
.pb-placards { width: var(--pb-w); max-width: none; } /* under a board: the board's own width */
.placard { margin: 0; }
.tf-art { position: relative; }
.tf-art img, .tf-art .face {
  width: 100%; height: auto; min-width: 0; min-height: 0;
  border: none; border-radius: 4px; box-shadow: 0 1px 5px #0009; display: block;
}
/* A banner's stake, drawn as its real token with a count on the art's own
   printed token spot (the coin or book at lower middle-right). */
.banner-stake { position: absolute; left: 51%; top: 69%; height: 26%; display: flex; align-items: center; gap: 0.2rem; pointer-events: none; }
.banner-stake .pb-tok { height: 100%; width: auto; }
.banner-stake .pb-count { font-size: 1.3rem; }
.reference-aids .goal-ref { margin-bottom: 0.6rem; }
.ref-cards { display: flex; gap: 1rem; align-items: flex-start; max-width: 42rem; } /* the Goal Reference and War Exhaustion cards, side by side */
.ref-sheet { margin: 0.4rem 0; max-width: 42rem; }
.ref-sheet summary { cursor: pointer; color: var(--muted); }
.ref-sheet img { width: 100%; height: auto; display: block; margin-top: 0.4rem; border-radius: 6px; }
.placard figcaption { font-size: 0.8rem; margin-top: 0.3rem; line-height: 1.3; color: var(--muted); }
/* Held relics at full table size under the board: a relic card is 326px of
   the board art's 1011px width, as the Grand Scepter placard already is. */
.held-relics { display: flex; flex-wrap: wrap; gap: 0.6rem 1%; margin-top: 0.5rem; width: var(--pb-w); }
.held-relics img.face { width: 32.2%; height: auto; min-width: 0; min-height: 0; border-radius: 6px; box-shadow: 0 1px 4px #0008; }
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
/* A relic card is as wide as a denizen and square (both 326px wide in the
   art), so beside a denizen it stands 326/508 of the height. */
.bsite-cards .bcard.relic { height: 64.17%; }
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
.relics, .warbands { font-size: 0.8rem; margin-top: 0.4rem; display: flex; flex-wrap: wrap; gap: 0.3rem; align-items: center; }
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
.battle-score { margin: 0.25rem 0 0; font-size: 1.05rem; }
.campaign-act { margin-top: 0.5rem; }
.muted { color: var(--muted); }

/* ---- the composer (unit 11): one form per affordance entry ---- */
.compose-section { border: 1px solid #8886; border-radius: 6px; padding: 0.5rem 0.75rem; margin: var(--gap) 0; }
.compose-section h2 { margin: 0.25rem 0; }
.compose-head { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
.compose-head .pb-stats { font-size: 1rem; }
.composer { display: grid; grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr)); gap: 0.5rem; align-items: start; }
.compose { border: 1px solid #8884; border-radius: 6px; padding: 0.35rem 0.6rem; }
.compose[open] { grid-column: 1 / -1; }
/* An action that cannot be taken now: greyed and inert, with the server's reason. */
.compose.unavailable { opacity: 0.5; cursor: not-allowed; }
.u-title { font-weight: 600; }
.compose.unavailable .why { margin: 0.15rem 0 0; font-size: 0.8rem; }
.composer-pinned { margin-bottom: 0.5rem; }
.action-group { margin-top: 0.75rem; }
.action-group h3 { font-size: 0.9rem; margin: 0 0 0.35rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
.compose summary { cursor: pointer; font-weight: 600; }
.compose .note { display: block; font-weight: 400; font-size: 0.8rem; color: var(--muted); }
.compose-form { display: flex; flex-direction: column; gap: 0.5rem; margin-top: 0.5rem; }
.field { border: 0; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 0.25rem 1rem; align-items: baseline; }
.field-name { font-size: 0.8rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; flex-basis: 100%; padding: 0; }
.opt { display: inline-flex; gap: 0.3rem; align-items: baseline; }
.opt.disabled { color: var(--muted); }
.why { font-size: 0.8rem; font-style: italic; }
.field.free { flex-direction: column; align-items: stretch; }
.field.free textarea { font: 0.85rem/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; width: 100%; }
.schema { font-size: 0.8rem; color: var(--muted); }
.compose-buttons { display: flex; gap: 0.5rem; }
.compose-buttons button { font: inherit; padding: 0.3rem 0.9rem; border-radius: 4px; border: 1px solid #8888; cursor: pointer; }
.compose-buttons button:not(.secondary) { font-weight: 700; }
.secondary { background: transparent; }
.banner { border-radius: 6px; padding: 0.5rem 0.75rem; margin: 0.5rem 0; border: 1px solid; }
.banner p { margin: 0; }
.banner ul { margin: 0.25rem 0 0; }
.banner.stale { border-color: #d9a400; background: #d9a40018; }
.banner.illegal, .banner.invalid { border-color: #b00; background: #b0000014; }
.dryrun { border-radius: 6px; padding: 0.5rem 0.75rem; margin: 0.5rem 0; border: 1px dashed; }
.dryrun.accepted { border-color: #2a8a2a; }
.dryrun.refused { border-color: #b00; }
.dryrun-changes { margin: 0.25rem 0; }
.vocab { font-size: 0.85rem; }
.vocab summary { cursor: pointer; color: var(--muted); }
.vocab-list { list-style: none; padding: 0; margin: 0.25rem 0; display: flex; flex-direction: column; gap: 0.3rem; }
.vocab-list code { display: block; font-size: 0.75rem; overflow-wrap: anywhere; }
.vocab-kind { font-weight: 700; }
.vocab-add { display: none; font: inherit; font-size: 0.75rem; padding: 0 0.5rem; }
.js .vocab-add { display: inline-block; } /* "Add" needs the script; without it, copy the example */

/* Options that carry a card face (Travel's sites, a Search's cards), and
   Travel's region columns, laid out like the map. */
.opt-groups { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.75rem; width: 100%; }
.opt-group { display: flex; flex-direction: column; gap: 0.5rem; }
.group-name { font-weight: 700; }
.card-opt { position: relative; flex-direction: column; align-items: flex-start; gap: 0.2rem; padding: 0.3rem; border-radius: 6px; border: 2px solid transparent; cursor: pointer; }
.card-opt:has(input:checked) { border-color: #d9a400; background: #d9a40014; }
.card-opt input { position: absolute; opacity: 0; pointer-events: none; }
.card-opt:focus-within { outline: 2px solid #d9a400; }
.opt-face { width: 11rem; height: auto; border-radius: 6px; display: block; }
.card-opt.disabled .opt-face { filter: grayscale(1) brightness(0.6); }
.allocate { flex-direction: column; align-items: flex-start; }
.opt[hidden] { display: none; }
.field.fixed { margin: 0; }
.field.fixed .field-name { flex-basis: auto; }
.variant[hidden] { display: none; }
.variant-pick { margin-bottom: 0.4rem; }
.variant-name { font-size: 0.9rem; margin: 0.6rem 0 0.2rem; }
.js .variant-name { display: none; } /* with the script only the picked form shows, so no heading is needed */ /* a dependent option the chosen card does not allow (script) */
.req-note { font-size: 0.8rem; color: var(--muted); }
.js .req-note { display: none; } /* with the script, a dependent option only shows when it applies */
.alloc-row { display: flex; align-items: center; gap: 0.5rem; }
.alloc-row input { width: 4rem; }
.alloc-row .opt-face { width: 6rem; }
.rule { font-size: 0.85rem; margin: 0.4rem 0 0; }
.law-ref { color: inherit; text-decoration: underline dotted; text-underline-offset: 2px; } /* a citation in running text, linked to the Law */
.rule a { font-weight: 600; white-space: nowrap; }
.drawn { margin: 0.5rem 0; }
.drawn h3 { font-size: 0.95rem; margin: 0; }
.drawn-cards { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.drawn-cards .face { width: 11rem; height: auto; }

/* Pieces sitting on a player board (favor, secrets, warbands): one token and
   a count each, stacked on the right beside the Advisers bar, above the
   Supply track — clear of the setup icons on the left. */
.pb-pieces { position: absolute; right: 8%; bottom: 17%; display: flex; flex-direction: column; align-items: flex-start; gap: 0.3rem; pointer-events: none; }
.pb-pile { display: flex; align-items: center; gap: 0.3rem; }
.pb-tok { width: 4.4rem; height: 4.4rem; object-fit: contain; filter: drop-shadow(0 1px 2px #000a); }
.pb-tok.flipped { filter: grayscale(1) brightness(0.55) drop-shadow(0 1px 2px #000a); }
.pb-count { font-weight: 700; font-size: 1.8rem; color: #fff; text-shadow: 0 1px 3px #000, 0 0 2px #000; }

/* A Vision, drawn landscape: a box of the card's turned shape, with the
   portrait art rotated a quarter turn to fill it (508x326 rotated = 326x508). */
.land { position: relative; display: inline-block; aspect-ratio: 508 / 326; width: 17rem; vertical-align: top; }
.land img.face, .land img.opt-face { position: absolute; left: 50%; top: 50%; width: 64.17%; height: auto; min-width: 0; transform: translate(-50%, -50%) rotate(-90deg); }
.pb-vision .land { width: 100%; display: block; }

/* Hover-to-enlarge preview (progressive enhancement; JS builds #card-zoom). */
#card-zoom { position: fixed; display: none; z-index: 1000; pointer-events: none; }
#card-zoom img { display: block; max-width: 38vw; max-height: 80vh; border-radius: 10px; box-shadow: 0 8px 40px #000c; background: #000; }
@media (max-width: 640px) { #card-zoom img { max-width: 80vw; } }
`.trim();

export const APP_JS = `
// Progressive enhancement (P4 units 9, 11, 16). The pages work with no JS at
// all — forms POST and the server redirects or re-renders. Plain ES2022, no
// build; delete this file and every page still works.
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

  // What to enlarge for an element: a card face's own src, or — for your own
  // facedown adviser, drawn as a back — the face it names in data-zoom.
  function zoomable(t) {
    if (!t || t.tagName !== "IMG") return null;
    if (t.getAttribute("data-zoom")) return t.getAttribute("data-zoom");
    return (t.classList.contains("face") || t.classList.contains("site-back")) && !t.classList.contains("back") && !t.classList.contains("card-back")
      ? t.getAttribute("src")
      : null;
  }
  function place(x, y) {
    var pad = 18, w = box.offsetWidth, h = box.offsetHeight;
    var vw = window.innerWidth, vh = window.innerHeight;
    var left = x + pad; if (left + w > vw) left = x - w - pad; if (left < 0) left = pad;
    var top = y + pad; if (top + h > vh) top = vh - h - pad; if (top < 0) top = pad;
    box.style.left = left + "px"; box.style.top = top + "px";
  }
  // A Vision is shown landscape (it sits in a .land box): turn the enlarged
  // copy too, and size the box to the turned shape so it is placed right.
  var landscape = false;
  function fit() {
    big.style.cssText = "";
    box.style.width = box.style.height = "";
    if (!landscape) return;
    var w = big.offsetWidth, h = big.offsetHeight;
    box.style.width = h + "px"; box.style.height = w + "px";
    big.style.cssText = "position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) rotate(-90deg)";
  }
  big.addEventListener("load", function () { fit(); });
  document.addEventListener("pointerover", function (e) {
    if (!zoomable(e.target)) return;
    landscape = !!(e.target.getAttribute("data-land") || (e.target.parentElement && e.target.parentElement.classList.contains("land")));
    big.src = zoomable(e.target);
    box.style.display = "block";
    if (big.complete) fit();
    place(e.clientX, e.clientY);
  });
  document.addEventListener("pointermove", function (e) {
    if (box.style.display === "block") place(e.clientX, e.clientY);
  });
  document.addEventListener("pointerout", function (e) {
    if (zoomable(e.target)) box.style.display = "none";
  });
})();

// The composer (unit 11). Every form works without any of this: it POSTs, the
// server 303s on success and re-renders on a conflict, a refusal or a dry run.
// This only (1) submits in place with fetch and swaps in the page the server
// answered with, so the address bar stays on the board; (2) enforces a
// choose-many's max as a courtesy (the server enforces it for real);
// (3) lets "Add" append an effect example to the effects list; and
// (4) refreshes the inbox when the window regains focus (D57's transport).
(function () {
  function swapIn(text, url) {
    var doc = new DOMParser().parseFromString(text, "text/html");
    var next = doc.querySelector("main");
    var main = document.querySelector("main");
    if (!next || !main) return false;
    main.innerHTML = next.innerHTML;
    document.title = doc.title;
    if (url && url !== location.href) history.replaceState(null, "", url);
    return true;
  }

  document.addEventListener("submit", function (e) {
    var form = e.target;
    if (!form.classList || !form.classList.contains("compose-form") || form.dataset.native) return;
    e.preventDefault();
    var data = new FormData(form, e.submitter || undefined);
    var buttons = form.querySelectorAll("button");
    buttons.forEach(function (b) { b.disabled = true; });
    fetch(form.action, {
      method: "POST",
      body: new URLSearchParams(data),
      headers: { accept: "text/html" },
      credentials: "same-origin",
    })
      .then(function (res) {
        return res.text().then(function (text) {
          // A success was a 303 that fetch followed back to the board; a
          // re-render (conflict, refusal, dry run) answered in place.
          if (!swapIn(text, res.redirected ? res.url : null)) throw new Error("no page");
          applyAll();
          var focus = document.querySelector(".banner, .dryrun");
          if (focus) focus.scrollIntoView({ block: "center" });
        });
      })
      .catch(function () {
        // Anything odd: fall back to the plain form post the page was built for.
        buttons.forEach(function (b) { b.disabled = false; });
        form.dataset.native = "1";
        if (e.submitter) form.requestSubmit(e.submitter); else form.requestSubmit();
      });
  });

  // Dependent options (an affordance's \`requires\`): show an option only
  // while the field it depends on holds one of the values it lists — e.g. a
  // Search's "Play to your site" only for the cards that may go there. The
  // server still judges whatever is submitted.
  function applyRequires(form) {
    var deps = form.querySelectorAll("[data-requires-field]");
    for (var i = 0; i < deps.length; i++) {
      var l = deps[i];
      var ctl = form.elements[l.getAttribute("data-requires-field")];
      var v = ctl ? ctl.value : "";
      var ok = v !== "" && JSON.parse(l.getAttribute("data-requires")).indexOf(v) !== -1;
      var input = l.querySelector("input");
      l.hidden = !ok;
      if (input) {
        input.disabled = !ok || input.hasAttribute("data-off");
        if (!ok) input.checked = false;
      }
    }
  }
  // A field that may be left empty while another holds certain values (an
  // affordance's \`optionalWhen\`: Search's "keep none" needs no card).
  function applyOptional(form) {
    var fields = form.querySelectorAll("[data-optional-field]");
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      var ctl = form.elements[f.getAttribute("data-optional-field")];
      var v = ctl ? ctl.value : "";
      var optional = v !== "" && JSON.parse(f.getAttribute("data-optional")).indexOf(v) !== -1;
      var inputs = f.querySelectorAll("input");
      for (var j = 0; j < inputs.length; j++) {
        if (inputs[j].hasAttribute("data-was-required") || inputs[j].required) {
          inputs[j].setAttribute("data-was-required", "");
          inputs[j].required = !optional;
        }
      }
    }
  }
  // A box of several forms for one action (Recover: a relic or a banner):
  // show only the one picked at the top.
  function applyVariants(box) {
    var pick = box.querySelector("[data-variant-pick]:checked");
    var parts = box.querySelectorAll(".variant");
    for (var i = 0; i < parts.length; i++) parts[i].hidden = !pick || parts[i].getAttribute("data-variant") !== pick.value;
  }
  function applyAll() {
    var forms = document.querySelectorAll("form.compose-form");
    for (var i = 0; i < forms.length; i++) { applyRequires(forms[i]); applyOptional(forms[i]); }
    var picks = document.querySelectorAll(".variant-pick");
    for (var j = 0; j < picks.length; j++) applyVariants(picks[j].parentElement);
  }
  document.addEventListener("change", function (e) {
    if (e.target.hasAttribute && e.target.hasAttribute("data-variant-pick")) applyVariants(e.target.closest("details"));
  });
  applyAll();
  document.addEventListener("change", function (e) {
    if (e.target.form && e.target.form.classList.contains("compose-form")) { applyRequires(e.target.form); applyOptional(e.target.form); }
  });
  document.addEventListener("reset", function (e) {
    var form = e.target;
    if (form.classList && form.classList.contains("compose-form")) setTimeout(function () { applyRequires(form); applyOptional(form); }, 0);
  });

  document.addEventListener("change", function (e) {
    var box = e.target;
    if (box.type !== "checkbox" || !box.checked) return;
    var set = box.closest("fieldset[data-max]");
    if (!set) return;
    var max = Number(set.dataset.max);
    if (set.querySelectorAll("input[type=checkbox]:checked").length > max) box.checked = false;
  });

  document.addEventListener("click", function (e) {
    var btn = e.target.closest && e.target.closest(".vocab-add");
    if (!btn) return;
    var area = btn.closest("form").querySelector("textarea[name=effects]");
    if (!area) return;
    var list;
    try { list = JSON.parse(area.value || "[]"); } catch (err) { list = null; }
    if (!Array.isArray(list)) return; // leave a hand-edited list alone
    list.push(JSON.parse(btn.dataset.effect));
    area.value = JSON.stringify(list, null, 2);
  });

  window.addEventListener("focus", function () {
    if (!document.querySelector("main section.yours")) return;
    fetch(location.href, { headers: { accept: "text/html" }, credentials: "same-origin" })
      .then(function (res) { return res.ok ? res.text() : null; })
      .then(function (text) { if (text) swapIn(text, null); })
      .catch(function () {});
  });
})();
`.trim();


/**
 * A content hash of the stylesheet and script, put in their URLs by the
 * layout (`/assets/app.css?v=…`). A new build therefore always fetches its
 * own CSS, never a cached copy from the last build — a stale stylesheet with
 * new markup is what once rendered board tokens full size and pushed the
 * Supply marker off its track. Versioned URLs can then be cached for good.
 */
export const ASSET_VERSION = createHash('sha256').update(APP_CSS).update(APP_JS).digest('hex').slice(0, 12);
