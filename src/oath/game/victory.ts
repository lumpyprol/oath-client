/**
 * Victory, the Wake Phase, and game end (unit 17; HLD D35 — the structural
 * endgame is ENFORCED, not declared, because these are the game's skeleton
 * rather than card text, and declaring them would make every ending
 * disputable).
 *
 * This module is a PIPELINE, not an action module in the usual sense: most
 * of it runs after every action (`afterAction`, wired in `index.ts`), so
 * nothing here is triggered by a player naming it. The two exceptions are
 * the decisions the Law explicitly hands to a player — `wake.favor` and
 * `oathkeeper.grant` — which are ordinary handlers.
 *
 * ---- THE WAKE PHASE (Law §4.1), "resolve 4.1.1-4.1.4 in order" ----------
 *
 * Runs at the start of each turn, which in this engine is the moment
 * `turn.rest` advances `activeSeat` (unit 5). It is a LOCK while unresolved
 * — §4.1's steps come before the Act Phase, so `requireActiveSeat`'s
 * `wakeOk` opt keeps every other action out until it is done.
 *
 *   §4.1.1 The People's Favor holder's mandatory maintenance. Either place
 *     one favor on it, or move one favor from it to the favor bank with the
 *     least favor. Forced outcomes resolve themselves; a genuine choice
 *     raises a pending decision for the waking seat. Three clauses, each
 *     load-bearing:
 *       - "If it only has one favor on it, you must place one favor on it
 *         UNLESS YOU HAVE NO FAVOR" — so at one favor the choice collapses
 *         to placing, but a player with nothing to place falls back to the
 *         general rule and must return instead, taking it to zero.
 *       - "On a tie for least favor, choose one of the tied favor banks" —
 *         a return is only self-resolving when exactly one bank is lowest.
 *       - §4.1.1.II repeats the whole step once on the Mob side, and
 *         §4.1.1.III flips it to Mob at six or more AFTER the step(s).
 *     If the banner is empty AND the holder has no favor, neither half is
 *     possible; the step is skipped (Law §9.2's "if able" reading — there
 *     is no legal way to satisfy a "must" that has no legal outcome).
 *
 *   §4.1.2 Check for Win — an EXILE only, and during their OWN Wake Phase,
 *     never at the end of someone's turn. See the Usurper clock below.
 *
 *   §4.1.3 An Exile holding the title flips it to its Usurper side. This is
 *     AFTER §4.1.2, and that order is the entire Usurper clock: the turn an
 *     Exile first takes the title, §4.1.2 sees it still on the Oathkeeper
 *     side and does not win, then §4.1.3 flips it; only on their NEXT Wake
 *     does §4.1.2 see the Usurper side and end the game. Holding it through
 *     a full round is the cost. Getting this order wrong would let an Exile
 *     win a round early.
 *
 *   §4.1.4 the opportunity-site take stays DECLARED (v1 deferred list) —
 *     it is a "may", and expressible today as a siteFavor/siteSecrets mover
 *     through `power.use`.
 *
 * The opening turn gets one too. It has no `turn.rest` before it, so `init`
 * calls `beginWake` directly for seat 0 — which matters exactly when Law
 * §1.13 hands the Chancellor the People's Favor at setup (a Oathkeeper of
 * the People game), since they then owe §4.1.1 on turn one. Only §4.1.1 can
 * do anything there: §4.1.2 and §4.1.3 are Exile-only and seat 0 is always
 * the Chancellor, so no game can be won before it starts.
 *
 * ---- THE OATHKEEPER TITLE (Law §2.11) -----------------------------------
 *
 * "It is always held by the player who meets the Oathkeeper goal", so this
 * is recomputed after every action rather than at a phase boundary. Three
 * rules beyond the goal itself:
 *   - a tie involving the current holder leaves it with them;
 *   - if others meet the goal and the holder does not, THE HOLDER CHOOSES
 *     which of them takes it (a pending decision — `oathkeeper.grant`);
 *   - whenever the title is taken it flips to its Oathkeeper side.
 * If NOBODY meets the goal, the Law says nothing; the holder keeps it,
 * which is the only reading that preserves "always held".
 *
 * The Supremacy goal is the one collective one: §6.6.3 makes every Imperial
 * player rule every purple site, so Imperial seats are structurally tied on
 * it, and §2.11 resolves that by handing the title to the CHANCELLOR "if
 * the Empire meets the goal". The other three goals are individual — a
 * Citizen really can hold the Oathkeeper of Protection.
 *
 * ---- THE FOUR ROADS TO GAME END (Law §3) --------------------------------
 *
 *   §3.1 Usurper Win and §3.2 Visionary Win — an Exile, during their own
 *     Wake. Every Vision goal carries a floor of three Visions drawn, which
 *     is printed on the cards themselves as well as parenthesised in §3.2
 *     (RULINGS.md), so it is encoded once here rather than per Vision.
 *   §3.3 Stable Regime — at the END of rounds five, six and seven, and only
 *     if an Imperial player holds the title, roll the end die; the
 *     Chancellor wins on 6 / 5-6 / 3-6 respectively. The die is randomness,
 *     so it is rolled in `prepare()` of the round-ending `turn.rest` and
 *     persisted in that action's payload (HLD D14); this pipeline only ever
 *     READS it. `prepareRest` deliberately rolls on a WEAKER condition than
 *     the one that consumes it (it ignores who holds the title), so the
 *     roll can never be missing when needed — an unused die in a payload is
 *     harmless, a missing one would be a replay bug.
 *   §3.3.1 Successor — wherever the Chancellor would win, a Citizen meeting
 *     the Successor goal wins instead. The goals are CROSSED against the
 *     game's oath, deliberately: the Successor is measured on a different
 *     axis from the one the Empire is defending.
 *   §3.4 War Exhaustion — the end of round eight ends the game with no die,
 *     resolved down a strict priority order.
 *
 * Citations are "Law §x.y" (Buried Giant rules reference, Oath printing p1;
 * see RULINGS.md).
 */

import { z } from 'zod';
import { IllegalAction, type GameAction } from '../../engine/types.js';
import type { ProposedAction } from '../../engine/types.js';
import { rollDice } from '../../engine/random.js';
import { SUITS, type Suit } from '../cards/schema.js';
import { applyEffects } from './effects.js';
import { chancellorSeatOf, rulersOf } from './rule.js';
import {
  DARKEST_SECRET_ID,
  PEOPLES_FAVOR_ID,
  type BannerState,
  type OathName,
  type OathState,
} from './state.js';
import { requireActiveSeat, type Handler } from './turn.js';

/** Law §4.1.1.III: the People's Favor flips to Mob at this many favor. */
const MOB_THRESHOLD = 6;
/** Law §3.2: "at least three Visions have been drawn from the world deck." */
const VISION_FLOOR = 3;
/** Law §3.3: the minimum end-die roll that ends the game, by the round that just ended. */
const STABLE_REGIME_TARGET: Record<number, number> = { 5: 6, 6: 5, 7: 3 };
const END_DIE: readonly number[] = [1, 2, 3, 4, 5, 6];
/** Law §3.4: the last round; its end always ends the game. */
const FINAL_ROUND = 8;

// ---- goal predicates -----------------------------------------------------

function peoplesFavor(state: OathState): BannerState {
  return state.banners.find((b) => b.id === PEOPLES_FAVOR_ID)!;
}

function holderOf(state: OathState, bannerId: string): number | null {
  return state.banners.find((b) => b.id === bannerId)!.holder;
}

function isExile(state: OathState, seat: number): boolean {
  return state.players[seat].citizenship === 'exile';
}

function ruledSites(state: OathState, seat: number): number {
  return state.sites.filter((s) => rulersOf(state, s.id).includes(seat)).length;
}

/**
 * Law §2.11's Protection goal: "Holds the most relics (2.4) and banners
 * (2.5). (This is the combined total.)" The Grand Scepter counts — it is a
 * relic card (§2.4) that someone always holds, tracked apart from
 * `player.relics` only because it has no card-database entry (unit 16c).
 * Reliquary relics do NOT count: §2.3 says so in as many words.
 */
function relicsAndBanners(state: OathState, seat: number): number {
  return (
    state.players[seat].relics.length +
    (state.grandScepter === seat ? 1 : 0) +
    state.banners.filter((b) => b.holder === seat).length
  );
}

function seatsWithMax(state: OathState, score: (seat: number) => number): number[] {
  const scores = state.players.map((_, seat) => score(seat));
  const max = Math.max(...scores);
  return scores.flatMap((s, seat) => (s === max ? [seat] : []));
}

/**
 * Law §2.11: "The Chancellor holds the Oathkeeper of Supremacy title if the
 * Empire meets the goal." Applied to Supremacy ONLY — it is named there and
 * nowhere else, and it exists because §6.6.3 leaves every Imperial seat
 * ruling exactly the same purple sites, so they can never break that tie
 * among themselves. The other three goals stay individual.
 */
function collapseEmpire(state: OathState, seats: number[]): number[] {
  if (!seats.some((seat) => !isExile(state, seat))) return seats;
  const kept = seats.filter((seat) => isExile(state, seat));
  return [...new Set([chancellorSeatOf(state), ...kept])].sort((a, b) => a - b);
}

/**
 * Which seats currently meet `oath`'s goal (Law §2.11's table). "Meets"
 * INCLUDES being tied for a "most" goal — §2.11's own tie rule ("if the
 * title's holder becomes tied with another player FOR MEETING the goal, the
 * holder keeps the token") only makes sense if both tied players meet it.
 * See RULINGS.md; the same reading decides a tied Visionary Win.
 */
export function seatsMeetingOath(state: OathState, oath: OathName): number[] {
  switch (oath) {
    case 'people': {
      const holder = holderOf(state, PEOPLES_FAVOR_ID);
      return holder === null ? [] : [holder];
    }
    case 'devotion': {
      const holder = holderOf(state, DARKEST_SECRET_ID);
      return holder === null ? [] : [holder];
    }
    case 'protection':
      return seatsWithMax(state, (seat) => relicsAndBanners(state, seat));
    case 'supremacy':
      return collapseEmpire(state, seatsWithMax(state, (seat) => ruledSites(state, seat)));
  }
}

/**
 * Law §3.2's four Vision goals, which mirror §2.11's table. Evaluated for
 * ONE Exile, so the Empire-collective rule never applies. Keyed by card id:
 * `vision:sanctuary` was called "Dynasty" in the 2020 data until the unit 17
 * rename (RULINGS.md), and `vision:conspiracy` has no goal at all (§2.7.2).
 */
const VISION_GOALS: Record<string, OathName> = {
  'vision:conquest': 'supremacy',
  'vision:rebellion': 'people',
  'vision:sanctuary': 'protection',
  'vision:faith': 'devotion',
};

/** Law §3.4.3's tiebreak order when several Exiles have met their Vision goals. */
const VISION_TIEBREAK = ['vision:conquest', 'vision:rebellion', 'vision:sanctuary', 'vision:faith'];

function visionGoalMet(state: OathState, seat: number): boolean {
  const vision = state.players[seat].vision;
  if (vision === null) return false;
  const goal = VISION_GOALS[vision];
  if (goal === undefined) return false; // the Conspiracy: no victory goal
  if (state.visionsDrawn < VISION_FLOOR) return false; // §3.2's floor, encoded once
  // Individual, never collective: `collapseEmpire` would be wrong here, and
  // cannot bite anyway — only Exiles hold Revealed Visions (§5.1.4.3).
  switch (goal) {
    case 'people':
      return holderOf(state, PEOPLES_FAVOR_ID) === seat;
    case 'devotion':
      return holderOf(state, DARKEST_SECRET_ID) === seat;
    case 'protection':
      return seatsWithMax(state, (s) => relicsAndBanners(state, s)).includes(seat);
    case 'supremacy':
      return seatsWithMax(state, (s) => ruledSites(state, s)).includes(seat);
  }
}

/**
 * Law §3.3.1's Successor goals, CROSSED against the game's oath: the
 * Successor is measured on a different axis from the one the Empire holds.
 */
function meetsSuccessorGoal(state: OathState, seat: number): boolean {
  switch (state.oath) {
    case 'supremacy':
      // "Holds more relics and banners in total than the Chancellor and any
      // other Citizen" — strictly more, and only against the Empire.
      return state.players.every(
        (p, other) =>
          other === seat || isExile(state, other) || relicsAndBanners(state, seat) > relicsAndBanners(state, other),
      );
    case 'people':
      return holderOf(state, DARKEST_SECRET_ID) === seat;
    case 'protection':
      return holderOf(state, PEOPLES_FAVOR_ID) === seat;
    case 'devotion':
      return state.grandScepter === seat;
  }
}

/** Law §3.3.1/§3.4.1/§3.4.4: a Citizen meeting the Successor goal wins in the Chancellor's place. */
function successorOrChancellor(state: OathState): number {
  const successor = state.players.findIndex(
    (p, seat) => p.citizenship === 'citizen' && meetsSuccessorGoal(state, seat),
  );
  return successor === -1 ? chancellorSeatOf(state) : successor;
}

// ---- the Oathkeeper title (Law §2.11) ------------------------------------

function takeTitle(state: OathState, seat: number): void {
  state.oathkeeper = seat;
  state.usurper = false; // §2.11: "flips to its Oathkeeper side" whenever taken
}

function sameSeats(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function updateTitle(state: OathState): void {
  const candidates = seatsMeetingOath(state, state.oath);
  // Nobody qualifies, or the holder still does (which covers §2.11's tie
  // rule: a tie leaves both meeting the goal, and the holder keeps it).
  if (candidates.length === 0 || candidates.includes(state.oathkeeper)) {
    state.titleChoice = null;
    return;
  }
  if (candidates.length === 1) {
    takeTitle(state, candidates[0]);
    state.titleChoice = null;
    return;
  }
  // §2.11: "If multiple players meet its goal but the holder does not, the
  // holder chooses one of those other players to take it."
  const standing =
    state.titleChoice &&
    state.titleChoice.holder === state.oathkeeper &&
    sameSeats(state.titleChoice.candidates, candidates);
  state.titleChoice = {
    holder: state.oathkeeper,
    candidates,
    raisedAt: standing ? state.titleChoice!.raisedAt : state.actionCount,
  };
}

const GrantPayloadSchema = z.object({ seat: z.number().int().min(0) });

function grant(state: OathState, action: GameAction): OathState {
  if (state.complete) throw new IllegalAction('oathkeeper.grant: the game is already complete');
  const choice = state.titleChoice;
  if (!choice) throw new IllegalAction('oathkeeper.grant: no Oathkeeper choice is pending');
  if (action.actor !== choice.holder) {
    throw new IllegalAction(
      `oathkeeper.grant: only seat ${choice.holder} chooses who takes the title (Law §2.11)`,
    );
  }
  const parsed = GrantPayloadSchema.safeParse(action.payload);
  if (!parsed.success) throw new IllegalAction('oathkeeper.grant: malformed payload');
  if (!choice.candidates.includes(parsed.data.seat)) {
    throw new IllegalAction(
      `oathkeeper.grant: seat ${parsed.data.seat} does not meet the Oathkeeper goal (Law §2.11)`,
    );
  }
  const working = applyEffects(state, action.actor, []);
  takeTitle(working, parsed.data.seat);
  working.titleChoice = null;
  return working;
}

// ---- the Wake Phase (Law §4.1) -------------------------------------------

/** The suits whose favor bank is currently lowest (Law §4.1.1.I). */
function leastFavorBanks(state: OathState): Suit[] {
  const min = Math.min(...SUITS.map((suit) => state.favorBanks[suit]));
  return SUITS.filter((suit) => state.favorBanks[suit] === min);
}

type WakeStep = { choice: 'place' } | { choice: 'return'; bank: Suit };

/** Law §4.1.1.I's legality, in one place: what this seat may or must do now. */
function wakeOptions(state: OathState, seat: number) {
  const banner = peoplesFavor(state);
  const canPlace = state.players[seat].favor > 0;
  const canReturn = banner.tokens > 0;
  const banks = leastFavorBanks(state);
  // "If it only has one favor on it, you must place one favor on it unless
  // you have no favor" — plus the degenerate case of an empty banner, where
  // returning is simply not a thing you can do.
  const mustPlace = canPlace && (banner.tokens === 1 || !canReturn);
  const mustReturn = canReturn && !canPlace;
  return { canPlace, canReturn, mustPlace, mustReturn, banks };
}

/** The step to take when the Law leaves no choice, or null when it does. */
function forcedWakeStep(state: OathState, seat: number): WakeStep | null {
  const o = wakeOptions(state, seat);
  if (o.mustPlace) return { choice: 'place' };
  if (o.mustReturn && o.banks.length === 1) return { choice: 'return', bank: o.banks[0] };
  return null;
}

function applyWakeStep(state: OathState, seat: number, step: WakeStep): OathState {
  return step.choice === 'place'
    ? applyEffects(state, seat, [
        { kind: 'favor', from: { kind: 'seatFavor', seat }, to: { kind: 'bannerFavor' }, amount: 1 },
      ])
    : applyEffects(state, seat, [
        { kind: 'favor', from: { kind: 'bannerFavor' }, to: { kind: 'favorBank', suit: step.bank }, amount: 1 },
      ]);
}

/**
 * Law §4.1.1.III, then §4.1.2, then §4.1.3 — everything after the favor
 * maintenance. Reached from both `beginWake` (when nothing was owed, or
 * every step resolved itself) and `wake.favor` (when a player answered the
 * last one), so the Law's order holds whichever way the wake completed.
 */
function finishWake(state: OathState, seat: number): OathState {
  state.wake = null;

  // §4.1.1.III: "If the People's Favor has six favor or more, it flips to
  // its Mob side if it is not on that side."
  const banner = peoplesFavor(state);
  if (banner.tokens >= MOB_THRESHOLD && !banner.mob) banner.mob = true;

  if (!isExile(state, seat)) return state; // §4.1.2 and §4.1.3 are Exile-only

  // §4.1.2 Check for Win — §3.1 then §3.2.
  if (state.oathkeeper === seat && state.usurper) return finish(state, seat);
  if (visionGoalMet(state, seat)) return finish(state, seat);

  // §4.1.3 Flip to Usurper — AFTER the win check; see this file's header for
  // why that order is the whole Usurper clock.
  if (state.oathkeeper === seat) state.usurper = true;
  return state;
}

/** Resolve as many §4.1.1 steps as the Law forces, then finish or wait. */
function advanceWake(state: OathState): OathState {
  let working = state;
  while (working.wake && working.wake.stepsRemaining > 0) {
    const seat = working.wake.seat;
    const o = wakeOptions(working, seat);
    if (!o.canPlace && !o.canReturn) break; // nothing is possible: skip the step (§9.2)
    const forced = forcedWakeStep(working, seat);
    if (!forced) return working; // a genuine choice — leave it pending
    working = applyWakeStep(working, seat, forced);
    working.wake = { ...working.wake!, stepsRemaining: working.wake!.stepsRemaining - 1 };
  }
  return finishWake(working, working.wake?.seat ?? state.turn.activeSeat);
}

/**
 * Start `seat`'s Wake Phase (Law §4.1), called when a turn begins — from
 * the pipeline after `turn.rest`, and from `init` for the opening turn,
 * which has no rest before it.
 */
export function beginWake(state: OathState, seat: number): OathState {
  const banner = peoplesFavor(state);
  // §4.1.1 applies only to the holder; §4.1.1.II repeats it once on Mob.
  const steps = banner.holder === seat ? (banner.mob ? 2 : 1) : 0;
  const working = applyEffects(state, seat, []);
  working.wake = steps > 0 ? { seat, stepsRemaining: steps, startedAt: working.actionCount } : null;
  return advanceWake(working);
}

const WakeFavorPayloadSchema = z.discriminatedUnion('choice', [
  z.object({ choice: z.literal('place') }),
  z.object({ choice: z.literal('return'), bank: z.enum(SUITS) }),
]);

function wakeFavor(state: OathState, action: GameAction): OathState {
  const seat = requireActiveSeat(state, action, { wakeOk: true });
  const wake = state.wake;
  if (!wake || wake.stepsRemaining <= 0) {
    throw new IllegalAction('wake.favor: no Wake Phase favor step is pending');
  }
  if (seat !== wake.seat) {
    throw new IllegalAction("wake.favor: only the waking seat resolves their own Wake Phase (Law §4.1)");
  }
  const parsed = WakeFavorPayloadSchema.safeParse(action.payload);
  if (!parsed.success) throw new IllegalAction('wake.favor: malformed payload');
  const step = parsed.data;

  const o = wakeOptions(state, seat);
  if (step.choice === 'place' && !o.canPlace) {
    throw new IllegalAction('wake.favor: you have no favor to place (Law §4.1.1)');
  }
  if (step.choice === 'return') {
    if (!o.canReturn) throw new IllegalAction('wake.favor: the People\'s Favor has no favor to return (Law §4.1.1)');
    if (o.mustPlace) {
      throw new IllegalAction(
        "wake.favor: at one favor you must place, not return (Law §4.1.1)",
      );
    }
    if (!o.banks.includes(step.bank)) {
      throw new IllegalAction(
        `wake.favor: ${step.bank} is not among the least-full favor banks (Law §4.1.1)`,
      );
    }
  }

  let working = applyWakeStep(state, seat, step);
  working.wake = { ...working.wake!, stepsRemaining: working.wake!.stepsRemaining - 1 };
  return advanceWake(working);
}

// ---- game end ------------------------------------------------------------

function finish(state: OathState, winner: number): OathState {
  state.complete = true;
  state.winner = winner;
  state.wake = null;
  state.titleChoice = null;
  return state;
}

/** Law §3.4, resolved strictly down 3.4.1 -> 3.4.4. */
function warExhaustion(state: OathState): OathState {
  // 3.4.1 Empire if Oathkeeper.
  if (!isExile(state, state.oathkeeper)) return finish(state, successorOrChancellor(state));
  // 3.4.2 Usurper.
  if (state.usurper && isExile(state, state.oathkeeper)) return finish(state, state.oathkeeper);
  // 3.4.3 Visionary, ties broken by Vision rather than by seat.
  for (const vision of VISION_TIEBREAK) {
    const seat = state.players.findIndex(
      (p, i) => isExile(state, i) && p.vision === vision && visionGoalMet(state, i),
    );
    if (seat !== -1) return finish(state, seat);
  }
  // 3.4.4 Empire.
  return finish(state, successorOrChancellor(state));
}

/**
 * Law §4: "Once each player has taken a turn, the round ends. Check for the
 * Stable Regime Win (3.3), then advance the round marker." `turn.rest` has
 * already advanced both the seat and the marker by the time this runs, so
 * the round that just ENDED is one behind.
 */
function roundEnd(state: OathState, endedRound: number, action: GameAction): OathState {
  if (endedRound >= FINAL_ROUND) return warExhaustion(state); // §3.4, no die
  const target = STABLE_REGIME_TARGET[endedRound];
  if (target === undefined) return state;
  // §3.3: "roll the die IF the Chancellor or a Citizen is the Oathkeeper."
  if (isExile(state, state.oathkeeper)) return state;
  const die = (action.payload as { endDie?: unknown } | null)?.endDie;
  if (typeof die !== 'number') {
    throw new IllegalAction(
      `turn.rest: round ${endedRound} ended with an Imperial Oathkeeper but no end die was rolled (Law §3.3)`,
    );
  }
  return die >= target ? finish(state, successorOrChancellor(state)) : state;
}

// ---- the pipeline --------------------------------------------------------

/**
 * Runs after every action (`index.ts#reduce`). Order matters: the title is
 * an input to every win check, a round can end the game before the next
 * player ever wakes, and a Wake Phase can end it too.
 */
export function afterAction(state: OathState, action: GameAction): OathState {
  if (state.complete) return state;
  let working = state;

  updateTitle(working); // §2.11, whose inputs any action might have moved

  if (action.type === 'turn.rest') {
    // `rest` advanced activeSeat, and incremented the round if it wrapped.
    if (working.turn.activeSeat === 0) {
      working = roundEnd(working, working.turn.round - 1, action);
      if (working.complete) return working;
    }
    working = beginWake(working, working.turn.activeSeat);
  }
  return working;
}

/**
 * `prepare()` for 'turn.rest' (HLD D14): roll §3.3's end die when this rest
 * is the one that ends round five, six or seven. Deliberately ignores who
 * holds the title — a weaker condition than `roundEnd`'s, so the die is
 * never missing when it is needed, at the cost of the occasional unused
 * roll in the log.
 */
export function prepareRest(state: OathState, proposed: ProposedAction): unknown {
  const base = typeof proposed.payload === 'object' && proposed.payload !== null ? proposed.payload : {};
  if (proposed.type !== 'turn.rest') return proposed.payload;
  const endsRound = (state.turn.activeSeat + 1) % state.seats === 0;
  if (!endsRound || STABLE_REGIME_TARGET[state.turn.round] === undefined) return proposed.payload;
  return { ...base, endDie: rollDice(END_DIE, 1)[0] };
}

export const VICTORY_HANDLERS: Record<string, Handler> = {
  'wake.favor': wakeFavor,
  'oathkeeper.grant': grant,
};
