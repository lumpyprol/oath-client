/**
 * `citizenship` (unit 16) — Law §6.6-6.8: how an Exile becomes a Citizen,
 * and the two ways a Citizen stops being one. Five actions:
 *
 *   citizenship.offer — the Grand Scepter holder (`state.grandScepter`,
 *     not necessarily the Chancellor — the Scepter is a relic and can
 *     change hands), on their own turn (§6.6 is a Minor Action, governed
 *     by §4.2's Act-Phase framing same as every other). §6.6.1: offers
 *     Citizenship to any Exile — INCLUDING themselves, if the Scepter
 *     holder happens to be an Exile. Must name exactly one relic from the
 *     Imperial Reliquary; may also name an ADDITIONAL negotiated exchange
 *     of favor/secrets/relics/banners in either direction (`give`:
 *     offerer -> exile, `take`: exile -> offerer). Opens `state.
 *     citizenshipOffer`, a pending decision exactly like Campaign's
 *     response window (one at a time; a second `offer` while one is
 *     already pending is illegal-state, same simplification Campaign
 *     makes for itself).
 *
 *   citizenship.accept / citizenship.decline — the offered Exile only, NOT
 *     gated on it being their turn (same reasoning as `campaign.respond`:
 *     the offer can land on anyone's turn, and the Exile must be able to
 *     answer regardless). `decline` just clears the offer. `accept`
 *     resolves Law §6.6.2's full list, in order:
 *       1. Flip to the Citizen side (`citizenship = 'citizen'`).
 *       2. Replace warbands with purple (see WARBAND MODEL below).
 *       3. Discard a prior revealed Vision, if any (Glossary "Discard").
 *       4. Flip Usurper -> Oathkeeper if they hold the title on that side.
 *       5. End their Act Phase, if it's their turn (turn.ts's own
 *          turn-passing lines, duplicated rather than imported — Rest's
 *          OWN resource sweep does not run; §6.6.2 replaces its Supply
 *          step with #6 below, unconditionally).
 *       6. Refresh Supply to `LEFTMOST_SUPPLY`.
 *       7. Exchange what was promised (the mandatory Reliquary relic, plus
 *          any additional `give`/`take` terms) — applied here, atomically
 *          with everything else, since staleness between `offer` and
 *          `accept` is exactly what `applyEffects`'s feasibility check is
 *          for (HLD "Rollback is the rules engine": a promise that can no
 *          longer be kept fails the action, it isn't silently adjusted).
 *     DEFERRED (documented, not silently dropped): "the Chancellor gains
 *     the revealed mandatory action modifier in the Reliquary" (§6.6.2's
 *     last sentence) — printed BOARD text with no id in our card database
 *     (same out-of-scope category `power.ts`'s header already carves out
 *     for "the Chancellor's Reliquary powers"). Peeking at Reliquary
 *     relics (§6.6.1's "you can let them peek") — the Peek family (§6.3,
 *     §6.4) isn't built anywhere in this engine yet; the offer's `relicId`
 *     being visible in the projected view (Law §9.4: a binding offer's
 *     terms are necessarily public to the party deciding on it) makes a
 *     separate peek action unnecessary for THIS unit's purposes anyway.
 *
 *   citizenship.exile — the Grand Scepter holder, own turn, §6.7: exiles
 *     ANOTHER Citizen (never themselves — that's `selfExile`) by GIVING
 *     them 5 favor, modified +1/+2 if the target is the Oathkeeper/holds
 *     the People's Favor (both = +2), -1/-2 by the same two facts about
 *     the ACTOR. No consent step — a direct, unilateral effect. The
 *     exiled Citizen: flips to Exile, gets warbands of their own color
 *     back (see WARBAND MODEL), and refreshes Supply to leftmost. Unlike
 *     `accept`, §6.7 does not mention discarding a Vision (Citizens can
 *     never hold one revealed — §5.1.4 forbids it) or ending an Act Phase
 *     (this is the ACTOR's turn, not the exiled Citizen's).
 *
 *   citizenship.selfExile — a Citizen, own turn, not the Grand Scepter
 *     holder (§6.8 forbids it — a Citizen holding the Scepter cannot
 *     un-Citizen themselves via this action at all), §6.8: gives the
 *     Scepter holder favor equal to (their board's ready + flipped
 *     secrets, plus secrets on their own advisers) + their board
 *     warbands. (Secrets on relic/edifice cards are NOT counted: relics
 *     carry no token fields yet — `effects.ts`'s own header flags this gap
 *     — and edifice-card secrets have no owning-seat attribution per
 *     `turn.ts`'s identical Rest-sweep gap. Both are pre-existing, already-
 *     documented holes, not new ones.) Then: flips to Exile, own-color
 *     warbands back, Supply to leftmost, and — always, since this requires
 *     being your own turn — ends the Act Phase.
 *
 * WARBAND MODEL — the load-bearing design decision this unit had to make.
 * Law §6.6.2 says "replace board+map warbands with purple, or if there
 * aren't enough, the Exile chooses which to keep"; §6.7/§6.8 say "replace
 * board warbands with your own color" (silent on site presence). Taken
 * fully literally these would need a THIRD warband bucket our engine has
 * never had: "purple pieces temporarily idle, unattributed to any seat"
 * and "a Citizen's own-color reserve, held in trust while they're purple."
 * `state.ts#checkInvariants` has no such bucket — it enforces exactly two:
 * each Exile's own total === EXILE_WARBANDS (14), and Chancellor+Citizens'
 * combined total === CHANCELLOR_WARBANDS (24), full stop. Unit 7 (Muster)
 * already established the precedent this unit follows: "a physical-token
 * distinction the abstract per-seat model doesn't need... purple-pool
 * conservation is already an invariant." Applied here:
 *
 *   - The purple total is a CLOSED, already-fully-allocated system: by the
 *     invariant, Chancellor + existing Citizens ALREADY hold exactly 24
 *     between them, at all times, before any new Citizen joins. So the
 *     "capacity" for a joining Exile's warbands is provably always 0 —
 *     there is never a spare purple piece sitting anywhere. This isn't a
 *     simplification; it's what the physical rule's "if there aren't
 *     enough" clause is describing (there almost never are). `accept`
 *     computes the formula generally rather than hardcoding 0, and throws
 *     (rather than silently mishandling it) on the — provably unreached
 *     from any invariant-valid state — case where capacity would be
 *     positive.
 *   - A joining Exile's own-color total (bank + board + every site, always
 *     exactly 14 by the invariant) is therefore wholly REMOVED, with no
 *     tracked destination — same treatment `power.ts`'s header gives any
 *     genuinely untrackable quantity. It isn't lost information: nothing
 *     ever reads "a Citizen's idle own-color reserve," and if they later
 *     leave Citizenship, they get a FRESH 14 back (below), not a
 *     remembered one — exactly mirroring how Law §1.15 hands a brand-new
 *     Exile 14 warbands (3 board / 11 bank) from nowhere-in-particular at
 *     setup.
 *   - Leaving Citizenship (`exile`/`selfExile`) is the mirror image: the
 *     departing seat's ENTIRE current purple holding (bank + board + every
 *     site — not just "board", generalizing §6.7/§6.8's silence about site
 *     presence the same way `accept` generalizes "board and map" to
 *     everything, for the identical reason: our invariant has no way to
 *     leave part of a seat's holdings purple while the rest turns exile-
 *     colored) moves to the CHANCELLOR's personal bank — reusing the exact
 *     disposal Glossary "Kill" already specifies for a dying purple
 *     warband ("purple warbands go to the Chancellor"), since this is the
 *     same "purple leaves this seat's attribution" event, just triggered
 *     by a status change instead of combat. They then receive a FRESH 14
 *     of their own color, split 3 board / 11 bank — Law §1.15's setup
 *     split, reused as "what a seat freshly wearing the Exile board looks
 *     like," since nothing tracked what they had before joining.
 *
 * DEFERRED, flagged explicitly rather than silently skipped: Law §6.6.3
 * ("every Imperial player rules every site with any purple warbands on
 * it") is a ripple into `campaign.ts#rulersOf` and `power.ts#hasAccess`
 * (both currently "a seat rules a site iff THEIR OWN warband count there
 * is positive" — correct for a lone Chancellor, incomplete once a second
 * Imperial seat exists) that this unit's own scope (citizenship
 * TRANSITIONS) does not require touching. HLD D39 flagged unit 16 as the
 * likely trigger to revisit this; it's surfaced here rather than folded in
 * silently so it can be prioritized deliberately, the same way relic
 * targets got pulled forward in unit 12 once their real-game importance
 * was raised.
 */

import { z } from 'zod';
import { IllegalAction, type GameAction } from '../../../engine/types.js';
import { applyEffects, type Effect } from '../effects.js';
import { discardRegion } from '../map.js';
import { chancellorSeatOf } from '../rule.js';
import {
  CHANCELLOR_WARBANDS,
  DARKEST_SECRET_ID,
  EXILE_WARBANDS,
  LEFTMOST_SUPPLY,
  PEOPLES_FAVOR_ID,
  type CitizenshipOffer,
  type OathState,
} from '../state.js';
import { requireActiveSeat, type Handler } from '../turn.js';

const EXILE_BASE_FAVOR = 5; // Law §6.7

function bannerFullId(short: 'peoples-favor' | 'darkest-secret'): string {
  return short === 'peoples-favor' ? PEOPLES_FAVOR_ID : DARKEST_SECRET_ID;
}

const BagSchema = z.object({
  favor: z.number().int().min(0).default(0),
  secrets: z.number().int().min(0).default(0),
  relics: z.array(z.string()).default([]),
  banners: z.array(z.enum(['peoples-favor', 'darkest-secret'])).default([]),
});

// ---- shared helpers (both directions of citizenship transition) ----------

function totalWarbands(state: OathState, seat: number): number {
  const onMap = state.sites.reduce((sum, s) => sum + s.warbands[seat], 0);
  return state.players[seat].warbands.bank + state.players[seat].warbands.board + onMap;
}

/** Glossary "Kill"'s own disposal, reused: a seat's ENTIRE purple holding -> the Chancellor's bank. */
function purpleToChancellorBank(state: OathState, seat: number): OathState {
  const chancellor = chancellorSeatOf(state);
  const player = state.players[seat];
  const effects: Effect[] = [];
  if (player.warbands.bank > 0) {
    effects.push({
      kind: 'warbands',
      from: { kind: 'seatWarbandBank', seat },
      to: { kind: 'seatWarbandBank', seat: chancellor },
      amount: player.warbands.bank,
    });
  }
  if (player.warbands.board > 0) {
    effects.push({
      kind: 'warbands',
      from: { kind: 'seatWarbandBoard', seat },
      to: { kind: 'seatWarbandBank', seat: chancellor },
      amount: player.warbands.board,
    });
  }
  for (const site of state.sites) {
    if (site.warbands[seat] > 0) {
      effects.push({
        kind: 'warbands',
        from: { kind: 'siteWarbands', siteId: site.id, seat },
        to: { kind: 'seatWarbandBank', seat: chancellor },
        amount: site.warbands[seat],
      });
    }
  }
  return applyEffects(state, seat, effects);
}

/** A joining Exile's own-color holding has no tracked destination (see file header). */
function wipeAllWarbands(state: OathState, seat: number): void {
  state.players[seat].warbands.bank = 0;
  state.players[seat].warbands.board = 0;
  for (const site of state.sites) site.warbands[seat] = 0;
}

/** Law §1.15's own setup split, reused for "what a freshly-Exile seat looks like." */
function grantFreshExileWarbands(state: OathState, seat: number): void {
  state.players[seat].warbands.board = 3;
  state.players[seat].warbands.bank = EXILE_WARBANDS - 3;
}

function endActPhaseIfActive(state: OathState, seat: number): void {
  if (state.turn.activeSeat !== seat) return;
  state.turn.activeSeat = (state.turn.activeSeat + 1) % state.seats;
  if (state.turn.activeSeat === 0) state.turn.round += 1; // Law §4: round ends
  state.turn.turnStartedAt = state.actionCount;
}

// ---- citizenship.offer / accept / decline (Law §6.6) ----------------------

const OfferPayloadSchema = z.object({
  exile: z.number().int().min(0),
  relicId: z.string(),
  give: BagSchema.optional(),
  take: BagSchema.optional(),
});
const EMPTY_BAG = { favor: 0, secrets: 0, relics: [] as string[], banners: [] as ('peoples-favor' | 'darkest-secret')[] };

function offer(state: OathState, action: GameAction): OathState {
  const seat = requireActiveSeat(state, action);
  if (seat !== state.grandScepter) {
    throw new IllegalAction('citizenship.offer: only the Grand Scepter holder may offer Citizenship (Law §6.6.1)');
  }
  if (state.citizenshipOffer) {
    throw new IllegalAction('citizenship.offer: a Citizenship offer is already pending');
  }
  const parsed = OfferPayloadSchema.safeParse(action.payload);
  if (!parsed.success) throw new IllegalAction('citizenship.offer: malformed payload');
  const { exile, relicId, give = EMPTY_BAG, take = EMPTY_BAG } = parsed.data;

  if (exile < 0 || exile >= state.seats) throw new IllegalAction('citizenship.offer: no such seat');
  if (state.players[exile].citizenship !== 'exile') {
    throw new IllegalAction('citizenship.offer: the offered seat must currently be an Exile (Law §6.6.1)');
  }
  if (!state.reliquary.some((space) => space.relicId === relicId)) {
    throw new IllegalAction(
      `citizenship.offer: ${relicId} is not one of the Imperial Reliquary's relics (Law §6.6.1)`,
    );
  }

  const working = applyEffects(state, seat, []); // clone, same idiom as campaign.ts#killFromBoard
  const citizenshipOffer: CitizenshipOffer = {
    scepterSeat: seat,
    exile,
    relicId,
    give: { ...give, banners: give.banners.map(bannerFullId) },
    take: { ...take, banners: take.banners.map(bannerFullId) },
    offeredAt: working.actionCount,
  };
  working.citizenshipOffer = citizenshipOffer;
  return working;
}

function decline(state: OathState, action: GameAction): OathState {
  if (state.complete) throw new IllegalAction('citizenship.decline: the game is already complete');
  const o = state.citizenshipOffer;
  if (!o) throw new IllegalAction('citizenship.decline: no Citizenship offer is pending');
  if (action.actor !== o.exile) {
    throw new IllegalAction('citizenship.decline: only the offered Exile may decline');
  }
  const working = applyEffects(state, o.exile, []);
  working.citizenshipOffer = null;
  return working;
}

function accept(state: OathState, action: GameAction): OathState {
  if (state.complete) throw new IllegalAction('citizenship.accept: the game is already complete');
  const o = state.citizenshipOffer;
  if (!o) throw new IllegalAction('citizenship.accept: no Citizenship offer is pending');
  if (action.actor !== o.exile) {
    throw new IllegalAction('citizenship.accept: only the offered Exile may accept');
  }
  const seat = o.exile;
  if (state.players[seat].citizenship !== 'exile') {
    throw new IllegalAction('citizenship.accept: illegal state — the offered seat is no longer an Exile');
  }
  const player = state.players[seat];

  // Law §6.6.2's exchange (step 7, applied here — see file header) — the
  // mandatory relic, plus whatever additional terms were negotiated.
  const effects: Effect[] = [
    { kind: 'card', id: o.relicId, from: { kind: 'reliquary' }, to: { kind: 'seatRelics', seat } },
  ];
  if (o.give.favor > 0) {
    effects.push({
      kind: 'favor',
      from: { kind: 'seatFavor', seat: o.scepterSeat },
      to: { kind: 'seatFavor', seat },
      amount: o.give.favor,
    });
  }
  if (o.give.secrets > 0) {
    effects.push({
      kind: 'secret',
      from: { kind: 'seatSecrets', seat: o.scepterSeat },
      to: { kind: 'seatSecrets', seat },
      amount: o.give.secrets,
    });
  }
  for (const relicId of o.give.relics) {
    effects.push({ kind: 'card', id: relicId, from: { kind: 'seatRelics', seat: o.scepterSeat }, to: { kind: 'seatRelics', seat } });
  }
  if (o.take.favor > 0) {
    effects.push({
      kind: 'favor',
      from: { kind: 'seatFavor', seat },
      to: { kind: 'seatFavor', seat: o.scepterSeat },
      amount: o.take.favor,
    });
  }
  if (o.take.secrets > 0) {
    effects.push({
      kind: 'secret',
      from: { kind: 'seatSecrets', seat },
      to: { kind: 'seatSecrets', seat: o.scepterSeat },
      amount: o.take.secrets,
    });
  }
  for (const relicId of o.take.relics) {
    effects.push({ kind: 'card', id: relicId, from: { kind: 'seatRelics', seat }, to: { kind: 'seatRelics', seat: o.scepterSeat } });
  }
  // Law §5.1.4.3 / Glossary "Discard": step 3, a prior revealed Vision.
  if (player.vision !== null) {
    const pawnRegion = state.sites.find((s) => s.id === player.pawnSite)!.region;
    effects.push({
      kind: 'card',
      id: player.vision,
      from: { kind: 'seatVision', seat },
      to: { kind: 'discard', region: discardRegion(pawnRegion) },
    });
  }

  let working = applyEffects(state, seat, effects);

  // Banner-holder exchanges: structural, mutated directly (same precedent
  // as Campaign seizure — effects.ts's vocabulary addresses a banner's
  // token STAKE only, never its holder).
  for (const bannerId of o.give.banners) {
    const banner = working.banners.find((b) => b.id === bannerId)!;
    if (banner.holder !== o.scepterSeat) {
      throw new IllegalAction(`citizenship.accept: seat ${o.scepterSeat} does not hold ${bannerId} to give`);
    }
    banner.holder = seat;
  }
  for (const bannerId of o.take.banners) {
    const banner = working.banners.find((b) => b.id === bannerId)!;
    if (banner.holder !== seat) {
      throw new IllegalAction(`citizenship.accept: seat ${seat} does not hold ${bannerId} to give`);
    }
    banner.holder = o.scepterSeat;
  }

  // Law §6.6.2 step 2 — see file header's WARBAND MODEL section.
  const totalHeld = totalWarbands(working, seat);
  const existingPurple = working.players.reduce((sum, p, i) => {
    if (i === seat || p.citizenship === 'exile') return sum;
    return sum + totalWarbands(working, i);
  }, 0);
  const capacity = Math.max(0, CHANCELLOR_WARBANDS - existingPurple);
  const kept = Math.min(totalHeld, capacity);
  if (kept > 0) {
    throw new IllegalAction(
      'citizenship.accept: partial-purple-capacity join is not supported (Law §6.6.2) — unreached from a valid state',
    );
  }
  wipeAllWarbands(working, seat);

  working.players[seat].citizenship = 'citizen';
  if (working.oathkeeper === seat && working.usurper) working.usurper = false; // step 4
  endActPhaseIfActive(working, seat); // step 5
  working.players[seat].supply = LEFTMOST_SUPPLY; // step 6
  working.citizenshipOffer = null;
  return working;
}

// ---- citizenship.exile (Law §6.7) -----------------------------------------

const ExilePayloadSchema = z.object({ citizen: z.number().int().min(0) });

function exile(state: OathState, action: GameAction): OathState {
  const seat = requireActiveSeat(state, action);
  if (seat !== state.grandScepter) {
    throw new IllegalAction('citizenship.exile: only the Grand Scepter holder may exile a Citizen (Law §6.7)');
  }
  const parsed = ExilePayloadSchema.safeParse(action.payload);
  if (!parsed.success) throw new IllegalAction('citizenship.exile: malformed payload');
  const { citizen } = parsed.data;

  if (citizen < 0 || citizen >= state.seats) throw new IllegalAction('citizenship.exile: no such seat');
  if (citizen === seat) {
    throw new IllegalAction('citizenship.exile: cannot target yourself — Law §6.7 exiles "another" Citizen');
  }
  if (state.players[citizen].citizenship !== 'citizen') {
    throw new IllegalAction('citizenship.exile: the target must currently be a Citizen (Law §6.7)');
  }

  const holdsPeoplesFavor = (s: number) => state.banners.find((b) => b.id === PEOPLES_FAVOR_ID)?.holder === s;
  const citizenFlags = (state.oathkeeper === citizen ? 1 : 0) + (holdsPeoplesFavor(citizen) ? 1 : 0);
  const actorFlags = (state.oathkeeper === seat ? 1 : 0) + (holdsPeoplesFavor(seat) ? 1 : 0);
  const amount = Math.max(0, EXILE_BASE_FAVOR + citizenFlags - actorFlags);

  const effects: Effect[] = [];
  if (amount > 0) {
    effects.push({ kind: 'favor', from: { kind: 'seatFavor', seat }, to: { kind: 'seatFavor', seat: citizen }, amount });
  }
  let working = applyEffects(state, seat, effects);

  working = purpleToChancellorBank(working, citizen);
  grantFreshExileWarbands(working, citizen);
  working.players[citizen].citizenship = 'exile';
  working.players[citizen].supply = LEFTMOST_SUPPLY;
  return working;
}

// ---- citizenship.selfExile (Law §6.8) --------------------------------------

function selfExile(state: OathState, action: GameAction): OathState {
  const seat = requireActiveSeat(state, action);
  if (state.players[seat].citizenship !== 'citizen') {
    throw new IllegalAction('citizenship.selfExile: only a Citizen may exile themselves (Law §6.8)');
  }
  if (seat === state.grandScepter) {
    throw new IllegalAction('citizenship.selfExile: the Grand Scepter holder cannot exile themselves (Law §6.8)');
  }
  const scepterSeat = state.grandScepter;
  const player = state.players[seat];
  const boardSecrets = player.secrets.ready + player.secrets.flipped;
  const adviserSecrets = player.advisers.reduce((sum, a) => sum + a.secrets, 0);
  const amount = boardSecrets + adviserSecrets + player.warbands.board;

  const effects: Effect[] = [];
  if (amount > 0) {
    effects.push({ kind: 'favor', from: { kind: 'seatFavor', seat }, to: { kind: 'seatFavor', seat: scepterSeat }, amount });
  }
  let working = applyEffects(state, seat, effects);

  working = purpleToChancellorBank(working, seat);
  grantFreshExileWarbands(working, seat);
  working.players[seat].citizenship = 'exile';
  working.players[seat].supply = LEFTMOST_SUPPLY;
  endActPhaseIfActive(working, seat); // Law §6.8: always applies — this action requires your own turn

  return working;
}

export const CITIZENSHIP_HANDLERS: Record<string, Handler> = {
  'citizenship.offer': offer,
  'citizenship.accept': accept,
  'citizenship.decline': decline,
  'citizenship.exile': exile,
  'citizenship.selfExile': selfExile,
};
