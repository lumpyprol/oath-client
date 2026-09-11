import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';
import {
  checkInvariants,
  DARKEST_SECRET_ID,
  PEOPLES_FAVOR_ID,
  type OathState,
} from '../../../src/oath/game/state.js';
import { oath } from '../../../src/oath/game/index.js';
import { IllegalAction, type GameAction } from '../../../src/engine/types.js';
import { baseState } from './helpers.js';

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'oath-victory-')), 'test.db');
let store: typeof import('../../../src/actionlog.js');
let db: typeof import('../../../src/db.js')['db'];

beforeAll(async () => {
  store = await import('../../../src/actionlog.js');
  ({ db } = await import('../../../src/db.js'));
});

function act(state: OathState, type: string, actor: number | null, payload: unknown = {}): OathState {
  const action: GameAction = {
    gameId: 'test',
    seq: state.actionCount + 1,
    type,
    actor,
    payload,
    createdAt: '2026-09-11T00:00:00.000Z',
  };
  return oath.reduce(structuredClone(state), action);
}

/**
 * baseState, but with every warband off the map so the Supremacy goal is a
 * clean 0-0-0 tie (every seat "meets" it, so the holder keeps the title) and
 * individual goals can be set up without Supremacy fighting them.
 */
function quietBoard(): OathState {
  const s = baseState();
  s.players[0].warbands = { bank: 24, board: 0 };
  s.players[1].warbands = { bank: 14, board: 0 };
  s.players[2].warbands = { bank: 14, board: 0 };
  for (const site of s.sites) site.warbands = s.sites[0].warbands.map(() => 0);
  checkInvariants(s);
  return s;
}

/**
 * Hands `seat` a revealed Vision. baseState already deals one to seat 1, and
 * a card may only be in one zone, so this clears every other holder and
 * pulls the card out of the world deck first.
 */
function giveVision(s: OathState, seat: number, vision: string): void {
  for (const p of s.players) if (p.vision === vision) p.vision = null;
  s.worldDeck = s.worldDeck.filter((id) => id !== vision);
  const displaced = s.players[seat].vision;
  if (displaced !== null && displaced !== vision) s.worldDeck.push(displaced);
  s.players[seat].vision = vision;
}

/** Ends seat `from`'s turn, which begins the next seat's Wake Phase (Law §4.1). */
function rest(s: OathState, from: number, payload: unknown = {}): OathState {
  return act(s, 'turn.rest', from, payload);
}

describe('the Oathkeeper title tracks its goal continuously (Law §2.11)', () => {
  it('moves to the sole seat meeting the goal, and flips to its Oathkeeper side on the way', () => {
    const s = quietBoard();
    s.oath = 'devotion';
    s.oathkeeper = 2;
    s.usurper = true; // an Exile had usurped it
    s.banners[1].holder = 1; // ...but seat 1 holds the Darkest Secret
    expect(s.banners[1].id).toBe(DARKEST_SECRET_ID);
    s.turn.activeSeat = 2;

    // Any action at all re-runs the check — §2.11 is continuous, not phased.
    // Seat 0 is the one waking here, deliberately: the flip back to the
    // Oathkeeper side is only OBSERVABLE when the taker is not also the
    // waking Exile, because §4.1.3 would otherwise re-flip it in the same
    // action. That re-flip is the Usurper clock, and has its own tests.
    const out = rest(s, 2);
    checkInvariants(out);
    expect(out.oathkeeper).toBe(1);
    expect(out.usurper).toBe(false); // §2.11: taking it flips it back
  });

  it('leaves the title with the holder on a tie (§2.11)', () => {
    const s = quietBoard();
    s.oath = 'protection';
    // seat 2 holds one relic in baseState; give seat 1 one too, so they tie.
    s.players[1].relics = [s.relicDeck[0]];
    s.relicDeck = s.relicDeck.slice(1);
    s.oathkeeper = 2;
    const out = rest(s, 1);
    checkInvariants(out);
    expect(out.oathkeeper).toBe(2); // held, not handed over
    expect(out.titleChoice).toBeNull();
  });

  it('hands the holder a CHOICE when several others meet the goal and they do not', () => {
    const s = quietBoard();
    s.oath = 'protection';
    // The Chancellor holds the title but nothing countable; seats 1 and 2
    // tie on relics+banners, so §2.11 gives seat 0 the choice.
    s.grandScepter = 1; // the Scepter is a held relic (§2.4), so it counts
    s.players[2].relics = [s.players[2].relics[0]];
    s.players[1].relics = [];
    s.oathkeeper = 0;
    const out = rest(s, 1);
    checkInvariants(out);
    expect(out.oathkeeper).toBe(0); // unchanged until they choose
    expect(out.titleChoice).toMatchObject({ holder: 0, candidates: [1, 2] });
    expect(oath.pending(out)).toContainEqual(
      expect.objectContaining({ seat: 0, kind: 'oathkeeper', resolves: ['oathkeeper.grant'] }),
    );

    const granted = act(out, 'oathkeeper.grant', 0, { seat: 2 });
    checkInvariants(granted);
    expect(granted.oathkeeper).toBe(2);
    expect(granted.usurper).toBe(false);
    expect(granted.titleChoice).toBeNull();
  });

  it('only the holder may grant it, and only to a seat that meets the goal', () => {
    const s = quietBoard();
    s.oath = 'protection';
    s.grandScepter = 1;
    s.players[2].relics = [s.players[2].relics[0]];
    s.players[1].relics = [];
    s.oathkeeper = 0;
    const pendingChoice = rest(s, 1);
    expect(() => act(pendingChoice, 'oathkeeper.grant', 1, { seat: 1 })).toThrow(/only seat 0/);
    expect(() => act(pendingChoice, 'oathkeeper.grant', 0, { seat: 0 })).toThrow(/does not meet/);
  });

  it('gives the Empire\'s Supremacy claim to the CHANCELLOR, never a Citizen (§2.11)', () => {
    const s = baseState();
    s.oath = 'supremacy';
    s.players[2].citizenship = 'citizen';
    s.players[2].warbands = { bank: 0, board: 0 };
    s.players[0].warbands.bank = 18;
    // The Chancellor garrisons two sites; §6.6.3 makes the Citizen rule them
    // too, so the two are structurally tied and §2.11 breaks it for the Empire.
    const out = rest(s, 1);
    checkInvariants(out);
    expect(out.oathkeeper).toBe(0);
  });
});

describe("the Wake Phase's People's Favor maintenance (Law §4.1.1)", () => {
  /** Seat 2 holds the People's Favor and is about to wake (seat 1 rests). */
  function holderWakes(tokens: number, holderFavor: number): OathState {
    const s = quietBoard();
    const banner = s.banners.find((b) => b.id === PEOPLES_FAVOR_ID)!;
    s.sharedBank.favor += banner.tokens - tokens; // keep favor conserved
    banner.tokens = tokens;
    banner.holder = 2;
    s.sharedBank.favor += s.players[2].favor - holderFavor;
    s.players[2].favor = holderFavor;
    checkInvariants(s);
    return s;
  }

  it('auto-resolves the forced place at exactly one favor, without asking (§4.1.1.I)', () => {
    const s = holderWakes(1, 2);
    const out = rest(s, 1);
    checkInvariants(out);
    expect(out.wake).toBeNull(); // nothing to ask
    expect(out.banners.find((b) => b.id === PEOPLES_FAVOR_ID)!.tokens).toBe(2);
    expect(out.players[2].favor).toBe(1);
  });

  it('...but a holder with NO favor must return instead, even at one (§4.1.1.I\'s "unless")', () => {
    const s = holderWakes(1, 0);
    // One bank strictly lowest, so the return resolves itself too.
    s.favorBanks.beast = 0;
    s.sharedBank.favor += 3;
    checkInvariants(s);
    const out = rest(s, 1);
    checkInvariants(out);
    expect(out.wake).toBeNull();
    expect(out.banners.find((b) => b.id === PEOPLES_FAVOR_ID)!.tokens).toBe(0);
    expect(out.favorBanks.beast).toBe(1);
  });

  it('raises a decision when placing and returning are both open, and applies the answer', () => {
    const s = holderWakes(3, 2);
    const waking = rest(s, 1);
    checkInvariants(waking);
    expect(waking.wake).toMatchObject({ seat: 2, stepsRemaining: 1 });
    expect(oath.pending(waking)).toContainEqual(
      expect.objectContaining({ seat: 2, kind: 'wake', resolves: ['wake.favor'] }),
    );

    const placed = act(waking, 'wake.favor', 2, { choice: 'place' });
    checkInvariants(placed);
    expect(placed.wake).toBeNull();
    expect(placed.banners.find((b) => b.id === PEOPLES_FAVOR_ID)!.tokens).toBe(4);

    const returned = act(waking, 'wake.favor', 2, { choice: 'return', bank: 'hearth' });
    checkInvariants(returned);
    expect(returned.banners.find((b) => b.id === PEOPLES_FAVOR_ID)!.tokens).toBe(2);
    expect(returned.favorBanks.hearth).toBe(s.favorBanks.hearth + 1);
  });

  it('locks the Act Phase until it is resolved (Law §4.1 comes before §4.2)', () => {
    const waking = rest(holderWakes(3, 2), 1);
    expect(() => act(waking, 'turn.rest', 2)).toThrow(/Wake Phase first/);
    expect(() => act(waking, 'warbands.move', 2, { direction: 'toBoard', count: 1 })).toThrow(
      /Wake Phase first/,
    );
  });

  it('rejects a return to a bank that is not among the least-full ones', () => {
    const s = holderWakes(3, 2);
    s.favorBanks.beast = 0;
    s.sharedBank.favor += 3;
    const waking = rest(s, 1);
    expect(() => act(waking, 'wake.favor', 2, { choice: 'return', bank: 'hearth' })).toThrow(
      /least-full/,
    );
    const ok = act(waking, 'wake.favor', 2, { choice: 'return', bank: 'beast' });
    checkInvariants(ok);
    expect(ok.favorBanks.beast).toBe(1);
  });

  it('repeats the step once on the Mob side (§4.1.1.II) and flips to Mob at six (§4.1.1.III)', () => {
    const mob = holderWakes(3, 4);
    mob.banners.find((b) => b.id === PEOPLES_FAVOR_ID)!.mob = true;
    const first = rest(mob, 1);
    expect(first.wake).toMatchObject({ seat: 2, stepsRemaining: 2 }); // two owed
    const second = act(first, 'wake.favor', 2, { choice: 'place' });
    expect(second.wake).toMatchObject({ stepsRemaining: 1 }); // still one to go
    const done = act(second, 'wake.favor', 2, { choice: 'place' });
    checkInvariants(done);
    expect(done.wake).toBeNull();
    expect(done.banners.find((b) => b.id === PEOPLES_FAVOR_ID)!.tokens).toBe(5);

    // ...and the flip, when the step carries it to six. At five favor with
    // favor in hand the step is a free choice, so it has to be answered.
    const toSix = rest(holderWakes(5, 2), 1);
    expect(toSix.wake).toMatchObject({ seat: 2, stepsRemaining: 1 });
    const out = act(toSix, 'wake.favor', 2, { choice: 'place' });
    checkInvariants(out);
    expect(out.banners.find((b) => b.id === PEOPLES_FAVOR_ID)!.tokens).toBe(6);
    expect(out.banners.find((b) => b.id === PEOPLES_FAVOR_ID)!.mob).toBe(true);
  });

  it('asks nothing of a seat who does not hold it', () => {
    const s = quietBoard();
    s.banners.find((b) => b.id === PEOPLES_FAVOR_ID)!.holder = 0;
    const out = rest(s, 1); // seat 2 wakes, holding nothing
    checkInvariants(out);
    expect(out.wake).toBeNull();
  });
});

describe('the Usurper clock (Law §4.1.2 before §4.1.3, §3.1)', () => {
  /** Seat 2 is an Exile holding the title; seat 1 rests, so seat 2 wakes. */
  function exileHoldsTitle(usurper: boolean): OathState {
    const s = quietBoard();
    s.oath = 'devotion';
    s.banners[1].holder = 2; // Darkest Secret — an individual goal seat 2 keeps
    s.oathkeeper = 2;
    s.usurper = usurper;
    checkInvariants(s);
    return s;
  }

  it('does not win on the wake that FLIPS it — §4.1.3 runs after §4.1.2', () => {
    const out = rest(exileHoldsTitle(false), 1);
    checkInvariants(out);
    expect(out.complete).toBe(false); // §4.1.2 saw the Oathkeeper side
    expect(out.usurper).toBe(true); // then §4.1.3 flipped it
  });

  it('wins on the NEXT wake, once the Usurper side is already showing (§3.1)', () => {
    const out = rest(exileHoldsTitle(true), 1);
    checkInvariants(out);
    expect(out.complete).toBe(true);
    expect(out.winner).toBe(2);
    expect(oath.pending(out)).toEqual([]);
  });

  it('never fires for the Chancellor or a Citizen — §4.1.2 and §4.1.3 are Exile-only', () => {
    const s = quietBoard();
    s.oath = 'devotion';
    s.banners[1].holder = 0;
    s.oathkeeper = 0;
    s.usurper = true; // an impossible state for the Chancellor, forced to prove the guard
    s.turn.activeSeat = 2;
    const out = rest(s, 2); // seat 0 wakes
    checkInvariants(out);
    expect(out.complete).toBe(false);
  });
});

describe('the Visionary Win (Law §3.2)', () => {
  /** Seat 2 is an Exile with a revealed Vision, waking after seat 1 rests. */
  function visionary(vision: string, visionsDrawn: number): OathState {
    const s = quietBoard();
    giveVision(s, 2, vision);
    s.visionsDrawn = visionsDrawn;
    return s;
  }

  it('fires when the goal holds and three Visions have been drawn', () => {
    const s = visionary('vision:faith', 3);
    s.banners[1].holder = 2; // the Darkest Secret
    const out = rest(s, 1);
    checkInvariants(out);
    expect(out.complete).toBe(true);
    expect(out.winner).toBe(2);
  });

  it('does NOT fire on the same board with only two Visions drawn (§3.2\'s floor)', () => {
    const s = visionary('vision:faith', 2);
    s.banners[1].holder = 2;
    const out = rest(s, 1);
    checkInvariants(out);
    expect(out.complete).toBe(false);
  });

  it('does not fire when the goal does not hold', () => {
    const s = visionary('vision:faith', 3);
    s.banners[1].holder = 1; // someone else has the Darkest Secret
    const out = rest(s, 1);
    expect(out.complete).toBe(false);
  });

  it('reads Sanctuary as most relics and banners (the unit 17 rename)', () => {
    const s = visionary('vision:sanctuary', 3);
    s.players[2].relics = [s.players[2].relics[0], s.relicDeck[0]];
    s.relicDeck = s.relicDeck.slice(1);
    s.grandScepter = 2;
    const out = rest(s, 1);
    checkInvariants(out);
    expect(out.complete).toBe(true);
    expect(out.winner).toBe(2);
  });

  it('never fires for a Citizen — only Exiles check for a win (§4.1.2)', () => {
    const s = visionary('vision:faith', 3);
    s.banners[1].holder = 2;
    s.players[2].citizenship = 'citizen';
    s.players[2].warbands = { bank: 0, board: 0 };
    s.players[0].warbands.bank = 24;
    checkInvariants(s);
    const out = rest(s, 1);
    checkInvariants(out);
    expect(out.complete).toBe(false);
  });

  it('the Conspiracy carries no goal and never wins (§2.7.2)', () => {
    const s = visionary('vision:conspiracy', 5);
    const out = rest(s, 1);
    expect(out.complete).toBe(false);
  });
});

describe('the Stable Regime Win (Law §3.3)', () => {
  /** Round `round`, seat 2 (the last seat) about to rest and end it. */
  function endOfRound(round: number): OathState {
    const s = quietBoard();
    s.oath = 'devotion';
    s.banners[1].holder = 0; // the Chancellor holds the title legitimately
    s.oathkeeper = 0;
    s.turn.activeSeat = 2;
    s.turn.round = round;
    checkInvariants(s);
    return s;
  }

  it('rolls no die at all while an EXILE holds the title', () => {
    const s = endOfRound(5);
    s.banners[1].holder = 1;
    s.oathkeeper = 1;
    const out = rest(s, 2, { endDie: 6 }); // even a 6 is ignored
    checkInvariants(out);
    expect(out.complete).toBe(false);
  });

  it('ends the game on the exact faces §3.3 lists, round by round', () => {
    const table: [number, number, boolean][] = [
      [5, 5, false], [5, 6, true],
      [6, 4, false], [6, 5, true], [6, 6, true],
      [7, 2, false], [7, 3, true], [7, 6, true],
    ];
    for (const [round, die, ends] of table) {
      const out = rest(endOfRound(round), 2, { endDie: die });
      checkInvariants(out);
      expect(`r${round} d${die} -> ${out.complete}`).toBe(`r${round} d${die} -> ${ends}`);
      if (ends) expect(out.winner).toBe(0);
    }
  });

  it('does not check at all before round five', () => {
    const out = rest(endOfRound(4), 2, { endDie: 6 });
    expect(out.complete).toBe(false);
  });

  it('hands the win to a Citizen meeting the Successor goal instead (§3.3.1)', () => {
    const s = endOfRound(5);
    // Oath is Devotion, so the Successor goal is "holds the Grand Scepter".
    s.players[2].citizenship = 'citizen';
    s.players[2].warbands = { bank: 0, board: 0 };
    s.players[0].warbands.bank = 24;
    s.grandScepter = 2;
    checkInvariants(s);
    const out = rest(s, 2, { endDie: 6 });
    checkInvariants(out);
    expect(out.complete).toBe(true);
    expect(out.winner).toBe(2); // not the Chancellor
  });
});

describe('the War Exhaustion Win (Law §3.4)', () => {
  function endOfEight(): OathState {
    const s = quietBoard();
    s.oath = 'devotion';
    s.turn.activeSeat = 2;
    s.turn.round = 8;
    return s;
  }

  it('3.4.1 — an Imperial Oathkeeper hands it to the Chancellor, with no die', () => {
    const s = endOfEight();
    s.banners[1].holder = 0;
    s.oathkeeper = 0;
    const out = rest(s, 2);
    checkInvariants(out);
    expect(out.complete).toBe(true);
    expect(out.winner).toBe(0);
  });

  it('3.4.2 — otherwise an Exile Usurper wins', () => {
    const s = endOfEight();
    s.banners[1].holder = 1;
    s.oathkeeper = 1;
    s.usurper = true;
    const out = rest(s, 2);
    checkInvariants(out);
    expect(out.winner).toBe(1);
  });

  it('3.4.3 — otherwise a satisfied Visionary, ties broken by Vision order', () => {
    const s = endOfEight();
    s.banners[1].holder = 1; // seat 1 holds the title, NOT usurped
    s.oathkeeper = 1;
    s.visionsDrawn = 3;
    // Seat 2 has Conquest; seat 1 has Faith. Both goals hold (all sites are
    // empty, so every seat ties for most; seat 1 holds the Darkest Secret).
    giveVision(s, 2, 'vision:conquest');
    giveVision(s, 1, 'vision:faith');
    checkInvariants(s);
    const out = rest(s, 2);
    checkInvariants(out);
    expect(out.complete).toBe(true);
    expect(out.winner).toBe(2); // Conquest outranks Faith (§3.4.3)
  });

  it('3.4.4 — otherwise the Chancellor, with the Successor substitution again', () => {
    const plain = rest(endOfEight(), 2);
    checkInvariants(plain);
    expect(plain.winner).toBe(0);

    const s = endOfEight();
    s.players[1].citizenship = 'citizen';
    s.players[1].warbands = { bank: 0, board: 0 };
    s.players[0].warbands.bank = 24;
    s.grandScepter = 1; // Devotion's Successor goal
    checkInvariants(s);
    const out = rest(s, 2);
    checkInvariants(out);
    expect(out.winner).toBe(1);
  });
});

describe('a completed game is closed (Law §3)', () => {
  it('accepts no further action and offers no decision', () => {
    const s = quietBoard();
    s.oath = 'devotion';
    s.banners[1].holder = 2;
    s.oathkeeper = 2;
    s.usurper = true;
    const done = rest(s, 1);
    expect(done.complete).toBe(true);

    expect(oath.pending(done)).toEqual([]);
    expect(oath.isComplete(done)).toBe(true);
    for (const type of ['turn.rest', 'warbands.move', 'power.use', 'citizenship.decline']) {
      expect(() => act(done, type, 0, {})).toThrow(/already complete/);
    }
  });
});

describe("§3.3's end die comes from prepare() and survives replay (HLD D14)", () => {
  it('is rolled once, persisted in the payload, and the refold reuses it', () => {
    const opening = quietBoard();
    opening.oath = 'devotion';
    opening.banners[1].holder = 0;
    opening.oathkeeper = 0;
    opening.turn.activeSeat = 2;
    opening.turn.round = 7; // a 3+ ends it, so most rolls finish the game
    checkInvariants(opening);

    const { gameId } = store.createGame(oath, ['Chancellor', 'Red', 'Blue', 'Yellow']);
    db.prepare('INSERT OR REPLACE INTO snapshots (game_id, seq, state) VALUES (?, ?, ?)').run(
      gameId,
      0,
      JSON.stringify(opening),
    );

    const r = store.appendAction(oath, gameId, store.headSeq(gameId), {
      type: 'turn.rest',
      actor: 2,
      payload: {},
    });
    const out = r.state as OathState;
    const die = (store.history(gameId).at(-1)!.payload as { endDie: number }).endDie;
    expect(die).toBeGreaterThanOrEqual(1);
    expect(die).toBeLessThanOrEqual(6);
    expect(out.complete).toBe(die >= 3); // §3.3's round-seven target
    checkInvariants(out);

    const first = store.loadState(oath, gameId).state;
    db.prepare('DELETE FROM snapshots WHERE game_id = ? AND seq > 0').run(gameId);
    expect(store.loadState(oath, gameId).state).toEqual(first);
  });

  it('is not rolled on a rest that does not end a round five-to-seven', () => {
    const opening = quietBoard();
    opening.turn.activeSeat = 1; // not the last seat, so no round ends
    opening.turn.round = 6;
    const { gameId } = store.createGame(oath, ['Chancellor', 'Red', 'Blue', 'Yellow']);
    db.prepare('INSERT OR REPLACE INTO snapshots (game_id, seq, state) VALUES (?, ?, ?)').run(
      gameId,
      0,
      JSON.stringify(opening),
    );
    store.appendAction(oath, gameId, store.headSeq(gameId), { type: 'turn.rest', actor: 1, payload: {} });
    expect((store.history(gameId).at(-1)!.payload as Record<string, unknown>).endDie).toBeUndefined();
  });
});
