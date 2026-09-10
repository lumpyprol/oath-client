/**
 * `search` (unit 10) — Law §5.1, the draw half of a Search. The play half
 * is `card.play` (unit 6): `search` draws cards into `players[seat].hand`
 * and leaves a pending 'play' decision (wired in index.ts); the player
 * then resolves it with `card.play`, which plays one drawn card and
 * discards the rest. Two steps, so the drawn identities never enter the
 * `search` payload and other seats' projections only ever see a count.
 *
 * Payload: `{ from: 'deck' | 'discard' }` — the CHOICE, never the ids
 * (HLD D5/D13). `'discard'` is always the pile of the region your pawn is
 * in (§5.1.2), not a free choice.
 *
 *   §5.1.1 Cost — 2 Supply from a discard pile; from the world deck, the
 *          Supply shown by the Visions Drawn track: 0 Visions drawn -> 2,
 *          1-2 -> 3, 3-5 -> 4 (read off the board; see WORLD_DECK_COST).
 *   §5.1.2 Draw 3 — from the top (Glossary "Draw"). From the world deck,
 *          one at a time: if a Vision comes up you keep it, STOP (you may
 *          have drawn fewer than 3), and the Visions Drawn marker advances
 *          one (§2.7.1). Discard piles have no Vision-stop rule.
 *          An empty source is illegal (nothing to search).
 *   §5.1.3-4 Discard all but one, then play it — `card.play`.
 *
 * Supply spent by decrementing `player.supply` on the applyEffects output
 * (the unit 7 convention). Draws go through `draw` effects (unit 3).
 */

import { z } from 'zod';
import { IllegalAction, type GameAction } from '../../../engine/types.js';
import { applyEffects, type CardZone, type Effect } from '../effects.js';
import type { OathState, Region } from '../state.js';
import { requireActiveSeat, type Handler } from '../turn.js';

const DISCARD_COST = 2; // Supply (Law §5.1.1)
const SEARCH_DRAW = 3; // Law §5.1.2
const MAX_VISIONS_DRAWN = 5; // 5 Visions in the game; the track goes 0..5

/** Law §5.1.1 / Visions Drawn track: Supply to draw from the world deck. */
function worldDeckCost(visionsDrawn: number): number {
  if (visionsDrawn <= 0) return 2;
  if (visionsDrawn <= 2) return 3;
  return 4;
}

const SearchPayloadSchema = z.object({ from: z.enum(['deck', 'discard']) });

function regionOfSite(state: OathState, siteId: string): Region {
  const site = state.sites.find((s) => s.id === siteId);
  if (!site) throw new IllegalAction(`search: your pawn is not on a real site`);
  return site.region;
}

function search(state: OathState, action: GameAction): OathState {
  const seat = requireActiveSeat(state, action);
  const parsed = SearchPayloadSchema.safeParse(action.payload);
  if (!parsed.success) throw new IllegalAction('search: malformed payload');
  const player = state.players[seat];

  const fromWorldDeck = parsed.data.from === 'deck';
  const region = regionOfSite(state, player.pawnSite);
  const source = fromWorldDeck ? state.worldDeck : state.discards[region];
  const cost = fromWorldDeck ? worldDeckCost(state.visionsDrawn) : DISCARD_COST;

  if (source.length === 0) {
    throw new IllegalAction(
      fromWorldDeck ? 'search: the world deck is empty' : `search: the ${region} discard pile is empty`,
    );
  }
  if (player.supply < cost) {
    throw new IllegalAction(`search: costs ${cost} Supply, you have ${player.supply} (Law §5.1.1)`);
  }

  // §5.1.2: how many to draw. From the world deck, stop early on a Vision.
  let n = 0;
  let drewVisionFromDeck = false;
  while (n < SEARCH_DRAW && n < source.length) {
    const card = source[n];
    n += 1;
    if (fromWorldDeck && card.startsWith('vision:')) {
      drewVisionFromDeck = true;
      break;
    }
  }

  const drawFrom: CardZone = fromWorldDeck
    ? { kind: 'worldDeck' }
    : { kind: 'discard', region };
  const effects: Effect[] = Array.from({ length: n }, () => ({
    kind: 'draw',
    from: drawFrom,
    to: { kind: 'seatHand', seat },
  }));

  const next = applyEffects(state, seat, effects);
  next.players[seat].supply -= cost;
  next.players[seat].handDrawnAt = next.actionCount;
  if (drewVisionFromDeck) {
    next.visionsDrawn = Math.min(MAX_VISIONS_DRAWN, next.visionsDrawn + 1); // §2.7.1
  }
  return next;
}

export const SEARCH_HANDLERS: Record<string, Handler> = {
  search,
};
