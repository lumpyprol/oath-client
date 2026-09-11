import type { RawRecord } from './lua.js';
import { cardId } from './ids.js';
import {
  CardDatabaseSchema,
  SuitSchema,
  type Banner,
  type CardDatabase,
  type Denizen,
  type EdificeRuin,
  type Relic,
  type Site,
  type SiteRecoverCost,
  type Suit,
  type Vision,
} from './schema.js';

/**
 * The mod's card table tags the two base-game banners (the Darkest Secret and
 * the People's Favor) with this cardtype. In our model banners are their own
 * first-class kind — not relics, not a relic variant — so this string only
 * ever appears here, at the boundary where the vendored data is read.
 */
export const MOD_BANNER_CARDTYPE = 'SuperRelic';

/**
 * Turn the mod's raw records into a validated, typed CardDatabase.
 * `siteReveals` supplies each site's reveal-prompt data (Law §2.8.2) —
 * hand-transcribed, keyed by saveId — since `cards.lua` has none.
 */
export function buildDatabase(
  records: RawRecord[],
  siteReveals: Record<number, SiteReveal>,
): CardDatabase {
  const db: CardDatabase = {
    denizens: [],
    sites: [],
    relics: [],
    visions: [],
    edifices: [],
    banners: [],
  };

  for (const record of records) {
    const cardtype = record.fields.cardtype;

    switch (cardtype) {
      case 'Site': {
        const site = buildSite(record, siteReveals);
        if (site) db.sites.push(site);
        break;
      }
      case 'Denizen':
        db.denizens.push(buildDenizen(record));
        break;
      case 'Relic':
        db.relics.push(buildRelic(record));
        break;
      case 'Vision':
        db.visions.push(buildVision(record));
        break;
      case 'EdificeRuin':
        db.edifices.push(buildEdifice(record));
        break;
      case 'None':
        break;
      default:
        if (cardtype === MOD_BANNER_CARDTYPE) {
          db.banners.push(buildBanner(record));
          break;
        }
        throw new Error(
          `buildDatabase: unknown cardtype ${JSON.stringify(cardtype)} for ${JSON.stringify(record.name)}`,
        );
    }
  }

  const parsed = CardDatabaseSchema.safeParse(db);
  if (!parsed.success) {
    throw new Error(`buildDatabase: produced an invalid database: ${parsed.error.message}`);
  }
  return parsed.data;
}

function num(record: RawRecord, key: string): number {
  const v = record.fields[key];
  if (typeof v !== 'number') {
    throw new Error(`buildDatabase: ${JSON.stringify(record.name)} missing numeric ${key}`);
  }
  return v;
}

function suitOf(record: RawRecord): Suit {
  const raw = record.fields.suit;
  if (typeof raw !== 'string') {
    throw new Error(`buildDatabase: ${JSON.stringify(record.name)} missing suit`);
  }
  const parsed = SuitSchema.safeParse(raw.toLowerCase());
  if (!parsed.success) {
    throw new Error(`buildDatabase: ${JSON.stringify(record.name)} has unknown suit ${JSON.stringify(raw)}`);
  }
  return parsed.data;
}

export interface SiteReveal {
  favor: number;
  secrets: number;
  relics: number;
  recoverCost: SiteRecoverCost | null;
}

function buildSite(record: RawRecord, reveals: Record<number, SiteReveal>): Site | null {
  if (record.name === 'UNUSED') return null;
  const saveId = num(record, 'saveid');
  const reveal = reveals[saveId];
  if (!reveal) {
    throw new Error(`buildSite: no reveal-prompt data for site saveId ${saveId} (${record.name})`);
  }
  return {
    id: cardId('site', record.name),
    name: record.name,
    set: 'base',
    saveId,
    capacity: num(record, 'capacity'),
    reveal: { favor: reveal.favor, secrets: reveal.secrets, relics: reveal.relics },
    recoverCost: reveal.recoverCost,
  };
}

function buildDenizen(record: RawRecord): Denizen {
  return {
    id: cardId('denizen', record.name),
    name: record.name,
    set: 'base',
    saveId: num(record, 'saveid'),
    suit: suitOf(record),
  };
}

function buildRelic(record: RawRecord): Relic {
  return {
    id: cardId('relic', record.name),
    name: record.name,
    set: 'base',
    saveId: num(record, 'saveid'),
  };
}

function buildVision(record: RawRecord): Vision {
  return {
    id: cardId('vision', record.name),
    name: record.name,
    set: 'base',
    saveId: num(record, 'saveid'),
  };
}

function buildEdifice(record: RawRecord): EdificeRuin {
  const parts = record.name.split(' / ');
  if (parts.length !== 2) {
    throw new Error(
      `buildDatabase: edifice/ruin name ${JSON.stringify(record.name)} must be "Edifice / Ruin"`,
    );
  }
  const [edificeName, ruinName] = parts;
  const saveId = num(record, 'saveid');
  return {
    id: cardId('edifice', edificeName),
    name: edificeName,
    set: 'base',
    saveId,
    suit: suitOf(record),
    faces: {
      edifice: { name: edificeName, saveId },
      ruin: { name: ruinName, saveId: saveId + 1 },
    },
  };
}

function buildBanner(record: RawRecord): Banner {
  const faces = record.name.includes(' / ') ? record.name.split(' / ') : [record.name];
  return {
    id: cardId('banner', faces[0]),
    name: faces[0],
    set: 'base',
    saveId: num(record, 'saveid'),
    faces,
  };
}
