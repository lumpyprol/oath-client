/**
 * The Imperial Reliquary board's four spaces, as printed (Law §2.3) — the
 * board text, not card text, so it is not in the card database. Transcribed
 * in RULINGS.md (2026-09-11) from the Playbook's component reference, p.3.
 * Each is a Major Action Modifier (§7.4) the Chancellor always has once its
 * covering relic is gone (§7.1.1). Shown on the board so everyone can read
 * them, covered or not (Ben, 2026-10-03).
 */

import type { OathState, ReliquaryModifier } from './state.js';

export interface ReliquaryText {
  /** The major action it modifies. */
  action: string;
  text: string;
}

export const RELIQUARY_TEXT: Record<ReliquaryModifier, ReliquaryText> = {
  brutal: {
    action: 'Campaign',
    text: "If you're the attacker, the defeated player (even you) must kill all the warbands in their force.",
  },
  decadent: {
    action: 'Travel',
    text: "Spend no Supply if you're traveling to a site in the Cradle from a site in the Provinces or Hinterland. If you're traveling to a site in the Hinterland, increase the Travel cost by 1 Supply.",
  },
  careless: {
    action: 'Trade',
    text: 'You gain one more favor (even when trading for secrets). You must gain one less secret when trading for secrets.',
  },
  greedy: {
    action: 'Search',
    text: 'Draw two more cards. (Stop after a Vision as normal.) You cannot search if you would spend more than 2 Supply.',
  },
};

/**
 * Whether `seat` has the Reliquary space `modifier`: the Chancellor, once its
 * covering relic is gone. "The Chancellor always has the mandatory powers on
 * the uncovered spaces" (Law §7.1.1) — so the engine applies them, rather
 * than asking (RULINGS 2026-10-03).
 */
export function chancellorHas(state: OathState, seat: number, modifier: ReliquaryModifier): boolean {
  return (
    state.players[seat].citizenship === 'chancellor' &&
    state.reliquary.some((sp) => sp.modifier === modifier && sp.relicId === null)
  );
}
