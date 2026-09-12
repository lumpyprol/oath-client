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
  /**
   * ACTIONS per campaign, in log order — the other half of the picture, added
   * in P3 unit 4 once it turned out the two move independently.
   *
   * A visit is a maximal same-actor run, so several consecutive actions by
   * ONE player collapse into one visit. Batching them (D50) therefore cuts
   * actions without cutting visits, UNLESS another seat acts in between —
   * which is exactly when the batching was buying a real round trip. Both
   * numbers matter and neither substitutes for the other: visits are the
   * async wall-clock cost, actions are the client's submit count and the
   * log's length.
   */
  campaignActions: number[];
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

  // A campaign spans from `campaign.declare` to the end of the campaign, and
  // COUNTS EVERYTHING IN BETWEEN — including actions that are not
  // `campaign.*` at all.
  //
  // That last part was a real flaw, found by unit 9's six-player game: a
  // Citizen Ally using a battle plan inside §5.5.3's window submits a
  // `power.use`, which used to split one campaign into two buckets and
  // undercount both. The whole point of unit 5 is that an Ally CAN act in
  // that window, so the metric has to treat their action as part of the
  // campaign it happens inside — otherwise the number gets better the more
  // interruption there is, which is backwards.
  //
  // A campaign always resolves inside the attacker's own turn, so
  // `turn.rest` is a safe terminator for the span.
  const campaignBuckets: LoggedAction[][] = [];
  for (let i = 0; i < real.length; i++) {
    if (real[i].type !== 'campaign.declare') continue;
    let end = i;
    for (let j = i + 1; j < real.length; j++) {
      if (real[j].type === 'turn.rest' || real[j].type === 'campaign.declare') break;
      if (real[j].type.startsWith('campaign.')) end = j; // the last campaign action in the span
    }
    campaignBuckets.push(real.slice(i, end + 1));
    i = end;
  }

  return {
    turns: turnBuckets.map(visitsIn),
    campaigns: campaignBuckets.map(visitsIn),
    campaignActions: campaignBuckets.map((b) => b.length),
  };
}

export function summarize(ns: number[]): { avg: number; max: number } {
  if (ns.length === 0) throw new Error('summarize: cannot summarize an empty list');
  return { avg: ns.reduce((a, b) => a + b, 0) / ns.length, max: Math.max(...ns) };
}
