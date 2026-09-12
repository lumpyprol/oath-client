/**
 * Unit 1 of Phase 3: conformance tests for INTERRUPTS.md.
 *
 * The catalogue at the repo root is normative; this file is what keeps it
 * honest. Two directions, both enforced:
 *   - everything the engine actually emits is catalogued (no undocumented
 *     decision kind)
 *   - everything catalogued as 'built' is actually emitted somewhere in the
 *     suite (no aspirational row nobody exercises)
 *
 * The table is PARSED, not duplicated (the P1 provenance test set this
 * pattern for PROVENANCE.md) — the resolves arrays asserted here come from
 * INTERRUPTS.md itself, so a doc that drifts from the engine fails loudly
 * instead of silently.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { oath } from '../../../src/oath/game/index.js';
import { checkInvariants, type OathState } from '../../../src/oath/game/state.js';
import type { GameAction, PendingDecision } from '../../../src/engine/types.js';
import { baseState } from './helpers.js';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');
const INTERRUPTS_MD = readFileSync(join(REPO_ROOT, 'INTERRUPTS.md'), 'utf8');

interface Fixture {
  seed: string;
  players: number;
  actions: { seq: number; type: string; actor: number | null; payload: unknown }[];
}
const fixture: Fixture = JSON.parse(
  readFileSync(join(REPO_ROOT, 'test', 'fixtures', 'fullgame.log.json'), 'utf8'),
);

// ---- parse INTERRUPTS.md's "Catalogue (built)" table -----------------------

interface CatalogueRow {
  kind: string;
  resolves: string[];
}

function parseCatalogue(md: string): CatalogueRow[] {
  const lines = md.split('\n');
  const start = lines.findIndex((l) => l.trim() === '## Catalogue (built)');
  if (start === -1) throw new Error('INTERRUPTS.md: missing "## Catalogue (built)" section');
  const rows: CatalogueRow[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('## ')) break;
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 4) continue;
    const kindMatch = cells[0].match(/^`([^`]+)`$/);
    if (!kindMatch) continue; // header row ("Kind") or separator ("---")
    const resolves = [...cells[3].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    rows.push({ kind: kindMatch[1], resolves });
  }
  return rows;
}

const catalogue = parseCatalogue(INTERRUPTS_MD);
const catalogueKinds = new Set(catalogue.map((r) => r.kind));

function act(state: OathState, type: string, actor: number | null, payload: unknown = {}): OathState {
  const action: GameAction = {
    gameId: 'test',
    seq: state.actionCount + 1,
    type,
    actor,
    payload,
    createdAt: '2026-09-12T00:00:00.000Z',
  };
  return oath.reduce(structuredClone(state), action);
}

function sameDecision(a: PendingDecision, b: PendingDecision): boolean {
  return a.id === b.id && JSON.stringify(a.resolves) === JSON.stringify(b.resolves);
}

// ---- fold the fullgame fixture, recording every decision emitted and, at
// each step, which decisions from the PREVIOUS prefix vanished ------------

interface VanishEvent {
  kind: string;
  resolves: string[];
  resolvedBy: string; // the action type applied
}

function foldFixture(): { observed: PendingDecision[]; vanished: VanishEvent[] } {
  // See audit.test.ts: a pre-unit-8 stored setup reads as 'applied' (D54).
  let state = oath.init({
    ...oath.setup(fixture.players, { seed: fixture.seed }),
    setupChoices: 'applied',
  });
  const observed: PendingDecision[] = [...oath.pending(state)];
  const vanished: VanishEvent[] = [];
  for (const row of fixture.actions) {
    if (row.type === 'game.created') continue;
    const before = oath.pending(state);
    state = oath.reduce(structuredClone(state), row as unknown as GameAction);
    checkInvariants(state);
    const after = oath.pending(state);
    observed.push(...after);
    for (const d of before) {
      if (!after.some((a) => sameDecision(a, d))) {
        vanished.push({ kind: d.kind, resolves: d.resolves, resolvedBy: row.type });
      }
    }
  }
  return { observed, vanished };
}

// ---- hand-built states for the kinds a 3p Supremacy game never raises.
// Verified by folding the fixture (see the fold script this unit's commit
// message cites): titleChoice, warbandRequest, and campaign-ally volunteers
// never occur in it — everything else (including citizenshipOffer) does. --

/** victory.test.ts's `quietBoard` + oathkeeper-choice scenario, inlined. */
function titleChoiceState(): { before: OathState; after: OathState } {
  const s = baseState();
  s.players[0].warbands = { bank: 24, board: 0 };
  s.players[1].warbands = { bank: 14, board: 0 };
  s.players[2].warbands = { bank: 14, board: 0 };
  for (const site of s.sites) site.warbands = s.sites[0].warbands.map(() => 0);
  s.oath = 'protection';
  s.grandScepter = 1;
  s.players[2].relics = [s.players[2].relics[0]];
  s.players[1].relics = [];
  s.oathkeeper = 0;
  checkInvariants(s);
  const before = act(s, 'turn.rest', 1); // Law §2.11 checked continuously, incl. on Rest
  checkInvariants(before);
  const after = act(before, 'oathkeeper.grant', 0, { seat: 2 });
  checkInvariants(after);
  return { before, after };
}

/** minor.test.ts's `citizenAtSite` warband-permission scenario, inlined. */
function warbandsRequestState(): { before: OathState; after: OathState } {
  const s = baseState();
  s.players[2].citizenship = 'citizen';
  s.players[2].warbands = { bank: 0, board: 1 };
  s.sites[2].warbands[2] = 2;
  s.players[0].warbands.bank = 15;
  s.turn.activeSeat = 2;
  checkInvariants(s);
  const before = act(s, 'warbands.move', 2, { direction: 'toBoard', count: 1 });
  checkInvariants(before);
  const after = act(before, 'warbands.allow', 0);
  checkInvariants(after);
  return { before, after };
}

/** allies.test.ts's `chancellorDefendsState` campaign-ally scenario, inlined. */
function campaignAllyState(): { before: OathState; after: OathState } {
  const s = baseState();
  s.players[2].citizenship = 'citizen';
  s.players[2].warbands = { bank: 0, board: 4 };
  s.players[0].warbands.bank = 14;
  s.players[0].pawnSite = s.sites[5].id;
  s.players[2].pawnSite = s.sites[5].id;
  s.turn.activeSeat = 1;
  checkInvariants(s);
  const before = act(s, 'campaign.declare', 1, {
    defender: 0,
    targets: [{ kind: 'pawnFavor' }],
    attackDice: 2,
  });
  checkInvariants(before);
  const after = act(before, 'campaign.ally', 2, { join: true });
  checkInvariants(after);
  return { before, after };
}

/**
 * ...and on one step, to §5.5.2's permission decision (P3 unit 5). Raised
 * only because seat 2 actually joined above, so this is the same scenario
 * carried one action further rather than a second setup.
 */
function campaignPermitState(): { before: OathState; after: OathState } {
  const before = campaignAllyState().after;
  expect(before.campaign!.phase).toBe('permit');
  const after = act(before, 'campaign.permit', 0, { allies: [2] });
  checkInvariants(after);
  return { before, after };
}

/**
 * victory.test.ts's `wakingAt('site:mine', ...)` Opportunity Site scenario,
 * inlined. Also absent from the fixture: its one Wake (seq 15, 28) never
 * lands anyone on an unresolved Opportunity Site.
 */
function wakeTakeState(): { before: OathState; after: OathState } {
  const s = baseState();
  s.players[0].warbands = { bank: 24, board: 0 };
  s.players[1].warbands = { bank: 14, board: 0 };
  s.players[2].warbands = { bank: 14, board: 0 };
  for (const site of s.sites) site.warbands = s.sites[0].warbands.map(() => 0);
  s.players[2].pawnSite = 'site:mine';
  const site = s.sites.find((x) => x.id === 'site:mine')!;
  s.sharedBank.favor += site.favor - 3;
  site.favor = 3;
  checkInvariants(s);
  const before = act(s, 'turn.rest', 1); // seat 1 rests; seat 2 (holding no People's Favor step) wakes onto the site
  checkInvariants(before);
  const after = act(before, 'wake.resolve', 2, { steps: [], take: { take: 'favor' } });
  checkInvariants(after);
  return { before, after };
}

/** allies.test.ts's `imperialState` + `toCasualties` scenario, inlined. */
function campaignCasualtiesState(): { before: OathState; after: OathState } {
  const s = baseState();
  s.players[2].citizenship = 'citizen';
  s.players[2].warbands = { bank: 0, board: 3 };
  s.players[0].warbands.bank = 15;
  s.players[2].pawnSite = s.sites[5].id;
  s.players[0].pawnSite = s.sites[2].id;
  s.turn.activeSeat = 1;
  checkInvariants(s);

  const declared = act(s, 'campaign.declare', 1, {
    defender: 2,
    targets: [{ kind: 'site', siteId: s.sites[0].id }, { kind: 'pawnFavor' }],
    attackDice: 3,
  });
  // D51: the defender's respond closes the window and carries the dice.
  const out = act(declared, 'campaign.respond', 2, {
    allies: [],
    attackFaces: ['sword', 'sword', 'sword'],
    defenseFaces: ['blank', 'blank', 'blank', 'blank'],
  });
  const before = act(out, 'campaign.resolve', 1, { sacrifice: 3 });
  checkInvariants(before);
  expect(before.campaign!.phase).toBe('casualties');
  const after = act(before, 'campaign.casualties', 0, {
    kills: [{ kind: 'site', siteId: before.sites[0].id, seat: 0, count: 2 }],
  });
  checkInvariants(after);
  return { before, after };
}

/**
 * Law §1.23's setup decision (P3 unit 8) — the one kind that exists from
 * `init`, before any action. A FIRST_GAME opening raises it for seat 0.
 */
function setupChooseState(): { before: OathState; after: OathState } {
  const before = oath.init(oath.setup(4, undefined));
  checkInvariants(before);
  expect(before.setupChoices).not.toBeNull();
  const site = before.sites.find((x) => !x.facedown && x.region === 'cradle')!;
  const after = act(before, 'setup.choose', 0, { siteId: site.id, keepIndex: 0 });
  checkInvariants(after);
  return { before, after };
}

const handBuilt = [
  setupChooseState(),
  titleChoiceState(),
  warbandsRequestState(),
  campaignAllyState(),
  campaignPermitState(),
  wakeTakeState(),
  campaignCasualtiesState(),
];

describe('INTERRUPTS.md is honest about the catalogue table', () => {
  it('parses at least the known built kinds', () => {
    expect([...catalogueKinds].sort()).toEqual(
      ['campaign', 'citizenshipOffer', 'oathkeeper', 'play', 'setup', 'turn', 'wake', 'warbands'].sort(),
    );
    expect(catalogue.length).toBeGreaterThanOrEqual(9); // one row per distinct (kind, resolves) shape
  });
});

describe('every emitted decision is catalogued, and every catalogued kind is emitted', () => {
  const { observed: fixtureObserved, vanished: fixtureVanished } = foldFixture();
  const handObserved = handBuilt.flatMap((h) => oath.pending(h.before));
  const allObserved = [...fixtureObserved, ...handObserved];

  it('every kind the engine emits (fixture + hand-built) appears in the catalogue', () => {
    const emittedKinds = new Set(allObserved.map((d) => d.kind));
    for (const kind of emittedKinds) {
      expect(catalogueKinds.has(kind), `emitted kind "${kind}" is not in INTERRUPTS.md`).toBe(true);
    }
  });

  it('every catalogued kind is emitted somewhere', () => {
    const emittedKinds = new Set(allObserved.map((d) => d.kind));
    for (const kind of catalogueKinds) {
      expect(emittedKinds.has(kind), `catalogued kind "${kind}" is never emitted`).toBe(true);
    }
  });

  it('every catalogued row\'s exact resolves shape is emitted somewhere', () => {
    for (const row of catalogue) {
      const found = allObserved.some(
        (d) => d.kind === row.kind && JSON.stringify(d.resolves) === JSON.stringify(row.resolves),
      );
      expect(found, `no observed decision matches kind "${row.kind}" resolves ${JSON.stringify(row.resolves)}`).toBe(
        true,
      );
    }
  });

  it('every resolves entry names a real, dispatchable action type', () => {
    // The 'turn' decision's resolves IS the engine's full RESOLVABLE_TYPES
    // list (index.ts) — the master vocabulary, derived, not hand-copied.
    const turnDecision = allObserved.find((d) => d.kind === 'turn');
    expect(turnDecision).toBeDefined();
    const knownActionTypes = new Set(turnDecision!.resolves);
    for (const d of allObserved) {
      for (const t of d.resolves) {
        expect(knownActionTypes.has(t), `"${t}" (in a ${d.kind} decision) is not a known action type`).toBe(true);
      }
    }
  });

  it('every catalogued kind is demonstrably resolved by one of its own resolving actions', () => {
    const handVanished: VanishEvent[] = handBuilt.map((h) => {
      const before = oath.pending(h.before);
      const after = oath.pending(h.after);
      const gone = before.find((d) => !after.some((a) => sameDecision(a, d)));
      expect(gone, 'hand-built scenario did not resolve its own decision').toBeDefined();
      return { kind: gone!.kind, resolves: gone!.resolves, resolvedBy: '(hand-built)' };
    });
    const allVanished = [...fixtureVanished, ...handVanished];

    // Sanity: every vanish event followed applying one of the decision's own
    // resolving actions (the engine's contract, not just this test's hope).
    for (const v of fixtureVanished) {
      expect(v.resolves).toContain(v.resolvedBy);
    }

    const resolvedKinds = new Set(allVanished.map((v) => v.kind));
    for (const kind of catalogueKinds) {
      expect(resolvedKinds.has(kind), `catalogued kind "${kind}" is never observed resolving`).toBe(true);
    }
  });
});

describe('id contracts', () => {
  it('ids are unique within any single state, at every prefix of the fixture', () => {
    let state = oath.init({
      ...oath.setup(fixture.players, { seed: fixture.seed }),
      setupChoices: 'applied', // a pre-unit-8 stored setup (D54)
    });
    const checkUnique = (s: OathState, label: string) => {
      const ids = oath.pending(s).map((d) => d.id);
      expect(new Set(ids).size, `duplicate pending id at ${label}: ${ids.join(', ')}`).toBe(ids.length);
    };
    checkUnique(state, 'opening');
    for (const row of fixture.actions) {
      if (row.type === 'game.created') continue;
      state = oath.reduce(structuredClone(state), row as unknown as GameAction);
      checkUnique(state, `#${row.seq} ${row.type}`);
    }
    for (const h of handBuilt) checkUnique(h.before, 'hand-built scenario');
  });

  it('folding the same state twice yields identical ids (purity)', () => {
    const state = baseState();
    const first = oath.pending(state);
    const second = oath.pending(state);
    expect(second).toEqual(first);
  });

  it('a non-locking decision keeps its id across an unrelated action (citizenshipOffer while the active seat travels)', () => {
    const s = baseState();
    s.turn.activeSeat = 0; // citizenship.offer requires the Scepter holder's own turn
    const relicId = s.reliquary[0].relicId!;
    const offered = act(s, 'citizenship.offer', 0, { exile: 1, relicId });
    const before = oath.pending(offered).find((d) => d.kind === 'citizenshipOffer');
    expect(before).toBeDefined();

    const traveled = act(offered, 'travel', 0, { siteId: offered.sites[1].id });
    checkInvariants(traveled);
    const after = oath.pending(traveled).find((d) => d.kind === 'citizenshipOffer');
    expect(after).toBeDefined();
    expect(after!.id).toBe(before!.id); // stable across the poll, per D49/unit-1's id contract
  });
});
