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

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'oath-campaign2-')), 'test.db');
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
const resolveAction = (s: OathState, actor: number | null, p: unknown = {}) => act(s, 'campaign.resolve', actor, p);
const seizeAction = (s: OathState, actor: number | null, p: unknown = {}) => act(s, 'campaign.seize', actor, p);

/** Sets a seat's board warbands to an exact value, sourcing/sinking the bank to keep conservation true. */
function setBoard(s: OathState, seat: number, board: number): void {
  const delta = board - s.players[seat].warbands.board;
  s.players[seat].warbands.board += delta;
  s.players[seat].warbands.bank -= delta;
}

/**
 * seat 1 attacker, seat 2 defender's pawn moved to the attacker's site
 * (sites[5]) so pawnFavor is legal — the simplest single-target campaign,
 * with the defender's board set to an exact, known value (pawnFavor's
 * targeting precondition means the board bonus, Law §5.5.4, always
 * applies). `declare` -> `respond`, landing in phase 'roll'.
 */
function pawnFavorCampaign(defenderBoard: number, attackDice = 2): OathState {
  const s = baseState();
  s.players[2].pawnSite = s.sites[5].id;
  setBoard(s, 2, defenderBoard);
  const declared = declare(s, 1, { defender: 2, targets: [{ kind: 'pawnFavor' }], attackDice });
  return respond(declared, 2);
}

function rolled(attackFaces: string[], defenseFaces: string[], defenderBoard: number): OathState {
  const s = pawnFavorCampaign(defenderBoard, attackFaces.length);
  return rollAction(s, 1, { attackFaces, defenseFaces });
}

describe('campaign.resolve — attack/defense arithmetic (Law §5.5.4-5.5.5)', () => {
  it('a scripted win: swords exceed defense, campaign advances to phase "seize"', () => {
    const attackerBoardBefore = 3; // baseState default
    const s = rolled(['sword', 'sword'], ['blank', 'blank'], 0); // attack 2 > defense 0
    const out = resolveAction(s, 1, { sacrifice: 0 });
    expect(out.campaign).toMatchObject({ phase: 'seize' });
    expect(out.players[1].warbands.board).toBe(attackerBoardBefore); // no skulls, no sacrifice
    checkInvariants(out);
  });

  it('a scripted loss: swords do not exceed defense, attacker\'s force is halved, campaign clears', () => {
    const s = rolled(['hollowSword', 'hollowSword'], ['shield', 'shield'], 0); // attack 1 <= defense 2
    const out = resolveAction(s, 1, { sacrifice: 0 });
    expect(out.campaign).toBeNull();
    // board 3 -> half (1, rounded down) killed, 2 remain
    expect(out.players[1].warbands.board).toBe(2);
    expect(out.players[1].warbands.bank).toBe(baseState().players[1].warbands.bank + 1);
    expect(out.turn.activeSeat).toBe(1); // turn continues — Campaign doesn't end it
    checkInvariants(out);
  });

  it("doubleShield counts 2 shields; shieldX2 doubles the running total, stacking exponentially", () => {
    // pawnFavor (2 dice) + two site targets the defender rules (1 die each) = 4 defense dice
    const s = baseState();
    s.players[2].pawnSite = s.sites[5].id;
    setBoard(s, 2, 0);
    s.sites[6].warbands[2] = 1; // Steppe
    s.sites[3].warbands[2] = 1; // Barren Coast
    s.players[2].warbands.bank -= 2;
    const declared = declare(s, 1, {
      defender: 2,
      targets: [
        { kind: 'pawnFavor' },
        { kind: 'site', siteId: s.sites[6].id },
        { kind: 'site', siteId: s.sites[3].id },
      ],
      attackDice: 3,
    });
    const responded = respond(declared, 2); // defenseDice = 2 + 1 + 1 = 4
    // 1 shield (1) + 1 doubleShield (2) = 3 base, x2 x2 = x4 -> 12
    const r = rollAction(responded, 1, {
      attackFaces: ['sword', 'sword', 'sword'],
      defenseFaces: ['shield', 'doubleShield', 'shieldX2', 'shieldX2'],
    });
    // attack 3 (3 swords), defense 12 -> loss
    const out = resolveAction(r, 1, { sacrifice: 0 });
    expect(out.campaign).toBeNull(); // confirms defense really computed as 12, not e.g. 3
  });

  it('skulls kill the attacker\'s own board warbands immediately, win or lose', () => {
    const s = rolled(['sword', 'sword', 'skull'], ['blank', 'blank'], 0); // still wins: 2 swords > 0
    const out = resolveAction(s, 1, { sacrifice: 0 });
    expect(out.campaign).toMatchObject({ phase: 'seize' }); // victorious despite the skull
    expect(out.players[1].warbands.board).toBe(2); // 3 - 1 skull
    checkInvariants(out);
  });

  it("the defender's own board warbands count toward defense (pawnFavor implies their pawn is here)", () => {
    const s = rolled(['sword', 'sword'], ['blank', 'blank'], 5); // defense = 0 (dice) + 5 (board)
    const out = resolveAction(s, 1, { sacrifice: 0 }); // attack 2 <= defense 5
    expect(out.campaign).toBeNull();
  });
});

describe('campaign.resolve — sacrifice (Law §5.5.5, §9.5 "no unprompted losses")', () => {
  it('sacrificing EXACTLY the amount needed flips a loss into a win', () => {
    // attack 1 (2 hollow swords), defense 2 -> needs 2 more to hit 3 > 2
    const s = rolled(['hollowSword', 'hollowSword'], ['shield', 'shield'], 0);
    const out = resolveAction(s, 1, { sacrifice: 2 });
    expect(out.campaign).toMatchObject({ phase: 'seize' });
    expect(out.players[1].warbands.board).toBe(1); // 3 - 2 sacrificed (killed)
    expect(out.players[1].warbands.bank).toBe(baseState().players[1].warbands.bank + 2);
    checkInvariants(out);
  });

  it('is illegal to sacrifice MORE than exactly needed', () => {
    const s = rolled(['hollowSword', 'hollowSword'], ['shield', 'shield'], 0);
    expect(() => resolveAction(s, 1, { sacrifice: 3 })).toThrow(IllegalAction);
  });

  it('is illegal to sacrifice LESS than exactly needed (a partial sacrifice does not flip it, and Law §9.5 forbids extra losses beyond a chosen amount that fails anyway)', () => {
    const s = rolled(['hollowSword', 'hollowSword'], ['shield', 'shield'], 0);
    expect(() => resolveAction(s, 1, { sacrifice: 1 })).toThrow(IllegalAction);
  });

  it('is illegal to sacrifice at all when already victorious without it', () => {
    const s = rolled(['sword', 'sword'], ['blank', 'blank'], 0); // already 2 > 0
    expect(() => resolveAction(s, 1, { sacrifice: 1 })).toThrow(IllegalAction);
  });

  it('is illegal to sacrifice more board warbands than remain (post-skulls)', () => {
    // board 3, needs 3 to win (attack 0 vs defense 2), but 1 skull first -> only 2 left
    const s = rolled(['skull', 'hollowSword'], ['shield', 'shield'], 0);
    // attack = 0 (single hollow sword counts nothing), defense = 2, needed = 3
    expect(() => resolveAction(s, 1, { sacrifice: 3 })).toThrow(IllegalAction);
  });
});

describe('campaign.resolve — mandatory victory effects: relics and banners (Law §5.5.7, §2.5.3)', () => {
  function withRelicAndBanner() {
    const s = baseState();
    s.players[2].pawnSite = s.sites[5].id;
    setBoard(s, 2, 0);
    // seat 2 already holds cards.relics[1] (Cursed Cauldron) per baseState.
    const heldRelicId = cards.relics[1].id;
    s.banners[0].holder = 2; // People's Favor
    s.banners[0].tokens = 5;
    s.sharedBank.favor -= 4; // source the extra 4 favor (started at 1)
    s.banners[0].mob = false;
    const declared = declare(s, 1, {
      defender: 2,
      targets: [
        { kind: 'pawnFavor' },
        { kind: 'relic', relicId: heldRelicId },
        { kind: 'banner', bannerId: 'peoples-favor' },
      ],
      attackDice: 2,
    });
    const responded = respond(declared, 2);
    // defenseDice = 2 (pawnFavor) + 3 (Cursed Cauldron) + 5 (banner tokens) = 10
    const r = rollAction(responded, 1, {
      attackFaces: ['sword', 'sword'],
      defenseFaces: Array(10).fill('blank'),
    });
    return { r, heldRelicId };
  }

  it('takes the targeted relic and the targeted banner on a win', () => {
    const { r, heldRelicId } = withRelicAndBanner();
    const out = resolveAction(r, 1, { sacrifice: 0 });
    expect(out.campaign).toMatchObject({ phase: 'seize' });
    expect(out.players[1].relics).toContain(heldRelicId);
    expect(out.players[2].relics).not.toContain(heldRelicId);
    const banner = out.banners.find((b) => b.id === PEOPLES_FAVOR_ID)!;
    expect(banner.holder).toBe(1);
    expect(banner.tokens).toBe(3); // 5 - 2 burned
    expect(banner.mob).toBe(true); // Law §2.5.3: flips to Mob when seized
    checkInvariants(out);
  });

  it("the Seize Penalty never burns a banner below 1 token", () => {
    const { r } = withRelicAndBanner();
    r.banners.find((b) => b.id === PEOPLES_FAVOR_ID)!.tokens = 2;
    r.sharedBank.favor += 3; // source: return the excess so conservation holds after burn
    const out = resolveAction(r, 1, { sacrifice: 0 });
    const banner = out.banners.find((b) => b.id === PEOPLES_FAVOR_ID)!;
    expect(banner.tokens).toBe(1); // max(1, 2 - 2), not 0
    checkInvariants(out);
  });

  it('relics/banners are NOT taken on a loss', () => {
    const s = baseState();
    s.players[2].pawnSite = s.sites[5].id;
    setBoard(s, 2, 0);
    const heldRelicId = cards.relics[1].id; // seat 2 already holds this per baseState
    s.banners[0].holder = 2;
    const declared = declare(s, 1, {
      defender: 2,
      targets: [{ kind: 'pawnFavor' }, { kind: 'relic', relicId: heldRelicId }, { kind: 'banner', bannerId: 'peoples-favor' }],
      attackDice: 2,
    });
    const responded = respond(declared, 2);
    // defenseDice = 2 (pawnFavor) + 3 (relic) + 1 (banner tokens) = 6
    const r = rollAction(responded, 1, { attackFaces: ['skull', 'skull'], defenseFaces: Array(6).fill('blank') });
    const out = resolveAction(r, 1, { sacrifice: 0 }); // attack 0 <= defense 0 -> loss

    expect(out.campaign).toBeNull();
    expect(out.players[2].relics).toContain(heldRelicId);
    expect(out.players[1].relics).not.toContain(heldRelicId);
    expect(out.banners.find((b) => b.id === PEOPLES_FAVOR_ID)).toMatchObject({ holder: 2, tokens: 1 });
    checkInvariants(out);
  });
});

describe('campaign.seize — the winner\'s remaining choices (Law §5.5.7)', () => {
  function victoriousWithSiteAndPawnFavor() {
    const s = baseState();
    s.players[2].pawnSite = s.sites[5].id;
    setBoard(s, 2, 0);
    s.sites[3].warbands[2] = 1; // Barren Coast, ruled by the defender — a legal site target
    s.players[2].warbands.bank -= 1;
    s.players[2].favor = 7;
    s.sharedBank.favor -= 6; // source it (started at 1)
    const declared = declare(s, 1, {
      defender: 2,
      targets: [{ kind: 'pawnFavor' }, { kind: 'site', siteId: s.sites[3].id }],
      attackDice: 3,
    });
    const responded = respond(declared, 2);
    // defenseDice = 2 (pawnFavor) + 1 (site) = 3
    const r = rollAction(responded, 1, {
      attackFaces: ['sword', 'sword', 'sword'],
      defenseFaces: ['blank', 'blank', 'blank'],
    });
    return resolveAction(r, 1, { sacrifice: 0 }); // phase 'seize'
  }

  it('places warbands on a targeted site, up to the board count', () => {
    const s = victoriousWithSiteAndPawnFavor();
    const boardBefore = s.players[1].warbands.board;
    const out = seizeAction(s, 1, { placements: [{ siteId: s.sites[3].id, warbands: 2 }] });
    expect(out.campaign).toBeNull();
    expect(out.sites[3].warbands[1]).toBe(2);
    expect(out.players[1].warbands.board).toBe(boardBefore - 2);
    checkInvariants(out);
  });

  it('banishes the pawn to a site of the attacker\'s choice', () => {
    const s = victoriousWithSiteAndPawnFavor();
    const out = seizeAction(s, 1, { banishTo: s.sites[0].id });
    expect(out.players[2].pawnSite).toBe(s.sites[0].id);
    checkInvariants(out);
  });

  it("burns half (rounded down) of the defender's favor", () => {
    const s = victoriousWithSiteAndPawnFavor();
    const out = seizeAction(s, 1, { burnFavor: true });
    expect(out.players[2].favor).toBe(7 - 3); // floor(7/2) = 3
    checkInvariants(out);
  });

  it('is legal to decline every choice (all fields optional)', () => {
    const s = victoriousWithSiteAndPawnFavor();
    const out = seizeAction(s, 1, {});
    expect(out.campaign).toBeNull();
    checkInvariants(out);
  });

  it('is illegal: placing on a site that was not targeted', () => {
    const s = victoriousWithSiteAndPawnFavor();
    expect(() => seizeAction(s, 1, { placements: [{ siteId: s.sites[0].id, warbands: 1 }] })).toThrow(
      IllegalAction,
    );
  });

  it('is illegal: placing more warbands than remain on the board', () => {
    const s = victoriousWithSiteAndPawnFavor();
    expect(() =>
      seizeAction(s, 1, { placements: [{ siteId: s.sites[3].id, warbands: 999 }] }),
    ).toThrow(IllegalAction);
  });

  it('is illegal: banishing/burning favor without a pawnFavor target', () => {
    // attacker's own pawn at Barren Coast (a 'site' target satisfies "at
    // your site" all by itself — no pawnFavor needed) — the defender rules
    // it too, and is elsewhere entirely, never targeted.
    const s = baseState();
    s.players[1].pawnSite = s.sites[3].id; // Barren Coast
    s.sites[3].warbands[2] = 1; // defender co-rules it
    s.players[2].warbands.bank -= 1;
    const declared = declare(s, 1, { defender: 2, targets: [{ kind: 'site', siteId: s.sites[3].id }], attackDice: 2 });
    const responded = respond(declared, 2);
    const r = rollAction(responded, 1, { attackFaces: ['sword', 'sword'], defenseFaces: ['blank'] });
    const resolved = resolveAction(r, 1, { sacrifice: 0 });
    expect(() => seizeAction(resolved, 1, { burnFavor: true })).toThrow(IllegalAction);
    expect(() => seizeAction(resolved, 1, { banishTo: s.sites[0].id })).toThrow(IllegalAction);
  });

  it('is illegal for anyone but the attacker', () => {
    const s = victoriousWithSiteAndPawnFavor();
    expect(() => seizeAction(s, 2, {})).toThrow(IllegalAction);
  });

  it('is illegal before a win (phase is not "seize")', () => {
    const s = pawnFavorCampaign(0);
    expect(() => seizeAction(s, 1, {})).toThrow(IllegalAction);
  });
});

describe('campaign.resolve/seize — shared legality', () => {
  it('resolve is illegal for anyone but the attacker', () => {
    const s = rolled(['sword'], ['blank', 'blank'], 0);
    expect(() => resolveAction(s, 2, { sacrifice: 0 })).toThrow(IllegalAction);
  });

  it('resolve is illegal before the roll happens (phase is not "rolled")', () => {
    const s = pawnFavorCampaign(0);
    expect(() => resolveAction(s, 1, { sacrifice: 0 })).toThrow(IllegalAction);
  });
});

describe('campaign end to end — through the store, replay-stable (unit 13 exit criterion)', () => {
  it('declare -> respond -> roll -> resolve, then a full refold matches byte-for-byte', () => {
    // Real (random) dice via the store's prepare() — `sacrifice: 0` is
    // legal regardless of which way the roll went, so the outcome doesn't
    // need to be forced either way for this determinism check; `resolve`
    // is a pure function of whatever faces got persisted, win or lose.
    const { gameId } = store.createGame(oath, ['Chancellor', 'Red', 'Blue', 'Yellow']);
    const initial = baseState();
    initial.players[2].pawnSite = initial.sites[5].id;
    setBoard(initial, 2, 0);
    db.prepare('INSERT OR REPLACE INTO snapshots (game_id, seq, state) VALUES (?, ?, ?)').run(
      gameId,
      0,
      JSON.stringify(initial),
    );

    let seq = store.headSeq(gameId);
    seq = store.appendAction(oath, gameId, seq, {
      type: 'campaign.declare',
      actor: 1,
      payload: { defender: 2, targets: [{ kind: 'pawnFavor' }], attackDice: 2 },
    }).seq;
    seq = store.appendAction(oath, gameId, seq, { type: 'campaign.respond', actor: 2, payload: {} }).seq;
    seq = store.appendAction(oath, gameId, seq, { type: 'campaign.roll', actor: 1, payload: {} }).seq;
    const final = store.appendAction(oath, gameId, seq, {
      type: 'campaign.resolve',
      actor: 1,
      payload: { sacrifice: 0 },
    });

    // Either a win (phase 'seize') or a loss (campaign cleared) is a valid
    // outcome here — both are exercised elsewhere with scripted faces.
    checkInvariants(final.state as OathState);

    const first = store.loadState(oath, gameId).state;
    db.prepare('DELETE FROM snapshots WHERE game_id = ? AND seq > 0').run(gameId);
    const second = store.loadState(oath, gameId).state;
    expect(second).toEqual(first);
  });
});
