/**
 * Unit 15: the gated art route. Art is served to authenticated seats only;
 * the unauthenticated refusal is written as the exploit first (the exit
 * criterion). Also: a traversal attempt and a non-manifest name 404, and
 * present files carry immutable caching.
 */

import { existsSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ART_DIR, ART_MANIFEST } from '../../src/oath/cards/art.js';

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'oath-art-')), 'test.db');
process.env.SESSION_SECRET = 'art-test-secret';

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

const anyCookie = () => `oath_session=${encodeSession({ gameId: 'g', seat: 0 })}`;
const aRealFile = ART_MANIFEST['denizen:longbows'].file; // cards_04.png

describe('GET /art/:file — gated art', () => {
  it('refuses an unauthenticated request (the exit criterion)', async () => {
    const res = await fetch(`${base}/art/${aRealFile}`, { redirect: 'manual' });
    expect(res.status).toBe(401);
  });

  it('404s a filename the manifest does not name (also the traversal defense)', async () => {
    const res = await fetch(`${base}/art/not-a-card.png`, { headers: { cookie: anyCookie() } });
    expect(res.status).toBe(404);
  });

  it('refuses a path-traversal attempt by membership, not sanitising', async () => {
    // Encoded so it reaches the route as a single :file segment.
    const res = await fetch(`${base}/art/..%2f..%2fpackage.json`, {
      headers: { cookie: anyCookie() },
      redirect: 'manual',
    });
    expect(res.status).toBe(404);
  });

  it.skipIf(!existsSync(join(ART_DIR, aRealFile)))(
    'serves a real card image to a signed-in seat, cached immutably',
    async () => {
      const res = await fetch(`${base}/art/${aRealFile}`, { headers: { cookie: anyCookie() } });
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toContain('immutable');
      expect(res.headers.get('content-type')).toContain('image');
    },
  );
});
