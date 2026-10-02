/**
 * Seats are named the way the table names them (unit 11): "Chancellor",
 * "<Colour> Exile", "<Colour> Citizen" — never "seat N" — and the names
 * reach the forms where a player is chosen, like a campaign's defender.
 */

import { describe, it, expect } from 'vitest';
import { seatTitle, seatColors } from '../../../src/oath/game/seats.js';
import { oath } from '../../../src/oath/game/index.js';
import type { Affordance } from '../../../src/oath/game/affordances.js';
import { baseState } from './helpers.js';
import { composer } from '../../../src/client/composer.js';

describe('seatTitle', () => {
  const players = [{ citizenship: 'chancellor' }, { citizenship: 'exile' }, { citizenship: 'citizen' }, { citizenship: 'exile' }];

  it('names the Chancellor, then each other seat by its colour and role', () => {
    expect(players.map((_, i) => seatTitle(players, i))).toEqual(['Chancellor', 'Red Exile', 'Blue Citizen', 'Yellow Exile']);
  });

  it('keeps a seat\'s colour when its role changes (an Exile becoming a Citizen)', () => {
    const after = players.map((p, i) => (i === 1 ? { citizenship: 'citizen' } : p));
    expect(seatColors(after)).toEqual(seatColors(players));
    expect(seatTitle(after, 1)).toBe('Red Citizen');
  });
});

describe('a campaign is declared against a named player, not a seat number', () => {
  it('labels each defender by seat title', () => {
    const s = baseState();
    s.players[2].pawnSite = s.sites[5].id; // seat 2 shares the attacker's site
    const declares = (oath.affordances!(s, 1) as Affordance[]).filter((e) => e.type === 'campaign.declare');
    const labels = declares.flatMap((e) => e.fields.find((f) => f.name === 'defender')!).flatMap((f) => ('options' in f ? f.options.map((o) => o.label) : []));
    expect(labels.length).toBeGreaterThan(0);
    for (const l of labels) expect(l).toMatch(/^(Chancellor|(Red|Blue|Yellow|White|Black) (Exile|Citizen)|the bandits)$/);
  });
});

describe('a one-answer choice (Ben, 2026-10-01)', () => {
  const s = baseState();
  s.players[2].pawnSite = s.sites[5].id;
  const declares = (oath.affordances!(s, 1) as Affordance[]).filter((e) => e.type === 'campaign.declare');

  it('in its own box is still shown and picked: the title is just the action', () => {
    expect(declares).toHaveLength(1);
    const html = composer(declares, { gameId: 'g', seq: 1, back: '/' }).value;
    expect(html).toMatch(/<summary>Campaign<\/summary>|<summary>Campaign <span class="note">/);
    expect(html).toMatch(/<input type="radio" name="defender" value="2"[^>]*required>[^<]*<span>Blue Exile<\/span>/);
    expect(html).not.toMatch(/name="defender" value="2" checked/);
  });

  it('inside a picker box is carried by the picker, not asked again', () => {
    const two = [declares[0], { ...declares[0], fields: declares[0].fields.map((f) => (f.name === 'defender' ? { ...f, options: [{ value: 0, label: 'Chancellor' }] } : f)) }] as Affordance[];
    const html = composer(two, { gameId: 'g', seq: 1, back: '/' }).value;
    expect(html).toContain('data-variant-pick checked> Blue Exile');
    expect(html).toMatch(/<input type="hidden" name="defender" value="2">/);
    expect(html).not.toMatch(/type="radio" name="defender"/);
  });
});

describe('a Plains/Mountain target says what it does to the attack dice (Law §11.4; Ben, 2026-10-01)', () => {
  it('labels the change where the target is chosen', async () => {
    const { siteAttackModifier } = await import('../../../src/oath/game/affordances.js');
    expect(siteAttackModifier('Mountain')).toBe(', −1 attack die (Law §11.4)');
    expect(siteAttackModifier('Plains')).toBe(', +1 attack die (Law §11.4)');
    expect(siteAttackModifier('Mine')).toBe('');
  });
});
