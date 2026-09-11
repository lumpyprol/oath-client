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
 *     they just go into hiding"): half (rounded down) of "the warbands
 *     that added to their defense" die, the rest consolidate onto their
 *     board — for the attacker that "force" is simply their board; for
 *     the defender it's their warbands at every targeted site plus,
 *     conditionally, their board (the SAME condition as the defense-total
 *     bonus above, evaluated from the pre-battle state). On a loss, the
 *     campaign clears here — nothing left to choose. On a win, §5.5.7's
 *     MANDATORY parts happen here too (no choice involved): every
 *     targeted relic and banner is taken — a seized banner burns 2 favor/
 *     secrets (minimum 1 left) and, if it's the People's Favor, flips to
 *     Mob (§2.5.3) — then phase advances to `'seize'` for the CHOICE-
 *     bearing rest.
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
 * DEFERRED (documented, not silently dropped):
 *   - Imperial Allies PROPER: §5.5.1's Chancellor-joins/Citizen-may-join,
 *     and their warband bonuses to the defense TOTAL (§5.5.4) and the
 *     casualty consolidation across multiple Imperial seats' forces
 *     (§5.5.6-7). Ruling a targeted site is now correct for multi-Imperial
 *     games (above); the DICE ARITHMETIC still only reads the single
 *     recorded defender seat's own site/board counts — combining several
 *     Imperial seats' warbands into one "force" (Glossary "Force") needs
 *     the Allies opt-in mechanic itself (who joins, the Chancellor's
 *     mandatory join, permission for other Citizens) to do correctly, not
 *     just a ruling fix.
 *   - Battle plans (§5.5.3, §5.5.8) — card powers; v1 defers all power
 *     text, including "if you're victorious"/"if you're defeated"/"at
 *     end, discard" battle-plan triggers.
 *   - "Imperial warbands at sites move to the Chancellor's board" (§5.5.7)
 *     — an Ally/Imperial-team consolidation rule, same Allies deferral as
 *     above.
 */

import { z } from 'zod';
import type { ProposedAction } from '../../../engine/types.js';
import { IllegalAction, type GameAction } from '../../../engine/types.js';
import { rollDice } from '../../../engine/random.js';
import { byId } from '../../cards/index.js';
import type { Relic } from '../../cards/schema.js';
import { applyEffects, type Effect } from '../effects.js';
import { imperialExclusionFor, rulersOf } from '../rule.js';
import {
  DARKEST_SECRET_ID,
  PEOPLES_FAVOR_ID,
  type AttackFace,
  type CampaignState,
  type DefenseFace,
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

// ---- resolution (unit 13) -------------------------------------------------

function chancellorSeatOf(state: OathState): number {
  return state.players.findIndex((p) => p.citizenship === 'chancellor');
}

/** Law §5.5.5: a sword counts 1; two hollowSwords count as 1 (a lone one, 0). */
function attackTotal(faces: AttackFace[]): { swords: number; skulls: number } {
  const swords = faces.filter((f) => f === 'sword').length;
  const hollow = faces.filter((f) => f === 'hollowSword').length;
  const skulls = faces.filter((f) => f === 'skull').length;
  return { swords: swords + Math.floor(hollow / 2), skulls };
}

/**
 * Law §5.5.4: does the defender's OWN board warbands count toward
 * defense? Only if their pawn is at the attacker's site or at any
 * targeted site. Read from the ORIGINAL (pre-battle) state — nothing
 * about pawn location changes between roll and resolve.
 */
function defenderBoardBonusApplies(state: OathState, c: CampaignState): boolean {
  if (c.defenderSeat === 'bandits') return false;
  const defenderPawnSite = state.players[c.defenderSeat].pawnSite;
  const attackerSite = state.players[c.attackerSeat].pawnSite;
  if (defenderPawnSite === attackerSite) return true;
  return c.targets.some((t) => t.kind === 'site' && t.siteId === defenderPawnSite);
}

/** Law §5.5.4's full defense-total arithmetic, from the persisted faces + current state. */
function defenseTotal(state: OathState, c: CampaignState): number {
  const shields = c.defenseFaces!.filter((f) => f === 'shield').length;
  const doubleShields = c.defenseFaces!.filter((f) => f === 'doubleShield').length;
  const doublings = c.defenseFaces!.filter((f) => f === 'shieldX2').length;
  const shieldTotal = (shields * 1 + doubleShields * 2) * 2 ** doublings;

  const siteTargets = c.targets.filter((t) => t.kind === 'site');
  const siteBonus =
    c.defenderSeat === 'bandits'
      ? siteTargets.length // "bandits add one per site" — not warband-counted
      : siteTargets.reduce(
          (sum, t) => sum + state.sites.find((s) => s.id === t.siteId)!.warbands[c.defenderSeat as number],
          0,
        );

  const boardBonus =
    c.defenderSeat !== 'bandits' && defenderBoardBonusApplies(state, c)
      ? state.players[c.defenderSeat].warbands.board
      : 0;

  return shieldTotal + siteBonus + boardBonus;
}

/** Glossary "Kill": to the personal bank of the matching color (purple -> the Chancellor). */
function killFromBoard(state: OathState, seat: number, count: number): OathState {
  if (count <= 0) return applyEffects(state, seat, []);
  const bankSeat = state.players[seat].citizenship === 'citizen' ? chancellorSeatOf(state) : seat;
  return applyEffects(state, seat, [
    { kind: 'warbands', from: { kind: 'seatWarbandBoard', seat }, to: { kind: 'seatWarbandBank', seat: bankSeat }, amount: count },
  ]);
}

/**
 * Law §5.5.6, generalized over both sides via `siteIds`/`includeBoard`:
 * the attacker's force is just their board (`siteIds: []`, `includeBoard:
 * true`); the defender's is their warbands at every targeted site plus,
 * conditionally, their board (the same condition as the defense bonus).
 * Half (rounded down) of the total dies; the rest consolidates onto the
 * seat's board — kill quota is drained from sites first, then the board,
 * which is equivalent to the rulebook's "kill half of the WHOLE force"
 * (warbands of one color are fungible; only the final counts matter).
 */
function resolveDefeatForSeat(
  state: OathState,
  seat: number,
  siteIds: string[],
  includeBoard: boolean,
): OathState {
  const siteCounts = siteIds.map((siteId) => ({
    siteId,
    count: state.sites.find((s) => s.id === siteId)!.warbands[seat],
  }));
  const siteTotal = siteCounts.reduce((sum, s) => sum + s.count, 0);
  const boardCount = state.players[seat].warbands.board;
  const total = siteTotal + (includeBoard ? boardCount : 0);
  let killRemaining = Math.floor(total / 2);

  const bankSeat = state.players[seat].citizenship === 'citizen' ? chancellorSeatOf(state) : seat;
  const effects: Effect[] = [];
  for (const { siteId, count } of siteCounts) {
    if (count === 0) continue;
    const killHere = Math.min(killRemaining, count);
    killRemaining -= killHere;
    if (killHere > 0) {
      effects.push({
        kind: 'warbands',
        from: { kind: 'siteWarbands', siteId, seat },
        to: { kind: 'seatWarbandBank', seat: bankSeat },
        amount: killHere,
      });
    }
    const moveHere = count - killHere;
    if (moveHere > 0) {
      effects.push({
        kind: 'warbands',
        from: { kind: 'siteWarbands', siteId, seat },
        to: { kind: 'seatWarbandBoard', seat },
        amount: moveHere,
      });
    }
  }
  if (includeBoard && killRemaining > 0) {
    effects.push({
      kind: 'warbands',
      from: { kind: 'seatWarbandBoard', seat },
      to: { kind: 'seatWarbandBank', seat: bankSeat },
      amount: killRemaining,
    });
  }
  return applyEffects(state, seat, effects);
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
  const defense = defenseTotal(state, c);

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
    // §5.5.6: the attacker is the defeated party; their force is their board.
    working = resolveDefeatForSeat(working, c.attackerSeat, [], true);
    working.campaign = null;
    return working;
  }

  if (c.defenderSeat !== 'bandits') {
    // §5.5.6, computed from the ORIGINAL state (site/board counts haven't
    // changed since declare — only the attacker's board has, above).
    const siteIds = c.targets.filter((t) => t.kind === 'site').map((t) => t.siteId);
    working = resolveDefeatForSeat(working, c.defenderSeat, siteIds, defenderBoardBonusApplies(state, c));
  }

  // §5.5.7, mandatory parts only (no choice): take every targeted relic...
  const relicEffects: Effect[] = c.targets
    .filter((t): t is Extract<typeof t, { kind: 'relic' }> => t.kind === 'relic')
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

  working.campaign!.phase = 'seize';
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
  'campaign.respond': respond,
  'campaign.roll': roll,
  'campaign.resolve': resolve,
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
