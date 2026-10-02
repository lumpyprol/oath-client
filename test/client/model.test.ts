/**
 * Unit 9: the pure inbox model. Assertions go on the MODEL, per the pattern
 * this unit establishes.
 */

import { describe, it, expect } from 'vitest';
import { humanizeAge, inboxModel, type InboxDecision } from '../../src/client/model.js';

const NOW = Date.parse('2026-09-13T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

function decision(over: Partial<InboxDecision>): InboxDecision {
  return {
    id: 'turn:0:1',
    seat: 0,
    kind: 'turn',
    prompt: 'It is your turn.',
    resolves: ['turn.rest'],
    since: ago(0),
    url: '/games/g/decisions/turn:0:1',
    ...over,
  };
}

describe('humanizeAge', () => {
  it('renders days / hours / minutes / just now, pluralised', () => {
    expect(humanizeAge(ago(3 * 86400_000), NOW)).toBe('3 days');
    expect(humanizeAge(ago(1 * 86400_000), NOW)).toBe('1 day');
    expect(humanizeAge(ago(2 * 3600_000), NOW)).toBe('2 hours');
    expect(humanizeAge(ago(1 * 3600_000), NOW)).toBe('1 hour');
    expect(humanizeAge(ago(5 * 60_000), NOW)).toBe('5 minutes');
    expect(humanizeAge(ago(10_000), NOW)).toBe('just now');
  });

  it('is "unknown" for a null or unparseable timestamp', () => {
    expect(humanizeAge(null, NOW)).toBe('unknown');
    expect(humanizeAge('not-a-date', NOW)).toBe('unknown');
  });
});

describe('inboxModel', () => {
  it('sorts your decisions oldest-first and computes each age', () => {
    const m = inboxModel(
      {
        gameId: 'g',
        waitingOnYou: [
          decision({ id: 'a', since: ago(60_000), prompt: 'newer' }),
          decision({ id: 'b', since: ago(3 * 86400_000), prompt: 'oldest' }),
          decision({ id: 'c', since: ago(2 * 3600_000), prompt: 'middle' }),
        ],
        waitingOnOthers: [],
      },
      NOW,
    );
    expect(m.waitingOnYou.map((e) => e.prompt)).toEqual(['oldest', 'middle', 'newer']);
    expect(m.waitingOnYou[0].age).toBe('3 days');
    expect(m.empty).toBe(false);
  });

  it('flags an empty own-inbox', () => {
    const m = inboxModel({ gameId: 'g', waitingOnYou: [], waitingOnOthers: [] }, NOW);
    expect(m.empty).toBe(true);
    expect(m.waitingOnYou).toEqual([]);
  });

  it('summarises other seats by KIND, never echoing their prompt (no leak)', () => {
    const secret = 'Resolve your Wake: place a specific favor...';
    const m = inboxModel(
      {
        gameId: 'g',
        waitingOnYou: [],
        waitingOnOthers: [decision({ seat: 2, kind: 'wake', prompt: secret })],
      },
      NOW,
    );
    expect(m.waitingOnOthers).toEqual([{ seat: 2, who: 'seat 2', label: 'resolving their Wake Phase' }]);
    // The other seat's prompt text never appears in the summary.
    expect(JSON.stringify(m.waitingOnOthers)).not.toContain('favor');
  });

  it('links the board and history for the game', () => {
    const m = inboxModel({ gameId: 'abc', waitingOnYou: [], waitingOnOthers: [] }, NOW);
    expect(m.boardUrl).toBe('/games/abc');
    expect(m.historyUrl).toBe('/games/abc/history');
  });
});
