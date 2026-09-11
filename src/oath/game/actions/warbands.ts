/**
 * `warbands.move` (unit 16b) — Law §6.5, "Move Warbands To/From Your Site",
 * plus the two permission actions its purple asides require. Without this,
 * a site can only ever be garrisoned as the spoils of a Campaign (unit 13's
 * `campaign.seize`), and warbands left on a site can never come home.
 *
 * All movement is at YOUR site (Glossary §10.30) — the site your pawn is
 * at. Four directions, from §6.5's three paragraphs:
 *
 *   toBoard — "You can move any number of your warbands, except the last
 *     one, from your site to your board." The exception is a real
 *     restriction, not a rounding note: at least one of YOUR warbands must
 *     stay, so a site you rule cannot be abandoned this way. (The Bandit
 *     Crown, §7.6.5, says "you can move the last of your physical warbands
 *     from your site" — a power that only means something because the base
 *     rule forbids it. Confirms the reading.)
 *     A CITIZEN needs the Chancellor's permission for this direction, and
 *     only this one.
 *
 *   toSite — "If you rule your site, you can move any number of warbands
 *     from your board to your site." Ruling is `rule.ts#rulersOf`, so
 *     §6.6.3's Imperial extension counts: a Citizen whose pawn is at a
 *     purple-garrisoned site rules it and may reinforce it. No permission.
 *
 *   give / take — "If you are an Imperial player, you may give any number
 *     of warbands to another Imperial player whose pawn is at your site,
 *     or you may take any number of warbands from them. Both of these
 *     actions require their permission." Board to board (Glossary "Take":
 *     from their board to yours; "Give": the reverse), between two
 *     Imperial players co-located at the actor's site. Permission comes
 *     from the OTHER player either way, including when you are handing
 *     warbands over — purple is a shared pool, so a gift is not always
 *     welcome.
 *
 * PERMISSION, when the Law requires it, is a logged round trip rather than
 * table talk: `warbands.move` records `state.warbandRequest` and
 * `warbands.allow` / `warbands.deny` resolve it. Two consequences worth
 * stating:
 *   - it does NOT lock the game (unlike a Campaign, like a Citizenship
 *     offer). The requester plays on, so the move is RE-VALIDATED at
 *     approval time — permission to move 3 warbands is not permission to
 *     move 3 warbands that are no longer there.
 *   - one at a time. A second permissioned move while one is pending is
 *     illegal-state, the same simplification `citizenship.offer` makes.
 * P3 folds this shape into standing responses.
 *
 * Unpermissioned directions (`toSite`, and `toBoard` for anyone who is not
 * a Citizen) apply immediately — the Law asks nobody, so neither do we.
 */

import { z } from 'zod';
import { IllegalAction, type GameAction } from '../../../engine/types.js';
import { applyEffects, type Effect } from '../effects.js';
import { chancellorSeatOf, rulersOf } from '../rule.js';
import type { OathState, WarbandRequest } from '../state.js';
import { requireActiveSeat, type Handler } from '../turn.js';

const MovePayloadSchema = z.object({
  direction: z.enum(['toBoard', 'toSite', 'give', 'take']),
  count: z.number().int().positive(),
  /** The other Imperial player, for `give`/`take` only. */
  target: z.number().int().min(0).optional(),
});

type Direction = z.infer<typeof MovePayloadSchema>['direction'];

function isImperial(state: OathState, seat: number): boolean {
  return state.players[seat].citizenship !== 'exile';
}

/**
 * Law §6.5's legality, checked identically whether the move applies now or
 * after permission arrives (see the file header on re-validation). Throws
 * on anything the Law forbids; returns the effects to apply.
 */
function moveEffects(
  state: OathState,
  seat: number,
  direction: Direction,
  count: number,
  target: number | null,
): Effect[] {
  const player = state.players[seat];
  const siteId = player.pawnSite;

  if (direction === 'toBoard' || direction === 'toSite') {
    if (target !== null) {
      throw new IllegalAction(`warbands.move: '${direction}' does not take a target seat`);
    }
    const site = state.sites.find((s) => s.id === siteId)!;
    if (direction === 'toBoard') {
      const here = site.warbands[seat];
      if (count > here - 1) {
        throw new IllegalAction(
          `warbands.move: you have ${here} warband(s) at your site and must leave one — ` +
            `at most ${Math.max(0, here - 1)} may come back to your board (Law §6.5)`,
        );
      }
      return [
        {
          kind: 'warbands',
          from: { kind: 'siteWarbands', siteId, seat },
          to: { kind: 'seatWarbandBoard', seat },
          amount: count,
        },
      ];
    }
    if (!rulersOf(state, siteId).includes(seat)) {
      throw new IllegalAction('warbands.move: you must rule your site to reinforce it (Law §6.5)');
    }
    return [
      {
        kind: 'warbands',
        from: { kind: 'seatWarbandBoard', seat },
        to: { kind: 'siteWarbands', siteId, seat },
        amount: count,
      },
    ];
  }

  // give / take — Law §6.5's Imperial paragraph.
  if (target === null) throw new IllegalAction(`warbands.move: '${direction}' needs a target seat`);
  if (target === seat) throw new IllegalAction('warbands.move: cannot give to or take from yourself');
  if (target < 0 || target >= state.seats) throw new IllegalAction('warbands.move: no such seat');
  if (!isImperial(state, seat) || !isImperial(state, target)) {
    throw new IllegalAction(
      'warbands.move: give/take is between two Imperial players (Law §6.5)',
    );
  }
  if (state.players[target].pawnSite !== siteId) {
    throw new IllegalAction("warbands.move: their pawn must be at your site (Law §6.5)");
  }
  const [from, to] =
    direction === 'give'
      ? [seat, target]
      : [target, seat];
  return [
    {
      kind: 'warbands',
      from: { kind: 'seatWarbandBoard', seat: from },
      to: { kind: 'seatWarbandBoard', seat: to },
      amount: count,
    },
  ];
}

/** Whose permission Law §6.5 requires, or null when it asks nobody. */
function approverFor(
  state: OathState,
  seat: number,
  direction: Direction,
  target: number | null,
): number | null {
  if (direction === 'give' || direction === 'take') return target;
  // "If you are a Citizen, the Chancellor must give you permission to move
  // warbands from your site to your board." Only Citizens, only toBoard.
  if (direction === 'toBoard' && state.players[seat].citizenship === 'citizen') {
    return chancellorSeatOf(state);
  }
  return null;
}

function move(state: OathState, action: GameAction): OathState {
  const seat = requireActiveSeat(state, action);
  const parsed = MovePayloadSchema.safeParse(action.payload);
  if (!parsed.success) throw new IllegalAction('warbands.move: malformed payload');
  const { direction, count } = parsed.data;
  const target = parsed.data.target ?? null;

  // Validate up front even when permission is needed, so an illegal move is
  // rejected at the asker rather than wasting the approver's round trip.
  const effects = moveEffects(state, seat, direction, count, target);

  const approver = approverFor(state, seat, direction, target);
  if (approver === null) return applyEffects(state, seat, effects);

  if (state.warbandRequest) {
    throw new IllegalAction('warbands.move: a warband permission request is already pending');
  }
  const working = applyEffects(state, seat, []); // clone, same idiom as campaign.ts
  const request: WarbandRequest = {
    seat,
    approver,
    direction: direction as WarbandRequest['direction'],
    count,
    target,
    requestedAt: working.actionCount,
  };
  working.warbandRequest = request;
  return working;
}

function requirePendingRequest(state: OathState, action: GameAction): WarbandRequest {
  if (state.complete) throw new IllegalAction(`${action.type}: the game is already complete`);
  const request = state.warbandRequest;
  if (!request) throw new IllegalAction(`${action.type}: no warband permission is pending`);
  if (action.actor !== request.approver) {
    throw new IllegalAction(
      `${action.type}: only seat ${request.approver} may answer this request (Law §6.5)`,
    );
  }
  return request;
}

function allow(state: OathState, action: GameAction): OathState {
  const request = requirePendingRequest(state, action);
  // Re-validated, not replayed: the request has not locked the game, so the
  // warbands it names may have moved or died since it was made.
  const effects = moveEffects(state, request.seat, request.direction, request.count, request.target);
  const working = applyEffects(state, request.seat, effects);
  working.warbandRequest = null;
  return working;
}

function deny(state: OathState, action: GameAction): OathState {
  requirePendingRequest(state, action);
  const working = applyEffects(state, action.actor!, []);
  working.warbandRequest = null;
  return working;
}

export const WARBAND_HANDLERS: Record<string, Handler> = {
  'warbands.move': move,
  'warbands.allow': allow,
  'warbands.deny': deny,
};
