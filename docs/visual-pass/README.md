# Visual-pass screenshots

The "before" for the next visual change (plan unit 16, step 4). Each dated
folder holds full-page captures of every page at every supported viewport,
taken by `scripts/viewport-check.mjs` — which also asserts no page scrolls
sideways at those sizes, with and without the page's JavaScript.

v1 is desktop only (HLD D66), so the viewports are 1280x800 (the smallest
supported desktop) and 1920x1080. Narrow and touch screens are not captured.

Regenerate against a running server with art (ART_DIR) and a game in progress:

    node scripts/viewport-check.mjs http://localhost:8099 <joinToken> <gameId> docs/visual-pass/<date>

JPEG, not PNG: a full-page board capture is ~5 MB as PNG.
