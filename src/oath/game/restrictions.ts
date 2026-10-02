/**
 * Law §7.2's restriction banners (unit 19; Q12/D46).
 *
 * A denizen or edifice may print a banner under its suit (§2.6.2):
 *   §7.2.1 a TREE — "can only be played, moved, or swapped to a site";
 *          a PERSON — "only to a player's advisers";
 *   §7.2.2 a CHAIN — "once played, cannot be discarded, moved, or swapped,
 *          except in the Chronicle (8)".
 * A card can carry more than one (Council Seat is both chained and
 * adviser-only), so this is a SET, not a single value.
 *
 * The preamble is the part that is easy to get backwards, and it is load-
 * bearing: "These restrictions only apply to faceup cards (not facedown)."
 * §5.1.4.2 agrees from the other side — a facedown adviser has no suit,
 * restriction banner, or power at all. So a site-only denizen MAY be played
 * as a FACEDOWN adviser; the restriction only bites if §6.1 later tries to
 * turn it faceup, and at that point the card can only be discarded.
 *
 * COMPLETE DATA (2026-10-01, P4 unit 11). Unit 19 read only a handful of
 * faces; the rest stayed unenforced (D46). With the licensed art in hand,
 * every denizen and edifice was read off its own face (see the data file's
 * provenance). `restrictionsOf` still returns null for anything absent, and
 * every caller still treats null as "no opinion", but no real card is
 * absent any more, and a test holds it there.
 */

import restrictionData from '../cards/data/card-restrictions.json' with { type: 'json' };
import { findById } from '../cards/index.js';

export type Restriction = 'site' | 'adviser' | 'locked';

const BY_SAVE_ID = restrictionData as unknown as Record<string, Restriction[] | string>;

/**
 * The restrictions printed on `cardId`, or null when the card's face has
 * not been read. Null is NOT "unrestricted" — see the file header.
 */
export function restrictionsOf(cardId: string): Restriction[] | null {
  const card = findById(cardId);
  if (!card || !('saveId' in card)) return null;
  const entry = BY_SAVE_ID[String((card as { saveId: number }).saveId)];
  return Array.isArray(entry) ? entry : null;
}

/** True only when the card is KNOWN to carry `restriction`. */
export function isRestricted(cardId: string, restriction: Restriction): boolean {
  return restrictionsOf(cardId)?.includes(restriction) ?? false;
}

/** Has this card's face been read at all? Unit 19's acceptance game asserts this. */
export function restrictionKnown(cardId: string): boolean {
  return restrictionsOf(cardId) !== null;
}
