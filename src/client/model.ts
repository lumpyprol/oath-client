/**
 * PURE page models (P4 unit 9). The pattern every later page follows: a
 * page's logic is a function from data to a plain object, and the template
 * that renders it is dumb enough that its own tests are only about escaping
 * and structure. Assertions go on the MODEL, here.
 */

/** A pending decision as the inbox sees it — the engine's fields plus the HTTP layer's `since`/`url`. */
export interface InboxDecision {
  id: string;
  seat: number;
  kind: string;
  prompt: string;
  resolves: string[];
  since: string | null;
  url: string;
}

export interface InboxEntry {
  id: string;
  prompt: string;
  url: string;
  /** Human age from `since`, e.g. "3 days". */
  age: string;
}

export interface OtherEntry {
  seat: number;
  /** A non-leaky summary of what that seat is being waited on for. */
  label: string;
}

export interface InboxModel {
  empty: boolean;
  waitingOnYou: InboxEntry[];
  waitingOnOthers: OtherEntry[];
  boardUrl: string;
  historyUrl: string;
}

/** A relative age from an ISO timestamp, against a fixed `nowMs` so it is testable. */
export function humanizeAge(sinceIso: string | null, nowMs: number): string {
  if (sinceIso === null) return 'unknown';
  const then = Date.parse(sinceIso);
  if (Number.isNaN(then)) return 'unknown';
  const secs = Math.max(0, Math.floor((nowMs - then) / 1000));
  if (secs < 60) return 'just now';
  const units: [number, string][] = [
    [86400, 'day'],
    [3600, 'hour'],
    [60, 'minute'],
  ];
  for (const [size, name] of units) {
    if (secs >= size) {
      const n = Math.floor(secs / size);
      return `${n} ${name}${n === 1 ? '' : 's'}`;
    }
  }
  return 'just now';
}

/** A non-leaky, public label for another seat's pending decision — its kind, never its composable specifics. */
const KIND_LABEL: Record<string, string> = {
  turn: 'taking their turn',
  wake: 'resolving their Wake Phase',
  play: 'resolving a Search',
  campaign: 'in a Campaign',
  citizenshipOffer: 'answering a Citizenship offer',
  warbands: 'answering a warband request',
  oathkeeper: 'choosing the Oathkeeper',
  setup: 'setting up',
};

function otherLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}

/** Oldest-first: the decision that has waited longest comes first; unknown `since` sinks to the end. */
function byAgeOldestFirst(a: InboxDecision, b: InboxDecision): number {
  const ta = a.since === null ? Infinity : Date.parse(a.since);
  const tb = b.since === null ? Infinity : Date.parse(b.since);
  return ta - tb;
}

export function inboxModel(
  input: { gameId: string; waitingOnYou: InboxDecision[]; waitingOnOthers: InboxDecision[] },
  nowMs: number,
): InboxModel {
  const mine = [...input.waitingOnYou].sort(byAgeOldestFirst);
  const others = [...input.waitingOnOthers].sort((a, b) => a.seat - b.seat);
  return {
    empty: mine.length === 0,
    waitingOnYou: mine.map((d) => ({
      id: d.id,
      prompt: d.prompt,
      url: d.url,
      age: humanizeAge(d.since, nowMs),
    })),
    // Summarised by kind so a rival's composable specifics never appear.
    waitingOnOthers: others.map((d) => ({ seat: d.seat, label: otherLabel(d.kind) })),
    boardUrl: `/games/${input.gameId}`,
    historyUrl: `/games/${input.gameId}/history`,
  };
}
