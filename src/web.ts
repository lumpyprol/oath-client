/**
 * Browser-facing routes (P4 unit 8): join links, the sign-in flow, the
 * sign-in redirect, and the admin page. The JSON API (routes.ts, mounted
 * at /api) is untouched; this is the HTML/cookie half a browser needs.
 *
 * The HTML here is deliberately minimal — unit 9 builds the real client
 * shell. These are just the pages the auth flow itself requires.
 */

import express from 'express';
import { isAdmin, buildInbox, buildBoard, submitComposed } from './routes.js';
import { oath } from './oath/game/index.js';
import { createGame, playerByToken } from './actionlog.js';
import { sessionFromRequest, setCookieHeader } from './session.js';
import { APP_CSS, APP_JS, ASSET_VERSION } from './client/assets.js';
import { inboxModel, boardModel, ownChanges } from './client/model.js';
import { inboxPage } from './client/pages/inbox.js';
import { boardPage, type ComposeView } from './client/pages/board.js';
import { decodeSubmission, reconcile, typeLabel, DecodeError, type RawBody, type Submission } from './client/composer.js';
import type { Affordance } from './oath/game/affordances.js';
import { seatTitle } from './oath/game/seats.js';
import { IllegalAction, StaleSeq } from './engine/types.js';
import type { OathView } from './oath/game/project.js';
import { ART_DIR, servableArtFiles, SITE_BACK_FILE } from './oath/cards/art.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

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
  const exempt = ['/api', '/join', '/signin', '/admin', '/health', '/assets'];
  const wantsHtml = (req.header('accept') ?? '').includes('text/html');
  if (req.method !== 'GET' || !wantsHtml || exempt.some((p) => req.path === p || req.path.startsWith(p + '/'))) {
    return next();
  }
  if (sessionFromRequest(req.header('cookie'))) return next();
  res.redirect(302, `/signin?next=${encodeURIComponent(req.originalUrl)}`);
}

export const webRouter = express.Router();

// ---- static assets (the shell's CSS and one PE script) ---------------------

// Pages link these as `?v=<ASSET_VERSION>`: the current version is cached
// for good (its URL changes with its content); any other URL — unversioned
// or an old version — must be revalidated, so it can never go stale.
const assetCache = (req: express.Request): string =>
  req.query.v === ASSET_VERSION ? 'public, max-age=31536000, immutable' : 'no-cache';
webRouter.get('/assets/app.css', (req, res) => {
  res.type('css').setHeader('Cache-Control', assetCache(req));
  res.send(APP_CSS);
});
webRouter.get('/assets/app.js', (req, res) => {
  res.type('js').setHeader('Cache-Control', assetCache(req));
  res.send(APP_JS);
});

// ---- /join/:token — the one-tap sign-in (Q16: token in the URL) ------------

webRouter.get('/join/:token', (req, res) => {
  const p = playerByToken(req.params.token);
  res.setHeader('Cache-Control', 'no-store'); // the token must not be cached anywhere
  if (!p) {
    // The token is never echoed back into the body.
    return res.status(404).type('html').send(page('Invalid link', '<p>That join link is not valid.</p>'));
  }
  res.setHeader('Set-Cookie', setCookieHeader({ gameId: p.game_id, seat: p.seat }, isSecure(req)));
  // 303 to the board (or a safe `next`); the token never survives into the
  // redirect target. The board, not the inbox: a join link is how a player
  // opens the game, and the board is where they act.
  res.redirect(303, req.query.next === undefined ? `/games/${p.game_id}` : safeNext(req.query.next));
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

// ---- / — the inbox, and the landing view (unit 9) -------------------------

webRouter.get('/', (req, res) => {
  const session = sessionFromRequest(req.header('cookie'));
  // The redirect middleware covers a browser navigation; this guards a
  // non-HTML GET (curl, a probe) that slipped past it.
  if (!session) return res.redirect(302, `/signin?next=${encodeURIComponent('/')}`);
  const inbox = buildInbox(session.gameId, session.seat);
  if (!inbox) {
    return res.status(404).type('html').send(page('Not found', '<p>That game no longer exists.</p>'));
  }
  // Name the other seats the way the table does ("the Yellow Exile"), from the public view.
  const players = (buildBoard(session.gameId, session.seat)?.view as OathView | undefined)?.players ?? [];
  const seatTitles = players.map((_, seat) => seatTitle(players, seat));
  const model = inboxModel(
    { gameId: session.gameId, waitingOnYou: inbox.waitingOnYou, waitingOnOthers: inbox.waitingOnOthers, seatTitles },
    Date.now(),
  );
  res.type('html').send(inboxPage(model, { seat: session.seat, gameId: session.gameId }));
});

// ---- /games/:id — the board, and the composer (units 10, 11) ---------------

/**
 * Render the board for `seat` (null = spectator) with `status`. The composer
 * section is built from the seat's FRESH affordances every time; `extra`
 * carries what a re-render adds — a banner, a prefilled form, a dry run.
 */
function renderBoard(
  res: express.Response,
  gameId: string,
  seat: number | null,
  status = 200,
  extra: Partial<Pick<ComposeView, 'banner' | 'dryRun'>> & { body?: RawBody; dryRunOf?: DryRunOf } = {},
): void {
  const board = buildBoard(gameId, seat);
  if (!board) {
    res.status(404).type('html').send(page('Not found', '<p>That game no longer exists.</p>'));
    return;
  }
  const model = boardModel(board.view as OathView, { gameId, seat, names: board.names, waiting: board.waiting });
  const entries = board.affordances as Affordance[];
  let compose: ComposeView | undefined;
  if (seat !== null) {
    compose = {
      entries,
      seq: board.seq,
      back: `/games/${gameId}`,
      banner: extra.banner,
      unavailable: board.unavailable as { type: string; reason: string }[],
    };
    if (extra.body) {
      const { index } = reconcile(entries, extra.body);
      if (index !== null) compose.prefill = { index, body: extra.body };
    }
    if (extra.dryRunOf) {
      const d = extra.dryRunOf;
      const after = boardModel(d.view as OathView, { gameId, seat, names: board.names });
      compose.dryRun = {
        ok: true,
        type: d.type,
        // A check that rolled dice shows nothing that depends on them.
        rollsDice: d.speculative.length > 0,
        changes: d.speculative.length > 0 ? [] : ownChanges(model, after, seat),
      };
    } else if (extra.dryRun) {
      compose.dryRun = extra.dryRun;
    }
  }
  const boardImageUrl = existsSync(join(ART_DIR, 'full_board.png')) ? '/art/full_board.png' : undefined;
  const siteBackUrl = existsSync(join(ART_DIR, SITE_BACK_FILE)) ? `/art/${SITE_BACK_FILE}` : undefined;
  res.status(status).type('html').send(boardPage(model, { boardImageUrl, siteBackUrl, compose }));
}

/** A successful dry run, as submitComposed returns it. */
interface DryRunOf {
  type: string;
  view: unknown;
  speculative: string[];
}

/**
 * The full table, rendered from this browser's own view. The seat comes from
 * the session cookie only when it belongs to THIS game; anyone else (a signed-
 * in player of another game, or a shared link) sees the spectator board, which
 * project(state, null) has already stripped of every hand, face, and policy.
 */
webRouter.get('/games/:id', (req, res) => {
  const session = sessionFromRequest(req.header('cookie'));
  const seat = session && session.gameId === req.params.id ? session.seat : null;
  renderBoard(res, req.params.id, seat);
});

/**
 * POST /games/:id/act — a composed form (unit 11). Decoded per field kind
 * (composer.ts) and submitted through the SAME store path as the JSON API
 * (`submitComposed` → appendAction / dryRunAction).
 *
 * TWO SURFACES, TWO CONTRACTS. The JSON API answers a stale prevSeq with a
 * 409 and an illegal action with a 400 — unchanged, and its tests still say
 * so. A browser form gets pages instead:
 *
 *   - success → 303 to the page the form came from. A POST response is never
 *     the page itself, so a refresh can never resubmit an action.
 *   - StaleSeq → 200, NOT a redirect and NOT an error page: the board
 *     re-rendered from the FRESH state with a banner saying the table moved,
 *     the fresh seq in every form, and the submission put back where it is
 *     still legal against the new affordances — or a line naming each choice
 *     that stopped being legal.
 *   - IllegalAction → 400, the board re-rendered in place with the engine's
 *     own message and the form still filled in.
 *   - "Check this" (`_dryRun`) → 200 with the dry run's verdict; nothing is
 *     written, so re-rendering a POST here is harmless.
 *
 * Refreshing any of the re-renders resubmits a stale or refused or dry-run
 * form — which cannot write anything. Only success writes, and success
 * always redirects.
 */
webRouter.post('/games/:id/act', (req, res) => {
  const gameId = req.params.id;
  const session = sessionFromRequest(req.header('cookie'));
  if (!session || session.gameId !== gameId) {
    return res.status(401).type('html').send(page('Sign in', '<p>Sign in to act in this game.</p>'));
  }
  const seat = session.seat;
  const body = (req.body ?? {}) as RawBody;

  let sub: Submission;
  try {
    sub = decodeSubmission(body);
  } catch (err) {
    if (!(err instanceof DecodeError)) throw err;
    return renderBoard(res, gameId, seat, 400, { body, banner: { kind: 'invalid', message: err.message } });
  }

  try {
    const result = submitComposed(gameId, seat, sub);
    if (!result) return res.status(404).type('html').send(page('Not found', '<p>That game no longer exists.</p>'));
    if (!result.dryRun) return res.redirect(303, safeNext(sub.back));
    return renderBoard(res, gameId, seat, 200, { body, dryRunOf: { type: sub.type, ...result } });
  } catch (err) {
    if (err instanceof StaleSeq) {
      const board = buildBoard(gameId, seat);
      const { index, problems } = reconcile((board?.affordances ?? []) as Affordance[], body);
      const message =
        `Someone else acted first — the table moved on while you were choosing (it was at ${sub.prevSeq}, it is now at ${err.expected}). ` +
        (problems.length === 0 && index !== null
          ? `Your ${typeLabel(sub.type)} is still legal and is filled in below: check it against the board and submit again.`
          : `Your ${typeLabel(sub.type)} no longer fits:`);
      return renderBoard(res, gameId, seat, 200, { body, banner: { kind: 'stale', message, problems } });
    }
    const refusal = err instanceof IllegalAction ? err.message : (err as Error)?.name === 'ZodError' ? 'Those details are not in the shape this action takes.' : null;
    if (refusal === null) throw err;
    if (sub.dryRun) {
      return renderBoard(res, gameId, seat, 200, { body, dryRun: { ok: false, type: sub.type, message: refusal } });
    }
    return renderBoard(res, gameId, seat, 400, {
      body,
      banner: { kind: 'illegal', message: `The game refused that ${typeLabel(sub.type)}: ${refusal}` },
    });
  }
});

// ---- /art/:file — card & board art, to signed-in players only (unit 15) ----

const SERVABLE_ART = servableArtFiles();

/**
 * Serves an art asset from ART_DIR to an authenticated seat only. Three
 * guards, in order: a 401 for anyone without a session (the exit criterion —
 * art is not public); a 404 for any name not in the allowlist, which is also
 * the path-traversal defense (membership, not string-sanitising — a `..`
 * name is simply not a card face); and long immutable caching, since the
 * filenames are content-stable. A missing-but-allowed file 404s cleanly, and
 * the client shows its placeholder for that key.
 */
webRouter.get('/art/:file', (req, res) => {
  if (!sessionFromRequest(req.header('cookie'))) {
    return res.status(401).type('text').send('sign in to view art');
  }
  const file = req.params.file;
  if (!SERVABLE_ART.has(file)) return res.status(404).type('text').send('not found');
  const path = join(ART_DIR, file);
  if (!existsSync(path)) return res.status(404).type('text').send('not found');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.sendFile(path);
});

// ---- /admin — create a game and hand out its join links (Q17) --------------

const ADMIN_UNAVAILABLE =
  '<p>Admin access denied — set ADMIN_TOKEN and open /admin?token=… (or send the x-admin-token header).</p>';

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
