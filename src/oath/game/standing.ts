/**
 * Standing responses (P3 unit 6; HLD D52) — the machinery that lets a seat
 * answer a decision before it is asked, so an async game does not stall on
 * a question whose answer never changes.
 *
 * ---- THE ONE INVARIANT --------------------------------------------------
 *
 * A SHORT-CIRCUIT NEVER APPENDS AN ACTION.
 *
 * The engine consults a policy at the exact point it would otherwise raise a
 * pending decision, and resolves it inline, inside the reduce of whatever
 * action caused the raise. The log therefore shows the RAISING action and a
 * state in which the decision never existed — no synthetic "seat 3 declined"
 * row, no fabricated actor.
 *
 * That is not a shortcut, it is the whole correctness argument:
 *
 *   - **Replay is identical.** The policy is STATE, reached by folding the
 *     log, so a refold consults the same policy at the same point and takes
 *     the same branch. A synthetic action would have to be invented
 *     identically on every replay, and would corrupt actor attribution and
 *     `prevSeq` besides.
 *   - **The log stays complete.** The cause of a skipped window IS in the
 *     log — earlier, as the `standing.set` that wrote the policy. Reading
 *     backwards from a short-circuited campaign always finds it.
 *   - **Rollback works for free.** Rewinding past the `standing.set`
 *     restores the previous policy along with everything else, so the next
 *     raise behaves the old way. No special case.
 *
 * ---- WHY `consult` RETURNS RATHER THAN RESOLVES -------------------------
 *
 * The plan sketched this as one `raiseOrResolve(state, decision, answer)`
 * covering every site. It is not written that way, and the reason is worth
 * recording: the two raise points wired in unit 6 do genuinely different
 * work with the answer — a passing Citizen gets recorded into the campaign's
 * join bookkeeping, while an allowed warband move applies a list of effects
 * and a denied one throws. Forcing both through one "and now resolve it"
 * callback would have meant passing closures that share nothing, which is
 * ad-hoc dispatch wearing a helper's name.
 *
 * What IS genuinely shared is the decision to ask at all, and that is what
 * lives here. Every consult site reads the same way:
 *
 *     const answer = consultStanding(state, seat, 'channel');
 *     if (answer === 'ask') { ...raise the decision... }
 *     else { ...apply the answer, appending nothing... }
 *
 * so the "ad hoc ifs at each site" the plan warned against are one shape
 * stated twice, not two policies.
 */

import type { OathState, StandingPolicy } from './state.js';
import { DEFAULT_STANDING } from './state.js';

/**
 * What `seat` has decided in advance about `channel`, or `'ask'` when they
 * want the question. Tolerates a missing policy object by reading as the
 * all-`'ask'` default, so a state built before unit 6 behaves exactly as it
 * did rather than throwing here — `checkInvariants` is what complains about
 * a malformed policy, and it does so with a better message.
 */
export function consultStanding<K extends keyof StandingPolicy>(
  state: OathState,
  seat: number,
  channel: K,
): StandingPolicy[K] {
  const standing = state.players[seat]?.standing;
  return (standing?.[channel] ?? DEFAULT_STANDING[channel]) as StandingPolicy[K];
}
