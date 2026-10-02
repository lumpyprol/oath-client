/**
 * `travel` (unit 9) — Law §5.6.
 *
 *   §5.6.1 Spend Supply and Choose Destination — the cost is
 *          `travelCost(fromRegion, toRegion)` (unit 2's table, transcribed
 *          from §5.6.1). You cannot travel to the site you are already on
 *          ("the OTHER Cradle site", "either OTHER Hinterland site").
 *   §5.6.2 Move Pawn and Reveal Site — set `pawnSite`; if the destination
 *          was facedown, flip it faceup and resolve its reveal prompt
 *          (§2.8.2, `site.reveal`): draw its `relics` "R"-count relics
 *          from the relic deck onto the site facedown (§9.3: as many as
 *          the deck holds), and place `favor`/`secrets` from the shared
 *          bank onto the site (favor §9.3-clamped, secrets unlimited).
 *
 * NOT enforced — card text, so v1 players declare these via `power.use`
 * and the engine only ever charges the base cost (HLD D28; the v2
 * "Engine-enforced card powers" section carries the running list):
 *   - Site-power cost modifiers: Coast (§11.3), Charming Valley (§11.6),
 *     Shrouded Wood (§11.7), and "spend no Supply" powers (§7.6.2).
 *   - Narrow Pass's forced-destination rule (§11.8).
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

// Unit 1 of P4: addressed by SLOT, not id. Law §5.6.2 lets you travel to a
// FACEDOWN site — that is the whole point of the flip-on-arrival clause —
// but `project.ts` nulls a facedown site's id (§9.4), so a client had no
// legal id to send for exactly the destinations the Law says are legal.
// `siteIndex` is a position in the map's fixed slot order (`state.sites`,
// unchanged in length or order all game — see `project()`), which is
// public at every index whether or not that slot has been revealed yet.
const TravelPayloadSchema = z.object({ siteIndex: z.number().int().min(0) });

function travel(state: OathState, action: GameAction): OathState {
  const seat = requireActiveSeat(state, action);
  const parsed = TravelPayloadSchema.safeParse(action.payload);
  if (!parsed.success) throw new IllegalAction('travel: malformed payload');
  const { siteIndex } = parsed.data;
  const player = state.players[seat];

  const dest = state.sites[siteIndex];
  if (!dest) {
    throw new IllegalAction(
      `travel: no site at slot ${siteIndex} — the map has ${state.sites.length} (Law §5.6.1)`,
    );
  }
  if (dest.id === player.pawnSite) {
    throw new IllegalAction('travel: you are already on that site (Law §5.6.1)');
  }
  const from = state.sites.find((s) => s.id === player.pawnSite);
  if (!from) throw new IllegalAction('travel: your pawn is not on a real site');
  const siteId = dest.id; // real, server-side — safe to use below whether or not this seat's view can see it

  const cost = travelCost(from.region, dest.region); // Law §5.6.1
  if (player.supply < cost) {
    throw new IllegalAction(`travel: costs ${cost} Supply, you have ${player.supply} (Law §5.6.1)`);
  }

  const effects = arrivalEffects(state, siteIndex);

  const next = applyEffects(state, seat, effects);
  next.players[seat].pawnSite = siteId; // Law §5.6.2
  next.players[seat].supply -= cost;
  return next;
}

/**
 * Law §5.6.2's arrival at slot `siteIndex`: if the site is facedown, flip it
 * faceup and resolve its reveal prompt (§2.8.2). Empty for a faceup site.
 * Shared with Campaign's banish (§5.5.7.3 "make them travel"), which is a
 * travel too — so a banished pawn reveals a facedown site exactly as a
 * travelling one does, and never sits on a hidden one.
 */
export function arrivalEffects(state: OathState, siteIndex: number): Effect[] {
  const dest = state.sites[siteIndex];
  const siteId = dest.id;
  const effects: Effect[] = [];
  if (dest.facedown) {
    // Law §5.6.2 / §2.8.2: flip faceup, then resolve the reveal prompt.
    effects.push({ kind: 'flip', target: { kind: 'site', siteId } });
    const reveal = (byId(dest.id) as { reveal: { favor: number; secrets: number; relics: number } })
      .reveal;
    const relicDraws = Math.min(reveal.relics, state.relicDeck.length); // §9.3
    for (let i = 0; i < relicDraws; i++) {
      effects.push({ kind: 'draw', from: { kind: 'relicDeck' }, to: { kind: 'siteRelics', siteId } });
    }
    const favor = Math.min(reveal.favor, state.sharedBank.favor); // §9.3
    if (favor > 0) {
      effects.push({
        kind: 'favor',
        from: { kind: 'sharedFavor' },
        to: { kind: 'siteFavor', siteId },
        amount: favor,
      });
    }
    if (reveal.secrets > 0) {
      effects.push({
        kind: 'secret',
        from: { kind: 'sharedSecrets' }, // §9.3: unlimited
        to: { kind: 'siteSecrets', siteId },
        amount: reveal.secrets,
      });
    }
  }
  return effects;
}

export const TRAVEL_HANDLERS: Record<string, Handler> = {
  travel,
};
