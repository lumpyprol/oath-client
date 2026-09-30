/**
 * PURE page models (P4 unit 9). The pattern every later page follows: a
 * page's logic is a function from data to a plain object, and the template
 * that renders it is dumb enough that its own tests are only about escaping
 * and structure. Assertions go on the MODEL, here.
 */

import type { OathView } from '../oath/game/project.js';
import { findById } from '../oath/cards/index.js';
import { EXILE_COLORS } from '../oath/cards/art.js';
import { attackTotal } from '../oath/game/actions/campaign.js';
import type { DefenseFace } from '../oath/game/state.js';

/**
 * The shield half of Law §5.5.4's defense total: shields, doubleShields
 * counting 2, then doubled once per shieldX2. Deliberately NOT the whole
 * total — that also adds the defending force, which is server state the view
 * does not carry.
 */
function shieldTotal(faces: readonly DefenseFace[]): number {
  const shields = faces.filter((f) => f === 'shield').length;
  const doubles = faces.filter((f) => f === 'doubleShield').length;
  const doublings = faces.filter((f) => f === 'shieldX2').length;
  return (shields + doubles * 2) * 2 ** doublings;
}

/**
 * Seat → wooden-piece colour. The Chancellor is purple; every other seat
 * (Exile or Citizen) takes an Exile colour in seat order — a Citizen keeps
 * the colour it had as an Exile, so this stays stable as roles change.
 */
function seatColors(players: { citizenship: string }[]): string[] {
  let ex = 0;
  return players.map((p) => (p.citizenship === 'chancellor' ? 'purple' : EXILE_COLORS[ex++] ?? 'red'));
}

/** A pending decision as the inbox sees it — the engine's fields plus the HTTP layer's `since`/`url`. */
export interface InboxDecision {
  id: string;
  seat: number;
  kind: string;
  prompt: string;
  resolves: string[];
  since: string | null;
  url: string;
}

export interface InboxEntry {
  id: string;
  prompt: string;
  url: string;
  /** Human age from `since`, e.g. "3 days". */
  age: string;
}

export interface OtherEntry {
  seat: number;
  /** A non-leaky summary of what that seat is being waited on for. */
  label: string;
}

export interface InboxModel {
  empty: boolean;
  waitingOnYou: InboxEntry[];
  waitingOnOthers: OtherEntry[];
  boardUrl: string;
  historyUrl: string;
}

/** A relative age from an ISO timestamp, against a fixed `nowMs` so it is testable. */
export function humanizeAge(sinceIso: string | null, nowMs: number): string {
  if (sinceIso === null) return 'unknown';
  const then = Date.parse(sinceIso);
  if (Number.isNaN(then)) return 'unknown';
  const secs = Math.max(0, Math.floor((nowMs - then) / 1000));
  if (secs < 60) return 'just now';
  const units: [number, string][] = [
    [86400, 'day'],
    [3600, 'hour'],
    [60, 'minute'],
  ];
  for (const [size, name] of units) {
    if (secs >= size) {
      const n = Math.floor(secs / size);
      return `${n} ${name}${n === 1 ? '' : 's'}`;
    }
  }
  return 'just now';
}

/** A non-leaky, public label for another seat's pending decision — its kind, never its composable specifics. */
const KIND_LABEL: Record<string, string> = {
  turn: 'taking their turn',
  wake: 'resolving their Wake Phase',
  play: 'resolving a Search',
  campaign: 'in a Campaign',
  citizenshipOffer: 'answering a Citizenship offer',
  warbands: 'answering a warband request',
  oathkeeper: 'choosing the Oathkeeper',
  setup: 'setting up',
};

function otherLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}

/** Oldest-first: the decision that has waited longest comes first; unknown `since` sinks to the end. */
function byAgeOldestFirst(a: InboxDecision, b: InboxDecision): number {
  const ta = a.since === null ? Infinity : Date.parse(a.since);
  const tb = b.since === null ? Infinity : Date.parse(b.since);
  return ta - tb;
}

export function inboxModel(
  input: { gameId: string; waitingOnYou: InboxDecision[]; waitingOnOthers: InboxDecision[] },
  nowMs: number,
): InboxModel {
  const mine = [...input.waitingOnYou].sort(byAgeOldestFirst);
  const others = [...input.waitingOnOthers].sort((a, b) => a.seat - b.seat);
  return {
    empty: mine.length === 0,
    waitingOnYou: mine.map((d) => ({
      id: d.id,
      prompt: d.prompt,
      url: d.url,
      age: humanizeAge(d.since, nowMs),
    })),
    // Summarised by kind so a rival's composable specifics never appear.
    waitingOnOthers: others.map((d) => ({ seat: d.seat, label: otherLabel(d.kind) })),
    boardUrl: `/games/${input.gameId}`,
    historyUrl: `/games/${input.gameId}/history`,
  };
}

// ---------------------------------------------------------------------------
// The board (P4 unit 10). A PURE model of the whole table, built from
// project(state, seat) — so it can only ever carry what that seat is allowed
// to see. The template that renders it is dumb; the leak sweep runs on its
// HTML anyway, because a template is the easiest place to reintroduce a leak.
// ---------------------------------------------------------------------------


/** A card whose identity this viewer knows: its art key and display name. */
export interface FaceModel {
  artKey: string;
  name: string;
}

/** One denizen/edifice slot at a site. */
export type SiteCard =
  | { kind: 'face'; face: FaceModel; favor: number; secrets: number; ruined: boolean }
  | { kind: 'back'; favor: number; secrets: number } // a card at a facedown site
  | null; // an empty slot

/** One relic slot beside a site or in the Reliquary: named only where peeked. */
export type RelicSlot = { kind: 'face'; face: FaceModel } | { kind: 'back' };

export interface SiteModel {
  name: string; // "(unrevealed)" while facedown
  facedown: boolean;
  /** The site card's own face, for placing on its board slot; null while facedown. */
  face: FaceModel | null;
  favor: number;
  secrets: number;
  cards: SiteCard[];
  relics: RelicSlot[];
  /** Warbands present, by seat (with colour), only where non-zero. */
  warbands: { seat: number; color: string; count: number }[];
  /** Pawns standing at this site, by seat. */
  pawns: { seat: number; color: string }[];
}

export interface RegionModel {
  region: string;
  label: string;
  sites: SiteModel[];
}

export interface AdviserModel {
  kind: 'face' | 'back';
  face?: FaceModel;
  favor: number;
  secrets: number;
}

export interface PlayerAreaModel {
  seat: number;
  name: string;
  /** Seat colour (wooden pieces + board), e.g. "red". */
  color: string;
  isYou: boolean;
  active: boolean;
  citizen: boolean;
  chancellor: boolean;
  pawnSite: string | null; // display name of the site the pawn stands on
  advisers: AdviserModel[];
  vision: FaceModel | null;
  favor: number;
  secretsReady: number;
  secretsFlipped: number;
  warbandsBoard: number;
  warbandsBank: number;
  supply: number;
  relics: FaceModel[];
  /** Titles this seat holds, for the header line ("Oathkeeper", "Usurper"). */
  titles: string[];
}

export interface ReliquaryModel {
  modifier: string;
  label: string;
  covered: boolean;
  relic: FaceModel | null; // named only where peeked
}

export interface CampaignModel {
  attacker: number;
  defender: string; // seat number as text, or "bandits"
  targets: string[]; // human target descriptions, no hidden ids
  attackDice: number;
  defenseDice: number;
  /** Which window the campaign is in (Law §5.5): join, permit, respond, rolled, casualties. */
  phase: string;
  /**
   * Rolled faces, present only once the campaign reaches 'rolled'. Entirely
   * public — Law §9.4 lists nothing about a declared Campaign as private, and
   * the faces are dice sitting on the table for everyone to see.
   */
  attackFaces: string[];
  defenseFaces: string[];
  /**
   * What the faces alone say (§5.5.5/§5.5.4), or null before the roll. The
   * DEFENSE total also adds the defending force, which lives in server state
   * the view does not carry — so this reports the shield contribution only,
   * and never pretends to be the final number.
   */
  totals: { swords: number; skulls: number; shields: number } | null;
  /** A pending §5.5.6 casualty allocation: how many warbands must be killed. */
  casualtyQuota: number | null;
}

export interface BoardModel {
  gameId: string;
  seat: number | null;
  spectator: boolean;
  round: number;
  activeSeat: number;
  oathLabel: string;
  oathkeeper: number;
  usurper: boolean;
  visionsDrawn: number;
  complete: boolean;
  winner: number | null;
  regions: RegionModel[];
  players: PlayerAreaModel[];
  favorBanks: { suit: string; label: string; favor: number }[];
  sharedBank: { favor: number; secrets: number };
  reliquary: ReliquaryModel[];
  /** The two banner placards (Law §2.5): which face is up, who holds it, how many tokens. */
  banners: { name: string; face: FaceModel; holder: number | null; tokens: number; mob: boolean }[];
  /** Seat holding the Grand Scepter (Law §2.4) — always a seat, never unheld. */
  grandScepter: number;
  relicDeckCount: number;
  /** Facedown discard pile sizes by region — public (Law §9.4), identities are not. */
  discardCounts: { region: string; label: string; count: number }[];
  dispossessedCount: number;
  campaign: CampaignModel | null;
  citizenshipOffer: { scepterSeat: number; exile: number } | null;
  warbandRequest: { seat: number; approver: number; direction: string; count: number } | null;
  inboxUrl: string;
  historyUrl: string;
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

const OATH_LABEL: Record<string, string> = {
  supremacy: 'the Oath of Supremacy',
  people: 'the Oath of the People',
  devotion: 'the Oath of Devotion',
  protection: 'the Oath of Protection',
};

/**
 * A display name for an id the VIEWER ALREADY KNOWS. Every id reaching here
 * came out of the projection, so it is one this seat may see; the fallback is
 * a generic word, NEVER the id — emitting a raw `kind:slug` id is exactly the
 * leak the sweep hunts, so this helper must not be the thing that prints one.
 */
function nameOfId(id: string): string {
  return findById(id)?.name ?? 'a card';
}

function faceOf(id: string, artKey = id): FaceModel {
  return { artKey, name: nameOfId(id) };
}

function siteModel(
  s: OathView['sites'][number],
  pawns: { seat: number; color: string }[],
  colors: string[],
): SiteModel {
  return {
    name: s.id !== null ? nameOfId(s.id) : '(unrevealed)',
    facedown: s.facedown,
    face: s.id !== null ? faceOf(s.id) : null,
    favor: s.favor,
    secrets: s.secrets,
    cards: s.cards.map((c): SiteCard => {
      if (c === null) return null;
      if (c.id === null) return { kind: 'back', favor: c.favor, secrets: c.secrets };
      const artKey = c.ruined ? `${c.id}#ruin` : c.id;
      return { kind: 'face', face: faceOf(c.id, artKey), favor: c.favor, secrets: c.secrets, ruined: !!c.ruined };
    }),
    relics: s.relics.map((r): RelicSlot => (r.id !== null ? { kind: 'face', face: faceOf(r.id) } : { kind: 'back' })),
    warbands: s.warbands
      .map((count, seat) => ({ seat, color: colors[seat] ?? 'red', count }))
      .filter((w) => w.count > 0),
    pawns,
  };
}

function playerAreaModel(
  p: OathView['players'][number],
  seat: number,
  meta: {
    names: string[];
    you: number | null;
    oathkeeper: number;
    usurper: boolean;
    activeSeat: number;
    color: string;
    siteName: (id: string) => string;
  },
): PlayerAreaModel {
  const titles: string[] = [];
  if (seat === meta.oathkeeper) titles.push(meta.usurper ? 'Usurper' : 'Oathkeeper');
  return {
    seat,
    name: meta.names[seat] ?? `seat ${seat}`,
    color: meta.color,
    isYou: seat === meta.you,
    active: seat === meta.activeSeat,
    citizen: p.citizenship === 'citizen',
    chancellor: p.citizenship === 'chancellor',
    pawnSite: p.pawnSite !== null ? meta.siteName(p.pawnSite) : null,
    advisers: p.advisers.map((a): AdviserModel =>
      a.id !== null
        ? { kind: 'face', face: faceOf(a.id), favor: a.favor, secrets: a.secrets }
        : { kind: 'back', favor: a.favor, secrets: a.secrets },
    ),
    vision: p.vision !== null ? faceOf(p.vision) : null,
    favor: p.favor,
    secretsReady: p.secrets.ready,
    secretsFlipped: p.secrets.flipped,
    warbandsBoard: p.warbands.board,
    warbandsBank: p.warbands.bank,
    supply: p.supply,
    relics: p.relics.map((id) => faceOf(id)),
    titles,
  };
}

export function boardModel(view: OathView, meta: { gameId: string; seat: number | null; names: string[] }): BoardModel {
  // Site display names by id, for pawns and campaign targets — only faceup
  // sites have a non-null id, which is exactly the set a pawn can stand on.
  const siteNameById = new Map<string, string>();
  for (const s of view.sites) if (s.id !== null) siteNameById.set(s.id, nameOfId(s.id));
  const siteName = (id: string) => siteNameById.get(id) ?? '(unrevealed)';
  const colors = seatColors(view.players);

  // Which seats' pawns stand at each site (pawnSite is a site id, public).
  const pawnsBySite = new Map<string, { seat: number; color: string }[]>();
  view.players.forEach((p, seat) => {
    if (p.pawnSite === null) return;
    const list = pawnsBySite.get(p.pawnSite) ?? [];
    list.push({ seat, color: colors[seat] ?? 'red' });
    pawnsBySite.set(p.pawnSite, list);
  });

  const byRegion: RegionModel[] = [];
  for (const region of ['cradle', 'provinces', 'hinterland']) {
    const sites = view.sites
      .filter((s) => s.region === region)
      .map((s) => siteModel(s, s.id !== null ? (pawnsBySite.get(s.id) ?? []) : [], colors));
    byRegion.push({ region, label: cap(region), sites });
  }

  const players = view.players.map((p, seat) =>
    playerAreaModel(p, seat, {
      names: meta.names,
      you: meta.seat,
      oathkeeper: view.oathkeeper,
      usurper: view.usurper,
      activeSeat: view.turn.activeSeat,
      color: colors[seat] ?? 'red',
      siteName,
    }),
  );

  const campaign: CampaignModel | null = view.campaign
    ? {
        attacker: view.campaign.attackerSeat,
        defender: view.campaign.defenderSeat === 'bandits' ? 'bandits' : `seat ${view.campaign.defenderSeat}`,
        targets: view.campaign.targets.map((t) => {
          switch (t.kind) {
            case 'site':
              return siteName(t.siteId);
            case 'pawnFavor':
              return "the defender's pawn (favor)";
            case 'banner':
              return nameOfId(t.bannerId);
            case 'relic':
              return nameOfId(t.relicId);
            case 'scepter':
              return 'the Grand Scepter';
          }
        }),
        attackDice: view.campaign.attackDice,
        defenseDice: view.campaign.defenseDice,
        phase: view.campaign.phase,
        attackFaces: [...(view.campaign.attackFaces ?? [])],
        defenseFaces: [...(view.campaign.defenseFaces ?? [])],
        totals: view.campaign.attackFaces && view.campaign.defenseFaces
          ? {
              ...attackTotal(view.campaign.attackFaces),
              shields: shieldTotal(view.campaign.defenseFaces),
            }
          : null,
        casualtyQuota: view.campaign.casualties?.quota ?? null,
      }
    : null;

  return {
    gameId: meta.gameId,
    seat: meta.seat,
    spectator: meta.seat === null,
    round: view.turn.round,
    activeSeat: view.turn.activeSeat,
    oathLabel: OATH_LABEL[view.oath] ?? view.oath,
    oathkeeper: view.oathkeeper,
    usurper: view.usurper,
    visionsDrawn: view.visionsDrawn,
    complete: view.complete,
    winner: view.winner,
    regions: byRegion,
    players,
    favorBanks: Object.entries(view.favorBanks).map(([suit, favor]) => ({ suit, label: cap(suit), favor })),
    sharedBank: { ...view.sharedBank },
    reliquary: view.reliquary.map((sp) => ({
      modifier: sp.modifier,
      label: cap(sp.modifier),
      covered: sp.covered,
      relic: sp.id !== null ? faceOf(sp.id) : null,
    })),
    // A two-faced banner shows face #1 when flipped (the People's Favor's Mob
    // side, Law §2.5.3); the art manifest keys that as `${id}#1`.
    banners: view.banners.map((b) => ({
      name: nameOfId(b.id),
      face: faceOf(b.id, b.mob ? `${b.id}#1` : b.id),
      holder: b.holder,
      tokens: b.tokens,
      mob: !!b.mob,
    })),
    grandScepter: view.grandScepter,
    relicDeckCount: view.relicDeck.count,
    discardCounts: ['cradle', 'provinces', 'hinterland'].map((region) => ({
      region,
      label: cap(region),
      count: view.discards[region as keyof typeof view.discards]?.count ?? 0,
    })),
    dispossessedCount: view.dispossessed.count,
    campaign,
    citizenshipOffer: view.citizenshipOffer
      ? { scepterSeat: view.citizenshipOffer.scepterSeat, exile: view.citizenshipOffer.exile }
      : null,
    warbandRequest: view.warbandRequest
      ? {
          seat: view.warbandRequest.seat,
          approver: view.warbandRequest.approver,
          direction: view.warbandRequest.direction,
          count: view.warbandRequest.count,
        }
      : null,
    inboxUrl: '/',
    historyUrl: `/games/${meta.gameId}/history`,
  };
}
