/**
 * `travel` (unit 9) — Law §5.6.
 *
 *   §5.6.1 Spend Supply and Choose Destination — the cost is
 *          `travelCost(fromRegion, toRegion)` (unit 2's table, transcribed
 *          from §5.6.1). You cannot travel to the site you are already on
 *          ("the OTHER Cradle site", "either OTHER Hinterland site").
 *   §5.6.2 Move Pawn and Reveal Site — set `pawnSite`; if the destination
 *          was facedown, flip it faceup and resolve its reveal prompt
 *          (§2.8.2): draw its "R"-count relics from the relic deck onto
 *          the site, facedown (§9.3: as many as the deck holds).
 *
 * NOT implemented (all card-text, declared via `power.use` in v1 per
 * D28/D34 — cited here so it's clear they're deliberate omissions):
 *   - Site-power cost modifiers: Coast (§11.3), Charming Valley (§11.6),
 *     Shrouded Wood (§11.7), and "spend no Supply" powers (§7.6.2).
 *   - Narrow Pass's forced-destination rule (§11.8).
 *   - Favor/secret reveal-prompt placement (§2.8.2): P1's site data has
 *     the relic "R" count but not the favor/secret icon counts, same gap
 *     unit 4 flagged. Only the relic draw happens here.
 *
 * Supply spent by decrementing on the applyEffects output (the unit 7
 * convention).
 */

import { z } from 'zod';
import { byId } from '../../cards/index.js';
import { IllegalAction, type GameAction } from '../../../engine/types.js';
import { applyEffects, type Effect } from '../effects.js';
import { travelCost } from '../map.js';
import type { OathState } from '../state.js';
import { requireActiveSeat, type Handler } from '../turn.js';

const TravelPayloadSchema = z.object({ siteId: z.string() });

function travel(state: OathState, action: GameAction): OathState {
  const seat = requireActiveSeat(state, action);
  const parsed = TravelPayloadSchema.safeParse(action.payload);
  if (!parsed.success) throw new IllegalAction('travel: malformed payload');
  const { siteId } = parsed.data;
  const player = state.players[seat];

  if (siteId === player.pawnSite) {
    throw new IllegalAction('travel: you are already on that site (Law §5.6.1)');
  }
  const dest = state.sites.find((s) => s.id === siteId);
  if (!dest) throw new IllegalAction(`travel: no site ${siteId}`);
  const from = state.sites.find((s) => s.id === player.pawnSite);
  if (!from) throw new IllegalAction('travel: your pawn is not on a real site');

  const cost = travelCost(from.region, dest.region); // Law §5.6.1
  if (player.supply < cost) {
    throw new IllegalAction(`travel: costs ${cost} Supply, you have ${player.supply} (Law §5.6.1)`);
  }

  const effects: Effect[] = [];
  if (dest.facedown) {
    // Law §5.6.2: flip faceup, then draw the reveal prompt's relics.
    effects.push({ kind: 'flip', target: { kind: 'site', siteId } });
    const relicCount = (byId(dest.id) as { relicCount: number }).relicCount;
    const draws = Math.min(relicCount, state.relicDeck.length); // §9.3
    for (let i = 0; i < draws; i++) {
      effects.push({ kind: 'draw', from: { kind: 'relicDeck' }, to: { kind: 'siteRelics', siteId } });
    }
  }

  const next = applyEffects(state, seat, effects);
  next.players[seat].pawnSite = siteId; // Law §5.6.2
  next.players[seat].supply -= cost;
  return next;
}

export const TRAVEL_HANDLERS: Record<string, Handler> = {
  travel,
};
