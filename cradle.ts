/**
 * "Cradle" — a throwaway toy game. It is NOT Oath. Its only job is to
 * exercise every piece of P0 machinery with something small enough to
 * reason about:
 *
 *   - hidden information (private hands, hidden deck order)
 *   - a shuffle at setup, stored explicitly rather than reseeded
 *   - dice rolled in `prepare`, results persisted in the payload
 *   - pending decisions blocking on a player who is not the active one
 *   - turn order and completion
 *
 * When the real Oath rules arrive they implement the same GameDefinition
 * interface and this file gets deleted.
 */

import {
  IllegalAction,
  type GameAction,
  type GameDefinition,
  type PendingDecision,
  type ProposedAction,
} from './types.js';
import { rollDice, shuffle } from './random.js';

const DIE_FACES = [0, 0, 1, 1, 2, 3] as const;
const ROUNDS = 3;

export interface CradleSetup {
  seats: number;
  /** Full deck order, decided once. Never leaves the server. */
  deck: string[];
}

export interface CradleState {
  seats: number;
  turn: number;
  round: number;
  deck: string[];
  discard: string[];
  hands: string[][];
  favor: number[];
  pendingGift: { from: number; to: number; card: string } | null;
  log: string[];
  complete: boolean;
}

function requireActor(action: GameAction): number {
  if (action.actor === null) throw new IllegalAction(`${action.type} requires a seated actor`);
  return action.actor;
}

function endTurn(s: CradleState): void {
  s.turn = (s.turn + 1) % s.seats;
  if (s.turn === 0) s.round += 1;
  if (s.round > ROUNDS) s.complete = true;
}

export const cradle: GameDefinition<CradleState, CradleSetup> = {
  kind: 'cradle',

  setup(seats) {
    return {
      seats,
      deck: shuffle(Array.from({ length: 24 }, (_, i) => `card-${String(i + 1).padStart(2, '0')}`)),
    };
  },

  init(setup) {
    const deck = setup.deck.slice();
    const hands: string[][] = [];
    for (let i = 0; i < setup.seats; i++) hands.push([deck.pop()!, deck.pop()!]);
    return {
      seats: setup.seats,
      turn: 0,
      round: 1,
      deck,
      discard: [],
      hands,
      favor: new Array(setup.seats).fill(0),
      pendingGift: null,
      log: ['game created'],
      complete: false,
    };
  },

  prepare(_state, proposed: ProposedAction) {
    // The only action here that consumes randomness. Roll now, persist the
    // result, so every later replay reuses these exact dice.
    if (proposed.type === 'roll') {
      return { ...(proposed.payload as object), dice: rollDice(DIE_FACES, 2) };
    }
    return proposed.payload;
  },

  reduce(s, action) {
    if (s.complete) throw new IllegalAction('game is already complete');

    // A pending gift freezes everyone except its recipient.
    if (s.pendingGift && !['gift.accept', 'gift.decline'].includes(action.type)) {
      throw new IllegalAction('waiting on a gift response');
    }

    switch (action.type) {
      case 'draw': {
        const seat = requireActor(action);
        if (seat !== s.turn) throw new IllegalAction('not your turn');
        if (s.deck.length === 0) throw new IllegalAction('deck is empty');
        // Deterministic: the deck was shuffled once, this is just a pop.
        const card = s.deck.pop()!;
        s.hands[seat].push(card);
        s.log.push(`seat ${seat} drew a card`);
        endTurn(s);
        return s;
      }

      case 'roll': {
        const seat = requireActor(action);
        if (seat !== s.turn) throw new IllegalAction('not your turn');
        const { dice } = action.payload as { dice?: number[] };
        if (!Array.isArray(dice) || dice.length !== 2) {
          throw new IllegalAction('roll action is missing its dice');
        }
        const gained = dice[0] + dice[1];
        s.favor[seat] += gained;
        s.log.push(`seat ${seat} rolled ${dice.join('+')} for ${gained} favor`);
        endTurn(s);
        return s;
      }

      case 'gift': {
        const seat = requireActor(action);
        if (seat !== s.turn) throw new IllegalAction('not your turn');
        const { to, card } = action.payload as { to: number; card: string };
        if (to === seat || to < 0 || to >= s.seats) throw new IllegalAction('bad recipient');
        const idx = s.hands[seat].indexOf(card);
        if (idx === -1) throw new IllegalAction('card not in hand');
        s.hands[seat].splice(idx, 1);
        s.pendingGift = { from: seat, to, card };
        s.log.push(`seat ${seat} offered a card to seat ${to}`);
        return s; // turn does NOT end until the gift resolves
      }

      case 'gift.accept':
      case 'gift.decline': {
        const seat = requireActor(action);
        const gift = s.pendingGift;
        if (!gift) throw new IllegalAction('no gift pending');
        if (seat !== gift.to) throw new IllegalAction('not your gift to answer');
        if (action.type === 'gift.accept') {
          s.hands[gift.to].push(gift.card);
          s.log.push(`seat ${gift.to} accepted a card from seat ${gift.from}`);
        } else {
          s.discard.push(gift.card);
          s.log.push(`seat ${gift.to} declined; card discarded`);
        }
        s.pendingGift = null;
        endTurn(s);
        return s;
      }

      default:
        throw new IllegalAction(`unknown action: ${action.type}`);
    }
  },

  project(s, seat) {
    return {
      seats: s.seats,
      turn: s.turn,
      round: s.round,
      complete: s.complete,
      favor: s.favor,
      deckCount: s.deck.length,
      discard: s.discard,
      // Own hand in full; everyone else as a count only.
      hands: s.hands.map((h, i) => (i === seat ? h : { count: h.length })),
      pendingGift: s.pendingGift
        ? {
            from: s.pendingGift.from,
            to: s.pendingGift.to,
            // Only the two parties see which card is in flight.
            card:
              seat === s.pendingGift.to || seat === s.pendingGift.from ? s.pendingGift.card : null,
          }
        : null,
      log: s.log,
    };
  },

  pending(s) {
    if (s.complete) return [];
    const out: PendingDecision[] = [];
    if (s.pendingGift) {
      out.push({
        id: `gift:${s.pendingGift.from}:${s.pendingGift.to}:${s.pendingGift.card}`,
        seat: s.pendingGift.to,
        kind: 'gift',
        prompt: `Seat ${s.pendingGift.from} is offering you a card.`,
        resolves: ['gift.accept', 'gift.decline'],
      });
    } else {
      out.push({
        id: `turn:${s.round}:${s.turn}`,
        seat: s.turn,
        kind: 'turn',
        prompt: `It is your turn (round ${s.round}).`,
        resolves: ['draw', 'roll', 'gift'],
      });
    }
    return out;
  },

  isComplete(s) {
    return s.complete;
  },
};
