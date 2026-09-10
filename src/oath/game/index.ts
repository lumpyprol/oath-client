/**
 * Assembles the `oath` `GameDefinition` (unit 5). This is the ONE place
 * that combines every action module's handlers into the dispatch table —
 * modules contribute handlers, this file is the only one that merges them.
 * Later units add their own `*_HANDLERS` map here, additively; nothing
 * here edits another unit's entries (per the plan's dispatch-table
 * convention).
 */

import type { GameDefinition } from '../../engine/types.js';
import { IllegalAction } from '../../engine/types.js';
import { FIRST_GAME, init, oathSetup, type OathSetup } from './setup.js';
import type { OathState } from './state.js';
import { TURN_HANDLERS, turnPendingId, type Handler } from './turn.js';
import { PLAY_HANDLERS } from './actions/play.js';
import { MUSTER_HANDLERS } from './actions/muster.js';
import { TRADE_HANDLERS } from './actions/trade.js';
import { TRAVEL_HANDLERS } from './actions/travel.js';
import { project } from './project.js';

// Additive: each action module contributes its own `*_HANDLERS` map; this
// is the only place they're merged.
const HANDLERS: Record<string, Handler> = {
  ...TURN_HANDLERS,
  ...PLAY_HANDLERS,
  ...MUSTER_HANDLERS,
  ...TRADE_HANDLERS,
  ...TRAVEL_HANDLERS,
};

/** Action types a client may actually submit — 'game.created' is a marker, never one of them. */
const RESOLVABLE_TYPES = Object.keys(HANDLERS).filter((t) => t !== 'game.created');

export const oath: GameDefinition<OathState, OathSetup> = {
  kind: 'oath',

  setup(seats, options) {
    return oathSetup(seats, options);
  },

  init(setup) {
    return init(setup);
  },

  reduce(state, action) {
    const handler = HANDLERS[action.type];
    if (!handler) throw new IllegalAction(`unknown action: ${action.type}`);
    // Every handler's actionCount bump happens exactly once, here — not
    // per-handler — and BEFORE dispatch, so a handler that starts a new
    // turn (turn.rest) can stamp `turn.turnStartedAt` from the same value
    // this action will be remembered by.
    state.actionCount += 1;
    return handler(state, action);
  },

  project(state, seat) {
    return project(state, seat);
  },

  pending(state) {
    if (state.complete) return [];
    return [
      {
        id: turnPendingId(state),
        seat: state.turn.activeSeat,
        kind: 'turn',
        prompt: `It is seat ${state.turn.activeSeat}'s turn (round ${state.turn.round}).`,
        resolves: RESOLVABLE_TYPES,
      },
    ];
  },

  isComplete(state) {
    return state.complete;
  },
};

export { FIRST_GAME };
