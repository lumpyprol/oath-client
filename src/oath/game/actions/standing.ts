/**
 * `standing.set` (P3 unit 6; HLD D52) — write this seat's standing-response
 * policy. See `../standing.ts` for the machinery that consults it and for
 * the invariant that makes the whole thing replay-safe.
 *
 * ---- WHY THIS ACTION DOES NOT CALL `requireActiveSeat` ------------------
 *
 * It is the ONE action legal outside your own turn and outside a Campaign's
 * locks, and that is deliberate rather than an oversight, because it is the
 * one action that:
 *
 *   - resolves no pending decision (it is not an answer to anything), and
 *   - touches no game object — no warband, favor, card, site or title
 *     moves; nothing another player could be mid-decision about changes.
 *
 * Gating it on `requireActiveSeat` would make the feature useless in exactly
 * the case it exists for: you set `ally: 'pass'` BECAUSE you do not want to
 * be woken during someone else's turn, and their turn is precisely when you
 * would have to set it. A player who has just been asked a question they
 * never want asked again must be able to answer it and suppress the next
 * one in the same sitting.
 *
 * So it gets its own guard: a real seat, and the game still running (the
 * latter enforced centrally in `index.ts#reduce`). Note what it still
 * cannot do — a policy written now never retroactively answers a decision
 * already raised. Revocation and adoption both bind FUTURE raises only,
 * which is what keeps a pending decision's meaning stable while someone is
 * looking at it.
 */

import { z } from 'zod';
import { IllegalAction, type GameAction } from '../../../engine/types.js';
import { STANDING_CHANNELS, type OathState } from '../state.js';
import type { Handler } from '../turn.js';

/**
 * A PARTIAL policy, merged into the seat's current one — so a client can
 * flip one channel without having to restate the others (and without
 * racing a change it did not know about).
 */
const StandingSetPayloadSchema = z
  .object({
    defense: z.enum(STANDING_CHANNELS.defense).optional(),
    ally: z.enum(STANDING_CHANNELS.ally).optional(),
    warbands: z.enum(STANDING_CHANNELS.warbands).optional(),
  })
  .strict();

function set(state: OathState, action: GameAction): OathState {
  // The guard, in full — deliberately NOT requireActiveSeat (see header).
  if (action.actor === null) throw new IllegalAction('standing.set requires a seated actor');
  if (action.actor < 0 || action.actor >= state.seats) {
    throw new IllegalAction('standing.set: no such seat');
  }
  const parsed = StandingSetPayloadSchema.safeParse(action.payload ?? {});
  if (!parsed.success) throw new IllegalAction('standing.set: malformed payload');

  const player = state.players[action.actor];
  player.standing = { ...player.standing, ...parsed.data };
  return state;
}

export const STANDING_HANDLERS: Record<string, Handler> = {
  'standing.set': set,
};
