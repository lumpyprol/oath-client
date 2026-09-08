import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCardsLua } from '../../../src/oath/cards/lua.js';

const here = dirname(fileURLToPath(import.meta.url));
const realFile = readFileSync(
  join(here, '../../../vendor/oathparser/cards.lua'),
  'utf8',
);

describe('parseCardsLua — snippets', () => {
  it('parses a three-record snippet with correct value types', () => {
    const src = `
function onLoad()
  cardsTable = {
    ["Mine"]         = { saveid = 0, ttscardid = "10000", cardtype = "Site", capacity = 1, relicCount = 1 },
    ["Wrestlers"]    = { saveid = 0, suit = "Order", cardtype = "Denizen" },
    ["Brass Horse"]  = { saveid = 220, cardtype = "Relic" }
  }
end`;
    const recs = parseCardsLua(src);
    expect(recs.map((r) => r.name)).toEqual(['Mine', 'Wrestlers', 'Brass Horse']);
    expect(recs[0].fields).toEqual({
      saveid: 0,
      ttscardid: '10000',
      cardtype: 'Site',
      capacity: 1,
      relicCount: 1,
    });
    expect(recs[1].fields.suit).toBe('Order');
    expect(typeof recs[2].fields.saveid).toBe('number');
  });

  it('skips a commented-out record', () => {
    const src = `
    ["Real"]         = { saveid = 1, cardtype = "Site" },
    --["UNUSED"]      = { saveid = 23, cardtype = "Site", capacity = 0 },
    ["Also Real"]    = { saveid = 2, cardtype = "Site" }`;
    expect(parseCardsLua(src).map((r) => r.name)).toEqual(['Real', 'Also Real']);
  });

  it('parses a record with a trailing -- comment', () => {
    const src = `["Thing"] = { saveid = 5, cardtype = "Vision" }, -- formerly a privilege card`;
    const recs = parseCardsLua(src);
    expect(recs).toHaveLength(1);
    expect(recs[0].fields).toEqual({ saveid: 5, cardtype: 'Vision' });
  });

  it('ignores nested-table / non-record lines without erroring', () => {
    const src = `
  siteCardCodes = {
      [0] = "Mine",
      [1] = "Salt Flats",
  }
  ["Keep"] = { saveid = 4, suit = "Order", cardtype = "Denizen" }`;
    expect(parseCardsLua(src).map((r) => r.name)).toEqual(['Keep']);
  });

  it('names may contain apostrophes and slashes', () => {
    const src = `
    ["Tinker's Fair"]                      = { saveid = 12, suit = "Hearth", cardtype = "Denizen" },
    ["Sprawling Rampart / Bandit Rampart"] = { saveid = 198, suit = "Order", cardtype = "EdificeRuin" }`;
    expect(parseCardsLua(src).map((r) => r.name)).toEqual([
      "Tinker's Fair",
      'Sprawling Rampart / Bandit Rampart',
    ]);
  });

  it('throws with a line number on a malformed record body', () => {
    const src = `line one is fine
    ["Broken"] = { saveid = , cardtype = "Site" },
line three`;
    expect(() => parseCardsLua(src)).toThrow(/line 2/);
  });
});

describe('parseCardsLua — real vendored file', () => {
  const recs = parseCardsLua(realFile);

  it('yields at least 250 records', () => {
    expect(recs.length).toBeGreaterThanOrEqual(250);
  });

  it('every record has a numeric saveid unless cardtype is "None"', () => {
    for (const r of recs) {
      if (r.fields.cardtype === 'None') continue;
      expect(typeof r.fields.saveid).toBe('number');
    }
  });

  it('preserves file order (Mine first, sites before denizens)', () => {
    expect(recs[0].name).toBe('Mine');
    const mineIdx = recs.findIndex((r) => r.name === 'Mine');
    const wrestlersIdx = recs.findIndex((r) => r.name === 'Wrestlers');
    expect(mineIdx).toBeLessThan(wrestlersIdx);
  });
});
