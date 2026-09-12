/**
 * End-to-end smoke test against a real server process.
 *
 * The point of P0 is "a deployed skeleton that survives a restart", so
 * this script kills the server mid-game and brings it back up, then
 * checks the game is exactly where it was.
 *
 * Unit 20 repointed it from the `cradle` toy (now deleted) to a real Oath
 * game. That matters beyond tidiness: the toy's state was small enough that
 * "survives a restart" was nearly free, whereas an Oath state is a deep
 * object graph with sites, forces and a live turn structure, and it is the
 * one that actually has to round-trip through SQLite.
 *
 *   node scripts/smoke.mjs
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A chronicle seed (the same vendored sample the tests use). Oath refuses a
 * seatless first game, so a smoke run has to name an opening position — and
 * a seeded setup is `ordered`, which is what lets the script below know
 * which actions will be legal.
 */
const SEED =
  '030301000210Empire and Exile0002010123450CFFFFDF22FFFFFF12FFFFFF2EFFFFFF25FFFFFF05FFFFFF21FFFFFF1EFFFFFF3B3F67266B0488D6A316D5B9A87CD2A0867A9C1966D3337649B268D45401AFB0C04092610DB6937F413996943647B157B7659013A6956C519E89557306C39A64503B3213E0E2E7DBDDDCDEE6E1E9E3EDDAE8E4ECEBE5EA000407UNKNOWN';

const PORT = 8791;
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = mkdtempSync(join(tmpdir(), 'oath-smoke-'));
const DB_PATH = join(dataDir, 'smoke.db');

let ok = 0;
const check = (label, cond, extra) => {
  if (cond) {
    ok++;
    console.log(`  ok  ${label}`);
  } else {
    console.error(`FAIL  ${label}`, extra ?? '');
    process.exitCode = 1;
  }
};

function startServer() {
  const proc = spawn('node', ['dist/index.js'], {
    env: {
      ...process.env,
      PORT: String(PORT),
      DB_PATH,
      NODE_OPTIONS: '--experimental-sqlite',
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  return proc;
}

async function waitForHealth(timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server never became healthy');
}

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { 'x-player-token': token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

let server = startServer();

try {
  await waitForHealth();

  // --- create -------------------------------------------------------
  const created = await api('/api/games', {
    method: 'POST',
    body: { kind: 'oath', players: ['Chancellor', 'Red', 'Blue'], options: { seed: SEED } },
  });
  check('game created', created.status === 201, created.body);
  const gameId = created.body.gameId;
  const tok = Object.fromEntries(created.body.players.map((p) => [p.seat, p.token]));

  // --- hidden information across the wire (Law §9.4) ----------------
  const seat0 = await api(`/api/games/${gameId}`, { token: tok[0] });
  const view0 = seat0.body.view;
  check('seat 0 sees its own hand', Array.isArray(view0.players[0].hand));
  check('seat 0 cannot see seat 1 hand', !Array.isArray(view0.players[1].hand));
  // The world deck is the one zone whose SIZE is private, so the wire
  // carries no key for it at all — not a zeroed one.
  check('world deck size never serialized', Object.keys(view0.worldDeck).length === 0);
  check(
    'discard piles cross the wire as counts only',
    Object.values(view0.discards).every((d) => Object.keys(d).join() === 'count'),
  );
  // Every seat starts with one facedown adviser (Law §1.23.2), so this is a
  // real case at seq 0 rather than a hypothetical.
  const foreignFacedown = view0.players
    .slice(1)
    .flatMap((p) => p.advisers)
    .filter((a) => a.facedown);
  check('other seats have facedown advisers to hide', foreignFacedown.length > 0);
  check('and none of them leaked an id', foreignFacedown.every((a) => a.id === null));
  check('own facedown adviser IS visible to its owner', view0.players[0].advisers[0].id !== null);

  // --- inbox routing ------------------------------------------------
  const inbox0 = await api('/api/inbox', { token: tok[0] });
  const inbox1 = await api('/api/inbox', { token: tok[1] });
  check('seat 0 is on the clock', inbox0.body.waitingOnYou.length === 1);
  check('seat 1 is not', inbox1.body.waitingOnYou.length === 0);

  // --- acting -------------------------------------------------------
  let seq = seat0.body.seq;
  const searched = await api(`/api/games/${gameId}/actions`, {
    method: 'POST',
    token: tok[0],
    body: { prevSeq: seq, type: 'search', payload: { from: 'deck' } },
  });
  check('seat 0 searched', searched.status === 201, searched.body);
  seq = searched.body.seq;
  check('the draw is in seat 0 own hand', searched.body.view.players[0].hand.length > 0);

  // --- auth and concurrency ----------------------------------------
  const noToken = await api(`/api/games/${gameId}/actions`, {
    method: 'POST',
    body: { prevSeq: seq, type: 'card.play', payload: { handIndex: 0, as: 'discard' } },
  });
  check('unauthenticated action rejected', noToken.status === 401);

  // Mid-Search locks the table to the searcher, so seat 2 is out of turn.
  const outOfTurn = await api(`/api/games/${gameId}/actions`, {
    method: 'POST',
    token: tok[2],
    body: { prevSeq: seq, type: 'search', payload: { from: 'deck' } },
  });
  check('out-of-turn action rejected', outOfTurn.status === 400, outOfTurn.body);

  const stale = await api(`/api/games/${gameId}/actions`, {
    method: 'POST',
    token: tok[0],
    body: { prevSeq: seq - 1, type: 'card.play', payload: { handIndex: 0, as: 'discard' } },
  });
  check('stale prevSeq gets 409', stale.status === 409, stale.body);

  const fresh = await api(`/api/games/${gameId}/actions`, {
    method: 'POST',
    token: tok[0],
    body: { prevSeq: seq, type: 'card.play', payload: { handIndex: 0, as: 'discard' } },
  });
  check('retry with fresh seq succeeds', fresh.status === 201, fresh.body);
  seq = fresh.body.seq;

  const before = await api(`/api/games/${gameId}`, { token: tok[0] });

  // --- restart ------------------------------------------------------
  server.kill('SIGKILL');
  await new Promise((r) => server.once('exit', r));
  server = startServer();
  await waitForHealth();

  const after = await api(`/api/games/${gameId}`, { token: tok[0] });
  check('seq survives restart', after.body.seq === before.body.seq);
  check(
    'state is byte-identical after restart',
    JSON.stringify(after.body.view) === JSON.stringify(before.body.view),
  );

  // --- history and rollback ----------------------------------------
  const hist = await api(`/api/games/${gameId}/history`);
  check('history starts with the seq-0 creation marker', hist.body.actions[0].type === 'game.created');
  // The opening position (deck order, every dealt card) lives in `setups`,
  // which is never part of the log — so no card id may appear in the marker.
  check(
    'creation marker leaks no card ids',
    !/(denizen|vision|relic|site|edifice|banner):/.test(JSON.stringify(hist.body.actions[0])),
  );
  // Cards played to a hidden destination are named by INDEX, never id, so
  // the shared log cannot leak what was discarded either.
  const playAction = hist.body.actions.find((a) => a.type === 'card.play');
  check(
    'a card played to a hidden destination is logged by index, not id',
    playAction !== undefined &&
      !/(denizen|vision|relic|site|edifice|banner):/.test(JSON.stringify(playAction.payload)),
  );

  const rolled = await api(`/api/games/${gameId}/rollback`, {
    method: 'POST',
    body: { toSeq: 1 },
  });
  check('rollback accepted', rolled.status === 200, rolled.body);
  const post = await api(`/api/games/${gameId}`, { token: tok[0] });
  check('rollback rewound the head', post.body.seq === 1);

  console.log(`\n${ok} checks passed`);
} finally {
  server.kill('SIGKILL');
  rmSync(dataDir, { recursive: true, force: true });
}
