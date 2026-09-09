import { describe, it, expect } from 'vitest';
import {
  checkInvariants,
  TOTAL_FAVOR,
  CHANCELLOR_WARBANDS,
  EXILE_WARBANDS,
  ADVISER_LIMIT,
} from '../../../src/oath/game/state.js';
import { baseState } from './helpers.js';

describe('baseState', () => {
  it('passes checkInvariants', () => {
    checkInvariants(baseState());
  });

  it('is plain JSON-serializable data', () => {
    const s = baseState();
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it('applies shallow overrides', () => {
    const s = baseState({ actionCount: 99 });
    expect(s.actionCount).toBe(99);
    checkInvariants(s);
  });
});

describe('checkInvariants failure cases', () => {
  it('names a card id that appears in two zones', () => {
    const s = baseState();
    const dup = s.worldDeck[0];
    s.players[1].hand.push(dup);
    expect(() => checkInvariants(s)).toThrow(dup);
    expect(() => checkInvariants(s)).toThrow(/more than one zone/);
  });

  it('names a card id missing from the card database', () => {
    const s = baseState();
    s.players[1].hand.push('denizen:not-a-real-card');
    expect(() => checkInvariants(s)).toThrow(/denizen:not-a-real-card/);
    expect(() => checkInvariants(s)).toThrow(/card database/);
  });

  it('rejects a site holding more card slots than its capacity', () => {
    const s = baseState();
    // move a card out of the world deck so only capacity is violated
    const extra = s.worldDeck.shift()!; // top of deck is a denizen
    s.sites[0].cards.push({ id: extra, favor: 0, secrets: 0 });
    expect(() => checkInvariants(s)).toThrow(/capacity/);
    expect(() => checkInvariants(s)).toThrow(s.sites[0].id);
  });

  it('catches an exile warband count off by one', () => {
    const s = baseState();
    s.players[1].warbands.bank += 1;
    expect(() => checkInvariants(s)).toThrow(/warband/);
    expect(() => checkInvariants(s)).toThrow(new RegExp(String(EXILE_WARBANDS)));
  });

  it('catches a purple (Chancellor + Citizens) warband count off by one', () => {
    const s = baseState();
    s.players[0].warbands.bank -= 1;
    expect(() => checkInvariants(s)).toThrow(/warband/);
    expect(() => checkInvariants(s)).toThrow(
      new RegExp(String(CHANCELLOR_WARBANDS)),
    );
  });

  it('catches a favor total off by one', () => {
    const s = baseState();
    s.players[2].favor += 1;
    expect(() => checkInvariants(s)).toThrow(/favor/);
    expect(() => checkInvariants(s)).toThrow(new RegExp(String(TOTAL_FAVOR)));
  });

  it('rejects two chancellors', () => {
    const s = baseState();
    s.players[1].citizenship = 'chancellor';
    expect(() => checkInvariants(s)).toThrow(/exactly one chancellor/i);
  });

  it('rejects a chancellor anywhere but seat 0', () => {
    const s = baseState();
    s.players[0].citizenship = 'exile';
    s.players[1].citizenship = 'chancellor';
    expect(() => checkInvariants(s)).toThrow(/seat 0/);
  });

  it('rejects advisers beyond the limit', () => {
    const s = baseState();
    while (s.players[0].advisers.length <= ADVISER_LIMIT) {
      s.players[0].advisers.push({
        id: s.worldDeck.pop()!,
        facedown: false,
        favor: 0,
        secrets: 0,
      });
    }
    expect(() => checkInvariants(s)).toThrow(/adviser/);
    expect(() => checkInvariants(s)).toThrow(new RegExp(String(ADVISER_LIMIT)));
  });

  it('rejects a negative count', () => {
    const s = baseState();
    s.sites[0].warbands[2] = -1;
    expect(() => checkInvariants(s)).toThrow(/negative/);
  });
});
