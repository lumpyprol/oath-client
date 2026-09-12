import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { checkInvariants, type OathState } from '../../../src/oath/game/state.js';
import { restrictionKnown } from '../../../src/oath/game/restrictions.js';

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'oath-fullgame-')), 'test.db');

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
 * Seed 1 of the two vendored sample chronicles (see seeded-setup.test.ts).
 * Using a SEED rather than a first game is what makes this script writable
 * at all: a seeded setup is `ordered` (unit 18), so the world deck, the
 * relic deck and the whole board are fixed, and the only randomness left is
 * dice — which the driver reads back and adapts to, rather than guessing.
 */
const SEED =
  '030301000210Empire and Exile0002010123450CFFFFDF22FFFFFF12FFFFFF2EFFFFFF25FFFFFF05FFFFFF21FFFFFF1EFFFFFF3B3F67266B0488D6A316D5B9A87CD2A0867A9C1966D3337649B268D45401AFB0C04092610DB6937F413996943647B157B7659013A6956C519E89557306C39A64503B3213E0E2E7DBDDDCDEE6E1E9E3EDDAE8E4ECEBE5EA000407UNKNOWN';

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
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/** The view a seat is actually served — never raw state. */
async function view(ctx: Ctx, seat: number) {
  const r = await api(`/games/${ctx.gameId}`, { token: ctx.tokens[seat] });
  expect(r.status).toBe(200);
  return r.body as { seq: number; view: Record<string, any>; pending: any[]; complete: boolean };
}

/** Raw state, for invariant checking only — never for deciding what to do. */
function rawState(ctx: Ctx): OathState {
  return store.loadState(oath, ctx.gameId).state as OathState;
}

/** Every action type the script exercised, for the coverage assertion below. */
const used = new Set<string>();
/** Every card the script played or discarded — the §7.2 assertion's subject. */
const played = new Set<string>();

/** Take one action as `seat`, asserting it was accepted and stayed legal. */
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
 * Law §5.5.5's exact sacrifice, computed from the faces the engine rolled
 * and persisted. §9.5 makes it exact rather than "at least", so the driver
 * has to do this arithmetic rather than guess — the same shape the Allies
 * end-to-end test uses.
 */
function sacrificeFor(campaign: any, defenseBonus: number): number {
  const attack = campaign.attackFaces as string[];
  const defense = campaign.defenseFaces as string[];
  const swords =
    attack.filter((f) => f === 'sword').length +
    Math.floor(attack.filter((f) => f === 'hollowSword').length / 2);
  const base = defense.reduce(
    (sum, f) => sum + (f === 'shield' ? 1 : f === 'doubleShield' ? 2 : 0),
    0,
  );
  const shields = base * 2 ** defense.filter((f) => f === 'shieldX2').length;
  const total = shields + defenseBonus;
  return Math.max(0, total - swords + 1);
}

/** The relic the seed leaves beside Narrow Pass — read from raw state, since a projection deliberately hides it. */
function relicAtNarrowPass(ctx: Ctx): string {
  return rawState(ctx).sites.find((s) => s.id === 'site:narrow-pass')!.relics[0];
}

/** A Reliquary relic id. Hidden from every projection (§9.4) until §6.4's peek exists (P4), so the script reads it from raw state — scaffolding, not a move. */
function reliquaryRelic(ctx: Ctx): string {
  return rawState(ctx).reliquary.find((s) => s.relicId !== null)!.relicId!;
}

describe('a full 3-player game, end to end through the HTTP API', () => {
  it('plays from create to a won game, staying legal at every step', async () => {
    const created = await api('/games', {
      method: 'POST',
      body: JSON.stringify({
        kind: 'oath',
        players: ['Chancellor', 'Red', 'Blue'],
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

    // The opening the seed produces, read from seat 0's own view.
    const opening = await view(ctx, 0);
    expect(opening.view.oath).toBe('people');
    expect(opening.view.banners.find((b: any) => b.id === 'banner:peoples-favor').holder).toBe(0);
    expect(opening.view.visionsDrawn).toBe(2); // Law §1.22, from the setup deal
    expect(opening.pending.map((d: any) => d.seat)).toEqual([0]);

    // ---- Round 1, seat 0 (Chancellor) -------------------------------
    // Search the world deck. The seeded deck's second card is a Vision, so
    // §5.1.2 stops the draw at two — and §2.7.1 advances the track to 3,
    // which is what later makes a Visionary Win reachable at all (§3.2).
    let r = await act(ctx, 0, 'search', { from: 'deck' });
    expect(r.view.players[0].hand).toHaveLength(2);
    expect(r.view.visionsDrawn).toBe(3);

    // Play the denizen to the site (§5.1.4.1, gaining its suit's favor) and
    // bin the Vision with it. That also gives the board its first denizen,
    // which is what Muster and Trade need to target.
    const hand = (await view(ctx, 0)).view.players[0].hand as string[];
    const denizenIndex = hand.findIndex((id) => id.startsWith('denizen:'));
    const favorBefore = (await view(ctx, 0)).view.players[0].favor;
    r = await act(ctx, 0, 'card.play', { handIndex: denizenIndex, as: 'site' });
    expect(r.view.players[0].favor).toBe(favorBefore + 1);
    const denizen = hand[denizenIndex];
    for (const id of hand) played.add(id); // the one played, and the one binned with it
    expect(r.view.sites[0].cards.some((c: any) => c?.id === denizen)).toBe(true);

    await act(ctx, 0, 'turn.rest');

    // ---- Round 1, seat 1 (Exile) ------------------------------------
    // Muster off the new denizen (§5.2), then march on the bandits.
    r = await act(ctx, 1, 'muster', { cardId: denizen });
    expect(r.view.players[1].warbands.board).toBe(5); // 3 + 2 (§5.2.2)

    await act(ctx, 1, 'travel', { siteId: 'site:great-slum' });

    // A campaign against the bandits (§5.5.1: nobody rules great-slum, so
    // they are the only legal defender). Winning it is what puts seat 1's
    // first warband on the map.
    r = await act(ctx, 1, 'campaign.declare', {
      defender: 'bandits',
      targets: [{ kind: 'site', siteId: 'site:great-slum' }],
      attackDice: 5,
    });
    expect(r.view.campaign.phase).toBe('roll'); // bandits never respond (§5.5.3)
    r = await act(ctx, 1, 'campaign.roll', {});
    r = await act(ctx, 1, 'campaign.resolve', { sacrifice: sacrificeFor(r.view.campaign, 1) });
    expect(r.view.campaign.phase).toBe('seize');
    r = await act(ctx, 1, 'campaign.seize', {
      placements: [{ siteId: 'site:great-slum', warbands: 1 }],
    });
    expect(r.view.campaign).toBeNull();
    expect(r.view.sites.find((s: any) => s.id === 'site:great-slum').warbands[1]).toBeGreaterThan(0);

    await act(ctx, 1, 'turn.rest');

    // ---- Round 1, seat 2 (Exile) ------------------------------------
    // Trade for favor (§5.3.2.I places a secret on the denizen), then a
    // DECLARED power — the v1 bargain in action (D9/D28): the engine checks
    // access and feasibility, never that the effects match the card's text.
    r = await act(ctx, 2, 'trade', { for: 'favor', cardId: denizen });
    expect(r.view.players[2].favor).toBe(2);
    expect(r.view.sites[0].cards.find((c: any) => c?.id === denizen).secrets).toBe(1);

    r = await act(ctx, 2, 'power.use', {
      cardId: denizen,
      note: 'declared: gain 2 favor',
      effects: [
        { kind: 'favor', from: { kind: 'favorBank', suit: 'arcane' }, to: { kind: 'seatFavor', seat: 2 }, amount: 2 },
      ],
    });
    expect(r.view.players[2].favor).toBe(4);

    // Recover the facedown relic beside Narrow Pass — its §2.8.4 cost is
    // three favor into the Arcane bank.
    r = await act(ctx, 2, 'recover', { target: 'relic', relicId: relicAtNarrowPass(ctx) });
    expect(r.view.players[2].relics).toHaveLength(1);
    expect(r.view.players[2].favor).toBe(1);

    await act(ctx, 2, 'turn.rest');
    // §4.3.2, fixed on 09-12: the secret Trade left on the denizen comes
    // back, so the card is usable again rather than burned for the game.
    expect((await view(ctx, 2)).view.sites[0].cards.find((c: any) => c?.id === denizen).secrets).toBe(0);

    // ---- Round 2, seat 0: the People's Favor wake (Law §4.1.1) -------
    // The banner holds two favor and seat 0 has favor to spare, so neither
    // clause forces the outcome — a real choice, raised as a decision that
    // LOCKS the Act Phase until answered (§4.1 precedes §4.2).
    let pending = (await view(ctx, 0)).pending;
    expect(pending).toContainEqual(
      expect.objectContaining({ seat: 0, kind: 'wake', resolves: ['wake.favor'] }),
    );
    await expect(act(ctx, 0, 'turn.rest')).rejects.toThrow(/Wake Phase/);
    r = await act(ctx, 0, 'wake.favor', { choice: 'place' });
    expect(r.view.banners.find((b: any) => b.id === 'banner:peoples-favor').tokens).toBe(3);

    // Garrison the home site harder (§6.5's toSite half), then hand seat 2
    // Citizenship — the Scepter's own power (§6.6.1).
    r = await act(ctx, 0, 'warbands.move', { direction: 'toSite', count: 1 });
    expect(r.view.sites[0].warbands[0]).toBe(3);

    r = await act(ctx, 0, 'citizenship.offer', { exile: 2, relicId: reliquaryRelic(ctx) });
    expect(r.pending).toContainEqual(
      expect.objectContaining({ seat: 2, resolves: ['citizenship.accept', 'citizenship.decline'] }),
    );
    // Seat 2 answers out of turn — a Citizenship offer does not lock (unit 16).
    r = await act(ctx, 2, 'citizenship.accept', {});
    expect(r.view.players[2].citizenship).toBe('citizen');
    expect(r.view.players[2].warbands).toEqual({ bank: 0, board: 0 }); // D41

    await act(ctx, 0, 'power.use', {
      cardId: denizen,
      note: 'declared: a second power, this one a no-op',
      effects: [],
    });
    await act(ctx, 0, 'turn.rest');

    // ---- Round 2, seat 1: reveal the Vision (§6.1 -> §5.1.4.3) -------
    played.add('vision:conquest');
    r = await act(ctx, 1, 'adviser.play', { adviserIndex: 0, as: 'faceup' });
    expect(r.view.players[1].vision).toBe('vision:conquest');
    expect(r.view.players[1].advisers).toHaveLength(0); // §2.2.1: not an adviser
    await act(ctx, 1, 'turn.rest');

    // ---- Round 2, seat 2: a Citizen attacks the Empire ---------------
    // §5.5.1 suspends the attacking Citizen's Imperial status, so the
    // Chancellor defends as the sole Imperial force (unit 16a), with §2.11's
    // title die on top (unit 16c). Seat 2 has no warbands left to attack
    // with, so this is a campaign they will lose — which is the point: the
    // losing branch of §5.5.6 is as much part of the game as the winning one.
    r = await act(ctx, 2, 'campaign.declare', {
      defender: 0,
      targets: [{ kind: 'site', siteId: 'site:narrow-pass' }],
      attackDice: 0,
    });
    expect(r.view.campaign.phase).toBe('respond'); // a player defender DOES respond
    expect(r.view.campaign.allies).toEqual([]); // §5.5.1 left no Imperial ally
    expect(r.view.campaign.defenseDice).toBe(2); // 1 site + 1 Oathkeeper (§2.11)
    r = await act(ctx, 0, 'campaign.respond', {});
    r = await act(ctx, 2, 'campaign.roll', {});
    r = await act(ctx, 2, 'campaign.resolve', { sacrifice: 0 });
    expect(r.view.campaign).toBeNull(); // defeated: §5.5.6 clears it
    await act(ctx, 2, 'turn.rest');

    // ---- Round 3, seat 0: one more wake, then hand over --------------
    await act(ctx, 0, 'wake.favor', { choice: 'place' });
    r = await act(ctx, 0, 'turn.rest');

    // ...and seat 1's Wake Phase ends the game: §3.2's Visionary Win, with
    // the Vision of Conquest's goal met (every seat rules one site, and a
    // tie MEETS the goal — D45) and three Visions drawn.
    expect(r.complete).toBe(true);
    const final = rawState(ctx);
    expect(final.winner).toBe(1);
    expect(oath.pending(final)).toEqual([]);
    checkInvariants(final);

    // ---- what the run proves ----------------------------------------
    // Every major action (§5), both minor ones unit 16b added, a declared
    // power, a citizenship transition, and a Wake decision.
    for (const type of [
      'search', 'muster', 'trade', 'travel', 'recover', 'campaign.declare',
      'card.play', 'adviser.play', 'warbands.move', 'power.use',
      'citizenship.offer', 'citizenship.accept', 'wake.favor', 'turn.rest',
      'campaign.respond', 'campaign.roll', 'campaign.resolve', 'campaign.seize',
    ]) {
      expect(used, `never exercised ${type}`).toContain(type);
    }

    // §7.2 (Q12/D46): the game may not lean on the unread-restriction gap.
    // Every card it put into play or binned has had its face read, so a
    // passing run proves these plays were LEGAL, not merely unchecked.
    for (const cardId of played) {
      expect(restrictionKnown(cardId), `${cardId} has no transcribed §7.2 restriction`).toBe(true);
    }

    // Restart survival: drop every snapshot after the opening and refold
    // the whole game from the log alone.
    const before = store.loadState(oath, ctx.gameId).state;
    db.prepare('DELETE FROM snapshots WHERE game_id = ? AND seq > 0').run(ctx.gameId);
    expect(store.loadState(oath, ctx.gameId).state).toEqual(before);

    // The log becomes unit 20's audit fixture. Strip `gameId` and
    // `createdAt`: both are fresh every run, so writing them through made
    // the committed fixture churn on every single `npm test` and left the
    // tree permanently dirty. Neither is replayable input — the audit
    // refolds from `seed` with the engine, and needs only what `reduce`
    // reads (Law-relevant fields), not the store's row metadata.
    const log = store.history(ctx.gameId).map(({ seq, type, actor, payload }) => ({
      seq,
      type,
      actor,
      payload,
    }));
    const fixture = join(import.meta.dirname, '..', '..', 'fixtures', 'fullgame.log.json');
    mkdirSync(dirname(fixture), { recursive: true });
    // Written ONCE and then frozen. This test deliberately does not pin the
    // dice — it computes against whatever the engine rolled (§5.5.5's exact
    // sacrifice) — so rewriting the fixture every run left it churning
    // forever and made the audit depend on file order. A frozen log is also
    // the better audit input: it is a real recorded game, and it stays the
    // same game across commits, so an audit regression is a code change and
    // never a reroll.
    //
    // To regenerate deliberately (e.g. after a payload-shape change):
    //     rm test/fixtures/fullgame.log.json && npm test
    // If an engine change makes the frozen log unreplayable, audit.test.ts's
    // first case fails by name and tells you to do exactly that.
    if (!existsSync(fixture)) {
      writeFileSync(fixture, `${JSON.stringify({ seed: SEED, players: 3, actions: log }, null, 2)}\n`);
    }
    expect(log.length).toBeGreaterThan(20);
  });
});
