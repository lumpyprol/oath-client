/**
 * The site powers that change Travel (Ben, 2026-10-02): one function, read by
 * both the reducer and the Travel form, so the form can never offer a route
 * the engine refuses. A site's power counts only while it is faceup (a
 * facedown site has no power yet); the pawn's own site is always faceup.
 *
 *   §11.3 Coast sites — from a Coast to a Coast: 1 Supply, ignore Narrow Pass.
 *   §11.6 Charming Valley — from here: +1 Supply.
 *   §11.7 Shrouded Wood — from here: 2 Supply, ignore Narrow Pass and The
 *         Hidden Place; if an enemy rules it, they pick your destination
 *         (`shroudedChooser`; the travel then waits on `travel.direct`).
 *   §11.8 Narrow Pass — entering its region from another region, you must go
 *         to Narrow Pass.
 *   Buried Giant (card text) — from here you may flip one ready secret
 *         facedown to spend no Supply (§7.6.2) and ignore Narrow Pass.
 *   The Hidden Place (card text) — you cannot travel here unless you flip one
 *         ready secret facedown.
 *   Decadent (Imperial Reliquary, once uncovered; the Chancellor's) — to the
 *         Cradle from elsewhere spends no Supply; to the Hinterland, +1.
 */

import type { OathState } from './state.js';
import { travelCost } from './map.js';
import { chancellorHas } from './reliquary-text.js';

export const COASTS: ReadonlySet<string> = new Set(['site:barren-coast', 'site:lush-coast', 'site:rocky-coast']);
export const CHARMING_VALLEY = 'site:charming-valley';
export const SHROUDED_WOOD = 'site:shrouded-wood';
/** Law §11.7: travel from Shrouded Wood costs 2 Supply, wherever you go. */
export const SHROUDED_WOOD_COST = 2;
export const NARROW_PASS = 'site:narrow-pass';
export const BURIED_GIANT = 'site:buried-giant';
export const HIDDEN_PLACE = 'site:hidden-place';

/** How the Travel cost is paid: Supply as usual, or Buried Giant's flipped secret. */
export type TravelPay = 'supply' | 'secret';

export interface TravelRoute {
  /** Supply spent (0 when paying with Buried Giant's secret). */
  cost: number;
  /** Ready secrets flipped facedown (Buried Giant's and/or The Hidden Place's). */
  secrets: number;
  /** Why this route is illegal, if it is — a Law-cited sentence. */
  blocked?: string;
  /** What shaped this route's cost, for the form's label: "Law §11.3", "Decadent". */
  laws: string[];
}

export function travelRoute(state: OathState, seat: number, siteIndex: number, pay: TravelPay): TravelRoute {
  const player = state.players[seat];
  const from = state.sites.find((s) => s.id === player.pawnSite)!;
  const dest = state.sites[siteIndex];
  const laws: string[] = [];
  let cost = travelCost(from.region, dest.region); // Law §5.6.1
  let ignoreNarrow = false;
  let ignoreHidden = false;

  if (from.id === SHROUDED_WOOD) {
    cost = SHROUDED_WOOD_COST;
    ignoreNarrow = ignoreHidden = true;
    laws.push('Law §11.7');
  } else if (COASTS.has(from.id) && !dest.facedown && COASTS.has(dest.id)) {
    cost = 1;
    ignoreNarrow = true;
    laws.push('Law §11.3');
  } else if (from.id === CHARMING_VALLEY) {
    cost += 1;
    laws.push('Law §11.6');
  }

  // The Imperial Reliquary's Decadent space, once uncovered — a power the
  // Chancellor always has and must use (Law §2.3, §7.1.1): "Spend no Supply
  // if you're traveling to a site in the Cradle from a site in the Provinces
  // or Hinterland. If you're traveling to a site in the Hinterland, increase
  // the Travel cost by 1 Supply."
  if (decadentApplies(state, seat)) {
    if (dest.region === 'cradle' && from.region !== 'cradle') {
      cost = 0; // "spend no Supply" ignores the cost and any increase (Law §7.6.2)
      laws.push('Decadent');
    } else if (dest.region === 'hinterland') {
      cost += 1;
      laws.push('Decadent');
    }
  }

  let secrets = 0;
  if (pay === 'secret') {
    if (from.id !== BURIED_GIANT) {
      return { cost, secrets, laws, blocked: 'only Buried Giant lets you flip a secret to travel' };
    }
    cost = 0; // "spend no Supply" ignores the cost and any increase (Law §7.6.2)
    ignoreNarrow = true;
    secrets += 1;
  }
  if (dest.id === HIDDEN_PLACE && !dest.facedown && !ignoreHidden) {
    secrets += 1;
  }

  const pass = state.sites.find((s) => s.id === NARROW_PASS && !s.facedown);
  if (pass && !ignoreNarrow && dest.region === pass.region && from.region !== pass.region && dest.id !== NARROW_PASS) {
    return { cost, secrets, laws, blocked: 'entering this region from another, you must travel to Narrow Pass (Law §11.8)' };
  }
  if (secrets > player.secrets.ready) {
    return { cost, secrets, laws, blocked: `needs ${secrets} ready secret${secrets === 1 ? '' : 's'} to flip, you have ${player.secrets.ready}` };
  }
  if (cost > player.supply) {
    return { cost, secrets, laws, blocked: `costs ${cost} Supply, you have ${player.supply} (Law §5.6.1)` };
  }
  return { cost, secrets, laws };
}

/** Whether `seat` is the Chancellor with the Reliquary's Decadent space uncovered (Law §2.3, §7.1.1). */
export function decadentApplies(state: OathState, seat: number): boolean {
  return chancellorHas(state, seat, 'decadent');
}

/** Law §10.7: is `other` an enemy of `seat`? Imperial sees Exiles as enemies; an Exile, everyone. */
export function isEnemy(state: OathState, seat: number, other: number): boolean {
  if (other === seat) return false;
  const imperial = (s: number) => state.players[s].citizenship !== 'exile';
  return imperial(seat) ? !imperial(other) : true;
}

/**
 * Shrouded Wood's other clause (§11.7): "If an enemy rules here, you travel
 * to the site of the ruler's choice (Chancellor's choice if ruled by the
 * Empire), even if another player is making you travel." The seat who
 * chooses for `traveller` leaving it, or null when no enemy rules it (or the
 * pawn is elsewhere).
 *
 * A site holds one faction's warbands at most (Ben, 2026-10-02): you only
 * move warbands onto a site you rule (§6.5), and a won site is emptied of
 * the loser's force before the winner places (§5.5.6, §5.5.7.1). So there
 * is one ruler: an Exile, or the Empire, which chooses through its
 * Chancellor.
 */
export function shroudedChooser(state: OathState, traveller: number): number | null {
  if (state.players[traveller].pawnSite !== SHROUDED_WOOD) return null;
  const site = state.sites.find((s) => s.id === SHROUDED_WOOD)!;
  if (site.facedown) return null;
  const holder = site.warbands.findIndex((n) => n > 0);
  if (holder < 0) return null; // bandits rule it: no one to choose
  const empire = state.players[holder].citizenship !== 'exile';
  const ruler = empire ? state.players.findIndex((p) => p.citizenship === 'chancellor') : holder;
  return isEnemy(state, traveller, ruler) ? ruler : null;
}
