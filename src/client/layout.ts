/**
 * The one document shell (P4 unit 9): viewport meta, the stylesheet, the
 * single deferred progressive-enhancement script, a skip link, and a header
 * carrying the game and the signed-in seat. Every page renders its body
 * into this.
 */

import { html, raw, type Raw } from './html.js';

export interface LayoutOptions {
  title: string;
  /** The signed-in seat, shown in the header; omitted on pre-auth pages. */
  seat?: number;
  gameId?: string;
  /** A class on <body>, for pages that need a wider canvas (the board). */
  bodyClass?: string;
  body: Raw;
}

export function layout(opts: LayoutOptions): string {
  const who =
    opts.seat !== undefined
      ? html`<span class="seat">seat ${opts.seat}</span>`
      : raw('');
  const bodyOpen = opts.bodyClass ? raw(`<body class="${opts.bodyClass}">`) : raw('<body>');
  return (
    '<!doctype html>' +
    html`<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${opts.title}</title>
<link rel="stylesheet" href="/assets/app.css">
<script src="/assets/app.js" defer></script>
</head>
${bodyOpen}
<a class="skip-link" href="#main">Skip to content</a>
<header class="app-header"><span class="app-title">Oath</span>${who}</header>
<main id="main">${opts.body}</main>
</body>
</html>`.value
  );
}
