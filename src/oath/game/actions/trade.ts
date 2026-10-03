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
import { pawnSiteOf, requireActiveSeat, type Handler } from '../turn.js';
import { chancellorHas } from '../reliquary-text.js';

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

/**
 * What a Trade with a card of `suit` pays `seat` (Law §5.3.2), as both the
 * reducer and the form work it out:
 *   - for a secret: 1 favor + 1 per matching faceup adviser;
 *   - for 2 favor: 1 secret per matching faceup adviser.
 * With the Reliquary's Careless space (the Chancellor's once uncovered):
 * "You gain one more favor (even when trading for secrets). You must gain one
 * less secret when trading for secrets." Favor is capped by the suit's bank
 * (§9.3); secrets are not (the shared bank is inexhaustible).
 */
export function tradePayout(
  state: OathState,
  seat: number,
  suit: Suit,
): { forSecret: { favor: number; wanted: number }; forFavor: { secrets: number; favor: number }; careless: boolean } {
  const matches = matchingFaceupAdvisers(state.players[seat], suit);
  const careless = chancellorHas(state, seat, 'careless');
  const extra = careless ? 1 : 0;
  const bank = state.favorBanks[suit];
  return {
    forSecret: { favor: Math.min(1 + matches + extra, bank), wanted: 1 + matches + extra },
    forFavor: { secrets: Math.max(0, matches - extra), favor: Math.min(extra, bank) },
    careless,
  };
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

  const siteId = parsed.data.siteId ?? pawnSiteOf(state, seat);
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
  const pays = tradePayout(state, seat, suit);
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
    if (pays.forSecret.favor > 0) {
      effects.push({
        kind: 'favor',
        from: { kind: 'favorBank', suit },
        to: { kind: 'seatFavor', seat },
        amount: pays.forSecret.favor,
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
    if (pays.forFavor.secrets > 0) {
      effects.push({
        kind: 'secret',
        from: { kind: 'sharedSecrets' }, // §9.3: inexhaustible
        to: { kind: 'seatSecrets', seat },
        amount: pays.forFavor.secrets,
      });
    }
    if (pays.forFavor.favor > 0) {
      // Careless: one more favor even when trading for secrets.
      effects.push({ kind: 'favor', from: { kind: 'favorBank', suit }, to: { kind: 'seatFavor', seat }, amount: pays.forFavor.favor });
    }
  }

  const next = applyEffects(state, seat, effects);
  next.players[seat].supply -= TRADE_COST;
  return next;
}

export const TRADE_HANDLERS: Record<string, Handler> = {
  trade,
};
