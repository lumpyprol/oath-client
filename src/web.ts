/**
 * Browser-facing routes (P4 unit 8): join links, the sign-in flow, the
 * sign-in redirect, and the admin page. The JSON API (routes.ts, mounted
 * at /api) is untouched; this is the HTML/cookie half a browser needs.
 *
 * The HTML here is deliberately minimal — unit 9 builds the real client
 * shell. These are just the pages the auth flow itself requires.
 */

import express from 'express';
import { isAdmin } from './routes.js';
import { oath } from './oath/game/index.js';
import { createGame, playerByToken } from './actionlog.js';
import { sessionFromRequest, setCookieHeader } from './session.js';

const page = (title: string, body: string): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
  `<meta name="viewport" content="width=device-width, initial-scale=1">` +
  `<title>${title}</title></head><body>${body}</body></html>`;

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** TLS behind Fly's proxy shows up as x-forwarded-proto; local dev is http. */
const isSecure = (req: express.Request): boolean =>
  req.protocol === 'https' || req.header('x-forwarded-proto') === 'https';

/**
 * A `next` destination is only ever an in-app path — never an absolute URL
 * or a protocol-relative `//host` (which would be an open redirect). Anything
 * else falls back to '/'.
 */
function safeNext(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//')) return '/';
  return raw;
}

// ---- the sign-in redirect (mounted app-level, before the page routes) ------

/**
 * An unauthenticated GET of any app HTML page 302s to the sign-in page,
 * preserving the destination — so a Discord deep link opened on a fresh
 * device lands on the right decision once the player signs in. The JSON
 * API (/api) answers 401 instead of redirecting; /join, /signin, /admin
 * and /health are exempt (they are how you get signed in, or are not
 * player pages).
 */
export function signinRedirect(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const exempt = ['/api', '/join', '/signin', '/admin', '/health'];
  const wantsHtml = (req.header('accept') ?? '').includes('text/html');
  if (req.method !== 'GET' || !wantsHtml || exempt.some((p) => req.path === p || req.path.startsWith(p + '/'))) {
    return next();
  }
  if (sessionFromRequest(req.header('cookie'))) return next();
  res.redirect(302, `/signin?next=${encodeURIComponent(req.originalUrl)}`);
}

export const webRouter = express.Router();

// ---- /join/:token — the one-tap sign-in (Q16: token in the URL) ------------

webRouter.get('/join/:token', (req, res) => {
  const p = playerByToken(req.params.token);
  res.setHeader('Cache-Control', 'no-store'); // the token must not be cached anywhere
  if (!p) {
    // The token is never echoed back into the body.
    return res.status(404).type('html').send(page('Invalid link', '<p>That join link is not valid.</p>'));
  }
  res.setHeader('Set-Cookie', setCookieHeader({ gameId: p.game_id, seat: p.seat }, isSecure(req)));
  // 303 to the app root; the token never survives into the redirect target.
  res.redirect(303, safeNext(req.query.next));
});

// ---- /signin — the fallback for a signed-out deep link ----------------------

function signinPage(next: string, error?: string): string {
  return page(
    'Sign in',
    `<h1>Sign in</h1>` +
      (error ? `<p role="alert">${esc(error)}</p>` : '') +
      `<p>Open your personal join link, or paste its token below.</p>` +
      `<form method="post" action="/signin">` +
      `<input type="hidden" name="next" value="${esc(next)}">` +
      `<label>Join token <input name="token" autocomplete="off"></label>` +
      `<button type="submit">Sign in</button>` +
      `</form>`,
  );
}

webRouter.get('/signin', (req, res) => {
  res.type('html').send(signinPage(safeNext(req.query.next)));
});

webRouter.post('/signin', (req, res) => {
  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  const next = safeNext(req.body?.next);
  const p = token ? playerByToken(token) : undefined;
  if (!p) {
    return res.status(401).type('html').send(signinPage(next, 'That token is not valid.'));
  }
  res.setHeader('Set-Cookie', setCookieHeader({ gameId: p.game_id, seat: p.seat }, isSecure(req)));
  res.redirect(303, next);
});

// ---- / — a placeholder until unit 9's shell -------------------------------

webRouter.get('/', (req, res) => {
  const session = sessionFromRequest(req.header('cookie'))!; // the redirect guarantees one
  res.type('html').send(
    page(
      'Oath',
      `<p>Signed in to game ${esc(session.gameId)} as seat ${session.seat}. The client arrives in unit 9.</p>`,
    ),
  );
});

// ---- /admin — create a game and hand out its join links (Q17) --------------

const ADMIN_UNAVAILABLE = '<p>Admin is not configured (set ADMIN_TOKEN).</p>';

webRouter.get('/admin', (req, res) => {
  if (!isAdmin(req)) return res.status(403).type('html').send(page('Admin', ADMIN_UNAVAILABLE));
  const token = esc(typeof req.query.token === 'string' ? req.query.token : '');
  res.type('html').send(
    page(
      'Create a game',
      `<h1>Create a game</h1>` +
        `<form method="post" action="/admin/games">` +
        `<input type="hidden" name="token" value="${token}">` +
        `<label>Players (comma-separated) <input name="players" required></label>` +
        `<label>Chronicle seed (optional) <input name="seed"></label>` +
        `<button type="submit">Create</button>` +
        `</form>`,
    ),
  );
});

webRouter.post('/admin/games', (req, res) => {
  if (!isAdmin(req)) return res.status(403).type('html').send(page('Admin', ADMIN_UNAVAILABLE));
  const players = String(req.body?.players ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (players.length < 2 || players.length > 6) {
    return res.status(400).type('html').send(page('Create a game', '<p>Need between 2 and 6 players.</p>'));
  }
  const seed = typeof req.body?.seed === 'string' && req.body.seed.trim() ? req.body.seed.trim() : undefined;
  let seats: { seat: number; name: string; token: string }[];
  try {
    seats = createGame(oath, players, seed ? { seed } : undefined).players;
  } catch (err) {
    // A bad seed / seat-count mismatch is the admin's mistake, not a crash.
    return res
      .status(400)
      .type('html')
      .send(page('Create a game', `<p>Could not create the game: ${esc((err as Error).message)}</p>`));
  }

  const links = seats
    .map((p) => `<li>${esc(p.name)} (seat ${p.seat}): <code>/join/${esc(p.token)}</code></li>`)
    .join('');
  res.type('html').send(
    page(
      'Join links',
      `<h1>Game created</h1>` +
        `<p><strong>These join links are shown once. Hand them out privately</strong> — anyone with a link plays that seat.</p>` +
        `<ul>${links}</ul>`,
    ),
  );
});
