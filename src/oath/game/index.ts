/**
 * Assembles the `oath` `GameDefinition` (unit 5). This is the ONE place
 * that combines every action module's handlers into the dispatch table —
 * modules contribute handlers, this file is the only one that merges them.
 * Later units add their own `*_HANDLERS` map here, additively; nothing
 * here edits another unit's entries (per the plan's dispatch-table
 * convention).
 */

import type { GameDefinition, ProposedAction } from '../../engine/types.js';
import { IllegalAction } from '../../engine/types.js';
import { FIRST_GAME, init, oathSetup, type OathSetup } from './setup.js';
import type { OathState } from './state.js';
import { TURN_HANDLERS, turnPendingId, type Handler } from './turn.js';
import { PLAY_HANDLERS } from './actions/play.js';
import { MUSTER_HANDLERS } from './actions/muster.js';
import { TRADE_HANDLERS } from './actions/trade.js';
import { TRAVEL_HANDLERS } from './actions/travel.js';
import { SEARCH_HANDLERS } from './actions/search.js';
import { RECOVER_HANDLERS } from './actions/recover.js';
import { CAMPAIGN_HANDLERS, prepareCampaign } from './actions/campaign.js';
import { project } from './project.js';

// Additive: each action module contributes its own `*_HANDLERS` map; this
// is the only place they're merged.
const HANDLERS: Record<string, Handler> = {
  ...TURN_HANDLERS,
  ...PLAY_HANDLERS,
  ...MUSTER_HANDLERS,
  ...TRADE_HANDLERS,
  ...TRAVEL_HANDLERS,
  ...SEARCH_HANDLERS,
  ...RECOVER_HANDLERS,
  ...CAMPAIGN_HANDLERS,
};

/**
 * Additive, same pattern as `HANDLERS`: any action type needing `prepare()`
 * (HLD D14 — dice roll here, at append time, never in `reduce`) registers a
 * function here. Only `campaign.roll` needs one so far.
 */
const PREPARE: Record<string, (state: OathState, proposed: ProposedAction) => unknown> = {
  'campaign.roll': prepareCampaign,
};

/** Action types a client may actually submit — 'game.created' is a marker, never one of them. */
const RESOLVABLE_TYPES = Object.keys(HANDLERS).filter((t) => t !== 'game.created');
/** Mid-Search, the ONLY legal action is resolving the drawn cards (Law §5.1.4). */
const PLAY_TYPES = ['card.play'];

export const oath: GameDefinition<OathState, OathSetup> = {
  kind: 'oath',

  setup(seats, options) {
    return oathSetup(seats, options);
  },

  init(setup) {
    return init(setup);
  },

  prepare(state, proposed) {
    const fn = PREPARE[proposed.type];
    return fn ? fn(state, proposed) : proposed.payload;
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
    // A Campaign (unit 12) preempts the normal turn decision entirely —
    // whose move it is depends on the campaign's phase, not activeSeat.
    if (state.campaign) {
      const c = state.campaign;
      if (c.phase === 'respond') {
        return [
          {
            id: `campaign:${c.defenderSeat}:${c.declaredAt}`,
            seat: c.defenderSeat as number, // numeric here — bandits skip this phase
            kind: 'campaign',
            prompt: `Seat ${c.attackerSeat} declared a Campaign against you — respond to close the window (Law §5.5.3).`,
            resolves: ['campaign.respond'],
          },
        ];
      }
      if (c.phase === 'roll') {
        return [
          {
            id: `campaign:${c.attackerSeat}:${c.declaredAt}`,
            seat: c.attackerSeat,
            kind: 'campaign',
            prompt: `Roll your Campaign's dice: ${c.attackDice} attack, ${c.defenseDice} defense (Law §5.5.4-5.5.5).`,
            resolves: ['campaign.roll'],
          },
        ];
      }
      if (c.phase === 'rolled') {
        return [
          {
            id: `campaign:${c.attackerSeat}:${c.declaredAt}`,
            seat: c.attackerSeat,
            kind: 'campaign',
            prompt: `Resolve your Campaign's outcome (Law §5.5.5-5.5.6).`,
            resolves: ['campaign.resolve'],
          },
        ];
      }
      // phase 'seize': a win — the attacker's remaining choices (Law §5.5.7).
      return [
        {
          id: `campaign:${c.attackerSeat}:${c.declaredAt}`,
          seat: c.attackerSeat,
          kind: 'campaign',
          prompt: `You are victorious — place warbands, and banish/burn if you targeted their pawn (Law §5.5.7).`,
          resolves: ['campaign.seize'],
        },
      ];
    }
    const seat = state.turn.activeSeat;
    const player = state.players[seat];
    if (player.hand.length > 0) {
      // A Search is mid-flight — the drawn cards must be resolved before
      // anything else (Law §5.1.4). Id stamped with the actionCount at
      // the draw, so it's stable across polls and distinct per Search.
      return [
        {
          id: `play:${seat}:${player.handDrawnAt}`,
          seat,
          kind: 'play',
          prompt: `Play or discard your drawn card(s) (${player.hand.length} in hand).`,
          resolves: PLAY_TYPES,
        },
      ];
    }
    return [
      {
        id: turnPendingId(state),
        seat,
        kind: 'turn',
        prompt: `It is seat ${seat}'s turn (round ${state.turn.round}).`,
        resolves: RESOLVABLE_TYPES,
      },
    ];
  },

  isComplete(state) {
    return state.complete;
  },
};

export { FIRST_GAME };
