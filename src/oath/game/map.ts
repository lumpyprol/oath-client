/**
 * Map geometry: regions and travel costs as a small pure module, so Travel
 * (unit 9) and Campaign (units 12-13) never embed this table themselves.
 *
 * Citations are "Law §x.y", the Buried Giant rules reference for Oath
 * printing p1 (numbering identical to the Law of Oath, Oct 20 2020). See
 * RULINGS.md for the edition.
 */

import { REGIONS, type Region } from './state.js';

export type { Region };
export { REGIONS };

/**
 * Sites per region on the board (Law §2.1.1): "The Cradle, which holds two
 * sites, and the Provinces and Hinterland, which hold three sites each."
 * This is the board's fixed slot count, not the 23-card site deck.
 */
export const REGION_SITE_COUNTS: Record<Region, number> = {
  cradle: 2,
  provinces: 3,
  hinterland: 3,
};

/**
 * Travel's Supply cost table (Law §5.6.1), verbatim:
 *   "If your pawn is in the Cradle, spend 1 Supply to travel to the other
 *   Cradle site, 2 Supply to travel to any Provinces site, or 4 Supply to
 *   travel to any Hinterland site. If your pawn is in the Provinces, spend
 *   2 Supply to travel to any other site. If your pawn is in the
 *   Hinterland, spend 3 Supply to travel to either other Hinterland site,
 *   2 Supply to travel to any Provinces site, or 4 Supply to travel to any
 *   Cradle site."
 *
 * Same-region cost differs by region (1 in Cradle, 2 in Provinces, 3 in
 * Hinterland) — this is NOT a single symmetric same-region constant. Costs
 * between distinct regions ARE symmetric (Cradle<->Provinces both 2,
 * Cradle<->Hinterland both 4, Provinces<->Hinterland both 2). Both facts
 * are encoded literally here rather than derived, since the rulebook
 * states the table directly rather than a symmetric formula.
 *
 * This is the base cost only. Site- and power-specific modifiers (Coast,
 * Charming Valley, Shrouded Wood, Narrow Pass — Law §11.3/11.6/11.7/11.8;
 * "spend no Supply" powers ignore this table per Law §7.6.2) are unit 9's
 * concern, applied on top of this table's result.
 */
const TRAVEL_COST: Record<Region, Record<Region, number>> = {
  cradle: { cradle: 1, provinces: 2, hinterland: 4 },
  provinces: { cradle: 2, provinces: 2, hinterland: 2 },
  hinterland: { cradle: 4, provinces: 2, hinterland: 3 },
};

export function travelCost(from: Region, to: Region): number {
  return TRAVEL_COST[from][to];
}

/**
 * The region whose discard pile receives a card discarded by a pawn in
 * `pawnRegion` (Glossary "Discard"): "Place the prompted cards ... on top
 * of the Provinces discard pile if your pawn is in the Cradle, the
 * Hinterland discard pile if your pawn is in the Provinces, or the Cradle
 * discard pile if your pawn is in the Hinterland." A fixed cycle
 * (Cradle -> Provinces -> Hinterland -> Cradle), independent of Travel's
 * cost table. The Discard rule's cross-region exception ("if discarding
 * cards in a different region from your pawn, discard based on the region
 * of the card instead") is the caller's concern, not this table's.
 */
const DISCARD_DESTINATION: Record<Region, Region> = {
  cradle: 'provinces',
  provinces: 'hinterland',
  hinterland: 'cradle',
};

export function discardRegion(pawnRegion: Region): Region {
  return DISCARD_DESTINATION[pawnRegion];
}
