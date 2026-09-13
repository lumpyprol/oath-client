/**
 * Unit 1 of Phase 4: the hidden-information ORACLE conformance table.
 *
 * `audit.test.ts` (P3 unit 20) catches a card id that LEAKS INTO a
 * projection. This file catches a different failure mode: an action whose
 * ERROR TEXT lets an actor learn a card's identity WITHOUT it ever
 * appearing in their view, by submitting a guess and reading which of two
 * (or more) messages comes back. `recover`'s relic branch did exactly this
 * before this unit — see the exploit below — and nothing in P0-P3 would
 * have caught it, because the projection itself never leaked anything.
 *
 * The premise, verified against the code (not against RULINGS.md or an
 * earlier ruling's prose, per D48/D55): every payload schema in
 * `src/oath/game/actions/*.ts` (plus `turn.ts` and `victory.ts`) was read
 * and every field carrying a card id classified below. Three fields
 * carried a real oracle:
 *
 *   - `recover`'s relic branch (`relicId`) — the one the plan named.
 *     A wrong guess answered `no facedown relic ${relicId} at your site`;
 *     a right guess fell through to the §5.4.2 cost checks and failed
 *     differently (or succeeded). All 20 relic ids in
 *     `src/oath/cards/data/relics.json` could be tried for free, since an
 *     illegal action never persists.
 *   - `travel`'s destination (`siteId`) — NOT named by the plan, found
 *     while verifying it. Law §5.6.2 explicitly lets a pawn travel to a
 *     FACEDOWN site (that's the whole point of the flip-on-arrival
 *     clause), but `project.ts` nulls a facedown site's id — so a client
 *     had no legal id to send for exactly the destinations the Law says
 *     are legal, AND a guess across all 23 real site ids in
 *     `src/oath/cards/data/sites.json` distinguished "on this board" from
 *     "not on this board" by which error came back, with player.supply
 *     forced to 0 so every real guess answers with the same visible
 *     "insufficient Supply" shape regardless of the guess.
 *   - `campaign.resolve`'s `seize.banishTo` — same family, worse: the old
 *     check was ONLY existence (`!state.sites.find(...)`), so a guessed id
 *     that WAS a real site — facedown or not — silently SUCCEEDED instead
 *     of erroring, and a failed `campaign.resolve` never persists either
 *     (thrown before `applyEffects`), so this was resubmittable across
 *     every known id for free.
 *
 * All three are fixed the same way: addressed by SLOT (an index into
 * `state.sites` / a site's `relics` array), never by id — Law §5.4.1 and
 * §6.3 are literal about this ("Choose one facedown relic AT YOUR SITE";
 * at a table you point at a card, you do not name it). A slot number is
 * never itself an oracle: `state.sites` is a fixed-length, fixed-order
 * array for the whole game (see `project.ts`), so every index names a
 * real board position whether or not that position has been revealed —
 * there is no wrong guess to distinguish from a right one.
 *
 * `setup.choose`'s siteId does NOT get the slot treatment — Law §1.23.1
 * requires a FACEUP site, which is already public, so naming it directly
 * leaks nothing PROVIDED the error text stops discriminating "facedown"
 * from "does not exist" (fixed here too, message-only, no shape change).
 *
 * Every OTHER site/relic/banner id in the dispatch table turned out to
 * already be safe, because it is always addressed as a card that is
 * either (a) at a site the actor's own pawn occupies (which, since travel
 * always flips a facedown arrival faceup on the spot, is always ALREADY
 * faceup and public — Law §9.4), or (b) already public by an explicit
 * Law clause (a held relic, §5.4.3; a banner, always on the table; an
 * offer's mandatory relic, §9.4 read literally — see `audit.test.ts`'s
 * own `learn()`, which whitelists exactly this). None of those needed a
 * shape change; this file's job is to prove that classification rather
 * than assume it, per the plan's own instruction.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { oath, RESOLVABLE_TYPES } from '../../../src/oath/game/index.js';
import { project } from '../../../src/oath/game/project.js';
import { checkInvariants, type OathState } from '../../../src/oath/game/state.js';
import { cards } from '../../../src/oath/cards/index.js';
import { IllegalAction, type GameAction } from '../../../src/engine/types.js';
import { baseState, containsId } from './helpers.js';

function act(state: OathState, type: string, actor: number | null, payload: unknown = {}): OathState {
  const action: GameAction = {
    gameId: 'test',
    seq: state.actionCount + 1,
    type,
    actor,
    payload,
    createdAt: '2026-09-13T00:00:00.000Z',
  };
  return oath.reduce(state, action);
}

// ---------------------------------------------------------------------
// The classification table. Every RESOLVABLE_TYPES entry gets a row —
// missing one FAILS the completeness test below, so a future action that
// adds an id-bearing field cannot slip in unclassified.
// ---------------------------------------------------------------------

type Classification = 'public' | 'own' | 'positional' | 'none';

/**
 * One field this action's payload carries that names (or, since this
 * unit, positionally addresses) a card. `own` is reserved for a value
 * private to the submitting actor and absent from every other seat's
 * view; nothing in the current action set needs it — every card-id field
 * left in the dispatch table turns out to be `public` once it is legal to
 * submit at all (see the file header), so this bucket exists for the
 * classification scheme's completeness, not because any row uses it yet.
 */
interface FieldEntry {
  field: string;
  classification: Classification;
}

const TABLE: Record<string, FieldEntry[]> = {
  'turn.rest': [],
  'card.play': [{ field: 'siteId', classification: 'public' }], // your own pawn site — always faceup once you can stand there
  muster: [
    { field: 'cardId', classification: 'public' }, // a card at your own (faceup) site
    { field: 'siteId', classification: 'public' },
  ],
  trade: [
    { field: 'cardId', classification: 'public' },
    { field: 'siteId', classification: 'public' },
  ],
  travel: [{ field: 'siteIndex', classification: 'positional' }],
  search: [],
  recover: [
    { field: 'relicIndex', classification: 'positional' },
    { field: 'siteId', classification: 'public' },
    { field: 'bannerId', classification: 'public' }, // one of exactly 2, always on the table
  ],
  // Unit 3 of P4: the payload NEVER carries the id at all (D60) — a
  // peeked relic is private to the peeking seat, so a card-id field here
  // would put private knowledge in a log every seat can read. Both are
  // positional for the same structural reason recover/travel are.
  'peek.relic': [{ field: 'relicIndex', classification: 'positional' }],
  'peek.reliquary': [{ field: 'spaces[]', classification: 'positional' }],
  'campaign.declare': [
    // every target kind requires the site/banner/relic to already be
    // public: a site the defender RULES (faceup), a banner (always on the
    // table), or a relic the defender HOLDS (faceup, §5.4.3)
    { field: 'targets[].siteId', classification: 'public' },
    { field: 'targets[].bannerId', classification: 'public' },
    { field: 'targets[].relicId', classification: 'public' },
  ],
  'campaign.ally': [],
  'campaign.permit': [],
  'campaign.respond': [], // dice-face enums, not card ids
  'campaign.resolve': [
    // bound to the campaign's OWN already-public declared targets
    { field: 'seize.placements[].siteId', classification: 'public' },
    { field: 'seize.banishTo', classification: 'positional' },
  ],
  'campaign.casualties': [
    // bound to the campaign's own already-public force entries — see the
    // synthetic test below (never exercised by either frozen fixture)
    { field: 'kills[].siteId', classification: 'public' },
  ],
  'power.use': [
    // `effects`/`choices` are freeform declared-effect payloads (v1,
    // HLD D9/D28) whose identities are whatever public zones they move
    // between — covered by audit.test.ts's whole-JSON sweep of every
    // resulting STATE, not enumerable as a fixed field here.
    { field: 'cardId', classification: 'public' },
  ],
  'citizenship.offer': [
    { field: 'relicId', classification: 'public' }, // the one deliberate reveal — audit.test.ts's learn() whitelists it
    { field: 'give.relics[]', classification: 'public' },
    { field: 'give.banners[]', classification: 'public' },
    { field: 'take.relics[]', classification: 'public' },
    { field: 'take.banners[]', classification: 'public' },
  ],
  'citizenship.accept': [],
  'citizenship.decline': [],
  'citizenship.exile': [],
  'citizenship.selfExile': [],
  'adviser.play': [], // adviserIndex is positional into the actor's OWN advisers — already index-only since unit 6, no id ever sent
  'warbands.move': [],
  'warbands.allow': [],
  'warbands.deny': [],
  'standing.set': [],
  'setup.choose': [{ field: 'siteId', classification: 'public' }], // must be faceup (Law §1.23.1) — see the message-collapse fix, not a shape change
  'wake.resolve': [], // `bank` is a suit name, not a card id
  'oathkeeper.grant': [],
};

describe('oracle conformance — every dispatch-table entry is classified', () => {
  it('the table covers every RESOLVABLE_TYPES entry, and nothing else', () => {
    expect(Object.keys(TABLE).sort()).toEqual([...RESOLVABLE_TYPES].sort());
  });
});

// ---------------------------------------------------------------------
// Verification against two REAL games (same fixtures audit.test.ts
// replays), rather than trusting the table above. For every action whose
// classified fields are present in its actual logged payload, the claim
// is checked against the state immediately AFTER that action folds —
// see the comment inline below for why AFTER, not BEFORE.
// ---------------------------------------------------------------------

interface Fixture {
  seed: string;
  players: number;
  actions: { seq: number; type: string; actor: number | null; payload: unknown }[];
}

function loadFixture(name: string): Fixture {
  return JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'fixtures', name), 'utf8'));
}

function openingState(f: Fixture): OathState {
  return oath.init({ ...oath.setup(f.players, { seed: f.seed }), setupChoices: 'open' });
}

/** Pull every classified value for `type`'s payload that is actually present. */
function classifiedValues(type: string, payload: unknown): { classification: Classification; value: string }[] {
  const p = payload as Record<string, any>;
  const out: { classification: Classification; value: string }[] = [];
  const pushIfString = (v: unknown, classification: Classification) => {
    if (typeof v === 'string') out.push({ classification, value: v });
  };
  const pushArray = (v: unknown, classification: Classification) => {
    if (Array.isArray(v)) for (const x of v) pushIfString(x, classification);
  };

  switch (type) {
    case 'card.play':
      pushIfString(p.siteId, 'public');
      break;
    case 'muster':
    case 'trade':
      pushIfString(p.cardId, 'public');
      pushIfString(p.siteId, 'public');
      break;
    case 'recover':
      pushIfString(p.siteId, 'public');
      if (p.target === 'banner') pushIfString(p.bannerId, 'public');
      break;
    case 'campaign.declare':
      for (const t of p.targets ?? []) {
        pushIfString(t.siteId, 'public');
        pushIfString(t.bannerId, 'public');
        pushIfString(t.relicId, 'public');
      }
      break;
    case 'campaign.resolve':
      for (const pl of p.seize?.placements ?? []) pushIfString(pl.siteId, 'public');
      break;
    case 'campaign.casualties':
      for (const k of p.kills ?? []) pushIfString(k.siteId, 'public');
      break;
    case 'power.use':
      pushIfString(p.cardId, 'public');
      break;
    case 'citizenship.offer':
      pushIfString(p.relicId, 'public');
      pushArray(p.give?.relics, 'public');
      pushArray(p.give?.banners, 'public');
      pushArray(p.take?.relics, 'public');
      pushArray(p.take?.banners, 'public');
      break;
    case 'setup.choose':
      pushIfString(p.siteId, 'public');
      break;
    default:
      break;
  }
  return out;
}

const FIXTURES = [
  { name: '3-player', fixture: loadFixture('fullgame.log.json') },
  { name: '6-player (unit 9)', fixture: loadFixture('sixplayer.log.json') },
];

describe.each(FIXTURES)('oracle conformance, verified against a full game — $name', ({ fixture }) => {
  it('every classified value was legitimately public at the moment it was submitted', () => {
    let state = openingState(fixture);
    const checked: Record<Classification, number> = { public: 0, own: 0, positional: 0, none: 0 };

    for (const row of fixture.actions) {
      if (row.type === 'game.created') continue;

      const fields = classifiedValues(row.type, row.payload);
      state = oath.reduce(structuredClone(state), row as unknown as GameAction);
      checkInvariants(state);

      // Checked against a SPECTATOR's view of the state AFTER this action:
      // if it's there, every seat (and no-seat) sees it too, which is the
      // strongest form of "not an oracle". Checking AFTER rather than
      // BEFORE is deliberate and covers `citizenship.offer`'s `relicId`
      // correctly: Law §6.4 lets the Scepter holder always legitimately
      // know any Reliquary relic (a Peek this engine has no representation
      // for pre-P4-unit-2/3), but the id is a genuine reveal ONLY from the
      // moment the offer is made (§9.4, `audit.test.ts`'s own whitelisted
      // exception) — before that it is exactly as hidden as any other
      // facedown relic, so checking pre-action would fail correctly-safe
      // code, not catch a leak.
      const spectatorView = project(state, null);
      for (const { classification, value } of fields) {
        if (classification === 'public') {
          expect(
            containsId(spectatorView, value),
            `#${row.seq} ${row.type}: ${value} was classified 'public' but is absent from a spectator's view`,
          ).toBe(true);
          checked.public += 1;
        }
        // 'positional' fields carry no id string to check here — see the
        // dedicated exploit tests below for the structural guarantee.
      }
    }

    // A replayed real game is only a meaningful check if it actually
    // exercised some 'public' claims — assert that rather than trusting
    // an empty pass.
    expect(checked.public).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------
// Gaps neither frozen fixture exercises: verified directly.
// ---------------------------------------------------------------------

describe('oracle conformance — classifications not reached by either frozen game', () => {
  it("campaign.casualties' kills[].siteId is bound to the campaign's own already-public force", () => {
    const s = baseState();
    const siteId = s.players[0].pawnSite!; // seat 0's own site — faceup, public
    s.campaign = {
      attackerSeat: 1,
      defenderSeat: 0,
      targets: [{ kind: 'site', siteId }],
      attackDice: 0,
      defenseDice: 0,
      allies: [],
      allyEligible: [],
      allyAnswered: [],
      allyVolunteers: [],
      phase: 'casualties',
      casualties: { force: [{ kind: 'site', siteId, seat: 0, count: 2 }], quota: 1 },
      declaredAt: s.actionCount,
    };
    // Public before the action even runs: it's the ATTACKER's own declared
    // target, already visible to a spectator.
    expect(containsId(project(s, null), siteId)).toBe(true);

    const out = act(s, 'campaign.casualties', 0, {
      kills: [{ kind: 'site', siteId, seat: 0, count: 1 }],
    });
    checkInvariants(out);

    // A siteId that is NOT part of the declared force is rejected, never
    // silently accepted — so this field cannot be used to probe for a
    // site's existence either.
    expect(() =>
      act(s, 'campaign.casualties', 0, {
        kills: [{ kind: 'site', siteId: 'site:nowhere-at-all', seat: 0, count: 1 }],
      }),
    ).toThrow(IllegalAction);
  });

  it("citizenship.offer's negotiated give/take relics and banners are always the parties' own already-public holdings", () => {
    const s = baseState();
    s.turn.activeSeat = 0; // offering requires the Scepter holder's own turn
    const givenRelic = s.relicDeck.shift()!; // pull it out of the deck to keep ids unique
    s.players[0].relics = [givenRelic]; // the offerer must actually hold what they give
    s.banners[1].holder = 2; // the Darkest Secret, held by the offered Exile

    const out = act(s, 'citizenship.offer', 0, {
      exile: 2,
      relicId: s.reliquary[0].relicId!,
      give: { relics: [givenRelic] },
      take: { banners: ['darkest-secret'] },
    });
    checkInvariants(out);

    const spectatorView = project(out, null);
    // Held relics and banners are public regardless of whose they are
    // (Law §5.4.3; a banner is always on the table) — negotiating them
    // reveals nothing a spectator did not already see.
    expect(containsId(spectatorView, givenRelic)).toBe(true);
    expect(containsId(spectatorView, 'banner:darkest-secret')).toBe(true);
  });
});

// ---------------------------------------------------------------------
// The exploits themselves, red before this unit's fix — kept as
// regression tests, per the plan's own instruction to write them first.
// ---------------------------------------------------------------------

describe('the recover oracle (Law §5.4.1) — closed by addressing the slot, not the card', () => {
  it('the OLD shape ({ target: "relic", relicId }) is rejected outright — the field no longer exists', () => {
    const s = baseState();
    s.players[1].pawnSite = s.sites[1].id; // baseState's one seeded relic
    const realRelicId = s.sites[1].relics[0];
    expect(() => act(s, 'recover', 1, { target: 'relic', relicId: realRelicId })).toThrow(IllegalAction);
  });

  it('every one of the 20 real relic ids produces the SAME message when substituted into an unaffordable slot 0 (no guess distinguishes identity)', () => {
    const messages = new Set<string>();
    for (const relic of cards.relics) {
      const s = baseState();
      s.players[1].pawnSite = s.sites[1].id;
      s.sites[1].relics = [relic.id]; // swap which real relic sits in the only slot
      s.players[1].favor = 0;
      s.players[1].secrets = { ready: 0, flipped: 0 }; // cannot pay ANY printed cost
      try {
        act(s, 'recover', 1, { target: 'relic', relicIndex: 0 });
        throw new Error(`recover unexpectedly succeeded for ${relic.id}`);
      } catch (e) {
        messages.add((e as Error).message);
      }
    }
    // One message for all 20 substitutions — the relic's IDENTITY never
    // reaches the error text (only the site's cost, which is public site
    // data, does).
    expect(messages.size).toBe(1);
  });
});

describe('the travel oracle (Law §5.6.2) — closed the same way', () => {
  it('every slot, with Supply forced to 0, fails with a message that never varies by which real site occupies it', () => {
    const messages = new Set<string>();
    for (let swap = 0; swap < 3; swap++) {
      const s = baseState();
      // Rotate which real site sits at index 6 across three real board
      // ids, keeping region/facedown fixed — only the identity changes.
      s.sites[6] = { ...s.sites[6], id: cards.sites[swap].id, facedown: true, cards: s.sites[6].cards.map(() => null) };
      s.players[1].supply = 0;
      try {
        act(s, 'travel', 1, { siteIndex: 6 });
        throw new Error('travel unexpectedly succeeded with 0 Supply');
      } catch (e) {
        messages.add((e as Error).message);
      }
    }
    expect(messages.size).toBe(1);
  });
});

describe("the campaign.resolve banishTo oracle (Law §5.5.7.3) — closed the same way", () => {
  /**
   * Zero attack dice, deliberately (same trick as fullgame.test.ts's own
   * first campaign): 0 swords, 0 skulls, so a sacrifice of exactly 1
   * (`needed = max(0, defense - swords + 1)` with defense 0) is a
   * certain win with no roll-dependent branching to get wrong.
   */
  function toPawnFavorWin(): OathState {
    const s = baseState();
    s.players[2].pawnSite = s.sites[5].id; // defender's pawn at attacker's (seat 1) site
    const declared = act(s, 'campaign.declare', 1, {
      defender: 2,
      targets: [{ kind: 'pawnFavor' }],
      attackDice: 0,
    });
    return act(declared, 'campaign.respond', 2, {
      attackFaces: [],
      defenseFaces: ['blank', 'blank'], // §5.5.2's fixed pawnFavor pool (2 dice)
    });
  }

  it('the OLD shape (a string id) is rejected outright — the field is a slot index now', () => {
    const rolled = toPawnFavorWin();
    expect(() =>
      act(rolled, 'campaign.resolve', 1, { sacrifice: 1, seize: { banishTo: rolled.sites[0].id } }),
    ).toThrow(IllegalAction);
  });

  it('an out-of-range slot fails uniformly — there is no longer an "id exists on this board" bit to probe for', () => {
    const rolled = toPawnFavorWin();
    expect(() =>
      act(rolled, 'campaign.resolve', 1, { sacrifice: 1, seize: { banishTo: rolled.sites.length + 1 } }),
    ).toThrow(IllegalAction);
  });
});
