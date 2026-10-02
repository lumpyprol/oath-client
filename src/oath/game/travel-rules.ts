/**
 * The site powers that change Travel (Ben, 2026-10-02): one function, read by
 * both the reducer and the Travel form, so the form can never offer a route
 * the engine refuses. A site's power counts only while it is faceup (a
 * facedown site has no power yet); the pawn's own site is always faceup.
 *
 *   §11.3 Coast sites — from a Coast to a Coast: 1 Supply, ignore Narrow Pass.
 *   §11.6 Charming Valley — from here: +1 Supply.
 *   §11.7 Shrouded Wood — from here: 2 Supply, ignore Narrow Pass and The
 *         Hidden Place. (Its "an enemy ruler picks your destination" clause
 *         needs an off-turn decision; not enforced yet — see `shroudedRulers`.)
 *   §11.8 Narrow Pass — entering its region from another region, you must go
 *         to Narrow Pass.
 *   Buried Giant (card text) — from here you may flip one ready secret
 *         facedown to spend no Supply (§7.6.2) and ignore Narrow Pass.
 *   The Hidden Place (card text) — you cannot travel here unless you flip one
 *         ready secret facedown.
 */

import type { OathState } from './state.js';
import { travelCost } from './map.js';
import { rulersOf } from './rule.js';

export const COASTS: ReadonlySet<string> = new Set(['site:barren-coast', 'site:lush-coast', 'site:rocky-coast']);
export const CHARMING_VALLEY = 'site:charming-valley';
export const SHROUDED_WOOD = 'site:shrouded-wood';
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
  /** The site powers that shaped this route, for the form's label. */
  why: string[];
}

export function travelRoute(state: OathState, seat: number, siteIndex: number, pay: TravelPay): TravelRoute {
  const player = state.players[seat];
  const from = state.sites.find((s) => s.id === player.pawnSite)!;
  const dest = state.sites[siteIndex];
  const why: string[] = [];
  let cost = travelCost(from.region, dest.region); // Law §5.6.1
  let ignoreNarrow = false;
  let ignoreHidden = false;

  if (from.id === SHROUDED_WOOD) {
    cost = 2;
    ignoreNarrow = ignoreHidden = true;
    why.push('Shrouded Wood: 2 Supply (Law §11.7)');
  } else if (COASTS.has(from.id) && !dest.facedown && COASTS.has(dest.id)) {
    cost = 1;
    ignoreNarrow = true;
    why.push('Coast to Coast: 1 Supply (Law §11.3)');
  } else if (from.id === CHARMING_VALLEY) {
    cost += 1;
    why.push('Charming Valley: +1 Supply (Law §11.6)');
  }

  let secrets = 0;
  if (pay === 'secret') {
    if (from.id !== BURIED_GIANT) {
      return { cost, secrets, why, blocked: 'only Buried Giant lets you flip a secret to travel' };
    }
    cost = 0; // "spend no Supply" ignores the cost and any increase (Law §7.6.2)
    ignoreNarrow = true;
    secrets += 1;
    why.push('Buried Giant: a secret instead of Supply');
  }
  if (dest.id === HIDDEN_PLACE && !dest.facedown && !ignoreHidden) {
    secrets += 1;
    why.push('The Hidden Place: flip a secret to enter');
  }

  const pass = state.sites.find((s) => s.id === NARROW_PASS && !s.facedown);
  if (pass && !ignoreNarrow && dest.region === pass.region && from.region !== pass.region && dest.id !== NARROW_PASS) {
    return { cost, secrets, why, blocked: 'entering this region from another, you must travel to Narrow Pass (Law §11.8)' };
  }
  if (secrets > player.secrets.ready) {
    return { cost, secrets, why, blocked: `needs ${secrets} ready secret${secrets === 1 ? '' : 's'} to flip, you have ${player.secrets.ready}` };
  }
  if (cost > player.supply) {
    return { cost, secrets, why, blocked: `costs ${cost} Supply, you have ${player.supply} (Law §5.6.1)` };
  }
  return { cost, secrets, why };
}

/**
 * Shrouded Wood's other clause (§11.7): if an enemy (§10.7) rules it, that
 * ruler picks where you go. The seats who would choose — empty unless the
 * traveller is leaving a faceup Shrouded Wood ruled by an enemy.
 */
export function shroudedRulers(state: OathState, seat: number): number[] {
  const player = state.players[seat];
  if (player.pawnSite !== SHROUDED_WOOD) return [];
  const imperial = (s: number) => state.players[s].citizenship !== 'exile';
  return rulersOf(state, SHROUDED_WOOD).filter(
    (r) => r !== seat && (imperial(seat) ? !imperial(r) : true),
  );
}
