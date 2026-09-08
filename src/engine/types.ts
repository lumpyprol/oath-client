/**
 * Core contracts for the append-only game engine.
 *
 * The whole design rests on one invariant: `reduce` is PURE. Same
 * (state, action) always yields the same next state. It runs once when the
 * action is submitted and again on every replay — after a restart, folding
 * from a snapshot, or recomputing after a rollback. If it can produce a
 * different answer on the second run, the game silently changes under you.
 *
 * So randomness never happens inside a reducer. It happens in exactly two
 * places, both of which persist their results:
 *
 *   setup()    once per game, at creation. The shuffled deck order is stored
 *              explicitly in the `setups` table, which is never served over
 *              the API — so the action log stays safe to hand around.
 *   prepare()  once per action, at append time. Rolls dice and folds the
 *              results into the payload before it is written.
 *
 * `prepare` exists so the storage layer never needs to know which action
 * types involve dice. That knowledge stays here, with the rules.
 */

export interface GameAction<P = unknown> {
  gameId: string;
  /** 0 is always the `game.created` action. Monotonic, no gaps. */
  seq: number;
  type: string;
  /** Seat of the acting player, or null for system actions. */
  actor: number | null;
  /** Whatever `prepare` returned, or the client's payload if it didn't. */
  payload: P;
  createdAt: string;
}

/** An action not yet assigned a sequence number — what `prepare` sees. */
export interface ProposedAction {
  type: string;
  actor: number | null;
  payload: unknown;
}

/**
 * A decision the game is waiting on. Deliberately first-class: it drives
 * "whose turn is it", notifications, and deep links. In an async game those
 * are the difference between finishing and not.
 */
export interface PendingDecision {
  /** Stable id so notifications can be deduplicated across polls. */
  id: string;
  seat: number;
  kind: string;
  prompt: string;
  /** Action types that would resolve this decision. */
  resolves: string[];
}

export interface GameDefinition<S, Setup = unknown> {
  kind: string;

  /**
   * Decide everything random about the opening position: deck order, any
   * randomized assignments. Called once, at creation. May use real
   * randomness; the result is persisted verbatim.
   */
  setup(seats: number): Setup;

  /** Build the opening state from that setup. Must be pure. */
  init(setup: Setup): S;

  /**
   * Optional impure hook, run once at append time, before `reduce`. Returns
   * the payload to persist. Use it to roll dice — results go into the log,
   * so replay reuses them instead of re-rolling. Throwing `IllegalAction`
   * here rejects the action before anything is written.
   */
  prepare?(state: S, proposed: ProposedAction): unknown;

  /**
   * Apply one action. Receives a private deep clone of `state`, so mutating
   * and returning it is fine and usually clearer than spreading.
   * Must be pure. Throw `IllegalAction` to reject.
   */
  reduce(state: S, action: GameAction): S;

  /**
   * Redact state for one seat. `seat === null` means spectator.
   * Hidden information is enforced here, server-side, never in the client.
   */
  project(state: S, seat: number | null): unknown;

  /** Everything the game is currently waiting on. */
  pending(state: S): PendingDecision[];

  /** True once the game is over and no further actions are accepted. */
  isComplete(state: S): boolean;
}

export class IllegalAction extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'IllegalAction';
  }
}

/**
 * Thrown when a client submits an action computed against stale state.
 * Expected and routine in async play: the client refetches and retries.
 */
export class StaleSeq extends Error {
  readonly status = 409;
  constructor(readonly expected: number, readonly got: number) {
    super(`stale prevSeq: game is at ${expected}, action assumed ${got}`);
    this.name = 'StaleSeq';
  }
}
