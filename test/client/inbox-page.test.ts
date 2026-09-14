/**
 * Unit 9: the inbox TEMPLATE — tests only its escaping and structure (the
 * logic is tested on the model).
 */

import { describe, it, expect } from 'vitest';
import { inboxPage } from '../../src/client/pages/inbox.js';
import type { InboxModel } from '../../src/client/model.js';

const base: InboxModel = {
  empty: false,
  waitingOnYou: [{ id: 'turn:0:1', prompt: 'It is your turn.', url: '/games/g/decisions/turn:0:1', age: '2 hours' }],
  waitingOnOthers: [{ seat: 2, label: 'in a Campaign' }],
  boardUrl: '/games/g',
  historyUrl: '/games/g/history',
};

describe('inboxPage', () => {
  it('renders each decision as a link to its URL, with its age', () => {
    const out = inboxPage(base, { seat: 0, gameId: 'g' });
    expect(out).toContain('href="/games/g/decisions/turn:0:1"');
    expect(out).toContain('It is your turn.');
    expect(out).toContain('2 hours');
    expect(out).toContain('href="/games/g"'); // board
    expect(out).toContain('href="/games/g/history"'); // history
    expect(out).toContain('seat 2 — in a Campaign');
  });

  it('is a full document with the shell (stylesheet, deferred script, skip link, seat)', () => {
    const out = inboxPage(base, { seat: 3, gameId: 'g' });
    expect(out.startsWith('<!doctype html>')).toBe(true);
    expect(out).toContain('<link rel="stylesheet" href="/assets/app.css">');
    expect(out).toContain('<script src="/assets/app.js" defer></script>');
    expect(out).toContain('class="skip-link"');
    expect(out).toContain('seat 3');
  });

  it('escapes a prompt that contains markup', () => {
    const m: InboxModel = { ...base, waitingOnYou: [{ ...base.waitingOnYou[0], prompt: '<script>x</script>' }] };
    const out = inboxPage(m, { seat: 0, gameId: 'g' });
    expect(out).not.toContain('<script>x</script>');
    expect(out).toContain('&lt;script&gt;x&lt;/script&gt;');
  });

  it('shows the empty branch and no inbox list when nothing waits on you', () => {
    const m: InboxModel = { ...base, empty: true, waitingOnYou: [] };
    const out = inboxPage(m, { seat: 0, gameId: 'g' });
    expect(out).toContain('Nothing is waiting on you.');
    expect(out).not.toContain('<ul class="inbox">');
  });
});
