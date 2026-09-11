import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';
import { checkInvariants, LEFTMOST_SUPPLY, type OathState } from '../../../src/oath/game/state.js';
import { cards } from '../../../src/oath/cards/index.js';
import { oath } from '../../../src/oath/game/index.js';
import { baseState } from './helpers.js';

// A separate DB per test file (store.test.ts's own convention), needed only
// by the end-to-end declared-Supply test at the bottom.
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'oath-effects-')), 'test.db');
let store: typeof import('../../../src/actionlog.js');
let db: typeof import('../../../src/db.js')['db'];

beforeAll(async () => {
  store = await import('../../../src/actionlog.js');
  ({ db } = await import('../../../src/db.js'));
});
import {
  applyEffects,
  EffectSchema,
  type Effect,
} from '../../../src/oath/game/effects.js';
import { IllegalAction } from '../../../src/engine/types.js';

describe('favor mover', () => {
  it('lands a legal move: seat favor to a suit favor bank (both zones change)', () => {
    const s = baseState();
    const before = { seat: s.players[0].favor, bank: s.favorBanks.hearth };
    const out = applyEffects(s, 0, [
      { kind: 'favor', from: { kind: 'seatFavor', seat: 0 }, to: { kind: 'favorBank', suit: 'hearth' }, amount: 1 },
    ]);
    expect(out.players[0].favor).toBe(before.seat - 1);
    expect(out.favorBanks.hearth).toBe(before.bank + 1);
    checkInvariants(out);
  });

  it('places favor onto a denizen at a site (Law §5.2.1 Muster cost)', () => {
    const s = baseState();
    const siteId = s.sites[0].id;
    const cardId = s.sites[0].cards.find((c) => c !== null)!.id;
    const out = applyEffects(s, 0, [
      {
        kind: 'favor',
        from: { kind: 'seatFavor', seat: 0 },
        to: { kind: 'siteCardFavor', siteId, cardId },
        amount: 1,
      },
    ]);
    const card = out.sites[0].cards.find((c) => c?.id === cardId)!;
    expect(card!.favor).toBe(1);
    expect(out.players[0].favor).toBe(s.players[0].favor - 1);
    checkInvariants(out);
  });

  it('rejects a card zone as a favor endpoint (illegal endpoint kind)', () => {
    const s = baseState();
    expect(() =>
      applyEffects(s, 0, [
        // @ts-expect-error seatHand is a CardZone, not a FavorZone
        { kind: 'favor', from: { kind: 'seatFavor', seat: 0 }, to: { kind: 'seatHand', seat: 0 }, amount: 1 },
      ]),
    ).toThrow(IllegalAction);
  });

  it('throws naming the index when the source zone lacks the amount', () => {
    const s = baseState({});
    s.players[0].favor = 0;
    expect(() =>
      applyEffects(s, 0, [
        { kind: 'favor', from: { kind: 'seatFavor', seat: 0 }, to: { kind: 'favorBank', suit: 'hearth' }, amount: 1 },
      ]),
    ).toThrow(/effect 0/);
  });
});

describe('secret mover', () => {
  it('lands a legal move: seat secrets to the shared bank (Recover burn cost)', () => {
    const s = baseState();
    const before = { seat: s.players[2].secrets.ready, shared: s.sharedBank.secrets };
    const out = applyEffects(s, 2, [
      { kind: 'secret', from: { kind: 'seatSecrets', seat: 2 }, to: { kind: 'sharedSecrets' }, amount: 1 },
    ]);
    expect(out.players[2].secrets.ready).toBe(before.seat - 1);
    expect(out.sharedBank.secrets).toBe(before.shared + 1);
    checkInvariants(out);
  });

  it('throws naming the index and reason when the seat lacks secrets', () => {
    const s = baseState();
    s.players[1].secrets = { ready: 0, flipped: 0 };
    expect(() =>
      applyEffects(s, 1, [
        { kind: 'secret', from: { kind: 'seatSecrets', seat: 1 }, to: { kind: 'sharedSecrets' }, amount: 1 },
      ]),
    ).toThrow(/effect 0/);
  });
});

describe('warbands mover', () => {
  it('lands a legal move: personal bank to board (Law §5.2.2 Muster gain)', () => {
    const s = baseState();
    const before = { bank: s.players[0].warbands.bank, board: s.players[0].warbands.board };
    const out = applyEffects(s, 0, [
      { kind: 'warbands', from: { kind: 'seatWarbandBank', seat: 0 }, to: { kind: 'seatWarbandBoard', seat: 0 }, amount: 2 },
    ]);
    expect(out.players[0].warbands.bank).toBe(before.bank - 2);
    expect(out.players[0].warbands.board).toBe(before.board + 2);
    checkInvariants(out);
  });

  it('lands board-to-site (a ruled-site minor action)', () => {
    const s = baseState();
    const siteId = s.sites[0].id; // seat 0 already has warbands there
    const before = { board: s.players[0].warbands.board, site: s.sites[0].warbands[0] };
    const out = applyEffects(s, 0, [
      { kind: 'warbands', from: { kind: 'seatWarbandBoard', seat: 0 }, to: { kind: 'siteWarbands', siteId, seat: 0 }, amount: 1 },
    ]);
    expect(out.players[0].warbands.board).toBe(before.board - 1);
    expect(out.sites[0].warbands[0]).toBe(before.site + 1);
    checkInvariants(out);
  });

  it('throws naming the index when the bank is empty', () => {
    const s = baseState();
    s.players[0].warbands.bank = 0;
    expect(() =>
      applyEffects(s, 0, [
        { kind: 'warbands', from: { kind: 'seatWarbandBank', seat: 0 }, to: { kind: 'seatWarbandBoard', seat: 0 }, amount: 1 },
      ]),
    ).toThrow(/effect 0/);
  });
});

describe('card mover', () => {
  it('lands a legal move: hand to seat advisers, faceup by default', () => {
    const s = baseState();
    const id = s.worldDeck.shift()!; // remove from the deck: it's moving to hand
    s.players[1].hand = [id];
    const out = applyEffects(s, 1, [
      { kind: 'card', id, from: { kind: 'seatHand', seat: 1 }, to: { kind: 'seatAdvisers', seat: 1 } },
    ]);
    expect(out.players[1].hand).not.toContain(id);
    const adviser = out.players[1].advisers.find((a) => a.id === id);
    expect(adviser).toBeDefined();
    expect(adviser!.facedown).toBe(false);
    checkInvariants(out);
  });

  it('composes with flip to play a facedown adviser', () => {
    const s = baseState();
    const id = s.worldDeck.shift()!;
    s.players[1].hand = [id];
    const out = applyEffects(s, 1, [
      { kind: 'card', id, from: { kind: 'seatHand', seat: 1 }, to: { kind: 'seatAdvisers', seat: 1 } },
      { kind: 'flip', target: { kind: 'adviser', seat: 1, cardId: id } },
    ]);
    const adviser = out.players[1].advisers.find((a) => a.id === id);
    expect(adviser!.facedown).toBe(true);
    checkInvariants(out);
  });

  it('lands a legal move: relic from a site to the seat holding it (Recover)', () => {
    const s = baseState();
    const siteId = s.sites[1].id;
    const relicId = s.sites[1].relics[0];
    const out = applyEffects(s, 0, [
      { kind: 'card', id: relicId, from: { kind: 'siteRelics', siteId }, to: { kind: 'seatRelics', seat: 0 } },
    ]);
    expect(out.sites[1].relics).not.toContain(relicId);
    expect(out.players[0].relics).toContain(relicId);
    checkInvariants(out);
  });

  it('rejects a favor bank as a card endpoint (illegal endpoint kind)', () => {
    const s = baseState();
    const id = s.worldDeck.shift()!;
    s.players[1].hand = [id];
    expect(() =>
      applyEffects(s, 1, [
        // @ts-expect-error favorBank is not a CardZone
        { kind: 'card', id, from: { kind: 'seatHand', seat: 1 }, to: { kind: 'favorBank', suit: 'hearth' } },
      ]),
    ).toThrow(IllegalAction);
  });

  it('throws naming the index when the card is not in the from-zone', () => {
    const s = baseState();
    expect(() =>
      applyEffects(s, 1, [
        { kind: 'card', id: 'denizen:not-there', from: { kind: 'seatHand', seat: 1 }, to: { kind: 'seatAdvisers', seat: 1 } },
      ]),
    ).toThrow(/effect 0/);
  });

  it('throws on an over-capacity destination (site slots full)', () => {
    const s = baseState();
    const site = s.sites[2];
    const emptySlots = site.cards.reduce((n, c) => n + (c === null ? 1 : 0), 0);
    const filler = s.worldDeck.slice(0, emptySlots);
    s.worldDeck = s.worldDeck.slice(emptySlots);
    let next = 0;
    site.cards = site.cards.map((c) => c ?? { id: filler[next++], favor: 0, secrets: 0 });
    checkInvariants(s); // the site is now full but otherwise valid
    const overflow = s.worldDeck.shift()!;
    s.players[1].hand = [overflow];
    expect(() =>
      applyEffects(s, 1, [
        { kind: 'card', id: overflow, from: { kind: 'seatHand', seat: 1 }, to: { kind: 'siteSlot', siteId: site.id } },
      ]),
    ).toThrow(/effect 0/);
  });
});

describe('draw', () => {
  it('moves the top of the world deck to hand without the effect naming the id', () => {
    const s = baseState();
    const topId = s.worldDeck[0];
    const out = applyEffects(s, 1, [
      { kind: 'draw', from: { kind: 'worldDeck' }, to: { kind: 'seatHand', seat: 1 } },
    ]);
    expect(out.worldDeck[0]).not.toBe(topId);
    expect(out.players[1].hand).toContain(topId);
    checkInvariants(out);
  });

  it('throws naming the index when the source is empty', () => {
    const s = baseState();
    s.worldDeck = [];
    expect(() =>
      applyEffects(s, 1, [{ kind: 'draw', from: { kind: 'worldDeck' }, to: { kind: 'seatHand', seat: 1 } }]),
    ).toThrow(/effect 0/);
  });
});

describe('flip', () => {
  it('toggles an edifice to its ruin face and back', () => {
    // no edifice in baseState's sites, so plant one directly
    const s = baseState();
    const siteId = s.sites[3].id;
    const edificeId = cards.edifices[0].id;
    s.sites[3].cards[0] = { id: edificeId, favor: 0, secrets: 0, ruined: false };
    const out = applyEffects(s, 0, [
      { kind: 'flip', target: { kind: 'edifice', siteId, cardId: edificeId } },
    ]);
    const card = out.sites[3].cards.find((c) => c?.id === edificeId);
    expect(card!.ruined).toBe(true);
    checkInvariants(out);
  });

  it('toggles a site facedown/faceup (Law §5.6.2 reveal)', () => {
    const s = baseState();
    s.sites[3].facedown = true;
    const out = applyEffects(s, 0, [
      { kind: 'flip', target: { kind: 'site', siteId: s.sites[3].id } },
    ]);
    expect(out.sites[3].facedown).toBe(false);
    checkInvariants(out);
  });
});

describe('ordering', () => {
  it('a sequence where step 2 is only feasible because of step 1 succeeds', () => {
    const s = baseState();
    s.favorBanks.hearth += s.players[0].favor; // keep the total conserved
    s.players[0].favor = 0;
    const effects: Effect[] = [
      { kind: 'favor', from: { kind: 'favorBank', suit: 'hearth' }, to: { kind: 'seatFavor', seat: 0 }, amount: 1 },
      { kind: 'favor', from: { kind: 'seatFavor', seat: 0 }, to: { kind: 'favorBank', suit: 'nomad' }, amount: 1 },
    ];
    const out = applyEffects(s, 0, effects);
    expect(out.players[0].favor).toBe(0);
    checkInvariants(out);
  });

  it('the reverse order throws', () => {
    const s = baseState();
    s.favorBanks.hearth += s.players[0].favor;
    s.players[0].favor = 0;
    const effects: Effect[] = [
      { kind: 'favor', from: { kind: 'seatFavor', seat: 0 }, to: { kind: 'favorBank', suit: 'nomad' }, amount: 1 },
      { kind: 'favor', from: { kind: 'favorBank', suit: 'hearth' }, to: { kind: 'seatFavor', seat: 0 }, amount: 1 },
    ];
    expect(() => applyEffects(s, 0, effects)).toThrow(/effect 0/);
  });
});

describe('purity', () => {
  it('does not mutate its input state', () => {
    const s = baseState();
    const snapshot = JSON.parse(JSON.stringify(s));
    applyEffects(s, 0, [
      { kind: 'favor', from: { kind: 'seatFavor', seat: 0 }, to: { kind: 'favorBank', suit: 'hearth' }, amount: 1 },
    ]);
    expect(s).toEqual(snapshot);
  });
});

describe('EffectSchema', () => {
  it('accepts a well-formed favor mover', () => {
    const effect = {
      kind: 'favor',
      from: { kind: 'seatFavor', seat: 0 },
      to: { kind: 'favorBank', suit: 'hearth' },
      amount: 1,
    };
    expect(EffectSchema.safeParse(effect).success).toBe(true);
  });

  it('rejects a malformed payload: unknown zone kind', () => {
    const effect = {
      kind: 'favor',
      from: { kind: 'seatFavor', seat: 0 },
      to: { kind: 'nonsense' },
      amount: 1,
    };
    expect(EffectSchema.safeParse(effect).success).toBe(false);
  });

  it('rejects a favor mover with a card-zone endpoint', () => {
    const effect = {
      kind: 'favor',
      from: { kind: 'seatFavor', seat: 0 },
      to: { kind: 'seatHand', seat: 0 },
      amount: 1,
    };
    expect(EffectSchema.safeParse(effect).success).toBe(false);
  });

  it('rejects a non-positive amount', () => {
    const effect = {
      kind: 'favor',
      from: { kind: 'seatFavor', seat: 0 },
      to: { kind: 'favorBank', suit: 'hearth' },
      amount: 0,
    };
    expect(EffectSchema.safeParse(effect).success).toBe(false);
  });
});

describe('supply (Law §4.2; unit 16d)', () => {
  it('spends within range', () => {
    const s = baseState(); // every seat starts this fixture on 4
    const out = applyEffects(s, 1, [{ kind: 'supply', seat: 1, delta: -3 }]);
    expect(out.players[1].supply).toBe(1);
    checkInvariants(out);
  });

  it('is infeasible past the depleted end, naming the effect index', () => {
    const s = baseState();
    expect(() => applyEffects(s, 1, [{ kind: 'supply', seat: 1, delta: -5 }])).toThrow(
      /effect 0 \(supply\).*has 4 Supply, cannot spend 5/,
    );
    // ...and nothing partial is left behind (applyEffects is atomic).
    expect(s.players[1].supply).toBe(4);
  });

  it('clamps a gain at the leftmost space rather than rejecting it (Law §4.3.4)', () => {
    const s = baseState();
    const out = applyEffects(s, 1, [{ kind: 'supply', seat: 1, delta: 99 }]);
    expect(out.players[1].supply).toBe(LEFTMOST_SUPPLY);
    checkInvariants(out);
  });

  it('is not conserved: moving Supply disturbs no conservation law', () => {
    const s = baseState();
    const before = s.players[1].supply;
    const out = applyEffects(s, 1, [{ kind: 'supply', seat: 1, delta: 2 }]);
    // Favor and warbands are conserved and untouched; Supply simply moved.
    expect(out.players[1].supply).toBe(before + 2);
    expect(out.sharedBank).toEqual(s.sharedBank);
    expect(out.favorBanks).toEqual(s.favorBanks);
    expect(out.players.map((p) => p.warbands)).toEqual(s.players.map((p) => p.warbands));
    checkInvariants(out);
  });

  it('rejects a zero delta and a non-existent seat', () => {
    const s = baseState();
    expect(EffectSchema.safeParse({ kind: 'supply', seat: 0, delta: 0 }).success).toBe(false);
    expect(EffectSchema.safeParse({ kind: 'supply', seat: 0, delta: -1 }).success).toBe(true);
    expect(() => applyEffects(s, 0, [{ kind: 'supply', seat: 9, delta: 1 }])).toThrow(/no seat 9/);
  });
});

describe('§7.1.2 — nothing may be placed on an occupied card (unit 16d)', () => {
  it('rejects favor onto a card that already holds a secret', () => {
    const s = baseState();
    const siteId = s.sites[0].id;
    const cardId = s.sites[0].cards.find((c) => c !== null)!.id;
    s.sites[0].cards.find((c) => c !== null)!.secrets = 1;
    expect(() =>
      applyEffects(s, 0, [
        { kind: 'favor', from: { kind: 'seatFavor', seat: 0 }, to: { kind: 'siteCardFavor', siteId, cardId }, amount: 1 },
      ]),
    ).toThrow(/already has favor or secrets on it.*§7\.1\.2/);
  });

  it('rejects a secret onto a card that already holds favor, and onto an adviser likewise', () => {
    const s = baseState();
    const siteId = s.sites[0].id;
    const card = s.sites[0].cards.find((c) => c !== null)!;
    card.favor = 1;
    s.sharedBank.favor -= 1; // source it (conservation)
    expect(() =>
      applyEffects(s, 0, [
        {
          kind: 'secret',
          from: { kind: 'seatSecrets', seat: 0 },
          to: { kind: 'siteCardSecrets', siteId, cardId: card.id },
          amount: 1,
        },
      ]),
    ).toThrow(/§7\.1\.2/);

    const a = baseState();
    a.players[0].advisers[0].favor = 1;
    a.sharedBank.favor -= 1;
    expect(() =>
      applyEffects(a, 0, [
        {
          kind: 'secret',
          from: { kind: 'seatSecrets', seat: 0 },
          to: { kind: 'adviserSecrets', seat: 0, cardId: a.players[0].advisers[0].id },
          amount: 1,
        },
      ]),
    ).toThrow(/§7\.1\.2/);
  });

  it('allows a single mover placing TWO favor on an empty card — Trade\'s own shape (§5.3.2.II)', () => {
    const s = baseState();
    const siteId = s.sites[0].id;
    const cardId = s.sites[0].cards.find((c) => c !== null)!.id;
    expect(s.players[0].favor).toBe(2); // the fixture already gives seat 0 two favor
    const out = applyEffects(s, 0, [
      { kind: 'favor', from: { kind: 'seatFavor', seat: 0 }, to: { kind: 'siteCardFavor', siteId, cardId }, amount: 2 },
    ]);
    expect(out.sites[0].cards.find((c) => c !== null)!.favor).toBe(2);
    checkInvariants(out);
  });

  it('but rejects the same two favor split across two movers — the second sees the first', () => {
    const s = baseState();
    const siteId = s.sites[0].id;
    const cardId = s.sites[0].cards.find((c) => c !== null)!.id;
    const one = {
      kind: 'favor' as const,
      from: { kind: 'seatFavor' as const, seat: 0 },
      to: { kind: 'siteCardFavor' as const, siteId, cardId },
      amount: 1,
    };
    expect(() => applyEffects(s, 0, [one, one])).toThrow(/effect 1 \(favor\).*§7\.1\.2/);
  });

  it('does not touch REMOVALS from a card, nor any non-card destination', () => {
    const s = baseState();
    const card = s.sites[0].cards.find((c) => c !== null)!;
    card.favor = 1;
    s.sharedBank.favor -= 1;
    // Taking the favor back off an occupied card is exactly Rest's §4.3.1
    // sweep, and must stay legal.
    const out = applyEffects(s, 0, [
      {
        kind: 'favor',
        from: { kind: 'siteCardFavor', siteId: s.sites[0].id, cardId: card.id },
        to: { kind: 'favorBank', suit: 'hearth' },
        amount: 1,
      },
    ]);
    expect(out.sites[0].cards.find((c) => c !== null)!.favor).toBe(0);
    checkInvariants(out);
  });
});

describe('a declared Supply power, end to end through the store (unit 16d)', () => {
  it('lands through power.use and moves the marker — the deferral workaround, proven', () => {
    // The deferred Travel-cost powers (§11.3/§11.6/§11.7/§7.6.2) are
    // declared as an ordinary action plus a power.use refunding or charging
    // the difference. This is that shape, end to end.
    const opening = baseState();
    opening.turn.activeSeat = 1;
    const cardId = opening.sites[5].cards[0]!.id; // seat 1 rules sites[5], so they have access (§7.1.1)
    const supplyBefore = opening.players[1].supply;

    const { gameId } = store.createGame(oath, ['Chancellor', 'Red', 'Blue', 'Yellow']);
    db.prepare('INSERT OR REPLACE INTO snapshots (game_id, seq, state) VALUES (?, ?, ?)').run(
      gameId,
      0,
      JSON.stringify(opening),
    );

    const r = store.appendAction(oath, gameId, store.headSeq(gameId), {
      type: 'power.use',
      actor: 1,
      payload: {
        cardId,
        effects: [{ kind: 'supply', seat: 1, delta: 1 }],
        note: 'Coast travel refund (Law §11.3)',
      },
    });
    const out = r.state as OathState;
    expect(out.players[1].supply).toBe(supplyBefore + 1);
    checkInvariants(out);

    // ...and it survives a refold from the log alone.
    const first = store.loadState(oath, gameId).state;
    db.prepare('DELETE FROM snapshots WHERE game_id = ? AND seq > 0').run(gameId);
    expect(store.loadState(oath, gameId).state).toEqual(first);
  });
});
