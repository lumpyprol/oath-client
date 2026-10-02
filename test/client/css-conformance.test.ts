/**
 * Unit 16, proxy one (D65): class-name conformance between the templates and
 * the stylesheet. Unit 16 is the one unit that is not test-driven — its gate
 * is Ben's eye — but these two failures are mechanical and actually happen:
 *
 *   - a typo'd class in a template, silently unstyled;
 *   - a stylesheet full of dead rules from earlier layouts.
 *
 * It works on RENDERED HTML rather than grepping the template source,
 * because the templates build classes dynamically (`pboard${…}`,
 * `map-pile ${cls}`, conditional ` facedown`) and a source grep either
 * misses those or chokes on the `${}`. So it renders every page across the
 * real fixture game, plus synthesized states for the branches a real game
 * does not reliably hit (a campaign before and after its roll, a casualty
 * quota, a pending offer and request, tokens on a site, flipped secrets, a
 * ruined edifice, a revealed vision, both inbox states).
 *
 * Both directions are enforced:
 *   1. every class the stylesheet styles is rendered somewhere (no dead CSS);
 *   2. every class a page renders is styled — or is a named HOOK below.
 *
 * The hooks are the honest deviation from D65's letter ("every class used in
 * a template exists in the stylesheet"): a few classes are structural or
 * test hooks with nothing to style. Each is listed with its reason, and the
 * list is itself checked for rot, so a typo can never hide in it.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { APP_CSS, APP_JS } from '../../src/client/assets.js';
import { boardModel, inboxModel, type InboxDecision } from '../../src/client/model.js';
import { boardPage, type ComposeView } from '../../src/client/pages/board.js';
import type { Affordance } from '../../src/oath/game/affordances.js';
import { inboxPage } from '../../src/client/pages/inbox.js';
import { makeArtResolver } from '../../src/client/art.js';
import { project } from '../../src/oath/game/project.js';
import { oath } from '../../src/oath/game/index.js';
import { cards } from '../../src/oath/cards/index.js';
import type { OathState } from '../../src/oath/game/state.js';
import type { GameAction } from '../../src/engine/types.js';
import { FIXTURES, openingState } from '../oath/game/audit-lib.js';

/** Classes rendered on purpose with no rule of their own. Every one says why. */
const HOOKS: Record<string, string> = {
  // Structural section/region containers: named for readability and tests,
  // laid out by their children.
  players: 'section wrapper for the player boards',
  regions: 'section wrapper for the fallback region listing',
  region: 'one region in the fallback listing',
  supply: 'which stat chip (styled as .tok)',
  'table-furniture': 'the unclaimed-banners section wrapper',
  yours: 'the inbox\'s waiting-on-you section wrapper',
  // Variants that distinguish WHICH thing a generically styled element is.
  facedown: 'state marker on a site in the fallback listing',
  pawn: 'which stat chip (styled as .tok)',
  wb: 'which stat chip (styled as .tok)',
  secret: 'which stat chip (styled as .tok)',
  'favor-coin': 'which token image (styled as .tok-img / .bank-fav)',
  'secret-tok': 'which token image (styled as .tok-img)',
  'supply-tok': 'which token image (styled as .tok-img)',
  'pawn-icon': 'which token image (styled as .tok-img)',
  'relic-deck': 'which map pile (styled as .map-pile); board-leak.test hook',
  'world-deck': 'which map pile (styled as .map-pile); board-leak.test pins its hidden size',
  respond: 'which action group (styled as .action-group); tests find groups by it',
  major: 'which action group (styled as .action-group); tests find groups by it',
  minor: 'which action group (styled as .action-group); tests find groups by it',
};

/**
 * Classes the enhancement SCRIPT adds at runtime, so no server-rendered page
 * carries them. Each is checked to really be added by APP_JS.
 */
const SCRIPT_CLASSES: Record<string, string> = {
  js: 'added to <html> by app.js, so styles can show script-only controls (the effect "Add" button)',
};

/** Every class selector in the stylesheet (comments stripped first). */
function styledClasses(): Set<string> {
  const css = APP_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  return new Set([...css.matchAll(/\.([a-zA-Z_][\w-]*)/g)].map((m) => m[1]));
}

/** Every class token in a set of rendered documents. */
function renderedClasses(docs: string[]): Set<string> {
  const out = new Set<string>();
  for (const doc of docs) {
    for (const m of doc.matchAll(/class="([^"]*)"/g)) {
      for (const t of m[1].split(/\s+/)) if (t) out.add(t);
    }
  }
  return out;
}

const three = FIXTURES.find((f) => f.name === '3-player')!;
const names = ['A', 'B', 'C', 'D', 'E', 'F'];

/** The 3-player fixture folded to each of the given prefixes. */
function foldedStates(prefixes: number[]): OathState[] {
  let state = openingState(three.fixture, three.setupChoices);
  const out = [structuredClone(state)];
  let n = 0;
  for (const row of three.fixture.actions) {
    if (row.type === 'game.created') continue;
    state = oath.reduce(structuredClone(state), row as unknown as GameAction);
    n++;
    if (prefixes.includes(n)) out.push(structuredClone(state));
  }
  out.push(structuredClone(state));
  return out;
}

/** A state that forces the branches a real game rarely lands on together. */
function synthesized(): OathState[] {
  // Prefix 25 of the fixture has a live campaign (verified in batch 7).
  const [base] = foldedStates([25]).slice(1, 2);
  const s = structuredClone(base);

  // Tokens on a faceup site and on one of its denizens; a ruined edifice.
  const site = s.sites.find((x) => !x.facedown && x.cards.some((c) => c))!;
  site.favor = 1;
  site.secrets = 1;
  // A ruined edifice carrying tokens, on an occupied slot (a site may have
  // no empty one), so both the ruin marker and card tokens render.
  const slot = site.cards.findIndex((c) => c !== null);
  site.cards[slot] = { id: cards.edifices[0].id, favor: 1, secrets: 1, ruined: true };

  // Flipped secrets and a revealed vision on player boards.
  s.players[0].secrets.flipped = 1;
  s.players[1].vision = cards.visions[0].id;

  // Something pending on everyone.
  s.citizenshipOffer = {
    scepterSeat: 0,
    exile: 1,
    relicId: s.reliquary.find((r) => r.relicId !== null)!.relicId!,
    give: { favor: 0, secrets: 0, relics: [], banners: [] },
    take: { favor: 0, secrets: 0, relics: [], banners: [] },
    offeredAt: s.actionCount,
  };
  s.warbandRequest = { seat: 1, approver: 0, direction: 'toBoard', count: 1, target: null, requestedAt: s.actionCount };

  // The campaign twice: rolled with every face and a casualty quota, and
  // declared but not yet rolled.
  const rolled = structuredClone(s);
  rolled.campaign = {
    ...rolled.campaign!,
    phase: 'casualties',
    attackDice: 3,
    defenseDice: 4,
    attackFaces: ['sword', 'hollowSword', 'skull'],
    defenseFaces: ['blank', 'shield', 'doubleShield', 'shieldX2'],
    casualties: { force: [], quota: 2 },
  };
  const unrolled = structuredClone(s);
  unrolled.campaign = { ...unrolled.campaign!, phase: 'respond', attackFaces: undefined, defenseFaces: undefined };
  delete unrolled.campaign.casualties;

  return [rolled, unrolled];
}

function allDocuments(): string[] {
  const docs: string[] = [];
  const withArt = makeArtResolver();
  const noArt = makeArtResolver({ dir: '/does/not/exist' });
  const states = [...foldedStates([8, 20, 40]), ...synthesized()];

  for (const st of states) {
    for (const seat of [0, 1, 2, null]) {
      const m = boardModel(project(st, seat), { gameId: 'g', seat, names });
      // The map, with and without the site back (no back → the "(unrevealed)" label).
      docs.push(boardPage(m, { art: withArt, boardImageUrl: '/art/full_board.png', siteBackUrl: '/art/lands3_08.png' }));
      docs.push(boardPage(m, { art: withArt, boardImageUrl: '/art/full_board.png' }));
      // The no-board-image fallback listing, with placeholder faces.
      docs.push(boardPage(m, { art: noArt }));
    }
  }

  // The composer (unit 11): every field kind, a long choose-one (a <select>),
  // disabled options with costs, and every re-render state — the three
  // banners and every dry-run verdict.
  const [st0] = foldedStates([]);
  const m0 = boardModel(project(st0, 0), { gameId: 'g', seat: 0, names });
  const opt = (value: unknown, label: string, extra: object = {}) => ({ value, label, ...extra });
  const entries: Affordance[] = [
    {
      type: 'travel',
      decisionId: 'turn:0:1',
      note: 'a note',
      fields: [
        {
          name: 'siteIndex',
          kind: 'choose-one',
          options: [
            opt(0, 'Here', { cost: { supply: 1, favor: 1, secrets: 2 }, group: 'Cradle', art: cards.sites[0].id }),
            opt(1, 'There', { disabled: 'too far', group: 'Provinces', art: 'site-back' }),
          ],
        },
      ],
    },
    { type: 'x.select', fields: [{ name: 'pick', kind: 'choose-one', options: Array.from({ length: 10 }, (_, i) => opt(i, `#${i}`, i === 3 ? { disabled: 'no' } : {})) }] },
    // Two entries of one type: one box that switches between them.
    { type: 'recover', fields: [{ name: 'target', kind: 'choose-one', options: [opt('relic', 'a relic')] }], note: 'relic note' },
    { type: 'recover', fields: [{ name: 'target', kind: 'choose-one', options: [opt('banner', 'a banner')] }, { name: 'bannerId', kind: 'choose-one', options: [opt('x', 'something else')] }, { name: 'pay', kind: 'count', min: 2, max: 3 }] },
    { type: 'standing.set', fields: [{ name: 'defense', kind: 'choose-one', options: [opt('ask', 'ask me'), opt('close', 'close')] }] },
    { type: 'x.many', fields: [{ name: 'spaces', kind: 'choose-many', max: 2, options: [opt(0, 'a'), opt(1, 'b', { disabled: 'no' })] }] },
    // A one-answer choice is still shown and picked (outside a picker box).
    { type: 'x.count', fields: [{ name: 'count', kind: 'count', min: 1, max: 3 }, { name: 'faceup', kind: 'flag' }, { name: 'target', kind: 'choose-one', options: [opt(1, 'the only one')] }, { name: 'how', kind: 'choose-one', options: [opt('a', 'always'), opt('b', 'only with the first', { requires: { field: 'target', values: [1] } })] }] },
    {
      type: 'campaign.casualties',
      fields: [{ name: 'kills', kind: 'allocate', min: 2, max: 2, options: [opt({ kind: 'board', seat: 1 }, 'board', { max: 3 }), opt({ siteId: cards.sites[0].id }, 'site', { art: cards.sites[0].id })] }],
    },
    { type: 'power.use', fields: [{ name: 'effects', kind: 'free', schema: 'Effect[]' }] },
  ];
  const compose = (over: Partial<ComposeView>): ComposeView => ({ entries, seq: 3, back: '/games/g', ...over });
  for (const c of [
    compose({}),
    compose({ prefill: { index: 0, body: { siteIndex: '0' } }, banner: { kind: 'stale', message: 'moved', problems: ['gone'] } }),
    compose({ banner: { kind: 'illegal', message: 'no' } }),
    compose({ banner: { kind: 'invalid', message: 'bad' } }),
    compose({ dryRun: { ok: true, type: 'travel', changes: [{ what: 'Supply', before: '4', after: '3' }], rollsDice: false } }),
    compose({ dryRun: { ok: true, type: 'travel', changes: [], rollsDice: false } }),
    compose({ dryRun: { ok: true, type: 'campaign.respond', changes: [], rollsDice: true } }),
    compose({ dryRun: { ok: false, type: 'travel', message: 'no' } }),
  ]) {
    docs.push(boardPage(m0, { art: withArt, boardImageUrl: '/art/full_board.png', siteBackUrl: '/art/lands3_08.png', compose: c }));
  }
  docs.push(boardPage(m0, { art: withArt, compose: compose({ entries: [] }) }));
  // The status line naming off-turn reactions the game is waiting on.
  docs.push(boardPage(boardModel(project(st0, 0), { gameId: 'g', seat: 0, names, waiting: [{ seat: 1, kind: 'campaign' }, { seat: 0, kind: 'citizenshipOffer' }] }), { art: withArt }));
  // Actions that cannot be taken now: greyed and inert, with a reason.
  docs.push(boardPage(m0, { art: withArt, compose: compose({ unavailable: [{ type: 'muster', reason: 'No denizen here' }, { type: 'turn.rest', reason: 'Not your turn' }] }) }));
  // After the roll: Resolve and Casualties render inside the campaign box.
  const [rolledState] = synthesized();
  const mRolled = boardModel(project(rolledState, 0), { gameId: 'g', seat: 0, names });
  docs.push(boardPage(mRolled, { art: withArt, compose: compose({ entries: entries.filter((e) => e.type === 'campaign.casualties') }) }));
  // Mid-Search: the cards your Search drew, shown above the composer.
  const midSearch = { ...m0, hand: [{ artKey: cards.denizens[0].id, name: cards.denizens[0].name }] };
  docs.push(boardPage(midSearch, { art: withArt, compose: compose({}) }));

  const decision = (over: Partial<InboxDecision>): InboxDecision => ({
    id: 'turn:0:1',
    seat: 0,
    kind: 'turn',
    prompt: 'It is your turn.',
    resolves: ['turn.rest'],
    since: new Date(0).toISOString(),
    url: '/games/g/decisions/turn:0:1',
    ...over,
  });
  const now = Date.now();
  docs.push(
    inboxPage(inboxModel({ gameId: 'g', waitingOnYou: [decision({})], waitingOnOthers: [decision({ seat: 1, kind: 'wake' })] }, now), { seat: 0, gameId: 'g' }),
    inboxPage(inboxModel({ gameId: 'g', waitingOnYou: [], waitingOnOthers: [] }, now), { seat: 0, gameId: 'g' }),
  );
  return docs;
}

describe('class-name conformance: templates ↔ stylesheet (unit 16, proxy one)', () => {
  const styled = styledClasses();
  const rendered = renderedClasses(allDocuments());

  it('renders every class the stylesheet styles (no dead CSS)', () => {
    const dead = [...styled].filter((c) => !rendered.has(c) && !(c in SCRIPT_CLASSES)).sort();
    expect(dead).toEqual([]);
  });

  it('every script-added class really is added by the script', () => {
    for (const c of Object.keys(SCRIPT_CLASSES)) expect(APP_JS).toContain(`classList.add("${c}")`);
  });

  it('styles every class a page renders, except the named hooks (no typo hides)', () => {
    const unstyled = [...rendered].filter((c) => !styled.has(c) && !(c in HOOKS)).sort();
    expect(unstyled).toEqual([]);
  });

  it('every hook is still rendered and still unstyled, so the allowlist cannot rot', () => {
    const stale = Object.keys(HOOKS).filter((c) => !rendered.has(c) || styled.has(c)).sort();
    expect(stale).toEqual([]);
  });

  it('the stylesheet it reads is the one the server sends', () => {
    // Guard against checking a stale copy: web.ts serves APP_CSS verbatim.
    const web = readFileSync(join(import.meta.dirname, '..', '..', 'src', 'web.ts'), 'utf8');
    expect(web).toContain('res.send(APP_CSS)');
  });
});
