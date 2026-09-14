/**
 * Shared machinery for the hidden-information audit (unit 20), reused by the
 * rendered-page leak sweep (P4 unit 10). Keeping it in ONE place is the
 * point: the board test must run "audit.test.ts's own whole-string id
 * sweep", not a lookalike that has drifted from it.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { oath } from '../../../src/oath/game/index.js';
import type { OathState } from '../../../src/oath/game/state.js';

export interface Fixture {
  seed: string;
  players: number;
  actions: {
    seq: number;
    type: string;
    actor: number | null;
    payload: unknown;
  }[];
}

export function loadFixture(name: string): Fixture {
  return JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'fixtures', name), 'utf8'));
}

/** Both frozen games — see audit.test.ts's header for why each exists. */
export const FIXTURES: {
  name: string;
  fixture: Fixture;
  setupChoices: 'open' | 'applied';
  endsComplete: boolean;
}[] = [
  { name: '3-player', fixture: loadFixture('fullgame.log.json'), setupChoices: 'open', endsComplete: true },
  { name: '6-player (unit 9)', fixture: loadFixture('sixplayer.log.json'), setupChoices: 'open', endsComplete: false },
];

/**
 * Anything namespaced like a card id. Matching on the PREFIX rather than a
 * list of known ids is what makes this an audit: a card that leaks from a
 * zone nobody thought about still matches.
 */
export const CARD_ID = /^(denizen|vision|relic|site|edifice|banner):/;
/** The same namespaces, matched ANYWHERE in a string (prose, and rendered HTML). */
export const CARD_ID_ANYWHERE = /(denizen|vision|relic|site|edifice|banner):[a-z0-9-]+/g;

/** Every card id anywhere in a value, with the path that reached it. */
export function idsIn(value: unknown, path = '', found = new Map<string, string>()): Map<string, string> {
  if (typeof value === 'string') {
    if (CARD_ID.test(value) && !found.has(value)) found.set(value, path);
    return found;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => idsIn(v, `${path}[${i}]`, found));
    return found;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) idsIn(v, path ? `${path}.${k}` : k, found);
  }
  return found;
}

/**
 * Fold into `known` every card id `seat` can legitimately see in `state`.
 * Read from TRUE state — deriving this from the projection would just assert
 * that the projection equals itself. `seat === null` is a spectator.
 */
export function learn(state: OathState, seat: number | null, known: Set<string>): void {
  for (const site of state.sites) {
    if (site.facedown) continue;
    known.add(site.id);
    for (const card of site.cards) if (card) known.add(card.id);
  }
  for (const p of state.players) {
    if (p.vision !== null) known.add(p.vision);
    for (const r of p.relics) known.add(r);
    for (const a of p.advisers) if (!a.facedown) known.add(a.id);
  }
  for (const b of state.banners) known.add(b.id);
  if (state.citizenshipOffer) known.add(state.citizenshipOffer.relicId);

  if (seat === null) return;

  for (const id of state.players[seat].hand) known.add(id);
  for (const a of state.players[seat].advisers) known.add(a.id);
  for (const id of state.players[seat].peeked) known.add(id);
}

/** Rebuild a fixture's opening position (both logs are unit-8-era, choices 'open'). */
export function openingState(f: Fixture, setupChoices: 'open' | 'applied'): OathState {
  return oath.init({ ...oath.setup(f.players, { seed: f.seed }), setupChoices });
}

export const nameOf = (seat: number | null): string => (seat === null ? 'spectator' : `seat ${seat}`);
