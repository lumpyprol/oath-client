import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const DB_PATH = process.env.DB_PATH ?? './data/games.db';

mkdirSync(dirname(DB_PATH), { recursive: true });

/**
 * Node's built-in SQLite. No native build step, which keeps the Docker
 * image and CI simple. Requires --experimental-sqlite on Node 22; see the
 * NODE_OPTIONS in package.json and the Dockerfile.
 */
export const db = new DatabaseSync(DB_PATH);

// WAL so a long read (replay of a big game) never blocks a write.
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS games (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,
  seats       INTEGER NOT NULL,
  created_at  TEXT NOT NULL,
  complete    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS players (
  game_id  TEXT NOT NULL REFERENCES games(id),
  seat     INTEGER NOT NULL,
  name     TEXT NOT NULL,
  -- Per-player secret. Adequate auth for a private group; swap for real
  -- sessions if this ever leaves the friend circle.
  token    TEXT NOT NULL UNIQUE,
  PRIMARY KEY (game_id, seat)
);

-- The opening position, including the shuffled deck order. Written once at
-- creation and never mutated. Deliberately NOT part of the action log and
-- never served over the API: it is the game's hidden information at rest.
CREATE TABLE IF NOT EXISTS setups (
  game_id  TEXT PRIMARY KEY REFERENCES games(id),
  data     TEXT NOT NULL
);

-- Append-only. Nothing here is ever updated or deleted except by an
-- explicit rollback, which truncates the tail. Safe to read and share:
-- contains only what players did, plus dice results everyone saw anyway.
CREATE TABLE IF NOT EXISTS actions (
  game_id     TEXT NOT NULL REFERENCES games(id),
  seq         INTEGER NOT NULL,
  type        TEXT NOT NULL,
  actor       INTEGER,
  payload     TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (game_id, seq)
);

-- Pure cache. Safe to DELETE FROM at any time; state rebuilds from setup
-- plus actions.
CREATE TABLE IF NOT EXISTS snapshots (
  game_id  TEXT NOT NULL REFERENCES games(id),
  seq      INTEGER NOT NULL,
  state    TEXT NOT NULL,
  PRIMARY KEY (game_id, seq)
);
`);

/**
 * node:sqlite has no transaction helper, so this is the minimal wrapper.
 * Nested calls reuse the outer transaction rather than failing.
 */
let depth = 0;
export function transaction<T>(fn: () => T): T {
  if (depth > 0) return fn();
  db.exec('BEGIN IMMEDIATE');
  depth++;
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    depth--;
  }
}
