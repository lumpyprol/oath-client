/**
 * `adviser.play` (unit 16b) — Law §6.1, "Play or Discard a Facedown
 * Adviser": "Play one of your facedown advisers faceup, or discard it, as
 * if you searched (5.1.4)."
 *
 * Payload `{ adviserIndex, as: 'faceup' | 'discard' }`. Without this action
 * a facedown adviser could never come up again: `card.play` (unit 6) only
 * ever puts cards INTO the adviser row, Rest never turns one over, and
 * §5.1.4.2's discard is reachable only when playing a fourth adviser. A
 * real game cannot be played without it.
 *
 * Only a FACEDOWN adviser is a legal index. That is not a convenience
 * restriction — §5.1.4.2's parenthetical ("Generally, this is the only time
 * you can discard a faceup adviser") is true precisely BECAUSE §6.1 does
 * not reach faceup ones.
 *
 *   'faceup' — "as if you searched (5.1.4)", so §5.1.4's play rules apply
 *     to the card's own kind:
 *       - a denizen simply turns over where it sits (a `flip` effect,
 *         unit 3's non-mover case: same location, different face). It does
 *         NOT move, and it does NOT gain favor — §5.1.4.1's favor is for
 *         playing TO A SITE, and this plays to neither a site nor a new
 *         adviser slot. (Tested, since the omission is the kind of thing
 *         that looks like a bug later.)
 *       - a Vision follows §5.1.4.3: Exiles only, onto the Revealed Vision
 *         space, discarding any Vision already there. The Chancellor and
 *         Citizens "cannot play Vision cards faceup except for the
 *         Conspiracy", so for them this is illegal-state.
 *       - the Conspiracy's faceup play (§5.1.4.4) is card text — a burn,
 *         a suit-matching test, and a seize — so it stays v1-declared,
 *         exactly as `card.play` already leaves it.
 *     "When Played" powers (§7.3.3) likewise stay declared (`power.use`).
 *
 *   'discard' — bins it to the pawn region's downstream pile (Glossary
 *     "Discard", via `map.ts#discardRegion`), the same destination
 *     `card.play` uses.
 *
 * Both are Act-Phase actions (§4.2) with the default locks: illegal
 * mid-Search and mid-Campaign, via `requireActiveSeat`.
 */

import { z } from 'zod';
import { IllegalAction, type GameAction } from '../../../engine/types.js';
import { applyEffects, type Effect } from '../effects.js';
import { discardRegion } from '../map.js';
import { isRestricted } from '../restrictions.js';
import { CONSPIRACY_ID, type OathState } from '../state.js';
import { requireActiveSeat, type Handler } from '../turn.js';

const PlayPayloadSchema = z.object({
  adviserIndex: z.number().int().min(0),
  as: z.enum(['faceup', 'discard']),
});

function play(state: OathState, action: GameAction): OathState {
  const seat = requireActiveSeat(state, action);
  const parsed = PlayPayloadSchema.safeParse(action.payload);
  if (!parsed.success) throw new IllegalAction('adviser.play: malformed payload');
  const { adviserIndex, as } = parsed.data;

  const player = state.players[seat];
  const adviser = player.advisers[adviserIndex];
  if (!adviser) {
    throw new IllegalAction(
      `adviser.play: no adviser at index ${adviserIndex} (you have ${player.advisers.length})`,
    );
  }
  if (!adviser.facedown) {
    throw new IllegalAction('adviser.play: only a FACEDOWN adviser can be played or discarded (Law §6.1)');
  }
  const cardId = adviser.id;
  const isVision = cardId.startsWith('vision:');

  if (as === 'discard') {
    if (adviser.favor > 0 || adviser.secrets > 0) {
      // Same gap `card.play` documents: Glossary "Discard" routes a
      // discarded card's favor to its suit bank and its secrets to the
      // acting player's board, facedown — and unit 3 has no flipped-secret
      // zone. Unreachable today (a facedown adviser has no power to pay a
      // cost onto), but it fails loudly rather than silently dropping them.
      throw new IllegalAction(
        'adviser.play: discarding an adviser carrying favor/secrets is not yet supported ' +
          '(Glossary "Discard" + the unit 3 flipped-secret gap) — see v2',
      );
    }
    const region = state.sites.find((s) => s.id === player.pawnSite)!.region;
    return applyEffects(state, seat, [
      {
        kind: 'card',
        id: cardId,
        from: { kind: 'seatAdvisers', seat },
        to: { kind: 'discard', region: discardRegion(region) },
      },
    ]);
  }

  if (!isVision) {
    // §7.2.1: turning it faceup is what makes the banner apply (§7.2's
    // preamble), so a site-only card can sit here facedown forever and
    // simply never be turned over — its only way out is the discard above.
    if (isRestricted(cardId, 'site')) {
      throw new IllegalAction(
        `adviser.play: ${cardId} may only be played to a site, so it cannot be turned faceup here (Law §7.2.1)`,
      );
    }
    // A denizen turns over in place (Law §6.1 via §5.1.4.2).
    return applyEffects(state, seat, [{ kind: 'flip', target: { kind: 'adviser', seat, cardId } }]);
  }

  // Law §5.1.4.3/§5.1.4.4, reached through §6.1's "as if you searched".
  if (cardId === CONSPIRACY_ID) {
    throw new IllegalAction(
      "adviser.play: the Conspiracy's faceup play (Law §5.1.4.4) is not yet supported — declare it with power.use",
    );
  }
  if (player.citizenship !== 'exile') {
    throw new IllegalAction('adviser.play: only an Exile may reveal a Vision (Law §5.1.4.3)');
  }
  const effects: Effect[] = [];
  if (player.vision !== null) {
    const region = state.sites.find((s) => s.id === player.pawnSite)!.region;
    effects.push({
      kind: 'card',
      id: player.vision,
      from: { kind: 'seatVision', seat },
      to: { kind: 'discard', region: discardRegion(region) },
    });
  }
  effects.push({
    kind: 'card',
    id: cardId,
    from: { kind: 'seatAdvisers', seat },
    to: { kind: 'seatVision', seat },
  });
  return applyEffects(state, seat, effects);
}

export const ADVISER_HANDLERS: Record<string, Handler> = {
  'adviser.play': play,
};
