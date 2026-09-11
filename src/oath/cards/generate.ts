import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCardsLua } from './lua.js';
import { buildDatabase, type SiteReveal } from './build.js';
import { applyOverrides, type Override } from './reconcile.js';
import type { CardDatabase } from './schema.js';

const here = dirname(fileURLToPath(import.meta.url));

export const CARDS_LUA = join(here, '../../../vendor/oathparser/cards.lua');
export const OVERRIDES_JSON = join(here, 'data/overrides.json');
export const SITE_REVEALS_JSON = join(here, 'data/site-reveals.json');
export const DATA_DIR = join(here, 'data');

/**
 * Hand-transcribed site reveal prompts (Law §2.8.2) and relic recover costs
 * (Law §5.4.2), both keyed by saveId.
 */
export function loadSiteReveals(): Record<number, SiteReveal> {
  const raw = JSON.parse(readFileSync(SITE_REVEALS_JSON, 'utf8')) as {
    bySaveId: Record<string, SiteReveal & { _name?: string }>;
  };
  const out: Record<number, SiteReveal> = {};
  for (const [id, v] of Object.entries(raw.bySaveId)) {
    out[Number(id)] = { favor: v.favor, secrets: v.secrets, relics: v.relics, recoverCost: v.recoverCost };
  }
  return out;
}

export const COLLECTIONS = [
  'denizens',
  'sites',
  'relics',
  'visions',
  'edifices',
  'banners',
] as const;

export type CollectionName = (typeof COLLECTIONS)[number];

/**
 * The provenance pipeline: vendored Lua -> raw records -> typed database ->
 * hand-resolved name overrides. Pure with respect to disk beyond reading the
 * two committed inputs; writing the JSON files is the script's job.
 */
export function generate(): CardDatabase {
  const source = readFileSync(CARDS_LUA, 'utf8');
  const overrides: Override[] = JSON.parse(readFileSync(OVERRIDES_JSON, 'utf8'));
  return applyOverrides(
    buildDatabase(parseCardsLua(source), loadSiteReveals()),
    overrides,
  );
}

/** A collection sorted by saveId, serialized the way the data files are on disk. */
export function serializeCollection(db: CardDatabase, name: CollectionName): string {
  const rows = [...db[name]].sort((a, b) => a.saveId - b.saveId);
  return `${JSON.stringify(rows, null, 2)}\n`;
}
