import denizensJson from './data/denizens.json' with { type: 'json' };
import sitesJson from './data/sites.json' with { type: 'json' };
import relicsJson from './data/relics.json' with { type: 'json' };
import visionsJson from './data/visions.json' with { type: 'json' };
import edificesJson from './data/edifices.json' with { type: 'json' };
import bannersJson from './data/banners.json' with { type: 'json' };
import {
  CardDatabaseSchema,
  type Card,
  type CardDatabase,
  type Denizen,
  type EdificeRuin,
  type Suit,
} from './schema.js';
import { loadTextOverlay, withText } from './text.js';

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

const parsed = CardDatabaseSchema.safeParse({
  denizens: denizensJson,
  sites: sitesJson,
  relics: relicsJson,
  visions: visionsJson,
  edifices: edificesJson,
  banners: bannersJson,
});
if (!parsed.success) {
  // A bad data file must crash at startup, not mid-game.
  throw new Error(`oath/cards: committed data is invalid:\n${parsed.error.message}`);
}

/**
 * The whole card database: validated, then the optional text overlay is
 * merged in (client-facing only), then deep-frozen.
 */
export const cards: CardDatabase = deepFreeze(
  withText(parsed.data, loadTextOverlay()),
);

const everyCard: readonly Card[] = [
  ...cards.denizens,
  ...cards.sites,
  ...cards.relics,
  ...cards.visions,
  ...cards.edifices,
  ...cards.banners,
];

// ---- indexes, built once ------------------------------------------------

const byIdIndex = new Map<string, Card>(everyCard.map((c) => [c.id, c]));

const byNameIndex = new Map<string, Card[]>();
const byAliasIndex = new Map<string, Card[]>();
const add = (index: Map<string, Card[]>, key: string, card: Card) => {
  const k = key.toLowerCase();
  const list = index.get(k);
  if (list) list.push(card);
  else index.set(k, [card]);
};
for (const c of everyCard) {
  add(byNameIndex, c.name, c);
  for (const alias of c.aliases ?? []) add(byAliasIndex, alias, c);
}

const siteBySaveId = new Map<number, Card>(cards.sites.map((s) => [s.saveId, s]));
const cardBySaveId = new Map<number, Card>();
for (const c of [...cards.denizens, ...cards.relics, ...cards.visions, ...cards.banners]) {
  cardBySaveId.set(c.saveId, c);
}
for (const e of cards.edifices) {
  cardBySaveId.set(e.faces.edifice.saveId, e); // both faces resolve to the
  cardBySaveId.set(e.faces.ruin.saveId, e); // edifice entity
}

const denizensBySuitIndex = new Map<Suit, Denizen[]>();
for (const d of cards.denizens) {
  const list = denizensBySuitIndex.get(d.suit);
  if (list) list.push(d);
  else denizensBySuitIndex.set(d.suit, [d]);
}
const edificeBySuitIndex = new Map<Suit, EdificeRuin>(
  cards.edifices.map((e) => [e.suit, e]),
);

// ---- lookup API -------------------------------------------------------

export function findById(id: string): Card | undefined {
  return byIdIndex.get(id);
}

export function byId(id: string): Card {
  const card = byIdIndex.get(id);
  if (!card) throw new Error(`oath/cards: no card with id ${JSON.stringify(id)}`);
  return card;
}

/** Resolve by printed name or any recorded alias, case-insensitive. */
export function byName(name: string): Card {
  const key = name.toLowerCase();
  const exact = byNameIndex.get(key) ?? [];
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    throw new Error(`oath/cards: name ${JSON.stringify(name)} is ambiguous`);
  }
  const aliased = byAliasIndex.get(key) ?? [];
  if (aliased.length === 1) return aliased[0];
  if (aliased.length > 1) {
    throw new Error(`oath/cards: alias ${JSON.stringify(name)} is ambiguous`);
  }
  throw new Error(`oath/cards: no card named ${JSON.stringify(name)}`);
}

export function bySaveId(numbering: 'site' | 'card', n: number): Card {
  const card = (numbering === 'site' ? siteBySaveId : cardBySaveId).get(n);
  if (!card) {
    throw new Error(`oath/cards: no ${numbering} card with saveId ${n}`);
  }
  return card;
}

export function denizensBySuit(suit: Suit): readonly Denizen[] {
  return denizensBySuitIndex.get(suit) ?? [];
}

export function edificeBySuit(suit: Suit): EdificeRuin {
  const edifice = edificeBySuitIndex.get(suit);
  if (!edifice) throw new Error(`oath/cards: no edifice with suit ${suit}`);
  return edifice;
}

export type { Card } from './schema.js';
