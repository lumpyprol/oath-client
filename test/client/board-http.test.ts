/**
 * Unit 10: GET /games/:id over HTTP — the board a signed-in player loads,
 * and the spectator board a stranger loads. Redaction is proven exhaustively
 * in board-leak.test.ts; this just wires the route to the right seat.
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'oath-board-')), 'test.db');
process.env.SESSION_SECRET = 'board-test-secret';

let server: Server;
let base: string;
let encodeSession: typeof import('../../src/session.js')['encodeSession'];

beforeAll(async () => {
  const { app } = await import('../../src/app.js');
  ({ encodeSession } = await import('../../src/session.js'));
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

async function newGame(): Promise<{ gameId: string }> {
  const res = await fetch(`${base}/api/games`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'oath', players: ['a', 'b', 'c', 'd'] }),
  });
  const body = (await res.json()) as { gameId: string };
  return { gameId: body.gameId };
}

const cookieFor = (gameId: string, seat: number) => `oath_session=${encodeSession({ gameId, seat })}`;

async function getPage(path: string, cookie?: string): Promise<{ status: number; html: string }> {
  const res = await fetch(`${base}${path}`, {
    headers: { accept: 'text/html', ...(cookie ? { cookie } : {}) },
    redirect: 'manual',
  });
  return { status: res.status, html: await res.text() };
}

describe('GET /games/:id — the board page', () => {
  it('renders the table for the signed-in seat', async () => {
    const { gameId } = await newGame();
    const page = await getPage(`/games/${gameId}`, cookieFor(gameId, 0));
    expect(page.status).toBe(200);
    expect(page.html).toContain('The table');
    expect(page.html).toContain('seat 0');
  });

  it('serves a spectator board to a cookie from a different game', async () => {
    const { gameId } = await newGame();
    const { gameId: other } = await newGame();
    const page = await getPage(`/games/${gameId}`, cookieFor(other, 0));
    expect(page.status).toBe(200);
    expect(page.html).toContain('spectator');
  });

  it('404s a game that does not exist (for a signed-in browser)', async () => {
    const { gameId } = await newGame();
    const page = await getPage('/games/nope', cookieFor(gameId, 0));
    expect(page.status).toBe(404);
  });
});
