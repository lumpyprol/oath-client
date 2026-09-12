/**
 * Unit 1 of Phase 3: the visit metric.
 *
 * A VISIT is a maximal run of consecutive actions by the same actor. A
 * player who submits three actions in a row without anyone else acting in
 * between spent one visit, no matter how many actions that was; a player
 * who acts, waits for someone else, then acts again spent two.
 *
 * This is a TEST HELPER, not engine code (the plan is explicit: P3 adds no
 * new subsystem, so nothing here is a runtime concern) — it exists purely
 * to measure what units 3-9 are shrinking.
 */

export interface LoggedAction {
  type: string;
  actor: number | null;
}

export interface VisitMetrics {
  /** Visits per turn, in log order. A turn is the run of actions up to and
   * including a `turn.rest`, or a final trailing run with none. */
  turns: number[];
  /** Visits per campaign (a contiguous run of `campaign.*` actions), in log order. */
  campaigns: number[];
}

/** Maximal runs of the same actor, counted. */
function visitsIn(actions: LoggedAction[]): number {
  let visits = 0;
  let last: number | null | undefined;
  for (const a of actions) {
    if (a.actor !== last) {
      visits += 1;
      last = a.actor;
    }
  }
  return visits;
}

export function computeVisitMetrics(log: LoggedAction[]): VisitMetrics {
  const real = log.filter((a) => a.type !== 'game.created');

  const turnBuckets: LoggedAction[][] = [];
  let turn: LoggedAction[] = [];
  for (const a of real) {
    turn.push(a);
    if (a.type === 'turn.rest') {
      turnBuckets.push(turn);
      turn = [];
    }
  }
  if (turn.length > 0) turnBuckets.push(turn);

  const campaignBuckets: LoggedAction[][] = [];
  let campaign: LoggedAction[] = [];
  for (const a of real) {
    if (a.type.startsWith('campaign.')) {
      campaign.push(a);
    } else if (campaign.length > 0) {
      campaignBuckets.push(campaign);
      campaign = [];
    }
  }
  if (campaign.length > 0) campaignBuckets.push(campaign);

  return {
    turns: turnBuckets.map(visitsIn),
    campaigns: campaignBuckets.map(visitsIn),
  };
}

export function summarize(ns: number[]): { avg: number; max: number } {
  if (ns.length === 0) throw new Error('summarize: cannot summarize an empty list');
  return { avg: ns.reduce((a, b) => a + b, 0) / ns.length, max: Math.max(...ns) };
}
