/**
 * The declared-power builder's vocabulary (P4 unit 11): one example of every
 * Effect kind (effects.ts, HLD D28/D33), offered under `power.use`'s `effects`
 * field. With the script, "Add" appends the example to the effects list;
 * without it, the examples are there to copy. Either way the engine is the
 * judge — "Check this" dry-runs the declaration before it costs a log entry.
 *
 * The examples use the player's own seat and PLACEHOLDER ids (CARD_ID,
 * SITE_ID) — never a real card or site, since a template may not name one
 * that did not come from an affordance. A test parses every example against
 * EffectSchema and checks every kind is covered, so this list cannot drift
 * from the vocabulary it describes.
 */

import { html, type Raw } from './html.js';
import { SUITS } from '../oath/cards/schema.js';

export interface EffectExample {
  kind: string;
  what: string;
  effect: Record<string, unknown>;
}

export function effectExamples(seat: number): EffectExample[] {
  return [
    { kind: 'favor', what: 'move favor between zones', effect: { kind: 'favor', from: { kind: 'seatFavor', seat }, to: { kind: 'favorBank', suit: SUITS[0] }, amount: 1 } },
    { kind: 'secret', what: 'move secrets between zones', effect: { kind: 'secret', from: { kind: 'seatSecrets', seat }, to: { kind: 'sharedSecrets' }, amount: 1 } },
    { kind: 'warbands', what: 'move warbands between zones', effect: { kind: 'warbands', from: { kind: 'seatWarbandBank', seat }, to: { kind: 'seatWarbandBoard', seat }, amount: 1 } },
    { kind: 'card', what: 'move a named card', effect: { kind: 'card', id: 'CARD_ID', from: { kind: 'seatHand', seat }, to: { kind: 'seatAdvisers', seat } } },
    { kind: 'draw', what: 'move the top card of a pile', effect: { kind: 'draw', from: { kind: 'worldDeck' }, to: { kind: 'seatHand', seat } } },
    { kind: 'flip', what: 'turn a card or site over', effect: { kind: 'flip', target: { kind: 'site', siteId: 'SITE_ID' } } },
    { kind: 'supply', what: 'move your Supply marker', effect: { kind: 'supply', seat, delta: 1 } },
  ];
}

export function effectsHelp(seat: number): Raw {
  return html`<details class="vocab"><summary>Effect vocabulary</summary>
    <p class="muted">Replace CARD_ID / SITE_ID with real ids. Zones: seatFavor, favorBank, sharedFavor, siteFavor, siteCardFavor, adviserFavor, bannerFavor (favor); seatSecrets, sharedSecrets, siteSecrets, siteCardSecrets, adviserSecrets, bannerSecrets (secrets); seatWarbandBank, seatWarbandBoard, siteWarbands (warbands); seatHand, seatAdvisers, seatRelics, seatVision, siteSlot, siteRelics, worldDeck, relicDeck, discard, dispossessed, reliquary (cards).</p>
    <ul class="vocab-list">${effectExamples(seat).map(
      (x) => html`<li><span class="vocab-kind">${x.kind}</span> <span class="muted">${x.what}</span>
        <code>${JSON.stringify(x.effect)}</code>
        <button type="button" class="vocab-add" data-effect="${JSON.stringify(x.effect)}">Add</button></li>`,
    )}</ul>
  </details>`;
}
