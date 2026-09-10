import express from 'express';
import { z } from 'zod';
import { cradle } from './engine/cradle.js';
import { oath } from './oath/game/index.js';
import { IllegalAction, StaleSeq, type GameDefinition } from './engine/types.js';
import {
  appendAction,
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
const DEFS: Record<string, GameDefinition<any>> = { cradle, oath };

export const router = express.Router();

function defFor(gameId: string) {
  const game = getGame(gameId);
  if (!game) return null;
  const def = DEFS[game.kind];
  if (!def) throw new Error(`no definition registered for kind ${game.kind}`);
  return { game, def };
}

/** Token in a header, not a query string, so it stays out of server logs. */
function seatOf(req: express.Request, gameId: string): number | null {
  const token = req.header('x-player-token');
  if (!token) return null;
  const p = playerByToken(token);
  if (!p || p.game_id !== gameId) return null;
  return p.seat;
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
  if (seat === null) return res.status(401).json({ error: 'missing or invalid player token' });

  const body = ActionBody.parse(req.body);
  const { state, seq } = appendAction(def, req.params.id, body.prevSeq, {
    type: body.type,
    actor: seat,
    payload: body.payload,
  });

  res.status(201).json({
    seq,
    complete: def.isComplete(state),
    view: def.project(state, seat),
    pending: def.pending(state),
  });
});

/**
 * The decision inbox. This endpoint is what a notification worker polls
 * and what a deep link resolves against.
 */
router.get('/inbox', (req, res) => {
  const token = req.header('x-player-token');
  if (!token) return res.status(401).json({ error: 'missing player token' });
  const p = playerByToken(token);
  if (!p) return res.status(401).json({ error: 'invalid player token' });

  const found = defFor(p.game_id);
  if (!found) return res.status(404).json({ error: 'no such game' });
  const { def } = found;
  const { state, seq } = loadState(def, p.game_id);

  res.json({
    gameId: p.game_id,
    seat: p.seat,
    seq,
    waitingOnYou: def.pending(state).filter((d) => d.seat === p.seat),
  });
});

router.get('/games/:id/history', (req, res) => {
  if (!getGame(req.params.id)) return res.status(404).json({ error: 'no such game' });
  res.json({ seq: headSeq(req.params.id), actions: history(req.params.id) });
});

/** Admin-only in any real deployment. Gate it before this leaves your LAN. */
router.post('/games/:id/rollback', (req, res) => {
  const found = defFor(req.params.id);
  if (!found) return res.status(404).json({ error: 'no such game' });
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
