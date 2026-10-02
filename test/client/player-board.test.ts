/**
 * Pieces on the player board and the composer's presentation hints (unit 11
 * follow-ups from Ben's browser check): the Supply marker sits in the circle
 * its value names, the warbands on a board are drawn on it, Travel reads as
 * the map's three region columns, and every action shows its rule.
 */

import { describe, it, expect } from 'vitest';
import { boardModel } from '../../src/client/model.js';
import { boardPage } from '../../src/client/pages/board.js';
import { composer } from '../../src/client/composer.js';
import { makeArtResolver } from '../../src/client/art.js';
import { cards } from '../../src/oath/cards/index.js';
import { existsSync } from 'node:fs';
import { ART_DIR } from '../../src/oath/cards/art.js';
import { ACTION_RULES, NOT_RULES } from '../../src/client/action-rules.js';
import { project } from '../../src/oath/game/project.js';
import { oath, RESOLVABLE_TYPES } from '../../src/oath/game/index.js';
import type { Affordance } from '../../src/oath/game/affordances.js';
import type { OathState } from '../../src/oath/game/state.js';
import type { GameAction } from '../../src/engine/types.js';
import { FIXTURES, openingState } from '../oath/game/audit-lib.js';

const names = ['A', 'B', 'C'];
const three = FIXTURES.find((f) => f.name === '3-player')!;

/** The fixture folded `n` actions in — far enough that setup is done. */
function after(n: number): OathState {
  let state = openingState(three.fixture, three.setupChoices);
  let k = 0;
  for (const row of three.fixture.actions) {
    if (row.type === 'game.created') continue;
    if (k++ >= n) break;
    state = oath.reduce(structuredClone(state), row as unknown as GameAction);
  }
  return state;
}

const page = (s: OathState, seat = 0) => boardPage(boardModel(project(s, seat), { gameId: 'g', seat, names }));

describe('the Supply marker (Law §1.10, §4.2)', () => {
  const CIRCLES = [8.46, 20.52, 32.6, 44.76, 56.82, 68.99, 81.06, 93.2];
  for (let supply = 0; supply <= 7; supply++) {
    it(`supply ${supply} sits in circle ${8 - supply} of 8`, () => {
      const s = after(6);
      s.players[0].supply = supply;
      const marker = page(s).match(/class="pb-supply-marker"[^>]*style="left:([\d.]+)%/)!;
      expect(Number(marker[1])).toBe(CIRCLES[7 - supply]);
    });
  }
});

/** Each piece row on a page: kind, how many token images it draws, its count. */
const rows = (html: string) =>
  [...html.matchAll(/<span class="pb-pile" data-kind="(\w+)" title="([^"]*)">((?:(?!<\/span><\/span>)[\s\S])*)<\/span><\/span>/g)].map((m) => ({
    kind: m[1],
    title: m[2],
    images: (m[3].match(/<img /g) ?? []).length,
    count: m[3].match(/class="pb-count">×(\d+)/)![1],
    flipped: m[3].includes('pb-tok flipped'),
  }));

describe('pieces on a player board: one token and a count each', () => {
  it('shows favor, secrets, flipped secrets and warbands as one token apiece with a count', () => {
    const s = after(6);
    for (const p of s.players) Object.assign(p, { favor: 0, secrets: { ready: 0, flipped: 0 }, warbands: { ...p.warbands, board: 0 } });
    s.players[2].favor = 3;
    s.players[2].secrets = { ready: 2, flipped: 1 };
    s.players[2].warbands.bank -= 5;
    s.players[2].warbands.board = 5;
    expect(rows(page(s))).toEqual([
      { kind: 'favor', title: '3 favor', images: 1, count: '3', flipped: false },
      { kind: 'secrets', title: '2 secrets', images: 1, count: '2', flipped: false },
      { kind: 'flipped', title: '1 flipped secret', images: 1, count: '1', flipped: true },
      { kind: 'warbands', title: '5 warbands on the board', images: 1, count: '5', flipped: false },
    ]);
  });

  it('draws nothing on an empty board', () => {
    const s = after(6);
    for (const p of s.players) Object.assign(p, { favor: 0, secrets: { ready: 0, flipped: 0 }, warbands: { ...p.warbands, board: 0 } });
    expect(page(s)).not.toContain('class="pb-pieces"');
  });
});

describe('Travel reads like the map', () => {
  it('lists destinations under Cradle, Provinces and Hinterland columns, in that order', () => {
    const s = after(6);
    const seat = s.turn.activeSeat;
    const travel = (oath.affordances!(s, seat) as Affordance[]).filter((e) => e.type === 'travel');
    expect(travel).toHaveLength(1);
    const html = composer(travel, { gameId: 'g', seq: 1, back: '/' }).value;
    expect([...html.matchAll(/<span class="group-name">(\w+)<\/span>/g)].map((m) => m[1])).toEqual(['Cradle', 'Provinces', 'Hinterland']);
  });
});

describe('every action shows its rule', () => {
  it('has a rule (or a stated non-rule) for every submittable action type', () => {
    const missing = RESOLVABLE_TYPES.filter((t) => !ACTION_RULES[t] && !NOT_RULES[t]);
    expect(missing).toEqual([]);
  });

  it('links each rule to its Law section', () => {
    const html = composer([{ type: 'travel', fields: [] }], { gameId: 'g', seq: 1, back: '/' }).value;
    expect(html).toContain('href="https://rules.buriedgiant.com/?product=oath&amp;locale=en-US&amp;printing=p1#5.6"');
    expect(html).toContain('Law §5.6</a>');
  });
});

describe.skipIf(!existsSync(ART_DIR))('a Vision is drawn landscape, as it lies on the Revealed Vision space', () => {
  const art = makeArtResolver();
  const vision = cards.visions.find((v) => v.id !== 'vision:conspiracy')!;

  it('on the player board, inside the Revealed Vision box', () => {
    const s = after(6);
    s.players[1].vision = vision.id;
    const html = boardPage(boardModel(project(s, 0), { gameId: 'g', seat: 0, names }), { art });
    expect(html).toMatch(/<div class="pb-vision"><span class="land"><img class="face"/);
  });

  it('in the cards a Search drew, and only for the Vision', () => {
    const s = after(6);
    const m = { ...boardModel(project(s, 0), { gameId: 'g', seat: 0, names }), hand: [{ artKey: vision.id, name: vision.name, landscape: true }, { artKey: cards.denizens[0].id, name: cards.denizens[0].name }] };
    const drawn = boardPage(m, { art, compose: { entries: [], seq: 1, back: '/' } }).match(/<div class="drawn-cards">([\s\S]*?)<\/div>/)![1];
    expect(drawn.match(/class="land"/g)).toHaveLength(1);
  });

  it('as a card.play choice', () => {
    const entry: Affordance = { type: 'card.play', fields: [{ name: 'handIndex', kind: 'choose-one', options: [{ value: 0, label: vision.name, art: vision.id }, { value: 1, label: 'x', art: cards.denizens[0].id }] }] };
    const html = composer([entry], { gameId: 'g', seq: 1, back: '/', artFor: (k) => ({ src: `/art/${k}`, landscape: k.startsWith('vision:') }) }).value;
    expect(html.match(/<span class="land"><img class="opt-face"/g)).toHaveLength(1);
  });
});

describe.skipIf(!existsSync(ART_DIR))('your own facedown advisers look facedown, with the face on hover', () => {
  const art = makeArtResolver();
  const s = after(6);
  const seat = 1;
  s.players[seat].advisers = [
    { id: cards.denizens[0].id, facedown: true, favor: 0, secrets: 0 },
    { id: cards.denizens[1].id, facedown: false, favor: 0, secrets: 0 },
  ];
  /** The adviser list on the seat's own player board (boards render in seat order), as `viewer` sees it. */
  const advisersOf = (viewer: number) => {
    const html = boardPage(boardModel(project(s, viewer), { gameId: 'g', seat: viewer, names }), { art });
    return html.split('<article class="pboard')[seat + 1].match(/<ul class="advisers[\s\S]*?<\/ul>/)![0];
  };

  it('to you: the facedown one is a back that names its face for the zoom; the faceup one is its face', () => {
    const mine = advisersOf(seat);
    expect(mine).toMatch(/<img class="card-back peek" src="[^"]*" data-zoom="\/art\/[^"]+"/);
    expect(mine.match(/class="face"/g)).toHaveLength(1);
  });

  it('to everyone else: a plain back, with no face to zoom', () => {
    const theirs = advisersOf(0);
    expect(theirs).not.toContain('data-zoom');
    expect(theirs).toMatch(/<img class="card-back" src=/);
  });
});

describe('your resources head "Your move", and sit on every board after the name and role', () => {
  it('shows your stats there, and every board header keeps its own (yours included)', () => {
    const s = after(6);
    const html = boardPage(boardModel(project(s, 1), { gameId: 'g', seat: 1, names }), { compose: { entries: [], seq: 1, back: '/' } });
    expect(html).toMatch(/<div class="compose-head"><h2>Your move<\/h2><span class="pb-stats">/);
    const boards = html.split('<article class="pboard').slice(1);
    expect(boards[1]).toContain('class="pb-stats"'); // yours (seat 1)
    expect(boards[0]).toContain('class="pb-stats"');
    expect(boards[2]).toContain('class="pb-stats"');
  });
});

describe('"Your move" is grouped: Standing + Rest, then major, then minor', () => {
  it('the board draws Standing and Rest straight under the heading row, then the groups', () => {
    const s = after(6);
    const seat = s.turn.activeSeat;
    const entries = oath.affordances!(s, seat) as Affordance[];
    expect(entries.some((e) => e.type === 'standing.set')).toBe(true);
    const html = boardPage(boardModel(project(s, seat), { gameId: 'g', seat, names }), { compose: { entries, seq: 1, back: '/' } });
    const top = html.match(/<div class="compose-head">[\s\S]*?<\/div>\s*<div class="composer-pinned">([\s\S]*?)<div class="action-group/)![1];
    expect(top).toContain('<summary>Standing: set');
    expect(top).toContain('<summary>Turn: rest');
    // Major actions (Law §5) before minor ones (§6), each type in its own group.
    const major = html.match(/<div class="action-group major">([\s\S]*?)(?=<div class="action-group|<\/section>)/)![1];
    const minor = html.match(/<div class="action-group minor">([\s\S]*?)(?=<div class="action-group|<\/section>)/)?.[1] ?? '';
    expect(major).toMatch(/Major actions \(<a class="law-ref" href="[^"]*#5\."[^>]*>Law §5<\/a>\)/);
    for (const t of ['travel', 'search', 'muster']) if (entries.some((e) => e.type === t)) expect(major).toContain(`value="${t}"`);
    for (const t of ['peek.relic', 'peek.reliquary', 'adviser.play', 'warbands.move', 'power.use']) {
      if (entries.some((e) => e.type === t)) expect(minor).toContain(`value="${t}"`);
    }
    expect(html.indexOf('action-group major')).toBeLessThan(html.indexOf('action-group minor'));
  });

  it('an include filter draws only its entries, each keeping its own index', () => {
    const entries: Affordance[] = [{ type: 'travel', fields: [] }, { type: 'standing.set', fields: [] }];
    const html = composer(entries, { gameId: 'g', seq: 1, back: '/', include: (e) => e.type === 'standing.set' }).value;
    expect(html).toContain('data-entry="1"');
    expect(html).not.toContain('data-entry="0"');
  });
});

describe('a Search is one form, inside the "Your Search drew" box (Ben, 2026-10-01)', () => {
  it('draws the card choice with faces, and destinations that say which cards they fit', () => {
    const entry: Affordance = {
      type: 'card.play',
      fields: [
        { name: 'handIndex', kind: 'choose-one', options: [{ value: 0, label: 'Bear Traps', art: cards.denizens[2].id }, { value: 1, label: 'Forgotten Vault', art: cards.denizens[3].id }] },
        { name: 'as', kind: 'choose-one', options: [{ value: 'discard', label: 'Discard it' }, { value: 'adviser', label: 'Play faceup as an adviser', requires: { field: 'handIndex', values: [0] } }] },
      ],
    };
    const s = after(6);
    const m = { ...boardModel(project(s, 0), { gameId: 'g', seat: 0, names }), hand: [{ artKey: cards.denizens[2].id, name: 'Bear Traps' }, { artKey: cards.denizens[3].id, name: 'Forgotten Vault' }] };
    const html = boardPage(m, { compose: { entries: [entry], seq: 1, back: '/' } });
    const box = html.match(/<div class="drawn"><h3>Your Search drew<\/h3>([\s\S]*?)<\/section>/)![1];
    expect(box).toMatch(/<details class="compose" open id="compose-0">/); // the one form, open, in the box
    expect(box).toContain('data-requires-field="handIndex" data-requires="[&quot;0&quot;]"');
    expect(box).toContain('<span class="req-note">(for Bear Traps)</span>'); // what the no-script page says
    expect(html.match(/name="_type" value="card.play"/g)).toHaveLength(1);
  });
});

describe('relics lie facedown; a peek shows the face in its form (Ben, 2026-10-01)', () => {
  const s = after(6);
  const site = s.sites.find((x) => !x.facedown && x.relics.length > 0)!;
  const relicId = site.relics[0];
  const seat = s.turn.activeSeat;
  s.players[seat].peeked = [relicId];
  s.players[seat].pawnSite = site.id;
  const art = makeArtResolver();
  const relicsOn = (viewer: number) =>
    boardPage(boardModel(project(s, viewer), { gameId: 'g', seat: viewer, names }), { art, boardImageUrl: '/art/full_board.png' }).match(/<span class="bcard relic">[\s\S]*?<\/span>/g) ?? [];

  it('is a back on the map for everyone, with the face on hover only for the seat that peeked', () => {
    const mine = relicsOn(seat);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((r) => r.includes('relicBack.png'))).toBe(true);
    expect(mine.some((r) => r.includes('data-zoom='))).toBe(existsSync(ART_DIR));
    const other = relicsOn((seat + 1) % 3);
    expect(other.every((r) => r.includes('relicBack.png') && !r.includes('data-zoom'))).toBe(true);
  });

  it('the peek form draws a peeked relic by its face and an unpeeked one by its back', () => {
    const peek = (oath.affordances!(s, seat) as Affordance[]).find((e) => e.type === 'peek.relic')!;
    const opts = (peek.fields[0] as Extract<Affordance['fields'][number], { options: unknown[] }>).options as { art?: string }[];
    expect(opts[0].art).toBe(relicId);
    for (const o of opts.slice(1)) expect(o.art).toBe('relic-back');
  });
});

describe('several forms of one action are ONE box: pick which, and the box shows that form (Ben, 2026-10-01)', () => {
  const entries: Affordance[] = [
    { type: 'travel', fields: [] },
    { type: 'recover', fields: [{ name: 'target', kind: 'choose-one', options: [{ value: 'relic', label: 'Recover a facedown relic' }] }] },
    { type: 'recover', fields: [{ name: 'target', kind: 'choose-one', options: [{ value: 'banner', label: "The People's Favor" }] }, { name: 'pay', kind: 'count', min: 2, max: 4 }] },
  ];
  const html = composer(entries, { gameId: 'g', seq: 1, back: '/' }).value;
  const box = html.match(/<details class="compose" id="compose-1">[\s\S]*?<\/details>/)![0];

  it('draws one Recover box with a picker naming each, and each form under it', () => {
    expect(html.match(/<summary>Recover/g)).toHaveLength(1);
    expect(box).toMatch(/<legend class="field-name">target<\/legend>/);
    expect(box).toContain('data-variant-pick checked> Recover a facedown relic');
    expect(box).toContain("> The People&#39;s Favor</label>");
    expect(box).toContain('<div class="variant" data-variant="1">');
    expect(box).toContain('<div class="variant" data-variant="2">');
    // Each is still its own form, so the wire format is unchanged.
    expect(box.match(/<form /g)).toHaveLength(2);
  });

  it('opens on the form a re-render is putting back', () => {
    const again = composer(entries, { gameId: 'g', seq: 1, back: '/', prefill: { index: 2, body: { pay: '3' } } }).value;
    expect(again).toMatch(/<details class="compose" open id="compose-1">/);
    expect(again).toMatch(/value="2" data-variant-pick checked>/);
  });
});

describe('inside a picker box, one-answer fields are not asked again (Ben, 2026-10-01)', () => {
  const entries: Affordance[] = [
    { type: 'recover', fields: [{ name: 'target', kind: 'choose-one', options: [{ value: 'relic', label: 'Recover a facedown relic' }] }] },
    {
      type: 'recover',
      fields: [
        { name: 'target', kind: 'choose-one', options: [{ value: 'banner', label: 'The Darkest Secret' }] },
        { name: 'bannerId', kind: 'choose-one', options: [{ value: 'darkest-secret', label: 'Darkest Secret' }] },
        { name: 'pay', kind: 'count', min: 2, max: 3 },
      ],
    },
    {
      type: 'recover',
      fields: [
        { name: 'target', kind: 'choose-one', options: [{ value: 'banner', label: "The People's Favor" }] },
        { name: 'extra', kind: 'choose-one', options: [{ value: 1, label: 'their pawn & favor' }] },
      ],
    },
  ];
  const html = composer(entries, { gameId: 'g', seq: 1, back: '/' }).value;

  it('hides a field that only restates the picker (no second "Darkest Secret")', () => {
    const ds = html.match(/<div class="variant" data-variant="1">[\s\S]*?<\/form>/)![0];
    expect(ds).toContain('<input type="hidden" name="bannerId" value="&quot;darkest-secret&quot;">');
    expect(ds).not.toContain('>bannerId<');
    expect(ds).not.toMatch(/type="radio" name="(target|bannerId)"/);
  });

  it('shows one that adds something as a line of text', () => {
    const pf = html.match(/<div class="variant" data-variant="2">[\s\S]*?<\/form>/)![0];
    expect(pf).toContain('<p class="field fixed"><span class="field-name">extra</span> their pawn &amp; favor</p>');
  });
});

describe('the stats row shows Supply with the seat\'s own Supply marker, not an "S"', () => {
  it('draws the marker image beside the number', () => {
    const s = after(6);
    const html = boardPage(boardModel(project(s, 0), { gameId: 'g', seat: 0, names }));
    expect(html).toMatch(/<span class="tok supply" title="Supply"><img class="tok-img supply-tok" src="\/art\/supply%20\w+%20shadow\.png" alt="Supply">\d+<\/span>/);
    expect(html).not.toContain('>S ');
  });
});

describe('the stats row shows where the pawn is with the seat\'s own pawn, not a flag', () => {
  it('draws the pawn image before the site name', () => {
    const s = after(6);
    const html = boardPage(boardModel(project(s, 0), { gameId: 'g', seat: 0, names }));
    expect(html).toMatch(/<span class="tok pawn" title="Pawn"><img class="tok-img pawn-icon" src="\/art\/[^"]+\.png" alt="Pawn">/);
    expect(html).not.toContain('⚑');
  });
});

describe('after the roll, the campaign is resolved in the campaign box (Ben, 2026-10-02)', () => {
  it('renders the resolve forms open inside the campaign box, and not in "Your move"', async () => {
    const { imperialRolled } = await import('../oath/game/campaign-lib.js');
    const s = imperialRolled();
    const entries = oath.affordances!(s, 1) as Affordance[];
    expect(entries.some((e) => e.type === 'campaign.resolve')).toBe(true);
    const html = boardPage(boardModel(project(s, 1), { gameId: 'g', seat: 1, names: ['A', 'B', 'C', 'D'] }), { compose: { entries, seq: 1, back: '/' } });
    const box = html.match(/<section class="campaign">[\s\S]*?<\/section>/)![0];
    expect(box).toContain('<div class="campaign-act">');
    expect(box).toMatch(/<details class="compose" open id="compose-\d+">\s*<summary>Campaign: resolve/);
    const move = html.match(/<section class="compose-section"[\s\S]*?<\/section>/)![0];
    expect(move).not.toContain('value="campaign.resolve"');
    expect(move).toContain('Your campaign decision is in the campaign box above.');
  });
});
