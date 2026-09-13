/**
 * `affordances(state, seat)` (P4 units 4-5) — D56's seam: the SERVER
 * computes what a client may offer, the client only draws it. A client
 * that decided any of this — which sites a pawn can reach and at what cost,
 * which denizens can be mustered, which relic a slot holds — would be a
 * second implementation of the Law, exactly the failure P3's post-mortem
 * named. So the option space is derived HERE, once, from the same state and
 * the SAME predicates the reducers use (never a second transcription of a
 * rule — D48/D55), and a conformance harness (`test/oath/game/
 * affordances.ts`) ties the two together: every option offered, `reduce`
 * must accept; every option marked `disabled`, `reduce` must refuse.
 *
 * DRIVEN BY `pending()`. The action types a seat may submit now are exactly
 * the union of `resolves` across the pending decisions naming that seat, so
 * this takes the pending list (computed by the caller, avoiding a cycle
 * with index.ts) and describes only the types it finds there. A locked
 * state (a Campaign phase, mid-Search, the §1.23 window) therefore offers
 * only what THAT decision resolves — mid-Search yields exactly `card.play`,
 * a Campaign yields none of the below.
 *
 * LABELS are generated from card ids and PUBLIC/OWN state only (D20: the
 * engine never reads card text, and neither does this). A site's NAME —
 * "Mine" — is structural id-derived data, fine to show; its printed rules
 * text is not. A facedown site, or a relic slot this seat has NOT peeked
 * (unit 2/3), labels by POSITION, never identity — and a peeked relic slot
 * labels by name, which is where the Peek family first pays off in the UI.
 *
 * MULTIPLE ENTRIES PER TYPE are allowed and used: `recover` yields one
 * entry for relics and one per recoverable banner; `warbands.move` one per
 * legal direction/target; `card.play` one per drawn card (plus a facedown
 * variant). A describer returns an array; `computeAffordances` flattens and
 * stamps each with the decision it acts within.
 *
 * `power.use` is deliberately NOT harness-verifiable: v1 does not know what
 * a card does (D9/D28), so its `effects` are a `free` field the harness
 * cannot synthesize and therefore skips. Its dry run (unit 7) is how a
 * player checks a declaration.
 */

import type { PendingDecision } from '../../engine/types.js';
import { byId } from '../cards/index.js';
import type { Site } from '../cards/schema.js';
import { travelCost } from './map.js';
import {
  ADVISER_LIMIT,
  CONSPIRACY_ID,
  STANDING_CHANNELS,
  type OathState,
  type PlayerState,
  type SiteState,
} from './state.js';
import { isRestricted, restrictionKnown } from './restrictions.js';
import { rulersOf, chancellorSeatOf } from './rule.js';
import { consultStanding } from './standing.js';
import { worldDeckCost } from './actions/search.js';
import { darkestSecretRecoverable, relicRecoverCost } from './actions/recover.js';
import { hasAccess, reliquaryPowerId } from './actions/power.js';

/** A resource cost attached to an option, for the client to render beside it. */
export interface Cost {
  supply?: number;
  favor?: number;
  secrets?: number;
}

export interface Option {
  /** What goes into the payload field when this option is chosen. */
  value: unknown;
  /** Human-readable, generated from ids + public/own state — never card text. */
  label: string;
  cost?: Cost;
  /** Present iff a client should show this greyed; the string is the reason. A disabled option is NOT claimed legal. */
  disabled?: string;
}

export type Field =
  | { name: string; kind: 'choose-one' | 'choose-many'; options: Option[]; max?: number }
  // `deferred` marks a bound the reducer does NOT enforce at submit — a
  // permissioned warband move creates a request and validates the count
  // only when it is granted (Law §6.5). The bound is still the right thing
  // for a client to offer; the harness just cannot assert max+1 is refused
  // at submit for it. Absent/false means submit-enforced (the usual case).
  | { name: string; kind: 'count'; min: number; max: number; deferred?: boolean }
  | { name: string; kind: 'flag' }
  | { name: string; kind: 'free'; schema: string };

export interface Affordance {
  type: string;
  /** The pending decision this action would act within, when there is one. */
  decisionId?: string;
  fields: Field[];
  note?: string;
}

/** A describer builds the entries for its action type — zero, one, or many. */
type Describer = (state: OathState, seat: number) => Affordance[];

// ---- small shared helpers -------------------------------------------------

const pawnSiteOf = (state: OathState, seat: number): SiteState | undefined =>
  state.sites.find((s) => s.id === state.players[seat].pawnSite);

/** A card at a site that Muster/Trade can target: a non-ruined denizen/intact edifice with no favor or secrets on it (Law §5.2.1/§5.3.2). */
function tokenFreeSuitedCards(site: SiteState): { id: string }[] {
  return site.cards.filter(
    (c): c is NonNullable<typeof c> =>
      c !== null && !c.ruined && 'suit' in byId(c.id) && c.favor === 0 && c.secrets === 0,
  );
}

// ---- the wired shapes -----------------------------------------------------

function describeRest(): Affordance[] {
  return [{ type: 'turn.rest', fields: [], note: 'End your turn (Rest — Law §4.3).' }];
}

function siteLabel(state: OathState, i: number): string {
  const site = state.sites[i];
  if (site.facedown) return `Slot ${i}: facedown site (${site.region})`;
  return `${byId(site.id).name} (${site.region})`;
}

function describeTravel(state: OathState, seat: number): Affordance[] {
  const player = state.players[seat];
  const from = pawnSiteOf(state, seat);
  if (!from) return [];
  const options: Option[] = [];
  state.sites.forEach((site, i) => {
    if (site.id === player.pawnSite) return; // "already on that site" is illegal, never an option
    const cost = travelCost(from.region, site.region); // Law §5.6.1 — the ONE definition
    const option: Option = { value: i, label: siteLabel(state, i), cost: { supply: cost } };
    if (player.supply < cost) {
      option.disabled = `costs ${cost} Supply, you have ${player.supply} (Law §5.6.1)`;
    }
    options.push(option);
  });
  if (options.every((o) => o.disabled)) return []; // can't move at all → no entry
  return [{ type: 'travel', fields: [{ name: 'siteIndex', kind: 'choose-one', options }] }];
}

function describeStanding(state: OathState, seat: number): Affordance[] {
  const p = state.players[seat];
  const channel = (name: 'defense' | 'ally' | 'warbands'): Field => ({
    name,
    kind: 'choose-one',
    options: STANDING_CHANNELS[name].map((value) => ({
      value,
      label: value === p.standing[name] ? `${value} (current)` : value,
    })),
  });
  return [
    {
      type: 'standing.set',
      fields: [channel('defense'), channel('ally'), channel('warbands')],
      note: 'Standing responses (HLD D52): answer once so the engine stops asking (P3 unit 6).',
    },
  ];
}

// ---- unit 5: the major and minor actions ----------------------------------

function describeSearch(state: OathState, seat: number): Affordance[] {
  const p = state.players[seat];
  const site = pawnSiteOf(state, seat);
  if (!site) return [];
  const options: Option[] = [];
  const deckCost = worldDeckCost(state.visionsDrawn); // §5.1.1, off the Visions Drawn track — not restated
  if (state.worldDeck.length > 0 && p.supply >= deckCost) {
    options.push({ value: 'deck', label: `World deck — draw 3 (${deckCost} Supply)`, cost: { supply: deckCost } });
  }
  const discardCost = 2; // §5.1.1
  if (state.discards[site.region].length > 0 && p.supply >= discardCost) {
    options.push({
      value: 'discard',
      label: `${site.region} discard — draw 3 (${discardCost} Supply)`,
      cost: { supply: discardCost },
    });
  }
  // §5.1.1: if you can afford no source, you cannot search at all — absent,
  // not a greyed form (the plan's deliberate contrast with muster).
  if (options.length === 0) return [];
  return [{ type: 'search', fields: [{ name: 'from', kind: 'choose-one', options }] }];
}

function describeMuster(state: OathState, seat: number): Affordance[] {
  const p = state.players[seat];
  const site = pawnSiteOf(state, seat);
  if (!site) return [];
  const targets = tokenFreeSuitedCards(site);
  if (targets.length === 0) return []; // nothing to muster from
  const reason =
    p.supply < 1
      ? `costs 1 Supply, you have ${p.supply} (Law §5.2.1)`
      : p.favor < 1
        ? `needs 1 favor, you have ${p.favor} (Law §5.2.1)`
        : undefined;
  const options: Option[] = targets.map((c) => ({
    value: c.id,
    label: byId(c.id).name,
    cost: { supply: 1, favor: 1 },
    ...(reason ? { disabled: reason } : {}),
  }));
  return [{ type: 'muster', fields: [{ name: 'cardId', kind: 'choose-one', options }] }];
}

function describeTrade(state: OathState, seat: number): Affordance[] {
  const p = state.players[seat];
  const site = pawnSiteOf(state, seat);
  if (!site) return [];
  const targets = tokenFreeSuitedCards(site);
  if (targets.length === 0) return [];
  const canFavor = p.supply >= 1 && p.secrets.ready >= 1; // §5.3.2.I: place 1 secret
  const canSecrets = p.supply >= 1 && p.favor >= 2; // §5.3.2.II: place 2 favor
  if (!canFavor && !canSecrets) return []; // can afford neither resource → no trade
  const forReason = (ok: boolean, needSecret: boolean): string | undefined => {
    if (ok) return undefined;
    if (p.supply < 1) return `costs 1 Supply, you have ${p.supply} (Law §5.3.1)`;
    return needSecret ? `needs 1 ready secret (Law §5.3.2)` : `needs 2 favor, you have ${p.favor} (Law §5.3.2)`;
  };
  return [
    {
      type: 'trade',
      fields: [
        { name: 'cardId', kind: 'choose-one', options: targets.map((c) => ({ value: c.id, label: byId(c.id).name })) },
        {
          name: 'for',
          kind: 'choose-one',
          options: [
            { value: 'favor', label: 'gain favor (place 1 secret)', ...(canFavor ? {} : { disabled: forReason(false, true)! }) },
            { value: 'secrets', label: 'gain secrets (place 2 favor)', ...(canSecrets ? {} : { disabled: forReason(false, false)! }) },
          ],
        },
      ],
    },
  ];
}

/** Which of a relic-recover's costs (supply first, then §5.4.2 resource) this seat cannot pay — matching the order `recover` throws in. */
function relicRecoverBlock(p: PlayerState, cost: Cost): string | undefined {
  if (p.supply < (cost.supply ?? 0)) return `needs ${cost.supply} Supply, you have ${p.supply} (Law §5.4.1)`;
  if (cost.favor !== undefined && p.favor < cost.favor) return `needs ${cost.favor} favor, you have ${p.favor} (Law §5.4.2)`;
  if (cost.secrets !== undefined && p.secrets.ready < cost.secrets) {
    return `needs ${cost.secrets} secret(s), you have ${p.secrets.ready} (Law §5.4.2)`;
  }
  return undefined;
}

function describeRecover(state: OathState, seat: number): Affordance[] {
  const p = state.players[seat];
  const site = pawnSiteOf(state, seat);
  if (!site) return [];
  const out: Affordance[] = [];

  // --- relics at your site (Law §5.4.1/§5.4.2), addressed by SLOT ----------
  // The site's recover cost is flat across its relics, so it is all-or-
  // nothing: offered only when affordable (like travel/search, not greyed
  // like muster — a `target`-only fold with no legal slot would be a
  // malformed payload, not an honest disabled option).
  if (site.relics.length > 0 && (byId(site.id) as Site).recoverCost !== null) {
    const cost = relicRecoverCost(byId(site.id) as Site); // the ONE cost definition
    if (relicRecoverBlock(p, cost) === undefined) {
      const options: Option[] = site.relics.map((relicId, i) => ({
        // unit 3 payoff: a peeked slot shows the relic's NAME; otherwise its position.
        value: i,
        label: p.peeked.includes(relicId) ? byId(relicId).name : `Slot ${i}`,
        cost,
      }));
      out.push({
        type: 'recover',
        fields: [
          { name: 'target', kind: 'choose-one', options: [{ value: 'relic', label: 'Recover a facedown relic' }] },
          { name: 'relicIndex', kind: 'choose-one', options },
        ],
      });
    }
  }

  // --- the two banners (Law §5.4.2/§5.4.4), pay is a bounded count ----------
  const peoples = state.banners.find((b) => b.id === 'banner:peoples-favor')!;
  if (p.supply >= 1 && p.favor >= peoples.tokens + 1) {
    out.push({
      type: 'recover',
      fields: [
        { name: 'target', kind: 'choose-one', options: [{ value: 'banner', label: "The People's Favor" }] },
        { name: 'bannerId', kind: 'choose-one', options: [{ value: 'peoples-favor', label: "People's Favor" }] },
        // §5.4.2: "any amount of favor greater than its current value" — so min is tokens+1, max your favor.
        { name: 'pay', kind: 'count', min: peoples.tokens + 1, max: p.favor },
      ],
    });
  }

  const darkest = state.banners.find((b) => b.id === 'banner:darkest-secret')!;
  const dsHolder = darkest.holder;
  // §5.4.1: only from yourself, an unclaimed banner, or a holder whose site has an unmatched card.
  const dsAllowed = dsHolder === null || dsHolder === seat || darkestSecretRecoverable(state, dsHolder);
  // §5.4.4: you first TAKE back part of the old stake, THEN pay — so the
  // secrets you take fund part of the payment. From yourself or an
  // unclaimed banner you take all `tokens`; from another holder you take 1.
  // The reducer applies the take before the pay, so the real ceiling on
  // `pay` is your ready secrets PLUS what you take back.
  const received = dsHolder === null || dsHolder === seat ? darkest.tokens : 1;
  const dsMaxPay = p.secrets.ready + received;
  if (dsAllowed && p.supply >= 1 && dsMaxPay >= darkest.tokens + 1) {
    out.push({
      type: 'recover',
      fields: [
        { name: 'target', kind: 'choose-one', options: [{ value: 'banner', label: 'The Darkest Secret' }] },
        { name: 'bannerId', kind: 'choose-one', options: [{ value: 'darkest-secret', label: 'Darkest Secret' }] },
        { name: 'pay', kind: 'count', min: darkest.tokens + 1, max: dsMaxPay },
      ],
    });
  }
  return out;
}

function describeCardPlay(state: OathState, seat: number): Affordance[] {
  const p = state.players[seat];
  if (p.hand.length === 0) return []; // only mid-Search (Law §5.1.4)
  const site = pawnSiteOf(state, seat);
  const underLimit = p.advisers.length < ADVISER_LIMIT;
  const out: Affordance[] = [];

  p.hand.forEach((cardId, i) => {
    const isVision = cardId.startsWith('vision:');
    const isConspiracy = cardId === CONSPIRACY_ID;
    const handField: Field = {
      name: 'handIndex',
      kind: 'choose-one',
      options: [{ value: i, label: byId(cardId).name }], // your OWN hand — id legitimate (oracle table's 'own' row)
    };
    const note = restrictionKnown(cardId)
      ? undefined
      : `§7.2 restrictions for ${cardId} were never transcribed (D46) — self-policed, offered as-is.`;

    // Entry A: the destinations legal at their default (faceup / no discard).
    const asOptions: Option[] = [{ value: 'discard', label: 'Discard' }];
    if (!isVision && !isRestricted(cardId, 'adviser') && site && site.cards.includes(null)) {
      asOptions.push({ value: 'site', label: `Play to your site (${byId(site.id).name})` });
    }
    if (!isVision && !isRestricted(cardId, 'site') && underLimit) {
      asOptions.push({ value: 'adviser', label: 'Play faceup as an adviser' });
    }
    if (isVision && !isConspiracy && p.citizenship === 'exile') {
      asOptions.push({ value: 'vision', label: 'Reveal on your Vision space' });
    }
    out.push({
      type: 'card.play',
      fields: [handField, { name: 'as', kind: 'choose-one', options: asOptions }],
      ...(note ? { note } : {}),
    });

    // Entry B: a FACEDOWN adviser — legal for any card while under the
    // limit (§7.2 exempts facedown cards), and the only way to keep a Vision
    // as an adviser (§5.1.4.3). facedown is fixed true, so no illegal
    // faceup-Vision combo is ever offered.
    if (underLimit) {
      out.push({
        type: 'card.play',
        fields: [
          handField,
          { name: 'as', kind: 'choose-one', options: [{ value: 'adviser', label: 'Play facedown as an adviser' }] },
          { name: 'facedown', kind: 'choose-one', options: [{ value: true, label: 'facedown' }] },
        ],
        ...(note ? { note } : {}),
      });
    }
  });
  return out;
}

function describeAdviserPlay(state: OathState, seat: number): Affordance[] {
  const p = state.players[seat];
  const out: Affordance[] = [];
  p.advisers.forEach((a, i) => {
    if (!a.facedown) return; // §6.1 reaches only facedown advisers
    const cardId = a.id;
    const isVision = cardId.startsWith('vision:');
    const isConspiracy = cardId === CONSPIRACY_ID;
    const asOptions: Option[] = [{ value: 'discard', label: 'Discard' }];
    const canFaceup = isVision
      ? !isConspiracy && p.citizenship === 'exile' // §5.1.4.3 via §6.1
      : !isRestricted(cardId, 'site'); // a site-only card cannot turn faceup here (§7.2.1)
    if (canFaceup) asOptions.push({ value: 'faceup', label: 'Play faceup' });
    const note = restrictionKnown(cardId)
      ? undefined
      : `§7.2 restrictions for ${cardId} were never transcribed (D46) — self-policed, offered as-is.`;
    out.push({
      type: 'adviser.play',
      fields: [
        { name: 'adviserIndex', kind: 'choose-one', options: [{ value: i, label: byId(cardId).name }] },
        { name: 'as', kind: 'choose-one', options: asOptions },
      ],
      ...(note ? { note } : {}),
    });
  });
  return out;
}

function describeWarbandsMove(state: OathState, seat: number): Affordance[] {
  const p = state.players[seat];
  const site = pawnSiteOf(state, seat);
  if (!site) return [];
  const out: Affordance[] = [];
  const here = site.warbands[seat]; // your warbands at your site — public (§9.4)
  const board = p.warbands.board;
  const isCitizen = p.citizenship === 'citizen';
  const permissionPending = state.warbandRequest !== null;

  // toBoard: "any number ... except the last one" (Law §6.5). A Citizen
  // needs the Chancellor's permission for THIS direction only.
  if (here >= 2) {
    const chancellor = isCitizen ? chancellorSeatOf(state) : null;
    const denied = chancellor !== null && consultStanding(state, chancellor, 'warbands') === 'deny';
    const blockedByPending = chancellor !== null && permissionPending; // a second permissioned move is illegal-state
    if (!denied && !blockedByPending) {
      out.push({
        type: 'warbands.move',
        fields: [
          { name: 'direction', kind: 'choose-one', options: [{ value: 'toBoard', label: 'Bring warbands home to your board' }] },
          { name: 'count', kind: 'count', min: 1, max: here - 1 },
        ],
        ...(chancellor !== null ? { note: `needs the Chancellor's permission (Law §6.5)` } : {}),
      });
    }
  }

  // toSite: reinforce a site you rule (Law §6.5) — no permission.
  if (board >= 1 && rulersOf(state, site.id).includes(seat)) {
    out.push({
      type: 'warbands.move',
      fields: [
        { name: 'direction', kind: 'choose-one', options: [{ value: 'toSite', label: 'Move warbands onto your site' }] },
        { name: 'count', kind: 'count', min: 1, max: board },
      ],
    });
  }

  // give / take: between two Imperial players co-located at your site, with
  // the OTHER player's permission (Law §6.5). One entry per eligible target
  // so `count`'s bound (your board for give, their board for take) is exact.
  if (p.citizenship !== 'exile' && !permissionPending) {
    state.players.forEach((other, t) => {
      if (t === seat || other.citizenship === 'exile') return;
      if (other.pawnSite !== site.id) return;
      if (consultStanding(state, t, 'warbands') === 'deny') return; // would bounce — not offerable
      if (board >= 1) {
        out.push({
          type: 'warbands.move',
          fields: [
            { name: 'direction', kind: 'choose-one', options: [{ value: 'give', label: `Give warbands to seat ${t}` }] },
            { name: 'target', kind: 'choose-one', options: [{ value: t, label: `seat ${t}` }] },
            { name: 'count', kind: 'count', min: 1, max: board, deferred: true },
          ],
          note: `needs seat 's permission (Law §6.5)`,
        });
      }
      if (other.warbands.board >= 1) {
        out.push({
          type: 'warbands.move',
          fields: [
            { name: 'direction', kind: 'choose-one', options: [{ value: 'take', label: `Take warbands from seat ${t}` }] },
            { name: 'target', kind: 'choose-one', options: [{ value: t, label: `seat ${t}` }] },
            { name: 'count', kind: 'count', min: 1, max: other.warbands.board, deferred: true },
          ],
          note: `needs seat ${t}'s permission (Law §6.5)`,
        });
      }
    });
  }
  return out;
}

function describePowerUse(state: OathState, seat: number): Affordance[] {
  // Candidate ids: everything §7.1.1 could grant access to — filtered by
  // hasAccess, the ONE authority. All survivors are public-to-this-seat
  // (faceup, held, or ruled), so listing them leaks nothing.
  const candidates = new Set<string>();
  for (const a of state.players[seat].advisers) if (!a.facedown) candidates.add(a.id);
  for (const r of state.players[seat].relics) candidates.add(r);
  candidates.add('banner:peoples-favor');
  candidates.add('banner:darkest-secret');
  for (const space of state.reliquary) candidates.add(reliquaryPowerId(space.modifier));
  for (const site of state.sites) {
    if (site.facedown) continue;
    candidates.add(site.id);
    for (const c of site.cards) if (c) candidates.add(c.id);
  }
  const accessible = [...candidates].filter((id) => hasAccess(state, seat, id));
  if (accessible.length === 0) return [];
  // Reliquary power ids ("reliquary:brutal") are board furniture, not cards
  // in the P1 database — label them from the modifier, not via byId.
  const powerLabel = (id: string): string =>
    id.startsWith('reliquary:') ? `Imperial Reliquary — ${id.slice('reliquary:'.length)}` : byId(id).name;
  return [
    {
      type: 'power.use',
      fields: [
        { name: 'cardId', kind: 'choose-one', options: accessible.map((id) => ({ value: id, label: powerLabel(id) })) },
        { name: 'effects', kind: 'free', schema: 'Effect[] (EffectsSchema) — the declared effects' },
      ],
      note:
        'v1 does not know what a card does (D9/D28): it checks access and feasibility, not that the effects match the printed power. Use the dry run (unit 7) to check a declaration.',
    },
  ];
}

// ---- registration & assembly ----------------------------------------------

/** Stable order; additive as later units register more. */
const DESCRIBERS: Record<string, Describer> = {
  'turn.rest': describeRest,
  travel: describeTravel,
  'standing.set': describeStanding,
  search: describeSearch,
  muster: describeMuster,
  trade: describeTrade,
  recover: describeRecover,
  'card.play': describeCardPlay,
  'adviser.play': describeAdviserPlay,
  'warbands.move': describeWarbandsMove,
  'power.use': describePowerUse,
};

export function computeAffordances(
  state: OathState,
  seat: number | null,
  pending: PendingDecision[],
): Affordance[] {
  if (seat === null || state.complete) return [];

  // type -> the id of the (first) pending decision for this seat that names it.
  const decisionOf = new Map<string, string>();
  for (const d of pending) {
    if (d.seat !== seat) continue;
    for (const type of d.resolves) if (!decisionOf.has(type)) decisionOf.set(type, d.id);
  }

  const out: Affordance[] = [];
  for (const [type, describe] of Object.entries(DESCRIBERS)) {
    if (!decisionOf.has(type)) continue;
    const decisionId = decisionOf.get(type)!;
    for (const entry of describe(state, seat)) {
      entry.decisionId = decisionId;
      out.push(entry);
    }
  }
  return out;
}
