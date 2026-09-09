import { randomUUID } from 'node:crypto';
import { db, transaction } from './db.js';
import { StaleSeq, type GameAction, type GameDefinition } from './engine/types.js';

/** Snapshot cadence. Purely a performance knob. */
const SNAPSHOT_EVERY = 25;

interface ActionRow {
  game_id: string;
  seq: number;
  type: string;
  actor: number | null;
  payload: string;
  created_at: string;
}

const rowToAction = (r: ActionRow): GameAction => ({
  gameId: r.game_id,
  seq: r.seq,
  type: r.type,
  actor: r.actor,
  payload: JSON.parse(r.payload),
  createdAt: r.created_at,
});

const q = {
  headSeq: db.prepare('SELECT MAX(seq) AS seq FROM actions WHERE game_id = ?'),
  insertAction: db.prepare(
    `INSERT INTO actions (game_id, seq, type, actor, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ),
  actionsFrom: db.prepare('SELECT * FROM actions WHERE game_id = ? AND seq > ? ORDER BY seq ASC'),
  latestSnapshot: db.prepare(
    'SELECT seq, state FROM snapshots WHERE game_id = ? AND seq <= ? ORDER BY seq DESC LIMIT 1',
  ),
  putSnapshot: db.prepare(
    'INSERT OR REPLACE INTO snapshots (game_id, seq, state) VALUES (?, ?, ?)',
  ),
  markComplete: db.prepare('UPDATE games SET complete = ? WHERE id = ?'),
  insertGame: db.prepare('INSERT INTO games (id, kind, seats, created_at) VALUES (?, ?, ?, ?)'),
  insertSetup: db.prepare('INSERT INTO setups (game_id, data) VALUES (?, ?)'),
  getSetup: db.prepare('SELECT data FROM setups WHERE game_id = ?'),
  insertPlayer: db.prepare('INSERT INTO players (game_id, seat, name, token) VALUES (?, ?, ?, ?)'),
  playersOf: db.prepare('SELECT seat, name, token FROM players WHERE game_id = ? ORDER BY seat'),
  playerByToken: db.prepare('SELECT game_id, seat, name FROM players WHERE token = ?'),
  game: db.prepare('SELECT * FROM games WHERE id = ?'),
  dropSnapshotsAfter: db.prepare('DELETE FROM snapshots WHERE game_id = ? AND seq > ?'),
  dropActionsAfter: db.prepare('DELETE FROM actions WHERE game_id = ? AND seq > ?'),
};

export function headSeq(gameId: string): number {
  const row = q.headSeq.get(gameId) as { seq: number | null } | undefined;
  return row?.seq ?? -1;
}

export function getGame(gameId: string) {
  return q.game.get(gameId) as
    | { id: string; kind: string; seats: number; complete: number }
    | undefined;
}

export function playersOf(gameId: string) {
  return q.playersOf.all(gameId) as { seat: number; name: string; token: string }[];
}

export function playerByToken(token: string) {
  return q.playerByToken.get(token) as
    | { game_id: string; seat: number; name: string }
    | undefined;
}

/**
 * Create a game: roll the opening position once, store it in `setups`, and
 * write a seq-0 `game.created` marker so the action log has a defined start.
 * The marker carries no hidden information.
 */
export function createGame<S, Setup>(
  def: GameDefinition<S, Setup>,
  names: string[],
  options?: unknown,
) {
  const gameId = randomUUID();
  const now = new Date().toISOString();

  return transaction(() => {
    q.insertGame.run(gameId, def.kind, names.length, now);
    q.insertSetup.run(gameId, JSON.stringify(def.setup(names.length, options)));

    const tokens = names.map((name, seat) => {
      const token = randomUUID().replace(/-/g, '');
      q.insertPlayer.run(gameId, seat, name, token);
      return { seat, name, token };
    });

    q.insertAction.run(
      gameId,
      0,
      'game.created',
      null,
      JSON.stringify({ seats: names.length, kind: def.kind }),
      now,
    );

    return { gameId, players: tokens };
  });
}

/**
 * Rebuild state by folding actions over the stored setup. Starts from the
 * newest snapshot at or before `upTo`, so cost is bounded by SNAPSHOT_EVERY
 * rather than by game length. Results are identical with snapshots present
 * or absent — the replay test guards that equivalence.
 */
export function loadState<S, Setup>(
  def: GameDefinition<S, Setup>,
  gameId: string,
  upTo = Infinity,
): { state: S; seq: number } {
  const ceiling = upTo === Infinity ? Number.MAX_SAFE_INTEGER : upTo;
  const snap = q.latestSnapshot.get(gameId, ceiling) as
    | { seq: number; state: string }
    | undefined;

  let state: S;
  let from: number;

  if (snap) {
    state = JSON.parse(snap.state) as S;
    from = snap.seq;
  } else {
    const row = q.getSetup.get(gameId) as { data: string } | undefined;
    if (!row) throw new Error(`no setup for game ${gameId}`);
    state = def.init(JSON.parse(row.data) as Setup);
    from = 0;
  }

  for (const row of q.actionsFrom.all(gameId, from) as unknown as ActionRow[]) {
    if (row.seq > ceiling) break;
    state = def.reduce(structuredClone(state), rowToAction(row));
    from = row.seq;
  }

  return { state, seq: from };
}

/**
 * Append one action.
 *
 * `prevSeq` is the sequence number the client believed was current.
 * Mismatch means someone else acted first: reject with 409 and let the
 * client refetch. In async play this is routine, not exceptional.
 *
 * `prepare` runs first and may enrich the payload (dice). Then `reduce`
 * runs INSIDE the transaction, so an IllegalAction throw rolls back and
 * the action never lands.
 */
export function appendAction<S, Setup>(
  def: GameDefinition<S, Setup>,
  gameId: string,
  prevSeq: number,
  proposed: { type: string; actor: number | null; payload: unknown },
): { state: S; seq: number } {
  return transaction(() => {
    const head = headSeq(gameId);
    if (head !== prevSeq) throw new StaleSeq(head, prevSeq);

    const { state } = loadState(def, gameId);
    const payload = def.prepare ? def.prepare(state, proposed) : proposed.payload;

    const seq = head + 1;
    const action: GameAction = {
      gameId,
      seq,
      type: proposed.type,
      actor: proposed.actor,
      payload,
      createdAt: new Date().toISOString(),
    };

    // Throws IllegalAction -> transaction rolls back, nothing persisted.
    const next = def.reduce(structuredClone(state), action);

    q.insertAction.run(
      gameId,
      seq,
      action.type,
      action.actor,
      JSON.stringify(action.payload ?? {}),
      action.createdAt,
    );

    if (seq % SNAPSHOT_EVERY === 0) {
      q.putSnapshot.run(gameId, seq, JSON.stringify(next));
    }
    if (def.isComplete(next)) {
      q.markComplete.run(1, gameId);
    }

    return { state: next, seq };
  });
}

/**
 * Truncate the log back to `toSeq`. The async equivalent of "wait, back
 * up" — with a friendly group this is your dispute resolution mechanism,
 * and it is why the engine does not need to adjudicate card powers to be
 * trustworthy.
 */
export function rollback(gameId: string, toSeq: number): void {
  if (toSeq < 0) throw new Error('cannot roll back past game creation');
  transaction(() => {
    q.dropActionsAfter.run(gameId, toSeq);
    q.dropSnapshotsAfter.run(gameId, toSeq);
    q.markComplete.run(0, gameId);
  });
}

export function history(gameId: string): GameAction[] {
  return (q.actionsFrom.all(gameId, -1) as unknown as ActionRow[]).map(rowToAction);
}
