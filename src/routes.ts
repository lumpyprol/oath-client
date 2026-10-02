import express from 'express';
import { z } from 'zod';
import { timingSafeEqual } from 'node:crypto';
import { sessionFromRequest } from './session.js';
import { oath } from './oath/game/index.js';
import { IllegalAction, StaleSeq, type GameDefinition } from './engine/types.js';
import {
  actionAt,
  appendAction,
  dryRunAction,
  createGame,
  getGame,
  headSeq,
  history,
  loadState,
  playerByToken,
  playersOf,
  rollback,
} from './actionlog.js';

/** Add real game definitions here as they arrive. */
const DEFS: Record<string, GameDefinition<any>> = { oath };

export const router = express.Router();

function defFor(gameId: string) {
  const game = getGame(gameId);
  if (!game) return null;
  const def = DEFS[game.kind];
  if (!def) throw new Error(`no definition registered for kind ${game.kind}`);
  return { game, def };
}

/**
 * Which seat is making this request, for `gameId` — or null.
 *
 * Resolution order (P4 unit 8): the `x-player-token` HEADER first, so the
 * JSON API, the smoke script and P6's worker keep working exactly as
 * before; then the browser's signed session COOKIE. A cookie is honoured
 * only for the game it was minted for — a session for game A grants nothing
 * on game B.
 */
function seatOf(req: express.Request, gameId: string): number | null {
  const token = req.header('x-player-token');
  if (token) {
    const p = playerByToken(token);
    if (p && p.game_id === gameId) return p.seat;
    return null; // a header was presented but is wrong — do not fall through
  }
  const session = sessionFromRequest(req.header('cookie'));
  if (session && session.gameId === gameId) return session.seat;
  return null;
}

/**
 * The configured admin secret (P4 unit 8), or null when unset — in which
 * case admin-only routes are simply unavailable rather than open.
 */
const ADMIN_TOKEN = process.env.ADMIN_TOKEN && process.env.ADMIN_TOKEN.length > 0 ? process.env.ADMIN_TOKEN : null;

/**
 * Constant-time check that this request carries the admin secret. Accepts
 * it in the `x-admin-token` header (API), the `?token=` query (the admin
 * page link), or the `token` form field (the admin page's POST, whose
 * hidden input carries it forward) — a browser form can set none of the
 * other two.
 */
export function isAdmin(req: express.Request): boolean {
  if (ADMIN_TOKEN === null) return false;
  const presented =
    req.header('x-admin-token') ??
    (typeof req.query.token === 'string' ? req.query.token : undefined) ??
    (typeof req.body?.token === 'string' ? req.body.token : '');
  const a = Buffer.from(presented);
  const b = Buffer.from(ADMIN_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

const CreateBody = z.object({
  kind: z.string().default('cradle'),
  players: z.array(z.string().min(1)).min(2).max(6),
  /** Kind-specific, opaque to the store (HLD D31) — e.g. Oath's chronicle seed. */
  options: z.unknown().optional(),
});

router.post('/games', (req, res) => {
  const body = CreateBody.parse(req.body);
  const def = DEFS[body.kind];
  if (!def) return res.status(400).json({ error: `unknown kind ${body.kind}` });
  const { gameId, players } = createGame(def, body.players, body.options);
  // Tokens are returned exactly once, at creation. Hand them out privately.
  res.status(201).json({ gameId, kind: body.kind, players });
});

router.get('/games/:id', (req, res) => {
  const found = defFor(req.params.id);
  if (!found) return res.status(404).json({ error: 'no such game' });
  const { def } = found;
  const seat = seatOf(req, req.params.id);
  const { state, seq } = loadState(def, req.params.id);
  res.json({
    gameId: req.params.id,
    seq,
    seat,
    complete: def.isComplete(state),
    view: def.project(state, seat),
    pending: def.pending(state),
    // P4 unit 4 (D56): what this seat may offer, computed for the
    // REQUESTING seat only — omitted for a spectator, who submits nothing.
    ...(seat === null ? {} : { affordances: def.affordances?.(state, seat) }),
    players: playersOf(req.params.id).map(({ seat, name }) => ({ seat, name })),
  });
});

const ActionBody = z.object({
  prevSeq: z.number().int().min(0),
  type: z.string().min(1),
  payload: z.unknown().default({}),
});

router.post('/games/:id/actions', (req, res) => {
  const found = defFor(req.params.id);
  if (!found) return res.status(404).json({ error: 'no such game' });
  const { def } = found;
  const seat = seatOf(req, req.params.id);
  // Auth is identical for a dry run — it must not be a way to probe another
  // seat's options (unit 7).
  if (seat === null) return res.status(401).json({ error: 'missing or invalid player token' });

  const body = ActionBody.parse(req.body);
  const proposed = { type: body.type, actor: seat, payload: body.payload };

  // A DRY RUN (unit 7): validate + preview, writing nothing. Same auth, same
  // prepare()+reduce(), and — because it throws the same IllegalAction /
  // StaleSeq into the shared error middleware — byte-identical 400/409
  // bodies to a real submit.
  //
  // WHY THE DISCARDED DICE WERE NEVER A RANDOMNESS LEAK (and are now not even
  // returned — see below): prepare() rolls at
  // append time (D14), so a dry run rolls dice that will never be the real
  // ones. Each roll is independent — nothing about a discarded roll
  // constrains the next (no shared PRNG state is persisted; a real submit
  // rolls afresh) — so seeing a preview roll tells a client nothing about
  // what the real submit will roll. Those fields are returned in
  // `speculative` precisely so a client renders them as a preview, never a
  // result.
  if (req.query.dryRun !== undefined) {
    const { state, seq, speculative } = dryRunAction(def, req.params.id, body.prevSeq, proposed);
    // A dry run that rolled dice returns NO outcome — no view, pending or
    // affordances, which would all carry the throwaway roll. Each roll is
    // independent, so a preview never predicted the real one; but showing it
    // invites re-checking until a "good" roll appears (Ben, unit 11). The
    // verdict (accepted) and the names of the dice fields remain.
    if (speculative.length > 0) {
      return res.status(200).json({ dryRun: true, seq, rollsDice: true, speculative });
    }
    return res.status(200).json({
      dryRun: true,
      seq, // the seq this WOULD have been; the log is unchanged
      complete: def.isComplete(state),
      view: def.project(state, seat),
      pending: def.pending(state),
      affordances: def.affordances?.(state, seat),
      speculative,
    });
  }

  const { state, seq } = appendAction(def, req.params.id, body.prevSeq, proposed);

  res.status(201).json({
    seq,
    complete: def.isComplete(state),
    view: def.project(state, seat),
    pending: def.pending(state),
  });
});

/**
 * Unit 2 (Phase 3): a decision id's anchor is an `actionCount`; the
 * wall-clock moment it arose is that action's own `createdAt`. `since` and
 * `url` are transport concerns, attached here — the ENGINE's
 * `PendingDecision` type never changes to carry them (a deliberate D49
 * line: interrupts stay ordinary, and wall-clock/routing data belongs to
 * the HTTP layer, not the rules engine).
 */
function sinceOf(gameId: string, decisionId: string): string | null {
  const anchor = Number(decisionId.split(':').pop());
  return actionAt(gameId, anchor)?.createdAt ?? null;
}

function urlFor(gameId: string, decisionId: string): string {
  return `/games/${gameId}/decisions/${decisionId}`;
}

/**
 * The decision inbox for one seat, split into what is waiting on THEM and
 * what the game is waiting on from others (so a client can show why nothing
 * is moving). The single source of this logic — the JSON `/inbox` route and
 * the HTML inbox page (unit 9) both call it, rather than each computing it.
 * Returns null if the game does not exist.
 */
export function buildInbox(gameId: string, seat: number) {
  const found = defFor(gameId);
  if (!found) return null;
  const { def } = found;
  const { state, seq } = loadState(def, gameId);
  const decorate = (d: import('./engine/types.js').PendingDecision) => ({
    ...d,
    since: sinceOf(gameId, d.id),
    url: urlFor(gameId, d.id),
  });
  const pending = def.pending(state);
  return {
    seq,
    waitingOnYou: pending.filter((d) => d.seat === seat).map(decorate),
    waitingOnOthers: pending.filter((d) => d.seat !== seat).map(decorate),
  };
}

/**
 * The projected view a `seat` (or a spectator, `seat === null`) may see for
 * `gameId`, plus the seat names for labelling — the single loader the HTML
 * board page (P4 unit 10) builds its model from. Redaction is entirely
 * project()'s job; this only wires it to the store. Returns null if the game
 * does not exist.
 */
export function buildBoard(gameId: string, seat: number | null) {
  const found = defFor(gameId);
  if (!found) return null;
  const { def } = found;
  const { state, seq } = loadState(def, gameId);
  const names: string[] = [];
  for (const { seat: s, name } of playersOf(gameId)) names[s] = name;
  return {
    seq,
    view: def.project(state, seat),
    names,
    // P4 unit 11: what this seat may compose — the same affordances the JSON
    // API serves, for the requesting seat only. A spectator composes nothing.
    affordances: seat === null ? [] : (def.affordances?.(state, seat) ?? []),
  };
}

/**
 * Submit a composed action (P4 unit 11) through the SAME store path the JSON
 * API's POST /games/:id/actions uses — `appendAction`, or `dryRunAction` for
 * a "check this" — so a form can never take a route the API cannot. Throws
 * the same StaleSeq / IllegalAction; the HTML route decides how to show them.
 * Returns null if the game does not exist.
 */
export function submitComposed(
  gameId: string,
  seat: number,
  action: { prevSeq: number; type: string; payload: unknown; dryRun: boolean },
) {
  const found = defFor(gameId);
  if (!found) return null;
  const { def } = found;
  const proposed = { type: action.type, actor: seat, payload: action.payload };
  if (action.dryRun) {
    const { state, seq, speculative } = dryRunAction(def, gameId, action.prevSeq, proposed);
    return { dryRun: true as const, seq, view: def.project(state, seat), speculative };
  }
  const { seq } = appendAction(def, gameId, action.prevSeq, proposed);
  return { dryRun: false as const, seq };
}

/** Legal shape of every id `pending()` mints: `` `${kind-prefix}:${seat}:${anchor}` ``. */
const DECISION_ID_RE = /^[a-zA-Z]+(?:-[a-zA-Z]+)*:\d+:\d+$/;

/**
 * Resolve a decision id — the URL a notification will carry (P6) and a
 * client will open (P4). A stale deep link (the decision was resolved or
 * rolled back away) lands the player on a useful 410, never an error page.
 */
router.get('/games/:id/decisions/:decisionId', (req, res) => {
  const { id: gameId, decisionId } = req.params;
  if (!DECISION_ID_RE.test(decisionId)) {
    return res.status(400).json({ error: 'malformed decision id' });
  }

  const found = defFor(gameId);
  if (!found) return res.status(404).json({ error: 'no such game' });
  const { def } = found;

  // Any seat in this game may open a link about someone else's decision —
  // they see the public framing of it (`yours: false`).
  const seat = seatOf(req, gameId);
  if (seat === null) return res.status(401).json({ error: 'missing or invalid player token' });

  const { state, seq } = loadState(def, gameId);
  const pending = def.pending(state);
  const decision = pending.find((d) => d.id === decisionId);

  if (!decision) {
    return res.status(410).json({ gone: true, seq, waitingOnYou: pending.filter((d) => d.seat === seat) });
  }

  res.json({
    gameId,
    seq,
    decision,
    yours: decision.seat === seat,
    view: def.project(state, seat),
    since: sinceOf(gameId, decisionId),
  });
});

/**
 * The decision inbox. This endpoint is what a notification worker polls
 * and what a deep link resolves against.
 */
router.get('/inbox', (req, res) => {
  // Header-only auth: this is what a notification worker (P6) polls.
  const token = req.header('x-player-token');
  if (!token) return res.status(401).json({ error: 'missing player token' });
  const p = playerByToken(token);
  if (!p) return res.status(401).json({ error: 'invalid player token' });

  const inbox = buildInbox(p.game_id, p.seat);
  if (!inbox) return res.status(404).json({ error: 'no such game' });
  res.json({ gameId: p.game_id, seat: p.seat, seq: inbox.seq, waitingOnYou: inbox.waitingOnYou });
});

router.get('/games/:id/history', (req, res) => {
  if (!getGame(req.params.id)) return res.status(404).json({ error: 'no such game' });
  res.json({ seq: headSeq(req.params.id), actions: history(req.params.id) });
});

/**
 * Rollback (P4 unit 8 closed the hole): the async group's dispute-
 * resolution tool. Gated on a seat IN THIS GAME (any player may rewind
 * their own table) OR the admin token. Until this unit it had NO auth at
 * all and was reachable on oath-async.fly.dev — the exploit is now a test.
 */
router.post('/games/:id/rollback', (req, res) => {
  const found = defFor(req.params.id);
  if (!found) return res.status(404).json({ error: 'no such game' });
  if (seatOf(req, req.params.id) === null && !isAdmin(req)) {
    return res.status(401).json({ error: 'rollback requires a player in this game or the admin token' });
  }
  const toSeq = z.number().int().min(0).parse(req.body?.toSeq);
  rollback(req.params.id, toSeq);
  const { state, seq } = loadState(found.def, req.params.id);
  res.json({ seq, view: found.def.project(state, null) });
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
router.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof StaleSeq) {
    return res.status(409).json({ error: err.message, expected: err.expected });
  }
  if (err instanceof IllegalAction) {
    return res.status(400).json({ error: err.message });
  }
  if (err?.name === 'ZodError') {
    return res.status(400).json({ error: 'bad request', issues: err.issues });
  }
  console.error(err);
  res.status(500).json({ error: 'internal error' });
});
