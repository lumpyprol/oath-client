import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkInvariants, type OathState } from '../../../src/oath/game/state.js';
import { oath } from '../../../src/oath/game/index.js';
import { IllegalAction, type GameAction } from '../../../src/engine/types.js';
import { baseState } from './helpers.js';

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'oath-search-')), 'test.db');
let store: typeof import('../../../src/actionlog.js');

beforeAll(async () => {
  store = await import('../../../src/actionlog.js');
});

function act(state: OathState, type: string, actor: number | null, payload: unknown): OathState {
  const action: GameAction = {
    gameId: 'test',
    seq: state.actionCount + 1,
    type,
    actor,
    payload,
    createdAt: '2026-09-10T00:00:00.000Z',
  };
  return oath.reduce(state, action);
}
const search = (s: OathState, actor: number | null, p: unknown) => act(s, 'search', actor, p);

// baseState: seat 1 active, pawn at sites[5] (hinterland), supply 4,
// visionsDrawn 1 (so world-deck cost is 3). worldDeck is denizens then the
// 4 non-revealed visions.

describe('search — from the world deck (Law §5.1)', () => {
  it('draws 3 from the top in stored order into the hand, spends the tracked Supply', () => {
    const s = baseState();
    s.visionsDrawn = 0; // world-deck cost 2
    const top3 = s.worldDeck.slice(0, 3);

    const out = search(s, 1, { from: 'deck' });

    expect(out.players[1].hand).toEqual(top3);
    expect(out.worldDeck.slice(0, 3)).not.toEqual(top3); // consumed from the top
    expect(out.players[1].supply).toBe(s.players[1].supply - 2);
    expect(out.players[1].handDrawnAt).toBe(out.actionCount);
    checkInvariants(out);
  });

  it('costs 3 Supply at 1-2 Visions drawn and 4 at 3+ (Visions Drawn track)', () => {
    const three = search(baseState(), 1, { from: 'deck' }); // baseState visionsDrawn = 1
    expect((three.players[1] as any).supply).toBe(4 - 3);

    const s = baseState();
    s.visionsDrawn = 3;
    s.players[1].supply = 5;
    expect(search(s, 1, { from: 'deck' }).players[1].supply).toBe(5 - 4);
  });

  it('stops drawing when a Vision comes up and advances the Visions Drawn marker (Law §5.1.2 / §2.7.1)', () => {
    const s = baseState();
    s.visionsDrawn = 0;
    // move a vision to index 1: draw denizen(0), vision(1), stop
    const vision = s.worldDeck.pop()!;
    expect(vision.startsWith('vision:')).toBe(true);
    s.worldDeck.splice(1, 0, vision);

    const out = search(s, 1, { from: 'deck' });

    expect(out.players[1].hand).toHaveLength(2);
    expect(out.players[1].hand[1]).toBe(vision);
    expect(out.visionsDrawn).toBe(1);
    checkInvariants(out);
  });

  it('is illegal when the world deck is empty', () => {
    const s = baseState();
    s.worldDeck = [];
    expect(() => search(s, 1, { from: 'deck' })).toThrow(IllegalAction);
  });

  it('is illegal with insufficient Supply', () => {
    const s = baseState();
    s.players[1].supply = 2; // needs 3 at visionsDrawn 1
    expect(() => search(s, 1, { from: 'deck' })).toThrow(IllegalAction);
  });
});

describe('search — from your region discard pile (Law §5.1.2)', () => {
  it("draws from the top of your pawn's region pile for 2 Supply", () => {
    const s = baseState();
    // seat 1 pawn is in the hinterland; baseState leaves that pile empty
    const planted = s.worldDeck.splice(0, 4);
    s.discards.hinterland = planted;

    const out = search(s, 1, { from: 'discard' });

    expect(out.players[1].hand).toEqual(planted.slice(0, 3));
    expect(out.discards.hinterland).toEqual(planted.slice(3));
    expect(out.players[1].supply).toBe(s.players[1].supply - 2);
    checkInvariants(out);
  });

  it('draws as many as the pile holds when it has fewer than 3 (Law §9.3)', () => {
    const s = baseState();
    const planted = s.worldDeck.splice(0, 2);
    s.discards.hinterland = planted;
    const out = search(s, 1, { from: 'discard' });
    expect(out.players[1].hand).toEqual(planted);
    expect(out.discards.hinterland).toEqual([]);
    checkInvariants(out);
  });

  it('does not advance the Visions Drawn marker even if a Vision is drawn (Law §5.1.2)', () => {
    const s = baseState();
    const vision = s.worldDeck.pop()!;
    s.discards.hinterland = [vision, s.worldDeck.shift()!];
    const before = s.visionsDrawn;
    const out = search(s, 1, { from: 'discard' });
    expect(out.visionsDrawn).toBe(before);
  });

  it('is illegal when that pile is empty', () => {
    const s = baseState();
    s.discards.hinterland = [];
    expect(() => search(s, 1, { from: 'discard' })).toThrow(IllegalAction);
  });
});

describe('search — legality and turn flow', () => {
  it('is illegal for a non-active seat', () => {
    const s = baseState();
    expect(() => search(s, 2, { from: 'deck' })).toThrow(IllegalAction);
  });

  it('is illegal once the game is complete', () => {
    const s = baseState();
    s.complete = true;
    expect(() => search(s, 1, { from: 'deck' })).toThrow(IllegalAction);
  });

  it('leaves a pending "play" decision and blocks every other action until it resolves', () => {
    const s = baseState();
    s.visionsDrawn = 0;
    const drawn = search(s, 1, { from: 'deck' });

    const pending = oath.pending(drawn);
    expect(pending).toHaveLength(1);
    expect(pending[0].kind).toBe('play');
    expect(pending[0].seat).toBe(1);
    expect(pending[0].resolves).toEqual(['card.play']);
    expect(pending[0].id).toBe(`play:1:${drawn.players[1].handDrawnAt}`);

    // stable across polls
    expect(oath.pending(drawn)[0].id).toBe(pending[0].id);

    // turn.rest (and everything but card.play) is now illegal
    expect(() => act(drawn, 'turn.rest', 1, {})).toThrow(IllegalAction);
    expect(() => act(drawn, 'muster', 1, { cardId: 'x' })).toThrow(IllegalAction);

    // resolving with card.play clears it
    const played = act(drawn, 'card.play', 1, { handIndex: 0, as: 'discard' });
    expect(played.players[1].hand).toHaveLength(0);
    expect(oath.pending(played)[0].kind).toBe('turn');
  });

  it("another seat's projection shows the searching seat's hand as a count only", () => {
    const s = baseState();
    s.visionsDrawn = 0;
    const drawn = search(s, 1, { from: 'deck' });
    const view0 = oath.project(drawn, 0) as any;
    expect(view0.players[1].hand).toEqual({ count: 3 });
    for (const id of drawn.players[1].hand) {
      expect(JSON.stringify(view0)).not.toContain(id);
    }
  });
});

describe('search — the action log leaks no drawn identity (HLD §4, through the store)', () => {
  it('a search + facedown play never writes a drawn id into the log', () => {
    const { gameId } = store.createGame(oath, ['Chancellor', 'Red', 'Blue', 'Yellow']);
    let seq = store.headSeq(gameId);

    const r1 = store.appendAction(oath, gameId, seq, {
      type: 'search',
      actor: 0,
      payload: { from: 'deck' },
    });
    seq = r1.seq;
    const drawnIds = (r1.state as any).players[0].hand as string[];
    // NOT necessarily 3: Law §5.1.2 says a world-deck draw stops the moment
    // a Vision turns up, so a real shuffle hands back 1-3 cards, the short
    // ones ending on the Vision. (Asserting 3 unconditionally here failed
    // about 1 run in 15 — the engine was right and the test was wrong.)
    expect(drawnIds.length).toBeGreaterThan(0);
    expect(drawnIds.length).toBeLessThanOrEqual(3);
    if (drawnIds.length < 3) {
      expect(drawnIds[drawnIds.length - 1]).toMatch(/^vision:/);
    }

    // keep one as a FACEDOWN adviser — its identity must stay hidden
    const r2 = store.appendAction(oath, gameId, seq, {
      type: 'card.play',
      actor: 0,
      payload: { handIndex: 0, as: 'adviser', facedown: true },
    });

    // the kept card is now a facedown adviser; the other two are in a
    // facedown discard pile. NONE of the three ids may appear in the raw log.
    const rawLog = JSON.stringify(store.history(gameId));
    for (const id of drawnIds) {
      expect(rawLog).not.toContain(id);
    }
    // and the played card is redacted from another seat's view
    const view1 = oath.project(r2.state, 1) as any;
    expect(JSON.stringify(view1)).not.toContain(drawnIds[0]);
  });
});
