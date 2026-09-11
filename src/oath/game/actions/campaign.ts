/**
 * `campaign` (unit 12) — Law §5.5, Steps 1-2 (declare + collect dice pools)
 * through Steps 4-5 (roll). Three actions share one in-progress sub-state
 * (`state.campaign`, non-null from `declare` until unit 13 clears it):
 *
 *   campaign.declare — the attacker (must be the active seat). §5.5.1:
 *     spend 2 Supply and choose a defender — any OTHER seat who rules the
 *     attacker's site or whose pawn is there, or `'bandits'` if NO seat
 *     rules it (Glossary §10.21: bandits rule a faceup site with zero
 *     warbands on it — a site the attacker themself rules is never a
 *     bandits site). §5.5.2: declare any number of targets (site /
 *     pawnFavor / banner / relic) and choose how many attack dice to
 *     commit, 0..the attacker's board warbands. This is a REAL choice,
 *     not automatic ("up to the number of warbands on your board") —
 *     every attack die risks a self-kill skull (§5.5.5), so an attacker
 *     may rationally commit fewer than their full board. At least one
 *     target must be "at your site": a site target for the attacker's
 *     own `pawnSite`, or a pawnFavor/banner/relic target (all three
 *     already imply the defender's pawn is there). If the defender (or
 *     bandits) rules the attacker's site, a site target for it
 *     SPECIFICALLY is mandatory — the other three kinds don't satisfy
 *     that stronger clause. Defense dice total = 1 per site target
 *     (§2.8.3: every site prints exactly one defense die, no per-site
 *     variation) + 2 for pawnFavor (§5.5.2's fixed "two dice, as shown by
 *     the shield on their board") + a targeted banner's current `tokens`
 *     (§2.5.2 — the SAME field means favor-on-it for the People's Favor
 *     and secrets-on-it for the Darkest Secret; see `BannerState.tokens`)
 *     + a targeted relic's printed `defenseDice` (§2.4.2 — P1 follow-up
 *     landed 2026-09-11, data/relic-defense-dice.json). No card powers
 *     apply to any of this yet (v1: power.use, unit 14) — but Plains and
 *     Mountain's attack-die modifiers (§11.4) are NOT card-power text,
 *     they're a mandatory Site Reference rule keyed only on site identity
 *     ("You must add/subtract... even if you rule"), decidable from data
 *     P1 already has (the site's name), so they're applied directly
 *     below rather than deferred: +1 attack die if ANY declared target is
 *     located at Plains, -1 if any is located at Mountain (both, if both
 *     — they don't cancel by rule, they're independent "must" clauses
 *     that happen to net out); a site target's location is itself, every
 *     other kind's location is the attacker's own site (Law §9.2: "must"
 *     rules are unconditional). The player's declared `attackDice` is
 *     their commitment (0..board warbands, checked against that cap
 *     BEFORE the modifier); the stored `campaign.attackDice` is the
 *     post-modifier pool actually rolled, clamped at 0. Opens a response
 *     window UNLESS the defender is bandits (no player to respond, so
 *     `declare` skips straight to phase `'roll'`).
 *
 *   campaign.respond — the defender ONLY (not necessarily the active
 *     seat — turn order doesn't pass during a campaign). Closes the
 *     response window. The real rule (§5.5.3, battle plans) is a card-
 *     power interaction; this unit's naive P2 window is just: the
 *     defender may `power.use` first (unit 14 wires that action to check
 *     `state.campaign` so its window-owner timing rule has something to
 *     check against), then submits this action to move on. P3 will batch
 *     interrupts like this into fewer round trips.
 *
 *   campaign.roll — the attacker ONLY, once no response window remains
 *     (`phase === 'roll'`). §5.5.4/5.5.5: rolls `attackDice` attack dice
 *     and `defenseDice` defense dice in `prepare()` (HLD D14) and persists
 *     the FACES, so replay reuses them instead of re-rolling. `reduce`
 *     only stores what `prepare` rolled — turning faces into an attack/
 *     defense TOTAL and declaring a winner is unit 13's job (§5.5.6-8).
 *
 * Dice faces — the Playbook's "Dice Faces" component reference (p.15),
 * NOT the Law text itself (the Law only describes what the symbols DO;
 * which faces exist and how many of each is printed on the physical dice,
 * so the Law doesn't need to restate it — same category of gap as the
 * per-site recover cost was before its P1 follow-up):
 *   Attack die (6 faces):  3x hollowSword, 2x sword, 1x skull. A sword
 *     counts 1; two hollowSwords count as 1 (a lone one counts 0) — Law
 *     §5.5.5. A skull kills one of the attacker's own board warbands,
 *     immediately, regardless of the campaign's outcome.
 *   Defense die (6 faces): 2x blank, 2x shield (1 shield), 1x
 *     doubleShield (2 shields, not a multiplier), 1x shieldX2 (doubles
 *     the running shield total — Law §5.5.4: "each roll doubles the
 *     total... multiple rolls stack exponentially, x4, x8, etc.").
 *
 * DEFERRED (documented, not silently dropped):
 *   - Imperial Allies (§5.5.1's last two sentences; §5.5.2's Chancellor-
 *     joins/Citizen-may-join; their warband bonuses to the defense TOTAL
 *     in §5.5.4). Meaningless to build or test before Citizenship
 *     (unit 16) gives a Citizen seat a way to exist and to opt in. Read
 *     closely, re-checking against the plan's own speculative "citizenship
 *     restriction" TDD bullet: there is NO such restriction. The "not an
 *     Imperial player during this Campaign" sentences describe a STATUS
 *     CHANGE for the duration of the campaign (relevant only to who may
 *     later join as an Ally), never a legality restriction on WHO may be
 *     declared as attacker or defender. Any seat may campaign against any
 *     other, citizenship notwithstanding.
 *   - Battle plans (§5.5.3) — card powers; v1 defers all power text.
 */

import { z } from 'zod';
import type { ProposedAction } from '../../../engine/types.js';
import { IllegalAction, type GameAction } from '../../../engine/types.js';
import { rollDice } from '../../../engine/random.js';
import { byId } from '../../cards/index.js';
import type { Relic } from '../../cards/schema.js';
import {
  DARKEST_SECRET_ID,
  PEOPLES_FAVOR_ID,
  type AttackFace,
  type DefenseFace,
  type OathState,
} from '../state.js';
import { requireActiveSeat, type Handler } from '../turn.js';

const CAMPAIGN_COST = 2; // Supply (Law §5.5.1)
const PAWN_FAVOR_DICE = 2; // Law §5.5.2 (fixed, "as shown by the shield on their board")
const SITE_DEFENSE_DICE = 1; // Law §2.8.3 ("a defense die" — every site prints exactly one)

/** Playbook "Dice Faces" (p.15) — see file header. */
export const ATTACK_DIE: readonly AttackFace[] = [
  'hollowSword',
  'hollowSword',
  'hollowSword',
  'sword',
  'sword',
  'skull',
];
export const DEFENSE_DIE: readonly DefenseFace[] = [
  'blank',
  'blank',
  'shield',
  'shield',
  'doubleShield',
  'shieldX2',
];

const TargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('site'), siteId: z.string() }),
  z.object({ kind: z.literal('pawnFavor') }),
  z.object({ kind: z.literal('banner'), bannerId: z.enum(['peoples-favor', 'darkest-secret']) }),
  z.object({ kind: z.literal('relic'), relicId: z.string() }),
]);

const DeclarePayloadSchema = z.object({
  defender: z.union([z.number().int().min(0), z.literal('bandits')]),
  targets: z.array(TargetSchema).min(1),
  attackDice: z.number().int().min(0),
});

function bannerFullId(short: 'peoples-favor' | 'darkest-secret'): string {
  return short === 'peoples-favor' ? PEOPLES_FAVOR_ID : DARKEST_SECRET_ID;
}

/** Law §10.21: every seat with a warband on this (faceup) site rules it. */
function rulersOf(state: OathState, siteId: string): number[] {
  const site = state.sites.find((s) => s.id === siteId);
  if (!site || site.facedown) return [];
  return site.warbands.flatMap((w, seat) => (w > 0 ? [seat] : []));
}

function declare(state: OathState, action: GameAction): OathState {
  const attackerSeat = requireActiveSeat(state, action);
  const parsed = DeclarePayloadSchema.safeParse(action.payload);
  if (!parsed.success) throw new IllegalAction('campaign.declare: malformed payload');
  const { defender, attackDice, targets } = parsed.data;
  const attacker = state.players[attackerSeat];
  const attackerSite = attacker.pawnSite;

  if (attacker.supply < CAMPAIGN_COST) {
    throw new IllegalAction(`campaign.declare: costs ${CAMPAIGN_COST} Supply (Law §5.5.1)`);
  }
  if (defender === attackerSeat) {
    throw new IllegalAction('campaign.declare: cannot declare yourself as defender');
  }
  if (attackDice > attacker.warbands.board) {
    throw new IllegalAction(
      `campaign.declare: attackDice (${attackDice}) exceeds your board warbands (Law §5.5.2)`,
    );
  }

  const rulers = rulersOf(state, attackerSite);
  if (defender === 'bandits') {
    if (rulers.length > 0) {
      throw new IllegalAction(
        'campaign.declare: bandits can only defend if no player rules your site (Law §5.5.1)',
      );
    }
  } else {
    if (defender < 0 || defender >= state.seats) {
      throw new IllegalAction('campaign.declare: no such seat');
    }
    const pawnHere = state.players[defender].pawnSite === attackerSite;
    if (!rulers.includes(defender) && !pawnHere) {
      throw new IllegalAction(
        "campaign.declare: the defender must rule your site or have their pawn there (Law §5.5.1)",
      );
    }
  }
  const defenderPawnHere = defender !== 'bandits' && state.players[defender].pawnSite === attackerSite;

  const seen = new Set<string>();
  let defenseDice = 0;
  let targetsYourSite = false; // satisfies the "at least one target at your site" clause
  let targetsYourSiteSpecifically = false; // satisfies the stronger "must target it" clause
  let targetsPlains = false; // Law §11.4
  let targetsMountain = false;

  for (const t of targets) {
    const key =
      t.kind === 'site'
        ? `site:${t.siteId}`
        : t.kind === 'banner'
          ? `banner:${t.bannerId}`
          : t.kind === 'relic'
            ? `relic:${t.relicId}`
            : 'pawnFavor';
    if (seen.has(key)) throw new IllegalAction(`campaign.declare: duplicate target (${key})`);
    seen.add(key);

    // §5.5.2's four target kinds, one branch each. Every kind but `site`
    // requires the defender's pawn at the attacker's site — that's WHY
    // they're "at your site" (their `locationSiteId` is the attacker's own
    // site, unconditionally, below), not a separate rule for each.
    let dice: number;
    let locationSiteId: string;
    switch (t.kind) {
      case 'site': {
        const targetSite = state.sites.find((s) => s.id === t.siteId);
        const ruledByDefender =
          !!targetSite &&
          !targetSite.facedown &&
          (defender === 'bandits'
            ? rulersOf(state, t.siteId).length === 0
            : rulersOf(state, t.siteId).includes(defender));
        if (!ruledByDefender) {
          throw new IllegalAction(`campaign.declare: the defender does not rule ${t.siteId} (Law §5.5.2)`);
        }
        dice = SITE_DEFENSE_DICE;
        locationSiteId = t.siteId;
        break;
      }
      case 'pawnFavor': {
        if (!defenderPawnHere) {
          throw new IllegalAction(
            "campaign.declare: pawnFavor requires the defender's pawn at your site (Law §5.5.2)",
          );
        }
        dice = PAWN_FAVOR_DICE;
        locationSiteId = attackerSite;
        break;
      }
      case 'banner': {
        if (!defenderPawnHere) {
          throw new IllegalAction(
            "campaign.declare: banners require the defender's pawn at your site (Law §5.5.2)",
          );
        }
        const bannerId = bannerFullId(t.bannerId);
        const banner = state.banners.find((b) => b.id === bannerId)!;
        if (banner.holder !== defender) {
          throw new IllegalAction(`campaign.declare: the defender does not hold ${bannerId} (Law §5.5.2)`);
        }
        dice = banner.tokens; // §2.5.2: favor-on-it (People's Favor) or secrets-on-it (Darkest Secret)
        locationSiteId = attackerSite;
        break;
      }
      case 'relic': {
        if (!defenderPawnHere) {
          throw new IllegalAction(
            "campaign.declare: relics require the defender's pawn at your site (Law §5.5.2)",
          );
        }
        if (!state.players[defender as number].relics.includes(t.relicId)) {
          throw new IllegalAction(`campaign.declare: the defender does not hold ${t.relicId} (Law §5.5.2)`);
        }
        dice = (byId(t.relicId) as Relic).defenseDice;
        locationSiteId = attackerSite;
        break;
      }
    }

    defenseDice += dice;
    const atYourSite = locationSiteId === attackerSite;
    if (atYourSite) targetsYourSite = true;
    if (atYourSite && t.kind === 'site') targetsYourSiteSpecifically = true;
    const locationName = byId(locationSiteId).name; // Law §11.4
    if (locationName === 'Plains') targetsPlains = true;
    if (locationName === 'Mountain') targetsMountain = true;
  }

  if (!targetsYourSite) {
    throw new IllegalAction(
      'campaign.declare: must declare at least one target at your site (Law §5.5.2)',
    );
  }
  const defenderRulesYourSite = defender === 'bandits' ? true : rulers.includes(defender);
  if (defenderRulesYourSite && !targetsYourSiteSpecifically) {
    throw new IllegalAction(
      'campaign.declare: the defender rules your site — you must target it (Law §5.5.2)',
    );
  }

  // Law §11.4: mandatory, keyed on site identity alone — not a card power.
  const dieModifier = (targetsPlains ? 1 : 0) - (targetsMountain ? 1 : 0);
  const finalAttackDice = Math.max(0, attackDice + dieModifier);

  attacker.supply -= CAMPAIGN_COST;
  state.campaign = {
    attackerSeat,
    defenderSeat: defender,
    targets: targets.map((t) => (t.kind === 'banner' ? { kind: 'banner', bannerId: bannerFullId(t.bannerId) } : t)),
    attackDice: finalAttackDice,
    defenseDice,
    phase: defender === 'bandits' ? 'roll' : 'respond',
    declaredAt: state.actionCount,
  };
  return state;
}

function respond(state: OathState, action: GameAction): OathState {
  if (state.complete) throw new IllegalAction('campaign.respond: the game is already complete');
  const c = state.campaign;
  if (!c || c.phase !== 'respond') {
    throw new IllegalAction('campaign.respond: no campaign is awaiting a response');
  }
  if (action.actor !== c.defenderSeat) {
    throw new IllegalAction("campaign.respond: only the campaign's defender may respond");
  }
  c.phase = 'roll';
  return state;
}

function roll(state: OathState, action: GameAction): OathState {
  const seat = requireActiveSeat(state, action, { campaignOk: true });
  const c = state.campaign;
  if (!c || c.phase !== 'roll') {
    throw new IllegalAction('campaign.roll: no campaign is awaiting a roll');
  }
  if (seat !== c.attackerSeat) {
    throw new IllegalAction("campaign.roll: only the campaign's attacker may roll");
  }
  const payload = action.payload as { attackFaces?: unknown; defenseFaces?: unknown };
  const { attackFaces, defenseFaces } = payload;
  const validAttack =
    Array.isArray(attackFaces) &&
    attackFaces.length === c.attackDice &&
    attackFaces.every((f) => (ATTACK_DIE as readonly unknown[]).includes(f));
  const validDefense =
    Array.isArray(defenseFaces) &&
    defenseFaces.length === c.defenseDice &&
    defenseFaces.every((f) => (DEFENSE_DIE as readonly unknown[]).includes(f));
  if (!validAttack || !validDefense) {
    throw new IllegalAction('campaign.roll: missing or malformed dice faces');
  }
  c.attackFaces = attackFaces as AttackFace[];
  c.defenseFaces = defenseFaces as DefenseFace[];
  c.phase = 'rolled';
  return state;
}

export const CAMPAIGN_HANDLERS: Record<string, Handler> = {
  'campaign.declare': declare,
  'campaign.respond': respond,
  'campaign.roll': roll,
};

/**
 * `prepare()` for 'campaign.roll' (HLD D14): roll both pools now, fold the
 * faces into the payload `reduce` will see. Everything else passes through.
 */
export function prepareCampaign(state: OathState, proposed: ProposedAction): unknown {
  if (proposed.type !== 'campaign.roll') return proposed.payload;
  const c = state.campaign;
  if (!c || c.phase !== 'roll') {
    throw new IllegalAction('campaign.roll: no campaign is awaiting a roll');
  }
  const base =
    typeof proposed.payload === 'object' && proposed.payload !== null ? proposed.payload : {};
  return {
    ...base,
    attackFaces: rollDice(ATTACK_DIE, c.attackDice),
    defenseFaces: rollDice(DEFENSE_DIE, c.defenseDice),
  };
}
