import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';
import {
  checkInvariants,
  PEOPLES_FAVOR_ID,
  type OathState,
} from '../../../src/oath/game/state.js';
import { oath } from '../../../src/oath/game/index.js';
import { cards } from '../../../src/oath/cards/index.js';
import { IllegalAction, type GameAction } from '../../../src/engine/types.js';
import { baseState } from './helpers.js';

// A separate DB per test file (store.test.ts's own convention), needed only
// by the "prepare persists dice, replay reuses them" exit-criterion test.
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'oath-campaign1-')), 'test.db');
let store: typeof import('../../../src/actionlog.js');
let db: typeof import('../../../src/db.js')['db'];

beforeAll(async () => {
  store = await import('../../../src/actionlog.js');
  ({ db } = await import('../../../src/db.js'));
});

function act(state: OathState, type: string, actor: number | null, payload: unknown): OathState {
  const action: GameAction = {
    gameId: 'test',
    seq: state.actionCount + 1,
    type,
    actor,
    payload,
    createdAt: '2026-09-11T00:00:00.000Z',
  };
  return oath.reduce(state, action);
}
const declare = (s: OathState, actor: number | null, p: unknown) => act(s, 'campaign.declare', actor, p);
const respond = (s: OathState, actor: number | null, p: unknown = {}) => act(s, 'campaign.respond', actor, p);
const rollAction = (s: OathState, actor: number | null, p: unknown) => act(s, 'campaign.roll', actor, p);

// baseState: seat 1 active, pawn at sites[5] (Hinterland), 2 warbands of
// their own there (so seat 1 already rules their own site). Board warbands
// 3, Supply 4. Move seat 2's (the intended defender's) pawn there too, so
// pawnFavor/banner targets are legal.
function declareState(): OathState {
  const s = baseState();
  s.players[2].pawnSite = s.sites[5].id;
  return s;
}

/** As above, but the defender ALSO rules the attacker's site (Law §5.5.2's stronger "must target it" clause). */
function declareStateDefenderRulesYourSite(): OathState {
  const s = declareState();
  s.sites[5].warbands[2] = 1;
  s.players[2].warbands.bank -= 1; // source it (conservation)
  return s;
}

describe('campaign.declare (Law §5.5.1-5.5.2)', () => {
  it('a legal declare stores the campaign and moves pending() to the defender', () => {
    const s = declareStateDefenderRulesYourSite();
    const supplyBefore = s.players[1].supply;

    const out = declare(s, 1, {
      defender: 2,
      targets: [{ kind: 'site', siteId: s.sites[5].id }, { kind: 'pawnFavor' }],
      attackDice: 2,
    });

    expect(out.campaign).not.toBeNull();
    expect(out.campaign).toMatchObject({
      attackerSeat: 1,
      defenderSeat: 2,
      attackDice: 2,
      defenseDice: 1 + 2, // site (1) + pawnFavor (2)
      phase: 'respond',
      declaredAt: out.actionCount,
    });
    expect(out.players[1].supply).toBe(supplyBefore - 2); // Law §5.5.1

    const pending = oath.pending(out);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ seat: 2, kind: 'campaign', resolves: ['campaign.respond'] });
    checkInvariants(out);
  });

  it('a pawnFavor-only target is legal when the defender does not rule your site', () => {
    const s = declareState(); // defender's pawn is here, but they have no warbands here
    const out = declare(s, 1, { defender: 2, targets: [{ kind: 'pawnFavor' }], attackDice: 1 });
    expect(out.campaign).toMatchObject({ defenseDice: 2, phase: 'respond' });
    checkInvariants(out);
  });

  it('is illegal: a site target the defender does not rule', () => {
    const s = declareState();
    expect(() =>
      declare(s, 1, { defender: 2, targets: [{ kind: 'site', siteId: s.sites[0].id }], attackDice: 1 }),
    ).toThrow(IllegalAction);
  });

  it('is illegal: over-committing more attack dice than board warbands', () => {
    const s = declareState();
    expect(() =>
      declare(s, 1, { defender: 2, targets: [{ kind: 'pawnFavor' }], attackDice: 4 }),
    ).toThrow(IllegalAction); // board is 3
  });

  it('is illegal: insufficient Supply', () => {
    const s = declareState();
    s.players[1].supply = 1; // costs 2 (Law §5.5.1)
    expect(() =>
      declare(s, 1, { defender: 2, targets: [{ kind: 'pawnFavor' }], attackDice: 1 }),
    ).toThrow(IllegalAction);
  });

  it('is illegal: declaring yourself as the defender', () => {
    const s = declareState();
    expect(() =>
      declare(s, 1, { defender: 1, targets: [{ kind: 'pawnFavor' }], attackDice: 1 }),
    ).toThrow(IllegalAction);
  });

  it("is illegal: omitting the mandatory site target when the defender rules your site", () => {
    const s = declareStateDefenderRulesYourSite();
    expect(() =>
      declare(s, 1, { defender: 2, targets: [{ kind: 'pawnFavor' }], attackDice: 1 }),
    ).toThrow(IllegalAction);
  });

  it('is illegal: duplicate targets', () => {
    const s = declareStateDefenderRulesYourSite();
    expect(() =>
      declare(s, 1, {
        defender: 2,
        targets: [
          { kind: 'site', siteId: s.sites[5].id },
          { kind: 'site', siteId: s.sites[5].id },
        ],
        attackDice: 1,
      }),
    ).toThrow(IllegalAction);
  });

  describe('bandits (Law §5.5.1, Glossary §10.21)', () => {
    it('is illegal when a player (even the attacker) rules your site', () => {
      const s = declareState(); // seat 1 rules sites[5] (2 warbands)
      expect(() =>
        declare(s, 1, { defender: 'bandits', targets: [{ kind: 'site', siteId: s.sites[5].id }], attackDice: 1 }),
      ).toThrow(IllegalAction);
    });

    it('is legal at an unruled site, and skips straight past the response window', () => {
      const s = declareState();
      s.players[1].pawnSite = s.sites[3].id; // Barren Coast: nobody's warbands are here
      const out = declare(s, 1, {
        defender: 'bandits',
        targets: [{ kind: 'site', siteId: s.sites[3].id }],
        attackDice: 1,
      });
      expect(out.campaign).toMatchObject({ defenderSeat: 'bandits', defenseDice: 1, phase: 'roll' });
      const pending = oath.pending(out);
      expect(pending[0]).toMatchObject({ seat: 1, kind: 'campaign', resolves: ['campaign.roll'] });
      checkInvariants(out);
    });
  });

  it('dice counts match the rulebook formula (Law §5.5.2) for two hand-built forces', () => {
    const a = declareState();
    const outA = declare(a, 1, { defender: 2, targets: [{ kind: 'pawnFavor' }], attackDice: 3 });
    expect(outA.campaign).toMatchObject({ attackDice: 3, defenseDice: 2 });

    const b = declareStateDefenderRulesYourSite();
    b.banners[0].holder = 2; // People's Favor
    b.banners[0].tokens = 3;
    b.sharedBank.favor -= 2; // source the extra 2 favor (started at 1)
    const outB = declare(b, 1, {
      defender: 2,
      targets: [
        { kind: 'site', siteId: b.sites[5].id },
        { kind: 'pawnFavor' },
        { kind: 'banner', bannerId: 'peoples-favor' },
      ],
      attackDice: 1,
    });
    expect(outB.campaign).toMatchObject({ attackDice: 1, defenseDice: 1 + 2 + 3 });
    checkInvariants(outB);
  });

  it('is illegal: a banner target the defender does not hold', () => {
    const s = declareStateDefenderRulesYourSite(); // banners start unheld
    expect(() =>
      declare(s, 1, {
        defender: 2,
        targets: [{ kind: 'site', siteId: s.sites[5].id }, { kind: 'banner', bannerId: 'peoples-favor' }],
        attackDice: 1,
      }),
    ).toThrow(IllegalAction);
  });

  describe('relic targets (Law §5.5.2; P1 follow-up, data/relic-defense-dice.json)', () => {
    // baseState gives seat 2 one held relic already: cards.relics[1] (sorted
    // by saveId — Cursed Cauldron, defenseDice 3).
    const heldRelicId = cards.relics[1].id;

    it("adds the relic's printed defense dice when the defender's pawn is at your site", () => {
      const s = declareState();
      const out = declare(s, 1, {
        defender: 2,
        targets: [{ kind: 'relic', relicId: heldRelicId }],
        attackDice: 1,
      });
      expect(out.campaign).toMatchObject({ defenseDice: 3 });
      checkInvariants(out);
    });

    it('is illegal: a relic the defender does not hold', () => {
      const s = declareState();
      const unheldRelicId = cards.relics[0].id; // Sticky Fire — sits facedown at sites[1]
      expect(() =>
        declare(s, 1, { defender: 2, targets: [{ kind: 'relic', relicId: unheldRelicId }], attackDice: 1 }),
      ).toThrow(IllegalAction);
    });

    it("is illegal: the defender's pawn is not at your site", () => {
      const s = baseState(); // seat 2's pawn stays at sites[2], not moved here
      expect(() =>
        declare(s, 1, { defender: 2, targets: [{ kind: 'relic', relicId: heldRelicId }], attackDice: 1 }),
      ).toThrow(IllegalAction);
    });
  });
});

describe('campaign — projection (Law §9.4: nothing about a declared Campaign is private)', () => {
  it('is visible, verbatim, to every seat and to spectators', () => {
    const s = declareState();
    const out = declare(s, 1, { defender: 2, targets: [{ kind: 'pawnFavor' }], attackDice: 1 });
    for (const seat of [0, 1, 2, null]) {
      const view = oath.project(out, seat) as { campaign: unknown };
      expect(view.campaign).toEqual(out.campaign);
    }
  });
});

describe('campaign lock — while in progress, everything else is illegal-state', () => {
  it('a second campaign.declare is illegal', () => {
    const s = declareState();
    const out = declare(s, 1, { defender: 2, targets: [{ kind: 'pawnFavor' }], attackDice: 1 });
    expect(() =>
      declare(out, 1, { defender: 2, targets: [{ kind: 'pawnFavor' }], attackDice: 1 }),
    ).toThrow(IllegalAction);
  });

  it('turn.rest is illegal for the attacker while the campaign is in progress', () => {
    const s = declareState();
    const out = declare(s, 1, { defender: 2, targets: [{ kind: 'pawnFavor' }], attackDice: 1 });
    expect(() => act(out, 'turn.rest', 1, {})).toThrow(IllegalAction);
  });
});

describe('campaign.respond (Law §5.5.3, naive P2 window)', () => {
  function responding() {
    const s = declareState();
    return declare(s, 1, { defender: 2, targets: [{ kind: 'pawnFavor' }], attackDice: 1 });
  }

  it('the defender closes the window, moving pending() to the attacker', () => {
    const out = respond(responding(), 2);
    expect(out.campaign).toMatchObject({ phase: 'roll' });
    const pending = oath.pending(out);
    expect(pending[0]).toMatchObject({ seat: 1, kind: 'campaign', resolves: ['campaign.roll'] });
    checkInvariants(out);
  });

  it('is illegal for anyone but the defender', () => {
    const s = responding();
    expect(() => respond(s, 1)).toThrow(IllegalAction);
    expect(() => respond(s, 0)).toThrow(IllegalAction);
  });

  it('is illegal when no campaign is awaiting a response', () => {
    const s = baseState();
    expect(() => respond(s, 1)).toThrow(IllegalAction);
  });
});

describe('campaign.roll (Law §5.5.4-5.5.5)', () => {
  function rollable() {
    const s = declareState();
    const declared = declare(s, 1, { defender: 2, targets: [{ kind: 'pawnFavor' }], attackDice: 2 });
    return respond(declared, 2); // attackDice: 2, defenseDice: 2, phase 'roll'
  }

  it('stores the persisted faces and advances to phase "rolled"', () => {
    const out = rollAction(rollable(), 1, {
      attackFaces: ['sword', 'skull'],
      defenseFaces: ['shield', 'blank'],
    });
    expect(out.campaign).toMatchObject({
      phase: 'rolled',
      attackFaces: ['sword', 'skull'],
      defenseFaces: ['shield', 'blank'],
    });
    const pending = oath.pending(out);
    expect(pending[0]).toMatchObject({ seat: 1, kind: 'campaign', resolves: [] });
    checkInvariants(out);
  });

  it('is illegal for anyone but the attacker', () => {
    const s = rollable();
    expect(() =>
      rollAction(s, 2, { attackFaces: ['sword', 'skull'], defenseFaces: ['shield', 'blank'] }),
    ).toThrow(IllegalAction);
  });

  it('is illegal before the response window closes', () => {
    const s = declareState();
    const declared = declare(s, 1, { defender: 2, targets: [{ kind: 'pawnFavor' }], attackDice: 2 });
    expect(() =>
      rollAction(declared, 1, { attackFaces: ['sword', 'skull'], defenseFaces: ['shield', 'blank'] }),
    ).toThrow(IllegalAction);
  });

  it('is illegal with the wrong number of faces', () => {
    const s = rollable();
    expect(() =>
      rollAction(s, 1, { attackFaces: ['sword'], defenseFaces: ['shield', 'blank'] }),
    ).toThrow(IllegalAction);
  });

  it('is illegal with a face value that is not a real die face', () => {
    const s = rollable();
    expect(() =>
      rollAction(s, 1, { attackFaces: ['sword', 'nonsense'], defenseFaces: ['shield', 'blank'] }),
    ).toThrow(IllegalAction);
  });
});

describe('campaign.roll — prepare() persists dice; replay reuses them (HLD D14 exit criterion)', () => {
  it('folding the log from scratch reproduces the exact same state', () => {
    // FIRST_GAME is fixed at 4 seats; we immediately overwrite its state
    // with our own controlled (3-seat) `declareState()` below anyway.
    const { gameId } = store.createGame(oath, ['Chancellor', 'Red', 'Blue', 'Yellow']);
    // Overwrite the real (random) opening position with our controlled one.
    db.prepare('INSERT OR REPLACE INTO snapshots (game_id, seq, state) VALUES (?, ?, ?)').run(
      gameId,
      0,
      JSON.stringify(declareState()),
    );

    let seq = store.headSeq(gameId);
    seq = store.appendAction(oath, gameId, seq, {
      type: 'campaign.declare',
      actor: 1,
      payload: { defender: 2, targets: [{ kind: 'pawnFavor' }], attackDice: 2 },
    }).seq;
    seq = store.appendAction(oath, gameId, seq, {
      type: 'campaign.respond',
      actor: 2,
      payload: {},
    }).seq;
    const rolled = store.appendAction(oath, gameId, seq, {
      type: 'campaign.roll',
      actor: 1,
      payload: {},
    });

    const c = (rolled.state as OathState).campaign!;
    expect(c.attackFaces).toHaveLength(2);
    expect(c.defenseFaces).toHaveLength(2);
    checkInvariants(rolled.state as OathState);

    const first = store.loadState(oath, gameId).state;
    // Wipe any snapshot taken after our injected opening position (none
    // exist yet at this short a sequence — SNAPSHOT_EVERY is 25 — but this
    // is the "wipe snapshots" step the plan calls for; it must NOT touch
    // the seq-0 snapshot, which stands in for `init()` here). Either way,
    // `loadState` never calls `prepare` — only `reduce` — so this reload
    // independently re-derives the state from the persisted action log.
    db.prepare('DELETE FROM snapshots WHERE game_id = ? AND seq > 0').run(gameId);
    const second = store.loadState(oath, gameId).state;

    // If dice were re-rolled during replay instead of reused from the
    // persisted payload, this would (almost certainly) fail.
    expect(second).toEqual(first);
  });
});
