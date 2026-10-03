import { describe, it, expect } from 'vitest';
import { checkInvariants, type OathState, type ReliquaryModifier } from '../../../src/oath/game/state.js';
import { oath } from '../../../src/oath/game/index.js';
import type { Affordance, Field } from '../../../src/oath/game/affordances.js';
import { worldDeckCost } from '../../../src/oath/game/actions/search.js';
import { baseState } from './helpers.js';
import { auditAffordances } from './affordances.js';
import { act, toRolled } from './campaign-lib.js';

// The Imperial Reliquary's spaces, the Chancellor's once uncovered and always
// applied (Law §2.3, §7.1.1; Ben, 2026-10-03). Decadent is in
// travel-powers.test.ts; Brutal, Careless and Greedy are here.
//
// baseState: seat 0 is the Chancellor, on Cradle slot 0 with 2 warbands
// there and 3 on its board; seats 1 and 2 are Exiles.

/** Uncover `modifier`: its relic leaves the Reliquary (to seat 2, say, a new Citizen's prize). */
function uncover(s: OathState, modifier: ReliquaryModifier): void {
  const space = s.reliquary.find((sp) => sp.modifier === modifier)!;
  s.players[2].relics.push(space.relicId!);
  space.relicId = null;
}

/** The Chancellor's turn. */
function chancellorsTurn(...uncovered: ReliquaryModifier[]): OathState {
  const s = baseState();
  s.turn.activeSeat = 0;
  for (const m of uncovered) uncover(s, m);
  checkInvariants(s);
  return s;
}

const entry = (s: OathState, seat: number, type: string) => (oath.affordances!(s, seat) as Affordance[]).find((a) => a.type === type);
const options = (e: Affordance, name: string) => (e.fields.find((f) => f.name === name) as Extract<Field, { kind: 'choose-one' }>).options;

describe('Greedy: draw two more, never spend over 2 Supply', () => {
  /** A world deck of denizens only (no Vision to stop the draw), costing `cost`. */
  function deckAt(s: OathState, visionsDrawn: number): number {
    s.worldDeck.sort((a, b) => Number(a.startsWith('vision:')) - Number(b.startsWith('vision:')));
    s.visionsDrawn = visionsDrawn;
    return worldDeckCost(visionsDrawn);
  }

  it('the Chancellor draws 5', () => {
    const s = chancellorsTurn('greedy');
    const cost = deckAt(s, 0);
    expect(cost).toBeLessThanOrEqual(2);
    expect(act(s, 'search', 0, { from: 'deck' }).players[0].hand).toHaveLength(5);
    expect(options(entry(s, 0, 'search')!, 'from')[0].label).toMatch(/draw 5 \(Greedy\)/);
    expect(auditAffordances(s, 0)).toEqual([]);
  });

  it('covered, or for anyone else, it is the usual 3', () => {
    const s = chancellorsTurn();
    deckAt(s, 0);
    expect(act(s, 'search', 0, { from: 'deck' }).players[0].hand).toHaveLength(3);
  });

  it('a search costing more than 2 Supply is refused, and the form leaves it out', () => {
    const s = chancellorsTurn('greedy');
    let v = 0;
    while (worldDeckCost(v) <= 2) v += 1;
    deckAt(s, v);
    s.players[0].supply = 7;
    expect(() => act(s, 'search', 0, { from: 'deck' })).toThrow(/Greedy/);
    const search = entry(s, 0, 'search')!;
    expect(options(search, 'from').map((o) => o.value)).toEqual(['discard']);
    expect(search.note).toMatch(/Greedy: the world deck would cost/);
    expect(auditAffordances(s, 0)).toEqual([]);
  });
});

describe('Careless: one more favor, one less secret', () => {
  /** The Chancellor at slot 0, with one suited denizen there and no matching advisers. */
  function trading(careless: boolean): { s: OathState; cardId: string } {
    const s = careless ? chancellorsTurn('careless') : chancellorsTurn();
    s.players[0].advisers = [];
    const cardId = s.sites[0].cards.find((c) => c !== null)!.id;
    return { s, cardId };
  }

  it('trading a secret for favor gains one more', () => {
    const { s, cardId } = trading(true);
    expect(act(s, 'trade', 0, { for: 'favor', cardId }).players[0].favor).toBe(2 + 2); // 1 + Careless
    expect(act(trading(false).s, 'trade', 0, { for: 'favor', cardId }).players[0].favor).toBe(2 + 1);
  });

  it('trading favor for secrets gains a favor too, and one less secret (never below none)', () => {
    const { s, cardId } = trading(true);
    const out = act(s, 'trade', 0, { for: 'secrets', cardId });
    expect(out.players[0].favor).toBe(2 - 2 + 1);
    expect(out.players[0].secrets.ready).toBe(s.players[0].secrets.ready); // 0 matching − 1 → none
    checkInvariants(out);
  });

  it('the form says so', () => {
    const { s } = trading(true);
    expect(options(entry(s, 0, 'trade')!, 'cardId')[0].label).toMatch(/2 favor for a secret, or 0 secrets \+ 1 favor for 2 favor.*\(Careless: \+1 favor, −1 secret\)/);
    expect(auditAffordances(s, 0)).toEqual([]);
  });
});

describe('Brutal: the defeated force is killed outright', () => {
  /** The Chancellor (attacker) against exile seat 2's pawn at slot 0, seat 2 with `board` warbands. */
  function battle(board: number, brutal = true): OathState {
    const s = brutal ? chancellorsTurn('brutal') : chancellorsTurn();
    s.players[2].pawnSite = s.sites[0].id;
    s.players[2].warbands.bank += s.players[2].warbands.board - board;
    s.players[2].warbands.board = board;
    checkInvariants(s);
    return toRolled(s, {
      attacker: 0,
      defender: 2,
      targets: [{ kind: 'pawnFavor' }],
      attackDice: 3,
      attackFaces: ['sword', 'sword', 'sword'],
      defenseFaces: ['blank', 'blank'],
    });
  }

  it('when the Chancellor wins, the defender kills all of their force, not half', () => {
    const won = act(battle(2), 'campaign.resolve', 0, {});
    expect(won.players[2].warbands.board).toBe(0);
    expect(act(battle(2, false), 'campaign.resolve', 0, {}).players[2].warbands.board).toBe(1);
  });

  it('when the Chancellor loses, they kill all of theirs ("even you")', () => {
    const lost = act(battle(3), 'campaign.resolve', 0, {}); // 3 swords vs 3 defending: no win
    expect(lost.players[0].warbands.board).toBe(0);
    expect(act(battle(3, false), 'campaign.resolve', 0, {}).players[0].warbands.board).toBe(2);
  });

  it('the declare form warns of it', () => {
    const s = chancellorsTurn('brutal');
    s.players[2].pawnSite = s.sites[0].id;
    expect(entry(s, 0, 'campaign.declare')!.note).toMatch(/Brutal: whoever is defeated — even you — kills ALL/);
  });
});
