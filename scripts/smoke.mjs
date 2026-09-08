/**
 * End-to-end smoke test against a real server process.
 *
 * The point of P0 is "a deployed skeleton that survives a restart", so
 * this script kills the server mid-game and brings it back up, then
 * checks the game is exactly where it was.
 *
 *   node scripts/smoke.mjs
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
    body: { kind: 'cradle', players: ['ben', 'friend', 'other'] },
  });
  check('game created', created.status === 201, created.body);
  const gameId = created.body.gameId;
  const tok = Object.fromEntries(created.body.players.map((p) => [p.seat, p.token]));

  // --- hidden information across the wire ---------------------------
  const seat0 = await api(`/api/games/${gameId}`, { token: tok[0] });
  check('seat 0 sees its own hand', Array.isArray(seat0.body.view.hands[0]));
  check('seat 0 cannot see seat 1 hand', !Array.isArray(seat0.body.view.hands[1]));
  check('deck contents never serialized', seat0.body.view.deck === undefined);

  // --- inbox routing ------------------------------------------------
  const inbox0 = await api('/api/inbox', { token: tok[0] });
  const inbox1 = await api('/api/inbox', { token: tok[1] });
  check('seat 0 is on the clock', inbox0.body.waitingOnYou.length === 1);
  check('seat 1 is not', inbox1.body.waitingOnYou.length === 0);

  // --- acting -------------------------------------------------------
  let seq = seat0.body.seq;
  const drew = await api(`/api/games/${gameId}/actions`, {
    method: 'POST',
    token: tok[0],
    body: { prevSeq: seq, type: 'draw' },
  });
  check('seat 0 drew', drew.status === 201, drew.body);
  seq = drew.body.seq;

  // --- auth and concurrency ----------------------------------------
  const noToken = await api(`/api/games/${gameId}/actions`, {
    method: 'POST',
    body: { prevSeq: seq, type: 'draw' },
  });
  check('unauthenticated action rejected', noToken.status === 401);

  const outOfTurn = await api(`/api/games/${gameId}/actions`, {
    method: 'POST',
    token: tok[2],
    body: { prevSeq: seq, type: 'draw' },
  });
  check('out-of-turn action rejected', outOfTurn.status === 400, outOfTurn.body);

  const stale = await api(`/api/games/${gameId}/actions`, {
    method: 'POST',
    token: tok[1],
    body: { prevSeq: seq - 1, type: 'roll' },
  });
  check('stale prevSeq gets 409', stale.status === 409, stale.body);

  const fresh = await api(`/api/games/${gameId}/actions`, {
    method: 'POST',
    token: tok[1],
    body: { prevSeq: seq, type: 'roll' },
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
  check(
    'creation marker leaks no deck order',
    !JSON.stringify(hist.body.actions[0]).includes('card-'),
  );
  const rollAction = hist.body.actions.find((a) => a.type === 'roll');
  check('dice results are persisted in the payload', Array.isArray(rollAction?.payload?.dice));

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
