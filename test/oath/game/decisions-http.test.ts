/**
 * Unit 2 of Phase 3: resolve a decision id over HTTP.
 *
 * GET /games/:id/decisions/:decisionId gives every stable id something to
 * resolve against — the URL a notification will carry (P6) and a client
 * will open (P4). Drives the real HTTP surface in-process, like
 * fullgame.test.ts.
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupChoices } from './helpers.js';

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'oath-decisions-')), 'test.db');

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

/** Seed 1 of the vendored sample chronicles (fullgame.test.ts's own seed) — ordered, so 3 seats is legal without a shuffle. */
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

  // P3 unit 8: Law §1.23's setup choices are owed before anything else.
  // Driven here so each test below is about the decision endpoint, not setup.
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

/** Seat 0's own Reliquary relic — hidden from every projection, but this is
 * test setup reading TRUE state, same idiom as fullgame.test.ts's rawState. */
function firstReliquaryRelic(gameId: string): string {
  const { state } = store.loadState(oath, gameId);
  return (state as any).reliquary[0].relicId as string;
}

/** Offers seat 1 Citizenship as seat 0 (the Grand Scepter holder at setup), producing a live `citizenshipOffer` decision. */
async function offerCitizenship(ctx: Ctx): Promise<{ decisionId: string; offeredAtSeq: number }> {
  const relicId = firstReliquaryRelic(ctx.gameId);
  const r = await api(`/games/${ctx.gameId}/actions`, {
    method: 'POST',
    token: ctx.tokens[0],
    body: JSON.stringify({
      prevSeq: ctx.seq,
      type: 'citizenship.offer',
      payload: { exile: 1, relicId },
    }),
  });
  expect(r.status).toBe(201);
  ctx.seq = r.body.seq as number;
  const decision = (r.body.pending as { id: string; kind: string }[]).find((d) => d.kind === 'citizenshipOffer');
  expect(decision).toBeDefined();
  return { decisionId: decision!.id, offeredAtSeq: ctx.seq };
}

describe('GET /games/:id/decisions/:decisionId', () => {
  it('returns the live decision, with `yours` true for its own seat', async () => {
    const ctx = await newGame();
    const { decisionId } = await offerCitizenship(ctx);

    const r = await api(`/games/${ctx.gameId}/decisions/${decisionId}`, { token: ctx.tokens[1] });
    expect(r.status).toBe(200);
    expect(r.body.gameId).toBe(ctx.gameId);
    expect(r.body.decision).toMatchObject({ id: decisionId, kind: 'citizenshipOffer', seat: 1 });
    expect(r.body.yours).toBe(true);
    expect(r.body.view).toBeDefined();
  });

  it('returns the same live decision to a DIFFERENT seat in the game, with `yours` false', async () => {
    const ctx = await newGame();
    const { decisionId } = await offerCitizenship(ctx);

    const asOfferer = await api(`/games/${ctx.gameId}/decisions/${decisionId}`, { token: ctx.tokens[0] });
    expect(asOfferer.status).toBe(200);
    expect(asOfferer.body.yours).toBe(false);

    const asBystander = await api(`/games/${ctx.gameId}/decisions/${decisionId}`, { token: ctx.tokens[2] });
    expect(asBystander.status).toBe(200);
    expect(asBystander.body.yours).toBe(false);
    expect(asBystander.body.decision.id).toBe(decisionId);
  });

  it('401s with no token, or a token from a different game', async () => {
    const ctx = await newGame();
    const other = await newGame();
    const { decisionId } = await offerCitizenship(ctx);

    const noToken = await api(`/games/${ctx.gameId}/decisions/${decisionId}`);
    expect(noToken.status).toBe(401);

    const wrongGame = await api(`/games/${ctx.gameId}/decisions/${decisionId}`, { token: other.tokens[0] });
    expect(wrongGame.status).toBe(401);
  });

  it('400s a malformed decision id, without ever touching the game', async () => {
    const ctx = await newGame();
    for (const bad of ['not-a-decision-id', 'turn:abc:17', 'turn:1', 'turn:1:', ':1:17']) {
      const r = await api(`/games/${ctx.gameId}/decisions/${encodeURIComponent(bad)}`, {
        token: ctx.tokens[0],
      });
      expect(r.status, `expected 400 for "${bad}"`).toBe(400);
    }
  });

  it('matches an id containing `:` literally, no encoding games', async () => {
    const ctx = await newGame();
    const { decisionId } = await offerCitizenship(ctx);
    expect(decisionId).toContain(':');
    // fetch() lets ':' through unencoded in a path segment (RFC 3986 pchar) —
    // this is the literal, un-encoded request a deep link would make.
    const r = await api(`/games/${ctx.gameId}/decisions/${decisionId}`, { token: ctx.tokens[1] });
    expect(r.status).toBe(200);
  });

  it('410s a well-formed id that was resolved — never an error page for a stale deep link', async () => {
    const ctx = await newGame();
    const { decisionId } = await offerCitizenship(ctx);

    const accepted = await api(`/games/${ctx.gameId}/actions`, {
      method: 'POST',
      token: ctx.tokens[1],
      body: JSON.stringify({ prevSeq: ctx.seq, type: 'citizenship.accept', payload: {} }),
    });
    expect(accepted.status).toBe(201);
    ctx.seq = accepted.body.seq as number;

    const r = await api(`/games/${ctx.gameId}/decisions/${decisionId}`, { token: ctx.tokens[1] });
    expect(r.status).toBe(410);
    expect(r.body).toMatchObject({ gone: true, seq: ctx.seq });
    expect(Array.isArray(r.body.waitingOnYou)).toBe(true);
  });

  it('410s a well-formed id that a rollback unwound away', async () => {
    const ctx = await newGame();
    const beforeOffer = ctx.seq;
    const { decisionId } = await offerCitizenship(ctx);

    const rolled = await api(`/games/${ctx.gameId}/rollback`, {
      method: 'POST',
      body: JSON.stringify({ toSeq: beforeOffer }),
    });
    expect(rolled.status).toBe(200);

    const r = await api(`/games/${ctx.gameId}/decisions/${decisionId}`, { token: ctx.tokens[1] });
    expect(r.status).toBe(410);
    expect(r.body.gone).toBe(true);
  });

  it('404s an unknown game (checked before the id shape, but after malformed-400)', async () => {
    const r = await api(`/games/does-not-exist/decisions/turn:0:0`, { token: 'irrelevant' });
    expect(r.status).toBe(404);
  });

  it('`since` equals the createdAt of the action at the id\'s anchor', async () => {
    const ctx = await newGame();
    const { decisionId, offeredAtSeq } = await offerCitizenship(ctx);

    const history = await api(`/games/${ctx.gameId}/history`);
    const anchorRow = (history.body.actions as { seq: number; createdAt: string }[]).find(
      (a) => a.seq === offeredAtSeq,
    );
    expect(anchorRow).toBeDefined();

    const r = await api(`/games/${ctx.gameId}/decisions/${decisionId}`, { token: ctx.tokens[1] });
    expect(r.status).toBe(200);
    expect(r.body.since).toBe(anchorRow!.createdAt);
  });
});

describe('/inbox carries `url` and `since` on every waiting decision (unit 2)', () => {
  it('each waitingOnYou entry resolves at its own url, and carries the anchor\'s createdAt', async () => {
    const ctx = await newGame();
    const { decisionId, offeredAtSeq } = await offerCitizenship(ctx);

    const inbox = await api('/inbox', { token: ctx.tokens[1] });
    expect(inbox.status).toBe(200);
    const entry = (inbox.body.waitingOnYou as any[]).find((d) => d.id === decisionId);
    expect(entry).toBeDefined();
    expect(entry.url).toBe(`/games/${ctx.gameId}/decisions/${decisionId}`);

    const history = await api(`/games/${ctx.gameId}/history`);
    const anchorRow = (history.body.actions as { seq: number; createdAt: string }[]).find(
      (a) => a.seq === offeredAtSeq,
    );
    expect(entry.since).toBe(anchorRow!.createdAt);

    // The url actually resolves.
    const followed = await api(entry.url, { token: ctx.tokens[1] });
    expect(followed.status).toBe(200);
    expect(followed.body.decision.id).toBe(decisionId);
  });
});
