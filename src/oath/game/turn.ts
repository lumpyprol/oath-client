/**
 * Turn skeleton (unit 5): who acts, how a turn passes, and Rest. This is
 * the phase's chassis — `reduce` (assembled in index.ts) dispatches on
 * `action.type` through the `Handler` map this module contributes to;
 * later units (6+) register their own action handlers additively, never
 * editing this file's dispatch entries.
 *
 * Turn order (Law §4): "starting with the Chancellor and going clockwise,
 * each player takes one turn." Seats are already numbered in that
 * clockwise order by convention (seat 0 = Chancellor), so advancing
 * `activeSeat` is just `(activeSeat + 1) % seats`; wrapping back to 0 ends
 * the round (Law §4: "once each player has taken a turn, the round ends").
 *
 * 'turn.rest' is the only action this unit registers besides the inert
 * 'game.created' marker (never actually replayed through `reduce` — see
 * `actionlog.ts#loadState`, which folds from seq 0's `init()` output, not
 * through the marker — registered anyway per the plan, as cheap insurance
 * against a future fold path that does include it).
 *
 * Rest resolves Law §4.3.1-4.3.4 in order (4.3.5 "Use Rest Powers" is a
 * no-op: no denizen powers exist yet, registry ships empty through P2):
 *
 *   4.3.1 Return Favor  — favor on any denizen/edifice (at a site OR as an
 *         adviser) returns to the matching suit's favor bank.
 *   4.3.2 Return Secrets — the resting player's own facedown secrets flip
 *         back up. Secrets on the resting player's OWN adviser cards
 *         return to their board. NOT swept: secrets on SITE cards, because
 *         Law §4.3.2 returns them to "your board" and nothing in state
 *         tracks WHICH seat placed a given token on a shared site card
 *         (only unit 3's `siteCardSecrets` zone exists, with no owner
 *         field) — that ownership question is unit 14/15's to answer, once
 *         `power.use` is what actually places such tokens. Currently
 *         unreachable in any case: no action yet exists that could put a
 *         secret on a site card.
 *   4.3.3 Refresh Supply — Exile/Chancellor: move to the space matching
 *         their warband bank (RULINGS.md: Chancellor 18+/17-11/10-4/3-0 ->
 *         6/5/4/3; Exile 9+/8-4/3-0 -> 6/5/4). Citizen: copy the
 *         Chancellor's CURRENT Supply outright, ignoring their own bank.
 *   4.3.4 Save Supply — add back Supply not spent this turn, capped at the
 *         leftmost space (7, both seats — RULINGS.md). No action costs
 *         Supply yet (units 6+), so "not spent this turn" is simply the
 *         player's Supply value coming into this Rest call; the unit that
 *         adds the first Supply-costing action must start tracking
 *         "Supply at turn start" explicitly and revisit this computation.
 */

import { byId } from '../cards/index.js';
import { IllegalAction, type GameAction } from '../../engine/types.js';
import { LEFTMOST_SUPPLY, type Citizenship, type OathState } from './state.js';

export type Handler = (state: OathState, action: GameAction) => OathState;

function requireActiveSeat(state: OathState, action: GameAction): number {
  if (state.complete) throw new IllegalAction(`${action.type}: the game is already complete`);
  if (action.actor === null) throw new IllegalAction(`${action.type} requires a seated actor`);
  if (action.actor !== state.turn.activeSeat) {
    throw new IllegalAction(`${action.type}: it is not seat ${action.actor}'s turn`);
  }
  return action.actor;
}

/** Law §4.3.1: favor on a denizen/edifice returns to its suit's bank. */
function returnCardFavor(state: OathState): void {
  const returnOne = (card: { id: string; favor: number } | null) => {
    if (!card || card.favor === 0) return;
    const resolved = byId(card.id);
    if ('suit' in resolved) {
      state.favorBanks[resolved.suit] += card.favor;
      card.favor = 0;
    }
  };
  for (const site of state.sites) for (const card of site.cards) returnOne(card);
  for (const player of state.players) for (const adviser of player.advisers) returnOne(adviser);
}

/** Law §4.3.2 (partial — see file header): the resting seat's own adviser secrets. */
function returnOwnAdviserSecrets(state: OathState, seat: number): void {
  const player = state.players[seat];
  for (const adviser of player.advisers) {
    if (adviser.secrets > 0) {
      player.secrets.ready += adviser.secrets;
      adviser.secrets = 0;
    }
  }
}

/** Law §4.3.3: the warband-bracket Rest-refresh table (RULINGS.md). */
function refreshTarget(citizenship: Citizenship, bank: number): number {
  if (citizenship === 'chancellor') {
    if (bank >= 18) return 6;
    if (bank >= 11) return 5;
    if (bank >= 4) return 4;
    return 3;
  }
  // Exile and Citizen share the Exile bracket table when they DO consult
  // their own bank — but a Citizen never does (see rest() below).
  if (bank >= 9) return 6;
  if (bank >= 4) return 5;
  return 4;
}

function rest(state: OathState, action: GameAction): OathState {
  const seat = requireActiveSeat(state, action);
  const player = state.players[seat];

  returnCardFavor(state); // Law §4.3.1
  returnOwnAdviserSecrets(state, seat); // Law §4.3.2 (adviser secrets)
  player.secrets.ready += player.secrets.flipped; // Law §4.3.2 (flip up)
  player.secrets.flipped = 0;

  const notSpentThisTurn = player.supply; // see file header: no spending action exists yet
  const target =
    player.citizenship === 'citizen'
      ? state.players[0].supply // Law §4.3.3: copies the Chancellor outright
      : refreshTarget(player.citizenship, player.warbands.bank);
  player.supply = Math.min(LEFTMOST_SUPPLY, target + notSpentThisTurn); // Law §4.3.4

  state.turn.activeSeat = (state.turn.activeSeat + 1) % state.seats;
  if (state.turn.activeSeat === 0) state.turn.round += 1; // Law §4: round ends
  state.turn.turnStartedAt = state.actionCount;

  return state;
}

export const TURN_HANDLERS: Record<string, Handler> = {
  'game.created': (state) => state,
  'turn.rest': rest,
};

/** The stable id convention every pending-decision kind shares (unit 5). */
export function turnPendingId(state: OathState): string {
  return `turn:${state.turn.activeSeat}:${state.turn.turnStartedAt}`;
}
