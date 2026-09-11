/**
 * `power.use` (unit 14; enforcement seam wired in unit 15 — HLD D28/D34).
 * Payload `{ cardId, effects?: Effect[], choices?: unknown, note? }`: the
 * player NAMES a card. If `cardId` has a registered implementation
 * (`oath/powers/registry.ts`), `prepare()` IGNORES any declared `effects`
 * and calls the impl with `choices` instead — enforced REPLACES declared,
 * per D34, and the persisted payload becomes `{ cardId, effects: <the
 * impl's output>, choices }`, the SAME shape a declaration has, so `reduce`
 * (and the log) can't tell which path produced it. If `cardId` has no
 * impl, `prepare` passes the client's payload through unchanged, and
 * `reduce` requires `effects` to be present — declare it, or don't submit.
 * Either way, the engine never checks that the effects match the named
 * card's actual printed text — that's the player's job (or a registered
 * impl's) in v1, and disputes are a rollback, not an adjudication (HLD
 * "Rollback is the rules engine"). What IS checked, structurally, cites
 * the rulebook exactly:
 *
 *   §7.1.1 Access — you may use a card's power only if you RULE it or
 *     your PAWN is at its site. Concretely, one of:
 *       - a relic in your OWN personal bank (you hold it — D34: relics
 *         and banners use this same action, no separate one)
 *       - a banner you hold (`banner.holder === actor`)
 *       - your own FACEUP adviser (a facedown adviser has no suit,
 *         restriction, or power at all — §5.1.4.II — so it structurally
 *         cannot have a power to use, not just an access failure)
 *       - a site itself (§2.8.5's own power), or a denizen/edifice AT a
 *         faceup site — legal if you RULE that site (Law §6.6.3, unit 16
 *         follow-up: for a purple-warbanded site this means EVERY Imperial
 *         player, not just whichever seat's slot our bookkeeping credits
 *         — `rule.ts#rulersOf`) OR your pawn is there
 *       - an uncovered Imperial Reliquary space, id `reliquary:<modifier>`
 *         (unit 16 follow-up; Law §2.3, §7.1.1's own named exception) —
 *         the Chancellor only, no ruling/pawn condition, once that space's
 *         relic has been taken (`citizenship.accept`). The 4 modifiers
 *         (Brutal/Decadent/Careless/Greedy) are printed board text with no
 *         database id, so they're synthetic ids rather than a `byId`
 *         lookup; what each one actually DOES stays declared, same as
 *         every other card power in v1 (RULINGS.md has the transcription).
 *     Everything else — a card in hand, a discard pile, the world deck, a
 *     facedown site, a facedown Reliquary relic, an enemy's adviser or
 *     held relic/banner — is not a zone this action can reach; §7.1.1's
 *     one remaining named exception (the Oathkeeper title's own power)
 *     isn't a card with an id in our database and is still out of scope.
 *   Effect feasibility — `applyEffects` (unit 3/D34): every effect must
 *     be affordable and present; the whole action is atomic, nothing
 *     partial applies on a rejection.
 *   Timing — usable on your own turn (the standard Act-Phase timing,
 *     §7.3.2, via the same `requireActiveSeat` every major/minor action
 *     uses — including its mid-Search and Campaign locks), OR, the one
 *     door unit 12 left open: during another seat's Campaign RESPONSE
 *     window specifically (`state.campaign.phase === 'respond'`), by
 *     that window's owner (the defender) — the naive P2 shape of §5.5.3's
 *     "the defender may use battle plans" step. No finer-grained timing
 *     (which specific standalone-power TYPE, §7.3.1-4) is checked; v1
 *     leaves that to the players, same as effect content.
 *
 * `EffectSchema` validates the payload's shape in BOTH `prepare()` (so a
 * malformed submission is rejected before it is ever written to the log,
 * per the plan) and `reduce()` (so direct-`reduce` callers — every test in
 * this codebase that isn't going through the HTTP/store layer — get the
 * same clean `IllegalAction` instead of a raw TypeError).
 */

import { z } from 'zod';
import type { ProposedAction } from '../../../engine/types.js';
import { IllegalAction, type GameAction } from '../../../engine/types.js';
import { applyEffects, EffectsSchema } from '../effects.js';
import { lookup } from '../../powers/registry.js';
import { rulersOf } from '../rule.js';
import { DARKEST_SECRET_ID, PEOPLES_FAVOR_ID, type OathState, type ReliquaryModifier } from '../state.js';
import { requireActiveSeat, type Handler } from '../turn.js';

/**
 * Stable ids for the Imperial Reliquary's 4 printed action modifiers
 * (unit 16 follow-up; Law §2.3, §6.6.2, §7.1.1's "the Chancellor always has
 * the mandatory powers on the uncovered spaces of the Imperial Reliquary").
 * Not in the card database — these are board text, not cards — so they get
 * a synthetic id scheme instead of a `byId` lookup. `hasAccess` grants the
 * Chancellor access once a space's covering relic is gone; what the
 * modifier actually DOES stays declared (v1: same as every other card
 * power, per D9/D28 — see RULINGS.md for the transcribed text).
 */
function reliquaryPowerId(modifier: ReliquaryModifier): string {
  return `reliquary:${modifier}`;
}

const PowerUsePayloadSchema = z.object({
  cardId: z.string(),
  // Optional at the schema level: a registered card's client payload omits
  // it entirely (choices drive the impl instead); `reduce` is what actually
  // requires it to be present by the time an action lands (see `use`).
  effects: EffectsSchema.optional(),
  choices: z.unknown().optional(),
  note: z.string().optional(),
});

/** Law §7.1.1: does `actor` have access to `cardId`'s power? */
function hasAccess(state: OathState, actor: number, cardId: string): boolean {
  if (state.players[actor].relics.includes(cardId)) return true; // a relic you hold
  if (cardId === PEOPLES_FAVOR_ID || cardId === DARKEST_SECRET_ID) {
    return state.banners.find((b) => b.id === cardId)?.holder === actor;
  }
  if (state.players[actor].advisers.some((a) => a.id === cardId && !a.facedown)) {
    return true; // your own FACEUP adviser — facedown ones have no power at all
  }
  // Law §7.1.1: "the Chancellor always has the mandatory powers on the
  // uncovered spaces of the Imperial Reliquary" — no ruling/pawn condition,
  // just citizenship, unlike every other zone this function checks.
  for (const space of state.reliquary) {
    if (reliquaryPowerId(space.modifier) !== cardId) continue;
    return space.relicId === null && state.players[actor].citizenship === 'chancellor';
  }
  for (const site of state.sites) {
    if (site.facedown) continue;
    if (site.id !== cardId && !site.cards.some((c) => c?.id === cardId)) continue;
    // Law §6.6.3 (unit 16 follow-up): rules a site iff you're AMONG its
    // rulers — which, for a purple-warbanded site, is every Imperial
    // player, not just whichever seat's slot our bookkeeping credits.
    const rulesSite = rulersOf(state, site.id).includes(actor);
    const pawnHere = state.players[actor].pawnSite === site.id;
    return rulesSite || pawnHere;
  }
  return false;
}

/**
 * Law §5.5.3's naive P2 door (unit 12): who may act inside the response
 * window. Unit 16a part 2 widened it from the defender alone to the
 * defender AND their permitted Imperial Allies — "If an Imperial player is
 * defending, the defender and any Allies may use any battle plans they
 * rule." Only WHO may act is structural; the battle plans themselves stay
 * v1-declared (see this file's header).
 */
function isRespondingDefender(state: OathState, actor: number): boolean {
  const c = state.campaign;
  if (c?.phase !== 'respond') return false;
  return c.defenderSeat === actor || c.allies.includes(actor);
}

function requireTiming(state: OathState, action: GameAction): number {
  if (action.actor !== null && isRespondingDefender(state, action.actor)) {
    return action.actor;
  }
  return requireActiveSeat(state, action);
}

function use(state: OathState, action: GameAction): OathState {
  const seat = requireTiming(state, action);
  const parsed = PowerUsePayloadSchema.safeParse(action.payload);
  if (!parsed.success) throw new IllegalAction('power.use: malformed payload');
  const { cardId, effects } = parsed.data;
  if (effects === undefined) {
    throw new IllegalAction(
      `power.use: no effects to apply — declare them, or register an enforcement impl for ${cardId}`,
    );
  }

  if (!hasAccess(state, seat, cardId)) {
    throw new IllegalAction(`power.use: no access to ${cardId} (Law §7.1.1)`);
  }

  return applyEffects(state, seat, effects);
}

export const POWER_HANDLERS: Record<string, Handler> = {
  'power.use': use,
};

/**
 * Rejects a malformed payload before it is ever written to the log, and
 * (unit 15) is the enforcement seam itself: a registered `cardId` gets its
 * effects from the impl, not the client, per D34.
 */
export function preparePower(state: OathState, proposed: ProposedAction): unknown {
  if (proposed.type !== 'power.use') return proposed.payload;
  const parsed = PowerUsePayloadSchema.safeParse(proposed.payload);
  if (!parsed.success) throw new IllegalAction('power.use: malformed payload');
  const { cardId, choices } = parsed.data;

  const impl = lookup(cardId);
  if (!impl) return proposed.payload; // no impl — the declared path, unchanged

  if (proposed.actor === null) throw new IllegalAction('power.use requires a seated actor');
  const effects = impl(state, proposed.actor, choices);
  return { cardId, effects, choices };
}
