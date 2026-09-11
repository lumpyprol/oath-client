/**
 * Law §10.21 "Rule" + §6.6.3 "Imperial Players" (unit 16 follow-up). Shared
 * by `campaign.ts` (target/defender legality) and `power.ts` (access) so
 * the Imperial-site extension is defined exactly once rather than drifting
 * between two copies.
 *
 * Base rule (§10.21): "A player rules each face-up site that has any of
 * their warbands on it." Our per-seat `site.warbands[seat]` array already
 * gives this directly.
 *
 * §6.6.3's extension: "Citizens and the Chancellor are Imperial players.
 * Every Imperial player rules every site that has any number of Imperial
 * (purple) warbands on it." Every warband a Chancellor or Citizen seat
 * holds is physically purple (Law §1.15) — our per-seat attribution of
 * WHICH purple warbands sit where is bookkeeping only, never a literal
 * ownership mark on the physical piece (the same fact unit 7's Muster
 * header already established). So once a site carries ANY Imperial seat's
 * warbands, Law says EVERY Imperial player rules it, not just the specific
 * seat our bookkeeping happens to credit.
 *
 * §5.5.1's carve-out: "If you are a Citizen attacking the Chancellor or
 * another Citizen, you are not an Imperial player during this Campaign.
 * If you are the Chancellor attacking a Citizen, that Citizen is not an
 * Imperial player during this Campaign." This suspends ONE named seat's
 * Imperial status for the duration of one specific Campaign between two
 * Imperial parties — otherwise the extension above would let a Citizen
 * "rule" the very Chancellor site they're attacking (or vice versa),
 * which is incoherent. `excludeImperial` names seats to treat as NOT
 * Imperial for one call; `campaign.ts` computes it once at `declare` from
 * that Campaign's attacker/defender citizenship and threads it through.
 * `power.ts` never passes it — ordinary power access has no such carve-out.
 */

import type { OathState } from './state.js';

export function chancellorSeatOf(state: OathState): number {
  return state.players.findIndex((p) => p.citizenship === 'chancellor');
}

/**
 * Every Imperial seat (Chancellor + every Citizen) not named in
 * `excludeImperial` (unit 16a) — the same set `rulersOf` grants ruling
 * to, exported directly since `campaign.ts`'s defense-total/casualty
 * arithmetic and unit 16c's title-defense dice need the SET itself
 * ("who's in the force"), not "does seat X rule site Y".
 */
export function imperialForce(state: OathState, excludeImperial: readonly number[] = []): number[] {
  return state.players
    .map((_, seat) => seat)
    .filter((seat) => state.players[seat].citizenship !== 'exile' && !excludeImperial.includes(seat));
}

export function rulersOf(
  state: OathState,
  siteId: string,
  excludeImperial: readonly number[] = [],
): number[] {
  const site = state.sites.find((s) => s.id === siteId);
  if (!site || site.facedown) return [];
  const direct = site.warbands.flatMap((w, seat) => (w > 0 ? [seat] : []));
  const hasImperialPresence = direct.some((seat) => state.players[seat].citizenship !== 'exile');
  if (!hasImperialPresence) return direct; // Law §10.21's base rule only

  const exileRulers = direct.filter((seat) => state.players[seat].citizenship === 'exile');
  return [...new Set([...imperialForce(state, excludeImperial), ...exileRulers])];
}

/**
 * Law §5.5.1's Campaign-scoped carve-out, computed once per declared
 * Campaign from the attacker/defender's citizenship at declare time.
 * Citizenship cannot change mid-Campaign (every `citizenship.*` action is
 * illegal-state while `state.campaign` is set — `turn.ts#requireActiveSeat`
 * defaults `campaignOk` to false and no citizenship action opts in), so
 * it's safe to recompute this from CURRENT state at resolve time too.
 */
export function imperialExclusionFor(
  state: OathState,
  attackerSeat: number,
  defenderSeat: number | 'bandits',
): number[] {
  if (defenderSeat === 'bandits') return [];
  const attacker = state.players[attackerSeat].citizenship;
  const defender = state.players[defenderSeat].citizenship;
  const exclude: number[] = [];
  if (attacker === 'citizen' && (defender === 'chancellor' || defender === 'citizen')) {
    exclude.push(attackerSeat);
  }
  if (attacker === 'chancellor' && defender === 'citizen') {
    exclude.push(defenderSeat);
  }
  return exclude;
}
