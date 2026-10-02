/**
 * PURE page models (P4 unit 9). The pattern every later page follows: a
 * page's logic is a function from data to a plain object, and the template
 * that renders it is dumb enough that its own tests are only about escaping
 * and structure. Assertions go on the MODEL, here.
 */

import type { OathView } from '../oath/game/project.js';
import { findById } from '../oath/cards/index.js';
import { seatColors, seatTitle } from '../oath/game/seats.js';
import type { BattleTotals } from '../oath/game/actions/campaign.js';
import type { DefenseFace } from '../oath/game/state.js';


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
  /** "the Chancellor", "the Yellow Exile" — or "seat N" when no titles were given. */
  who: string;
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
  input: { gameId: string; waitingOnYou: InboxDecision[]; waitingOnOthers: InboxDecision[]; seatTitles?: string[] },
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
    waitingOnOthers: others.map((d) => ({
      seat: d.seat,
      who: input.seatTitles?.[d.seat] ? `the ${input.seatTitles[d.seat]}` : `seat ${d.seat}`,
      label: otherLabel(d.kind),
    })),
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
  /**
   * A Vision: its art is stored portrait with the text running sideways, but
   * the card is played landscape on the Revealed Vision space — so it is
   * drawn turned a quarter (unit 11, Ben).
   */
  landscape?: boolean;
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
  warbands: { seat: number; color: string; title: string; count: number }[];
  /** Pawns standing at this site, by seat. */
  pawns: { seat: number; color: string; title: string }[];
}

export interface RegionModel {
  region: string;
  label: string;
  sites: SiteModel[];
}

export interface AdviserModel {
  kind: 'face' | 'back';
  face?: FaceModel;
  /**
   * Facedown on the table. Your OWN facedown advisers still carry their face
   * (project() reveals them to you), but are drawn as a back like everyone
   * else sees them, with the face on hover — so you can tell which are down.
   */
  facedown: boolean;
  favor: number;
  secrets: number;
}

export interface PlayerAreaModel {
  seat: number;
  name: string;
  /** How the table names this seat: "Chancellor", "Yellow Exile", "Blue Citizen". */
  title: string;
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
  /** Who joined the defence as Allies (Law §5.5.2), by seat title. Public. */
  allies: string[];
  /** The defending force, part by part, in words ("the Chancellor's board 6 (Ally)"). Empty before the roll. */
  forceFrom: string[];
  /** Why the attack pool is not what was chosen, e.g. "3 chosen, −1 Mountain" (Law §11.4); null when unchanged. */
  attackDiceWhy: string | null;
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
   * Both sides' totals once rolled (null before), as the ENGINE computed
   * them (§5.5.4/§5.5.5) — shields plus the defending force for defense —
   * so the page shows the real numbers and adds nothing up itself.
   */
  battle: BattleTotals | null;
  /** A pending §5.5.6 casualty allocation: how many warbands must be killed. */
  casualtyQuota: number | null;
}

export interface BoardModel {
  gameId: string;
  seat: number | null;
  spectator: boolean;
  round: number;
  activeSeat: number;
  /** The oath this game is played under (Law §2.10's Goal Reference shows its goals). */
  oath: string;
  oathLabel: string;
  oathkeeper: number;
  usurper: boolean;
  visionsDrawn: number;
  complete: boolean;
  winner: number | null;
  /** How the table names each seat: "Chancellor", "Yellow Exile", "Blue Citizen" (seats.ts). */
  seatTitles: string[];
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
  /** The cards YOUR Search drew (Law §5.1), awaiting keep/discard — empty otherwise, and always empty for others. */
  hand: FaceModel[];
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
  return id.startsWith('vision:') ? { artKey, name: nameOfId(id), landscape: true } : { artKey, name: nameOfId(id) };
}

function siteModel(
  s: OathView['sites'][number],
  pawns: { seat: number; color: string; title: string }[],
  warbandColors: string[],
  titles: string[],
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
      // A seat's WARBANDS are purple once it is Imperial (Law §6.6.2), even
      // though its pawn keeps the seat's own colour (Ben, 2026-10-02).
      .map((count, seat) => ({ seat, color: warbandColors[seat] ?? 'red', title: titles[seat] ?? `seat ${seat}`, count }))
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
    title: string;
    siteName: (id: string) => string;
  },
): PlayerAreaModel {
  const titles: string[] = [];
  if (seat === meta.oathkeeper) titles.push(meta.usurper ? 'Usurper' : 'Oathkeeper');
  return {
    seat,
    name: meta.names[seat] ?? `seat ${seat}`,
    title: meta.title,
    color: meta.color,
    isYou: seat === meta.you,
    active: seat === meta.activeSeat,
    citizen: p.citizenship === 'citizen',
    chancellor: p.citizenship === 'chancellor',
    pawnSite: p.pawnSite !== null ? meta.siteName(p.pawnSite) : null,
    advisers: p.advisers.map((a): AdviserModel =>
      a.id !== null
        ? { kind: 'face', face: faceOf(a.id), facedown: a.facedown, favor: a.favor, secrets: a.secrets }
        : { kind: 'back', facedown: true, favor: a.favor, secrets: a.secrets },
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
  const titles = view.players.map((_, seat) => seatTitle(view.players, seat));
  // Warbands: purple for every Imperial seat (Chancellor and Citizens), the seat's own colour for an Exile.
  const warbandColors = view.players.map((p, seat) => (p.citizenship === 'exile' ? colors[seat] : 'purple'));

  // Which seats' pawns stand at each site (pawnSite is a site id, public).
  const pawnsBySite = new Map<string, { seat: number; color: string; title: string }[]>();
  view.players.forEach((p, seat) => {
    if (p.pawnSite === null) return;
    const list = pawnsBySite.get(p.pawnSite) ?? [];
    list.push({ seat, color: colors[seat] ?? 'red', title: titles[seat] });
    pawnsBySite.set(p.pawnSite, list);
  });

  const byRegion: RegionModel[] = [];
  for (const region of ['cradle', 'provinces', 'hinterland']) {
    const sites = view.sites
      .filter((s) => s.region === region)
      .map((s) => siteModel(s, s.id !== null ? (pawnsBySite.get(s.id) ?? []) : [], warbandColors, titles));
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
      title: titles[seat],
      siteName,
    }),
  );

  const campaign: CampaignModel | null = view.campaign
    ? {
        attacker: view.campaign.attackerSeat,
        defender: view.campaign.defenderSeat === 'bandits' ? 'the bandits' : seatTitle(view.players, view.campaign.defenderSeat),
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
        allies: (view.campaign.allies ?? []).map((s) => seatTitle(view.players, s)),
        forceFrom: (view.campaign.battle?.forceFrom ?? []).map((f) => {
          if (f.kind === 'bandits') return `${f.count} bandit${f.count === 1 ? '' : 's'}`;
          const who = `the ${seatTitle(view.players, f.seat)}`;
          const ally = (view.campaign!.allies ?? []).includes(f.seat) ? ' (Ally)' : '';
          const n = `${f.count} warband${f.count === 1 ? '' : 's'}`;
          return f.kind === 'board'
            ? `${n} on ${who}'s board${ally}`
            : `${n} of ${who}'s on ${siteName(f.siteId)}${ally}`;
        }),
        attackDiceWhy:
          view.campaign.attackDiceChosen !== undefined && view.campaign.attackDiceChanges?.length
            ? `${view.campaign.attackDiceChosen} chosen, ${view.campaign.attackDiceChanges.join(', ')}`
            : null,
        defenseDice: view.campaign.defenseDice,
        phase: view.campaign.phase,
        attackFaces: [...(view.campaign.attackFaces ?? [])],
        defenseFaces: [...(view.campaign.defenseFaces ?? [])],
        battle: view.campaign.battle,
        casualtyQuota: view.campaign.casualties?.quota ?? null,
      }
    : null;

  // project() hands a seat its own Search hand as ids, everyone else a count.
  const ownHand = meta.seat === null ? undefined : view.players[meta.seat]?.hand;
  const hand = Array.isArray(ownHand) ? ownHand.map((id) => faceOf(id)) : [];

  return {
    hand,
    seatTitles: titles,
    gameId: meta.gameId,
    seat: meta.seat,
    spectator: meta.seat === null,
    round: view.turn.round,
    activeSeat: view.turn.activeSeat,
    oath: view.oath,
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

/**
 * The seat's own resources that a dry run would change (unit 11): a diff of
 * the seat's player area between the board as it is and the board as the
 * dry run would leave it — both built from the SAME projected view the page
 * shows, so the preview can say nothing the board could not.
 */
export function ownChanges(before: BoardModel, after: BoardModel, seat: number): { what: string; before: string; after: string }[] {
  const a = before.players.find((p) => p.seat === seat);
  const b = after.players.find((p) => p.seat === seat);
  if (!a || !b) return [];
  const rows: [string, (p: PlayerAreaModel) => string | number | null][] = [
    ['Favor', (p) => p.favor],
    ['Secrets (ready)', (p) => p.secretsReady],
    ['Secrets (flipped)', (p) => p.secretsFlipped],
    ['Supply', (p) => p.supply],
    ['Warbands on your board', (p) => p.warbandsBoard],
    ['Warbands in your supply', (p) => p.warbandsBank],
    ['Pawn at', (p) => p.pawnSite],
    ['Advisers', (p) => p.advisers.length],
    ['Relics', (p) => p.relics.length],
  ];
  return rows
    .map(([what, get]) => ({ what, before: String(get(a) ?? '—'), after: String(get(b) ?? '—') }))
    .filter((r) => r.before !== r.after);
}
