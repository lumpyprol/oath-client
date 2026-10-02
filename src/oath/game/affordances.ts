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

import { seatTitle } from './seats.js';
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
import type { Relic } from '../cards/schema.js';
import { isRestricted, restrictionKnown } from './restrictions.js';
import { rulersOf, chancellorSeatOf, imperialExclusionFor } from './rule.js';
import { consultStanding } from './standing.js';
import { worldDeckCost } from './actions/search.js';
import { darkestSecretRecoverable, relicRecoverCost } from './actions/recover.js';
import { hasAccess, reliquaryPowerId } from './actions/power.js';
import { exileFavorCost, selfExileFavorCost } from './actions/citizenship.js';
import {
  CAMPAIGN_COST,
  PAWN_FAVOR_DICE,
  SITE_DEFENSE_DICE,
  SCEPTER_DEFENSE_DICE,
  titleDefenseDice,
  attackTotal,
  battleTotals,
  defenseTotal,
  defendingForce,
  eligibleAllyVolunteers,
  casualtyChooser,
} from './actions/campaign.js';

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
  /**
   * Presentation hints (unit 11), never rules. `group` heads a column the
   * option is listed under (Travel: the region, so the choice reads like the
   * map). `art` is the card face to draw beside it — an art-manifest key the
   * seat may already see, or `site-back` for a facedown site.
   */
  group?: string;
  art?: string;
  /** `allocate` only: the most this one option can take (e.g. the warbands actually at a location). */
  max?: number;
  /**
   * Legal only when another field of the SAME entry holds one of `values`
   * (Card: play's "to your site" fits some drawn cards, not others). A client
   * shows the option only then; the harness checks it is accepted for every
   * listed value and refused for every other option of that field.
   */
  requires?: { field: string; values: unknown[] };
}

export type Field = (
  | { name: string; kind: 'choose-one' | 'choose-many'; options: Option[]; max?: number }
  // `deferred` marks a bound the reducer does NOT enforce at submit — a
  // permissioned warband move creates a request and validates the count
  // only when it is granted (Law §6.5). The bound is still the right thing
  // for a client to offer; the harness just cannot assert max+1 is refused
  // at submit for it. Absent/false means submit-enforced (the usual case).
  | { name: string; kind: 'count'; min: number; max: number; deferred?: boolean }
  | { name: string; kind: 'flag' }
  // Spread a number across options (unit 11): the payload value is a list of
  // `{ ...option.value, count }` for each option given a nonzero count (a
  // non-object value becomes `{ value, count }`), and the counts must total
  // between `min` and `max`. Casualty kills (exactly the quota) and seizure
  // placements (up to the warbands left on the board) are both this shape.
  | { name: string; kind: 'allocate'; options: Option[]; min: number; max: number }
  | { name: string; kind: 'free'; schema: string }) & {
  /** A display heading for the field (presentation only); clients fall back to the name. */
  label?: string;
};

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

const REGION_LABEL: Record<string, string> = { cradle: 'Cradle', provinces: 'Provinces', hinterland: 'Hinterland' };

function describeTravel(state: OathState, seat: number): Affordance[] {
  const player = state.players[seat];
  const from = pawnSiteOf(state, seat);
  if (!from) return [];
  const options: Option[] = [];
  state.sites.forEach((site, i) => {
    if (site.id === player.pawnSite) return; // "already on that site" is illegal, never an option
    const cost = travelCost(from.region, site.region); // Law §5.6.1 — the ONE definition
    // Grouped by region so the form reads like the board: one column each.
    const option: Option = {
      value: i,
      label: site.facedown ? 'Facedown site' : byId(site.id).name,
      cost: { supply: cost },
      group: REGION_LABEL[site.region],
      art: site.facedown ? 'site-back' : site.id,
    };
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
    art: c.id, // a faceup card at your site — public
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
        { name: 'cardId', kind: 'choose-one', options: targets.map((c) => ({ value: c.id, label: byId(c.id).name, art: c.id })) },
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
        art: p.peeked.includes(relicId) ? relicId : 'relic-back', // the face only once peeked
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

  // ONE choice of card and ONE of destination (Ben: one form, keep a card
  // and discard the rest). A destination legal for only some cards says so
  // with `requires`, which the composer uses to show only the choices that
  // fit the chosen card, and which the harness checks both ways.
  // Discard LAST: it means "keep nothing", not "discard this one" (Ben read
  // it that way, 2026-10-01: Law §5.1.3 already bins every card not picked).
  const legal: Record<string, number[]> = { site: [], adviser: [], vision: [], facedown: [], discard: [] };
  p.hand.forEach((cardId, i) => {
    const isVision = cardId.startsWith('vision:');
    legal.discard.push(i);
    if (!isVision && !isRestricted(cardId, 'adviser') && site && site.cards.includes(null)) legal.site.push(i);
    if (!isVision && !isRestricted(cardId, 'site') && underLimit) legal.adviser.push(i);
    if (isVision && cardId !== CONSPIRACY_ID && p.citizenship === 'exile') legal.vision.push(i);
    // A FACEDOWN adviser — legal for any card while under the limit (§7.2
    // exempts facedown cards), and the only way to keep a Vision as an
    // adviser (§5.1.4.3), via the engine's `as: 'facedown'` shorthand.
    if (underLimit) legal.facedown.push(i);
  });
  const labels: Record<string, string> = {
    discard: 'Keep none: discard all of them',
    site: site ? `Play to your site (${byId(site.id).name})` : 'Play to your site',
    adviser: 'Play faceup as an adviser',
    vision: 'Reveal on your Vision space',
    facedown: 'Play facedown as an adviser',
  };
  const asOptions: Option[] = Object.entries(legal)
    .filter(([, cards]) => cards.length > 0)
    .map(([value, cards]) => ({
      value,
      label: labels[value],
      ...(value === 'site' && site ? { art: site.id } : {}), // the site's face: plain WHICH site
      ...(cards.length < p.hand.length ? { requires: { field: 'handIndex', values: cards } } : {}),
    }));
  return [
    {
      type: 'card.play',
      fields: [
        {
          name: 'handIndex',
          label: 'Keep which card (every card you do not pick is discarded)',
          kind: 'choose-one',
          // your OWN hand — ids legitimate (oracle table's 'own' row)
          options: p.hand.map((cardId, i) => ({ value: i, label: byId(cardId).name, art: cardId })),
        },
        { name: 'as', label: 'Play it', kind: 'choose-one', options: asOptions },
      ],
      note: 'You keep ONE card and play it; every other card you drew is discarded (Law §5.1.3). You may also keep none.',
    },
  ];
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
    if (canFaceup) asOptions.push({ value: 'faceup', label: 'Play faceup as an adviser' });
    // §6.1 "as if you searched": your site is a §5.1.4 destination too.
    const site = pawnSiteOf(state, seat);
    if (!isVision && !isRestricted(cardId, 'adviser') && site && site.cards.includes(null)) {
      // With the site's face, so it is plain WHICH site (Ben, 2026-10-01).
      asOptions.push({ value: 'site', label: `Play to your site (${byId(site.id).name})`, art: site.id });
    }
    const note = restrictionKnown(cardId)
      ? undefined
      : `§7.2 restrictions for ${byId(cardId).name} were never transcribed (D46) — self-policed, offered as-is.`;
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
            { name: 'direction', kind: 'choose-one', options: [{ value: 'give', label: `Give warbands to the ${seatTitle(state.players, t)}` }] },
            { name: 'target', kind: 'choose-one', options: [{ value: t, label: seatTitle(state.players, t) }] },
            { name: 'count', kind: 'count', min: 1, max: board, deferred: true },
          ],
          note: `needs seat 's permission (Law §6.5)`,
        });
      }
      if (other.warbands.board >= 1) {
        out.push({
          type: 'warbands.move',
          fields: [
            { name: 'direction', kind: 'choose-one', options: [{ value: 'take', label: `Take warbands from the ${seatTitle(state.players, t)}` }] },
            { name: 'target', kind: 'choose-one', options: [{ value: t, label: seatTitle(state.players, t) }] },
            { name: 'count', kind: 'count', min: 1, max: other.warbands.board, deferred: true },
          ],
          note: `needs the ${seatTitle(state.players, t)}'s permission (Law §6.5)`,
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

// § Peek (Law §6.3/§6.4) — free minor actions on your turn (unit 3). Both
// address a SLOT, never an id (D60), so nothing here leaks: an unpeeked
// slot labels by position, a peeked one may add the name the seat already
// knows.
function describePeekRelic(state: OathState, seat: number): Affordance[] {
  const site = pawnSiteOf(state, seat);
  if (!site || site.relics.length === 0) return [];
  const peeked = state.players[seat].peeked;
  return [
    {
      type: 'peek.relic',
      fields: [
        {
          name: 'relicIndex',
          kind: 'choose-one',
          options: site.relics.map((relicId, i) => ({
            value: i,
            label: peeked.includes(relicId) ? `Slot ${i} (${byId(relicId).name})` : `Slot ${i}`,
            // The face once you have peeked it (you know it); the back until then.
            art: peeked.includes(relicId) ? relicId : 'relic-back',
          })),
        },
      ],
      note: 'Peek at a facedown relic at your site (Law §6.3) — free.',
    },
  ];
}

function describePeekReliquary(state: OathState, seat: number): Affordance[] {
  if (seat !== state.grandScepter) return [];
  const peeked = state.players[seat].peeked;
  const covered = state.reliquary
    .map((sp, i) => ({ sp, i }))
    .filter(({ sp }) => sp.relicId !== null);
  if (covered.length === 0) return [];
  return [
    {
      type: 'peek.reliquary',
      fields: [
        {
          name: 'spaces',
          kind: 'choose-many',
          options: covered.map(({ sp, i }) => ({
            value: i,
            label: peeked.includes(sp.relicId!) ? `${sp.modifier} (${byId(sp.relicId!).name})` : `${sp.modifier} space`,
            art: peeked.includes(sp.relicId!) ? sp.relicId! : 'relic-back',
          })),
        },
      ],
      note: 'Peek at any Imperial Reliquary relics (Law §6.4) — free; Grand Scepter only.',
    },
  ];
}

// ---- unit 6: the pending decisions ----------------------------------------

// Every describer below is registered against a type that ALSO appears in
// the `turn` decision's `resolves` (RESOLVABLE_TYPES is the whole dispatch
// table), so each guards its own precondition — a response action is
// offered only when its specific decision is actually live for this seat,
// never merely because it is your turn.

// § Setup (Law §1.23.1) — offered only inside the §1.23 window.
function describeSetupChoose(state: OathState, seat: number): Affordance[] {
  if (!state.setupChoices || state.setupChoices.remaining[0] !== seat) return [];
  const faceup = state.sites.map((s, i) => ({ s, i })).filter(({ s }) => !s.facedown);
  const topCradle = faceup.find(({ s }) => s.region === 'cradle');
  // §1.23.1: the Chancellor must use the top Cradle site; everyone else any faceup site.
  const siteOptions =
    seat === chancellorSeatOf(state) && topCradle
      ? [{ value: topCradle.s.id, label: `${byId(topCradle.s.id).name} (top Cradle — required, Law §1.23.1)` }]
      : faceup.map(({ s }) => ({ value: s.id, label: `${byId(s.id).name} (${s.region})` }));
  const hand = state.players[seat].hand; // the seat's OWN three drawn cards (§1.20)
  return [
    {
      type: 'setup.choose',
      fields: [
        { name: 'siteId', kind: 'choose-one', options: siteOptions },
        {
          name: 'keepIndex',
          kind: 'choose-one',
          options: hand.map((id, i) => ({ value: i, label: byId(id).name })),
        },
      ],
      note: 'Place your pawn and keep one card as a facedown adviser (Law §1.23).',
    },
  ];
}

// § Wake Phase (Law §4.1) — batched; the ordered steps + optional take are a
// structured payload the client builds from the (public) wake decision, so
// this is a `free` field the harness skips (like power.use).
function describeWakeResolve(state: OathState, seat: number): Affordance[] {
  if (!state.wake || state.wake.seat !== seat) return [];
  const w = state.wake;
  const parts = [
    w.stepsRemaining > 0 ? `${w.stepsRemaining} People's Favor step(s) (§4.1.1)` : null,
    w.opportunity !== null ? `an Opportunity Site take (§4.1.4)` : null,
  ].filter((s) => s !== null);
  return [
    {
      type: 'wake.resolve',
      fields: [
        {
          name: 'steps',
          kind: 'free',
          schema:
            "WakeStep[] of length stepsRemaining (each { choice: 'place' } or { choice: 'return', bank: <suit> }), plus an optional { take: { take: 'favor'|'secret'|'none' } } when an Opportunity Site is owed",
        },
      ],
      note: `Resolve your Wake Phase: ${parts.join(', then ')}.`,
    },
  ];
}

// § Campaign (Law §5.5). declare is a major action (on your turn); the rest
// resolve a live campaign phase.
/** Law §11.4, said where the target is chosen: a Plains/Mountain target changes the ATTACK (red) dice. */
export function siteAttackModifier(siteName: string): string {
  if (siteName === 'Plains') return ', +1 attack die (Law §11.4)';
  if (siteName === 'Mountain') return ', −1 attack die (Law §11.4)';
  return '';
}

function describeCampaignDeclare(state: OathState, seat: number): Affordance[] {
  const p = state.players[seat];
  const site = pawnSiteOf(state, seat);
  if (!site || p.supply < CAMPAIGN_COST) return []; // §5.5.1: costs 2 Supply
  const attackerSite = site.id;
  const out: Affordance[] = [];

  const candidateDefenders: (number | 'bandits')[] = [
    ...state.players.map((_, s) => s).filter((s) => s !== seat),
    'bandits',
  ];
  for (const defender of candidateDefenders) {
    const exclude = imperialExclusionFor(state, seat, defender); // §5.5.1 carve-out — not restated
    const rulers = rulersOf(state, attackerSite, exclude);
    const pawnHere = defender !== 'bandits' && state.players[defender].pawnSite === attackerSite;
    if (defender === 'bandits') {
      if (rulers.length > 0) continue; // bandits defend only an unruled site (§5.5.1)
    } else if (!rulers.includes(defender) && !pawnHere) {
      continue; // §5.5.1: defender must rule your site or have their pawn there
    }
    const rulesYourSite = defender === 'bandits' ? true : rulers.includes(defender);

    // Legal SOLO targets (each a complete one-target declaration, Law §5.5.2
    // with the "at least one target at your site" / "must target the ruled
    // site" clauses). Multi-target declarations are the client's to assemble.
    const soloTargets: { value: unknown; label: string }[] = [];
    if (rulesYourSite) {
      // §5.5.2: when the defender rules your site you MUST target the site,
      // so the site is the only solo-legal target.
      soloTargets.push({
        value: [{ kind: 'site', siteId: attackerSite }],
        label: `${byId(attackerSite).name} — ${SITE_DEFENSE_DICE} defense die${siteAttackModifier(byId(attackerSite).name)}`,
      });
    } else if (pawnHere) {
      // Pawn present but not ruling: the at-your-site targets are solo-legal.
      soloTargets.push({ value: [{ kind: 'pawnFavor' }], label: `their pawn & favor — ${PAWN_FAVOR_DICE} defense dice` });
      for (const banner of state.banners) {
        if (banner.holder === defender) {
          soloTargets.push({
            value: [{ kind: 'banner', bannerId: banner.id.slice('banner:'.length) }],
            label: `${byId(banner.id).name} — ${banner.tokens} defense dice`,
          });
        }
      }
      for (const relicId of state.players[defender].relics) {
        soloTargets.push({
          value: [{ kind: 'relic', relicId }],
          label: `${byId(relicId).name} — ${(byId(relicId) as Relic).defenseDice} defense dice`,
        });
      }
      if (state.grandScepter === defender) {
        soloTargets.push({ value: [{ kind: 'scepter' }], label: `the Grand Scepter — ${SCEPTER_DEFENSE_DICE} defense dice` });
      }
    }
    if (soloTargets.length === 0) continue;

    out.push({
      type: 'campaign.declare',
      fields: [
        {
          name: 'defender',
          kind: 'choose-one',
          options: [{ value: defender, label: defender === 'bandits' ? 'the bandits' : seatTitle(state.players, defender) }],
        },
        { name: 'targets', kind: 'choose-one', options: soloTargets },
        { name: 'attackDice', label: 'attack dice (before any Plains/Mountain change)', kind: 'count', min: 0, max: p.warbands.board },
      ],
      note:
        `Costs ${CAMPAIGN_COST} Supply. The defender's title adds ` +
        `${titleDefenseDice(state, seat, defender)} defense dice (Law §2.11); ` +
        `Plains +1 / Mountain -1 attack die (§11.4). Defense per target is shown above.`,
    });
  }
  return out;
}

function describeCampaignAlly(state: OathState, seat: number): Affordance[] {
  const c = state.campaign;
  if (!c || c.phase !== 'join' || !eligibleAllyVolunteers(state, c).includes(seat)) return [];
  return [
    {
      type: 'campaign.ally',
      fields: [{ name: 'join', kind: 'flag' }],
      note: 'Join the defence as an Ally, or decline (Law §5.5.2).',
    },
  ];
}

function describeCampaignPermit(state: OathState, seat: number): Affordance[] {
  const c = state.campaign;
  if (!c || c.phase !== 'permit' || c.defenderSeat !== seat) return [];
  return [
    {
      type: 'campaign.permit',
      fields: [
        {
          name: 'allies',
          kind: 'choose-many',
          options: c.allyVolunteers.map((s) => ({ value: s, label: seatTitle(state.players, s) })),
        },
      ],
      note: "Name which volunteers you permit as Allies (Law §5.5.2) — an empty list permits none.",
    },
  ];
}

function describeCampaignRespond(state: OathState, seat: number): Affordance[] {
  const c = state.campaign;
  if (!c || c.phase !== 'respond' || c.defenderSeat !== seat) return [];
  // The dice are rolled server-side in prepare() (D14/D51) — the defender
  // just closes the window, so there are no fields to fill.
  return [
    {
      type: 'campaign.respond',
      fields: [],
      note: 'Respond to close the window (Law §5.5.3); the dice are rolled server-side.',
    },
  ];
}

function describeCampaignResolve(state: OathState, seat: number): Affordance[] {
  const c = state.campaign;
  if (!c || c.phase !== 'rolled' || c.attackerSeat !== seat) return [];
  const force = defendingForce(state, c);
  const defense = defenseTotal(state, c, force);
  const { swords, skulls } = attackTotal(c.attackFaces ?? []);
  const needed = Math.max(0, defense - swords + 1); // §5.5.5
  const board = state.players[c.attackerSeat].warbands.board;
  const postSkull = board - Math.min(skulls, board); // §5.5.5 kills skulls before the sacrifice
  const t = battleTotals(state, c)!; // rolled, so never null
  const note =
    `Attack ${t.swords} vs defense ${t.defense} (${t.shields} from shields + ${t.force} from the defending ${c.defenderSeat === 'bandits' ? 'bandits' : 'force'}). ` +
    (skulls ? `${skulls} skull(s) kill your own warbands first. ` : '') +
    `The attack must be greater to win (Law §5.5.5).`;
  // Legal sacrifice values are exactly 0 (accept the outcome) or `needed`
  // (pay for the win, if the post-skull board can afford it) — never a value
  // in between. The two outcomes are SEPARATE entries, because only a win
  // carries the §5.5.7 seizure choices: the attacker knows before submitting
  // which one they are taking, and a seizure on a loss is refused.
  if (swords > defense) {
    return [victoryEntry(state, c, 0, postSkull, 'resolve — you are victorious', note)];
  }
  const out: Affordance[] = [
    { type: 'campaign.resolve', fields: [{ name: 'sacrifice', kind: 'choose-one', options: [{ value: 0, label: 'resolve — you are defeated' }] }], note },
  ];
  if (needed > 0 && needed <= postSkull) {
    out.push(victoryEntry(state, c, needed, postSkull - needed, `sacrifice ${needed} warband(s) to become victorious`, note));
  }
  return out;
}

/**
 * A victorious `campaign.resolve`: the sacrifice fixed, plus the optional
 * §5.5.7 seizure choices as ordinary fields — place warbands on targeted
 * sites (up to what is left on the board), and, if their pawn & favor were
 * targeted, banish their pawn and burn half their favor.
 */
function victoryEntry(
  state: OathState,
  c: NonNullable<OathState['campaign']>,
  sacrifice: number,
  boardLeft: number,
  label: string,
  note: string,
): Affordance {
  const fields: Field[] = [{ name: 'sacrifice', kind: 'choose-one', options: [{ value: sacrifice, label }] }];
  const siteTargets = c.targets.filter((t): t is Extract<typeof t, { kind: 'site' }> => t.kind === 'site');
  if (siteTargets.length > 0 && boardLeft > 0) {
    fields.push({
      name: 'place',
      kind: 'allocate',
      min: 0,
      max: boardLeft,
      options: siteTargets.map((t) => ({ value: { siteId: t.siteId }, label: byId(t.siteId).name, art: t.siteId })),
    });
  }
  if (c.targets.some((t) => t.kind === 'pawnFavor') && typeof c.defenderSeat === 'number') {
    const defenderAt = state.players[c.defenderSeat].pawnSite;
    fields.push({
      name: 'banishTo',
      kind: 'choose-one',
      options: [
        { value: null, label: 'Leave their pawn where it is' },
        ...state.sites
          .map((site, i) => ({ site, i }))
          .filter(({ site }) => site.id !== defenderAt)
          .map(({ site, i }) => ({
            value: i,
            label: site.facedown ? 'Facedown site' : byId(site.id).name,
            group: REGION_LABEL[site.region],
            art: site.facedown ? 'site-back' : site.id,
          })),
      ],
    });
    fields.push({ name: 'burnFavor', kind: 'flag' });
  }
  return {
    type: 'campaign.resolve',
    fields,
    note: `${note} Victorious: you may also seize (Law §5.5.7).`,
  };
}

function describeCampaignCasualties(state: OathState, seat: number): Affordance[] {
  const c = state.campaign;
  if (!c || c.phase !== 'casualties' || casualtyChooser(state, c) !== seat || !c.casualties) return [];
  const { force, quota } = c.casualties;
  // The defeated force is public (it was just rolled against): which seat's
  // warbands, where, how many. Each location is one option, capped at the
  // warbands actually there; the kills must total exactly the quota.
  return [
    {
      type: 'campaign.casualties',
      fields: [
        {
          name: 'kills',
          kind: 'allocate',
          min: quota,
          max: quota,
          options: force.map((e) => ({
            value: e.kind === 'site' ? { kind: 'site', siteId: e.siteId, seat: e.seat } : { kind: 'board', seat: e.seat },
            label: `the ${seatTitle(state.players, e.seat)}'s warbands ${e.kind === 'site' ? `at ${byId(e.siteId).name}` : 'on their board'} (${e.count})`,
            max: e.count,
          })),
        },
      ],
      note: `Kill exactly ${quota} warband(s) among the defeated force (Law §5.5.6).`,
    },
  ];
}

// § Citizenship (Law §6.6-6.8).
function describeCitizenshipOffer(state: OathState, seat: number): Affordance[] {
  // §6.6.1: only the Grand Scepter holder, only with no offer already open.
  if (seat !== state.grandScepter || state.citizenshipOffer) return [];
  const exiles = state.players.map((p, s) => ({ p, s })).filter(({ p, s }) => p.citizenship === 'exile' && s !== seat);
  if (exiles.length === 0) return [];
  // The mandatory relic must be named by id (§6.6.1) — so it must be one the
  // holder legitimately knows. §6.4 lets them PEEK any Reliquary relic; our
  // model requires actually having peeked it (unit 3), and putting an
  // un-peeked id here would be a leak the audit correctly catches. So the
  // offer lists only PEEKED Reliquary relics; the holder peeks (peek.reliquary)
  // to reveal more. (give/take negotiation is optional — self-policed.)
  const peekedReliquary = state.reliquary
    .filter((sp) => sp.relicId !== null && state.players[seat].peeked.includes(sp.relicId))
    .map((sp) => sp.relicId!);
  if (peekedReliquary.length === 0) return [];
  return [
    {
      type: 'citizenship.offer',
      fields: [
        { name: 'exile', kind: 'choose-one', options: exiles.map(({ s }) => ({ value: s, label: seatTitle(state.players, s) })) },
        { name: 'relicId', kind: 'choose-one', options: peekedReliquary.map((id) => ({ value: id, label: byId(id).name })) },
      ],
      note: 'Offer Citizenship with one Reliquary relic (Law §6.6.1). Peek more relics (peek.reliquary) to offer them; give/take negotiation is self-policed.',
    },
  ];
}

function describeCitizenshipAccept(state: OathState, seat: number): Affordance[] {
  if (!state.citizenshipOffer || state.citizenshipOffer.exile !== seat) return [];
  return [{ type: 'citizenship.accept', fields: [], note: 'Accept the Citizenship offer (Law §6.6.2).' }];
}
function describeCitizenshipDecline(state: OathState, seat: number): Affordance[] {
  if (!state.citizenshipOffer || state.citizenshipOffer.exile !== seat) return [];
  return [{ type: 'citizenship.decline', fields: [], note: 'Decline the Citizenship offer.' }];
}

function describeCitizenshipExile(state: OathState, seat: number): Affordance[] {
  // §6.7: the Grand Scepter holder exiles another Citizen (never themselves),
  // paying them favor — so only Citizens the actor can AFFORD to exile are
  // offered (the cost varies per target by their/your titles).
  if (seat !== state.grandScepter) return [];
  const affordable = state.players
    .map((p, s) => ({ p, s }))
    .filter(({ p, s }) => p.citizenship === 'citizen' && s !== seat)
    .filter(({ s }) => state.players[seat].favor >= exileFavorCost(state, seat, s));
  if (affordable.length === 0) return [];
  return [
    {
      type: 'citizenship.exile',
      fields: [
        {
          name: 'citizen',
          kind: 'choose-one',
          options: affordable.map(({ s }) => ({
            value: s,
            label: seatTitle(state.players, s),
            cost: { favor: exileFavorCost(state, seat, s) },
          })),
        },
      ],
      note: 'Exile a Citizen by giving them favor (Law §6.7).',
    },
  ];
}

function describeCitizenshipSelfExile(state: OathState, seat: number): Affordance[] {
  // §6.8: a Citizen who is NOT the Grand Scepter holder may exile themselves,
  // PAYING the Scepter holder favor equal to their secrets + board warbands —
  // offered only when the actor can afford it.
  if (state.players[seat].citizenship !== 'citizen' || seat === state.grandScepter) return [];
  const cost = selfExileFavorCost(state, seat);
  if (state.players[seat].favor < cost) return [];
  return [
    {
      type: 'citizenship.selfExile',
      fields: [],
      note: `Exile yourself, paying the Grand Scepter holder ${cost} favor (Law §6.8).`,
    },
  ];
}

// § Warband permission (Law §6.5) — the approver's answer.
function describeWarbandsAllow(state: OathState, seat: number): Affordance[] {
  if (!state.warbandRequest || state.warbandRequest.approver !== seat) return [];
  return [{ type: 'warbands.allow', fields: [], note: 'Allow the warband move (Law §6.5).' }];
}
function describeWarbandsDeny(state: OathState, seat: number): Affordance[] {
  if (!state.warbandRequest || state.warbandRequest.approver !== seat) return [];
  return [{ type: 'warbands.deny', fields: [], note: 'Deny the warband move (Law §6.5).' }];
}

// § Oathkeeper title (Law §2.11) — the losing holder chooses the heir.
function describeOathkeeperGrant(state: OathState, seat: number): Affordance[] {
  if (!state.titleChoice || state.titleChoice.holder !== seat) return [];
  const c = state.titleChoice;
  return [
    {
      type: 'oathkeeper.grant',
      fields: [{ name: 'seat', kind: 'choose-one', options: c.candidates.map((s) => ({ value: s, label: seatTitle(state.players, s) })) }],
      note: 'Choose which qualifying seat takes the Oathkeeper title (Law §2.11).',
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
  'peek.relic': describePeekRelic,
  'peek.reliquary': describePeekReliquary,
  // unit 6: the pending decisions
  'setup.choose': describeSetupChoose,
  'wake.resolve': describeWakeResolve,
  'campaign.declare': describeCampaignDeclare,
  'campaign.ally': describeCampaignAlly,
  'campaign.permit': describeCampaignPermit,
  'campaign.respond': describeCampaignRespond,
  'campaign.resolve': describeCampaignResolve,
  'campaign.casualties': describeCampaignCasualties,
  'citizenship.offer': describeCitizenshipOffer,
  'citizenship.accept': describeCitizenshipAccept,
  'citizenship.decline': describeCitizenshipDecline,
  'citizenship.exile': describeCitizenshipExile,
  'citizenship.selfExile': describeCitizenshipSelfExile,
  'warbands.allow': describeWarbandsAllow,
  'warbands.deny': describeWarbandsDeny,
  'oathkeeper.grant': describeOathkeeperGrant,
};

/**
 * Every action type this module can describe. Exported so the bidirectional
 * conformance test (affordances.test.ts) can assert every dispatch-table
 * type is either described here or explicitly never-offered — the two
 * catalogues cannot drift.
 */
export const DESCRIBED_TYPES: readonly string[] = Object.keys(DESCRIBERS);

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

  // `standing.set` is the one action legal for any seat at any time (it
  // bypasses `requireActiveSeat`), so it is offered even off-turn — during
  // another seat's Campaign, say, which is exactly when you would want to
  // stop being asked (P3 unit 6). The only bar is the §1.23 setup lock,
  // which forbids every action but `setup.choose`. Every OTHER describer is
  // gated on a live decision that names its type for this seat.
  const alwaysOn = !state.setupChoices ? new Set(['standing.set']) : new Set<string>();

  const out: Affordance[] = [];
  for (const [type, describe] of Object.entries(DESCRIBERS)) {
    if (!decisionOf.has(type) && !alwaysOn.has(type)) continue;
    const decisionId = decisionOf.get(type); // may be undefined for an off-turn standing.set
    for (const entry of describe(state, seat)) {
      if (decisionId !== undefined) entry.decisionId = decisionId;
      out.push(entry);
    }
  }
  return out;
}
