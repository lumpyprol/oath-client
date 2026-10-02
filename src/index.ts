import { app } from './app.js';
import { db } from './db.js';

const port = Number(process.env.PORT ?? 8080);
const server = app.listen(port, '0.0.0.0', () => {
  console.log(`listening on :${port}`);
});

/**
 * Close the database cleanly on a stop signal. SQLite runs in WAL mode, and
 * until the database is closed (or the log reaches ~1000 pages) every write
 * lives only in the -wal file beside it. A process that simply dies leaves
 * the whole game in that one file. Closing checkpoints the log into the
 * main database. Fly stops a machine with a signal on every deploy, and a
 * local test game was lost on 2026-10-02 with all of its data still in its
 * log (P4 unit 11).
 */
function shutdown(signal: string): void {
  console.log(`${signal}: closing`);
  server.close();
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    db.close();
  } finally {
    process.exit(0);
  }
}
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
