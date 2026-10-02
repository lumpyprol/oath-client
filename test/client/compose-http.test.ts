/**
 * Unit 11 over HTTP: POST /games/:id/act, driven exactly as a browser with
 * NO script would drive it — fetch the board, parse the server's own forms,
 * submit urlencoded bodies, follow 303s. Nothing here builds a payload by
 * hand except the deliberately forged one in the illegal-action test.
 *
 * Covers the unit's exit criteria: a full turn composed and submitted through
 * forms; the 409 re-render (status 200, banner, fresh seq, repopulated
 * composer — and the JSON API's 409 UNCHANGED beside it); the illegal
 * re-render, shown reachable by a hand-built race; and the dry run's round
 * trip, which writes nothing.
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { parseForms, baselineSubmission, metaValue, encodeBody, type ParsedForm } from './form-lib.js';
import type { RawBody } from '../../src/client/composer.js';

// The dice, rigged: every attack die a sword, every other die its first face
// (a blank defense die). Only the campaign test below depends on it; it lets
// a winning campaign be played through forms deterministically.
vi.mock('../../src/engine/random.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/engine/random.js')>();
  return {
    ...real,
    rollDice: <T,>(faces: readonly T[], count: number): T[] =>
      Array.from({ length: count }, () => ((faces as readonly unknown[]).includes('sword') ? ('sword' as T) : faces[0])),
  };
});

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'oath-compose-')), 'test.db');
process.env.SESSION_SECRET = 'compose-test-secret';

let server: Server;
let base: string;
let encodeSession: typeof import('../../src/session.js')['encodeSession'];

beforeAll(async () => {
  const { app } = await import('../../src/app.js');
  ({ encodeSession } = await import('../../src/session.js'));
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

interface Game {
  gameId: string;
  tokens: string[];
}

async function newGame(): Promise<Game> {
  const res = await fetch(`${base}/api/games`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'oath', players: ['a', 'b', 'c', 'd'] }),
  });
  const body = (await res.json()) as { gameId: string; players: { seat: number; token: string }[] };
  return { gameId: body.gameId, tokens: body.players.sort((x, y) => x.seat - y.seat).map((p) => p.token) };
}

const cookieFor = (gameId: string, seat: number) => `oath_session=${encodeSession({ gameId, seat })}`;

async function getPage(path: string, cookie: string): Promise<{ status: number; html: string }> {
  const res = await fetch(`${base}${path}`, { headers: { accept: 'text/html', cookie }, redirect: 'manual' });
  return { status: res.status, html: await res.text() };
}

async function post(path: string, body: RawBody, cookie?: string) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html', ...(cookie ? { cookie } : {}) },
    body: encodeBody(body),
    redirect: 'manual',
  });
  return { status: res.status, location: res.headers.get('location'), html: await res.text() };
}

async function api(g: Game, seat = 0) {
  const res = await fetch(`${base}/api/games/${g.gameId}`, { headers: { 'x-player-token': g.tokens[seat] } });
  return (await res.json()) as { seq: number; pending: { id: string; seat: number; kind: string }[] };
}

async function boardForms(g: Game, seat: number): Promise<{ html: string; forms: ParsedForm[] }> {
  const page = await getPage(`/games/${g.gameId}`, cookieFor(g.gameId, seat));
  expect(page.status).toBe(200);
  return { html: page.html, forms: parseForms(page.html) };
}

const formOf = (forms: ParsedForm[], type: string): ParsedForm | undefined => forms.find((f) => metaValue(f, '_type') === type);

/** Submit the first legal choice of `type` from `seat`'s board; expect the 303. */
async function submit(g: Game, seat: number, type: string, tweak?: (b: RawBody) => void): Promise<void> {
  const { forms } = await boardForms(g, seat);
  const form = formOf(forms, type);
  expect(form, `seat ${seat} has a ${type} form`).toBeDefined();
  const body = baselineSubmission(form!, true);
  tweak?.(body);
  const res = await post(form!.attrs.action, body, cookieFor(g.gameId, seat));
  expect(res.status, res.html.match(/role="alert"><p>([^<]*)/)?.[1]).toBe(303);
  expect(res.location).toBe(`/games/${g.gameId}`);
}

/** Every seat's setup choice, each through its own form. */
async function completeSetup(g: Game): Promise<void> {
  for (let i = 0; i < 8; i++) {
    const setup = (await api(g)).pending.find((d) => d.kind === 'setup');
    if (!setup) return;
    await submit(g, setup.seat, 'setup.choose');
  }
  throw new Error('setup did not finish');
}

/** The seat whose turn it is, once setup is done. */
async function activeSeat(g: Game): Promise<number> {
  const turn = (await api(g)).pending.find((d) => d.kind === 'turn');
  expect(turn).toBeDefined();
  return turn!.seat;
}

/** A travel body that picks the first ENABLED destination other than `except`. */
function travelTo(form: ParsedForm, nth = 0): RawBody {
  const body = baselineSubmission(form, true);
  const radios = form.controls.filter((c) => c.attrs.name === 'siteIndex' && c.attrs.type === 'radio' && c.attrs.disabled === undefined);
  body.siteIndex = radios[nth].attrs.value;
  return body;
}

describe('POST /games/:id/act — a full turn with no script', () => {
  it('sets up, travels and rests entirely through server-rendered forms', async () => {
    const g = await newGame();
    await completeSetup(g);
    const seat = await activeSeat(g);
    const before = (await api(g)).seq;

    const { forms } = await boardForms(g, seat);
    const travel = formOf(forms, 'travel')!;
    const res = await post(travel.attrs.action, travelTo(travel), cookieFor(g.gameId, seat));
    expect(res.status).toBe(303);
    expect((await api(g)).seq).toBe(before + 1);

    await submit(g, seat, 'turn.rest');
    expect((await api(g)).seq).toBe(before + 2);
    // The turn passed: the decision now waits on someone else.
    expect(await activeSeat(g)).not.toBe(seat);
  });

  it('refuses a POST without a session for this game', async () => {
    const g = await newGame();
    const other = await newGame();
    const body = { _type: 'turn.rest', _prevSeq: '0', _kinds: '{}', _back: '/' };
    expect((await post(`/games/${g.gameId}/act`, body)).status).toBe(401);
    expect((await post(`/games/${g.gameId}/act`, body, cookieFor(other.gameId, 0))).status).toBe(401);
  });

  it('never redirects off-site, whatever _back says', async () => {
    const g = await newGame();
    const setup = (await api(g)).pending.find((d) => d.kind === 'setup')!;
    const { forms } = await boardForms(g, setup.seat);
    const body = baselineSubmission(formOf(forms, 'setup.choose')!, true);
    body._back = '//evil.example/';
    const res = await post(`/games/${g.gameId}/act`, body, cookieFor(g.gameId, setup.seat));
    expect(res.status).toBe(303);
    expect(res.location).toBe('/');
  });
});

describe('the 409 path: re-render with the fresh state, never an error page', () => {
  it('a choice that is still legal comes back filled in, with a banner and the new seq', async () => {
    const g = await newGame();
    await completeSetup(g);
    const seat = await activeSeat(g);
    const cookie = cookieFor(g.gameId, seat);

    // Tab A composes a travel; tab B (the same player) answers something else first.
    const tabA = formOf((await boardForms(g, seat)).forms, 'travel')!;
    const staleBody = travelTo(tabA);
    await submit(g, seat, 'standing.set');
    const fresh = (await api(g)).seq;

    const res = await post(tabA.attrs.action, staleBody, cookie);
    expect(res.status).toBe(200);
    expect(res.html).toContain('class="banner stale"');
    expect(res.html).toContain('Someone else acted first');
    expect(res.html).toContain('is still legal and is filled in below');
    // The fresh seq is in the page and in every form.
    expect(res.html).toContain(`data-seq="${fresh}"`);
    const forms = parseForms(res.html);
    expect(forms.every((f) => metaValue(f, '_prevSeq') === String(fresh))).toBe(true);
    // The travel form is open and its destination still checked.
    const again = formOf(forms, 'travel')!;
    const checked = again.controls.find((c) => c.attrs.name === 'siteIndex' && c.attrs.checked !== undefined);
    expect(checked?.attrs.value).toBe(staleBody.siteIndex);
    expect(res.html).toMatch(new RegExp(`<details class="compose" open id="compose-${again.attrs['data-entry']}"`));

    // Resubmitting the repopulated form now succeeds.
    const ok = await post(again.attrs.action, baselineSubmission(again), cookie);
    expect(ok.status).toBe(303);
  });

  it('a choice that stopped being legal is named', async () => {
    const g = await newGame();
    await completeSetup(g);
    const seat = await activeSeat(g);
    const cookie = cookieFor(g.gameId, seat);

    const tabA = formOf((await boardForms(g, seat)).forms, 'travel')!;
    const body = travelTo(tabA);
    // Tab B travels to the same place first — it is no longer a destination.
    const tabB = await post(tabA.attrs.action, body, cookie);
    expect(tabB.status).toBe(303);

    const res = await post(tabA.attrs.action, body, cookie);
    expect(res.status).toBe(200);
    expect(res.html).toContain('class="banner stale"');
    expect(res.html).toMatch(/Your Travel no longer fits:<\/p>\s*<ul><li>(your Destination choice is no longer offered|“[^”]+” is no longer allowed for Destination: [^<]+)<\/li>/);
  });

  it('the JSON API keeps its own 409 contract, unchanged', async () => {
    const g = await newGame();
    const res = await fetch(`${base}/api/games/${g.gameId}/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-player-token': g.tokens[0] },
      body: JSON.stringify({ prevSeq: 99, type: 'turn.rest', payload: {} }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: expect.stringMatching(/stale prevSeq/), expected: (await api(g)).seq });
  });
});

describe('the illegal-action path', () => {
  it('is reachable: a hand-built race (a forged destination) re-renders in place with the engine message', async () => {
    const g = await newGame();
    await completeSetup(g);
    const seat = await activeSeat(g);
    const tab = formOf((await boardForms(g, seat)).forms, 'travel')!;
    const body = travelTo(tab);
    body.siteIndex = '99';
    const seq = (await api(g)).seq;

    const res = await post(tab.attrs.action, body, cookieFor(g.gameId, seat));
    expect(res.status).toBe(400);
    expect(res.html).toContain('class="banner illegal"');
    expect(res.html).toMatch(/The game refused that Travel: travel: [^<]+/);
    expect((await api(g)).seq).toBe(seq); // nothing was written
    expect(res.html).toContain('<h1>The table</h1>'); // the board, not an error page
  });

  it('an unreadable form re-renders with a readable message', async () => {
    const g = await newGame();
    const setup = (await api(g)).pending.find((d) => d.kind === 'setup')!;
    const res = await post(
      `/games/${g.gameId}/act`,
      { _type: 'power.use', _prevSeq: '0', _kinds: JSON.stringify({ effects: 'free' }), effects: '[{', _back: '/' },
      cookieFor(g.gameId, setup.seat),
    );
    expect(res.status).toBe(400);
    expect(res.html).toContain('class="banner invalid"');
    expect(res.html).toContain('The effects field is not valid JSON.');
  });
});

describe('"Check this": the dry run round trip', () => {
  it('shows what would change, writes nothing, and keeps the form filled in', async () => {
    const g = await newGame();
    await completeSetup(g);
    const seat = await activeSeat(g);
    const tab = formOf((await boardForms(g, seat)).forms, 'travel')!;
    const body: RawBody = { ...travelTo(tab), _dryRun: '1' };
    const seq = (await api(g)).seq;

    const res = await post(tab.attrs.action, body, cookieFor(g.gameId, seat));
    expect(res.status).toBe(200);
    expect(res.html).toContain('Travel would be accepted.');
    expect(res.html).toMatch(/<li>Pawn at: [^<]+ → [^<]+<\/li>/);
    expect((await api(g)).seq).toBe(seq);
    const again = formOf(parseForms(res.html), 'travel')!;
    expect(again.controls.find((c) => c.attrs.name === 'siteIndex' && c.attrs.checked !== undefined)?.attrs.value).toBe(body.siteIndex);
  });

  it("shows the engine's refusal for a declaration that would fail", async () => {
    const g = await newGame();
    await completeSetup(g);
    const seat = await activeSeat(g);
    const tab = formOf((await boardForms(g, seat)).forms, 'travel')!;
    const body = { ...travelTo(tab), siteIndex: '99', _dryRun: '1' };
    const res = await post(tab.attrs.action, body, cookieFor(g.gameId, seat));
    expect(res.status).toBe(200);
    expect(res.html).toMatch(/Travel would be refused:<\/strong> travel: /);
  });
});

describe('a campaign won and seized entirely through forms (Law §5.5)', () => {
  it('declares, responds, resolves as the victor with a banish and a burn, and the seizure lands', async () => {
    const g = await newGame();
    await completeSetup(g);
    const attacker = await activeSeat(g);
    const cookie = cookieFor(g.gameId, attacker);

    // Declare against a seat's pawn & favor, with every attack die available.
    const { forms } = await boardForms(g, attacker);
    const declare = forms.find((f) => metaValue(f, '_type') === 'campaign.declare')!;
    expect(declare).toBeDefined();
    const body = baselineSubmission(declare, true);
    const dice = declare.controls.find((c) => c.attrs.name === 'attackDice')!;
    body.attackDice = dice.attrs.max;
    const defender = JSON.parse(body.defender as string) as number;
    expect((await post(declare.attrs.action, body, cookie)).status).toBe(303);

    // Answer every campaign decision from its own form until the attacker
    // can resolve: allies decline, the defender responds (the dice roll).
    for (let i = 0; i < 10; i++) {
      const pending = (await api(g)).pending.find((d) => d.kind === 'campaign');
      expect(pending).toBeDefined();
      const theirs = (await boardForms(g, pending!.seat)).forms;
      if (formOf(theirs, 'campaign.resolve')) break;
      const form = theirs.find((f) => (metaValue(f, '_type') ?? '').startsWith('campaign.'))!;
      expect((await post(form.attrs.action, baselineSubmission(form, true), cookieFor(g.gameId, pending!.seat))).status).toBe(303);
    }

    // The victory entry carries the seizure as fields; banish them somewhere new and burn half their favor.
    const resolveForms = (await boardForms(g, attacker)).forms.filter((f) => metaValue(f, '_type') === 'campaign.resolve');
    const victory = resolveForms.find((f) => f.controls.some((c) => c.attrs.name === 'banishTo'))!;
    expect(victory, 'a victory form with the seizure fields').toBeDefined();
    const win = baselineSubmission(victory, true);
    const banish = victory.controls.find((c) => c.attrs.name === 'banishTo' && c.attrs.value !== 'null')!;
    win.banishTo = banish.attrs.value;
    win.burnFavor = 'true';
    const before = (await (await fetch(`${base}/api/games/${g.gameId}`, { headers: { 'x-player-token': g.tokens[attacker] } })).json()) as {
      view: { players: { favor: number; pawnSite: string }[]; sites: { id: string }[] };
    };
    expect((await post(victory.attrs.action, win, cookie)).status).toBe(303);

    // If the casualties need choosing, the chooser allocates from their form.
    const casualty = (await api(g)).pending.find((d) => d.kind === 'campaign');
    if (casualty) {
      const form = formOf((await boardForms(g, casualty.seat)).forms, 'campaign.casualties')!;
      expect((await post(form.attrs.action, baselineSubmission(form, true), cookieFor(g.gameId, casualty.seat))).status).toBe(303);
    }

    const after = (await (await fetch(`${base}/api/games/${g.gameId}`, { headers: { 'x-player-token': g.tokens[attacker] } })).json()) as typeof before & {
      view: { campaign: unknown };
    };
    expect(after.view.campaign).toBeNull();
    expect(after.view.players[defender].pawnSite).toBe(after.view.sites[Number(banish.attrs.value)].id);
    const f0 = before.view.players[defender].favor;
    expect(after.view.players[defender].favor).toBe(f0 - Math.floor(f0 / 2));
  });
});
