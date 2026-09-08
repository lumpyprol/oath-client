/**
 * One-shot randomness. Used ONLY in `setup()` and `prepare()` — never in a
 * reducer. Reducers are pure: anything random has already been decided and
 * persisted by the time they run.
 */

import { randomInt } from 'node:crypto';

/** Fisher-Yates. Returns a new array. */
export function shuffle<T>(items: readonly T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Oath's dice have custom faces, so pass them in. */
export function rollDice<T>(faces: readonly T[], count: number): T[] {
  return Array.from({ length: count }, () => faces[randomInt(faces.length)]);
}
