/**
 * Redaction (unit 5). `project(state, seat)` builds the JSON a client at
 * `seat` (or a spectator, `seat === null`) is allowed to see. Hidden
 * information is enforced HERE, server-side — the client never sees the
 * raw state.
 *
 * The rulebook's public/private line (Law §9.4) is more specific than "own
 * cards visible, everything else redacted":
 *
 *   - PRIVATE: card fronts of cards in discard piles (identity only — the
 *     piles' sizes are explicitly public); the NUMBER OF CARDS in the world
 *     deck (not just its order — the count itself); card fronts of any
 *     facedown card (a facedown adviser, a facedown site, a facedown relic).
 *   - PUBLIC: everything else, including "the card backs and number of
 *     cards in discard piles, and the numbers of favor, secrets, and
 *     warbands on boards."
 *
 * So the world deck is the ONE zone whose size must never appear in a
 * projection — every other zone (relic deck, reliquary, dispossessed,
 * discards) shows a count with identities stripped. A player's own hand is
 * the exception inside PlayerView: Oath has no persistent hand (unit 1) —
 * it exists only mid-Search — but while non-empty it is exactly as private
 * to other seats as a facedown card, so it redacts to a count too.
 *
 * A facedown relic at a site (or in the Reliquary) needs its own "Peek"
 * minor action (Law §6.3/§6.4) — a viewer does not already know it just by
 * being at the site or holding the Scepter, the way they already know a
 * faceup card there. Unit 2 of P4 gives the SHAPE this needs — an ORDERED
 * array of `{ id: string | null }` slots per site (never a bare count:
 * unit 1 of P4 made `recover` positional, so a client has to be able to
 * point at "slot 1"), `id` non-null only for a viewer whose PlayerState
 * `peeked` set contains it, same rule for the Reliquary's `id` field —
 * with `peeked` empty for every seat until unit 3 builds the Peek family
 * that grants it. Until then this redacts to all-null for every viewer,
 * including the site's own ruler or the Scepter's own holder, which is
 * byte-for-byte the same information a bare count carried.
 */

import { battleTotals, type BattleTotals } from './actions/campaign.js';
import {
  REGIONS,
  type Adviser,
  type BannerState,
  type CampaignState,
  type CardInPlay,
  type CitizenshipOffer,
  type ReliquarySpace,
  type WarbandRequest,
  type ShroudedTravel,
  type OathState,
  type PlayerState,
  type Region,
  type SiteState,
} from './state.js';

interface Redacted {
  count: number;
}

interface AdviserView {
  id: string | null;
  facedown: boolean;
  favor: number;
  secrets: number;
}

interface PlayerView {
  citizenship: PlayerState['citizenship'];
  /**
   * Pawn location, public (it is a piece on the board). `null` only inside
   * Law §1.23.1's setup window, before this seat has placed it — P3 unit 8.
   */
  pawnSite: string | null;
  hand: string[] | Redacted;
  advisers: AdviserView[];
  vision: string | null; // a Revealed Vision is faceup by definition (Law §2.2.1) — always public
  favor: number;
  secrets: PlayerState['secrets'];
  warbands: PlayerState['warbands'];
  supply: number;
  relics: string[]; // held relics are faceup once recovered (Law §5.4.3) — always public
  /**
   * Your OWN standing responses (P3 unit 6), `null` for every other seat.
   *
   * Self-only, on the same footing as `hand`: a policy is not a game object
   * anyone can see on the table, and knowing that a rival has
   * `defense: 'close'` would tell you they will not use a battle plan
   * before you commit your dice. Its EFFECTS are public — a join window
   * that closes instantly is visible in the phase — but that is inference
   * from public facts, which is fine; handing over the policy itself is not.
   */
  standing: PlayerState['standing'] | null;
}

interface CardInPlayView {
  id: string | null;
  ruined?: boolean;
  favor: number;
  secrets: number;
}

/**
 * One facedown relic slot at a site (unit 2 of P4; Law §6.3). `id` is
 * non-null ONLY for a viewer whose `peeked` set contains it — ordered
 * (unit 1 of P4 made `recover` positional, so a client has to be able to
 * point at "slot 1"), and the slot count stays derivable as `.length`
 * rather than a redundant separate field.
 */
interface RelicSlotView {
  id: string | null;
}

interface SiteView {
  id: string | null; // hidden while the site itself is facedown
  region: Region;
  facedown: boolean;
  cards: (CardInPlayView | null)[];
  relics: RelicSlotView[];
  warbands: number[];
  favor: number;
  secrets: number;
}

export interface OathView {
  seats: number;
  oath: OathState['oath'];
  oathkeeper: number;
  usurper: boolean;
  players: PlayerView[];
  sites: SiteView[];
  favorBanks: OathState['favorBanks'];
  sharedBank: OathState['sharedBank'];
  worldDeck: Record<string, never>; // deliberately no size — see file header
  /**
   * A bare count, NEVER an array of slots, even after unit 2 gives sites
   * and the Reliquary their own peekable slots. §6.3/§6.4 grant peeking at
   * a SPECIFIC relic you already know is at a site or in the Reliquary,
   * not vision into the deck's order or contents — revealing anything more
   * than its size here would leak deck contents, which Law §9.4 makes
   * private (the world-deck-count rule, one card database over).
   */
  relicDeck: Redacted;
  /**
   * The 4 fixed named spaces (unit 16 follow-up; Law §2.3) are public board
   * facts, always visible — only WHICH relic (if any) currently covers a
   * space is hidden, same as any other facedown relic (Law §9.4). `id`
   * follows the same peeked-only rule as `SiteView.relics` (unit 2 of P4;
   * Law §6.4 — the Grand Scepter holder may peek any Reliquary relic).
   */
  reliquary: { modifier: ReliquarySpace['modifier']; covered: boolean; id: string | null }[];
  grandScepter: number;
  discards: Record<Region, Redacted>;
  dispossessed: Redacted;
  banners: BannerState[];
  visionsDrawn: number;
  turn: OathState['turn'];
  /**
   * A declared Campaign is entirely public (Law §9.4 lists nothing of it as
   * private: targets, committed dice counts, and rolled faces are all
   * things every player at the table can already see) — passed through
   * verbatim, unlike every hidden-zone field above.
   */
  /** The campaign, public in full (Law §9.4), plus its totals once rolled (unit 11). */
  campaign: (CampaignState & { battle: BattleTotals | null }) | null;
  /**
   * A pending Citizenship offer (unit 16; Law §6.6.1) is likewise public:
   * the exile must be told exactly which relic and terms are on the table
   * to decide, and the offerer already knows the Reliquary's contents
   * (Law §6.4 — the Grand Scepter lets its holder peek any relic there).
   */
  citizenshipOffer: CitizenshipOffer | null;
  /**
   * A pending warband permission (unit 16b; Law §6.5) is public: warband
   * counts are explicitly public (§9.4), and the approver has to see what
   * they are being asked to allow.
   */
  warbandRequest: WarbandRequest | null;
  /** Shrouded Wood's ruler choosing a traveller's destination (Law §11.7): public, like the pawns. */
  shroudedTravel: ShroudedTravel | null;
  complete: boolean;
  winner: number | null;
}

function projectAdviser(a: Adviser, revealed: boolean): AdviserView {
  return {
    id: revealed || !a.facedown ? a.id : null,
    facedown: a.facedown,
    favor: a.favor,
    secrets: a.secrets,
  };
}

function projectCardInPlay(c: CardInPlay, revealed: boolean): CardInPlayView {
  if (!revealed) return { id: null, favor: c.favor, secrets: c.secrets };
  const view: CardInPlayView = { id: c.id, favor: c.favor, secrets: c.secrets };
  if (c.ruined !== undefined) view.ruined = c.ruined;
  return view;
}

function projectPlayer(p: PlayerState, isSelf: boolean): PlayerView {
  return {
    citizenship: p.citizenship,
    pawnSite: p.pawnSite,
    hand: isSelf ? [...p.hand] : { count: p.hand.length },
    advisers: p.advisers.map((a) => projectAdviser(a, isSelf)),
    vision: p.vision, // always public
    favor: p.favor,
    secrets: { ...p.secrets },
    warbands: { ...p.warbands },
    supply: p.supply,
    relics: [...p.relics], // always public
    standing: isSelf ? { ...p.standing } : null, // self-only — see PlayerView
  };
}

function projectSite(s: SiteState, peeked: ReadonlySet<string>): SiteView {
  // A denizen/edifice at a faceup site is a visible card on the table; at a
  // facedown site, nothing about its slots is known yet (Law §2.8: a
  // facedown site hasn't been revealed).
  const revealed = !s.facedown;
  return {
    id: revealed ? s.id : null,
    region: s.region,
    facedown: s.facedown,
    cards: s.cards.map((c) => (c ? projectCardInPlay(c, revealed) : null)),
    relics: s.relics.map((id): RelicSlotView => ({ id: peeked.has(id) ? id : null })),
    warbands: [...s.warbands],
    favor: s.favor,
    secrets: s.secrets,
  };
}

export function project(state: OathState, seat: number | null): OathView {
  const discards = {} as Record<Region, Redacted>;
  for (const region of REGIONS) discards[region] = { count: state.discards[region].length };
  // A spectator (`seat === null`) has peeked at nothing — unit 2 of P4.
  const peeked = new Set(seat !== null ? state.players[seat].peeked : []);

  return {
    seats: state.seats,
    oath: state.oath,
    oathkeeper: state.oathkeeper,
    usurper: state.usurper,
    players: state.players.map((p, i) => projectPlayer(p, i === seat)),
    sites: state.sites.map((s) => projectSite(s, peeked)),
    favorBanks: { ...state.favorBanks },
    sharedBank: { ...state.sharedBank },
    worldDeck: {},
    relicDeck: { count: state.relicDeck.length },
    reliquary: state.reliquary.map((sp) => ({
      modifier: sp.modifier,
      covered: sp.relicId !== null,
      id: sp.relicId !== null && peeked.has(sp.relicId) ? sp.relicId : null,
    })),
    grandScepter: state.grandScepter,
    discards,
    dispossessed: { count: state.dispossessed.length },
    banners: state.banners.map((b) => ({ ...b })),
    visionsDrawn: state.visionsDrawn,
    turn: { ...state.turn },
    campaign: state.campaign
      ? {
          ...state.campaign,
          targets: [...state.campaign.targets],
          // The pending casualty allocation (unit 16a) is public like the
          // rest of a campaign — but copy it, or the view would alias live
          // state through the nested force array.
          ...(state.campaign.casualties
            ? { casualties: { ...state.campaign.casualties, force: [...state.campaign.casualties.force] } }
            : {}),
          // The engine's own totals for both sides, so no client re-adds them.
          battle: battleTotals(state, state.campaign),
        }
      : null,
    citizenshipOffer: state.citizenshipOffer
      ? {
          ...state.citizenshipOffer,
          give: { ...state.citizenshipOffer.give, relics: [...state.citizenshipOffer.give.relics], banners: [...state.citizenshipOffer.give.banners] },
          take: { ...state.citizenshipOffer.take, relics: [...state.citizenshipOffer.take.relics], banners: [...state.citizenshipOffer.take.banners] },
        }
      : null,
    warbandRequest: state.warbandRequest ? { ...state.warbandRequest } : null,
    shroudedTravel: state.shroudedTravel ? { ...state.shroudedTravel } : null,
    complete: state.complete,
    winner: state.winner,
  };
}
