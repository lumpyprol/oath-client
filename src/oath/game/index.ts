/**
 * Assembles the `oath` `GameDefinition` (unit 5). This is the ONE place
 * that combines every action module's handlers into the dispatch table —
 * modules contribute handlers, this file is the only one that merges them.
 * Later units add their own `*_HANDLERS` map here, additively; nothing
 * here edits another unit's entries (per the plan's dispatch-table
 * convention).
 */

import type { GameDefinition, PendingDecision, ProposedAction } from '../../engine/types.js';
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
import {
  CAMPAIGN_HANDLERS,
  casualtyChooser,
  eligibleAllyVolunteers,
  prepareCampaign,
} from './actions/campaign.js';
import { POWER_HANDLERS, preparePower } from './actions/power.js';
import { CITIZENSHIP_HANDLERS } from './actions/citizenship.js';
import { ADVISER_HANDLERS } from './actions/adviser.js';
import { WARBAND_HANDLERS } from './actions/warbands.js';
import { VICTORY_HANDLERS, afterAction, prepareRest } from './victory.js';
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
  ...POWER_HANDLERS,
  ...CITIZENSHIP_HANDLERS,
  ...ADVISER_HANDLERS,
  ...WARBAND_HANDLERS,
  ...VICTORY_HANDLERS,
};

/**
 * Additive, same pattern as `HANDLERS`: any action type needing `prepare()`
 * (HLD D14 — dice roll here, at append time, never in `reduce`) registers a
 * function here. `campaign.roll` rolls dice; `power.use` just rejects a
 * malformed payload before it's ever written to the log.
 */
const PREPARE: Record<string, (state: OathState, proposed: ProposedAction) => unknown> = {
  'campaign.roll': prepareCampaign,
  'power.use': preparePower,
  'turn.rest': prepareRest,
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
    // Law §3: once the game has ended, nothing further is legal. Checked
    // centrally so every action inherits it, including the ones that
    // deliberately bypass `requireActiveSeat` to answer another seat.
    if (state.complete) {
      throw new IllegalAction(`${action.type}: the game is already complete`);
    }
    // Every handler's actionCount bump happens exactly once, here — not
    // per-handler — and BEFORE dispatch, so a handler that starts a new
    // turn (turn.rest) can stamp `turn.turnStartedAt` from the same value
    // this action will be remembered by.
    state.actionCount += 1;
    // Every action runs the victory pipeline afterwards (unit 17): the
    // Oathkeeper title tracks its inputs continuously (Law §2.11), and a
    // `turn.rest` also ends a round and starts the next seat's Wake Phase.
    return afterAction(handler(state, action), action);
  },

  project(state, seat) {
    return project(state, seat);
  },

  pending(state) {
    if (state.complete) return [];
    // Non-locking side decisions (units 16, 16b). Unlike a Campaign, these
    // don't stop anyone else acting, so they're ADDITIONAL pending
    // decisions alongside whatever else is happening, never a replacement —
    // every `return` below prepends them.
    const citizenshipDecision: PendingDecision[] = state.citizenshipOffer
      ? [
          {
            id: `citizenshipOffer:${state.citizenshipOffer.exile}:${state.citizenshipOffer.offeredAt}`,
            seat: state.citizenshipOffer.exile,
            kind: 'citizenshipOffer',
            prompt: `Seat ${state.citizenshipOffer.scepterSeat} offered you Citizenship (Law §6.6.1) — accept or decline.`,
            resolves: ['citizenship.accept', 'citizenship.decline'],
          },
        ]
      : [];
    if (state.warbandRequest) {
      const r = state.warbandRequest;
      const what =
        r.direction === 'toBoard'
          ? `move ${r.count} warband(s) off their site onto their board`
          : r.direction === 'give'
            ? `give you ${r.count} warband(s)`
            : `take ${r.count} of your warband(s)`;
      citizenshipDecision.push({
        id: `warbands:${r.approver}:${r.requestedAt}`,
        seat: r.approver,
        kind: 'warbands',
        prompt: `Seat ${r.seat} asks permission to ${what} (Law §6.5).`,
        resolves: ['warbands.allow', 'warbands.deny'],
      });
    }
    if (state.titleChoice) {
      const c = state.titleChoice;
      citizenshipDecision.push({
        id: `oathkeeper:${c.holder}:${c.raisedAt}`,
        seat: c.holder,
        kind: 'oathkeeper',
        prompt:
          `Seats ${c.candidates.join(', ')} meet the Oathkeeper goal and you no longer do — ` +
          `choose which of them takes the title (Law §2.11).`,
        resolves: ['oathkeeper.grant'],
      });
    }
    // An unresolved Wake Phase (unit 17) preempts the active seat's turn:
    // Law §4.1 is resolved in full before the Act Phase begins.
    if (state.wake) {
      return [
        ...citizenshipDecision,
        {
          id: `wake:${state.wake.seat}:${state.wake.startedAt}`,
          seat: state.wake.seat,
          kind: 'wake',
          prompt:
            `Wake Phase: resolve the People's Favor — place one favor on it, or return one ` +
            `to the least-full favor bank (Law §4.1.1).`,
          resolves: ['wake.favor'],
        },
      ];
    }
    // A Campaign (unit 12) preempts the normal turn decision entirely —
    // whose move it is depends on the campaign's phase, not activeSeat.
    if (state.campaign) {
      const c = state.campaign;
      if (c.phase === 'respond') {
        return [
          ...citizenshipDecision,
          {
            id: `campaign:${c.defenderSeat}:${c.declaredAt}`,
            seat: c.defenderSeat as number, // numeric here — bandits skip this phase
            kind: 'campaign',
            prompt: `Seat ${c.attackerSeat} declared a Campaign against you — respond to close the window (Law §5.5.3).`,
            resolves: ['campaign.respond'],
          },
          // Law §5.5.2 (unit 16a part 2): eligible Citizens may offer to join
          // as Allies. Optional and racy by design — the defender responding
          // closes the window on any that went unanswered. P3 batches these.
          ...eligibleAllyVolunteers(state, c).map((seat) => ({
            id: `campaign-ally:${seat}:${c.declaredAt}`,
            seat,
            kind: 'campaign',
            prompt: `Seat ${c.attackerSeat} is attacking an Imperial player — you may offer to join as an Ally (Law §5.5.2).`,
            resolves: ['campaign.ally'],
          })),
        ];
      }
      if (c.phase === 'roll') {
        return [
          ...citizenshipDecision,
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
          ...citizenshipDecision,
          {
            id: `campaign:${c.attackerSeat}:${c.declaredAt}`,
            seat: c.attackerSeat,
            kind: 'campaign',
            prompt: `Resolve your Campaign's outcome (Law §5.5.5-5.5.6).`,
            resolves: ['campaign.resolve'],
          },
        ];
      }
      if (c.phase === 'casualties') {
        // Law §5.5.6's aside (unit 16a) — usually the Chancellor, but the
        // defeated player themselves when they are not an Imperial player.
        const chooser = casualtyChooser(state, c);
        return [
          ...citizenshipDecision,
          {
            id: `campaign:${chooser}:${c.declaredAt}`,
            seat: chooser,
            kind: 'campaign',
            prompt: `Choose which ${c.casualties!.quota} warbands of the defeated force are killed (Law §5.5.6).`,
            resolves: ['campaign.casualties'],
          },
        ];
      }
      // phase 'seize': a win — the attacker's remaining choices (Law §5.5.7).
      return [
        ...citizenshipDecision,
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
        ...citizenshipDecision,
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
      ...citizenshipDecision,
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
