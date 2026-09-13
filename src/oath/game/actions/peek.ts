/**
 * `peek.relic` / `peek.reliquary` (unit 3 of P4) — Law §6, the Peek
 * family, homeless since P2 (RULES-COVERAGE §6.3/§6.4 read DEFER before
 * this unit). Both cost no Supply (§6's own opening line) and are minor
 * actions in your own Act Phase, exactly like `adviser.play` (§6.1) or
 * `warbands.move` (§6.5) — `requireActiveSeat` with no special options.
 *
 *   §6.3 Peek at a Relic — "Peek at any facedown relic card at your site.
 *        (If you have ever peeked at a specific relic, you may peek at it
 *        again from any site.)" ONE relic at your own site; no `siteId`
 *        field exists at all, unlike `recover`'s (optional, always your
 *        own site anyway) — Law names no other site this could ever be.
 *   §6.4 Peek at an Imperial Relic — "If you hold the Grand Scepter, you
 *        can peek at any relic in the Imperial Reliquary." §6.4 says "any
 *        relic" with no singular framing the way §6.3 has one, so a
 *        batched list of spaces is ONE action (D50's own precedent: batch
 *        what the Law names as a set, not what happens to be plural).
 *
 * Both address a SLOT, never an id (unit 1 of P4's convention, and the
 * only sane one here: the id is exactly what a legal payload cannot
 * already contain — see D60 below). Both reduce to the same primitive:
 * resolve the index (or indices) to a real relic id, and add it to
 * `players[seat].peeked` (unit 2's shape) — sorted and deduplicated,
 * which ALSO makes re-peeking a no-op on the set without needing a
 * special case: the action still runs, still logs (peeking a relic you
 * already know is a perfectly ordinary thing to do at a table), it just
 * doesn't grow anything.
 *
 * D60 — THE PAYLOAD NEVER CARRIES THE ID. The action log is meant to be
 * shareable (HLD §4: every seat's client can read the whole log to
 * render history), and a peeked identity is private to exactly one seat
 * — so it must never enter a structure everyone can read, the same
 * reasoning `card.play`'s `handIndex` and `setup.choose`'s `keepIndex`
 * already act on for a facedown adviser or a rejected setup card. Slot
 * addressing is not a leak-closure convenience here, it is the ONLY way
 * this feature could be legal to log at all.
 *
 * Permanence (§6.3's parenthetical) needs no code: nothing removes a
 * `peeked` entry once added, and `project.ts` gates on `peeked.has(id)`
 * against whatever zone the relic sits in NOW — so a relic peeked at a
 * site, then recovered, offered, or (hypothetically) relocated, stays
 * visible to the peeking seat wherever a slot for it still exists. Once
 * held outright it is public anyway (Law §5.4.3), and `relicDeck` never
 * exposes an id regardless of `peeked` (project.ts's own file header) —
 * §6.3/§6.4 grant re-peeking a KNOWN relic, not vision into the deck.
 */

import { z } from 'zod';
import { IllegalAction, type GameAction } from '../../../engine/types.js';
import { applyEffects } from '../effects.js';
import type { OathState, PlayerState } from '../state.js';
import { requireActiveSeat, type Handler } from '../turn.js';

const PeekRelicPayloadSchema = z.object({ relicIndex: z.number().int().min(0) });
const PeekReliquaryPayloadSchema = z.object({ spaces: z.array(z.number().int().min(0)).min(1) });

/** Sorted, deduplicated insert (unit 2's own invariant) — a no-op if every id is already known. */
function addPeeked(player: PlayerState, ids: readonly string[]): void {
  const set = new Set(player.peeked);
  for (const id of ids) set.add(id);
  player.peeked = [...set].sort();
}

function peekRelic(state: OathState, action: GameAction): OathState {
  const seat = requireActiveSeat(state, action);
  const parsed = PeekRelicPayloadSchema.safeParse(action.payload);
  if (!parsed.success) throw new IllegalAction('peek.relic: malformed payload');
  const { relicIndex } = parsed.data;

  const player = state.players[seat];
  const site = state.sites.find((s) => s.id === player.pawnSite);
  const count = site?.relics.length ?? 0;
  // Out-of-range and relic-free share ONE message (unit 1's own rule):
  // the count is public (`SiteView.relics.length`, Law §9.4), the identity
  // behind any in-range slot is not.
  if (!site || relicIndex >= count) {
    throw new IllegalAction(
      `peek.relic: no facedown relic at slot ${relicIndex} — your site holds ${count} (Law §6.3)`,
    );
  }
  const relicId = site.relics[relicIndex];

  const working = applyEffects(state, seat, []); // clone; nothing moves
  addPeeked(working.players[seat], [relicId]);
  return working;
}

function peekReliquary(state: OathState, action: GameAction): OathState {
  const seat = requireActiveSeat(state, action);
  if (seat !== state.grandScepter) {
    throw new IllegalAction('peek.reliquary: only the Grand Scepter holder may peek the Imperial Reliquary (Law §6.4)');
  }
  const parsed = PeekReliquaryPayloadSchema.safeParse(action.payload);
  if (!parsed.success) throw new IllegalAction('peek.reliquary: malformed payload');

  // Validate every space before touching state — an illegal batch is
  // rejected whole, never partially applied.
  const relicIds: string[] = [];
  for (const i of parsed.data.spaces) {
    const space = state.reliquary[i];
    if (!space) {
      throw new IllegalAction(
        `peek.reliquary: no reliquary space at index ${i} — there are ${state.reliquary.length} (Law §6.4)`,
      );
    }
    // Unlike a site's relic slots, "covered" is already a PUBLIC field on
    // every viewer's view (`reliquary[i].covered`) — so naming an
    // uncovered space here leaks nothing that isn't already visible, and
    // gets its own clear message rather than unit 1's oracle-closure
    // treatment.
    if (space.relicId === null) {
      throw new IllegalAction(
        `peek.reliquary: reliquary space ${i} (${space.modifier}) is uncovered — nothing to peek (Law §6.4)`,
      );
    }
    relicIds.push(space.relicId);
  }

  const working = applyEffects(state, seat, []); // clone; nothing moves
  addPeeked(working.players[seat], relicIds);
  return working;
}

export const PEEK_HANDLERS: Record<string, Handler> = {
  'peek.relic': peekRelic,
  'peek.reliquary': peekReliquary,
};
