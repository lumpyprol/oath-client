/**
 * `card.play` (unit 6): the card-placement step of a Search (Law §5.1.4).
 * After a Search draws cards into `players[seat].hand` (the draw step is
 * unit 10), the player plays one and discards the rest. This module owns
 * only the placement — Search's draw half plugs into it later.
 *
 * Payload: `{ cardId, as: 'site'|'adviser'|'vision'|'discard', siteId?,
 * facedown?, discardAdviserId? }`.
 *
 *   'site'    — Law §5.1.4.1: to a denizen slot at YOUR site (capacity
 *               permitting, §2.8.1), then gain one favor from the bank
 *               matching the card's suit (§9.3: as many as the bank has).
 *               The People's Favor holder's "play to any site in your
 *               region, discarding a card there first" exception
 *               (§5.1.4.1) is NOT implemented — it needs a "which card to
 *               discard" choice; TODO when that matters.
 *   'adviser' — Law §5.1.4.2: faceup, or facedown if asked. Over the
 *               3-adviser limit (§2.2.2), the payload must name a
 *               `discardAdviserId` to bin first. Visions may be played
 *               ONLY as FACEDOWN advisers (§5.1.4.3).
 *   'vision'  — Law §5.1.4.3: to the Revealed Vision space. Exiles only,
 *               non-Conspiracy; a prior Revealed Vision is discarded. The
 *               Conspiracy's faceup play (§5.1.4.4) is DEFERRED — it burns
 *               a secret to seize a relic/banner, which rides on
 *               `power.use` (unit 14). Vision VICTORY is unit 17's; this
 *               module only places the card.
 *   'discard' — Law §5.1.4: "or you may discard it" — bin the whole hand.
 *
 * Discards go to the pile of the region "downstream" of the pawn's region
 * (Glossary "Discard"; `discardRegion` from unit 2). Hand and adviser
 * cards carry no region, so the pawn's region always decides.
 *
 * All state change flows through `applyEffects` (unit 3) — no new effect
 * tag was needed (D33).
 */

import { z } from 'zod';
import { byId } from '../../cards/index.js';
import { IllegalAction, type GameAction } from '../../../engine/types.js';
import { applyEffects, type Effect } from '../effects.js';
import { discardRegion } from '../map.js';
import { ADVISER_LIMIT, type OathState, type Region } from '../state.js';
import { requireActiveSeat, type Handler } from '../turn.js';

const CONSPIRACY_ID = 'vision:conspiracy';

const PlayPayloadSchema = z.object({
  cardId: z.string(),
  as: z.enum(['site', 'adviser', 'vision', 'discard']),
  siteId: z.string().optional(),
  facedown: z.boolean().optional(),
  discardAdviserId: z.string().optional(),
});
type PlayPayload = z.infer<typeof PlayPayloadSchema>;

function regionOfSite(state: OathState, siteId: string): Region {
  const site = state.sites.find((s) => s.id === siteId);
  if (!site) throw new IllegalAction(`card.play: no site ${siteId}`);
  return site.region;
}

function play(state: OathState, action: GameAction): OathState {
  const seat = requireActiveSeat(state, action);
  const parsed = PlayPayloadSchema.safeParse(action.payload);
  if (!parsed.success) throw new IllegalAction(`card.play: malformed payload`);
  const payload: PlayPayload = parsed.data;
  const { cardId } = payload;

  const player = state.players[seat];
  if (!player.hand.includes(cardId)) {
    throw new IllegalAction(`card.play: ${cardId} is not in seat ${seat}'s hand`);
  }

  const isVision = cardId.startsWith('vision:');
  const discardTo = discardRegion(regionOfSite(state, player.pawnSite));
  const restOfHand = player.hand.filter((id) => id !== cardId);
  const binRest: Effect[] = restOfHand.map((id) => ({
    kind: 'card',
    id,
    from: { kind: 'seatHand', seat },
    to: { kind: 'discard', region: discardTo },
  }));

  let effects: Effect[];

  switch (payload.as) {
    case 'discard': {
      effects = [
        {
          kind: 'card',
          id: cardId,
          from: { kind: 'seatHand', seat },
          to: { kind: 'discard', region: discardTo },
        },
        ...binRest,
      ];
      break;
    }

    case 'site': {
      if (isVision) throw new IllegalAction('card.play: a Vision cannot be played to a site (Law §5.1.4.3)');
      const siteId = payload.siteId ?? player.pawnSite;
      if (siteId !== player.pawnSite) {
        throw new IllegalAction('card.play: you may only play to your own site (Law §5.1.4.1)');
      }
      const site = state.sites.find((s) => s.id === siteId)!;
      if (!site.cards.includes(null)) {
        throw new IllegalAction(`card.play: site ${siteId} is at capacity (Law §2.8.1)`);
      }
      effects = [
        { kind: 'card', id: cardId, from: { kind: 'seatHand', seat }, to: { kind: 'siteSlot', siteId } },
      ];
      // Law §5.1.4.1: gain one favor of the card's suit, as many as the bank has (§9.3).
      const card = byId(cardId);
      if ('suit' in card && state.favorBanks[card.suit] > 0) {
        effects.push({
          kind: 'favor',
          from: { kind: 'favorBank', suit: card.suit },
          to: { kind: 'seatFavor', seat },
          amount: 1,
        });
      }
      effects.push(...binRest);
      break;
    }

    case 'adviser': {
      const facedown = payload.facedown ?? false;
      if (isVision && !facedown) {
        throw new IllegalAction(
          'card.play: a Vision may only be a FACEDOWN adviser (Law §5.1.4.3)',
        );
      }
      effects = [];
      if (player.advisers.length >= ADVISER_LIMIT) {
        const dropId = payload.discardAdviserId;
        if (!dropId) {
          throw new IllegalAction(
            `card.play: at the ${ADVISER_LIMIT}-adviser limit — name a discardAdviserId (Law §5.1.4.2)`,
          );
        }
        const dropped = player.advisers.find((a) => a.id === dropId);
        if (!dropped) throw new IllegalAction(`card.play: ${dropId} is not an adviser of seat ${seat}`);
        if (dropped.favor > 0 || dropped.secrets > 0) {
          throw new IllegalAction(
            'card.play: discarding an adviser carrying favor/secrets is not yet supported ' +
              '(Glossary "Discard" + the unit 3 flipped-secret gap) — see unit 14',
          );
        }
        effects.push({
          kind: 'card',
          id: dropId,
          from: { kind: 'seatAdvisers', seat },
          to: { kind: 'discard', region: discardTo },
        });
      }
      effects.push({
        kind: 'card',
        id: cardId,
        from: { kind: 'seatHand', seat },
        to: { kind: 'seatAdvisers', seat },
      });
      if (facedown) {
        effects.push({ kind: 'flip', target: { kind: 'adviser', seat, cardId } });
      }
      effects.push(...binRest);
      break;
    }

    case 'vision': {
      if (!isVision) throw new IllegalAction('card.play: as "vision" requires a Vision card (Law §5.1.4.3)');
      if (cardId === CONSPIRACY_ID) {
        throw new IllegalAction(
          'card.play: the Conspiracy\'s faceup play (Law §5.1.4.4) is not yet supported — see unit 14',
        );
      }
      if (player.citizenship !== 'exile') {
        throw new IllegalAction(
          'card.play: only an Exile may reveal a Vision (Law §5.1.4.3)',
        );
      }
      effects = [];
      if (player.vision !== null) {
        // Law §5.1.4.3: a prior Revealed Vision is discarded.
        effects.push({
          kind: 'card',
          id: player.vision,
          from: { kind: 'seatVision', seat },
          to: { kind: 'discard', region: discardTo },
        });
      }
      effects.push({
        kind: 'card',
        id: cardId,
        from: { kind: 'seatHand', seat },
        to: { kind: 'seatVision', seat },
      });
      effects.push(...binRest);
      break;
    }
  }

  return applyEffects(state, seat, effects);
}

export const PLAY_HANDLERS: Record<string, Handler> = {
  'card.play': play,
};
