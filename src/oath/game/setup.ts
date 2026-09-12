/**
 * Setup and init (HLD D30/D31). All setup randomness happens once, in
 * `oathSetup`, and is persisted; `init` is pure assembly with none.
 *
 * `SetupSpec` is the seed-shaped description of an opening position's
 * STRUCTURAL facts only — sites, their starting denizens, pre-placed
 * relics, oath, citizenship, starting pawn locations. It deliberately does
 * NOT fix the world deck's contents or order, or the relic deck's order:
 * those are shuffled fresh by `oathSetup` every time, from whatever cards
 * the spec says are still available (`worldPool`/`relicPool`) — matching
 * the engine's own contract that randomness lives in `setup()`, not in a
 * constant. This is why `FIRST_GAME` can be a plain, static value (HLD
 * D30) while still producing a different game each time it's used: the
 * board layout is fixed, the deal is not.
 *
 * Unit 18 will add `specFromSeed(parsed: ParsedSeed): SetupSpec`,
 * converting a real chronicle export into this same shape.
 *
 * Citations are "Law §x.y" (Buried Giant rules reference, Oath printing
 * p1; see RULINGS.md). Starting Supply (both seats: 7) is derived from the
 * Supply track's space count, not a printed numeral — see the constant's
 * own comment and RULINGS.md; unit 5 needs the full bracket->value table
 * for `turn.rest`'s refresh formula, which this file does not attempt.
 */

import { byId, byName, cards } from '../cards/index.js';
import { SUITS, type Suit } from '../cards/schema.js';
import { shuffle } from '../../engine/random.js';
import { IllegalAction } from '../../engine/types.js';
import { discardRegion } from './map.js';
import { parseSeed, type ParsedSeed } from '../chronicle/seed.js';
import { beginWake } from './victory.js';
import {
  CHANCELLOR_WARBANDS,
  DARKEST_SECRET_ID,
  EXILE_WARBANDS,
  LEFTMOST_SUPPLY,
  PEOPLES_FAVOR_ID,
  REGIONS,
  RELIQUARY_MODIFIERS,
  type BannerState,
  type Citizenship,
  type OathName,
  type OathState,
  type PlayerState,
  type Region,
  type ReliquarySpace,
  type SiteState,
} from './state.js';

// ---- rulebook totals (CONSTANTS) ----------------------------------------

/** Favor tokens per suit bank at 2-4 players (Law §1.6). */
const FAVOR_BANK_SMALL = 3;
/** Favor tokens per suit bank at 5-6 players (Law §1.6). */
const FAVOR_BANK_LARGE = 4;

/**
 * Starting Supply (Law §1.10: "place their Supply marker on the leftmost
 * space of their Supply track") — `LEFTMOST_SUPPLY` (state.ts), same value
 * for both seats. See RULINGS.md for the derivation.
 */
const CHANCELLOR_STARTING_SUPPLY = LEFTMOST_SUPPLY;
const EXILE_STARTING_SUPPLY = LEFTMOST_SUPPLY;

// ---- SetupSpec ------------------------------------------------------------

export interface SetupSiteSpec {
  id: string;
  region: Region;
  facedown: boolean;
  /** Starting denizen/edifice ids attached to this site (Law §1.1); may be empty. */
  denizens: string[];
  /**
   * Which of `denizens` stand on their RUIN face (Law §2.9). Only edifices
   * can, and only a chronicle produces them (§8.3.3 flips edifices at sites
   * the winner does not rule), so this is empty for a first game.
   */
  ruined?: string[];
  /** Facedown relics placed at this site (Law §1.16, §2.8.2); may be empty. */
  relics: string[];
}

export interface SetupSpec {
  /** All sites on the board, Cradle -> Provinces -> Hinterland order (Law §1.1). */
  sites: SetupSiteSpec[];
  oath: OathName;
  suitOrder: Suit[];
  /** Length = seats. Index 0 is always the chancellor (state.ts convention). */
  citizenship: Citizenship[];
  /** Length = seats. The site id each seat's pawn starts on (Law §1.23). */
  startingPawnSite: string[];
  /** Relics pre-drawn into the Imperial Reliquary, facedown (Law §1.17). */
  reliquary: string[];
  /**
   * Denizen/vision ids not otherwise placed by this spec — the pool
   * `oathSetup` shuffles into region discards, starting advisers, and the
   * world deck (Law §1.19-1.21, §1.23).
   */
  worldPool: string[];
  /** Relic ids not otherwise placed — shuffled into the relic deck. */
  relicPool: string[];
  /** Cards permanently out of play (Law §8.5) — empty for a first chronicle. */
  dispossessed: string[];
  /**
   * True when `worldPool` and `relicPool` are already in the order a
   * CHRONICLE recorded, and must not be reshuffled (unit 18).
   *
   * This is the one place D37's "the deal is random, the spec is not" rule
   * inverts, and deliberately: §8.8 builds the next world deck with the
   * Visions seeded at chosen depths (two in the top twelve, three in the
   * next eighteen) and §8.6 stacks the winner's relics on top of the relic
   * deck. That ORDER is the chronicle — reshuffling it would throw away the
   * thing the seed exists to carry. The §1.19-1.23 deal still happens on
   * top of it; only the shuffle is skipped.
   */
  ordered?: boolean;
}

// ---- FIRST_GAME: the rulebook's prescribed first-chronicle layout --------
//
// Transcribed from the Playbook's "Setup for the First Game" and the
// publisher's own "Oath Deck Order" packet PDF (buriedgiant.com/oath/Oath
//%20Deck%20Order.pdf), which resolves the two site slots the Playbook's
// prose leaves unnamed (see RULINGS.md, 2026-09-09). This is a 4-seat
// layout — the box only prescribes a first game for the Chancellor + 3
// Exiles; `oathSetup` rejects any other seat count when no seed is given
// (unit 18 will add seed-driven setups for other counts).

function siteId(name: string): string {
  return byName(name).id;
}
function denizenId(name: string): string {
  return byName(name).id;
}
function relicId(name: string): string {
  return byName(name).id;
}

const FIRST_GAME_SITES: SetupSiteSpec[] = [
  // Cradle (Law §2.1.1: 2 sites)
  { id: siteId('Plains'), region: 'cradle', facedown: false, denizens: [denizenId('Longbows')], relics: [] },
  { id: siteId('Lush Coast'), region: 'cradle', facedown: true, denizens: [], relics: [] },
  // Provinces (3 sites)
  { id: siteId('Mountain'), region: 'provinces', facedown: false, denizens: [denizenId('Taming Charm')], relics: [relicId('Ivory Eye')] },
  { id: siteId('Buried Giant'), region: 'provinces', facedown: true, denizens: [], relics: [] },
  { id: siteId('Salt Flats'), region: 'provinces', facedown: true, denizens: [], relics: [] },
  // Hinterland (3 sites)
  { id: siteId('Rocky Coast'), region: 'hinterland', facedown: false, denizens: [denizenId('Elders')], relics: [] },
  { id: siteId('Wastes'), region: 'hinterland', facedown: true, denizens: [], relics: [] },
  { id: siteId('Great Slum'), region: 'hinterland', facedown: true, denizens: [], relics: [] },
];

const FIRST_GAME_FIXED_DENIZENS = new Set(
  FIRST_GAME_SITES.flatMap((s) => s.denizens),
);
const FIRST_GAME_FIXED_RELICS = new Set([
  ...FIRST_GAME_SITES.flatMap((s) => s.relics),
]);

const FIRST_GAME_SEATS = 4;
// Chancellor's pawn on the Cradle's top site; the three Exiles distributed
// across the other two faceup sites (Law §1.23 requires only that the
// Chancellor start on the top Cradle site — the exact Exile distribution
// below matches the box's specific 4-player teaching layout).
const FIRST_GAME_STARTING_PAWN_SITE = [
  siteId('Plains'),
  siteId('Mountain'),
  siteId('Mountain'),
  siteId('Rocky Coast'),
];

export const FIRST_GAME: SetupSpec = {
  sites: FIRST_GAME_SITES,
  oath: 'supremacy', // Law §1.13 / Playbook p.8: the first game's prescribed goal
  suitOrder: [...SUITS],
  citizenship: Array.from({ length: FIRST_GAME_SEATS }, (_, i) =>
    i === 0 ? 'chancellor' : 'exile',
  ),
  startingPawnSite: FIRST_GAME_STARTING_PAWN_SITE,
  reliquary: [], // filled in below, deterministically, once relicPool exists
  worldPool: cards.denizens
    .map((d) => d.id)
    .filter((id) => !FIRST_GAME_FIXED_DENIZENS.has(id))
    .concat(cards.visions.map((v) => v.id)),
  relicPool: cards.relics.map((r) => r.id).filter((id) => !FIRST_GAME_FIXED_RELICS.has(id)),
  dispossessed: [],
};

// The Reliquary's 4 relics are chosen by oathSetup's shuffle (Law §1.17
// says "draws 4 relic cards" — a random draw, not a fixed choice), so
// FIRST_GAME does not pre-populate `reliquary`; it stays empty in the
// spec and oathSetup fills OathSetup.reliquary from the shuffled relicPool.

// ---- specFromSeed: a chronicle string becomes an opening position --------

/**
 * The vendored parser's `Oath` enum names, mapped onto ours. It carries a
 * fifth value, `Conspiracy`, which is not an Oathkeeper goal at all (§2.10
 * lists four, and the Conspiracy is a Vision card) — a seed claiming it is
 * rejected rather than guessed at.
 */
const OATH_BY_SEED_NAME: Record<string, OathName> = {
  Supremacy: 'supremacy',
  People: 'people',
  Devotion: 'devotion',
  Protection: 'protection',
};

/**
 * Seat order. Seat 0 is always the Chancellor (purple, state.ts's
 * convention); the rest take the parser's own non-purple colour order.
 */
const SEED_SEAT_COLORS = ['Brown', 'Yellow', 'White', 'Blue', 'Red'] as const;

/** The board's 8 slots, in the order a seed lists them (Law §2.1.1). */
const SLOT_REGIONS: Region[] = [
  'cradle', 'cradle',
  'provinces', 'provinces', 'provinces',
  'hinterland', 'hinterland', 'hinterland',
];

/**
 * Turn a parsed chronicle seed into a `SetupSpec` (unit 18; HLD D30 — this
 * is the payoff: one setup path serves first games, imported seeds, and
 * P5's own output).
 *
 * Three mappings are worth knowing about, because the seed format's names
 * do not mean what they look like:
 *
 *   - `SeedSite.ruined` means the SITE IS FACEDOWN, not that anything is a
 *     ruin — the format encodes a facedown site as `saveId + 24`, and the
 *     vendored interface's own comment says so. It maps to `facedown`.
 *     A card's `ruined` DOES mean a ruin face (§2.9).
 *   - a seed's three per-site card slots hold denizens, edifices AND
 *     relics together, while the Law keeps relics NEXT TO a site rather
 *     than in its card slots (§2.8.2 vs §2.8.1). They are split apart here.
 *   - the world and relic lists are ORDERED, and that order is the
 *     chronicle (see `SetupSpec.ordered`).
 *
 * What a seed does NOT carry, and so is not read here: hands, advisers,
 * pawns, warbands, favor, or Supply. Those are setup's to produce (§1.10
 * onward), which is exactly D37's split.
 */
export function specFromSeed(parsed: ParsedSeed, seats: number): SetupSpec {
  const oath = OATH_BY_SEED_NAME[parsed.oath];
  if (oath === undefined) {
    throw new IllegalAction(
      `specFromSeed: the seed names the Oath "${parsed.oath}", which is not one of the four ` +
        `Oathkeeper goals (Law §2.10)`,
    );
  }
  if (!Number.isInteger(seats) || seats < 2 || seats > SEED_SEAT_COLORS.length + 1) {
    throw new IllegalAction(`specFromSeed: ${seats} seats is outside Oath's 2-6 (Law §1.7)`);
  }
  if (parsed.sites.length !== SLOT_REGIONS.length) {
    throw new IllegalAction(
      `specFromSeed: the seed has ${parsed.sites.length} site slots, expected ${SLOT_REGIONS.length} (Law §2.1.1)`,
    );
  }

  const citizenship: Citizenship[] = ['chancellor'];
  for (let seat = 1; seat < seats; seat++) {
    const color = SEED_SEAT_COLORS[seat - 1];
    const recorded = (parsed.playerCitizenship as Record<string, string>)[color];
    citizenship.push(recorded === 'Citizen' ? 'citizen' : 'exile');
  }

  const sites: SetupSiteSpec[] = parsed.sites.map((site, slot) => {
    if (site.id === null) {
      throw new IllegalAction(
        `specFromSeed: board slot ${slot} is empty; a chronicle fills every slot (Law §8.3.5)`,
      );
    }
    const present = site.cards.filter((c): c is NonNullable<typeof c> => c !== null);
    const relics = present.filter((c) => c.id.startsWith('relic:')).map((c) => c.id);
    const denizens = present.filter((c) => !c.id.startsWith('relic:'));
    return {
      id: site.id,
      region: SLOT_REGIONS[slot],
      facedown: site.ruined, // see this function's header: the name lies
      denizens: denizens.map((c) => c.id),
      ruined: denizens.filter((c) => c.ruined).map((c) => c.id),
      relics,
    };
  });

  // Law §1.23.1: "The Chancellor must place theirs on the top Cradle site."
  // The other seats may choose ANY faceup site, which is a real decision the
  // engine has nowhere to ask for yet — they default to the first faceup
  // site. Scheduled in the HLD under P3, together with §1.23.2's adviser
  // choice, which `oathSetup` defaults the same way.
  const firstFaceup = sites.find((s) => !s.facedown);
  if (!firstFaceup) {
    throw new IllegalAction(
      'specFromSeed: the seed leaves every site facedown, so no pawn can be placed (Law §1.23.1)',
    );
  }
  const startingPawnSite = Array.from({ length: seats }, (_, seat) =>
    seat === 0 ? sites[0].id : firstFaceup.id,
  );

  return {
    sites,
    oath,
    suitOrder: parsed.suitOrder,
    citizenship,
    startingPawnSite,
    reliquary: [], // §1.17 draws it from the relic pool, same as a first game
    worldPool: parsed.world.map((c) => c.id),
    relicPool: parsed.relics.map((c) => c.id),
    dispossessed: parsed.dispossessed.map((c) => c.id),
    ordered: true,
  };
}

// ---- OathSetup: spec + every resolved random outcome ---------------------

export interface OathSetup {
  spec: SetupSpec;
  /** Final world deck order after dealing (Law §1.19-1.21), top = index 0. */
  worldDeck: string[];
  /** One region-discard deal per Law §1.19, plus each seat's 2 discards (§1.23). */
  discards: Record<Region, string[]>;
  /** The card each seat kept as its first facedown adviser (Law §1.23). */
  startingAdviser: string[];
  /**
   * Law §1.22: "Advance the Visions Drawn marker by spaces equal to the
   * number of Visions drawn, if any." Counted over the cards PLAYERS drew
   * (§1.20's three each), not §1.19's three placed straight into the
   * discard piles — §1.19 says "take" where §1.20 says "draws", and
   * §2.7.1 advances the marker on a Vision "drawn from the world deck".
   * The §1.19 cards go facedown into discards without anyone seeing them,
   * so they are not known to be out. See RULINGS.md.
   */
  visionsDrawn: number;
  /** Shuffled relic deck order, top = index 0 (Law §1.18). */
  relicDeck: string[];
  /** The Reliquary's 4 relics, drawn from the shuffled pool (Law §1.17). */
  reliquary: string[];
}

/**
 * Decide everything random about the opening position (HLD D5/D13): the
 * world deck's shuffle and deal, and the relic deck's shuffle. Impure —
 * called once, at creation; the result is persisted verbatim.
 */
function specFor(seats: number, options?: unknown): SetupSpec {
  const seed = (options as { seed?: unknown } | null | undefined)?.seed;
  if (seed !== undefined) {
    if (typeof seed !== 'string') throw new IllegalAction('oathSetup: seed must be a string');
    // `parseSeed` throws plain Errors for a malformed string; re-flag them as
    // IllegalAction so the create route answers 400 rather than 500 — a bad
    // seed is the caller's mistake, not the server's.
    let parsed: ParsedSeed;
    try {
      parsed = parseSeed(seed);
    } catch (err) {
      throw new IllegalAction(`oathSetup: ${(err as Error).message}`);
    }
    return specFromSeed(parsed, seats);
  }
  if (seats !== FIRST_GAME.citizenship.length) {
    throw new IllegalAction(
      `oathSetup: the first game is fixed for ${FIRST_GAME.citizenship.length} seats, got ${seats} ` +
        `(pass a chronicle seed to set up any other count)`,
    );
  }
  return FIRST_GAME;
}

export function oathSetup(seats: number, options?: unknown): OathSetup {
  const spec = specFor(seats, options);

  // Deal the world pool (Law §1.19-1.21, §1.23): 1 card to each region's
  // discard, then each seat draws 3 from the bottom and keeps 1.
  const pool = spec.ordered ? [...spec.worldPool] : shuffle(spec.worldPool);
  let i = 0;
  const discards: Record<Region, string[]> = { cradle: [], provinces: [], hinterland: [] };
  for (const region of REGIONS) discards[region].push(pool[i++]);

  // Law §1.23.2 — "Chooses 1 card as a facedown adviser" — is a PLAYER's
  // choice, and this keeps the first card drawn instead of asking. Same
  // deferral as §1.23.1's pawn placement below, and scheduled in the same
  // place (HLD, P3): both are setup-time pending decisions, they run in
  // turn order rather than at once, and they are coupled, because the pawn
  // decides which pile the two rejected cards are discarded to.
  const startingAdviser: string[] = [];
  let visionsDrawn = 0; // Law §1.22, over §1.20's player draws only
  for (let seat = 0; seat < seats; seat++) {
    const drawn = [pool[i++], pool[i++], pool[i++]];
    visionsDrawn += drawn.filter((id) => id.startsWith('vision:')).length;
    const [kept, ...rest] = drawn;
    startingAdviser.push(kept);
    const pawnSite = spec.startingPawnSite[seat];
    const pawnRegion = spec.sites.find((s) => s.id === pawnSite)!.region;
    const discardTo = discardRegion(pawnRegion); // Glossary "Discard"
    for (const id of rest) discards[discardTo].push(id);
  }
  const worldDeck = pool.slice(i);

  // Relic deck (Law §1.17-1.18): the first 4 go to the Reliquary, the rest
  // form the deck. §9.3 caps the draw at what is there — a chronicle can
  // legitimately carry fewer than 4 loose relics, and the uncovered spaces
  // then simply start usable (§7.1.1).
  const RELIQUARY_SPACES = RELIQUARY_MODIFIERS.length; // Law §1.17/§2.3
  const orderedRelics = spec.ordered ? [...spec.relicPool] : shuffle(spec.relicPool);
  const reliquary = orderedRelics.slice(0, RELIQUARY_SPACES);
  const relicDeck = orderedRelics.slice(RELIQUARY_SPACES);

  return { spec, worldDeck, discards, startingAdviser, visionsDrawn, relicDeck, reliquary };
}

// ---- init: pure assembly ---------------------------------------------------

function favorBankSize(seats: number): number {
  return seats >= 5 ? FAVOR_BANK_LARGE : FAVOR_BANK_SMALL;
}

/**
 * Build the opening state from a resolved `OathSetup`. Pure — no
 * randomness; the same input always yields the same output.
 */
export function init(setup: OathSetup): OathState {
  const { spec } = setup;
  const seats = spec.citizenship.length;

  // Law §1.16: "Place favor and secret tokens on any sites as shown by their
  // reveal prompts (2.8.2)." A FACEUP site starts with its prompt already
  // resolved; a facedown one resolves it when Travel turns it over (§5.6.2,
  // unit 9 — which did implement this, while setup never did). Only the
  // three opportunity sites carry any (Mine 3 favor, Salt Flats 2 favor +
  // 1 secret, Drowned City 3 secrets — RULINGS.md), and none of them is
  // faceup in FIRST_GAME, which is why nothing caught this until §4.1.4
  // needed the tokens to exist.
  //
  // §1.16's parenthetical ("if you don't have enough favor, the Chancellor
  // chooses how to place it") is not modelled: setup hands out at most 24
  // of the 36 favor before this point, and the three prompts total 5, so
  // the shortfall it covers cannot arise from any legal spec.
  const sites: SiteState[] = spec.sites.map((s) => {
    const reveal = (byId(s.id) as { reveal: { favor: number; secrets: number } }).reveal;
    return {
      id: s.id,
      region: s.region,
      facedown: s.facedown,
      cards: buildSiteSlots(s),
      relics: [...s.relics],
      warbands: Array.from({ length: seats }, () => 0),
      favor: s.facedown ? 0 : reveal.favor,
      secrets: s.facedown ? 0 : reveal.secrets,
    };
  });
  const siteFavor = sites.reduce((sum, s) => sum + s.favor, 0);
  const siteSecrets = sites.reduce((sum, s) => sum + s.secrets, 0);

  // Warband placement (Law §1.12): 2 on "the topmost FACEUP site in the
  // Cradle", 1 on each other faceup site with at least one denizen or
  // INTACT edifice. Both qualifiers only bite in a chronicle — a first
  // game has no facedown Cradle top and no ruins — which is why this read
  // as correct until unit 20's rules review.
  const topCradle = sites.find((s) => s.region === 'cradle' && !s.facedown);
  if (topCradle) topCradle.warbands[0] += 2;
  for (const s of sites) {
    if (s === topCradle || s.facedown) continue;
    // A ruined edifice has no suit and is not an "intact edifice" (§2.9).
    if (s.cards.some((c) => c !== null && !c.ruined)) s.warbands[0] += 1;
  }
  const placedOnMap = sites.reduce((sum, s) => sum + s.warbands[0], 0);

  // Law §1.15: "Each Exile places 3 warbands of their own color on their
  // board. Each Citizen places 3 PURPLE warbands on their board." A
  // Chronicled Citizen therefore draws from the Chancellor's 24 rather than
  // holding 14 of their own — which is also what D41's model requires, since
  // a Citizen's own-colour reserve is not tracked at all (if they are later
  // exiled, §6.7 hands them a fresh 14). Untested until unit 18, because
  // FIRST_GAME has no Citizens.
  //
  // §1.9 does hand every non-Chancellor "the 14 warbands... of the same
  // colour" before §1.15 sorts out what goes on the board, but for a Citizen
  // those 14 never enter play and nothing ever reads them.
  const citizenSeats = spec.citizenship.filter((c) => c === 'citizen').length;
  const CITIZEN_BOARD = 3;
  const players: PlayerState[] = spec.citizenship.map((citizenship, seat) => {
    const isChancellor = citizenship === 'chancellor';
    const isCitizen = citizenship === 'citizen';
    // The Chancellor's own 24 is what every Citizen's board comes out of.
    const totalWarbands = isChancellor
      ? CHANCELLOR_WARBANDS - citizenSeats * CITIZEN_BOARD
      : isCitizen
        ? CITIZEN_BOARD
        : EXILE_WARBANDS;
    const boardWarbands = 3; // Law §1.12 (chancellor), §1.15 (exile/citizen)
    const onMap = isChancellor ? placedOnMap : 0;
    return {
      citizenship,
      pawnSite: spec.startingPawnSite[seat], // Law §1.23
      hand: [],
      handDrawnAt: 0,
      advisers: [{ id: setup.startingAdviser[seat], facedown: true, favor: 0, secrets: 0 }],
      vision: null,
      favor: isChancellor ? 2 : 1, // Law §1.11 / §1.15
      secrets: { ready: 1, flipped: 0 }, // Law §1.11 / §1.15
      warbands: { bank: totalWarbands - boardWarbands - onMap, board: boardWarbands },
      supply: isChancellor ? CHANCELLOR_STARTING_SUPPLY : EXILE_STARTING_SUPPLY,
      relics: [],
    };
  });

  const favorBanks = Object.fromEntries(SUITS.map((s) => [s, favorBankSize(seats)])) as Record<
    Suit,
    number
  >;

  // Law §1.5 places one token on each. Law §1.13 then hands one of them to
  // the Chancellor, but only for two of the four goals: "If playing with
  // the Oathkeeper of Devotion goal, the Chancellor takes the Darkest
  // Secret. If playing with the Oathkeeper of the People goal, the
  // Chancellor takes the People's Favor." Supremacy and Protection grant
  // neither — which is why this went unnoticed until unit 18 needed seeded
  // games with other oaths: FIRST_GAME is a Supremacy game (§1.13/Playbook
  // p.8), so it exercises neither branch.
  const banners: BannerState[] = [
    { id: PEOPLES_FAVOR_ID, holder: spec.oath === 'people' ? 0 : null, tokens: 1, mob: false },
    { id: DARKEST_SECRET_ID, holder: spec.oath === 'devotion' ? 0 : null, tokens: 1 },
  ];

  const favorPlaced =
    Object.values(favorBanks).reduce((a, b) => a + b, 0) +
    players.reduce((a, p) => a + p.favor, 0) +
    siteFavor + // Law §1.16's reveal prompts on faceup sites
    1; // the People's Favor's starting token
  const sharedFavor = 36 - favorPlaced; // TOTAL_FAVOR, Law §1.4 (see state.ts)

  // Boxed secrets (Law §1.4: 20) minus the 1 on the Darkest Secret (§1.5)
  // and the 1 each player starts with (§1.11, §1.15). Not load-bearing —
  // §9.3 exempts secrets from component limits, so this can go negative in
  // play — but it keeps the count honest for display.
  const sharedSecrets = 20 - 1 - seats - siteSecrets; // §1.16's prompts too

  const state: OathState = {
    seats,
    oath: spec.oath,
    oathkeeper: 0, // Law §1.14: the chancellor takes the title at setup
    usurper: false,
    players,
    sites,
    favorBanks,
    sharedBank: { favor: sharedFavor, secrets: sharedSecrets },
    worldDeck: [...setup.worldDeck],
    relicDeck: [...setup.relicDeck],
    // Law §1.17: 4 randomly-drawn relics, one each onto the board's 4 FIXED
    // named spaces (§2.3; RULINGS.md) — `setup.reliquary`'s order is
    // already the shuffle's random order, so zipping it against the fixed
    // modifier enumeration assigns relics to spaces randomly without a
    // separate shuffle step.
    // §1.17 deals one relic onto each of the board's 4 fixed spaces (§2.3).
    // A chronicle can carry fewer than 4 loose relics, and §9.3 says take as
    // many as possible — a space with no relic is simply uncovered, which
    // makes its modifier usable at once (§7.1.1).
    reliquary: RELIQUARY_MODIFIERS.map(
      (modifier, i): ReliquarySpace => ({ modifier, relicId: setup.reliquary[i] ?? null }),
    ),
    grandScepter: 0, // Law §1.8: the chancellor always starts with it
    discards: {
      cradle: [...setup.discards.cradle],
      provinces: [...setup.discards.provinces],
      hinterland: [...setup.discards.hinterland],
    },
    dispossessed: [...spec.dispossessed],
    banners,
    visionsDrawn: setup.visionsDrawn, // Law §1.22
    turn: { activeSeat: 0, round: 1, turnStartedAt: 0 }, // Law §1.2, §4 (Chancellor goes first)
    campaign: null,
    citizenshipOffer: null,
    warbandRequest: null,
    wake: null, // seat 0's Wake Phase is started below, once the state exists
    titleChoice: null,
    actionCount: 0,
    complete: false,
    winner: null,
  };

  // Law §4.1: seat 0's turn begins immediately, and a turn begins with its
  // Wake Phase. Every other turn gets one from `turn.rest`; this one has no
  // rest before it. Deterministic — `beginWake` only moves favor the Law
  // forces, and leaves a pending decision when it does not.
  return beginWake(state, 0);
}

function buildSiteSlots(s: SetupSiteSpec): SiteState['cards'] {
  const card = byId(s.id);
  if (!('capacity' in card)) throw new Error(`setup: ${s.id} is not a site card`);
  const capacity = (card as { capacity: number }).capacity;
  if (s.denizens.length > capacity) {
    throw new Error(`setup: ${s.id} given ${s.denizens.length} denizens but capacity is ${capacity}`);
  }
  const slots: SiteState['cards'] = Array.from({ length: capacity }, () => null);
  const ruined = new Set(s.ruined ?? []);
  s.denizens.forEach((id, idx) => {
    slots[idx] = ruined.has(id) ? { id, ruined: true, favor: 0, secrets: 0 } : { id, favor: 0, secrets: 0 };
  });
  return slots;
}
