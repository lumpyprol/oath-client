import { describe, it, expect } from 'vitest';
import { slugify, cardId } from '../../../src/oath/cards/ids.js';
import { ID_RE } from '../../../src/oath/cards/schema.js';

const SLUG_RE = /^[a-z0-9-]+$/;

const cases: [string, string][] = [
  ["Tinker's Fair", 'tinkers-fair'],
  ['Long-Lost Heir', 'long-lost-heir'],
  ['The Hidden Place', 'hidden-place'],
  ['The Drowned City', 'drowned-city'],
  ['A Small Favor', 'a-small-favor'], // leading "A " is NOT dropped
  ['Sprawling Rampart / Bandit Rampart', 'sprawling-rampart'],
  ["The People's Favor / The Mob's Favor", 'peoples-favor'],
  ['Spider’s Nest', 'spiders-nest'], // curly apostrophe
  ['  Brass   Horse  ', 'brass-horse'],
  ['THE Marena Family', 'marena-family'],
];

describe('slugify', () => {
  for (const [input, expected] of cases) {
    it(`${JSON.stringify(input)} -> ${expected}`, () => {
      const slug = slugify(input);
      expect(slug).toBe(expected);
      expect(slug).toMatch(SLUG_RE);
    });
  }

  it('throws on an empty name', () => {
    expect(() => slugify('')).toThrow();
  });

  it('throws on a whitespace-only name', () => {
    expect(() => slugify('   ')).toThrow();
  });

  it('throws on a name with no alphanumerics', () => {
    expect(() => slugify('---')).toThrow();
  });
});

describe('cardId', () => {
  it('prefixes the kind', () => {
    expect(cardId('relic', 'Brass Horse')).toBe('relic:brass-horse');
    expect(cardId('site', 'The Hidden Place')).toBe('site:hidden-place');
  });

  it('every produced id satisfies the schema id regex', () => {
    const kinds = ['denizen', 'site', 'relic', 'vision', 'edifice', 'banner'] as const;
    for (const kind of kinds) {
      for (const [input] of cases) {
        expect(cardId(kind, input)).toMatch(ID_RE);
      }
    }
  });
});
