/**
 * Unit 7 of P4: the dry run. POST /api/games/:id/actions?dryRun=1 runs the
 * real prepare()+reduce() in a transaction that always rolls back, so a
 * client can check a declaration before it costs a log entry. Proven here
 * to leave the database byte-identical, to error byte-identically to the
 * real path, and to predict the state the real submit produces.
 */

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupChoices } from './helpers.js';

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'oath-dryrun-')), 'test.db');

let server: Server;
let base: string;
let store: typeof import('../../../src/actionlog.js');
let dbmod: typeof import('../../../src/db.js');
let oath: typeof import('../../../src/oath/game/index.js')['oath'];

beforeAll(async () => {
  const { app } = await import('../../../src/app.js');
  store = await import('../../../src/actionlog.js');
  dbmod = await import('../../../src/db.js');
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

interface Ctx {
  gameId: string;
  tokens: string[];
  seq: number;
}

async function newGame(): Promise<Ctx> {
  const created = await api('/games', {
    method: 'POST',
    body: JSON.stringify({ kind: 'oath', players: ['a', 'b', 'c'], options: { seed: SEED } }),
  });
  expect(created.status).toBe(201);
  const ctx: Ctx = {
    gameId: created.body.gameId as string,
    tokens: (created.body.players as { token: string }[]).map((p) => p.token),
    seq: 0,
  };
  const { state } = store.loadState(oath, ctx.gameId);
  for (const { seat, payload } of setupChoices(state as never)) {
    const r = await api(`/games/${ctx.gameId}/actions`, {
      method: 'POST',
      token: ctx.tokens[seat],
      body: JSON.stringify({ prevSeq: ctx.seq, type: 'setup.choose', payload }),
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    ctx.seq = r.body.seq as number;
  }
  return ctx;
}

/** The raw actions/snapshots rows for a game, as a stable JSON string. */
function dbSnapshot(gameId: string): { actions: string; snapshots: string } {
  const actions = dbmod.db.prepare('SELECT * FROM actions WHERE game_id = ? ORDER BY seq').all(gameId);
  const snapshots = dbmod.db.prepare('SELECT * FROM snapshots WHERE game_id = ? ORDER BY seq').all(gameId);
  return { actions: JSON.stringify(actions), snapshots: JSON.stringify(snapshots) };
}

describe('dry run — leaves the database byte-identical', () => {
  it('a legal dry run returns 200 { dryRun:true, view, pending, affordances, speculative } and writes nothing', async () => {
    const ctx = await newGame();
    const before = dbSnapshot(ctx.gameId);
    const headBefore = store.headSeq(ctx.gameId);

    // turn.rest for the active seat (seat 0 at round 1) — no dice.
    const r = await api(`/games/${ctx.gameId}/actions?dryRun=1`, {
      method: 'POST',
      token: ctx.tokens[0],
      body: JSON.stringify({ prevSeq: ctx.seq, type: 'turn.rest', payload: {} }),
    });
    expect(r.status).toBe(200);
    expect(r.body.dryRun).toBe(true);
    expect(r.body.view).toBeDefined();
    expect(Array.isArray(r.body.pending)).toBe(true);
    expect(Array.isArray(r.body.affordances)).toBe(true);
    expect(r.body.speculative).toEqual([]); // this rest rolls nothing

    expect(store.headSeq(ctx.gameId)).toBe(headBefore); // no seq bump
    expect(dbSnapshot(ctx.gameId)).toEqual(before); // actions AND snapshots untouched
  });

  it('50 dry runs leave the folded state identical', async () => {
    const ctx = await newGame();
    const before = dbSnapshot(ctx.gameId);
    for (let i = 0; i < 50; i++) {
      const r = await api(`/games/${ctx.gameId}/actions?dryRun=1`, {
        method: 'POST',
        token: ctx.tokens[0],
        body: JSON.stringify({ prevSeq: ctx.seq, type: 'turn.rest', payload: {} }),
      });
      expect(r.status).toBe(200);
    }
    expect(dbSnapshot(ctx.gameId)).toEqual(before);
    expect(store.headSeq(ctx.gameId)).toBe(ctx.seq);
  });

  it('a dry run predicts exactly the state the real submit then produces (no speculative fields for turn.rest)', async () => {
    const ctx = await newGame();
    const dry = await api(`/games/${ctx.gameId}/actions?dryRun=1`, {
      method: 'POST',
      token: ctx.tokens[0],
      body: JSON.stringify({ prevSeq: ctx.seq, type: 'turn.rest', payload: {} }),
    });
    expect(dry.status).toBe(200);
    const real = await api(`/games/${ctx.gameId}/actions`, {
      method: 'POST',
      token: ctx.tokens[0],
      body: JSON.stringify({ prevSeq: ctx.seq, type: 'turn.rest', payload: {} }),
    });
    expect(real.status).toBe(201);
    // Same seq predicted, and the view the dry run showed is what landed.
    expect(dry.body.seq).toBe(real.body.seq);
    expect(dry.body.view).toEqual(real.body.view);
    expect(dry.body.pending).toEqual(real.body.pending);
  });
});

describe('dry run — errors are byte-identical to the real path (unit 1 made this safe)', () => {
  it('an illegal action returns the SAME 400 body dry or real', async () => {
    const ctx = await newGame();
    const body = JSON.stringify({ prevSeq: ctx.seq, type: 'turn.rest', payload: {} });
    // seat 1 acting out of turn is illegal (it is seat 0's turn).
    const dry = await api(`/games/${ctx.gameId}/actions?dryRun=1`, { method: 'POST', token: ctx.tokens[1], body });
    const real = await api(`/games/${ctx.gameId}/actions`, { method: 'POST', token: ctx.tokens[1], body });
    expect(dry.status).toBe(400);
    expect(real.status).toBe(400);
    expect(dry.body).toEqual(real.body);
  });

  it('a stale prevSeq returns the SAME 409 body dry or real', async () => {
    const ctx = await newGame();
    const body = JSON.stringify({ prevSeq: ctx.seq - 1, type: 'turn.rest', payload: {} }); // stale
    const dry = await api(`/games/${ctx.gameId}/actions?dryRun=1`, { method: 'POST', token: ctx.tokens[0], body });
    const real = await api(`/games/${ctx.gameId}/actions`, { method: 'POST', token: ctx.tokens[0], body });
    expect(dry.status).toBe(409);
    expect(real.status).toBe(409);
    expect(dry.body).toEqual(real.body);
  });
});

describe('dry run — auth is the same as a real submit', () => {
  it('rejects a dry run with no token (401) — not a way to probe another seat', async () => {
    const ctx = await newGame();
    const r = await api(`/games/${ctx.gameId}/actions?dryRun=1`, {
      method: 'POST',
      body: JSON.stringify({ prevSeq: ctx.seq, type: 'turn.rest', payload: {} }),
    });
    expect(r.status).toBe(401);
  });
});

describe('dry run — speculative dice, and seq integrity', () => {
  interface Fixture {
    actions: { seq: number; type: string; actor: number | null; payload: unknown }[];
  }
  const fixture = JSON.parse(
    readFileSync(join(import.meta.dirname, '..', '..', 'fixtures', 'fullgame.log.json'), 'utf8'),
  ) as Fixture;

  /** Replay the fixture's proven-legal prefix up to (not including) its first campaign.declare. */
  async function driveToDeclare(): Promise<{ ctx: Ctx; declare: { actor: number; payload: unknown } }> {
    const created = await api('/games', {
      method: 'POST',
      body: JSON.stringify({ kind: 'oath', players: ['a', 'b', 'c'], options: { seed: SEED } }),
    });
    const ctx: Ctx = {
      gameId: created.body.gameId as string,
      tokens: (created.body.players as { token: string }[]).map((p) => p.token),
      seq: 0,
    };
    const rows = fixture.actions.filter((a) => a.type !== 'game.created');
    const declareIdx = rows.findIndex((a) => a.type === 'campaign.declare');
    for (const row of rows.slice(0, declareIdx)) {
      const r = await api(`/games/${ctx.gameId}/actions`, {
        method: 'POST',
        token: ctx.tokens[row.actor as number],
        body: JSON.stringify({ prevSeq: ctx.seq, type: row.type, payload: row.payload }),
      });
      expect(r.status, `${row.type}: ${JSON.stringify(r.body)}`).toBe(201);
      ctx.seq = r.body.seq as number;
    }
    const d = rows[declareIdx];
    return { ctx, declare: { actor: d.actor as number, payload: d.payload } };
  }

  it('a dice-rolling declare lists its rolled faces as speculative, and rolls nothing into the log', async () => {
    const { ctx, declare } = await driveToDeclare();
    const before = dbSnapshot(ctx.gameId);
    // A real client submits WITHOUT dice faces — prepare() rolls them. The
    // frozen fixture stores the post-prepare faces, so strip them to send
    // what a client actually would.
    const { attackFaces: _a, defenseFaces: _d, ...clientPayload } = declare.payload as Record<string, unknown>;
    const r = await api(`/games/${ctx.gameId}/actions?dryRun=1`, {
      method: 'POST',
      token: ctx.tokens[declare.actor],
      body: JSON.stringify({ prevSeq: ctx.seq, type: 'campaign.declare', payload: clientPayload }),
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    // prepare() rolled dice (D14) — a preview that will never be the real
    // ones, named so the client renders them as such.
    expect(r.body.speculative).toContain('attackFaces');
    expect(r.body.speculative).toContain('defenseFaces');
    expect(dbSnapshot(ctx.gameId)).toEqual(before); // the roll left no trace
  });

  it('a real submit against a prevSeq a dry run used still advances seq by exactly one', async () => {
    const ctx = await newGame();
    const headBefore = store.headSeq(ctx.gameId);
    // A dry run at the current head...
    await api(`/games/${ctx.gameId}/actions?dryRun=1`, {
      method: 'POST',
      token: ctx.tokens[0],
      body: JSON.stringify({ prevSeq: ctx.seq, type: 'turn.rest', payload: {} }),
    });
    // ...then a real submit at the SAME prevSeq commits at head+1.
    const real = await api(`/games/${ctx.gameId}/actions`, {
      method: 'POST',
      token: ctx.tokens[0],
      body: JSON.stringify({ prevSeq: ctx.seq, type: 'turn.rest', payload: {} }),
    });
    expect(real.status).toBe(201);
    expect(real.body.seq).toBe(headBefore + 1);
    expect(store.headSeq(ctx.gameId)).toBe(headBefore + 1);
    // A second real submit at the now-stale prevSeq is a clean 409, not corruption.
    const stale = await api(`/games/${ctx.gameId}/actions`, {
      method: 'POST',
      token: ctx.tokens[0],
      body: JSON.stringify({ prevSeq: ctx.seq, type: 'turn.rest', payload: {} }),
    });
    expect(stale.status).toBe(409);
  });
});
