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
 * Sites currently never go from facedown to faceup within P2 (Travel's
 * reveal is unit 9), and relics at a site require a "Peek" minor action
 * neither the owner nor anyone else has by default (Law §6.5's minor
 * actions list "peek at relics at your site" as something you DO, not
 * something you already know) — so `siteRelics` redacts to a count for
 * every viewer, including the site's own ruler, until a peek action exists.
 */

import {
  REGIONS,
  type Adviser,
  type BannerState,
  type CampaignState,
  type CardInPlay,
  type CitizenshipOffer,
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
  pawnSite: string; // pawn location is public (visible on the board)
  hand: string[] | Redacted;
  advisers: AdviserView[];
  vision: string | null; // a Revealed Vision is faceup by definition (Law §2.2.1) — always public
  favor: number;
  secrets: PlayerState['secrets'];
  warbands: PlayerState['warbands'];
  supply: number;
  relics: string[]; // held relics are faceup once recovered (Law §5.4.3) — always public
}

interface CardInPlayView {
  id: string | null;
  ruined?: boolean;
  favor: number;
  secrets: number;
}

interface SiteView {
  id: string | null; // hidden while the site itself is facedown
  region: Region;
  facedown: boolean;
  cards: (CardInPlayView | null)[];
  relics: Redacted; // see file header: nobody sees identities without a peek action
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
  relicDeck: Redacted;
  reliquary: Redacted;
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
  campaign: CampaignState | null;
  /**
   * A pending Citizenship offer (unit 16; Law §6.6.1) is likewise public:
   * the exile must be told exactly which relic and terms are on the table
   * to decide, and the offerer already knows the Reliquary's contents
   * (Law §6.4 — the Grand Scepter lets its holder peek any relic there).
   */
  citizenshipOffer: CitizenshipOffer | null;
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
  };
}

function projectSite(s: SiteState): SiteView {
  // A denizen/edifice at a faceup site is a visible card on the table; at a
  // facedown site, nothing about its slots is known yet (Law §2.8: a
  // facedown site hasn't been revealed).
  const revealed = !s.facedown;
  return {
    id: revealed ? s.id : null,
    region: s.region,
    facedown: s.facedown,
    cards: s.cards.map((c) => (c ? projectCardInPlay(c, revealed) : null)),
    relics: { count: s.relics.length },
    warbands: [...s.warbands],
    favor: s.favor,
    secrets: s.secrets,
  };
}

export function project(state: OathState, seat: number | null): OathView {
  const discards = {} as Record<Region, Redacted>;
  for (const region of REGIONS) discards[region] = { count: state.discards[region].length };

  return {
    seats: state.seats,
    oath: state.oath,
    oathkeeper: state.oathkeeper,
    usurper: state.usurper,
    players: state.players.map((p, i) => projectPlayer(p, i === seat)),
    sites: state.sites.map(projectSite),
    favorBanks: { ...state.favorBanks },
    sharedBank: { ...state.sharedBank },
    worldDeck: {},
    relicDeck: { count: state.relicDeck.length },
    reliquary: { count: state.reliquary.length },
    grandScepter: state.grandScepter,
    discards,
    dispossessed: { count: state.dispossessed.length },
    banners: state.banners.map((b) => ({ ...b })),
    visionsDrawn: state.visionsDrawn,
    turn: { ...state.turn },
    campaign: state.campaign ? { ...state.campaign, targets: [...state.campaign.targets] } : null,
    citizenshipOffer: state.citizenshipOffer
      ? {
          ...state.citizenshipOffer,
          give: { ...state.citizenshipOffer.give, relics: [...state.citizenshipOffer.give.relics], banners: [...state.citizenshipOffer.give.banners] },
          take: { ...state.citizenshipOffer.take, relics: [...state.citizenshipOffer.take.relics], banners: [...state.citizenshipOffer.take.banners] },
        }
      : null,
    complete: state.complete,
    winner: state.winner,
  };
}
