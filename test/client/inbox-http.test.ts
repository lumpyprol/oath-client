/**
 * Unit 9: GET / over HTTP — the inbox page a signed-in player actually
 * loads, and proof its decision links come from the same helper /inbox uses.
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'oath-inbox-')), 'test.db');
process.env.SESSION_SECRET = 'inbox-test-secret';

let server: Server;
let base: string;
let store: typeof import('../../src/actionlog.js');
let oath: typeof import('../../src/oath/game/index.js')['oath'];
let encodeSession: typeof import('../../src/session.js')['encodeSession'];

beforeAll(async () => {
  const { app } = await import('../../src/app.js');
  store = await import('../../src/actionlog.js');
  ({ oath } = await import('../../src/oath/game/index.js'));
  ({ encodeSession } = await import('../../src/session.js'));
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

async function newGame(): Promise<{ gameId: string; tokens: string[] }> {
  const res = await fetch(`${base}/api/games`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'oath', players: ['a', 'b', 'c', 'd'] }), // 4 = FIRST_GAME, no seed
  });
  const body = (await res.json()) as { gameId: string; players: { token: string }[] };
  return { gameId: body.gameId, tokens: body.players.map((p) => p.token) };
}

/** Mint the session cookie directly — the test shares session.ts's module (same SECRET) with the server. */
const cookieFor = (gameId: string, seat: number) => `oath_session=${encodeSession({ gameId, seat })}`;

async function getPage(path: string, cookie?: string): Promise<{ status: number; html: string }> {
  const res = await fetch(`${base}${path}`, {
    headers: { accept: 'text/html', ...(cookie ? { cookie } : {}) },
    redirect: 'manual',
  });
  return { status: res.status, html: await res.text() };
}

describe('GET / — the inbox page', () => {
  it('shows the seat-0 setup decision waiting, linking to its decision URL (same as /inbox)', async () => {
    const { gameId, tokens } = await newGame();
    const page = await getPage('/', cookieFor(gameId, 0));
    expect(page.status).toBe(200);
    expect(page.html).toContain('Waiting on you');

    // The link on the page must equal the url /inbox reports for the same decision.
    const inbox = await fetch(`${base}/api/inbox`, { headers: { 'x-player-token': tokens[0] } });
    const inboxBody = (await inbox.json()) as { waitingOnYou: { url: string }[] };
    const url = inboxBody.waitingOnYou[0].url;
    expect(url).toBeDefined();
    expect(page.html).toContain(`href="${url}"`);
  });

  it('tells a waiting-on-nobody seat that nothing is waiting, and why (others)', async () => {
    const { gameId } = await newGame();
    // During §1.23 setup only seat 0 is on the clock, so seat 1 waits on others.
    const page = await getPage('/', cookieFor(gameId, 1));
    expect(page.status).toBe(200);
    expect(page.html).toContain('Nothing is waiting on you.');
    expect(page.html).toContain('Waiting on others');
    expect(page.html).toContain('seat 0'); // seat 0 is setting up
    expect(page.html).toContain('setting up');
  });

  it('redirects a signed-out browser to sign-in (unit 8)', async () => {
    const page = await getPage('/');
    expect(page.status).toBe(302);
    expect(page.html).not.toContain('Waiting on you');
  });

  it('serves the stylesheet and script without auth', async () => {
    const css = await fetch(`${base}/assets/app.css`);
    expect(css.status).toBe(200);
    expect(css.headers.get('content-type')).toContain('text/css');
    const js = await fetch(`${base}/assets/app.js`);
    expect(js.status).toBe(200);
    expect(js.headers.get('content-type')).toContain('javascript');
  });
});
