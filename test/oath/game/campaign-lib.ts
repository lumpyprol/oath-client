/**
 * Campaign state builders shared by campaign tests (moved out of
 * allies.test.ts for unit 11, whose seizure/casualty affordance tests need
 * the same hand-computed Imperial campaign).
 */

import { checkInvariants, type OathState } from '../../../src/oath/game/state.js';
import { oath } from '../../../src/oath/game/index.js';
import type { GameAction } from '../../../src/engine/types.js';
import { baseState } from './helpers.js';

export function act(state: OathState, type: string, actor: number | null, payload: unknown = {}): OathState {
  const action: GameAction = {
    gameId: 'test',
    seq: state.actionCount + 1,
    type,
    actor,
    payload,
    createdAt: '2026-09-11T00:00:00.000Z',
  };
  return oath.reduce(structuredClone(state), action);
}

export interface RollOpts {
  attacker: number;
  defender: number | 'bandits';
  targets: unknown[];
  attackDice: number;
  attackFaces: string[];
  defenseFaces: string[];
}

/**
 * declare -> (respond), leaving the campaign in phase 'rolled'.
 *
 * P3 unit 4 (D51): the dice ride the action that CLOSES the response window,
 * so these tests hand the faces to `campaign.respond` — or to
 * `campaign.declare` itself against bandits, where no window ever opens.
 * There is no `campaign.roll` any more. (These tests drive `reduce` directly,
 * so they supply the faces `prepare()` would otherwise have rolled — exactly
 * as they always did for `campaign.roll`.)
 */
export function toRolled(s: OathState, o: RollOpts): OathState {
  const faces = { attackFaces: o.attackFaces, defenseFaces: o.defenseFaces };
  const declaration = { defender: o.defender, targets: o.targets, attackDice: o.attackDice };
  if (o.defender === 'bandits') {
    return act(s, 'campaign.declare', o.attacker, { ...declaration, ...faces });
  }
  const declared = act(s, 'campaign.declare', o.attacker, declaration);
  return act(declared, 'campaign.respond', o.defender as number, faces);
}

/**
 * baseState with seat 2 flipped to Citizen, and seat 1 (an Exile, already
 * the active seat with 2 warbands at their own site) set up to attack them.
 *
 * Purple is ONE 24-warband pool shared by the Chancellor and every Citizen
 * (Law §1.15), so the Chancellor's bank is rebalanced to keep conservation
 * exact: seat 0 holds 21 (bank 15 + board 3 + 2 at sites[0] + 1 at sites[2]),
 * seat 2 holds 3 (all on their board).
 *
 * Sites, for the hand-computed totals below: sites[0] = Mine (2 Chancellor
 * warbands), sites[5] = River (2 of seat 1's, and both pawns). Neither is
 * Plains or Mountain, so §11.4's attack-die modifier stays out of the way.
 */
export function imperialState(): OathState {
  const s = baseState();
  s.players[2].citizenship = 'citizen';
  s.players[2].warbands = { bank: 0, board: 3 };
  s.players[0].warbands.bank = 15;
  s.players[2].pawnSite = s.sites[5].id; // the defender's pawn, at the attacker's site
  // The Chancellor mandatorily joins as an Ally (part 2, §5.5.2), but their
  // pawn is parked at an untargeted site, so §5.5.4's own pawn test keeps
  // their BOARD out of the force — the "Ally who contributes nothing" case.
  // That keeps part 1's hand-computed totals about part 1's concern; the
  // part 2 describes below move this pawn deliberately.
  s.players[0].pawnSite = s.sites[2].id;
  s.turn.activeSeat = 1;
  checkInvariants(s);
  return s;
}


/** seat 1 attacks Citizen seat 2: a site target (Mine) and their pawn & favor. 3 swords vs 5 defense. */
export function imperialRolled(): OathState {
  const s = imperialState();
  return toRolled(s, {
    attacker: 1,
    defender: 2,
    targets: [{ kind: 'site', siteId: s.sites[0].id }, { kind: 'pawnFavor' }],
    attackDice: 3,
    attackFaces: ['sword', 'sword', 'sword'],
    defenseFaces: ['blank', 'blank', 'blank', 'blank'],
  });
}

