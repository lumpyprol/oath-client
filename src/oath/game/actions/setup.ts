/**
 * `setup.choose` (P3 unit 8) — Law §1.23's two setup choices, made by the
 * player whose choices they are. HLD D54.
 *
 * Through P2 these were made FOR the player by `oathSetup`: the pawn went to
 * whichever site the spec listed and the first of the three drawn cards
 * became the facedown adviser. Both were recorded as deferrals (§1.23.1/.2
 * in RULES-COVERAGE), and this is where they come back.
 *
 * ---- THE TWO CHOICES ARE ONE ACTION ------------------------------------
 *
 *   §1.23.1 "each player places their pawn on any faceup site. The
 *           Chancellor must place theirs on the top Cradle site."
 *   §1.23.2 "each player chooses 1 of their 3 cards as a facedown adviser"
 *   §1.23.3 "...and discards the other 2."
 *
 * They are COUPLED, which is why D50 batches them rather than merely
 * allowing it: the Glossary's "Discard" sends a card to the pile for the
 * discarding player's own region, so WHERE the pawn lands decides WHICH
 * pile the two rejects go to. Splitting them would mean a second decision
 * whose legal answers depend on the first — the worst kind of round trip.
 *
 * ---- SEQUENTIAL, AND A FULL LOCK ---------------------------------------
 *
 * §1.23 says "starting with the Chancellor, in turn order", so exactly one
 * seat may choose at a time and `setupChoices.remaining[0]` is that seat.
 * While the sub-state is open NOTHING else is legal — not even
 * `standing.set`, the action unit 6 deliberately left legal everywhere
 * else. The game has not started; there is nothing to gain from a narrower
 * lock, and a lock with no exceptions is the one nobody has to reason about.
 *
 * ---- HIDDEN INFORMATION ------------------------------------------------
 *
 * The payload names `keepIndex`, never a card id — unit 10's `card.play`
 * precedent. The three drawn cards are in the seat's own `hand`, which
 * `project.ts` already redacts from everyone else, so the two discarded
 * cards go facedown into a region pile without their ids ever appearing in
 * the shared log or in another seat's view.
 */

import { z } from 'zod';
import { IllegalAction, type GameAction } from '../../../engine/types.js';
import { discardRegion } from '../map.js';
import type { OathState } from '../state.js';
import type { Handler } from '../turn.js';
import { beginWake } from '../victory.js';

/** Law §1.23.1: "The Chancellor must place theirs on the top Cradle site." */
const CHANCELLOR_SEAT = 0;

const SetupChoosePayloadSchema = z.object({
  siteId: z.string(),
  /** Which of the three drawn cards to keep (Law §1.23.2). Never a card id — see the header. */
  keepIndex: z.number().int().min(0),
});

/** Law §1.23.1's "top Cradle site" — the first Cradle site in board order. */
function topCradleSite(state: OathState): string {
  const site = state.sites.find((s) => s.region === 'cradle');
  if (!site) throw new Error('setup: the board has no Cradle site');
  return site.id;
}

function choose(state: OathState, action: GameAction): OathState {
  const open = state.setupChoices;
  if (!open) throw new IllegalAction('setup.choose: no §1.23 setup choice is pending');
  const seat = open.remaining[0];
  if (action.actor !== seat) {
    throw new IllegalAction(
      `setup.choose: Law §1.23 is in turn order — seat ${seat} chooses next, not seat ${action.actor}`,
    );
  }
  const parsed = SetupChoosePayloadSchema.safeParse(action.payload);
  if (!parsed.success) throw new IllegalAction('setup.choose: malformed payload');
  const { siteId, keepIndex } = parsed.data;

  // --- §1.23.1, the pawn ---
  const site = state.sites.find((s) => s.id === siteId);
  if (!site) throw new IllegalAction(`setup.choose: no site ${siteId}`);
  if (site.facedown) {
    throw new IllegalAction(`setup.choose: ${siteId} is facedown — the pawn goes on a FACEUP site (Law §1.23.1)`);
  }
  if (seat === CHANCELLOR_SEAT) {
    const required = topCradleSite(state);
    if (siteId !== required) {
      throw new IllegalAction(
        `setup.choose: the Chancellor must place their pawn on the top Cradle site, ${required} (Law §1.23.1)`,
      );
    }
  }

  // --- §1.23.2/.3, the adviser and the two discards ---
  const player = state.players[seat];
  if (player.hand.length !== 3) {
    throw new IllegalAction(
      `setup.choose: expected 3 drawn cards for seat ${seat}, found ${player.hand.length} (Law §1.20)`,
    );
  }
  if (keepIndex >= player.hand.length) {
    throw new IllegalAction(`setup.choose: keepIndex ${keepIndex} is out of range (Law §1.23.2)`);
  }

  const kept = player.hand[keepIndex];
  const rejected = player.hand.filter((_, i) => i !== keepIndex);
  // Glossary "Discard": to the pile for the discarding player's region —
  // which is the region of the site they just chose. This is the coupling.
  const discardTo = discardRegion(site.region);

  player.pawnSite = siteId;
  player.hand = [];
  player.advisers = [{ id: kept, facedown: true, favor: 0, secrets: 0 }];
  for (const id of rejected) state.discards[discardTo].push(id);

  // --- advance, and start the game once the last seat has chosen ---
  state.setupChoices = { remaining: open.remaining.slice(1) };
  if (state.setupChoices.remaining.length > 0) return state;

  state.setupChoices = null;
  // Law §4.1: NOW seat 0's turn begins, and a turn begins with its Wake
  // Phase — deferred out of `init` to here, because §1.23 precedes §4.
  return beginWake(state, state.turn.activeSeat);
}

export const SETUP_HANDLERS: Record<string, Handler> = {
  'setup.choose': choose,
};
