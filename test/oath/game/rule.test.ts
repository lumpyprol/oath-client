import { describe, it, expect } from 'vitest';
import { rulersOf, imperialExclusionFor } from '../../../src/oath/game/rule.js';
import { baseState } from './helpers.js';

// baseState: seat 0 = Chancellor, seats 1/2 = Exile, sites[0]/[2] carry
// seat 0's warbands, sites[5] carries seat 1's. None facedown.

describe('rulersOf (Law §10.21, §6.6.3)', () => {
  it("Law §10.21's base rule: an Exile rules a site with only their own warbands", () => {
    const s = baseState();
    expect(rulersOf(s, s.sites[5].id)).toEqual([1]);
  });

  it('a lone Imperial seat (just the Chancellor) rules their own site, same as the base rule', () => {
    const s = baseState();
    expect(rulersOf(s, s.sites[0].id)).toEqual([0]);
  });

  it('a facedown site has no rulers', () => {
    const s = baseState();
    s.sites[5].facedown = true;
    expect(rulersOf(s, s.sites[5].id)).toEqual([]);
  });

  it('a site with zero warbands anywhere has no rulers', () => {
    const s = baseState();
    expect(rulersOf(s, s.sites[1].id)).toEqual([]); // sites[1] carries none in the fixture
  });

  it('§6.6.3: once a second Imperial seat exists, ANY purple presence makes every Imperial seat a ruler', () => {
    const s = baseState();
    s.players[2].citizenship = 'citizen'; // now Imperial alongside seat 0
    // sites[2] already carries seat 0's (purple) warbands in the fixture
    expect(rulersOf(s, s.sites[2].id).sort()).toEqual([0, 2]);
  });

  it("§5.5.1's carve-out: an excluded seat is NOT counted as a ruler via the Imperial extension", () => {
    const s = baseState();
    s.players[2].citizenship = 'citizen';
    expect(rulersOf(s, s.sites[2].id, [2])).toEqual([0]);
    expect(rulersOf(s, s.sites[2].id, [0])).toEqual([2]);
  });

  it('an excluded seat with their OWN direct warbands there is still suspended from the Imperial extension, but the base rule never applied to them anyway if excluded (no direct presence in this fixture)', () => {
    const s = baseState();
    s.players[2].citizenship = 'citizen';
    s.players[2].warbands.bank -= 1;
    s.sites[2].warbands[2] = 1; // seat 2 now ALSO has direct purple presence at sites[2]
    // excluding seat 2 removes it from the Imperial-extension grant, but it
    // still directly holds warbands there — Law §10.21's base rule is
    // unaffected by a Campaign-scoped Imperial-status suspension.
    expect(rulersOf(s, s.sites[2].id, [2]).sort()).toEqual([0]);
  });

  it('an Exile and an Imperial seat can both rule the same site simultaneously', () => {
    const s = baseState();
    s.players[2].citizenship = 'citizen';
    s.sites[5].warbands[2] = 1; // seat 2 (citizen, purple) joins seat 1 (exile) at sites[5]
    s.players[2].warbands.bank -= 1;
    expect(rulersOf(s, s.sites[5].id).sort()).toEqual([0, 1, 2]); // exile ruler + every Imperial seat
  });
});

describe('imperialExclusionFor (Law §5.5.1)', () => {
  it('bandits defending: no exclusion (no player to suspend)', () => {
    const s = baseState();
    expect(imperialExclusionFor(s, 1, 'bandits')).toEqual([]);
  });

  it('a Citizen attacking the Chancellor: the attacker is suspended', () => {
    const s = baseState();
    s.players[1].citizenship = 'citizen';
    expect(imperialExclusionFor(s, 1, 0)).toEqual([1]);
  });

  it('a Citizen attacking another Citizen: the attacker is suspended', () => {
    const s = baseState();
    s.players[1].citizenship = 'citizen';
    s.players[2].citizenship = 'citizen';
    expect(imperialExclusionFor(s, 1, 2)).toEqual([1]);
  });

  it('the Chancellor attacking a Citizen: the DEFENDER is suspended', () => {
    const s = baseState();
    s.players[1].citizenship = 'citizen';
    expect(imperialExclusionFor(s, 0, 1)).toEqual([1]);
  });

  it('the Chancellor attacking an Exile: no exclusion (no Imperial-vs-Imperial conflict)', () => {
    const s = baseState();
    expect(imperialExclusionFor(s, 0, 1)).toEqual([]);
  });

  it('a Citizen attacking an Exile: no exclusion', () => {
    const s = baseState();
    s.players[1].citizenship = 'citizen';
    expect(imperialExclusionFor(s, 1, 2)).toEqual([]);
  });

  it('an Exile attacking the Chancellor: no exclusion (the attacker was never Imperial)', () => {
    const s = baseState();
    expect(imperialExclusionFor(s, 1, 0)).toEqual([]);
  });
});
