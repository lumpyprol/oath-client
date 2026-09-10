/**
 * `muster` (unit 7) — Law §5.2, the first of the six major actions.
 *
 *   §5.2.1 Pay Cost — spend 1 Supply and place one favor on a denizen or
 *          intact edifice card (NOT a relic or a ruin, §2.9) at your site
 *          that has no favor or secrets on it already.
 *   §5.2.2 Gain Warbands — gain two warbands, from your personal bank onto
 *          your board (§9.3: as many as the bank has, if fewer than 2).
 *
 * A Citizen "gains purple warbands instead of their own color" (§5.2.2) —
 * a physical-token distinction the abstract per-seat warband model doesn't
 * need: the bank->board move is the same for everyone, and the
 * purple-pool conservation for Imperial seats is already an invariant.
 *
 * Supply is spent by decrementing `player.supply` directly (§4.2: "move
 * your Supply marker once to the right for each Supply you spend") — it is
 * not a zone in the effect vocabulary. turn.rest's Save Supply step
 * (§4.3.4) reads the resulting marker position, which is exactly "supply
 * not spent this turn". Everything else flows through `applyEffects`.
 */

import { z } from 'zod';
import { byId } from '../../cards/index.js';
import { IllegalAction, type GameAction } from '../../../engine/types.js';
import { applyEffects, type Effect } from '../effects.js';
import type { OathState } from '../state.js';
import { requireActiveSeat, type Handler } from '../turn.js';

const MUSTER_COST = 1; // Supply (Law §5.2.1)
const MUSTER_WARBANDS = 2; // Law §5.2.2

const MusterPayloadSchema = z.object({
  cardId: z.string(),
  siteId: z.string().optional(),
});

function muster(state: OathState, action: GameAction): OathState {
  const seat = requireActiveSeat(state, action);
  const parsed = MusterPayloadSchema.safeParse(action.payload);
  if (!parsed.success) throw new IllegalAction('muster: malformed payload');
  const { cardId } = parsed.data;
  const player = state.players[seat];

  const siteId = parsed.data.siteId ?? player.pawnSite;
  if (siteId !== player.pawnSite) {
    throw new IllegalAction('muster: the card must be at your site (Law §5.2.1)');
  }
  const site = state.sites.find((s) => s.id === siteId);
  if (!site) throw new IllegalAction(`muster: no site ${siteId}`);
  const card = site.cards.find((c) => c?.id === cardId);
  if (!card) throw new IllegalAction(`muster: no card ${cardId} at your site`);
  if (card.ruined) {
    throw new IllegalAction('muster: a ruined edifice cannot be mustered from (Law §5.2.1 / §2.9)');
  }
  if (!('suit' in byId(cardId))) {
    // relics live in site.relics, not site.cards, so this only trips on a
    // ruin whose `ruined` flag wasn't set — belt and braces.
    throw new IllegalAction('muster: the target has no suit (Law §5.2.1)');
  }
  if (card.favor > 0 || card.secrets > 0) {
    throw new IllegalAction('muster: the card already has favor or secrets on it (Law §5.2.1)');
  }
  if (player.supply < MUSTER_COST) {
    throw new IllegalAction('muster: insufficient Supply (Law §5.2.1)');
  }
  if (player.favor < 1) {
    throw new IllegalAction('muster: no favor to place (Law §5.2.1)');
  }

  const effects: Effect[] = [
    {
      kind: 'favor',
      from: { kind: 'seatFavor', seat },
      to: { kind: 'siteCardFavor', siteId, cardId },
      amount: 1,
    },
  ];
  const warbands = Math.min(MUSTER_WARBANDS, player.warbands.bank);
  if (warbands > 0) {
    effects.push({
      kind: 'warbands',
      from: { kind: 'seatWarbandBank', seat },
      to: { kind: 'seatWarbandBoard', seat },
      amount: warbands,
    });
  }

  const next = applyEffects(state, seat, effects);
  next.players[seat].supply -= MUSTER_COST; // §4.2: spent from the Supply track
  return next;
}

export const MUSTER_HANDLERS: Record<string, Handler> = {
  muster,
};
