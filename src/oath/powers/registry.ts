/**
 * The v2 enforcement seam (unit 15; HLD D28/D34). `power.use`'s `prepare()`
 * checks this registry: if a card's id is here, its impl PRODUCES the
 * effects (the player's declared ones are ignored); if not, the player's
 * declaration passes through unchanged. Same payload shape either way, so
 * the log and reducer never need to know which path a given `power.use`
 * took.
 *
 * This is the ONLY file `power.ts` imports from `oath/powers/`. The
 * registry ships EMPTY in src/ throughout P2 (HLD's enforcement-creep
 * risk, §9) — `registrySize()` should be 0 in every non-test build. One
 * card is implemented, but only INSIDE `registry.test.ts`, to prove the
 * seam works without starting the "just a few cards" slide.
 */

import type { Effect } from '../game/effects.js';
import type { OathState } from '../game/state.js';

/**
 * Produces the effects a card's power resolves to, given the acting seat
 * and whatever choices the player made (a target, a suit, an amount — the
 * impl defines its own shape). Pure: same inputs, same effects, every time
 * — `prepare()` calls this at append time, same as any other randomness-
 * free computation there.
 */
export type PowerImpl = (state: OathState, seat: number, choices: unknown) => Effect[];

const registry: Record<string, PowerImpl> = {};

/** Throws if `cardId` is already registered — a duplicate is a programming error, not a game rule. */
export function register(cardId: string, impl: PowerImpl): void {
  if (registry[cardId]) {
    throw new Error(`powers/registry: ${cardId} is already registered`);
  }
  registry[cardId] = impl;
}

export function lookup(cardId: string): PowerImpl | undefined {
  return registry[cardId];
}

export function registrySize(): number {
  return Object.keys(registry).length;
}

/** Test-only. Never called from anywhere under src/ outside a test file. */
export function __resetRegistryForTests(): void {
  for (const cardId of Object.keys(registry)) delete registry[cardId];
}
