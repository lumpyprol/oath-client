/**
 * Unit 4 of P4, transport: GET /api/games/:id carries `affordances`,
 * computed for the REQUESTING seat only and omitted for a spectator.
 * Drives the real HTTP surface in-process, like decisions-http.test.ts.
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupChoices } from './helpers.js';

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'oath-affordances-')), 'test.db');

let server: Server;
let base: string;
let store: typeof import('../../../src/actionlog.js');
let oath: typeof import('../../../src/oath/game/index.js')['oath'];

beforeAll(async () => {
  const { app } = await import('../../../src/app.js');
  store = await import('../../../src/actionlog.js');
  ({ oath } = await import('../../../src/oath/game/index.js'));
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const SEED =
  '030301000210Empire and Exile0002010123450CFFFFDF22FFFFFF12FFFFFF2EFFFFFF25FFFFFF05FFFFFF21FFFFFF1EFFFFFF3B3F67266B0488D6A316D5B9A87CD2A0867A9C1966D3337649B268D45401AFB0C04092610DB6937F413996943647B157B7659013A6956C519E89557306C39A64503B3213E0E2E7DBDDDCDEE6E1E9E3EDDAE8E4ECEBE5EA000407UNKNOWN';

async function api(path: string, init?: RequestInit & { token?: string }) {
  const { token, ...rest } = init ?? {};
  const res = await fetch(`${base}${path}`, {
    ...rest,
    headers: {
      'content-type': 'application/json',
      ...(token ? { 'x-player-token': token } : {}),
      ...(rest.headers ?? {}),
    },
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

async function newGame() {
  const created = await api('/games', {
    method: 'POST',
    body: JSON.stringify({ kind: 'oath', players: ['a', 'b', 'c'], options: { seed: SEED } }),
  });
  expect(created.status).toBe(201);
  const gameId = created.body.gameId as string;
  const tokens = (created.body.players as { token: string }[]).map((p) => p.token);
  let seq = 0;
  const { state } = store.loadState(oath, gameId);
  for (const { seat, payload } of setupChoices(state as never)) {
    const r = await api(`/games/${gameId}/actions`, {
      method: 'POST',
      token: tokens[seat],
      body: JSON.stringify({ prevSeq: seq, type: 'setup.choose', payload }),
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    seq = r.body.seq as number;
  }
  return { gameId, tokens };
}

describe('GET /games/:id — affordances transport (P4 unit 4)', () => {
  it('carries affordances for the active seat, including the turn shapes', async () => {
    const { gameId, tokens } = await newGame();
    const r = await api(`/games/${gameId}`, { token: tokens[0] }); // seat 0 begins round 1
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.affordances)).toBe(true);
    const types = new Set((r.body.affordances as { type: string }[]).map((a) => a.type));
    // The three unit-4 shapes are always here at the start of a turn;
    // unit 5 adds more (search, warbands.move, …) which vary by position.
    expect(types.has('turn.rest')).toBe(true);
    expect(types.has('travel')).toBe(true);
    expect(types.has('standing.set')).toBe(true);
  });

  it('omits affordances entirely for a spectator (no token)', async () => {
    const { gameId } = await newGame();
    const r = await api(`/games/${gameId}`); // no token → spectator
    expect(r.status).toBe(200);
    expect(r.body.seat).toBeNull();
    expect('affordances' in r.body).toBe(false);
  });

  it('gives a seat whose turn it is not an empty affordance list', async () => {
    const { gameId, tokens } = await newGame();
    const r = await api(`/games/${gameId}`, { token: tokens[1] }); // not seat 1's turn yet
    expect(r.status).toBe(200);
    expect(r.body.affordances).toEqual([]);
  });
});
