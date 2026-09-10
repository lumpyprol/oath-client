/**
 * The Oath game state: plain TypeScript types (no zod — HLD D32) plus
 * `checkInvariants`, the safety net every test runs after every reduce.
 *
 * States are plain JSON-serializable data: no Map, Set, class instances, or
 * undefined in arrays; null marks empty slots. Snapshots of this shape are
 * disposable — the action log is the source of truth.
 *
 * Rulebook citations ("Law §x.y") reference the Law of Oath as reproduced at
 * https://rules.buriedgiant.com/?product=oath&locale=en-US&printing=p1
 * (numbering identical to the Law of Oath, Oct 20, 2020). See RULINGS.md.
 */

import { findById, byId } from '../cards/index.js';
import { SUITS, type Suit } from '../cards/schema.js';

// ---- rulebook totals (CONSTANTS) ----------------------------------------

/**
 * Favor tokens in the whole game (Law §1.4). Favor is component-limited
 * (Law §9.3) and burns return it to the shared bank (Glossary "Burn"), so
 * the total across every zone is conserved.
 */
export const TOTAL_FAVOR = 36;

/**
 * Secret tokens in the box (Law §1.4). Informational only: secrets are NOT
 * component-limited (Law §9.3), so there is no conservation law for them.
 */
export const BOXED_SECRETS = 20;

/**
 * The Chancellor's purple warbands (Law §1.8). Citizens draw from the same
 * purple pool (Law §1.15), and killed purple warbands return to the
 * Chancellor (Glossary "Kill"), so purple is conserved across all Imperial
 * seats together.
 */
export const CHANCELLOR_WARBANDS = 24;

/** Warbands of each non-Chancellor color (Law §1.9), conserved per seat. */
export const EXILE_WARBANDS = 14;

/** Advisers per player, faceup or facedown, Visions included (Law §2.2.2). */
export const ADVISER_LIMIT = 3;

/**
 * The leftmost (maximum) Supply-track space, both seats (Law §1.10 setup;
 * §6.6.2/§6.7/§6.8 name it directly as a citizenship-transition refresh
 * target; RULINGS.md has the full derivation — neither board prints this
 * number directly).
 */
export const LEFTMOST_SUPPLY = 7;

/** The two banner placards (Law §2.5); both ids must exist in the card db. */
export const PEOPLES_FAVOR_ID = 'banner:peoples-favor';
export const DARKEST_SECRET_ID = 'banner:darkest-secret';
byId(PEOPLES_FAVOR_ID);
byId(DARKEST_SECRET_ID);

// ---- types --------------------------------------------------------------

/**
 * The three regions (Law §2.1.1). Geometry (site counts, travel costs)
 * lands in map.ts in unit 2; only the type lives here.
 */
export type Region = 'cradle' | 'provinces' | 'hinterland';
export const REGIONS: readonly Region[] = ['cradle', 'provinces', 'hinterland'];

/** Seat 0 is always the Chancellor (convention; seating per Law §1.7). */
export type Citizenship = 'chancellor' | 'exile' | 'citizen';

/** The four Oathkeeper goals (Law §2.11). */
export type OathName = 'supremacy' | 'people' | 'devotion' | 'protection';

/** A denizen or edifice card in play at a site, or a card-shaped adviser. */
export interface CardInPlay {
  id: string;
  /** Edifice showing its ruin face (Law §2.9). */
  ruined?: boolean;
  /**
   * Tokens resting on the card, placed by Muster/Trade and powers; returned
   * at Rest (Law §4.3) or on discard (Glossary "Discard").
   */
  favor: number;
  secrets: number;
}

/** An adviser: faceup/facedown denizen or facedown Vision (Law §2.2.2). */
export interface Adviser extends CardInPlay {
  facedown: boolean;
}

export interface SiteState {
  id: string;
  region: Region;
  /** Facedown/undiscovered; flipped faceup by Travel (Law §5.6). */
  facedown: boolean;
  /**
   * Denizen/edifice slots. Fixed length === the site card's capacity
   * (Law §2.8.1); null entries are empty slots.
   */
  cards: (CardInPlay | null)[];
  /** Facedown relics next to the site (Law §2.8.2). */
  relics: string[];
  /**
   * Warbands by seat index. The Chancellor's and Citizens' entries are
   * physically purple (Law §1.15); attribution by seat is bookkeeping.
   */
  warbands: number[];
  /** Reveal-prompt tokens on the site itself (Law §1.16, §2.8.2). */
  favor: number;
  secrets: number;
}

export interface PlayerState {
  citizenship: Citizenship;
  /**
   * The site this seat's pawn is at (Law §1.23, §5.6). Always a real site
   * id — every pawn starts on a faceup site and Travel only ever moves it
   * to another site. "Your site" / "your region" in the rules resolve
   * through this (unit 6+).
   */
  pawnSite: string;
  /**
   * Transient Search hand (Law §5.1): cards drawn and awaiting keep/discard.
   * Empty outside a Search — Oath has no persistent hand.
   */
  hand: string[];
  /**
   * `actionCount` when `hand` was last drawn (unit 10). Meaningless while
   * `hand` is empty; while non-empty it stamps the pending 'play'
   * decision's id, per the shared decision-id convention.
   */
  handDrawnAt: number;
  advisers: Adviser[];
  /** Faceup Vision on the Exile board's Revealed Vision space (Law §2.2.1). */
  vision: string | null;
  favor: number;
  /** Spent secrets flip facedown and flip up again at Rest (Law §4.3). */
  secrets: { ready: number; flipped: number };
  /**
   * bank: the personal-bank reserve (Law §2.2.3, Supply refresh reads it);
   * board: the mobile force that travels with the pawn (Law §2.2.1).
   */
  warbands: { bank: number; board: number };
  /** The action currency (Law §4.2). */
  supply: number;
  /** Relics held in the personal bank (Law §2.2.3). */
  relics: string[];
}

export interface BannerState {
  id: string; // PEOPLES_FAVOR_ID or DARKEST_SECRET_ID
  /** Seat holding the banner, or null while it sits by the shared bank. */
  holder: number | null;
  /** Favor on the People's Favor / secrets on the Darkest Secret (Law §2.5). */
  tokens: number;
  /** The People's Favor flipped to its Mob side (Law §2.5.3). */
  mob?: boolean;
}

/** Placeholder — unit 12 defines the campaign sub-state. Null until then. */
export type CampaignState = never;

export interface OathState {
  /** 2..6 seats; seat 0 is the Chancellor. */
  seats: number;
  oath: OathName;
  /** Seat holding the Oathkeeper title (Law §2.11). */
  oathkeeper: number;
  /** Title flipped to its Usurper side (Law §2.11). */
  usurper: boolean;
  players: PlayerState[];
  /** Ordered as on the board: Cradle, Provinces, Hinterland (Law §1.1). */
  sites: SiteState[];
  favorBanks: Record<Suit, number>; // Law §2.1.3
  /** Undistributed tokens (Law §2.1.7); burns land here (Glossary "Burn"). */
  sharedBank: { favor: number; secrets: number };
  /** Index 0 = top. Setup deals from the bottom (Law §1.19–1.20). */
  worldDeck: string[];
  relicDeck: string[];
  /** The Imperial Reliquary's facedown relics (Law §2.3). */
  reliquary: string[];
  /**
   * Seat holding the Grand Scepter (Law §2.4). The Scepter is not in the
   * card database, so only its holder is tracked.
   */
  grandScepter: number;
  /** One facedown discard pile per region (Law §2.1.2); index 0 = top. */
  discards: Record<Region, string[]>;
  /** Cards removed from the world between games (Law §8). */
  dispossessed: string[];
  banners: BannerState[];
  visionsDrawn: number; // Law §2.1.6
  turn: {
    activeSeat: number;
    round: number; // round track: Law §2.1.4
    /**
     * `actionCount` at the moment this became `activeSeat`'s turn (unit 5).
     * The 'turn' pending decision's id is `` `turn:${activeSeat}:${turnStartedAt}` ``
     * — stable across every action taken within the turn (actionCount keeps
     * climbing but this doesn't), and changes the instant the turn passes,
     * per the pending-decision-id convention every unit shares.
     */
    turnStartedAt: number;
  };
  campaign: CampaignState | null;
  /** Incremented by every reduce; pending-decision ids derive from it. */
  actionCount: number;
  complete: boolean;
  winner: number | null;
}

// ---- invariant checker --------------------------------------------------

class InvariantViolation extends Error {
  constructor(message: string) {
    super(`invariant: ${message}`);
    this.name = 'InvariantViolation';
  }
}

const fail = (message: string): never => {
  throw new InvariantViolation(message);
};

/** Card-id prefixes legal in each zone family. */
const DRAWABLE = ['denizen:', 'vision:'];
const SITE_SLOT = ['denizen:', 'edifice:'];

/**
 * Throws with a specific message on the first violated invariant. Run after
 * every reduce in every test (HLD D32).
 */
export function checkInvariants(state: OathState): void {
  const { seats, players, sites } = state;

  // -- shape ---------------------------------------------------------------
  if (!Number.isInteger(seats) || seats < 2 || seats > 6) {
    fail(`seats must be 2..6, got ${seats}`);
  }
  if (players.length !== seats) {
    fail(`players has ${players.length} entries for ${seats} seats`);
  }
  const seatOk = (n: number, what: string) => {
    if (!Number.isInteger(n) || n < 0 || n >= seats) {
      fail(`${what} is ${n}, not a seat (0..${seats - 1})`);
    }
  };
  seatOk(state.oathkeeper, 'oathkeeper');
  seatOk(state.grandScepter, 'grandScepter holder');
  seatOk(state.turn.activeSeat, 'turn.activeSeat');
  if (state.winner !== null) {
    seatOk(state.winner, 'winner');
    if (!state.complete) fail('winner is set but the game is not complete');
  }
  if (state.actionCount < 0) fail('actionCount is negative');
  if (state.turn.turnStartedAt < 0 || state.turn.turnStartedAt > state.actionCount) {
    fail(
      `turn.turnStartedAt (${state.turn.turnStartedAt}) must be between 0 and ` +
        `actionCount (${state.actionCount})`,
    );
  }
  players.forEach((p, i) => {
    if (p.handDrawnAt < 0 || p.handDrawnAt > state.actionCount) {
      fail(`players[${i}].handDrawnAt (${p.handDrawnAt}) must be between 0 and actionCount`);
    }
  });

  // -- citizenship (Law §1.7–1.8; seat-0 convention) -----------------------
  const chancellors = players
    .map((p, i) => (p.citizenship === 'chancellor' ? i : -1))
    .filter((i) => i >= 0);
  if (chancellors.length !== 1) {
    fail(
      `exactly one chancellor required, found ${chancellors.length} ` +
        `(seats ${JSON.stringify(chancellors)})`,
    );
  }
  if (chancellors[0] !== 0) {
    fail(`the chancellor must be seat 0, found seat ${chancellors[0]}`);
  }

  // -- non-negative counts -------------------------------------------------
  const nonneg = (n: number, what: string) => {
    if (!Number.isInteger(n) || n < 0) fail(`${what} is negative or fractional: ${n}`);
  };
  for (const suit of SUITS) nonneg(state.favorBanks[suit], `favorBanks.${suit}`);
  nonneg(state.sharedBank.favor, 'sharedBank.favor');
  nonneg(state.sharedBank.secrets, 'sharedBank.secrets');
  nonneg(state.visionsDrawn, 'visionsDrawn');
  players.forEach((p, i) => {
    nonneg(p.favor, `players[${i}].favor`);
    nonneg(p.secrets.ready, `players[${i}].secrets.ready`);
    nonneg(p.secrets.flipped, `players[${i}].secrets.flipped`);
    nonneg(p.warbands.bank, `players[${i}].warbands.bank`);
    nonneg(p.warbands.board, `players[${i}].warbands.board`);
    nonneg(p.supply, `players[${i}].supply`);
  });
  sites.forEach((s, i) => {
    nonneg(s.favor, `sites[${i}].favor`);
    nonneg(s.secrets, `sites[${i}].secrets`);
    if (s.warbands.length !== seats) {
      fail(`sites[${i}].warbands has ${s.warbands.length} entries for ${seats} seats`);
    }
    s.warbands.forEach((w, seat) => nonneg(w, `sites[${i}].warbands[${seat}]`));
    for (const c of s.cards) {
      if (c) {
        nonneg(c.favor, `favor on ${c.id}`);
        nonneg(c.secrets, `secrets on ${c.id}`);
      }
    }
  });
  state.banners.forEach((b) => nonneg(b.tokens, `tokens on ${b.id}`));

  // -- every card id in exactly one zone, and in the P1 database -----------
  const zones = new Map<string, string[]>();
  const seen = (id: string, zone: string, prefixes: readonly string[]) => {
    if (!findById(id)) fail(`card ${id} (in ${zone}) is not in the card database`);
    if (!prefixes.some((p) => id.startsWith(p))) {
      fail(`card ${id} cannot be in ${zone} (allowed: ${prefixes.join(', ')})`);
    }
    const list = zones.get(id);
    if (list) list.push(zone);
    else zones.set(id, [zone]);
  };

  state.worldDeck.forEach((id, i) => seen(id, `worldDeck[${i}]`, DRAWABLE));
  for (const region of REGIONS) {
    state.discards[region].forEach((id, i) =>
      seen(id, `discards.${region}[${i}]`, DRAWABLE),
    );
  }
  state.dispossessed.forEach((id, i) => seen(id, `dispossessed[${i}]`, DRAWABLE));
  state.relicDeck.forEach((id, i) => seen(id, `relicDeck[${i}]`, ['relic:']));
  state.reliquary.forEach((id, i) => seen(id, `reliquary[${i}]`, ['relic:']));

  sites.forEach((s, i) => {
    seen(s.id, `sites[${i}]`, ['site:']);
    s.cards.forEach((c, j) => {
      if (c) seen(c.id, `sites[${i}].cards[${j}]`, SITE_SLOT);
    });
    s.relics.forEach((id, j) => seen(id, `sites[${i}].relics[${j}]`, ['relic:']));
  });

  const siteIds = new Set(sites.map((s) => s.id));
  players.forEach((p, i) => {
    if (!siteIds.has(p.pawnSite)) {
      fail(`players[${i}].pawnSite (${p.pawnSite}) is not a site on the map`);
    }
    p.hand.forEach((id, j) => seen(id, `players[${i}].hand[${j}]`, DRAWABLE));
    p.advisers.forEach((a, j) =>
      seen(a.id, `players[${i}].advisers[${j}]`, DRAWABLE),
    );
    if (p.vision !== null) seen(p.vision, `players[${i}].vision`, ['vision:']);
    p.relics.forEach((id, j) => seen(id, `players[${i}].relics[${j}]`, ['relic:']));
  });

  state.banners.forEach((b, i) => seen(b.id, `banners[${i}]`, ['banner:']));

  for (const [id, where] of zones) {
    if (where.length > 1) {
      fail(`card ${id} appears in more than one zone: ${where.join(', ')}`);
    }
  }

  // -- banners: exactly the two placards (Law §1.4, §2.5) ------------------
  const bannerIds = state.banners.map((b) => b.id).sort();
  const expected = [DARKEST_SECRET_ID, PEOPLES_FAVOR_ID].sort();
  if (JSON.stringify(bannerIds) !== JSON.stringify(expected)) {
    fail(`banners must be exactly ${expected.join(' and ')}, got ${bannerIds.join(', ')}`);
  }
  for (const b of state.banners) {
    if (b.holder !== null) seatOk(b.holder, `holder of ${b.id}`);
  }

  // -- site slots respect capacity (Law §2.8.1) ----------------------------
  for (const s of sites) {
    const card = byId(s.id);
    if (!('capacity' in card)) fail(`${s.id} is not a site card`);
    const capacity = (card as { capacity: number }).capacity;
    if (s.cards.length !== capacity) {
      fail(
        `site ${s.id} has ${s.cards.length} card slots but its capacity is ` +
          `${capacity} (Law §2.8.1)`,
      );
    }
  }

  // -- adviser limit (Law §2.2.2) ------------------------------------------
  players.forEach((p, i) => {
    if (p.advisers.length > ADVISER_LIMIT) {
      fail(
        `players[${i}] has ${p.advisers.length} advisers; the limit is ` +
          `${ADVISER_LIMIT} (Law §2.2.2)`,
      );
    }
  });

  // -- warband conservation (Law §1.8, §1.9, §1.15; Glossary "Kill") -------
  // (+ campaign-committed warbands once unit 12 adds them)
  const onMap = (seat: number) =>
    sites.reduce((sum, s) => sum + s.warbands[seat], 0);
  const held = (seat: number) =>
    players[seat].warbands.bank + players[seat].warbands.board;

  let purple = 0;
  players.forEach((p, seat) => {
    const total = held(seat) + onMap(seat);
    if (p.citizenship === 'exile') {
      if (total !== EXILE_WARBANDS) {
        fail(
          `warband conservation: seat ${seat} (exile) has ${total}, ` +
            `expected ${EXILE_WARBANDS} (Law §1.9)`,
        );
      }
    } else {
      purple += total;
    }
  });
  if (purple !== CHANCELLOR_WARBANDS) {
    fail(
      `warband conservation: Imperial seats hold ${purple} purple warbands, ` +
        `expected ${CHANCELLOR_WARBANDS} (Law §1.8, §1.15)`,
    );
  }

  // -- favor conservation (Law §1.4, §9.3) ---------------------------------
  let favor = state.sharedBank.favor;
  for (const suit of SUITS) favor += state.favorBanks[suit];
  for (const p of players) {
    favor += p.favor;
    for (const a of p.advisers) favor += a.favor;
  }
  for (const s of sites) {
    favor += s.favor;
    for (const c of s.cards) if (c) favor += c.favor;
  }
  for (const b of state.banners) {
    if (b.id === PEOPLES_FAVOR_ID) favor += b.tokens;
  }
  if (favor !== TOTAL_FAVOR) {
    fail(
      `favor conservation: ${favor} favor across bank, banks, boards, ` +
        `banners, sites, and cards; expected ${TOTAL_FAVOR} (Law §1.4)`,
    );
  }
  // Secrets are deliberately not conserved: Law §9.3 exempts them from
  // component limits, so their total may exceed BOXED_SECRETS.
}
