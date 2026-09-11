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
 *   campaign.ally — an eligible CITIZEN, during the response window (unit
 *     16a part 2). §5.5.2: "any Citizen except the attacker, with the
 *     defender's permission, may choose to join as an Ally if their pawn
 *     is at a targeted site or the site of the attacker's pawn." This is
 *     the Citizen's half of that — offering. The defender's half is
 *     `campaign.respond`'s `allies` payload, which must name a subset of
 *     those who offered, so both consents are explicit actions in the log
 *     without a third phase. The Chancellor needs neither: their join is
 *     mandatory and recorded at `declare` (see `mandatoryAllies`).
 *
 *   campaign.respond — the defender ONLY (not necessarily the active
 *     seat — turn order doesn't pass during a campaign). Grants Ally
 *     permission, then closes the response window. The real rule (§5.5.3,
 *     battle plans) is a card-power interaction; this unit's naive P2
 *     window is just: the defender AND their permitted Allies may
 *     `power.use` first (unit 14 wires that action to check
 *     `state.campaign` so its window-owner timing rule has something to
 *     check against), then the defender submits this action to move on.
 *     P3 will batch interrupts like this into fewer round trips — which is
 *     also what would let a CITIZEN Ally use a battle plan: with one
 *     window, a Citizen's permission arrives in the very action that
 *     closes it, so in practice only the mandatory Chancellor Ally (joined
 *     at declare) can act inside it. The Law's own order — §5.5.2 join,
 *     then §5.5.3 battle plans — needs the two windows P3 will provide.
 *
 *   campaign.roll — the attacker ONLY, once no response window remains
 *     (`phase === 'roll'`). §5.5.4/5.5.5: rolls `attackDice` attack dice
 *     and `defenseDice` defense dice in `prepare()` (HLD D14) and persists
 *     the FACES, so replay reuses them instead of re-rolling. `reduce`
 *     only stores what `prepare` rolled — turning faces into an attack/
 *     defense TOTAL and declaring a winner is `campaign.resolve`'s job
 *     (unit 13, §5.5.6-8).
 *
 *   campaign.resolve — the attacker ONLY (`phase === 'rolled'`). §5.5.4's
 *     defense total = shields (doubled once per shieldX2 face rolled,
 *     stacking exponentially) + warbands at each targeted site (or, vs.
 *     bandits, 1 per targeted site — bandits aren't warband-counted) +
 *     the defender's OWN board warbands, but ONLY if their pawn is at the
 *     attacker's site or at any targeted site. §5.5.5's attack total =
 *     swords + floor(hollowSwords / 2) (a lone hollow sword counts 0).
 *     Skulls kill that many of the attacker's own board warbands
 *     IMMEDIATELY, win or lose. If the roll alone doesn't exceed defense,
 *     the payload's `sacrifice` may raise it — Law §9.5 ("no unprompted
 *     losses") makes this exact, not "at least": `sacrifice` must be 0 or
 *     precisely `defense - swords + 1`, and the attacker must have that
 *     many board warbands left (post-skull) to spend; sacrificing IS
 *     killing (Glossary "Sacrifice"). §5.5.6 Resolve Defeat then applies
 *     to whichever side lost (bandits are exempt — "cannot be killed,
 *     they just go into hiding"): half (rounded down) of the force dies,
 *     the rest consolidates (see `defendingForce`/`survivorBoardOf` for
 *     what a force is and where its survivors land). On a loss, the
 *     campaign clears here — nothing left to choose. On a win, either the
 *     phase advances to `'casualties'` (the allocation is a real choice)
 *     or the defeat is applied with the default allocation and §5.5.7's
 *     MANDATORY spoils follow immediately: every targeted relic and banner
 *     is taken — a seized banner burns 2 favor/secrets (minimum 1 left)
 *     and, if it's the People's Favor, flips to Mob (§2.5.3) — then phase
 *     advances to `'seize'` for the CHOICE-bearing rest.
 *
 *   campaign.casualties — the Chancellor ONLY, or the defeated player when
 *     they are not an Imperial player (`casualtyChooser`; `phase ===
 *     'casualties'`, unit 16a). §5.5.6's aside: "If an Imperial player is
 *     defending, the Chancellor chooses which warbands in the defending
 *     force are killed." Allocates the engine-computed kill quota across
 *     the force's (site, seat) and (board, seat) locations; the quota
 *     itself is never taken from the payload. Then applies §5.5.7's spoils
 *     and advances to `'seize'`, so the Law's step order holds on this
 *     path exactly as it does on the auto-allocated one. The phase is
 *     raised ONLY when the allocation can change the final position —
 *     see `allocationMatters`.
 *
 *   campaign.seize — the attacker ONLY (`phase === 'seize'`, so only
 *     reachable after a win). §5.5.7's remaining choices, all optional:
 *     `placements` — any number (even 0) of the attacker's board warbands
 *     onto any targeted sites; `banishTo` — travel the defender's pawn to
 *     a site of the attacker's choice, spending no Supply (only legal if
 *     pawnFavor was targeted); `burnFavor` — burn half (rounded down) of
 *     the defender's favor (same condition). Clears the campaign.
 *     Oathkeeper/victory-goal consequences of any of this are unit 17's
 *     check, not this action's — it only moves the objects.
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
 * IMPLEMENTED AS A UNIT 16 FOLLOW-UP (2026-09-11, same day, once flagged —
 * not left on the deferred list): Law §6.6.3's "every Imperial player
 * rules every site with any purple warbands on it" and §5.5.1's carve-out
 * ("if you are a Citizen attacking the Chancellor or another Citizen, you
 * are not an Imperial player during this Campaign; if you are the
 * Chancellor attacking a Citizen, that Citizen is not") — `rule.ts`'s
 * `rulersOf`/`imperialExclusionFor`, threaded through every ruling check in
 * `declare` (bandits-eligibility, the defender-must-rule-your-site clause,
 * and each site target's `ruledByDefender` check). This CORRECTS unit 12's
 * original reading that the "not an Imperial player" sentence was purely
 * an Ally-eligibility status change — it also gates ordinary site-ruling
 * legality, and matters the moment a Citizen exists (unit 16), not only
 * once Allies themselves are built.
 *
 * UNIT 16a PART 1 (2026-09-11) closed the Imperial force itself, which was
 * reachable with ONE Citizen and no Allies whatsoever: §5.5.4's site bonus
 * now sums every Imperial seat's warbands at a targeted site (the seam D42
 * opened — see `defendingForce`), §5.5.7's purple aside now routes site
 * survivors to the Chancellor's board (`survivorBoardOf`), and because
 * those two give site-kills and board-kills different outcomes, §5.5.6's
 * "the Chancellor chooses which warbands are killed" became a real choice
 * and got its own phase (`campaign.casualties`).
 *
 * UNIT 16a PART 2 added the Allies opt-in itself: §5.5.2's mandatory
 * Chancellor join and permissioned Citizen join (`campaign.ally` +
 * `campaign.respond`'s `allies`), §5.5.4's per-Ally board bonus (via
 * `boardContributors`, so Ally warbands also enter part 1's casualty
 * allocation — the case that makes the Chancellor's choice most obviously
 * load-bearing), and §5.5.3's window membership.
 *
 * DEFERRED (documented, not silently dropped):
 *   - A Citizen Ally acting inside the battle-plan window — see
 *     `campaign.respond` above; it needs P3's two windows, not more rules.
 *   - Battle plans (§5.5.3, §5.5.8) — card powers; v1 defers all power
 *     text, including "if you're victorious"/"if you're defeated"/"at
 *     end, discard" battle-plan triggers, §5.5.3's "a specific battle plan
 *     cannot be used by multiple players" bookkeeping, and §5.5.2's
 *     "activate all Campaign modifiers ruled by the defender and all
 *     Allies".
 */

import { z } from 'zod';
import type { ProposedAction } from '../../../engine/types.js';
import { IllegalAction, type GameAction } from '../../../engine/types.js';
import { rollDice } from '../../../engine/random.js';
import { byId } from '../../cards/index.js';
import type { Relic } from '../../cards/schema.js';
import { applyEffects, type Effect } from '../effects.js';
import { chancellorSeatOf, imperialExclusionFor, imperialForce, rulersOf } from '../rule.js';
import {
  DARKEST_SECRET_ID,
  PEOPLES_FAVOR_ID,
  type AttackFace,
  type CampaignState,
  type DefenseFace,
  type ForceEntry,
  type OathState,
} from '../state.js';
import { requireActiveSeat, type Handler } from '../turn.js';

const CAMPAIGN_COST = 2; // Supply (Law §5.5.1)
const PAWN_FAVOR_DICE = 2; // Law §5.5.2 (fixed, "as shown by the shield on their board")
const SITE_DEFENSE_DICE = 1; // Law §2.8.3 ("a defense die" — every site prints exactly one)
const SEIZE_BANNER_BURN = 2; // Law §2.5.3
const SEIZE_BANNER_MINIMUM = 1; // Law §2.5.3 ("to a minimum of one")

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
  if (defender !== 'bandits' && (defender < 0 || defender >= state.seats)) {
    throw new IllegalAction('campaign.declare: no such seat');
  }
  if (attackDice > attacker.warbands.board) {
    throw new IllegalAction(
      `campaign.declare: attackDice (${attackDice}) exceeds your board warbands (Law §5.5.2)`,
    );
  }

  // Law §5.5.1's carve-out (see rule.ts's header): computed once, threaded
  // through every rulersOf() call below.
  const excludeImperial = imperialExclusionFor(state, attackerSeat, defender);
  const rulers = rulersOf(state, attackerSite, excludeImperial);
  if (defender === 'bandits') {
    if (rulers.length > 0) {
      throw new IllegalAction(
        'campaign.declare: bandits can only defend if no player rules your site (Law §5.5.1)',
      );
    }
  } else {
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
            ? rulersOf(state, t.siteId, excludeImperial).length === 0
            : rulersOf(state, t.siteId, excludeImperial).includes(defender));
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
    allies: mandatoryAllies(state, attackerSeat, defender), // Law §5.5.2
    allyVolunteers: [],
    declaredAt: state.actionCount,
  };
  return state;
}

/** Law §5.5.2's Citizen half: offering to join. The defender still has to accept. */
function ally(state: OathState, action: GameAction): OathState {
  if (state.complete) throw new IllegalAction('campaign.ally: the game is already complete');
  const c = state.campaign;
  if (!c || c.phase !== 'respond') {
    throw new IllegalAction('campaign.ally: no campaign is open to Allies');
  }
  if (action.actor === null) throw new IllegalAction('campaign.ally requires a seated actor');
  if (c.allyVolunteers.includes(action.actor)) {
    throw new IllegalAction('campaign.ally: you have already offered to join');
  }
  if (!mayVolunteerAsAlly(state, c, action.actor)) {
    throw new IllegalAction(
      `campaign.ally: seat ${action.actor} cannot join this Campaign as an Ally (Law §5.5.2)`,
    );
  }
  c.allyVolunteers.push(action.actor);
  return state;
}

const RespondPayloadSchema = z.object({
  /** Law §5.5.2's "with the defender's permission" — a subset of the volunteers. */
  allies: z.array(z.number().int().min(0)).default([]),
});

function respond(state: OathState, action: GameAction): OathState {
  if (state.complete) throw new IllegalAction('campaign.respond: the game is already complete');
  const c = state.campaign;
  if (!c || c.phase !== 'respond') {
    throw new IllegalAction('campaign.respond: no campaign is awaiting a response');
  }
  if (action.actor !== c.defenderSeat) {
    throw new IllegalAction("campaign.respond: only the campaign's defender may respond");
  }
  const parsed = RespondPayloadSchema.safeParse(action.payload ?? {});
  if (!parsed.success) throw new IllegalAction('campaign.respond: malformed payload');
  for (const seat of parsed.data.allies) {
    if (!c.allyVolunteers.includes(seat)) {
      throw new IllegalAction(
        `campaign.respond: seat ${seat} did not offer to join as an Ally (Law §5.5.2)`,
      );
    }
    if (!c.allies.includes(seat)) c.allies.push(seat);
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

// ---- resolution (unit 13) -------------------------------------------------

/** Law §5.5.5: a sword counts 1; two hollowSwords count as 1 (a lone one, 0). */
function attackTotal(faces: AttackFace[]): { swords: number; skulls: number } {
  const swords = faces.filter((f) => f === 'sword').length;
  const hollow = faces.filter((f) => f === 'hollowSword').length;
  const skulls = faces.filter((f) => f === 'skull').length;
  return { swords: swords + Math.floor(hollow / 2), skulls };
}

/**
 * Law §5.5.4: do `seat`'s BOARD warbands count toward the defense? Only if
 * their pawn is at the attacker's site or at any targeted site. Read from
 * the ORIGINAL (pre-battle) state — nothing about pawn location changes
 * between roll and resolve. Generalized over `seat` in unit 16a: §5.5.4's
 * Ally aside applies the identical pawn test to each Ally, so this is one
 * function rather than two near-copies.
 */
function boardBonusApplies(state: OathState, c: CampaignState, seat: number): boolean {
  const pawnSite = state.players[seat].pawnSite;
  if (pawnSite === state.players[c.attackerSeat].pawnSite) return true;
  return c.targets.some((t) => t.kind === 'site' && t.siteId === pawnSite);
}

/**
 * Whose BOARD warbands are in the defending force: the defender and each
 * permitted Ally, every one of them subject to §5.5.4's own pawn test.
 *
 * §5.5.4's Ally aside is about board warbands ONLY — which is why
 * `defendingForce`'s SITE warbands below deliberately do not consult this
 * list. A site's purple pieces defend it whoever joined.
 */
function boardContributors(state: OathState, c: CampaignState): number[] {
  if (c.defenderSeat === 'bandits') return [];
  return [c.defenderSeat, ...c.allies].filter((seat) => boardBonusApplies(state, c, seat));
}

/**
 * Law §5.5.2: "If an Imperial player is defending, the Chancellor joins as
 * an Ally." Mandatory and unconditional — no action, no permission, and
 * notably no pawn requirement: the pawn condition in §5.5.2 attaches to the
 * Citizen clause only. §5.5.4's board bonus then applies its own pawn test
 * separately, so a mandatorily-joined Chancellor may well be an Ally who
 * contributes nothing (they still matter for §5.5.3's battle-plan window).
 *
 * Returns [] when the Chancellor IS the defender (you are not your own
 * Ally) or the attacker, and when §5.5.1 has left no Imperial defender at
 * all — a Chancellor attacking a Citizen suspends that Citizen, so that
 * Campaign has no Imperial defender and therefore no Allies.
 */
function mandatoryAllies(state: OathState, attackerSeat: number, defenderSeat: number | 'bandits'): number[] {
  if (defenderSeat === 'bandits') return [];
  const exclusion = imperialExclusionFor(state, attackerSeat, defenderSeat);
  if (!imperialForce(state, exclusion).includes(defenderSeat)) return [];
  const chancellor = chancellorSeatOf(state);
  return chancellor === defenderSeat || chancellor === attackerSeat ? [] : [chancellor];
}

/**
 * Law §5.5.2: "any Citizen except the attacker, with the defender's
 * permission, may choose to join as an Ally if their pawn is at a targeted
 * site or the site of the attacker's pawn." This is the CITIZEN's half —
 * eligibility to offer; `campaign.respond` supplies the defender's half.
 */
function mayVolunteerAsAlly(state: OathState, c: CampaignState, seat: number): boolean {
  if (state.players[seat].citizenship !== 'citizen') return false;
  if (seat === c.attackerSeat || seat === c.defenderSeat) return false;
  const exclusion = imperialExclusionFor(state, c.attackerSeat, c.defenderSeat);
  if (!imperialForce(state, exclusion).includes(seat)) return false;
  if (!imperialForce(state, exclusion).includes(c.defenderSeat as number)) return false;
  return boardBonusApplies(state, c, seat); // the same pawn test, stated once
}

/** Citizens who could still offer to join this campaign (drives `pending()`). */
export function eligibleAllyVolunteers(state: OathState, c: CampaignState): number[] {
  if (c.phase !== 'respond') return [];
  return state.players
    .map((_, seat) => seat)
    .filter((seat) => !c.allyVolunteers.includes(seat) && mayVolunteerAsAlly(state, c, seat));
}

/**
 * The defending force (Glossary §10.9 "Force"; Law §5.5.4's list of what
 * "added to their defense"), as a list of (where, whose, how many).
 *
 * The load-bearing reading, the same one `rule.ts`'s header makes for
 * ruling: warbands at a site are physically just pieces, and for Imperial
 * seats they are all purple, so our per-seat `site.warbands[seat]`
 * attribution is bookkeeping, never an ownership mark. §5.5.4's "warbands
 * at targeted sites" therefore means EVERY Imperial seat's credited
 * warbands there when an Imperial player defends — independent of who
 * joined as an Ally, since the Ally aside governs BOARD warbands only.
 *
 * This is the seam D42 opened and unit 16a closes: making every Imperial
 * seat rule a purple site (correct) let a Citizen with nothing of their own
 * anywhere be declared defender of a Chancellor-garrisoned site, and then
 * defend it with zero site warbands counted.
 *
 * The attacker is never in this list: whenever the defender is Imperial,
 * §5.5.1 has either suspended the attacker (Citizen-vs-Empire) or the
 * attacker is an Exile. The `filter` states that rather than relying on it.
 */
function defendingForce(state: OathState, c: CampaignState): ForceEntry[] {
  if (c.defenderSeat === 'bandits') return []; // Glossary §10.3: bandits are not warbands
  const exclusion = imperialExclusionFor(state, c.attackerSeat, c.defenderSeat);
  const imperial = imperialForce(state, exclusion);
  const defenderIsImperial = imperial.includes(c.defenderSeat);
  const siteSeats = defenderIsImperial
    ? imperial.filter((seat) => seat !== c.attackerSeat)
    : [c.defenderSeat];

  const entries: ForceEntry[] = [];
  for (const t of c.targets) {
    if (t.kind !== 'site') continue;
    const site = state.sites.find((s) => s.id === t.siteId)!;
    for (const seat of siteSeats) {
      const count = site.warbands[seat];
      if (count > 0) entries.push({ kind: 'site', siteId: t.siteId, seat, count });
    }
  }
  for (const seat of boardContributors(state, c)) {
    const count = state.players[seat].warbands.board;
    if (count > 0) entries.push({ kind: 'board', seat, count });
  }
  return entries;
}

/** The attacker's force is just their board (Glossary §10.9). */
function attackingForce(state: OathState, c: CampaignState): ForceEntry[] {
  const count = state.players[c.attackerSeat].warbands.board;
  return count > 0 ? [{ kind: 'board', seat: c.attackerSeat, count }] : [];
}

function forceTotal(force: ForceEntry[]): number {
  return force.reduce((sum, e) => sum + e.count, 0);
}

/** Law §5.5.4's full defense-total arithmetic, from the persisted faces + the force. */
function defenseTotal(state: OathState, c: CampaignState, force: ForceEntry[]): number {
  const shields = c.defenseFaces!.filter((f) => f === 'shield').length;
  const doubleShields = c.defenseFaces!.filter((f) => f === 'doubleShield').length;
  const doublings = c.defenseFaces!.filter((f) => f === 'shieldX2').length;
  const shieldTotal = (shields * 1 + doubleShields * 2) * 2 ** doublings;

  // Bandits add one per targeted site instead of a warband count — Glossary
  // §10.3 ("Bandits are not warbands!"), so they never form a force at all.
  const forceBonus =
    c.defenderSeat === 'bandits'
      ? c.targets.filter((t) => t.kind === 'site').length
      : forceTotal(force);

  return shieldTotal + forceBonus;
}

/** Glossary "Kill": to the personal bank of the matching colour (purple -> the Chancellor). */
function killBankOf(state: OathState, seat: number): number {
  return state.players[seat].citizenship === 'citizen' ? chancellorSeatOf(state) : seat;
}

/** Glossary "Kill", for the attacker's own skulls and sacrifices (Law §5.5.5). */
function killFromBoard(state: OathState, seat: number, count: number): OathState {
  if (count <= 0) return applyEffects(state, seat, []);
  return applyEffects(state, seat, [
    {
      kind: 'warbands',
      from: { kind: 'seatWarbandBoard', seat },
      to: { kind: 'seatWarbandBank', seat: killBankOf(state, seat) },
      amount: count,
    },
  ]);
}

/**
 * Where a SURVIVING warband from this force entry ends up — Law §5.5.6's
 * "they move all the other warbands in their force to their board", as
 * modified by §5.5.7's purple aside: "Imperial warbands at sites move to
 * the Chancellor's board. Any warbands still on Citizens' boards stay
 * there." (The aside is PRINTED under §5.5.7 step 1, but what it modifies
 * is §5.5.6's consolidation — "their board" is ambiguous the moment a force
 * spans several Imperial seats, and this is the Law resolving it.)
 *
 * Note which question this asks: the physical COLOUR of the piece, not
 * whether its owner is an Imperial player *in this Campaign*. Unlike
 * §5.5.2/.3/.4/.6's asides, §5.5.7's carries no "If an Imperial player is
 * defending" prefix, and §6.6.3 defines "Imperial warbands" as purple ones
 * — so a Citizen suspended by §5.5.1's carve-out still has purple pieces,
 * and their site survivors still consolidate onto the Chancellor's board.
 * Glossary "Kill" already keys the destination of a KILLED warband off the
 * same physical colour, so the two rules agree.
 */
function survivorBoardOf(state: OathState, entry: ForceEntry): number {
  if (entry.kind === 'board') return entry.seat; // already on a board — it stays there
  return state.players[entry.seat].citizenship === 'exile' ? entry.seat : chancellorSeatOf(state);
}

/**
 * Does it matter WHICH warbands of this force die (Law §5.5.6's aside)?
 * Only if survivors would land in more than one place — otherwise every
 * allocation produces the same final position and there is nothing to ask.
 * That is unit 13's original shortcut, stated as a condition instead of
 * assumed: a single-colour, single-owner force consolidates onto one board
 * either way.
 */
function allocationMatters(state: OathState, force: ForceEntry[], quota: number): boolean {
  if (quota <= 0) return false;
  return new Set(force.map((e) => survivorBoardOf(state, e))).size > 1;
}

/**
 * Law §5.5.6's default allocation, used only where `allocationMatters` is
 * false: drain sites first, then boards. Safe precisely because every
 * survivor lands in the same place in that case.
 */
function autoAllocate(force: ForceEntry[], quota: number): number[] {
  const kills = force.map(() => 0);
  let remaining = quota;
  const indices = force
    .map((_, i) => i)
    .sort((a, b) => Number(force[a].kind === 'board') - Number(force[b].kind === 'board'));
  for (const i of indices) {
    const take = Math.min(remaining, force[i].count);
    kills[i] = take;
    remaining -= take;
  }
  return kills;
}

/**
 * Law §5.5.6: `kills[i]` of `force[i]` die (to the matching bank); every
 * other warband in the force moves to its survivor board. Warbands already
 * on a board that survive do not move at all.
 */
function applyDefeat(
  state: OathState,
  actor: number,
  force: ForceEntry[],
  kills: number[],
): OathState {
  const effects: Effect[] = [];
  force.forEach((entry, i) => {
    const from =
      entry.kind === 'site'
        ? ({ kind: 'siteWarbands', siteId: entry.siteId, seat: entry.seat } as const)
        : ({ kind: 'seatWarbandBoard', seat: entry.seat } as const);
    if (kills[i] > 0) {
      effects.push({
        kind: 'warbands',
        from,
        to: { kind: 'seatWarbandBank', seat: killBankOf(state, entry.seat) },
        amount: kills[i],
      });
    }
    const survivors = entry.count - kills[i];
    if (survivors > 0 && entry.kind === 'site') {
      effects.push({
        kind: 'warbands',
        from,
        to: { kind: 'seatWarbandBoard', seat: survivorBoardOf(state, entry) },
        amount: survivors,
      });
    }
  });
  return applyEffects(state, actor, effects);
}

/**
 * Law §5.5.6's aside: "If an Imperial player is defending, the Chancellor
 * chooses which warbands in the defending force are killed." Otherwise the
 * base text's "the defeated player kills half" leaves the choice with the
 * defeated player themselves — which is reachable, since a Citizen
 * suspended by §5.5.1 is not an Imperial player but still has purple
 * warbands whose site survivors go elsewhere than their board
 * (`survivorBoardOf`), so their allocation can matter too.
 */
export function casualtyChooser(state: OathState, c: CampaignState): number {
  const defenderSeat = c.defenderSeat as number; // a casualties phase is never reached vs bandits
  const exclusion = imperialExclusionFor(state, c.attackerSeat, c.defenderSeat);
  return imperialForce(state, exclusion).includes(defenderSeat)
    ? chancellorSeatOf(state)
    : defenderSeat;
}

/**
 * Law §5.5.7's MANDATORY spoils — no choice involved, so they are applied
 * by whichever action finishes the resolution rather than being offered.
 * Always runs AFTER §5.5.6's defeat, in both the auto-allocated and the
 * `casualties`-phase paths, so the Law's step order holds either way.
 */
function applyVictorySpoils(state: OathState, c: CampaignState): OathState {
  let working = state;

  // ...take every targeted relic...
  const relicEffects: Effect[] = c.targets
    .filter((t): t is Extract<CampaignState['targets'][number], { kind: 'relic' }> => t.kind === 'relic')
    .map((t) => ({
      kind: 'card' as const,
      id: t.relicId,
      from: { kind: 'seatRelics' as const, seat: c.defenderSeat as number },
      to: { kind: 'seatRelics' as const, seat: c.attackerSeat },
    }));
  if (relicEffects.length > 0) working = applyEffects(working, c.attackerSeat, relicEffects);

  // ...and banner (Law §2.5.3's Seize Penalty: burn 2, minimum 1 left; flip
  // the People's Favor to Mob). Holder/tokens/mob are mutated directly, same
  // as Recover (unit 11) — not currency moves the effect vocabulary owns.
  for (const t of c.targets) {
    if (t.kind !== 'banner') continue;
    const isFavor = t.bannerId === PEOPLES_FAVOR_ID;
    const before = working.banners.find((b) => b.id === t.bannerId)!;
    const after = Math.max(SEIZE_BANNER_MINIMUM, before.tokens - SEIZE_BANNER_BURN);
    const burned = before.tokens - after;
    if (burned > 0) {
      working = applyEffects(working, c.attackerSeat, [
        isFavor
          ? { kind: 'favor', from: { kind: 'bannerFavor' }, to: { kind: 'sharedFavor' }, amount: burned }
          : { kind: 'secret', from: { kind: 'bannerSecrets' }, to: { kind: 'sharedSecrets' }, amount: burned },
      ]);
    }
    const banner = working.banners.find((b) => b.id === t.bannerId)!;
    banner.tokens = after;
    banner.holder = c.attackerSeat;
    if (isFavor) banner.mob = true;
  }

  return working;
}

const ResolvePayloadSchema = z.object({ sacrifice: z.number().int().min(0).default(0) });

function resolve(state: OathState, action: GameAction): OathState {
  const seat = requireActiveSeat(state, action, { campaignOk: true });
  const c = state.campaign;
  if (!c || c.phase !== 'rolled') {
    throw new IllegalAction('campaign.resolve: no campaign is awaiting resolution');
  }
  if (seat !== c.attackerSeat) {
    throw new IllegalAction("campaign.resolve: only the campaign's attacker may resolve");
  }
  const parsed = ResolvePayloadSchema.safeParse(action.payload);
  if (!parsed.success) throw new IllegalAction('campaign.resolve: malformed payload');

  const { swords, skulls } = attackTotal(c.attackFaces!);
  // Both computed from the ORIGINAL (pre-battle) state: the defending force
  // is untouched by anything below, which only moves the ATTACKER's board.
  const force = defendingForce(state, c);
  const defense = defenseTotal(state, c, force);

  // §5.5.5: skulls kill the attacker's OWN board warbands immediately, win or lose.
  let working = killFromBoard(state, c.attackerSeat, Math.min(skulls, state.players[c.attackerSeat].warbands.board));

  const { sacrifice } = parsed.data;
  const needed = Math.max(0, defense - swords + 1);
  if (sacrifice !== 0) {
    if (sacrifice !== needed) {
      throw new IllegalAction(
        `campaign.resolve: sacrifice must be exactly ${needed} to become victorious, or 0 (Law §5.5.5, §9.5)`,
      );
    }
    if (sacrifice > working.players[c.attackerSeat].warbands.board) {
      throw new IllegalAction('campaign.resolve: not enough board warbands left to sacrifice that many');
    }
    working = killFromBoard(working, c.attackerSeat, sacrifice); // Glossary "Sacrifice": choosing to kill your own
  }

  const victorious = swords + sacrifice > defense;

  if (!victorious) {
    // §5.5.6: the attacker is the defeated party, and their force is just
    // their board — one destination, so the allocation can never matter.
    const own = attackingForce(working, c);
    working = applyDefeat(working, c.attackerSeat, own, autoAllocate(own, Math.floor(forceTotal(own) / 2)));
    working.campaign = null;
    return working;
  }

  const quota = Math.floor(forceTotal(force) / 2);
  if (allocationMatters(state, force, quota)) {
    // §5.5.6's aside: hand the choice over before doing anything else, so
    // the Law's step order (defeat, then §5.5.7's spoils) still holds.
    working.campaign!.phase = 'casualties';
    working.campaign!.casualties = { force, quota };
    return working;
  }

  working = applyDefeat(working, c.attackerSeat, force, autoAllocate(force, quota));
  working = applyVictorySpoils(working, c);
  working.campaign!.phase = 'seize';
  return working;
}

const CasualtiesPayloadSchema = z.object({
  kills: z
    .array(
      z.discriminatedUnion('kind', [
        z.object({
          kind: z.literal('site'),
          siteId: z.string(),
          seat: z.number().int().min(0),
          count: z.number().int().positive(),
        }),
        z.object({
          kind: z.literal('board'),
          seat: z.number().int().min(0),
          count: z.number().int().positive(),
        }),
      ]),
    )
    .default([]),
});

function casualties(state: OathState, action: GameAction): OathState {
  if (state.complete) throw new IllegalAction('campaign.casualties: the game is already complete');
  const c = state.campaign;
  if (!c || c.phase !== 'casualties' || !c.casualties) {
    throw new IllegalAction('campaign.casualties: no campaign is awaiting a casualty allocation');
  }
  const chooser = casualtyChooser(state, c);
  if (action.actor !== chooser) {
    throw new IllegalAction(
      `campaign.casualties: only seat ${chooser} allocates this force's casualties (Law §5.5.6)`,
    );
  }
  const parsed = CasualtiesPayloadSchema.safeParse(action.payload);
  if (!parsed.success) throw new IllegalAction('campaign.casualties: malformed payload');

  const { force, quota } = c.casualties;
  const kills = force.map(() => 0);
  for (const k of parsed.data.kills) {
    const i = force.findIndex(
      (e) => e.kind === k.kind && e.seat === k.seat && (e.kind !== 'site' || e.siteId === (k as { siteId: string }).siteId),
    );
    if (i === -1) {
      throw new IllegalAction('campaign.casualties: that location is not part of the defeated force');
    }
    if (kills[i] !== 0) {
      throw new IllegalAction('campaign.casualties: duplicate allocation for one location');
    }
    if (k.count > force[i].count) {
      throw new IllegalAction(
        `campaign.casualties: cannot kill ${k.count} where the force has only ${force[i].count}`,
      );
    }
    kills[i] = k.count;
  }
  const allocated = kills.reduce((sum, n) => sum + n, 0);
  if (allocated !== quota) {
    throw new IllegalAction(
      `campaign.casualties: must allocate exactly ${quota} kills, got ${allocated} (Law §5.5.6, §9.5)`,
    );
  }

  let working = applyDefeat(state, chooser, force, kills);
  working = applyVictorySpoils(working, c);
  working.campaign!.phase = 'seize';
  delete working.campaign!.casualties;
  return working;
}

const SeizePayloadSchema = z.object({
  placements: z.array(z.object({ siteId: z.string(), warbands: z.number().int().min(0) })).default([]),
  banishTo: z.string().optional(),
  burnFavor: z.boolean().default(false),
});

function seize(state: OathState, action: GameAction): OathState {
  const seat = requireActiveSeat(state, action, { campaignOk: true });
  const c = state.campaign;
  if (!c || c.phase !== 'seize') {
    throw new IllegalAction('campaign.seize: no campaign is awaiting seizure');
  }
  if (seat !== c.attackerSeat) {
    throw new IllegalAction("campaign.seize: only the campaign's attacker may seize");
  }
  const parsed = SeizePayloadSchema.safeParse(action.payload);
  if (!parsed.success) throw new IllegalAction('campaign.seize: malformed payload');
  const { placements, banishTo, burnFavor } = parsed.data;

  const siteTargetIds = new Set(c.targets.filter((t) => t.kind === 'site').map((t) => t.siteId));
  const seenSites = new Set<string>();
  let totalPlaced = 0;
  const effects: Effect[] = [];
  for (const p of placements) {
    if (!siteTargetIds.has(p.siteId)) {
      throw new IllegalAction(`campaign.seize: ${p.siteId} was not targeted (Law §5.5.7)`);
    }
    if (seenSites.has(p.siteId)) throw new IllegalAction(`campaign.seize: duplicate placement for ${p.siteId}`);
    seenSites.add(p.siteId);
    totalPlaced += p.warbands;
    if (p.warbands > 0) {
      effects.push({
        kind: 'warbands',
        from: { kind: 'seatWarbandBoard', seat },
        to: { kind: 'siteWarbands', siteId: p.siteId, seat },
        amount: p.warbands,
      });
    }
  }
  if (totalPlaced > state.players[seat].warbands.board) {
    throw new IllegalAction('campaign.seize: not enough board warbands to place');
  }

  const pawnFavorTargeted = c.targets.some((t) => t.kind === 'pawnFavor');
  if ((banishTo !== undefined || burnFavor) && !pawnFavorTargeted) {
    throw new IllegalAction(
      'campaign.seize: banishing the pawn or burning favor requires a pawnFavor target (Law §5.5.7)',
    );
  }
  if (banishTo !== undefined && !state.sites.find((s) => s.id === banishTo)) {
    throw new IllegalAction(`campaign.seize: ${banishTo} is not a real site`);
  }

  let working = applyEffects(state, seat, effects);
  const defenderSeat = c.defenderSeat as number; // pawnFavorTargeted => a real seat (never bandits)

  if (burnFavor) {
    const amount = Math.floor(working.players[defenderSeat].favor / 2);
    if (amount > 0) {
      working = applyEffects(working, seat, [
        { kind: 'favor', from: { kind: 'seatFavor', seat: defenderSeat }, to: { kind: 'sharedFavor' }, amount },
      ]);
    }
  }
  if (banishTo !== undefined) {
    working.players[defenderSeat].pawnSite = banishTo;
  }

  working.campaign = null;
  return working;
}

export const CAMPAIGN_HANDLERS: Record<string, Handler> = {
  'campaign.declare': declare,
  'campaign.ally': ally,
  'campaign.respond': respond,
  'campaign.roll': roll,
  'campaign.resolve': resolve,
  'campaign.casualties': casualties,
  'campaign.seize': seize,
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
