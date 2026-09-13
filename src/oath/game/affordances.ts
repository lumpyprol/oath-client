/**
 * `affordances(state, seat)` (unit 4 of P4) — D56's seam: the SERVER
 * computes what a client may offer, the client only draws it. A client
 * that decided any of this — which sites a pawn can reach, at what Supply
 * cost; which denizens can be mustered; how many warbands may be committed
 * — would be a second implementation of the Law, exactly the failure P3's
 * post-mortem named (three copies of one rule, each subtly wrong). So the
 * option space is derived HERE, once, from the same state and the same
 * helpers the reducer uses, and a conformance harness
 * (`test/oath/game/affordances.ts`) ties the two together: every option
 * this offers, `reduce` must accept; every option it marks `disabled`,
 * `reduce` must refuse.
 *
 * DRIVEN BY `pending()`. The set of action types a seat may submit right
 * now is exactly the union of `resolves` across the pending decisions that
 * name that seat — so this takes the pending list as an argument (computed
 * by the caller, avoiding a cycle with index.ts) and describes only the
 * types it finds there. Consequences that fall out for free:
 *   - a locked state (a Campaign phase, a mid-Search hand, the §1.23 setup
 *     window) offers only what THAT decision resolves — this unit describes
 *     none of those types yet, so a locked seat gets an empty list;
 *   - a seat with no pending decision at all (it is someone else's
 *     ordinary turn) gets an empty list.
 * `standing.set` is legal off-turn too (it is the one action that bypasses
 * `requireActiveSeat`), but it is surfaced here only where a decision names
 * it — the `turn` decision's `resolves` — which is during your own turn.
 * The contract is one-directional (every ENTRY must be legal; not every
 * legal action must be an entry), so under-offering an always-legal action
 * is honest, and keeps a locked state's option list equal to its
 * decision's `resolves` — which is what the harness asserts.
 *
 * LABELS are generated from card ids and PUBLIC state only (D20: the engine
 * never reads card text, and neither does this). A site's NAME — "Mine" —
 * is structural id-derived data, fine to show; its printed rules text is
 * not, and never appears. A facedown site (or, in later units, an unpeeked
 * relic slot) labels as its POSITION, never its identity.
 *
 * This unit wires three shapes (turn.rest, travel, standing.set); units 5
 * and 6 fill in the rest, additively — a new describer, never a rewrite of
 * this file's contract.
 */

import type { PendingDecision } from '../../engine/types.js';
import { byId } from '../cards/index.js';
import { travelCost } from './map.js';
import { STANDING_CHANNELS, type OathState } from './state.js';

/** A resource cost attached to an option, for the client to render beside it. */
export interface Cost {
  supply?: number;
  favor?: number;
  secrets?: number;
}

export interface Option {
  /** What goes into the payload field when this option is chosen. */
  value: unknown;
  /** Human-readable, generated from ids + public state — never card text. */
  label: string;
  cost?: Cost;
  /** Present iff a client should show this greyed; the string is the reason. A disabled option is NOT claimed legal. */
  disabled?: string;
}

export type Field =
  | { name: string; kind: 'choose-one' | 'choose-many'; options: Option[]; max?: number }
  | { name: string; kind: 'count'; min: number; max: number }
  | { name: string; kind: 'flag' }
  | { name: string; kind: 'free'; schema: string };

export interface Affordance {
  type: string;
  /** The pending decision this action would act within, when there is one. */
  decisionId?: string;
  fields: Field[];
  note?: string;
}

/** A describer builds one entry from state + the seat, or null if — despite the type being submittable — there is nothing to offer. */
type Describer = (state: OathState, seat: number) => Affordance | null;

function describeRest(): Affordance {
  return { type: 'turn.rest', fields: [], note: 'End your turn (Rest — Law §4.3).' };
}

function siteLabel(state: OathState, i: number): string {
  const site = state.sites[i];
  const region = site.region;
  // A facedown site's identity is hidden (Law §2.8/§9.4) — label by
  // position, exactly as an unpeeked relic slot will be. A faceup site's
  // NAME is public structural data (not its printed text), fine to show.
  if (site.facedown) return `Slot ${i}: facedown site (${region})`;
  return `${byId(site.id).name} (${region})`;
}

function describeTravel(state: OathState, seat: number): Affordance | null {
  const player = state.players[seat];
  const from = state.sites.find((s) => s.id === player.pawnSite);
  if (!from) return null; // no pawn placed — cannot travel (should not co-occur with a turn decision)
  const options: Option[] = [];
  state.sites.forEach((site, i) => {
    if (site.id === player.pawnSite) return; // "already on that site" is illegal, never an option (Law §5.6.1)
    const cost = travelCost(from.region, site.region); // Law §5.6.1 — the ONE definition, not re-derived
    const option: Option = {
      value: i,
      label: siteLabel(state, i),
      cost: { supply: cost },
    };
    if (player.supply < cost) {
      option.disabled = `costs ${cost} Supply, you have ${player.supply} (Law §5.6.1)`;
    }
    options.push(option);
  });
  // The contract: an entry appears only if the seat COULD submit it now.
  // With every destination unaffordable, travel is not submittable — no
  // entry, rather than a form whose every option is greyed.
  if (options.every((o) => o.disabled)) return null;
  return { type: 'travel', fields: [{ name: 'siteIndex', kind: 'choose-one', options }] };
}

function describeStanding(state: OathState, seat: number): Affordance {
  const p = state.players[seat];
  // Each channel is a choose-one over its legal answers. The seat's current
  // answer is not disabled — re-affirming a policy is a legal no-op — it is
  // just the value already in effect (a client renders it as selected).
  const channel = (name: 'defense' | 'ally' | 'warbands'): Field => ({
    name,
    kind: 'choose-one',
    options: STANDING_CHANNELS[name].map((value) => ({
      value,
      label: value === p.standing[name] ? `${value} (current)` : value,
    })),
  });
  return {
    type: 'standing.set',
    fields: [channel('defense'), channel('ally'), channel('warbands')],
    note: 'Standing responses (Law/HLD D52): answer these once so the engine stops asking (P3 unit 6).',
  };
}

/** Stable order; additive as later units register more. */
const DESCRIBERS: Record<string, Describer> = {
  'turn.rest': describeRest,
  travel: describeTravel,
  'standing.set': describeStanding,
};

/**
 * The option space for `seat`, given the pending decisions already computed
 * for this state. Spectators (`seat === null`) and finished games get
 * nothing.
 */
export function computeAffordances(
  state: OathState,
  seat: number | null,
  pending: PendingDecision[],
): Affordance[] {
  if (seat === null || state.complete) return [];

  // type -> the id of the (first) pending decision for this seat that names
  // it. That is the decision the action acts within, surfaced as decisionId.
  const decisionOf = new Map<string, string>();
  for (const d of pending) {
    if (d.seat !== seat) continue;
    for (const type of d.resolves) {
      if (!decisionOf.has(type)) decisionOf.set(type, d.id);
    }
  }

  const out: Affordance[] = [];
  for (const [type, describe] of Object.entries(DESCRIBERS)) {
    if (!decisionOf.has(type)) continue;
    const entry = describe(state, seat);
    if (!entry) continue;
    const decisionId = decisionOf.get(type);
    if (decisionId !== undefined) entry.decisionId = decisionId;
    out.push(entry);
  }
  return out;
}
