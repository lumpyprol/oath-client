/**
 * Glossary §10.5 "Discard", the token half (unit 20's rules review).
 *
 * Discarding a card in play does not just move the card: "Move any favor on
 * it immediately to the matching favor bank. Move any secrets on it to the
 * acting player's board and flip them facedown."
 *
 * Both `card.play` (§5.1.4.2's adviser-limit discard) and `adviser.play`
 * (§6.1) previously refused outright when the card carried tokens, with a
 * "not yet supported — see v2" note. That was a live breach of the v1
 * bargain rather than a tidy deferral: a DECLARED power (D9/D28) can put a
 * secret on an adviser today, and the player then had no legal way to
 * discard it. Unit 16d found the same shape for Supply.
 *
 * The secrets land FACEDOWN, which is the one piece the effect vocabulary
 * still cannot address — `seatSecrets` names the ready pool only, a gap
 * `effects.ts` has carried since unit 3 — so the flipped pool is written
 * directly here, the same way `turn.ts`'s Rest sweep writes it.
 */

import { byId } from '../cards/index.js';
import type { CardInPlay, OathState } from './state.js';

/**
 * Strips a discarded card's tokens, mutating `state`. Call BEFORE the card
 * moves, while it is still findable. `seat` is the acting player, who
 * receives the secrets (§10.5 says "the acting player's board").
 */
export function stripDiscardedTokens(state: OathState, seat: number, card: CardInPlay): void {
  if (card.favor > 0) {
    const resolved = byId(card.id);
    if ('suit' in resolved) state.favorBanks[resolved.suit] += card.favor;
    else state.sharedBank.favor += card.favor; // no suit to match (a ruin, §2.9)
    card.favor = 0;
  }
  if (card.secrets > 0) {
    state.players[seat].secrets.flipped += card.secrets; // §10.5: facedown
    card.secrets = 0;
  }
}
