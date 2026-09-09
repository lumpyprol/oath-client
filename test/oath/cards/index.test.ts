import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cards,
  byId,
  findById,
  byName,
  bySaveId,
  denizensBySuit,
  edificeBySuit,
} from '../../../src/oath/cards/index.js';
import { SUITS } from '../../../src/oath/cards/schema.js';
import type { Override } from '../../../src/oath/cards/reconcile.js';

const repo = join(dirname(fileURLToPath(import.meta.url)), '../../../');
const overrides: Override[] = JSON.parse(
  readFileSync(join(repo, 'src/oath/cards/data/overrides.json'), 'utf8'),
);

const everyCard = [
  ...cards.denizens,
  ...cards.sites,
  ...cards.relics,
  ...cards.visions,
  ...cards.edifices,
  ...cards.banners,
];

describe('byId / findById', () => {
  it('round-trips every card in every collection', () => {
    for (const c of everyCard) {
      expect(byId(c.id)).toBe(c);
      expect(findById(c.id)).toBe(c);
    }
  });

  it('throws with the id in the message on an unknown id', () => {
    expect(() => byId('denizen:nope')).toThrow(/denizen:nope/);
    expect(findById('denizen:nope')).toBeUndefined();
  });
});

describe('byName', () => {
  it('is case-insensitive on the printed name', () => {
    const sample = cards.denizens[0];
    expect(byName(sample.name.toUpperCase())).toBe(sample);
    expect(byName(sample.name.toLowerCase())).toBe(sample);
  });

  it('resolves a recorded alias to its card', () => {
    const withAlias = overrides.find((o) => o.aliases.length > 0);
    if (!withAlias) throw new Error('expected at least one override with an alias');
    const alias = withAlias.aliases[0];
    const resolved = byName(alias);
    const names = new Set([resolved.name, ...(resolved.aliases ?? [])]);
    expect(names.has(alias)).toBe(true);
    // the alias resolves to the same card as its canonical name
    expect(byName(resolved.name)).toBe(resolved);
  });

  it('throws on an unknown name', () => {
    expect(() => byName('Definitely Not A Card')).toThrow(/Definitely Not A Card/);
  });
});

describe('bySaveId', () => {
  it("resolves an edifice's ruin saveId to the edifice entity", () => {
    for (const e of cards.edifices) {
      expect(bySaveId('card', e.faces.ruin.saveId)).toBe(e);
      expect(bySaveId('card', e.faces.edifice.saveId)).toBe(e);
    }
  });

  it('site and card numbering can return different cards for the same n', () => {
    const site16 = bySaveId('site', 16);
    const card16 = bySaveId('card', 16);
    expect(site16.id).not.toBe(card16.id);
    expect(site16.id.startsWith('site:')).toBe(true);
    expect(card16.id.startsWith('site:')).toBe(false);
  });

  it('throws on an unknown saveId', () => {
    expect(() => bySaveId('card', 999)).toThrow();
  });
});

describe('denizensBySuit', () => {
  it('returns only denizens of that suit', () => {
    for (const suit of SUITS) {
      for (const d of denizensBySuit(suit)) expect(d.suit).toBe(suit);
    }
  });

  it('the six suit results partition all 198 denizens', () => {
    const seen = new Set<string>();
    let total = 0;
    for (const suit of SUITS) {
      for (const d of denizensBySuit(suit)) {
        expect(seen.has(d.id)).toBe(false);
        seen.add(d.id);
        total += 1;
      }
    }
    expect(total).toBe(198);
    expect(seen.size).toBe(cards.denizens.length);
  });
});

describe('edificeBySuit', () => {
  it('returns the one edifice for each suit', () => {
    for (const suit of SUITS) {
      expect(edificeBySuit(suit).suit).toBe(suit);
    }
  });
});

describe('cards is deep-frozen', () => {
  it('assigning to the top level throws', () => {
    expect(() => {
      // @ts-expect-error runtime immutability check
      cards.denizens = [];
    }).toThrow();
  });

  it('mutating a nested card throws', () => {
    expect(() => {
      // @ts-expect-error runtime immutability check
      cards.denizens[0].name = 'mutated';
    }).toThrow();
  });
});
