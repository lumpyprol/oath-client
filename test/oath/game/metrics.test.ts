import { describe, it, expect } from 'vitest';
import { computeVisitMetrics, summarize, type LoggedAction } from './metrics.js';

/**
 * Hand-built logs, small enough to hand-count the answer before asserting
 * it, so the metric's definitions (turn boundary, visit) are pinned down
 * before unit 1 trusts it on the real fixture.
 */
describe('computeVisitMetrics (unit 1: the visit metric)', () => {
  it('a single-actor turn is one visit', () => {
    const log: LoggedAction[] = [
      { type: 'game.created', actor: null },
      { type: 'muster', actor: 0 },
      { type: 'travel', actor: 0 },
      { type: 'turn.rest', actor: 0 },
    ];
    const m = computeVisitMetrics(log);
    expect(m.turns).toEqual([1]);
    expect(m.campaigns).toEqual([]);
  });

  it('an actor change mid-turn is a new visit, even with no campaign involved', () => {
    const log: LoggedAction[] = [
      { type: 'muster', actor: 0 },
      { type: 'citizenship.accept', actor: 2 }, // another seat's non-locking action
      { type: 'power.use', actor: 0 },
      { type: 'turn.rest', actor: 0 },
    ];
    // maximal runs: [0], [2], [0,0] -> 3 visits
    expect(computeVisitMetrics(log).turns).toEqual([3]);
  });

  it('the same actor returning later in the SAME turn is still a new visit (not merged with an earlier run)', () => {
    const log: LoggedAction[] = [
      { type: 'muster', actor: 0 },
      { type: 'citizenship.accept', actor: 2 },
      { type: 'power.use', actor: 0 },
      { type: 'travel', actor: 0 },
      { type: 'turn.rest', actor: 0 },
    ];
    // [0], [2], [0,0,0] -> 3 visits, not 2 (the two seat-0 runs don't merge across seat 2's run)
    expect(computeVisitMetrics(log).turns).toEqual([3]);
  });

  it('turns are split at turn.rest boundaries, and a trailing incomplete turn still counts', () => {
    const log: LoggedAction[] = [
      { type: 'muster', actor: 0 },
      { type: 'turn.rest', actor: 0 },
      { type: 'trade', actor: 1 },
      { type: 'travel', actor: 1 },
      { type: 'turn.rest', actor: 1 },
      { type: 'search', actor: 2 }, // game ends mid-turn, no closing rest
    ];
    expect(computeVisitMetrics(log).turns).toEqual([1, 1, 1]);
  });

  it('game.created never starts or counts as a turn', () => {
    const log: LoggedAction[] = [
      { type: 'game.created', actor: null },
      { type: 'turn.rest', actor: 0 },
    ];
    expect(computeVisitMetrics(log).turns).toEqual([1]);
  });

  it('a campaign vs bandits with no interruption is one visit', () => {
    const log: LoggedAction[] = [
      { type: 'muster', actor: 1 },
      { type: 'campaign.declare', actor: 1 },
      { type: 'campaign.roll', actor: 1 },
      { type: 'campaign.resolve', actor: 1 },
      { type: 'campaign.seize', actor: 1 },
      { type: 'turn.rest', actor: 1 },
    ];
    const m = computeVisitMetrics(log);
    expect(m.turns).toEqual([1]); // the whole turn is one uninterrupted actor-1 run
    expect(m.campaigns).toEqual([1]);
  });

  it('a campaign the defender responds to costs the defender one visit and splits the attacker in two', () => {
    const log: LoggedAction[] = [
      { type: 'campaign.declare', actor: 2 },
      { type: 'campaign.respond', actor: 0 },
      { type: 'campaign.roll', actor: 2 },
      { type: 'campaign.resolve', actor: 2 },
      { type: 'turn.rest', actor: 2 },
    ];
    const m = computeVisitMetrics(log);
    // [declare:2], [respond:0], [roll+resolve:2] -> 3 visits
    expect(m.campaigns).toEqual([3]);
  });

  it('two campaigns in the same log are reported separately, in order', () => {
    const log: LoggedAction[] = [
      { type: 'campaign.declare', actor: 1 },
      { type: 'campaign.roll', actor: 1 },
      { type: 'campaign.resolve', actor: 1 },
      { type: 'campaign.seize', actor: 1 },
      { type: 'turn.rest', actor: 1 },
      { type: 'campaign.declare', actor: 2 },
      { type: 'campaign.respond', actor: 0 },
      { type: 'campaign.roll', actor: 2 },
      { type: 'campaign.resolve', actor: 2 },
      { type: 'turn.rest', actor: 2 },
    ];
    expect(computeVisitMetrics(log).campaigns).toEqual([1, 3]);
  });

  it('summarize reports avg and max over a list of visit counts', () => {
    expect(summarize([1, 1, 1, 3, 1, 3, 1])).toEqual({ avg: 11 / 7, max: 3 });
  });

  it('summarize throws on an empty list rather than reporting a fake average', () => {
    expect(() => summarize([])).toThrow();
  });
});
