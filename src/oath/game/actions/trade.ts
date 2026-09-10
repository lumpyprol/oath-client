/**
 * `trade` (unit 8) — Law §5.3. Spend 1 Supply (§5.3.1), then one of:
 *
 *   for: 'favor'   — Law §5.3.2: place ONE secret on a token-free
 *                    denizen/intact-edifice at your site; gain
 *                    `1 + (faceup advisers matching that card's suit)`
 *                    favor, from the bank of THAT card's suit (§9.3
 *                    clamps to what the bank holds).
 *   for: 'secrets' — Law §5.3.2: place TWO favor on such a card; gain
 *                    `(faceup advisers matching that card's suit)` secrets
 *                    from the shared bank — 0 if you have no matching
 *                    faceup advisers. Secrets are unlimited (§9.3), so
 *                    the shared bank never runs dry.
 *
 * "Matching" (Glossary "Match"): same suit; facedown advisers have no
 * suit (§2.2.2) and never count. `matchingFaceupAdvisers` is exported as
 * the plan asks — a pure suit-count helper other rules can reuse.
 *
 * Supply spent by decrementing `player.supply` on the applyEffects output
 * (the unit 7 convention). No new effect tag (D33).
 */

import { z } from 'zod';
import { byId } from '../../cards/index.js';
import type { Suit } from '../../cards/schema.js';
import { IllegalAction, type GameAction } from '../../../engine/types.js';
import { applyEffects, type Effect } from '../effects.js';
import type { OathState, PlayerState } from '../state.js';
import { requireActiveSeat, type Handler } from '../turn.js';

const TRADE_COST = 1; // Supply (Law §5.3.1)

/** Faceup advisers whose card is `suit` (Glossary "Match"; §5.3.2). */
export function matchingFaceupAdvisers(player: PlayerState, suit: Suit): number {
  let n = 0;
  for (const a of player.advisers) {
    if (a.facedown) continue;
    const card = byId(a.id);
    if ('suit' in card && card.suit === suit) n += 1;
  }
  return n;
}

const TradePayloadSchema = z.object({
  for: z.enum(['favor', 'secrets']),
  cardId: z.string(),
  siteId: z.string().optional(),
});

function trade(state: OathState, action: GameAction): OathState {
  const seat = requireActiveSeat(state, action);
  const parsed = TradePayloadSchema.safeParse(action.payload);
  if (!parsed.success) throw new IllegalAction('trade: malformed payload');
  const { cardId } = parsed.data;
  const player = state.players[seat];

  const siteId = parsed.data.siteId ?? player.pawnSite;
  if (siteId !== player.pawnSite) {
    throw new IllegalAction('trade: the card must be at your site (Law §5.3.2)');
  }
  const site = state.sites.find((s) => s.id === siteId);
  if (!site) throw new IllegalAction(`trade: no site ${siteId}`);
  const cardInPlay = site.cards.find((c) => c?.id === cardId);
  if (!cardInPlay) throw new IllegalAction(`trade: no card ${cardId} at your site`);
  if (cardInPlay.ruined) {
    throw new IllegalAction('trade: cannot trade with a ruin (Law §5.3.2 / §2.9)');
  }
  const card = byId(cardId);
  if (!('suit' in card)) throw new IllegalAction('trade: the target has no suit (Law §5.3.2)');
  if (cardInPlay.favor > 0 || cardInPlay.secrets > 0) {
    throw new IllegalAction('trade: the card already has favor or secrets on it (Law §5.3.2)');
  }
  if (player.supply < TRADE_COST) {
    throw new IllegalAction('trade: insufficient Supply (Law §5.3.1)');
  }

  const suit = card.suit;
  const matches = matchingFaceupAdvisers(player, suit);
  const effects: Effect[] = [];

  if (parsed.data.for === 'favor') {
    if (player.secrets.ready < 1) {
      throw new IllegalAction('trade: no ready secret to place (Law §5.3.2)');
    }
    effects.push({
      kind: 'secret',
      from: { kind: 'seatSecrets', seat },
      to: { kind: 'siteCardSecrets', siteId, cardId },
      amount: 1,
    });
    const want = 1 + matches;
    const gain = Math.min(want, state.favorBanks[suit]); // §9.3
    if (gain > 0) {
      effects.push({
        kind: 'favor',
        from: { kind: 'favorBank', suit },
        to: { kind: 'seatFavor', seat },
        amount: gain,
      });
    }
  } else {
    if (player.favor < 2) {
      throw new IllegalAction('trade: need 2 favor to place (Law §5.3.2)');
    }
    effects.push({
      kind: 'favor',
      from: { kind: 'seatFavor', seat },
      to: { kind: 'siteCardFavor', siteId, cardId },
      amount: 2,
    });
    if (matches > 0) {
      effects.push({
        kind: 'secret',
        from: { kind: 'sharedSecrets' }, // §9.3: inexhaustible
        to: { kind: 'seatSecrets', seat },
        amount: matches,
      });
    }
  }

  const next = applyEffects(state, seat, effects);
  next.players[seat].supply -= TRADE_COST;
  return next;
}

export const TRADE_HANDLERS: Record<string, Handler> = {
  trade,
};
