/**
 * Unit 8 of P4: sessions, join links, the sign-in flow, and the gate that
 * finally closes the open rollback endpoint. Redirect + cookie assertions
 * use a raw node:http client, because fetch's `manual` redirect yields an
 * opaque response whose headers cannot be read.
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupChoices } from './helpers.js';

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'oath-sessions-')), 'test.db');
process.env.ADMIN_TOKEN = 'admin-secret-for-tests';

let server: Server;
let base: string;
let port: number;
let store: typeof import('../../../src/actionlog.js');
let oath: typeof import('../../../src/oath/game/index.js')['oath'];

beforeAll(async () => {
  const { app } = await import('../../../src/app.js');
  store = await import('../../../src/actionlog.js');
  ({ oath } = await import('../../../src/oath/game/index.js'));
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}/api`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const SEED =
  '030301000210Empire and Exile0002010123450CFFFFDF22FFFFFF12FFFFFF2EFFFFFF25FFFFFF05FFFFFF21FFFFFF1EFFFFFF3B3F67266B0488D6A316D5B9A87CD2A0867A9C1966D3337649B268D45401AFB0C04092610DB6937F413996943647B157B7659013A6956C519E89557306C39A64503B3213E0E2E7DBDDDCDEE6E1E9E3EDDAE8E4ECEBE5EA000407UNKNOWN';

/** Raw request — never follows redirects, so status/headers/body are all readable. */
function raw(
  method: string,
  path: string,
  opts: { headers?: Record<string, string>; body?: string } = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const headers = { ...opts.headers };
    if (opts.body !== undefined) headers['content-length'] = String(Buffer.byteLength(opts.body));
    const req = http.request(
      { host: '127.0.0.1', port, method, path, headers },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function jsonApi(path: string, init?: RequestInit & { token?: string; cookie?: string }) {
  const { token, cookie, ...rest } = init ?? {};
  const res = await fetch(`${base}${path}`, {
    ...rest,
    headers: {
      'content-type': 'application/json',
      ...(token ? { 'x-player-token': token } : {}),
      ...(cookie ? { cookie } : {}),
      ...(rest.headers ?? {}),
    },
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

async function newGame(): Promise<{ gameId: string; tokens: string[] }> {
  const created = await jsonApi('/games', {
    method: 'POST',
    body: JSON.stringify({ kind: 'oath', players: ['a', 'b', 'c'], options: { seed: SEED } }),
  });
  expect(created.status).toBe(201);
  return {
    gameId: created.body.gameId as string,
    tokens: (created.body.players as { token: string }[]).map((p) => p.token),
  };
}

/** The Set-Cookie's oath_session value (what a browser would send back). */
function sessionCookieFrom(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie.find((c) => c.startsWith('oath_session=')) : setCookie;
  expect(header, 'a Set-Cookie for oath_session').toBeDefined();
  return header!.split(';')[0]; // "oath_session=<value>"
}

describe('join links (Q16: token in the URL)', () => {
  it('sets a correctly-flagged session cookie, 303s to /, no-store, and never echoes the token', async () => {
    const { gameId, tokens } = await newGame();
    const r = await raw('GET', `/join/${tokens[1]}`);
    expect(r.status).toBe(303);
    expect(r.headers.location).toBe('/');
    expect(r.headers['cache-control']).toBe('no-store');
    const setCookie = Array.isArray(r.headers['set-cookie']) ? r.headers['set-cookie'][0] : r.headers['set-cookie'];
    expect(setCookie).toContain('oath_session=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).toMatch(/Max-Age=\d{6,}/); // long-lived
    expect(setCookie).not.toContain('Secure'); // plain http locally
    expect(r.body).not.toContain(tokens[1]); // the token is never in the body
  });

  it('adds Secure when the request arrives over TLS (x-forwarded-proto)', async () => {
    const { tokens } = await newGame();
    const r = await raw('GET', `/join/${tokens[0]}`, { headers: { 'x-forwarded-proto': 'https' } });
    const setCookie = Array.isArray(r.headers['set-cookie']) ? r.headers['set-cookie'][0] : r.headers['set-cookie'];
    expect(setCookie).toContain('Secure');
  });

  it('a bad token 404s and still does not echo it', async () => {
    const r = await raw('GET', `/join/not-a-real-token`);
    expect(r.status).toBe(404);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.body).not.toContain('not-a-real-token');
  });
});

describe('the session cookie authenticates the JSON API (header still wins)', () => {
  it('a valid cookie resolves the seat; a tampered one does not', async () => {
    const { gameId, tokens } = await newGame();
    const joined = await raw('GET', `/join/${tokens[2]}`);
    const cookie = sessionCookieFrom(joined.headers['set-cookie']);

    const good = await jsonApi(`/games/${gameId}`, { cookie });
    expect(good.body.seat).toBe(2);

    // Flip the last character of the signature — the HMAC no longer matches.
    const tampered = cookie.slice(0, -1) + (cookie.at(-1) === 'a' ? 'b' : 'a');
    const bad = await jsonApi(`/games/${gameId}`, { cookie: tampered });
    expect(bad.body.seat).toBeNull();
  });

  it('a cookie for game A grants nothing on game B', async () => {
    const a = await newGame();
    const b = await newGame();
    const joined = await raw('GET', `/join/${a.tokens[0]}`);
    const cookie = sessionCookieFrom(joined.headers['set-cookie']);

    expect((await jsonApi(`/games/${a.gameId}`, { cookie })).body.seat).toBe(0);
    expect((await jsonApi(`/games/${b.gameId}`, { cookie })).body.seat).toBeNull();
  });

  it('the header still authenticates exactly as before', async () => {
    const { gameId, tokens } = await newGame();
    expect((await jsonApi(`/games/${gameId}`, { token: tokens[1] })).body.seat).toBe(1);
  });
});

describe('the rollback gate (the exploit is now a test)', () => {
  async function playedTo(): Promise<{ gameId: string; tokens: string[]; seq: number }> {
    const { gameId, tokens } = await newGame();
    let seq = 0;
    const { state } = store.loadState(oath, gameId);
    for (const { seat, payload } of setupChoices(state as never)) {
      const r = await jsonApi(`/games/${gameId}/actions`, {
        method: 'POST',
        token: tokens[seat],
        body: JSON.stringify({ prevSeq: seq, type: 'setup.choose', payload }),
      });
      seq = r.body.seq as number;
    }
    return { gameId, tokens, seq };
  }

  it('a stranger (no auth) cannot roll back — 401', async () => {
    const { gameId } = await playedTo();
    const r = await jsonApi(`/games/${gameId}/rollback`, { method: 'POST', body: JSON.stringify({ toSeq: 0 }) });
    expect(r.status).toBe(401);
  });

  it('a player in the game can roll back', async () => {
    const { gameId, tokens } = await playedTo();
    const r = await jsonApi(`/games/${gameId}/rollback`, {
      method: 'POST',
      token: tokens[0],
      body: JSON.stringify({ toSeq: 0 }),
    });
    expect(r.status).toBe(200);
  });

  it('the admin token can roll back', async () => {
    const { gameId } = await playedTo();
    const r = await jsonApi(`/games/${gameId}/rollback`, {
      method: 'POST',
      headers: { 'x-admin-token': 'admin-secret-for-tests' },
      body: JSON.stringify({ toSeq: 0 }),
    });
    expect(r.status).toBe(200);
  });

  it("a cookie for a DIFFERENT game does not authorize rollback", async () => {
    const a = await playedTo();
    const b = await newGame();
    const joined = await raw('GET', `/join/${b.tokens[0]}`);
    const cookie = sessionCookieFrom(joined.headers['set-cookie']);
    const r = await jsonApi(`/games/${a.gameId}/rollback`, {
      method: 'POST',
      cookie,
      body: JSON.stringify({ toSeq: 0 }),
    });
    expect(r.status).toBe(401);
  });
});

describe('the sign-in redirect preserves a deep link', () => {
  it('an unauthenticated HTML GET 302s to /signin with the destination, and signing in returns there', async () => {
    const { tokens } = await newGame();
    const deepLink = '/games/some-game/decisions/wake:0:1';

    // A signed-out browser opening the deep link is bounced to sign-in.
    const bounced = await raw('GET', deepLink, { headers: { accept: 'text/html' } });
    expect(bounced.status).toBe(302);
    expect(bounced.headers.location).toBe(`/signin?next=${encodeURIComponent(deepLink)}`);

    // The sign-in page carries the destination forward.
    const signin = await raw('GET', bounced.headers.location as string, { headers: { accept: 'text/html' } });
    expect(signin.status).toBe(200);
    expect(signin.body).toContain(deepLink);

    // Submitting a valid token signs in and returns to the deep link.
    const posted = await raw('POST', '/signin', {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `token=${tokens[0]}&next=${encodeURIComponent(deepLink)}`,
    });
    expect(posted.status).toBe(303);
    expect(posted.headers.location).toBe(deepLink);
    expect(sessionCookieFrom(posted.headers['set-cookie'])).toContain('oath_session=');
  });

  it('an open-redirect next is refused, falling back to /', async () => {
    const bounced = await raw('GET', '/', {
      headers: { accept: 'text/html' },
    });
    // No session → redirect to signin (next is '/').
    expect(bounced.status).toBe(302);
    // A crafted absolute next is sanitized on the way out of /signin's form.
    const signin = await raw('GET', '/signin?next=https://evil.example/', { headers: { accept: 'text/html' } });
    expect(signin.body).not.toContain('https://evil.example');
  });

  it('the JSON API answers 401 rather than redirecting (Accept is not html)', async () => {
    const { gameId } = await newGame();
    const r = await jsonApi(`/games/${gameId}/actions`, {
      method: 'POST',
      body: JSON.stringify({ prevSeq: 0, type: 'turn.rest', payload: {} }),
    });
    expect(r.status).toBe(401);
  });
});

describe('the admin page (Q17)', () => {
  it('is 403 without the admin token', async () => {
    const r = await raw('GET', '/admin', { headers: { accept: 'text/html' } });
    expect(r.status).toBe(403);
  });

  it('creates a game and shows its join links once, behind the admin token', async () => {
    const r = await raw('POST', '/admin/games', {
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-admin-token': 'admin-secret-for-tests',
      },
      body: `players=${encodeURIComponent('Alice,Bob,Carol')}&seed=${encodeURIComponent(SEED)}`,
    });
    expect(r.status, r.body).toBe(200);
    expect(r.body).toContain('/join/');
    expect(r.body.toLowerCase()).toContain('privately');
  });
});
