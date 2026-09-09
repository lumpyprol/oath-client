import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { PowerKindSchema, type CardDatabase } from './schema.js';

export const TextEntrySchema = z.object({
  text: z.string().min(1),
  powerKind: PowerKindSchema.optional(),
  notes: z.string().min(1).optional(),
});
export type TextEntry = z.infer<typeof TextEntrySchema>;

/** card id -> text entry */
export const TextOverlaySchema = z.record(z.string(), TextEntrySchema);
export type TextOverlay = z.infer<typeof TextOverlaySchema>;

export const DEFAULT_TEXT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  'data/text.json',
);

/**
 * Load the optional card-text overlay. Returns {} when the file is absent —
 * the engine never needs it, only the client does. Shape is validated; id
 * validation happens in withText, which has the card database to check against.
 */
export function loadTextOverlay(path = DEFAULT_TEXT_PATH): TextOverlay {
  if (!existsSync(path)) return {};
  return TextOverlaySchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

/**
 * Attach text / powerKind / notes to matching cards, returning a new database.
 * Every key in the overlay must be an existing card id; throws listing any
 * that aren't.
 */
export function withText(db: CardDatabase, overlay: TextOverlay): CardDatabase {
  const ids = new Set<string>();
  for (const collection of Object.values(db)) {
    for (const card of collection) ids.add(card.id);
  }
  const unknown = Object.keys(overlay).filter((id) => !ids.has(id));
  if (unknown.length > 0) {
    throw new Error(`text overlay: unknown card ids: ${unknown.join(', ')}`);
  }

  const attach = <T extends { id: string }>(card: T): T => {
    const entry = overlay[card.id];
    if (!entry) return card;
    return {
      ...card,
      text: entry.text,
      ...(entry.powerKind !== undefined ? { powerKind: entry.powerKind } : {}),
      ...(entry.notes !== undefined ? { notes: entry.notes } : {}),
    };
  };

  return {
    denizens: db.denizens.map(attach),
    sites: db.sites.map(attach),
    relics: db.relics.map(attach),
    visions: db.visions.map(attach),
    edifices: db.edifices.map(attach),
    banners: db.banners.map(attach),
  };
}
