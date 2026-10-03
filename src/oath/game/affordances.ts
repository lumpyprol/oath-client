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
import { wakeOptions, applyWakeStep, type WakeStep } from './victory.js';
import type { PendingDecision } from '../../engine/types.js';
import { byId } from '../cards/index.js';
import type { Site, Suit } from '../cards/schema.js';
import { travelCost } from './map.js';
import { BURIED_GIANT, SHROUDED_WOOD_COST, decadentApplies, shroudedChooser, travelRoute } from './travel-rules.js';
import {
  ADVISER_LIMIT,
  CONSPIRACY_ID,
  STANDING_CHANNELS,
  type OathState,
  type PlayerState,
  type SiteState,
  type CampaignState,
} from './state.js';
import type { Relic } from '../cards/schema.js';
import { isRestricted, restrictionKnown } from './restrictions.js';
import { rulersOf, chancellorSeatOf, imperialExclusionFor } from './rule.js';
import { consultStanding } from './standing.js';
import { GREEDY_MAX_COST, worldDeckCost } from './actions/search.js';
import { matchingFaceupAdvisers, tradePayout } from './actions/trade.js';
import { chancellorHas } from './reliquary-text.js';
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
  mandatoryAllies,
  narrowPassRequirement,
  targetsAtHiddenPlace,
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
  /** What sets this option's cost, shown after it: "Rocky Coast — 1 Supply (Law §11.3)". */
  law?: string;
}

export type Field = (
  // `optionalWhen` (choose-one): the field may be left empty while another
  // field of the entry holds one of `values` — Search's "keep none" needs no
  // card (Ben, 2026-10-03). A client drops `required` then; the reducer
  // accepts the field absent.
  | { name: string; kind: 'choose-one' | 'choose-many'; options: Option[]; max?: number; optionalWhen?: { field: string; values: unknown[] } }
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
  // Every route is priced by `travelRoute` — Law §5.6.1 plus the site powers
  // (Coast, Charming Valley, Shrouded Wood, Narrow Pass, Buried Giant, The
  // Hidden Place) — the same function the reducer charges with.
  // Law §11.7: leaving a Shrouded Wood an enemy rules, they choose where —
  // so there is no destination to pick, only the 2 Supply to pay.
  const chooser = shroudedChooser(state, seat);
  if (chooser !== null) {
    const affordable = state.sites.some((x, i) => x.id !== player.pawnSite && !travelRoute(state, seat, i, 'supply').blocked);
    if (!affordable) return [];
    return [
      {
        type: 'travel',
        fields: [],
        note:
          `Leave Shrouded Wood. The ${seatTitle(state.players, chooser)} rules it, so they choose where you go, ` +
          `among the sites you can afford; you pay when they choose — ${SHROUDED_WOOD_COST} Supply (Law §11.7)` +
          `${decadentApplies(state, seat) ? ', none to the Cradle and 1 more to the Hinterland (Decadent)' : ''}.`,
      },
    ];
  }
  const offerSecret = from.id === BURIED_GIANT && player.secrets.ready > 0;
  const routes = state.sites.map((site, i) =>
    site.id === player.pawnSite
      ? null // "already on that site" is illegal, never an option
      : { supply: travelRoute(state, seat, i, 'supply'), secret: offerSecret ? travelRoute(state, seat, i, 'secret') : null },
  );
  const bySupply = routes.some((r) => r && !r.supply.blocked);
  const bySecret = routes.some((r) => r?.secret && !r.secret.blocked);
  const payField = offerSecret && bySecret; // only Supply → no choice to make, the field is left out
  const options: Option[] = [];
  state.sites.forEach((site, i) => {
    const r = routes[i];
    if (!r) return;
    const okSupply = bySupply && !r.supply.blocked;
    const okSecret = payField && !r.secret!.blocked;
    const shown = okSupply || !okSecret ? r.supply : r.secret!;
    // Grouped by region so the form reads like the board: one column each.
    const option: Option = {
      value: i,
      label: site.facedown ? 'Facedown site' : byId(site.id).name,
      cost: { supply: shown.cost, ...(shown.secrets ? { secrets: shown.secrets } : {}) },
      group: REGION_LABEL[site.region],
      art: site.facedown ? 'site-back' : site.id,
    };
    if (shown.laws.length) option.law = shown.laws.join(', ');
    if (!okSupply && !okSecret) option.disabled = r.supply.blocked;
    else if (payField && okSupply !== okSecret && bySupply) {
      option.requires = { field: 'pay', values: [okSupply ? 'supply' : 'secret'] };
    }
    options.push(option);
  });
  if (options.every((o) => o.disabled)) return []; // can't move at all → no entry
  const fields: Field[] = [];
  if (payField) {
    fields.push({
      name: 'pay',
      kind: 'choose-one',
      label: 'Pay with',
      options: [
        ...(bySupply ? [{ value: 'supply', label: 'Supply, as usual' }] : []),
        { value: 'secret', label: 'Buried Giant: flip one ready secret facedown — spend no Supply and ignore Narrow Pass' },
      ],
    });
  }
  fields.push({ name: 'siteIndex', kind: 'choose-one', label: 'Destination', options });
  return [{ type: 'travel', fields }];
}

/** A site option for a destination someone else picks (Law §11.7): any site but `except`. */
function destinationOptions(state: OathState, except: string | null): Option[] {
  return state.sites
    .map((site, i) => ({ site, i }))
    .filter(({ site }) => site.id !== except)
    .map(({ site, i }) => ({
      value: i,
      label: site.facedown ? 'Facedown site' : byId(site.id).name,
      group: REGION_LABEL[site.region],
      art: site.facedown ? 'site-back' : site.id,
    }));
}

/** Shrouded Wood's ruler names the traveller's destination (Law §11.7). */
function describeTravelDirect(state: OathState, seat: number): Affordance[] {
  const t = state.shroudedTravel;
  if (!t || t.chooser !== seat) return [];
  return [
    {
      type: 'travel.direct',
      fields: [
        {
          name: 'siteIndex',
          kind: 'choose-one',
          label: `Where the ${seatTitle(state.players, t.traveller)} goes`,
          options: destinationOptions(state, state.players[t.traveller].pawnSite).map((o) => {
            if (t.via !== 'travel') return o;
            // A Travel: they pay for the site you choose, so only what they can afford.
            const r = travelRoute(state, t.traveller, o.value as number, 'supply');
            return {
              ...o,
              cost: { supply: r.cost },
              ...(r.laws.length ? { law: r.laws.join(', ') } : {}),
              ...(r.blocked ? { disabled: `that site ${r.blocked.replace(/, you have/, ', they have')}` } : {}),
            };
          }),
        },
      ],
      note:
        `You rule Shrouded Wood, so you choose where the ${seatTitle(state.players, t.traveller)} travels ` +
        `(Law §11.7) — any other site; Narrow Pass and The Hidden Place don't apply from Shrouded Wood.`,
    },
  ];
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
  // The Reliquary's Greedy space: draw 2 more, but never spend over 2 Supply.
  const greedy = chancellorHas(state, seat, 'greedy');
  const draws = greedy ? `draw 5 (Greedy)` : 'draw 3';
  const allowed = (cost: number) => p.supply >= cost && !(greedy && cost > GREEDY_MAX_COST);
  if (state.worldDeck.length > 0 && allowed(deckCost)) {
    options.push({ value: 'deck', label: `World deck — ${draws} (${deckCost} Supply)`, cost: { supply: deckCost } });
  }
  const discardCost = 2; // §5.1.1
  if (state.discards[site.region].length > 0 && allowed(discardCost)) {
    options.push({
      value: 'discard',
      label: `${site.region} discard — ${draws} (${discardCost} Supply)`,
      cost: { supply: discardCost },
    });
  }
  // §5.1.1: if you can afford no source, you cannot search at all — absent,
  // not a greyed form (the plan's deliberate contrast with muster).
  if (options.length === 0) return [];
  const deckBarred = greedy && deckCost > GREEDY_MAX_COST && state.worldDeck.length > 0;
  return [
    {
      type: 'search',
      fields: [{ name: 'from', kind: 'choose-one', options }],
      ...(deckBarred ? { note: `Greedy: the world deck would cost ${deckCost} Supply, and you cannot search for more than ${GREEDY_MAX_COST}.` } : {}),
    },
  ];
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
        {
          name: 'cardId',
          kind: 'choose-one',
          // What each card would pay, worked out the way the reducer will
          // (Ben: a matching adviser's extra favor was invisible): 1 + each
          // matching faceup adviser, capped by that suit's bank (§9.3).
          options: targets.map((c) => {
            const suit = (byId(c.id) as { suit: Suit }).suit;
            const matches = matchingFaceupAdvisers(p, suit);
            const pays = tradePayout(state, seat, suit); // the reducer's own arithmetic
            const favor = pays.forSecret.favor;
            const suitName = `${suit[0].toUpperCase()}${suit.slice(1)}`;
            const why = matches ? `, with ${matches} matching faceup adviser${matches === 1 ? '' : 's'}` : '';
            const capped = favor < pays.forSecret.wanted ? ` (the ${suitName} bank has only ${state.favorBanks[suit]})` : '';
            const n = pays.forFavor.secrets;
            const plusFavor = pays.forFavor.favor ? ` + ${pays.forFavor.favor} favor` : '';
            return {
              value: c.id,
              label:
                `${byId(c.id).name} (${suitName}): ${favor} favor${capped} for a secret, or ${n} secret${n === 1 ? '' : 's'}${plusFavor} for 2 favor${why}` +
                (pays.careless ? ' (Careless: +1 favor, −1 secret)' : ''),
              art: c.id,
            };
          }),
        },
        {
          name: 'for',
          kind: 'choose-one',
          options: [
            { value: 'favor', label: 'gain favor: place 1 secret (Law §5.3.2)', ...(canFavor ? {} : { disabled: forReason(false, true)! }) },
            { value: 'secrets', label: 'gain secrets: place 2 favor (Law §5.3.2)', ...(canSecrets ? {} : { disabled: forReason(false, false)! }) },
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
  // §5.4.2 pays BEFORE §5.4.4 takes one of the old stake back, so the
  // payment must come from your own ready secrets alone (corrected
  // 2026-10-02; the old reading let the banner's stake fund it).
  const dsMaxPay = p.secrets.ready;
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
          optionalWhen: { field: 'as', values: ['discard'] }, // keeping none needs no card
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
    // When discarding is the ONLY move, say so and why (Ben: a Citizen's
    // facedown Vision looked like it was being "played").
    if (asOptions.length === 1) {
      const role = p.citizenship === 'chancellor' ? 'the Chancellor' : 'a Citizen';
      const why = isConspiracy
        ? "the Conspiracy's faceup play is declared with Power: use (Law §5.1.4.4)"
        : isVision
          ? `${role} cannot reveal a Vision (Law §5.1.4.3)`
          : isRestricted(cardId, 'site')
            ? 'it may only be played to a site, and yours has no room (Law §7.2.1)'
            : 'it has nowhere it may be played now';
      asOptions[0] = { value: 'discard', label: `Discard it (the only option: ${why})` };
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
  const fields: Field[] = [];

  // §4.1.1 as ordinary fields (Ben: the Wake was a JSON box). Each step's
  // options are exactly what the Law allows at that moment (wakeOptions,
  // the reducer's own predicate). Step 2's depend on step 1, so each of its
  // options says which first steps it may follow (`requires`), worked out
  // by applying each first step the way the reducer will.
  const optionsAt = (st: OathState): Option[] | null => {
    const o = wakeOptions(st, seat);
    if (!o.canPlace && !o.canReturn) return null; // nothing possible (§9.2): any answer is moot
    const place: Option = { value: { choice: 'place' }, label: "Place 1 of your favor on the People's Favor" };
    const returns = o.banks.map((bank) => ({
      value: { choice: 'return', bank },
      label: `Move 1 favor from it to the ${bank[0].toUpperCase()}${bank.slice(1)} bank (an emptiest one)`,
    }));
    return o.mustPlace ? [place] : o.mustReturn ? returns : [place, ...returns];
  };
  if (w.stepsRemaining >= 1) {
    const first = optionsAt(state) ?? [{ value: { choice: 'place' }, label: 'Nothing to do' }];
    fields.push({ name: 'step1', label: "People's Favor (Law §4.1.1)", kind: 'choose-one', options: first });
    if (w.stepsRemaining >= 2) {
      const key = (v: unknown) => JSON.stringify(v);
      const second = new Map<string, { option: Option; after: unknown[] }>();
      for (const o1 of first) {
        const after = applyWakeStep(structuredClone(state), seat, o1.value as WakeStep);
        const opts = optionsAt(after) ?? first.map((o) => ({ ...o, label: 'Nothing more to do' })).slice(0, 1);
        for (const o2 of opts) {
          const k = key(o2.value);
          const entry = second.get(k) ?? { option: o2, after: [] };
          entry.after.push(o1.value);
          second.set(k, entry);
        }
      }
      fields.push({
        name: 'step2',
        label: "People's Favor again: the Mob side repeats it (Law §4.1.1.II)",
        kind: 'choose-one',
        options: [...second.values()].map(({ option, after }) =>
          after.length === first.length ? option : { ...option, requires: { field: 'step1', values: after } },
        ),
      });
    }
  }

  // §4.1.4: a favor or secret from the Opportunity Site you stand on, if it has one.
  if (w.opportunity !== null) {
    const site = state.sites.find((x) => x.id === w.opportunity)!;
    const name = byId(site.id).name;
    fields.push({
      name: 'take',
      label: `Take from ${name} (Law §4.1.4)`,
      kind: 'choose-one',
      options: [
        ...(site.favor > 0 ? [{ value: 'favor', label: `Take 1 favor (${site.favor} there)` }] : []),
        ...(site.secrets > 0 ? [{ value: 'secret', label: `Take 1 secret (${site.secrets} there)` }] : []),
        { value: 'none', label: 'Take nothing' },
      ],
    });
  }

  return [{ type: 'wake.resolve', fields, note: 'Your Wake Phase (Law §4.1).' }];
}

// § Campaign (Law §5.5). declare is a major action (on your turn); the rest
// resolve a live campaign phase.
/** Law §11.4, said where the target is chosen: a Plains/Mountain target changes the ATTACK (red) dice. */
export function siteAttackModifier(siteName: string): string {
  if (siteName === 'Plains') return ', +1 attack die (Law §11.4)';
  if (siteName === 'Mountain') return ', −1 attack die (Law §11.4)';
  return '';
}

/** "Defending on boards: 4 on the Red Citizen's, 6 on the Chancellor's (Ally). " — or nothing. */
function boardNoteFor(state: OathState, allies: number[]) {
  return (force: { kind: string; seat?: number; count: number }[]): string => {
    const boards = force.filter((e) => e.kind === 'board');
    if (boards.length === 0) return '';
    const parts = boards.map((e) => `${e.count} on the ${seatTitle(state.players, e.seat!)}'s${allies.includes(e.seat!) ? ' (Ally)' : ''}`);
    return `Defending warbands on boards, whatever you target here: ${parts.join(', ')} (Law §5.5.4). `;
  };
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

    // The defending warbands each target brings (Ben, 2026-10-02), counted
    // by the battle's own defendingForce over a provisional campaign — the
    // Allies that must join included — so the form says what the dice
    // alone do not.
    const boardNote = boardNoteFor(state, defender === 'bandits' ? [] : mandatoryAllies(state, seat, defender));
    const forceFor = (targets: unknown[]) =>
      defendingForce(state, {
        attackerSeat: seat,
        defenderSeat: defender,
        targets,
        allies: defender === 'bandits' ? [] : mandatoryAllies(state, seat, defender),
      } as unknown as CampaignState);
    const boardsIn = (force: ReturnType<typeof forceFor>) => force.filter((e) => e.kind === 'board').reduce((a, e) => a + e.count, 0);
    const atSite = (siteId: string, alongside: unknown[] = []): string => {
      if (defender === 'bandits') return ', 1 bandit';
      const n = forceFor([{ kind: 'site', siteId }])
        .filter((e) => e.kind === 'site' && e.siteId === siteId)
        .reduce((a, e) => a + e.count, 0);
      // A board joins when its owner's pawn stands at a targeted site
      // (§5.5.4): what targeting THIS site adds in boards, beyond the first target.
      const boards = boardsIn(forceFor([...alongside, { kind: 'site', siteId }])) - boardsIn(forceFor(alongside));
      return `, ${n} defending warband${n === 1 ? '' : 's'}${alongside.length && boards > 0 ? ` + ${boards} on boards (pawns there)` : ''}`;
    };

    // Legal SOLO targets (each a complete one-target declaration, Law §5.5.2
    // with the "at least one target at your site" / "must target the ruled
    // site" clauses). Multi-target declarations are the client's to assemble.
    const soloTargets: { value: unknown; label: string }[] = [];
    if (rulesYourSite) {
      // §5.5.2: when the defender rules your site you MUST target the site,
      // so the site is the only solo-legal target.
      soloTargets.push({
        value: [{ kind: 'site', siteId: attackerSite }],
        label: `${byId(attackerSite).name} — ${SITE_DEFENSE_DICE} defense die${atSite(attackerSite)}${siteAttackModifier(byId(attackerSite).name)}`,
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
    // The Hidden Place: targets there cost a ready secret, flipped facedown —
    // standing on it, that is every target at your site.
    const hereIsHidden = targetsAtHiddenPlace(state, attackerSite, [{ kind: 'pawnFavor' }]);
    if (hereIsHidden && p.secrets.ready < 1) continue;

    // §5.5.2: "any number of targets" — beyond the one at your site, any
    // other at-your-site target (when their pawn is here) and any other site
    // they rule, anywhere. Each extra may not repeat the first target, which
    // `requires` says, and the harness checks both ways (Ben, 2026-10-02).
    const extras: Option[] = [];
    if (pawnHere) {
      extras.push({ value: { kind: 'pawnFavor' }, label: `their pawn & favor — ${PAWN_FAVOR_DICE} defense dice` });
      for (const banner of state.banners) {
        if (banner.holder === defender) {
          extras.push({ value: { kind: 'banner', bannerId: banner.id.slice('banner:'.length) }, label: `${byId(banner.id).name} — ${banner.tokens} defense dice` });
        }
      }
      for (const relicId of state.players[defender as number].relics) {
        extras.push({ value: { kind: 'relic', relicId }, label: `${byId(relicId).name} — ${(byId(relicId) as Relic).defenseDice} defense dice` });
      }
      if (state.grandScepter === defender) {
        extras.push({ value: { kind: 'scepter' }, label: `the Grand Scepter — ${SCEPTER_DEFENSE_DICE} defense dice` });
      }
    }
    // Every other site they rule — for the bandits, every faceup site with
    // no warbands (§10.21): they are one faction, so any of theirs can be a
    // target, each adding a bandit to the defence (§2.8.3).
    for (const other of state.sites) {
      if (other.id === attackerSite || other.facedown) continue;
      const otherRulers = rulersOf(state, other.id, exclude);
      if (defender === 'bandits' ? otherRulers.length > 0 : !otherRulers.includes(defender)) continue;
      const extra: Option = {
        value: { kind: 'site', siteId: other.id },
        label: `${byId(other.id).name} — ${SITE_DEFENSE_DICE} defense die${atSite(other.id, (soloTargets[0]?.value as unknown[]) ?? [])}${siteAttackModifier(byId(other.id).name)}`,
      };
      // Law §11.8: from another region, a target in Narrow Pass's region
      // brings Narrow Pass in too — or cannot be declared at all.
      const pass = narrowPassRequirement(state, seat, defender, [{ kind: 'site', siteId: other.id }], exclude);
      if (pass === 'added') extra.label += ' — Narrow Pass joins the targets (Law §11.8)';
      if (pass === 'blocked') {
        extra.disabled = `you would have to target Narrow Pass too, and ${defender === 'bandits' ? 'the bandits do' : `the ${seatTitle(state.players, defender)} does`} not rule it (Law §11.8)`;
      }
      if (!hereIsHidden && targetsAtHiddenPlace(state, attackerSite, [{ kind: 'site', siteId: other.id }])) {
        if (p.secrets.ready < 1) extra.disabled = 'targets at The Hidden Place need a ready secret to flip facedown, and you have none';
        else extra.label += ' — flips one of your secrets facedown (The Hidden Place)';
      }
      extras.push(extra);
    }
    const key = (v: unknown) => JSON.stringify(v);
    const alsoOptions: Option[] = extras.map((x) => {
      const firsts = soloTargets.map((t) => t.value).filter((v) => key(v) !== key([x.value]));
      return firsts.length === soloTargets.length ? x : { ...x, requires: { field: 'targets', values: firsts } };
    });

    out.push({
      type: 'campaign.declare',
      fields: [
        {
          name: 'defender',
          kind: 'choose-one',
          options: [{ value: defender, label: defender === 'bandits' ? 'the bandits' : seatTitle(state.players, defender) }],
        },
        { name: 'targets', label: 'target at your site', kind: 'choose-one', options: soloTargets },
        ...(alsoOptions.length ? [{ name: 'alsoTargets', label: 'also target (any number, Law §5.5.2)', kind: 'choose-many' as const, options: alsoOptions }] : []),
        { name: 'attackDice', label: 'attack dice (before any Plains/Mountain change)', kind: 'count', min: 0, max: p.warbands.board },
      ],
      note:
        (hereIsHidden ? 'Declaring targets here flips one of your ready secrets facedown (The Hidden Place). ' : '') +
        (chancellorHas(state, seat, 'brutal') ? 'Brutal: whoever is defeated — even you — kills ALL the warbands in their force. ' : '') +
        boardNote(forceFor((soloTargets[0]?.value as unknown[]) ?? [])) +
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
    // §5.5.7.3: at Shrouded Wood, its power beats the attacker's choice — an
    // enemy of theirs who rules it picks the site (§11.7).
    const shrouded = shroudedChooser(state, c.defenderSeat);
    const rulerChooses = shrouded !== null && shrouded !== c.attackerSeat;
    fields.push({
      name: 'banishTo',
      label: rulerChooses
        ? `Banish their pawn: they travel, spending no Supply — but from Shrouded Wood the ${seatTitle(state.players, shrouded)} chooses where (Law §5.5.7.3, §11.7)`
        : 'Banish their pawn: make them travel to a site of your choice, spending no Supply (Law §5.5.7.3)',
      kind: 'choose-one',
      options: [
        { value: null, label: 'Leave their pawn where it is' },
        ...(rulerChooses
          ? [{ value: 'ruler', label: `Banish them; the ${seatTitle(state.players, shrouded)} picks the site` }]
          : destinationOptions(state, defenderAt)),
      ],
    });
    // Say what burning does and how much (Ben): half their favor, rounded
    // down, into the shared bank — Glossary "Burn" (Law §5.5.7.3).
    const theirs = state.players[c.defenderSeat].favor;
    const burnt = Math.floor(theirs / 2);
    fields.push({
      name: 'burnFavor',
      kind: 'flag',
      label: `Burn half their favor: ${burnt} of the ${seatTitle(state.players, c.defenderSeat)}'s ${theirs} go to the shared bank (rounded down, Law §5.5.7.3)`,
    });
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

// One form, accept or decline (Ben). `citizenship.accept`/`.decline` remain
// engine actions (logged games, the JSON API) but are offered through this.
function describeCitizenshipRespond(state: OathState, seat: number): Affordance[] {
  if (!state.citizenshipOffer || state.citizenshipOffer.exile !== seat) return [];
  return [
    {
      type: 'citizenship.respond',
      fields: [
        {
          name: 'answer',
          label: 'your answer',
          kind: 'choose-one',
          options: [
            { value: 'accept', label: 'Accept: become a Citizen (Law §6.6.2)' },
            { value: 'decline', label: 'Decline: stay an Exile' },
          ],
        },
      ],
    },
  ];
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
// One form, allow or deny (Ben). `warbands.allow`/`.deny` remain engine
// actions (logged games, the JSON API) but are offered through this.
function describeWarbandsRespond(state: OathState, seat: number): Affordance[] {
  if (!state.warbandRequest || state.warbandRequest.approver !== seat) return [];
  return [
    {
      type: 'warbands.respond',
      fields: [
        {
          name: 'answer',
          label: 'your answer',
          kind: 'choose-one',
          options: [
            { value: 'allow', label: 'Allow the move (Law §6.5)' },
            { value: 'deny', label: 'Deny it' },
          ],
        },
      ],
    },
  ];
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
  'travel.direct': describeTravelDirect,
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
  'citizenship.respond': describeCitizenshipRespond,
  'citizenship.accept': () => [], // offered as citizenship.respond
  'citizenship.decline': () => [], // offered as citizenship.respond
  'citizenship.exile': describeCitizenshipExile,
  'citizenship.selfExile': describeCitizenshipSelfExile,
  'warbands.respond': describeWarbandsRespond,
  'warbands.allow': () => [], // offered as warbands.respond
  'warbands.deny': () => [], // offered as warbands.respond
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

// ---- what a seat CANNOT do now, and why (P4 unit 11, Ben) ------------------

/**
 * The actions a board always shows (Rest, Law §5's major and §6's minor
 * actions): offered as a form when legal, otherwise greyed with a reason.
 */
export const ALWAYS_SHOWN = [
  'turn.rest',
  'search',
  'muster',
  'trade',
  'travel',
  'recover',
  'campaign.declare',
  'adviser.play',
  'power.use',
  'peek.relic',
  'peek.reliquary',
  'warbands.move',
  'citizenship.offer',
  'citizenship.exile',
  'citizenship.selfExile',
] as const;

export interface Unavailable {
  type: string;
  /** Why not, in words; derived here from the same state the describers read, never by a client. */
  reason: string;
}

/**
 * The Imperial minor actions only exist for the seats they can apply to
 * (Ben): the Grand Scepter's (Peek at the Reliquary §6.4, offer §6.6.1,
 * exile §6.7) for its holder, normally the Chancellor, and self-exile
 * (§6.8) for Citizens. Anyone else does not see them at all, not even
 * greyed. Everything else always shows.
 */
export function shownTo(state: OathState, seat: number, type: string): boolean {
  switch (type) {
    case 'peek.reliquary':
    case 'citizenship.offer':
    case 'citizenship.exile':
      return seat === state.grandScepter;
    case 'citizenship.selfExile':
      return state.players[seat].citizenship === 'citizen';
    default:
      return true;
  }
}

/** What blocks a seat's turn actions while one of its other decisions is open. */
const BLOCKED_BY: Record<string, string> = {
  setup: 'Finish setup first (Law §1.23).',
  wake: 'Resolve your Wake first (Law §4.1).',
  play: 'Finish your Search first: keep a card (Law §5.1.4).',
  campaign: 'Finish the campaign first (Law §5.5).',
  oathkeeper: 'Choose who takes the Oathkeeper title first (Law §2.11).',
  shrouded: 'Choose where the traveller goes from Shrouded Wood first (Law §11.7).',
};

/** Why an action this seat's turn DOES allow still offers nothing: its own precondition. */
function whyNotNow(state: OathState, seat: number, type: string): string {
  const p = state.players[seat];
  const site = pawnSiteOf(state, seat);
  const s = (n: number) => `${n} Supply`;
  switch (type) {
    case 'search': {
      const costs: number[] = [];
      if (state.worldDeck.length > 0) costs.push(worldDeckCost(state.visionsDrawn));
      if (site && state.discards[site.region].length > 0) costs.push(2);
      if (costs.length === 0) return 'There are no cards to draw (Law §5.1.2).';
      if (chancellorHas(state, seat, 'greedy') && costs.every((c) => c > GREEDY_MAX_COST)) {
        return `Greedy: you cannot search for more than ${GREEDY_MAX_COST} Supply, and the world deck costs ${Math.min(...costs)}.`;
      }
      return `Costs at least ${s(Math.min(...costs))}; you have ${p.supply} (Law §5.1.1).`;
    }
    case 'muster':
      return 'No denizen or intact edifice without tokens at your site (Law §5.2.1).';
    case 'trade':
      if (!site || tokenFreeSuitedCards(site).length === 0) return 'No denizen or intact edifice without tokens at your site (Law §5.3.2).';
      if (p.supply < 1) return `Costs 1 Supply; you have ${p.supply} (Law §5.3.1).`;
      return `Needs 1 ready secret or 2 favor; you have ${p.secrets.ready} and ${p.favor} (Law §5.3.2).`;
    case 'travel': {
      if (!site) return 'Your pawn is not on the map yet.';
      const costs = state.sites
        .map((x, i) => (x.id === site.id ? null : travelRoute(state, seat, i, 'supply')))
        .filter((r) => r !== null && (!r.blocked || r.blocked.startsWith('costs')))
        .map((r) => r!.cost);
      if (costs.length === 0) return 'No site you can travel to from here (Law §5.6.1, §11.8).';
      return `Costs at least ${s(Math.min(...costs))}; you have ${p.supply} (Law §5.6.1).`;
    }
    case 'recover':
      return p.supply < 1
        ? `Costs 1 Supply; you have ${p.supply} (Law §5.4.1).`
        : 'Nothing here or among the banners that you can afford to recover (Law §5.4).';
    case 'campaign.declare':
      if (p.supply < CAMPAIGN_COST) return `Costs ${s(CAMPAIGN_COST)}; you have ${p.supply} (Law §5.5.1).`;
      if (site && targetsAtHiddenPlace(state, site.id, [{ kind: 'pawnFavor' }]) && p.secrets.ready < 1) {
        return 'Targets at The Hidden Place need a ready secret to flip facedown, and you have none.';
      }
      return 'No one to campaign against: nobody else rules your site or stands at it (Law §5.5.1).';
    case 'adviser.play':
      return 'You have no facedown adviser (Law §6.1).';
    case 'power.use':
      return 'You have access to no card with a power to use (Law §6.2).';
    case 'peek.relic':
      return 'No facedown relic at your site (Law §6.3).';
    case 'peek.reliquary':
      return seat !== state.grandScepter
        ? 'Only the Grand Scepter holder may (Law §6.4).'
        : 'No relic is left in the Imperial Reliquary (Law §6.4).';
    case 'warbands.move':
      return 'No warbands you can move to or from your site (Law §6.5).';
    case 'citizenship.offer':
      if (seat !== state.grandScepter) return 'Only the Grand Scepter holder may offer Citizenship (Law §6.6.1).';
      if (state.citizenshipOffer) return 'An offer is already waiting for an answer (Law §6.6.1).';
      if (!state.players.some((x, i) => i !== seat && x.citizenship === 'exile')) return 'There is no Exile to offer it to (Law §6.6.1).';
      return 'Peek at a Reliquary relic first: an offer must promise one (Law §6.6.1).';
    case 'citizenship.exile':
      return seat !== state.grandScepter
        ? 'Only the Grand Scepter holder may exile a Citizen (Law §6.7).'
        : 'No Citizen you can afford to exile (Law §6.7).';
    case 'citizenship.selfExile':
      if (p.citizenship !== 'citizen') return 'Only a Citizen may exile themselves (Law §6.8).';
      if (seat === state.grandScepter) return 'The Grand Scepter holder cannot exile themselves (Law §6.8).';
      return `Costs ${selfExileFavorCost(state, seat)} favor; you have ${p.favor} (Law §6.8).`;
    default:
      return 'Not possible right now.';
  }
}

/**
 * Every ALWAYS_SHOWN action this seat has NO form for right now, with why:
 * not its turn (and whose it is), another of its decisions first, or the
 * action's own precondition. Disjoint from `computeAffordances` by
 * construction, which a test holds.
 */
export function computeUnavailable(state: OathState, seat: number | null, pending: PendingDecision[]): Unavailable[] {
  if (seat === null || state.complete) return [];
  const offered = new Set(computeAffordances(state, seat, pending).map((e) => e.type));
  const mine = pending.filter((d) => d.seat === seat);
  const turnHolder = pending.find((d) => d.kind === 'turn')?.seat ?? state.turn.activeSeat;
  return ALWAYS_SHOWN.filter((type) => !offered.has(type) && shownTo(state, seat, type)).map((type) => {
    if (mine.some((d) => d.resolves.includes(type))) return { type, reason: whyNotNow(state, seat, type) };
    const blocker = mine.find((d) => BLOCKED_BY[d.kind]);
    if (blocker) return { type, reason: BLOCKED_BY[blocker.kind] };
    const t = state.shroudedTravel;
    if (t) {
      return {
        type,
        reason: `Waiting on the ${seatTitle(state.players, t.chooser)} to choose where the ${seatTitle(state.players, t.traveller)} goes from Shrouded Wood (Law §11.7).`,
      };
    }
    if (turnHolder !== seat) return { type, reason: `Not your turn: waiting on the ${seatTitle(state.players, turnHolder)}.` };
    return { type, reason: 'Not possible right now.' };
  });
}
