/**
 * P3 unit 9: six players, measured — the phase's acceptance test.
 *
 * A scripted 6-player game over the in-process HTTP app, driven the way
 * fullgame.test.ts drives its 3-player one: intents submitted against
 * PROJECTED views, never against raw state, so the script can only do what a
 * real client could. Raw state is read for invariant checks and for the
 * hidden facts a projection legitimately withholds (a Reliquary relic id) —
 * scaffolding, never a move.
 *
 * What this run exists to prove, in coverage terms rather than length:
 *   - Law §1.23's setup choices, all six seats (unit 8)
 *   - campaigns against an Imperial defender with a Citizen joining as an
 *     Ally AND acting inside §5.5.3's battle-plan window (unit 5 — the thing
 *     P2 could not do at all)
 *   - a campaign against a STANDING DEFENCE costing the defender zero
 *     actions (unit 7's exit criterion, re-proven at six seats)
 *   - warband permissions answered by policy rather than by a round trip
 *     (unit 6)
 *   - a batched multi-step Wake (unit 3)
 *   - a Citizenship offer negotiated mid-game (unit 16)
 *
 * Its frozen log then feeds three things: the hidden-information audit, unit
 * 1's catalogue-coverage fold, and the visit metric whose numbers are the
 * phase's recorded result.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { checkInvariants, type OathState } from '../../../src/oath/game/state.js';
import { computeVisitMetrics, summarize } from './metrics.js';

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'oath-sixplayer-')), 'test.db');

let server: Server;
let base: string;
let store: typeof import('../../../src/actionlog.js');
let db: typeof import('../../../src/db.js')['db'];
let oath: typeof import('../../../src/oath/game/index.js')['oath'];

beforeAll(async () => {
  const { app } = await import('../../../src/app.js');
  store = await import('../../../src/actionlog.js');
  ({ db } = await import('../../../src/db.js'));
  ({ oath } = await import('../../../src/oath/game/index.js'));
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

/**
 * Seed 0 of the two vendored sample chronicles (seeded-setup.test.ts). At
 * six seats it deals exactly the table this unit needs: a Chancellor, TWO
 * Citizens (seats 1 and 2) and three Exiles — so §5.5.2's Ally machinery and
 * §6.5's Citizen permission clause both have real subjects, which a 3-player
 * game can never provide. The Oath is Devotion, so §1.13 hands the
 * Chancellor the Darkest Secret.
 */
const SEED =
  '030100000710Empire and Exile00180234152011FFFFFF21FFFFFF0AFFFFFF25FFFFFF1FFFFFFF05FFFFFF2EFFFFFF2AFFFFFF4107D313A90BC301411BD4B96FBF0509399EA684173132A89AD6D223D53F107F481214751F438CA3352F2A64614B080AAFA20F1D8A727D1EC0332D55605B2C8B3E211E110C222E201A290D261502242803192B2718253004341606000E4A971CAB02E8DE';

interface Ctx {
  gameId: string;
  tokens: string[];
  seq: number;
}

async function api(path: string, init?: RequestInit & { token?: string }) {
  const { token, ...rest } = init ?? {};
  const res = await fetch(`${base}${path}`, {
    ...rest,
    headers: {
      'content-type': 'application/json',
      ...(token ? { 'x-player-token': token } : {}),
      ...(rest.headers ?? {}),
    },
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

/** Raw state — invariants and scaffolding only, never for deciding a move. */
function rawState(ctx: Ctx): OathState {
  return store.loadState(oath, ctx.gameId).state as OathState;
}

async function view(ctx: Ctx, seat: number) {
  const r = await api(`/games/${ctx.gameId}`, { token: ctx.tokens[seat] });
  expect(r.status).toBe(200);
  return r.body as { seq: number; view: Record<string, any>; pending: any[]; complete: boolean };
}

/** Every action type the script exercised, for the coverage assertion. */
const used = new Set<string>();

async function act(ctx: Ctx, seat: number, type: string, payload: unknown = {}) {
  const r = await api(`/games/${ctx.gameId}/actions`, {
    method: 'POST',
    token: ctx.tokens[seat],
    body: JSON.stringify({ prevSeq: ctx.seq, type, payload }),
  });
  if (r.status !== 201) {
    throw new Error(`seat ${seat} ${type} -> ${r.status} ${JSON.stringify(r.body)}`);
  }
  ctx.seq = r.body.seq as number;
  checkInvariants(rawState(ctx)); // after EVERY action
  used.add(type);
  return r.body as { seq: number; complete: boolean; view: Record<string, any>; pending: any[] };
}

/**
 * Law §5.5.4's defending force, recomputed independently of the engine —
 * the same discipline `shieldsOf` follows in the allies test. Narrow on
 * purpose: this game targets ONE site and every pawn is on it, so the two
 * clauses that matter are the Imperial site warbands there and the board
 * warbands of the defender and each permitted Ally.
 */
function defendingForceTotal(s: OathState): number {
  const c = s.campaign!;
  const defender = c.defenderSeat as number;
  const imperial = s.players
    .map((p, seat) => ({ p, seat }))
    .filter(({ p, seat }) => p.citizenship !== 'exile' && seat !== c.attackerSeat)
    .map(({ seat }) => seat);
  let total = 0;
  for (const t of c.targets) {
    if (t.kind !== 'site') continue;
    const site = s.sites.find((x) => x.id === t.siteId)!;
    for (const seat of imperial) total += site.warbands[seat];
  }
  for (const seat of [defender, ...c.allies]) total += s.players[seat].warbands.board;
  return total;
}

/** Law §5.5.5's exact sacrifice, and whether the attacker can afford it. */
function planResolve(s: OathState, boardBonus = defendingForceTotal(s)) {
  const c = s.campaign!;
  const attack = c.attackFaces!;
  const defense = c.defenseFaces!;
  const swords =
    attack.filter((f) => f === 'sword').length +
    Math.floor(attack.filter((f) => f === 'hollowSword').length / 2);
  const base = defense.reduce((t, f) => t + (f === 'shield' ? 1 : f === 'doubleShield' ? 2 : 0), 0);
  const total = base * 2 ** defense.filter((f) => f === 'shieldX2').length + boardBonus;
  const needed = Math.max(0, total - swords + 1);
  // Skulls are killed BEFORE the sacrifice is paid (§5.5.5) — the flake
  // unit 7's loop caught, not repeated here.
  const skulls = attack.filter((f) => f === 'skull').length;
  const affordable = needed <= s.players[c.attackerSeat].warbands.board - skulls;
  return { sacrifice: affordable ? needed : 0, wins: affordable };
}

/**
 * Resolve `seat`'s Wake if one is owed. Every pawn in this game starts on an
 * Opportunity Site (§4.1.4), so a take is owed each turn until the site is
 * drained — one batched `wake.resolve` either way (unit 3).
 */
async function resolveWakeIfAny(ctx: Ctx, seat: number) {
  const w = rawState(ctx).wake;
  if (!w || w.seat !== seat) return null;
  const steps = Array.from({ length: w.stepsRemaining }, () => ({ choice: 'place' }));
  const take = w.opportunity !== null ? { take: 'secret' as const } : undefined;
  return act(ctx, seat, 'wake.resolve', take ? { steps, take } : { steps });
}

/** Any faceup site that is not `avoid` — for a legal Travel destination. */
function pickOtherFaceup(v: { view: Record<string, any> }, avoid: string): string {
  const site = v.view.sites.find((s: any) => !s.facedown && s.id !== null && s.id !== avoid);
  expect(site, 'the board has no second faceup site to travel to').toBeDefined();
  return site.id;
}

describe('six players, measured (P3 unit 9)', () => {
  it('plays a scripted 6-player game exercising every P3 decision shape', async () => {
    const created = await api('/games', {
      method: 'POST',
      body: JSON.stringify({
        kind: 'oath',
        players: ['Chancellor', 'Cit1', 'Cit2', 'Ex3', 'Ex4', 'Ex5'],
        options: { seed: SEED },
      }),
    });
    expect(created.status).toBe(201);
    const ctx: Ctx = {
      gameId: created.body.gameId as string,
      tokens: (created.body.players as { seat: number; token: string }[])
        .sort((a, b) => a.seat - b.seat)
        .map((p) => p.token),
      seq: 0,
    };
    checkInvariants(rawState(ctx));

    const opening = await view(ctx, 0);
    expect(opening.view.oath).toBe('devotion');
    expect(opening.view.players.map((p: any) => p.citizenship)).toEqual([
      'chancellor', 'citizen', 'citizen', 'exile', 'exile', 'exile',
    ]);

    // ---- Law §1.23: all six setup choices, in turn order (unit 8) -----
    // Every seat lands on the top Cradle site. That is forced for the
    // Chancellor (§1.23.1) and chosen for the rest, and it is what gives
    // this game its subject matter: co-located pawns make §5.5.2's Ally
    // eligibility and §5.5.1's defender legality both reachable.
    const cradle = opening.view.sites.find((s: any) => !s.facedown && s.region === 'cradle');
    expect(cradle).toBeDefined();
    for (let seat = 0; seat < 6; seat++) {
      const pend = (await view(ctx, seat)).pending;
      expect(pend).toHaveLength(1);
      expect(pend[0]).toMatchObject({ seat, kind: 'setup', resolves: ['setup.choose'] });
      const r = await act(ctx, seat, 'setup.choose', { siteId: cradle.id, keepIndex: 0 });
      expect(r.view.players[seat].pawnSite).toBe(cradle.id);
    }
    expect(rawState(ctx).setupChoices).toBeNull();

    // ---- Round 1, seat 0: the opening Wake, deferred out of init ------
    // Every pawn is on the top Cradle site, which this chronicle deals as
    // the Drowned City — one of §4.1.4's three Opportunity Sites. So the
    // opening Wake offers a take, and the batched `wake.resolve` (unit 3)
    // answers the whole phase in one action.
    let pend = (await view(ctx, 0)).pending;
    expect(pend[0]).toMatchObject({ seat: 0, kind: 'wake', resolves: ['wake.resolve'] });
    const secretsBefore = (await view(ctx, 0)).view.players[0].secrets.ready;
    let r = await act(ctx, 0, 'wake.resolve', { steps: [], take: { take: 'secret' } });
    expect(r.view.players[0].secrets.ready).toBe(secretsBefore + 1);
    expect(rawState(ctx).wake).toBeNull();

    await act(ctx, 0, 'turn.rest');

    // ---- Round 1, seats 1-2: the Citizens garrison, and a permission ---
    // Every seat's pawn is on the Opportunity Site, so each turn opens with
    // a Wake that owes the §4.1.4 take until the site is drained.
    await resolveWakeIfAny(ctx, 1);
    r = await act(ctx, 1, 'warbands.move', { direction: 'toSite', count: 2 });
    expect(r.view.sites[0].warbands[1]).toBe(2);

    // §6.5: a CITIZEN needs the Chancellor's permission to pull warbands
    // back off a site. Unanswered, that is a real round trip — so seat 1
    // asks once the hard way, and the Chancellor answers.
    r = await act(ctx, 1, 'warbands.move', { direction: 'toBoard', count: 1 });
    expect(r.pending).toContainEqual(
      expect.objectContaining({ seat: 0, kind: 'warbands', resolves: ['warbands.allow', 'warbands.deny'] }),
    );
    r = await act(ctx, 0, 'warbands.allow', {});
    expect(r.view.sites[0].warbands[1]).toBe(1);
    await act(ctx, 1, 'turn.rest');

    await resolveWakeIfAny(ctx, 2);
    // ...and now the Chancellor adopts a policy, so the NEXT such request
    // costs them nothing at all (unit 6). Legal outside their own turn —
    // the one action that is.
    await act(ctx, 0, 'standing.set', { warbands: 'allow' });
    r = await act(ctx, 2, 'warbands.move', { direction: 'toSite', count: 2 });
    r = await act(ctx, 2, 'warbands.move', { direction: 'toBoard', count: 1 });
    expect(rawState(ctx).warbandRequest).toBeNull(); // never raised
    expect(r.pending.some((d: any) => d.kind === 'warbands')).toBe(false);
    expect(r.view.sites[0].warbands[2]).toBe(1);
    await act(ctx, 2, 'turn.rest');

    // ---- Round 1, seat 3: a campaign with a Citizen Ally in the window --
    await resolveWakeIfAny(ctx, 3);
    const site = cradle.id;
    r = await act(ctx, 3, 'campaign.declare', {
      defender: 0,
      targets: [{ kind: 'site', siteId: site }],
      attackDice: 2,
    });
    // §5.5.2's JOIN window (unit 5), owed by BOTH eligible Citizens.
    expect(r.view.campaign.phase).toBe('join');
    expect(r.pending.filter((d: any) => d.resolves.includes('campaign.ally')).map((d: any) => d.seat)).toEqual([1, 2]);

    r = await act(ctx, 1, 'campaign.ally', { join: true });
    expect(r.view.campaign.phase).toBe('join'); // seat 2 still owes an answer
    r = await act(ctx, 2, 'campaign.ally', { join: false });
    expect(r.view.campaign.phase).toBe('permit'); // the last answer closed it
    r = await act(ctx, 0, 'campaign.permit', { allies: [1] });
    expect(r.view.campaign.phase).toBe('respond');
    expect(r.view.campaign.allies).toContain(1);

    // THE §5.5.3 PROOF, at six seats: a permitted Citizen Ally acts inside
    // the battle-plan window. P2 could not reach this at all.
    r = await act(ctx, 1, 'power.use', {
      cardId: site, // their pawn is here, so §7.1.1 grants access
      note: 'declared: a battle plan the Ally rules (v1 declares, does not enforce)',
      effects: [],
    });
    expect(r.view.campaign.phase).toBe('respond'); // still open; respond closes it

    r = await act(ctx, 0, 'campaign.respond', {});
    expect(r.view.campaign.phase).toBe('rolled'); // D51: respond carried the dice
    const planA = planResolve(rawState(ctx));
    r = await act(ctx, 3, 'campaign.resolve', {
      sacrifice: planA.sacrifice,
      ...(planA.wins ? { seize: { placements: [{ siteId: site, warbands: 1 }] } } : {}),
    });
    await act(ctx, 3, 'turn.rest');

    // ---- Round 1, seats 4-5 --------------------------------------------
    await resolveWakeIfAny(ctx, 4);
    await act(ctx, 4, 'travel', { siteId: pickOtherFaceup(await view(ctx, 4), site) });
    await act(ctx, 4, 'turn.rest');

    await resolveWakeIfAny(ctx, 5);
    await act(ctx, 5, 'search', { from: 'deck' });
    const hand5 = (await view(ctx, 5)).view.players[5].hand as string[];
    await act(ctx, 5, 'card.play', { handIndex: 0, as: 'adviser', facedown: false });
    expect(hand5.length).toBeGreaterThan(0);
    await act(ctx, 5, 'turn.rest');

    expect(rawState(ctx).turn.round).toBe(2);

    // ---- Round 2, seat 0: a Citizenship offer, negotiated ---------------
    await resolveWakeIfAny(ctx, 0);
    // The Reliquary relic ids are hidden from every projection until P4's
    // Peek (§6.3), so the script reads one from raw state — scaffolding,
    // the same allowance fullgame.test.ts makes.
    const relicId = rawState(ctx).reliquary.find((sp) => sp.relicId !== null)!.relicId!;
    r = await act(ctx, 0, 'citizenship.offer', {
      exile: 3,
      relicId,
      give: { favor: 1 }, // negotiated terms, not just the mandatory relic
    });
    expect(r.pending).toContainEqual(
      expect.objectContaining({ seat: 3, kind: 'citizenshipOffer' }),
    );
    // Answered out of turn — a Citizenship offer does not lock (unit 16).
    r = await act(ctx, 3, 'citizenship.accept', {});
    expect(r.view.players[3].citizenship).toBe('citizen');
    await act(ctx, 0, 'turn.rest');

    // ---- Round 2, seats 1-2: adopt standing responses -------------------
    // The two Citizens decide they never want to be asked about joining a
    // defence, and the Chancellor decides they never want the battle-plan
    // window. Together those make the next campaign a one-visit affair.
    await resolveWakeIfAny(ctx, 1);
    await act(ctx, 1, 'standing.set', { ally: 'pass' });
    await act(ctx, 1, 'turn.rest');

    await resolveWakeIfAny(ctx, 2);
    await act(ctx, 2, 'standing.set', { ally: 'pass' });
    await act(ctx, 0, 'standing.set', { defense: 'close' }); // out of turn, legal
    // Seat 3 is a Citizen now, so they are eligible to join too.
    await act(ctx, 3, 'standing.set', { ally: 'pass' });
    await act(ctx, 2, 'turn.rest');

    // ---- Round 2, seat 3 (now a Citizen) --------------------------------
    await resolveWakeIfAny(ctx, 3);
    await act(ctx, 3, 'turn.rest');

    // ---- Round 2, seat 4: THE STANDING-DEFENCE CAMPAIGN -----------------
    // Unit 7's exit criterion, re-proven at six seats: every window closes
    // by policy, so the log between declare and resolve is empty and the
    // defender submits nothing at all.
    await resolveWakeIfAny(ctx, 4);
    await act(ctx, 4, 'travel', { siteId: site }); // back to the contested site
    const beforeStanding = ctx.seq;
    r = await act(ctx, 4, 'campaign.declare', {
      defender: 0,
      targets: [{ kind: 'site', siteId: site }],
      attackDice: 2,
    });
    // Straight to 'rolled' — join, permit and respond all closed inside
    // declare's own reduce, and its prepare() carried the dice (D51).
    expect(r.view.campaign.phase).toBe('rolled');
    const declareRow = store.history(ctx.gameId).find((a) => a.seq === ctx.seq)!;
    expect((declareRow.payload as { attackFaces: string[] }).attackFaces).toHaveLength(2);

    const planB = planResolve(rawState(ctx));
    await act(ctx, 4, 'campaign.resolve', { sacrifice: planB.sacrifice });

    // THE ASSERTION: two actions between them, both seat 4's.
    const standingCampaign = store
      .history(ctx.gameId)
      .filter((a) => a.seq > beforeStanding && a.type.startsWith('campaign.'));
    expect(standingCampaign.map((a) => `${a.type}/${a.actor}`)).toEqual([
      'campaign.declare/4',
      'campaign.resolve/4',
    ]);
    await act(ctx, 4, 'turn.rest');

    // ---- Round 2, seat 5 -------------------------------------------------
    await resolveWakeIfAny(ctx, 5);
    await act(ctx, 5, 'adviser.play', { adviserIndex: 0, as: 'faceup' });
    await act(ctx, 5, 'turn.rest');

    expect(rawState(ctx).turn.round).toBe(3);

    // ---- Round 3: a SECOND allied campaign, with the policies revoked ---
    // Revocation affects future raises only (D52), so putting seat 1 back on
    // 'ask' brings their join question back — and proves the second allied
    // campaign is not an accident of the first one's state.
    await resolveWakeIfAny(ctx, 0);
    await act(ctx, 0, 'standing.set', { defense: 'ask' });
    await act(ctx, 1, 'standing.set', { ally: 'ask' });
    await act(ctx, 0, 'turn.rest');

    await resolveWakeIfAny(ctx, 1);
    await act(ctx, 1, 'turn.rest');
    await resolveWakeIfAny(ctx, 2);
    await act(ctx, 2, 'turn.rest');
    await resolveWakeIfAny(ctx, 3);
    await act(ctx, 3, 'turn.rest');
    await resolveWakeIfAny(ctx, 4);
    await act(ctx, 4, 'turn.rest');

    await resolveWakeIfAny(ctx, 5);
    // Seat 5 never left the contested site, so no Travel is needed here.
    expect((await view(ctx, 5)).view.players[5].pawnSite).toBe(site);
    r = await act(ctx, 5, 'campaign.declare', {
      defender: 0,
      targets: [{ kind: 'site', siteId: site }],
      attackDice: 2,
    });
    // Seat 1 is back on 'ask'; seats 2 and 3 are still passing, so exactly
    // one join question is raised.
    expect(r.view.campaign.phase).toBe('join');
    const owed = r.pending.filter((d: any) => d.resolves.includes('campaign.ally'));
    expect(owed.map((d: any) => d.seat)).toEqual([1]);

    r = await act(ctx, 1, 'campaign.ally', { join: true });
    expect(r.view.campaign.phase).toBe('permit');
    r = await act(ctx, 0, 'campaign.permit', { allies: [1] });
    // A second Citizen Ally acting in the plan window.
    await act(ctx, 1, 'power.use', {
      cardId: site,
      note: 'declared: a battle plan, second allied campaign',
      effects: [],
    });
    r = await act(ctx, 0, 'campaign.respond', {});
    expect(r.view.campaign.phase).toBe('rolled');
    const planC = planResolve(rawState(ctx));
    await act(ctx, 5, 'campaign.resolve', { sacrifice: planC.sacrifice });
    await act(ctx, 5, 'turn.rest');

    // ---- what the run proves --------------------------------------------
    const final = rawState(ctx);
    checkInvariants(final);
    expect(final.turn.round).toBe(4);
    expect(final.complete).toBe(false); // no §3.3 check before round 5

    for (const type of [
      'setup.choose', 'wake.resolve', 'standing.set',
      'campaign.declare', 'campaign.ally', 'campaign.permit', 'campaign.respond', 'campaign.resolve',
      'warbands.move', 'warbands.allow',
      'citizenship.offer', 'citizenship.accept',
      'travel', 'search', 'card.play', 'adviser.play', 'power.use', 'turn.rest',
    ]) {
      expect(used, `never exercised ${type}`).toContain(type);
    }

    // Restart survival: drop every snapshot and refold from the log alone.
    const before = store.loadState(oath, ctx.gameId).state;
    db.prepare('DELETE FROM snapshots WHERE game_id = ? AND seq > 0').run(ctx.gameId);
    expect(store.loadState(oath, ctx.gameId).state).toEqual(before);

    // ---- freeze the log, exactly like the fullgame fixture ---------------
    const log = store.history(ctx.gameId).map(({ seq, type, actor, payload }) => ({
      seq,
      type,
      actor,
      payload,
    }));
    const fixture = join(import.meta.dirname, '..', '..', 'fixtures', 'sixplayer.log.json');
    mkdirSync(dirname(fixture), { recursive: true });
    // Written ONCE and then frozen — unit 19's discipline, and for its
    // reasons: this test does not pin the dice (it computes against whatever
    // the engine rolled), so rewriting every run would leave the fixture
    // churning forever and make the audit depend on file order.
    //
    // To regenerate deliberately:
    //     rm test/fixtures/sixplayer.log.json && npm test
    if (!existsSync(fixture)) {
      writeFileSync(fixture, `${JSON.stringify({ seed: SEED, players: 6, actions: log }, null, 2)}\n`);
    }
    expect(log.length).toBeGreaterThan(40);
  });

  /**
   * The phase's recorded result. Read off the FROZEN log, so the numbers in
   * INTERRUPTS.md and the HLD are reproducible rather than whatever this
   * run happened to do.
   */
  it('measures the async cost of a six-player turn', () => {
    const fixture = JSON.parse(
      readFileSync(join(import.meta.dirname, '..', '..', 'fixtures', 'sixplayer.log.json'), 'utf8'),
    ) as { actions: { type: string; actor: number | null }[] };
    const m = computeVisitMetrics(fixture.actions);
    const turns = summarize(m.turns);
    const campaigns = summarize(m.campaigns);

    // Recorded in INTERRUPTS.md and HLD §P3. Asserted as exact values so a
    // change to the engine that moves them fails loudly here first.
    expect(m.turns).toEqual([7, 3, 3, 7, 1, 1, 3, 1, 4, 1, 1, 1, 3, 1, 1, 1, 1, 6]);
    expect(turns.avg).toBeCloseTo(2.56, 2);
    expect(turns.max).toBe(7);
    expect(m.campaigns).toEqual([7, 1, 6]);
    expect(campaigns.avg).toBeCloseTo(4.67, 2);

    // THE ONE THAT MATTERS: the standing-defence campaign, unit 7's exit
    // criterion re-proven at six seats. One visit — the attacker's.
    expect(Math.min(...m.campaigns)).toBe(1);

    // ...and the finding, pinned so it cannot drift silently. Max visits per
    // turn is 7, above the plan's threshold of 3. See INTERRUPTS.md for the
    // decomposition: both 7s are irreducible by batching (six sequential
    // §1.23 setup choices in one bucket; six DIFFERENT seats acting in the
    // fully-asking allied campaign), and standing responses are the
    // mitigation — which the 1 above measures.
    expect(turns.max).toBeLessThanOrEqual(7);
  });
});
