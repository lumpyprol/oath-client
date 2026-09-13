import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

  it('counts campaign ACTIONS separately from campaign VISITS (P3 unit 4)', () => {
    const log: LoggedAction[] = [
      { type: 'campaign.declare', actor: 1 },
      { type: 'campaign.roll', actor: 1 },
      { type: 'campaign.resolve', actor: 1 },
      { type: 'campaign.seize', actor: 1 },
      { type: 'turn.rest', actor: 1 },
    ];
    const m = computeVisitMetrics(log);
    expect(m.campaigns).toEqual([1]); // one uninterrupted run
    expect(m.campaignActions).toEqual([4]); // ...but four submits
  });

  /**
   * The finding that unit 4 turned up, pinned as a test so it cannot be
   * quietly forgotten: batching consecutive actions by ONE actor cuts the
   * action count but NOT the visit count, because those actions were
   * already one maximal run. A visit is only saved when another seat's
   * action sat between them.
   */
  it('batching one actor\'s consecutive actions cuts actions, not visits', () => {
    const before: LoggedAction[] = [
      { type: 'campaign.declare', actor: 2 },
      { type: 'campaign.respond', actor: 0 },
      { type: 'campaign.roll', actor: 2 },
      { type: 'campaign.resolve', actor: 2 },
    ];
    const after: LoggedAction[] = [
      { type: 'campaign.declare', actor: 2 },
      { type: 'campaign.respond', actor: 0 }, // now carries the dice (D51)
      { type: 'campaign.resolve', actor: 2 }, // now carries the seizure (D50)
    ];
    expect(computeVisitMetrics(before).campaigns).toEqual([3]);
    expect(computeVisitMetrics(after).campaigns).toEqual([3]); // unchanged!
    expect(computeVisitMetrics(before).campaignActions).toEqual([4]);
    expect(computeVisitMetrics(after).campaignActions).toEqual([3]); // this is what moved
  });

  it('...but a visit IS saved when another seat interleaves — the casualties handoff', () => {
    // Old shape: seize came AFTER the Chancellor's casualty allocation, so
    // the attacker had to come back a third time.
    const before: LoggedAction[] = [
      { type: 'campaign.declare', actor: 1 },
      { type: 'campaign.respond', actor: 2 },
      { type: 'campaign.roll', actor: 1 },
      { type: 'campaign.resolve', actor: 1 },
      { type: 'campaign.casualties', actor: 0 },
      { type: 'campaign.seize', actor: 1 },
    ];
    // New shape: the seizure choices rode `resolve`, so the campaign ends
    // with the allocation and the attacker never returns.
    const after: LoggedAction[] = [
      { type: 'campaign.declare', actor: 1 },
      { type: 'campaign.respond', actor: 2 },
      { type: 'campaign.resolve', actor: 1 },
      { type: 'campaign.casualties', actor: 0 },
    ];
    expect(computeVisitMetrics(before).campaigns).toEqual([5]);
    expect(computeVisitMetrics(after).campaigns).toEqual([4]); // a real round trip saved
  });

  it('counts an Ally\'s battle plan as part of the campaign it happens inside', () => {
    // Unit 9's finding: `power.use` inside §5.5.3's window used to split one
    // campaign into two buckets, so the metric IMPROVED the more the
    // campaign was interrupted.
    const log: LoggedAction[] = [
      { type: 'campaign.declare', actor: 3 },
      { type: 'campaign.ally', actor: 1 },
      { type: 'campaign.permit', actor: 0 },
      { type: 'power.use', actor: 1 }, // the permitted Ally's battle plan
      { type: 'campaign.respond', actor: 0 },
      { type: 'campaign.resolve', actor: 3 },
      { type: 'turn.rest', actor: 3 },
    ];
    const m = computeVisitMetrics(log);
    expect(m.campaigns).toEqual([6]); // [3],[1],[0],[1],[0],[3] — one campaign, six visits
    expect(m.campaignActions).toEqual([6]); // the power.use counts too
  });

  it('summarize reports avg and max over a list of visit counts', () => {
    expect(summarize([1, 1, 1, 3, 1, 3, 1])).toEqual({ avg: 11 / 7, max: 3 });
  });

  /**
   * The committed 3-player log's numbers, asserted here so a change that
   * moves them fails loudly instead of quietly making INTERRUPTS.md and the
   * README wrong. (The 6-player log has the same guard in
   * `sixplayer.test.ts`.) Both have drifted once already — the 3p fixture
   * has been regenerated twice, and the docs had to be re-measured by hand
   * the second time because nothing was watching.
   */
  it('the committed 3-player fixture measures what the docs say it does', () => {
    const fixture = JSON.parse(
      readFileSync(join(import.meta.dirname, '..', '..', 'fixtures', 'fullgame.log.json'), 'utf8'),
    ) as { actions: LoggedAction[] };
    const m = computeVisitMetrics(fixture.actions);
    expect(m.turns).toEqual([4, 1, 1, 3, 1, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(summarize(m.turns).avg).toBeCloseTo(1.389, 3);
    expect(summarize(m.turns).max).toBe(4); // the §1.23 setup prologue, not a turn
    expect(m.campaigns).toEqual([1, 3]); // vs bandits; contested with no policies
    expect(m.campaignActions).toEqual([2, 3]);
  });

  it('summarize throws on an empty list rather than reporting a fake average', () => {
    expect(() => summarize([])).toThrow();
  });
});
