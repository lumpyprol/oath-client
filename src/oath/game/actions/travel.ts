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
 * Site powers that change Travel (Coast §11.3, Charming Valley §11.6,
 * Shrouded Wood §11.7, Narrow Pass §11.8, Buried Giant, The Hidden Place)
 * are enforced by `travelRoute` (travel-rules.ts), which the Travel form
 * reads too. `pay: 'secret'` is Buried Giant's flipped secret. Shrouded
 * Wood's "an enemy ruler picks your destination" is a pending decision
 * (`state.shroudedTravel`, answered by `travel.direct`). Still NOT enforced:
 * denizen/relic travel powers (declared via `power.use`, HLD D28; v2).
 *
 * Supply spent by decrementing on the applyEffects output (the unit 7
 * convention).
 */

import { z } from 'zod';
import { byId } from '../../cards/index.js';
import { IllegalAction, type GameAction } from '../../../engine/types.js';
import { applyEffects, type Effect } from '../effects.js';
import { SHROUDED_WOOD_COST, shroudedChooser, travelRoute } from '../travel-rules.js';
import { seatTitle } from '../seats.js';
import type { OathState } from '../state.js';
import { requireActiveSeat, type Handler } from '../turn.js';

// Unit 1 of P4: addressed by SLOT, not id. Law §5.6.2 lets you travel to a
// FACEDOWN site — that is the whole point of the flip-on-arrival clause —
// but `project.ts` nulls a facedown site's id (§9.4), so a client had no
// legal id to send for exactly the destinations the Law says are legal.
// `siteIndex` is a position in the map's fixed slot order (`state.sites`,
// unchanged in length or order all game — see `project()`), which is
// public at every index whether or not that slot has been revealed yet.
// `pay` (2026-10-02): 'secret' flips a ready secret at Buried Giant instead
// of spending Supply. Absent = Supply, so earlier logged travels replay.
// `siteIndex` is absent exactly when Shrouded Wood's enemy ruler chooses
// the destination (Law §11.7): the traveller pays and `travel.direct` follows.
const TravelPayloadSchema = z.object({
  siteIndex: z.number().int().min(0).optional(),
  pay: z.enum(['supply', 'secret']).optional(),
});

function travel(state: OathState, action: GameAction): OathState {
  const seat = requireActiveSeat(state, action);
  const parsed = TravelPayloadSchema.safeParse(action.payload);
  if (!parsed.success) throw new IllegalAction('travel: malformed payload');
  const { siteIndex, pay = 'supply' } = parsed.data;
  const player = state.players[seat];

  // Law §11.7: leaving a Shrouded Wood an enemy rules, they choose where.
  const chooser = shroudedChooser(state, seat);
  if (chooser !== null) {
    if (siteIndex !== undefined || pay !== 'supply') {
      throw new IllegalAction(
        `travel: the ${seatTitle(state.players, chooser)} rules Shrouded Wood and chooses where you go — name no destination (Law §11.7)`,
      );
    }
    if (player.supply < SHROUDED_WOOD_COST) {
      throw new IllegalAction(`travel: costs ${SHROUDED_WOOD_COST} Supply, you have ${player.supply} (Law §11.7)`);
    }
    const next = structuredClone(state);
    next.players[seat].supply -= SHROUDED_WOOD_COST;
    next.shroudedTravel = { traveller: seat, chooser, via: 'travel', startedAt: state.actionCount };
    return next;
  }
  if (siteIndex === undefined) throw new IllegalAction('travel: choose a destination (Law §5.6.1)');

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

  const route = travelRoute(state, seat, siteIndex, pay); // Law §5.6.1 + site powers
  if (route.blocked) throw new IllegalAction(`travel: ${route.blocked}`);

  const effects = arrivalEffects(state, siteIndex);

  const next = applyEffects(state, seat, effects);
  next.players[seat].pawnSite = siteId; // Law §5.6.2
  next.players[seat].supply -= route.cost;
  next.players[seat].secrets.ready -= route.secrets; // flipped facedown: no use paying costs (Law §4.3)
  next.players[seat].secrets.flipped += route.secrets;
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

const DirectPayloadSchema = z.object({ siteIndex: z.number().int().min(0) });

/**
 * `travel.direct` — Shrouded Wood's ruler names the destination (Law §11.7)
 * for the pending `state.shroudedTravel`. Any other site: from Shrouded
 * Wood the traveller ignores Narrow Pass and The Hidden Place, and the cost
 * was already paid (or, for a banish, is none — §5.5.7.3).
 */
function direct(state: OathState, action: GameAction): OathState {
  const t = state.shroudedTravel;
  if (!t) throw new IllegalAction('travel.direct: no one is waiting on your choice of destination');
  if (action.actor !== t.chooser) {
    throw new IllegalAction(`travel.direct: the ${seatTitle(state.players, t.chooser)} chooses (Law §11.7)`);
  }
  const parsed = DirectPayloadSchema.safeParse(action.payload);
  if (!parsed.success) throw new IllegalAction('travel.direct: malformed payload');
  const { siteIndex } = parsed.data;
  const dest = state.sites[siteIndex];
  if (!dest) throw new IllegalAction(`travel.direct: no site at slot ${siteIndex} (Law §11.7)`);
  if (dest.id === state.players[t.traveller].pawnSite) {
    throw new IllegalAction('travel.direct: choose a site other than the one they are on (Law §5.6.1)');
  }
  const next = applyEffects(state, t.traveller, arrivalEffects(state, siteIndex));
  next.players[t.traveller].pawnSite = dest.id; // Law §5.6.2
  next.shroudedTravel = null;
  return next;
}

export const TRAVEL_HANDLERS: Record<string, Handler> = {
  travel,
  'travel.direct': direct,
};
