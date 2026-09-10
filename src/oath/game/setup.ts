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
import {
  CHANCELLOR_WARBANDS,
  DARKEST_SECRET_ID,
  EXILE_WARBANDS,
  LEFTMOST_SUPPLY,
  PEOPLES_FAVOR_ID,
  REGIONS,
  type BannerState,
  type Citizenship,
  type OathName,
  type OathState,
  type PlayerState,
  type Region,
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

// ---- OathSetup: spec + every resolved random outcome ---------------------

export interface OathSetup {
  spec: SetupSpec;
  /** Final world deck order after dealing (Law §1.19-1.21), top = index 0. */
  worldDeck: string[];
  /** One region-discard deal per Law §1.19, plus each seat's 2 discards (§1.23). */
  discards: Record<Region, string[]>;
  /** The card each seat kept as its first facedown adviser (Law §1.23). */
  startingAdviser: string[];
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
export function oathSetup(seats: number, options?: unknown): OathSetup {
  void options; // unit 18 will branch here on { seed: string }
  const spec = FIRST_GAME;
  if (seats !== spec.citizenship.length) {
    throw new IllegalAction(
      `oathSetup: the first game is fixed for ${spec.citizenship.length} seats, got ${seats} ` +
        `(no chronicle seed given — unit 18 adds seed-driven setups for other counts)`,
    );
  }

  // Deal the world pool (Law §1.19-1.21, §1.23): 1 card to each region's
  // discard, then each seat draws 3 from the bottom and keeps 1.
  const pool = shuffle(spec.worldPool);
  let i = 0;
  const discards: Record<Region, string[]> = { cradle: [], provinces: [], hinterland: [] };
  for (const region of REGIONS) discards[region].push(pool[i++]);

  const startingAdviser: string[] = [];
  for (let seat = 0; seat < seats; seat++) {
    const drawn = [pool[i++], pool[i++], pool[i++]];
    const [kept, ...rest] = drawn;
    startingAdviser.push(kept);
    const pawnSite = spec.startingPawnSite[seat];
    const pawnRegion = spec.sites.find((s) => s.id === pawnSite)!.region;
    const discardTo = discardRegion(pawnRegion); // Glossary "Discard"
    for (const id of rest) discards[discardTo].push(id);
  }
  const worldDeck = pool.slice(i);

  // Relic deck (Law §1.17-1.18): shuffle, then the first 4 go to the
  // Reliquary, the rest form the deck.
  const shuffledRelics = shuffle(spec.relicPool);
  const reliquary = shuffledRelics.slice(0, 4);
  const relicDeck = shuffledRelics.slice(4);

  return { spec, worldDeck, discards, startingAdviser, relicDeck, reliquary };
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

  const sites: SiteState[] = spec.sites.map((s) => ({
    id: s.id,
    region: s.region,
    facedown: s.facedown,
    cards: buildSiteSlots(s),
    relics: [...s.relics],
    warbands: Array.from({ length: seats }, () => 0),
    favor: 0,
    secrets: 0,
  }));

  // Warband placement (Law §1.12): 2 on the Cradle's topmost faceup site,
  // 1 on each other faceup site with at least one denizen/intact edifice.
  const cradleSites = sites.filter((s) => s.region === 'cradle');
  const topCradle = cradleSites[0];
  if (topCradle) topCradle.warbands[0] += 2;
  for (const s of sites) {
    if (s === topCradle) continue;
    if (!s.facedown && s.cards.some((c) => c !== null)) s.warbands[0] += 1;
  }
  const placedOnMap = sites.reduce((sum, s) => sum + s.warbands[0], 0);

  const players: PlayerState[] = spec.citizenship.map((citizenship, seat) => {
    const isChancellor = citizenship === 'chancellor';
    const totalWarbands = isChancellor ? CHANCELLOR_WARBANDS : EXILE_WARBANDS;
    const boardWarbands = 3; // Law §1.12 (chancellor), §1.15 (exile/citizen)
    const onMap = isChancellor ? placedOnMap : 0;
    return {
      citizenship,
      pawnSite: spec.startingPawnSite[seat], // Law §1.23
      hand: [],
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

  const banners: BannerState[] = [
    { id: PEOPLES_FAVOR_ID, holder: null, tokens: 1, mob: false }, // Law §1.5
    { id: DARKEST_SECRET_ID, holder: null, tokens: 1 }, // Law §1.5
  ];

  const favorPlaced =
    Object.values(favorBanks).reduce((a, b) => a + b, 0) +
    players.reduce((a, p) => a + p.favor, 0) +
    1; // the People's Favor's starting token
  const sharedFavor = 36 - favorPlaced; // TOTAL_FAVOR, Law §1.4 (see state.ts)

  return {
    seats,
    oath: spec.oath,
    oathkeeper: 0, // Law §1.14: the chancellor takes the title at setup
    usurper: false,
    players,
    sites,
    favorBanks,
    sharedBank: { favor: sharedFavor, secrets: 0 },
    worldDeck: [...setup.worldDeck],
    relicDeck: [...setup.relicDeck],
    reliquary: [...setup.reliquary],
    grandScepter: 0, // Law §1.8: the chancellor always starts with it
    discards: {
      cradle: [...setup.discards.cradle],
      provinces: [...setup.discards.provinces],
      hinterland: [...setup.discards.hinterland],
    },
    dispossessed: [...spec.dispossessed],
    banners,
    visionsDrawn: 0,
    turn: { activeSeat: 0, round: 1, turnStartedAt: 0 }, // Law §1.2, §4 (Chancellor goes first)
    campaign: null,
    actionCount: 0,
    complete: false,
    winner: null,
  };
}

function buildSiteSlots(s: SetupSiteSpec): SiteState['cards'] {
  const card = byId(s.id);
  if (!('capacity' in card)) throw new Error(`setup: ${s.id} is not a site card`);
  const capacity = (card as { capacity: number }).capacity;
  if (s.denizens.length > capacity) {
    throw new Error(`setup: ${s.id} given ${s.denizens.length} denizens but capacity is ${capacity}`);
  }
  const slots: SiteState['cards'] = Array.from({ length: capacity }, () => null);
  s.denizens.forEach((id, idx) => {
    slots[idx] = { id, favor: 0, secrets: 0 };
  });
  return slots;
}
