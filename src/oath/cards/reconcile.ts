import { cardId } from './ids.js';
import { CardDatabaseSchema, type CardDatabase } from './schema.js';

export interface Discrepancy {
  numbering: 'site' | 'card';
  saveId: number;
  /** Name at this saveId in cards.lua (via our built database), or null. */
  lua: string | null;
  /** Name at this saveId in the vendored parser's name table, or null. */
  ts: string | null;
}

export interface Override {
  numbering: 'site' | 'card';
  saveId: number;
  name: string;
  aliases: string[];
  /**
   * Corrects a SITE's printed card capacity (Law §2.8.1) where `cards.lua`
   * disagrees with the physical card. Overrides were name-only until the
   * 2026-09-12 cross-check against the publisher's own card CDN found
   * Steppe printed 2 where the Lua says 1 — the same class of Lua error
   * RULINGS.md already records for two sites' relic counts. Omit to leave
   * the vendored value alone.
   */
  capacity?: number;
  reason: string;
}

const SENTINEL = 255;

/** name -> saveId table inverted to saveId -> name, dropping NONE / 255. */
function invert(table: Record<string, number>): Map<number, string> {
  const out = new Map<number, string>();
  for (const [name, saveId] of Object.entries(table)) {
    if (saveId === SENTINEL || name === 'NONE') continue;
    out.set(saveId, name);
  }
  return out;
}

/** saveId -> name for the "card" numbering, taken from our built database. */
function luaCardNames(db: CardDatabase): Map<number, string> {
  const out = new Map<number, string>();
  for (const d of db.denizens) out.set(d.saveId, d.name);
  for (const r of db.relics) out.set(r.saveId, r.name);
  for (const v of db.visions) out.set(v.saveId, v.name);
  // Banners: the TS table keeps the compound "A / B" string at one saveId.
  for (const b of db.banners) out.set(b.saveId, b.faces.join(' / '));
  // Edifice/ruin: the TS table has one entry per face at n and n+1.
  for (const e of db.edifices) {
    out.set(e.faces.edifice.saveId, e.faces.edifice.name);
    out.set(e.faces.ruin.saveId, e.faces.ruin.name);
  }
  return out;
}

function diff(
  numbering: 'site' | 'card',
  lua: Map<number, string>,
  ts: Map<number, string>,
): Discrepancy[] {
  const out: Discrepancy[] = [];
  for (const saveId of [...new Set([...lua.keys(), ...ts.keys()])].sort((a, b) => a - b)) {
    if (saveId === SENTINEL) continue;
    const l = lua.get(saveId) ?? null;
    const t = ts.get(saveId) ?? null;
    if (l !== t) out.push({ numbering, saveId, lua: l, ts: t });
  }
  return out;
}

export function findDiscrepancies(
  db: CardDatabase,
  tsCardNames: Record<string, number>,
  tsSiteNames: Record<string, number>,
): Discrepancy[] {
  return [
    ...diff('card', luaCardNames(db), invert(tsCardNames)),
    ...diff(
      'site',
      new Map(db.sites.map((s) => [s.saveId, s.name])),
      invert(tsSiteNames),
    ),
  ];
}

/**
 * A discrepancy is "covered" when the TS witness's name equals the resolved
 * card's name or one of its aliases — i.e. someone decided which name is
 * canonical and recorded the other as an alias.
 */
export function isCovered(d: Discrepancy, db: CardDatabase): boolean {
  if (d.ts === null) return true; // TS has no entry here; nothing to reconcile
  const names = new Set<string>();
  const collect = (name: string, aliases?: string[]) => {
    names.add(name);
    for (const a of aliases ?? []) names.add(a);
  };
  if (d.numbering === 'site') {
    for (const s of db.sites) if (s.saveId === d.saveId) collect(s.name, s.aliases);
  } else {
    for (const c of [...db.denizens, ...db.relics, ...db.visions]) {
      if (c.saveId === d.saveId) collect(c.name, c.aliases);
    }
    for (const b of db.banners) {
      if (b.saveId === d.saveId) {
        collect(b.faces.join(' / '), b.aliases);
        collect(b.name, b.aliases);
      }
    }
    for (const e of db.edifices) {
      if (e.faces.edifice.saveId === d.saveId) collect(e.faces.edifice.name, e.aliases);
      if (e.faces.ruin.saveId === d.saveId) collect(e.faces.ruin.name, e.aliases);
    }
  }
  return names.has(d.ts);
}

/**
 * Apply hand-resolved overrides: set the canonical `name`, recompute `id` from
 * it, and record the other witness's name(s) in `aliases`. Only denizens,
 * relics, visions, and sites are addressable by a single saveId here; edifice
 * faces and banners are handled by matching either face's saveId.
 */
export function applyOverrides(
  db: CardDatabase,
  overrides: Override[],
): CardDatabase {
  const next: CardDatabase = structuredClone(db);

  for (const o of overrides) {
    let hit = false;
    const mergeAliases = (existing: string[] | undefined) => {
      const set = new Set([...(existing ?? []), ...o.aliases]);
      set.delete(o.name);
      return set.size ? [...set] : undefined;
    };

    if (o.numbering === 'site') {
      for (const s of next.sites) {
        if (s.saveId !== o.saveId) continue;
        s.name = o.name;
        s.id = cardId('site', o.name);
        s.aliases = mergeAliases(s.aliases);
        if (o.capacity !== undefined) s.capacity = o.capacity;
        hit = true;
      }
    } else {
      for (const d of next.denizens) {
        if (d.saveId !== o.saveId) continue;
        d.name = o.name;
        d.id = cardId('denizen', o.name);
        d.aliases = mergeAliases(d.aliases);
        hit = true;
      }
      for (const r of next.relics) {
        if (r.saveId !== o.saveId) continue;
        r.name = o.name;
        r.id = cardId('relic', o.name);
        r.aliases = mergeAliases(r.aliases);
        hit = true;
      }
      for (const v of next.visions) {
        if (v.saveId !== o.saveId) continue;
        v.name = o.name;
        v.id = cardId('vision', o.name);
        v.aliases = mergeAliases(v.aliases);
        hit = true;
      }
      for (const b of next.banners) {
        if (b.saveId !== o.saveId) continue;
        b.name = o.name;
        b.faces = [o.name, ...b.faces.slice(1)];
        b.id = cardId('banner', o.name);
        b.aliases = mergeAliases(b.aliases);
        hit = true;
      }
      for (const e of next.edifices) {
        if (e.faces.edifice.saveId === o.saveId) {
          e.faces.edifice.name = o.name;
          e.name = o.name;
          e.id = cardId('edifice', o.name);
          e.aliases = mergeAliases(e.aliases);
          hit = true;
        } else if (e.faces.ruin.saveId === o.saveId) {
          e.faces.ruin.name = o.name;
          e.aliases = mergeAliases(e.aliases);
          hit = true;
        }
      }
    }

    if (!hit) {
      throw new Error(
        `applyOverrides: no ${o.numbering} card at saveId ${o.saveId}`,
      );
    }
  }

  const parsed = CardDatabaseSchema.safeParse(next);
  if (!parsed.success) {
    throw new Error(`applyOverrides: produced an invalid database: ${parsed.error.message}`);
  }
  return parsed.data;
}
