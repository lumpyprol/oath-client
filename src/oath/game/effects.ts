/**
 * The effect vocabulary: the shared currency of declared and enforced
 * powers (HLD D28) and what `power.use` (unit 14) speaks. Zone-addressed
 * movers for the four currencies (favor, secrets, warbands, cards) plus a
 * small closed set of non-mover effects that a mover genuinely can't
 * express (HLD D33).
 *
 * GROWTH RULE (D33): a new effect lands only when an action or power
 * genuinely needs it — a new zone kind, or a new tag + `applyEffects` case
 * + tests. Never widen an existing tag's meaning. `power.use`'s payload
 * shape never changes.
 *
 * Deliberately NOT yet in this vocabulary (found while researching the
 * rulebook for this unit; add when the unit that needs them arrives):
 *
 *   - Relic power-cost tokens (Law §7.1.2: "Denizens, relics, and edifices
 *     have a cost on their braid"). `OathState.players[].relics` is a bare
 *     `string[]` (unit 1) with no favor/secret fields, so a held relic
 *     cannot yet carry a power cost. Extending it to a token-bearing shape
 *     is unit 11's (Recover) or unit 14's (power.use) call, not this
 *     unit's — it changes an existing state field's shape, which unit 1's
 *     plan flags as a stop-and-reassess case, not an additive one.
 *   - The seat secrets zone (`seatSecrets`) always addresses the READY
 *     pool. The "pay a cost outside your turn" rule (Law §7.1.2: "flip the
 *     secrets facedown and keep them on your board") needs the FLIPPED
 *     pool as a distinct endpoint; that's unit 14/15's problem once
 *     `power.use` is reachable during another seat's turn (the campaign
 *     response window, unit 12+).
 *   - Banner HOLDER transfer. This vocabulary addresses a banner's token
 *     STAKE only (`bannerFavor`/`bannerSecrets`, one currency each per Law
 *     §2.5). Reassigning `BannerState.holder` is structural, not a
 *     currency move — Recover (unit 11) and Campaign seizure (unit 13)
 *     mutate it directly, the same way turn.ts's Rest sweep (unit 5) will
 *     mutate `secrets.flipped -> ready` directly rather than through this
 *     vocabulary.
 *
 * The Imperial Reliquary IS now a zone (`{ kind: 'reliquary' }`, unit 16):
 * setup still deals into it directly (bypassing effects, per setup.ts),
 * but `citizenship.accept` needs to move a promised relic OUT of it to a
 * new Citizen, so it joins the RELIC-only zone family alongside
 * `seatRelics`/`siteRelics`/`relicDeck`.
 *
 * Citations are "Law §x.y" (Buried Giant rules reference, Oath printing
 * p1; see RULINGS.md).
 */

import { z } from 'zod';
import { IllegalAction } from '../../engine/types.js';
import { SUITS, type Suit } from '../cards/schema.js';
import {
  ADVISER_LIMIT,
  DARKEST_SECRET_ID,
  PEOPLES_FAVOR_ID,
  type OathState,
  type Region,
  type SiteState,
} from './state.js';

// ---- zone references ----------------------------------------------------

const RegionSchema = z.enum(['cradle', 'provinces', 'hinterland']);
const SuitSchemaLocal = z.enum(SUITS);
const seat = z.number().int().min(0);

// -- favor zones: a seat's board, a suit bank, the shared bank, a site's
// reveal-prompt tokens, tokens on a card in play at a site or as an
// adviser, or the People's Favor's stake.
export type FavorZone =
  | { kind: 'seatFavor'; seat: number }
  | { kind: 'favorBank'; suit: Suit }
  | { kind: 'sharedFavor' }
  | { kind: 'siteFavor'; siteId: string }
  | { kind: 'siteCardFavor'; siteId: string; cardId: string }
  | { kind: 'adviserFavor'; seat: number; cardId: string }
  | { kind: 'bannerFavor' }; // the People's Favor (Law §2.5) — the only favor-bearing banner

const FavorZoneSchema: z.ZodType<FavorZone> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('seatFavor'), seat }),
  z.object({ kind: z.literal('favorBank'), suit: SuitSchemaLocal }),
  z.object({ kind: z.literal('sharedFavor') }),
  z.object({ kind: z.literal('siteFavor'), siteId: z.string() }),
  z.object({ kind: z.literal('siteCardFavor'), siteId: z.string(), cardId: z.string() }),
  z.object({ kind: z.literal('adviserFavor'), seat, cardId: z.string() }),
  z.object({ kind: z.literal('bannerFavor') }),
]);

// -- secret zones: mirror of favor, for the Darkest Secret's stake instead.
export type SecretZone =
  | { kind: 'seatSecrets'; seat: number } // the READY pool only — see header
  | { kind: 'sharedSecrets' }
  | { kind: 'siteSecrets'; siteId: string }
  | { kind: 'siteCardSecrets'; siteId: string; cardId: string }
  | { kind: 'adviserSecrets'; seat: number; cardId: string }
  | { kind: 'bannerSecrets' }; // the Darkest Secret (Law §2.5)

const SecretZoneSchema: z.ZodType<SecretZone> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('seatSecrets'), seat }),
  z.object({ kind: z.literal('sharedSecrets') }),
  z.object({ kind: z.literal('siteSecrets'), siteId: z.string() }),
  z.object({ kind: z.literal('siteCardSecrets'), siteId: z.string(), cardId: z.string() }),
  z.object({ kind: z.literal('adviserSecrets'), seat, cardId: z.string() }),
  z.object({ kind: z.literal('bannerSecrets') }),
]);

// -- warband zones: a seat's personal-bank reserve, their board (the force
// that travels with the pawn), or their presence at a specific site (Law
// §2.2.1/2.2.3; the three pools distinguished in unit 1's state shape).
export type WarbandZone =
  | { kind: 'seatWarbandBank'; seat: number }
  | { kind: 'seatWarbandBoard'; seat: number }
  | { kind: 'siteWarbands'; siteId: string; seat: number };

const WarbandZoneSchema: z.ZodType<WarbandZone> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('seatWarbandBank'), seat }),
  z.object({ kind: z.literal('seatWarbandBoard'), seat }),
  z.object({ kind: z.literal('siteWarbands'), siteId: z.string(), seat }),
]);

// -- card zones: everywhere a denizen/site/relic/vision id can sit.
export type CardZone =
  | { kind: 'seatHand'; seat: number }
  | { kind: 'seatAdvisers'; seat: number }
  | { kind: 'seatRelics'; seat: number }
  | { kind: 'seatVision'; seat: number } // capacity 1; Exile's Revealed Vision space
  | { kind: 'siteSlot'; siteId: string }
  | { kind: 'siteRelics'; siteId: string }
  | { kind: 'worldDeck' } // top only (index 0)
  | { kind: 'relicDeck' } // top only (index 0)
  | { kind: 'discard'; region: Region } // top of pile (index 0)
  | { kind: 'dispossessed' }
  | { kind: 'reliquary' }; // the Imperial Reliquary (Law §2.3; unit 16)

const CardZoneSchema: z.ZodType<CardZone> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('seatHand'), seat }),
  z.object({ kind: z.literal('seatAdvisers'), seat }),
  z.object({ kind: z.literal('seatRelics'), seat }),
  z.object({ kind: z.literal('seatVision'), seat }),
  z.object({ kind: z.literal('siteSlot'), siteId: z.string() }),
  z.object({ kind: z.literal('siteRelics'), siteId: z.string() }),
  z.object({ kind: z.literal('worldDeck') }),
  z.object({ kind: z.literal('relicDeck') }),
  z.object({ kind: z.literal('discard'), region: RegionSchema }),
  z.object({ kind: z.literal('dispossessed') }),
  z.object({ kind: z.literal('reliquary') }),
]);

// ---- flip targets ---------------------------------------------------------

/**
 * Non-mover effect: toggles a facedown/faceup or intact/ruined state in
 * place. A zone-to-zone mover can't express "same location, different
 * face" (D33's bar for a non-mover effect).
 */
export type FlipTarget =
  | { kind: 'adviser'; seat: number; cardId: string } // Law §6.1: play faceup/facedown
  | { kind: 'edifice'; siteId: string; cardId: string } // Law §2.9: intact <-> ruin
  | { kind: 'site'; siteId: string }; // Law §5.6.2: Travel's arrival reveal

const FlipTargetSchema: z.ZodType<FlipTarget> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('adviser'), seat, cardId: z.string() }),
  z.object({ kind: z.literal('edifice'), siteId: z.string(), cardId: z.string() }),
  z.object({ kind: z.literal('site'), siteId: z.string() }),
]);

// ---- effects --------------------------------------------------------------

const amount = z.number().int().positive();

export type Effect =
  | { kind: 'favor'; from: FavorZone; to: FavorZone; amount: number }
  | { kind: 'secret'; from: SecretZone; to: SecretZone; amount: number }
  | { kind: 'warbands'; from: WarbandZone; to: WarbandZone; amount: number }
  | { kind: 'card'; id: string; from: CardZone; to: CardZone }
  /** Top-of-source moves to `to`; the caller can't name a hidden id. */
  | { kind: 'draw'; from: CardZone; to: CardZone }
  | { kind: 'flip'; target: FlipTarget };

export const EffectSchema: z.ZodType<Effect> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('favor'), from: FavorZoneSchema, to: FavorZoneSchema, amount }),
  z.object({ kind: z.literal('secret'), from: SecretZoneSchema, to: SecretZoneSchema, amount }),
  z.object({ kind: z.literal('warbands'), from: WarbandZoneSchema, to: WarbandZoneSchema, amount }),
  z.object({ kind: z.literal('card'), id: z.string(), from: CardZoneSchema, to: CardZoneSchema }),
  z.object({ kind: z.literal('draw'), from: CardZoneSchema, to: CardZoneSchema }),
  z.object({ kind: z.literal('flip'), target: FlipTargetSchema }),
]);

export const EffectsSchema = z.array(EffectSchema);

// ---- zone lookups (internal) ----------------------------------------------

function fail(index: number, kind: string, reason: string): never {
  throw new IllegalAction(`applyEffects: effect ${index} (${kind}) is infeasible: ${reason}`);
}

function findSite(state: OathState, siteId: string, index: number, kind: string): SiteState {
  const site = state.sites.find((s) => s.id === siteId);
  if (!site) fail(index, kind, `no site ${siteId}`);
  return site;
}

function findSiteCard(state: OathState, siteId: string, cardId: string, index: number, kind: string) {
  const site = findSite(state, siteId, index, kind);
  const card = site.cards.find((c) => c?.id === cardId);
  if (!card) fail(index, kind, `card ${cardId} is not at site ${siteId}`);
  return card;
}

function findAdviser(state: OathState, seatNo: number, cardId: string, index: number, kind: string) {
  const player = state.players[seatNo];
  if (!player) fail(index, kind, `no seat ${seatNo}`);
  const adviser = player.advisers.find((a) => a.id === cardId);
  if (!adviser) fail(index, kind, `card ${cardId} is not an adviser of seat ${seatNo}`);
  return adviser;
}

/**
 * Runtime exhaustiveness guard. `EffectSchema` rejects a malformed zone
 * shape before it reaches here in the HTTP path, but `applyEffects` is
 * also called directly by trusted code, and a switch with no matching
 * case otherwise falls through silently (returning `undefined`) rather
 * than failing loudly — this turns "wrong zone kind for this mover" into
 * the same named IllegalAction as every other infeasibility.
 */
function badZone(index: number, kind: string, zone: { kind: string }): never {
  fail(index, kind, `${zone.kind} is not a valid ${kind} zone`);
}

// -- favor -------------------------------------------------------------

function readFavor(state: OathState, zone: FavorZone, index: number): number {
  switch (zone.kind) {
    case 'seatFavor':
      return state.players[zone.seat]?.favor ?? fail(index, 'favor', `no seat ${zone.seat}`);
    case 'favorBank':
      return state.favorBanks[zone.suit];
    case 'sharedFavor':
      return state.sharedBank.favor;
    case 'siteFavor':
      return findSite(state, zone.siteId, index, 'favor').favor;
    case 'siteCardFavor':
      return findSiteCard(state, zone.siteId, zone.cardId, index, 'favor').favor;
    case 'adviserFavor':
      return findAdviser(state, zone.seat, zone.cardId, index, 'favor').favor;
    case 'bannerFavor':
      return state.banners.find((b) => b.id === PEOPLES_FAVOR_ID)!.tokens;
    default:
      return badZone(index, 'favor', zone);
  }
}

function writeFavor(state: OathState, zone: FavorZone, value: number, index: number): void {
  switch (zone.kind) {
    case 'seatFavor':
      state.players[zone.seat].favor = value;
      return;
    case 'favorBank':
      state.favorBanks[zone.suit] = value;
      return;
    case 'sharedFavor':
      state.sharedBank.favor = value;
      return;
    case 'siteFavor':
      findSite(state, zone.siteId, index, 'favor').favor = value;
      return;
    case 'siteCardFavor':
      findSiteCard(state, zone.siteId, zone.cardId, index, 'favor').favor = value;
      return;
    case 'adviserFavor':
      findAdviser(state, zone.seat, zone.cardId, index, 'favor').favor = value;
      return;
    case 'bannerFavor':
      state.banners.find((b) => b.id === PEOPLES_FAVOR_ID)!.tokens = value;
      return;
    default:
      badZone(index, 'favor', zone);
  }
}

// -- secrets -------------------------------------------------------------

function readSecrets(state: OathState, zone: SecretZone, index: number): number {
  switch (zone.kind) {
    case 'seatSecrets':
      return state.players[zone.seat]?.secrets.ready ?? fail(index, 'secret', `no seat ${zone.seat}`);
    case 'sharedSecrets':
      return state.sharedBank.secrets;
    case 'siteSecrets':
      return findSite(state, zone.siteId, index, 'secret').secrets;
    case 'siteCardSecrets':
      return findSiteCard(state, zone.siteId, zone.cardId, index, 'secret').secrets;
    case 'adviserSecrets':
      return findAdviser(state, zone.seat, zone.cardId, index, 'secret').secrets;
    case 'bannerSecrets':
      return state.banners.find((b) => b.id === DARKEST_SECRET_ID)!.tokens;
    default:
      return badZone(index, 'secret', zone);
  }
}

function writeSecrets(state: OathState, zone: SecretZone, value: number, index: number): void {
  switch (zone.kind) {
    case 'seatSecrets':
      state.players[zone.seat].secrets.ready = value;
      return;
    case 'sharedSecrets':
      state.sharedBank.secrets = value;
      return;
    case 'siteSecrets':
      findSite(state, zone.siteId, index, 'secret').secrets = value;
      return;
    case 'siteCardSecrets':
      findSiteCard(state, zone.siteId, zone.cardId, index, 'secret').secrets = value;
      return;
    case 'adviserSecrets':
      findAdviser(state, zone.seat, zone.cardId, index, 'secret').secrets = value;
      return;
    case 'bannerSecrets':
      state.banners.find((b) => b.id === DARKEST_SECRET_ID)!.tokens = value;
      return;
    default:
      badZone(index, 'secret', zone);
  }
}

// -- warbands -------------------------------------------------------------

function readWarbands(state: OathState, zone: WarbandZone, index: number): number {
  const player = state.players[zone.seat];
  if (!player) fail(index, 'warbands', `no seat ${zone.seat}`);
  switch (zone.kind) {
    case 'seatWarbandBank':
      return player.warbands.bank;
    case 'seatWarbandBoard':
      return player.warbands.board;
    case 'siteWarbands':
      return findSite(state, zone.siteId, index, 'warbands').warbands[zone.seat];
    default:
      return badZone(index, 'warbands', zone);
  }
}

function writeWarbands(state: OathState, zone: WarbandZone, value: number, index: number): void {
  const player = state.players[zone.seat];
  switch (zone.kind) {
    case 'seatWarbandBank':
      player.warbands.bank = value;
      return;
    case 'seatWarbandBoard':
      player.warbands.board = value;
      return;
    case 'siteWarbands':
      findSite(state, zone.siteId, index, 'warbands').warbands[zone.seat] = value;
      return;
    default:
      badZone(index, 'warbands', zone);
  }
}

// -- cards -------------------------------------------------------------

/** Card ids legal in each card zone family, mirroring state.ts's own checks. */
const DRAWABLE = ['denizen:', 'vision:'];
const SITE_SLOT = ['denizen:', 'edifice:'];
const ADVISER = ['denizen:', 'vision:'];
const RELIC = ['relic:'];
const VISION = ['vision:'];

function zoneCardPrefixes(zone: CardZone, index: number): readonly string[] {
  switch (zone.kind) {
    case 'seatHand':
    case 'worldDeck':
    case 'discard':
    case 'dispossessed':
      return DRAWABLE;
    case 'seatAdvisers':
      return ADVISER;
    case 'seatRelics':
    case 'siteRelics':
    case 'relicDeck':
    case 'reliquary':
      return RELIC;
    case 'seatVision':
      return VISION;
    case 'siteSlot':
      return SITE_SLOT;
    default:
      return badZone(index, 'card', zone);
  }
}

function checkCardKind(id: string, zone: CardZone, index: number, verb: string): void {
  const prefixes = zoneCardPrefixes(zone, index);
  if (!prefixes.some((p) => id.startsWith(p))) {
    fail(index, 'card', `${id} cannot ${verb} ${zone.kind} (allowed: ${prefixes.join(', ')})`);
  }
}

/** Removes and returns the id from a card zone's array-shaped location. */
function takeCardId(state: OathState, zone: CardZone, id: string | null, index: number): string {
  const arr = cardArray(state, zone, index);
  const i = id === null ? 0 : arr.indexOf(id);
  if (i === -1 || arr[i] === undefined) {
    fail(index, 'card', `card ${id ?? '(top)'} is not in ${zone.kind}`);
  }
  const [taken] = arr.splice(i, 1);
  return taken;
}

function cardArray(state: OathState, zone: CardZone, index: number): string[] {
  switch (zone.kind) {
    case 'seatHand':
      return state.players[zone.seat]?.hand ?? fail(index, 'card', `no seat ${zone.seat}`);
    case 'seatRelics':
      return state.players[zone.seat]?.relics ?? fail(index, 'card', `no seat ${zone.seat}`);
    case 'siteRelics':
      return findSite(state, zone.siteId, index, 'card').relics;
    case 'worldDeck':
      return state.worldDeck;
    case 'relicDeck':
      return state.relicDeck;
    case 'discard':
      return state.discards[zone.region];
    case 'dispossessed':
      return state.dispossessed;
    case 'seatAdvisers':
    case 'seatVision':
    case 'siteSlot':
    case 'reliquary':
      throw new Error(`cardArray: ${zone.kind} is not array-shaped`);
    default:
      return badZone(index, 'card', zone);
  }
}

/** Adds an id into a card zone, enforcing that zone's capacity/shape rules. */
function placeCardId(state: OathState, zone: CardZone, id: string, index: number): void {
  checkCardKind(id, zone, index, 'enter');
  switch (zone.kind) {
    case 'seatAdvisers': {
      const player = state.players[zone.seat] ?? fail(index, 'card', `no seat ${zone.seat}`);
      if (player.advisers.length >= ADVISER_LIMIT) {
        fail(index, 'card', `seat ${zone.seat} already has ${ADVISER_LIMIT} advisers (Law §2.2.2)`);
      }
      player.advisers.push({ id, facedown: false, favor: 0, secrets: 0 });
      return;
    }
    case 'seatVision': {
      const player = state.players[zone.seat] ?? fail(index, 'card', `no seat ${zone.seat}`);
      if (player.vision !== null) {
        fail(index, 'card', `seat ${zone.seat} already has a Revealed Vision (Law §2.2.1)`);
      }
      player.vision = id;
      return;
    }
    case 'siteSlot': {
      const site = findSite(state, zone.siteId, index, 'card');
      const empty = site.cards.findIndex((c) => c === null);
      if (empty === -1) {
        fail(index, 'card', `site ${zone.siteId} is at capacity (Law §2.8.1)`);
      }
      site.cards[empty] = { id, favor: 0, secrets: 0 };
      return;
    }
    case 'reliquary': {
      // Not reachable in P2 scope (nothing returns a relic to the
      // Reliquary), but covers a space correctly if ever used.
      const space = state.reliquary.find((sp) => sp.relicId === null);
      if (!space) fail(index, 'card', 'the Imperial Reliquary has no uncovered space to place onto');
      space.relicId = id;
      return;
    }
    default: {
      const arr = cardArray(state, zone, index);
      if (zone.kind === 'worldDeck' || zone.kind === 'discard') arr.unshift(id);
      else arr.push(id);
      return;
    }
  }
}

/** Removes an id (or the top, if id is null) from a card zone. */
function removeCardId(state: OathState, zone: CardZone, id: string | null, index: number): string {
  switch (zone.kind) {
    case 'seatAdvisers': {
      const player = state.players[zone.seat] ?? fail(index, 'card', `no seat ${zone.seat}`);
      const i = id === null ? 0 : player.advisers.findIndex((a) => a.id === id);
      if (i === -1 || player.advisers[i] === undefined) {
        fail(index, 'card', `card ${id ?? '(any)'} is not an adviser of seat ${zone.seat}`);
      }
      return player.advisers.splice(i, 1)[0].id;
    }
    case 'seatVision': {
      const player = state.players[zone.seat] ?? fail(index, 'card', `no seat ${zone.seat}`);
      if (player.vision === null || (id !== null && player.vision !== id)) {
        fail(index, 'card', `seat ${zone.seat} has no matching Revealed Vision`);
      }
      const taken = player.vision;
      player.vision = null;
      return taken;
    }
    case 'siteSlot': {
      const site = findSite(state, zone.siteId, index, 'card');
      const i = id === null ? site.cards.findIndex((c) => c !== null) : site.cards.findIndex((c) => c?.id === id);
      if (i === -1 || site.cards[i] === null) {
        fail(index, 'card', `card ${id ?? '(any)'} is not at site ${zone.siteId}`);
      }
      const taken = site.cards[i]!.id;
      site.cards[i] = null;
      return taken;
    }
    case 'reliquary': {
      // Law §6.6.2: a Citizenship offer names a specific relic — find its
      // space by relic id, not position (position identifies the MODIFIER,
      // not which relic happens to sit on it).
      const space =
        id === null
          ? state.reliquary.find((sp) => sp.relicId !== null)
          : state.reliquary.find((sp) => sp.relicId === id);
      if (!space || space.relicId === null) {
        fail(index, 'card', `card ${id ?? '(any)'} is not in the Imperial Reliquary`);
      }
      const taken = space.relicId;
      space.relicId = null;
      return taken;
    }
    default:
      return takeCardId(state, zone, id, index);
  }
}

// ---- flip -------------------------------------------------------------

function applyFlip(state: OathState, target: FlipTarget, index: number): void {
  switch (target.kind) {
    case 'adviser': {
      const adviser = findAdviser(state, target.seat, target.cardId, index, 'flip');
      adviser.facedown = !adviser.facedown;
      return;
    }
    case 'edifice': {
      const card = findSiteCard(state, target.siteId, target.cardId, index, 'flip');
      card.ruined = !card.ruined;
      return;
    }
    case 'site': {
      const site = findSite(state, target.siteId, index, 'flip');
      site.facedown = !site.facedown;
      return;
    }
  }
}

// ---- applyEffects -------------------------------------------------------

/**
 * Applies `effects` in order to a private deep clone of `state`, returning
 * the result. Feasibility only (HLD D34): never asks whether a card's text
 * permits an effect, only whether the zones and amounts are there. Throws
 * `IllegalAction` naming the failing effect's index and reason; nothing
 * partial is returned. Pure — does not mutate its input.
 *
 * `actor` is threaded through for the caller's own bookkeeping/future
 * legality checks (e.g. unit 14's access rules, Law §7.1.1); this function
 * does not itself restrict which zones `actor` may touch.
 */
export function applyEffects(state: OathState, actor: number, effects: Effect[]): OathState {
  void actor;
  const working: OathState = structuredClone(state);

  effects.forEach((effect, index) => {
    switch (effect.kind) {
      case 'favor': {
        const have = readFavor(working, effect.from, index);
        if (have < effect.amount) {
          fail(index, 'favor', `${effect.from.kind} has ${have}, need ${effect.amount}`);
        }
        writeFavor(working, effect.from, have - effect.amount, index);
        writeFavor(working, effect.to, readFavor(working, effect.to, index) + effect.amount, index);
        return;
      }
      case 'secret': {
        const have = readSecrets(working, effect.from, index);
        // Law §9.3: secrets (like dice) are NOT component-limited — the
        // shared bank is an inexhaustible source, so a draw from it always
        // succeeds and its tally may go "negative" (proxy tokens). Every
        // other secret zone is a real, limited pile.
        if (effect.from.kind !== 'sharedSecrets' && have < effect.amount) {
          fail(index, 'secret', `${effect.from.kind} has ${have}, need ${effect.amount}`);
        }
        writeSecrets(working, effect.from, have - effect.amount, index);
        writeSecrets(working, effect.to, readSecrets(working, effect.to, index) + effect.amount, index);
        return;
      }
      case 'warbands': {
        const have = readWarbands(working, effect.from, index);
        if (have < effect.amount) {
          fail(index, 'warbands', `${effect.from.kind} has ${have}, need ${effect.amount}`);
        }
        writeWarbands(working, effect.from, have - effect.amount, index);
        writeWarbands(working, effect.to, readWarbands(working, effect.to, index) + effect.amount, index);
        return;
      }
      case 'card': {
        checkCardKind(effect.id, effect.from, index, 'leave');
        removeCardId(working, effect.from, effect.id, index);
        placeCardId(working, effect.to, effect.id, index);
        return;
      }
      case 'draw': {
        if (effect.from.kind !== 'worldDeck' && effect.from.kind !== 'discard' && effect.from.kind !== 'relicDeck') {
          fail(index, 'draw', `${effect.from.kind} has no "top" to draw from`);
        }
        const id = removeCardId(working, effect.from, null, index);
        placeCardId(working, effect.to, id, index);
        return;
      }
      case 'flip': {
        applyFlip(working, effect.target, index);
        return;
      }
    }
  });

  return working;
}
