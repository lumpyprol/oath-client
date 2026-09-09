import {
  parseOathTTSSavefileString,
  serializeOathGame,
} from './vendor/parser.js';
import type { OathGame } from './vendor/oathgame.js';
import { CardName, CardNameIndexes } from './vendor/names.cards.js';
import { SiteNameIndexes } from './vendor/names.sites.js';
import type { PlayerCitizenship, PlayerColor, Suit as VendorSuit } from './vendor/enums.js';
import { byId, bySaveId, cards } from '../cards/index.js';
import {
  SUITS,
  SUIT_INDEX,
  type Card,
  type EdificeRuin,
  type Suit,
} from '../cards/schema.js';

function isEdifice(card: Card): card is EdificeRuin {
  return card.id.startsWith('edifice:');
}

export interface SeedCard {
  id: string;
  faceDown?: boolean;
  /** True when the seed references an edifice's ruin face. */
  ruined?: boolean;
}

export interface SeedSite {
  /** null for an empty ("NONE") site slot. */
  id: string | null;
  /** The site is face-down (the seed format's `saveId + 24`). */
  ruined: boolean;
  /** Always length 3; null entries are empty slots. */
  cards: (SeedCard | null)[];
}

export interface ParsedSeed {
  version: { major: string; minor: string; patch: string };
  gameCount: number;
  chronicleName: string;
  /** The Oath, named by the vendored parser's `Oath` enum (e.g. "People"). */
  oath: string;
  suitOrder: Suit[];
  winner: PlayerColor | undefined;
  playerCitizenship: PlayerCitizenship;
  prevPlayerCitizenship: PlayerCitizenship | undefined;
  sites: SeedSite[];
  world: SeedCard[];
  dispossessed: SeedCard[];
  relics: SeedCard[];
}

const NONE_BYTE = 255;

// ---- site name resolution (site collection only) ------------------------

const siteByNameIndex = new Map<string, Card>();
for (const s of cards.sites) {
  siteByNameIndex.set(s.name.toLowerCase(), s);
  for (const alias of s.aliases ?? []) siteByNameIndex.set(alias.toLowerCase(), s);
}

/** Resolve a parser site name to our site id, or null for an empty slot. */
function siteId(name: string | undefined, where: string): string | null {
  if (typeof name !== 'string') {
    throw new Error(`parseSeed: unrecognized site byte at ${where}`);
  }
  if (name === 'NONE') return null;
  const site = siteByNameIndex.get(name.toLowerCase());
  if (!site) throw new Error(`parseSeed: unknown site ${JSON.stringify(name)} at ${where}`);
  return site.id;
}

// ---- card <-> byte -----------------------------------------------------

function cardByByte(byte: number, name: string, where: string): Card {
  try {
    return bySaveId('card', byte);
  } catch {
    throw new Error(
      `parseSeed: card byte ${byte} (${JSON.stringify(name)}) at ${where} is not in the card data`,
    );
  }
}

/** A parser card name -> SeedCard, or null for an empty (NONE) slot. */
function toSeedCard(name: string | undefined, where: string): SeedCard | null {
  if (name === undefined) {
    throw new Error(`parseSeed: unrecognized card byte at ${where}`);
  }
  const byte = CardName[name];
  if (byte === undefined) {
    throw new Error(`parseSeed: unknown card name ${JSON.stringify(name)} at ${where}`);
  }
  if (byte === NONE_BYTE) return null;

  const card = cardByByte(byte, name as string, where);
  const ruined = isEdifice(card) && byte === card.faces.ruin.saveId;
  return ruined ? { id: card.id, ruined: true } : { id: card.id };
}

function requireSeedCard(name: string | undefined, where: string): SeedCard {
  const card = toSeedCard(name, where);
  if (!card) throw new Error(`parseSeed: unexpected empty card slot at ${where}`);
  return card;
}

/** Our card id (+ ruined flag) -> the byte's parser name. */
function toParserName(card: SeedCard | null): string {
  if (card === null) return 'NONE';
  const resolved = byId(card.id);
  const saveId = isEdifice(resolved)
    ? card.ruined
      ? resolved.faces.ruin.saveId
      : resolved.faces.edifice.saveId
    : resolved.saveId;
  const name = CardNameIndexes[saveId];
  if (name === undefined) {
    throw new Error(`serializeSeed: card ${card.id} (saveId ${saveId}) has no parser name`);
  }
  return name;
}

// ---- public API -------------------------------------------------------

export function parseSeed(seed: string): ParsedSeed {
  const game = parseOathTTSSavefileString(seed);

  return {
    version: game.version,
    gameCount: game.gameCount,
    chronicleName: game.chronicleName,
    oath: game.oath,
    suitOrder: game.suitOrder.map((n, i) => {
      const suit = SUITS[n];
      if (!suit) throw new Error(`parseSeed: suitOrder[${i}] = ${n} is not a valid suit`);
      return suit;
    }),
    winner: game.winner,
    playerCitizenship: game.playerCitizenship,
    prevPlayerCitizenship: game.prevPlayerCitizenship,
    sites: game.sites.map((site, i) => ({
      id: siteId(site.name, `sites[${i}]`),
      ruined: site.ruined,
      cards: site.cards.map((c, j) => toSeedCard(c.name, `sites[${i}].cards[${j}]`)),
    })),
    world: game.world.map((c, i) => requireSeedCard(c.name, `world[${i}]`)),
    dispossessed: game.dispossessed.map((c, i) => requireSeedCard(c.name, `dispossessed[${i}]`)),
    relics: game.relics.map((c, i) => requireSeedCard(c.name, `relics[${i}]`)),
  };
}

export function serializeSeed(parsed: ParsedSeed): string {
  const game: OathGame = {
    version: parsed.version,
    gameCount: parsed.gameCount,
    chronicleName: parsed.chronicleName,
    oath: parsed.oath,
    suitOrder: parsed.suitOrder.map((s) => SUIT_INDEX[s] as unknown as VendorSuit),
    playerCitizenship: parsed.playerCitizenship,
    prevPlayerCitizenship: parsed.prevPlayerCitizenship as PlayerCitizenship,
    winner: parsed.winner,
    sites: parsed.sites.map((site) => ({
      name:
        site.id === null
          ? 'NONE'
          : (SiteNameIndexes[byId(site.id).saveId] as string),
      ruined: site.ruined,
      cards: site.cards.map((c) => ({ name: toParserName(c) })),
    })),
    world: parsed.world.map((c) => ({ name: toParserName(c) })),
    dispossessed: parsed.dispossessed.map((c) => ({ name: toParserName(c) })),
    relics: parsed.relics.map((c) => ({ name: toParserName(c) })),
  };

  return serializeOathGame(game);
}
