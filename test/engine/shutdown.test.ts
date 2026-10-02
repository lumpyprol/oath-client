/**
 * A stopped server leaves its games in the main database file, not only in
 * the WAL log beside it (src/index.ts). A local test game was lost on
 * 2026-10-02 with every write still in its -wal file. This starts the real
 * server, makes a game, stops it with SIGTERM, and checks the -wal is empty
 * and the main file alone holds the game.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, statSync, existsSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';

describe('stopping the server checkpoints the database', () => {
  it('SIGTERM folds the WAL into the main file, so the main file alone holds every game', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oath-shutdown-'));
    const dbPath = join(dir, 'games.db');
    const port = 20000 + Math.floor(Math.random() * 20000);
    const proc = spawn(process.execPath, ['--experimental-sqlite', '--import', 'tsx', 'src/index.ts'], {
      env: { ...process.env, DB_PATH: dbPath, PORT: String(port), SESSION_SECRET: 's' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await new Promise<void>((resolve, reject) => {
      proc.stdout.on('data', (b: Buffer) => b.toString().includes('listening') && resolve());
      proc.on('exit', (code) => reject(new Error(`server exited early (${code})`)));
    });
    const res = await fetch(`http://127.0.0.1:${port}/api/games`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'oath', players: ['a', 'b', 'c', 'd'] }),
    });
    const { gameId } = (await res.json()) as { gameId: string };

    const exited = new Promise<number | null>((resolve) => proc.on('exit', resolve));
    proc.kill('SIGTERM');
    expect(await exited).toBe(0);

    const wal = `${dbPath}-wal`;
    expect(!existsSync(wal) || statSync(wal).size === 0).toBe(true);
    // The main file ALONE: copy just it somewhere and read the game back.
    const lone = join(dir, 'lone.db');
    copyFileSync(dbPath, lone);
    const db = new DatabaseSync(lone);
    expect(db.prepare('SELECT id FROM games WHERE id = ?').get(gameId)).toEqual({ id: gameId });
    db.close();
  }, 30000);
});
