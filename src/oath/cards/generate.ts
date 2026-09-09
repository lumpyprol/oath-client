import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCardsLua } from './lua.js';
import { buildDatabase } from './build.js';
import { applyOverrides, type Override } from './reconcile.js';
import type { CardDatabase } from './schema.js';

const here = dirname(fileURLToPath(import.meta.url));

export const CARDS_LUA = join(here, '../../../vendor/oathparser/cards.lua');
export const OVERRIDES_JSON = join(here, 'data/overrides.json');
export const DATA_DIR = join(here, 'data');

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
  return applyOverrides(buildDatabase(parseCardsLua(source)), overrides);
}

/** A collection sorted by saveId, serialized the way the data files are on disk. */
export function serializeCollection(db: CardDatabase, name: CollectionName): string {
  const rows = [...db[name]].sort((a, b) => a.saveId - b.saveId);
  return `${JSON.stringify(rows, null, 2)}\n`;
}
