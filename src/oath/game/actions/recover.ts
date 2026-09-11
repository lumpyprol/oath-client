/**
 * `recover` (unit 11) — Law §5.4. Spend 1 Supply, then take one facedown
 * relic at your site or one banner (even one you hold).
 *
 *   §5.4.2 relic cost — the site's bottom-right corner lists ONE of: place
 *          three favor in a specific bank, burn two favor, burn one
 *          secret, or burn two secrets. This is structural site data, not
 *          card text, so it's read straight from `byId(siteId).recoverCost`
 *          (P1 follow-up to unit 11, same category as the reveal-prompt
 *          data — see data/site-reveals.json) rather than declared by the
 *          player; the payload no longer carries a relic `cost` field.
 *   §5.4.2 banner cost — the People's Favor: "any amount of favor greater
 *          than its current value"; the Darkest Secret: "any amount of
 *          secrets greater than its current value". The payload gives
 *          `pay`; it must be strictly more than the current stake.
 *   §5.4.4 Resolve Banner — People's Favor: flip off Mob, the paid favor
 *          becomes the new stake, the old stake returns to the favor banks
 *          (one per bank; the rulebook's "starting with any suit" choice
 *          is elided to suit order). Darkest Secret: the paid secrets
 *          become the new stake; the recoverer takes one of the old stake
 *          and the previous holder takes the rest (recoverer takes all if
 *          from themselves or an unclaimed banner).
 *   §5.4.1 Darkest Secret restriction — you may only recover it from
 *          ANOTHER player if some non-ruined card at that holder's site
 *          has a suit not shared by any of their faceup advisers.
 *
 * The banners' ongoing powers (defense dice, Wake, etc.) are card text —
 * v1 declares them via `power.use`. Oathkeeper changes from taking the
 * People's Favor are unit 17's pipeline.
 */

import { z } from 'zod';
import { byId } from '../../cards/index.js';
import { SUITS, type Site, type Suit } from '../../cards/schema.js';
import { IllegalAction, type GameAction } from '../../../engine/types.js';
import { applyEffects, type Effect } from '../effects.js';
import {
  DARKEST_SECRET_ID,
  PEOPLES_FAVOR_ID,
  type BannerState,
  type OathState,
} from '../state.js';
import { requireActiveSeat, type Handler } from '../turn.js';

const RECOVER_COST = 1; // Supply (Law §5.4.1)

const RecoverPayloadSchema = z.discriminatedUnion('target', [
  z.object({
    target: z.literal('relic'),
    relicId: z.string(),
    siteId: z.string().optional(),
  }),
  z.object({
    target: z.literal('banner'),
    bannerId: z.enum(['peoples-favor', 'darkest-secret']),
    pay: z.number().int().positive(),
  }),
]);

/** Law §5.4.1: for the Darkest Secret held by another player. */
function darkestSecretRecoverable(state: OathState, holder: number): boolean {
  const site = state.sites.find((s) => s.id === state.players[holder].pawnSite);
  if (!site) return false;
  const cardSuits = site.cards
    .filter((c) => c !== null && !c.ruined)
    .map((c) => byId(c!.id))
    .filter((card): card is typeof card & { suit: Suit } => 'suit' in card)
    .map((card) => card.suit);
  if (cardSuits.length === 0) return false; // "site has no cards" -> cannot
  const adviserSuits = new Set(
    state.players[holder].advisers
      .filter((a) => !a.facedown)
      .map((a) => byId(a.id))
      .filter((card): card is typeof card & { suit: Suit } => 'suit' in card)
      .map((card) => card.suit),
  );
  return cardSuits.some((suit) => !adviserSuits.has(suit));
}

function recover(state: OathState, action: GameAction): OathState {
  const seat = requireActiveSeat(state, action);
  const parsed = RecoverPayloadSchema.safeParse(action.payload);
  if (!parsed.success) throw new IllegalAction('recover: malformed payload');
  const player = state.players[seat];

  if (player.supply < RECOVER_COST) {
    throw new IllegalAction('recover: insufficient Supply (Law §5.4.1)');
  }

  const effects: Effect[] = [];
  const post: Array<(s: OathState) => void> = [];

  if (parsed.data.target === 'relic') {
    const { relicId } = parsed.data;
    const siteId = parsed.data.siteId ?? player.pawnSite;
    if (siteId !== player.pawnSite) {
      throw new IllegalAction('recover: the relic must be at your site (Law §5.4.1)');
    }
    const site = state.sites.find((s) => s.id === siteId);
    if (!site || !site.relics.includes(relicId)) {
      throw new IllegalAction(`recover: no facedown relic ${relicId} at your site`);
    }
    const cost = (byId(siteId) as Site).recoverCost;
    if (!cost) {
      throw new IllegalAction(`recover: ${siteId} has no printed recover cost (Law §5.4.2)`);
    }

    if (cost.kind === 'placeFavor') {
      effects.push({
        kind: 'favor',
        from: { kind: 'seatFavor', seat },
        to: { kind: 'favorBank', suit: cost.suit },
        amount: 3,
      });
    } else if (cost.kind === 'burnFavor') {
      effects.push({
        kind: 'favor',
        from: { kind: 'seatFavor', seat },
        to: { kind: 'sharedFavor' },
        amount: 2,
      });
    } else {
      effects.push({
        kind: 'secret',
        from: { kind: 'seatSecrets', seat },
        to: { kind: 'sharedSecrets' },
        amount: cost.amount,
      });
    }
    effects.push({
      kind: 'card',
      id: relicId,
      from: { kind: 'siteRelics', siteId },
      to: { kind: 'seatRelics', seat },
    });
  } else {
    const bannerId = parsed.data.bannerId === 'peoples-favor' ? PEOPLES_FAVOR_ID : DARKEST_SECRET_ID;
    const banner = state.banners.find((b) => b.id === bannerId) as BannerState;
    const pay = parsed.data.pay;
    if (pay <= banner.tokens) {
      throw new IllegalAction(
        `recover: must pay MORE than the current stake of ${banner.tokens} (Law §5.4.2)`,
      );
    }
    const holder = banner.holder;
    const old = banner.tokens;

    if (bannerId === PEOPLES_FAVOR_ID) {
      // §5.4.4: old stake back to the favor banks, one per bank (suit order).
      for (let i = 0; i < old; i++) {
        effects.push({
          kind: 'favor',
          from: { kind: 'bannerFavor' },
          to: { kind: 'favorBank', suit: SUITS[i % SUITS.length] },
          amount: 1,
        });
      }
      effects.push({
        kind: 'favor',
        from: { kind: 'seatFavor', seat },
        to: { kind: 'bannerFavor' },
        amount: pay,
      });
      post.push((s) => {
        const b = s.banners.find((x) => x.id === PEOPLES_FAVOR_ID)!;
        b.holder = seat;
        b.mob = false;
      });
    } else {
      if (holder !== null && holder !== seat && !darkestSecretRecoverable(state, holder)) {
        throw new IllegalAction(
          "recover: can't take the Darkest Secret — every card at the holder's site matches an adviser (Law §5.4.1)",
        );
      }
      const fromSelfOrUnclaimed = holder === null || holder === seat;
      if (fromSelfOrUnclaimed) {
        effects.push({
          kind: 'secret',
          from: { kind: 'bannerSecrets' },
          to: { kind: 'seatSecrets', seat },
          amount: old,
        });
      } else {
        effects.push({
          kind: 'secret',
          from: { kind: 'bannerSecrets' },
          to: { kind: 'seatSecrets', seat },
          amount: 1,
        });
        if (old - 1 > 0) {
          effects.push({
            kind: 'secret',
            from: { kind: 'bannerSecrets' },
            to: { kind: 'seatSecrets', seat: holder },
            amount: old - 1,
          });
        }
      }
      effects.push({
        kind: 'secret',
        from: { kind: 'seatSecrets', seat },
        to: { kind: 'bannerSecrets' },
        amount: pay,
      });
      post.push((s) => {
        s.banners.find((x) => x.id === DARKEST_SECRET_ID)!.holder = seat;
      });
    }
  }

  const next = applyEffects(state, seat, effects);
  next.players[seat].supply -= RECOVER_COST;
  for (const fn of post) fn(next);
  return next;
}

export const RECOVER_HANDLERS: Record<string, Handler> = {
  recover,
};
