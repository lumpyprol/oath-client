/**
 * Unit 5 of P4: the major/minor-action describers, and the branches neither
 * frozen fixture reaches (give/take between Citizens, a Reliquary power, the
 * two recover-label forms, a restriction-unknown note). The harness
 * (`./affordances.ts`) is run directly on hand-built states to prove reduce
 * accepts what these offer.
 */

import { describe, it, expect } from 'vitest';
import { cards } from '../../../src/oath/cards/index.js';
import { oath } from '../../../src/oath/game/index.js';
import { checkInvariants, type OathState } from '../../../src/oath/game/state.js';
import type { Affordance } from '../../../src/oath/game/affordances.js';
import { restrictionKnown } from '../../../src/oath/game/restrictions.js';
import { baseState } from './helpers.js';
import { auditAffordances } from './affordances.js';

const aff = (s: OathState, seat: number) => oath.affordances!(s, seat) as Affordance[];
const MOUNTAIN = cards.sites.find((c) => c.name === 'Mountain')!.id; // burnFavor (2 favor)

describe('recover — the two relic-slot label forms (unit 3 payoff)', () => {
  function atMountainWithRelic() {
    const s = baseState(); // seat 1 active
    const i = s.sites.findIndex((x) => x.id === MOUNTAIN);
    expect(i).toBeGreaterThanOrEqual(0);
    s.players[1].pawnSite = MOUNTAIN;
    const relicId = s.relicDeck.shift()!;
    s.sites[i].relics = [relicId];
    s.players[1].favor = 5; // afford burnFavor (2)
    s.sharedBank.favor -= 4;
    checkInvariants(s);
    return { s, relicId };
  }

  it('an UNPEEKED slot labels by position, never identity', () => {
    const { s, relicId } = atMountainWithRelic();
    const recover = aff(s, 1).find((e) => e.type === 'recover' && e.fields.some((f) => f.name === 'relicIndex'))!;
    const slot = recover.fields.find((f) => f.name === 'relicIndex')!;
    if (slot.kind !== 'choose-one') throw new Error('unreachable');
    expect(slot.options[0].label).toBe('Slot 0');
    expect(slot.options[0].label).not.toContain(relicId);
  });

  it('a PEEKED slot labels by the relic\'s name', () => {
    const { s, relicId } = atMountainWithRelic();
    s.players[1].peeked = [relicId];
    const recover = aff(s, 1).find((e) => e.type === 'recover' && e.fields.some((f) => f.name === 'relicIndex'))!;
    const slot = recover.fields.find((f) => f.name === 'relicIndex')!;
    if (slot.kind !== 'choose-one') throw new Error('unreachable');
    expect(slot.options[0].label).toBe(cards.relics.find((r) => r.id === relicId)!.name);
    expect(auditAffordances(s, 1)).toEqual([]); // still all legal
  });
});

describe('the §7.2-restriction-unknown note (D46) is gone: every card has been read', () => {
  it('card.play never says a card was never transcribed', () => {
    const s = baseState(); // seat 1 active
    const card = s.worldDeck.find((id) => id.startsWith('denizen:'))!;
    expect(restrictionKnown(card)).toBe(true);
    s.worldDeck = s.worldDeck.filter((id) => id !== card);
    s.players[1].hand = [card];
    s.players[1].handDrawnAt = s.actionCount;
    checkInvariants(s);
    for (const e of aff(s, 1).filter((x) => x.type === 'card.play')) expect(e.note ?? '').not.toMatch(/never transcribed/);
    expect(auditAffordances(s, 1)).toEqual([]);
  });
});

describe('card.play mid-Search', () => {
  it('offers a destination per drawn card and the harness accepts every offer', () => {
    const s = baseState(); // seat 1 active
    // A denizen and a Vision, so both the site/adviser and vision/facedown
    // branches are exercised. Pull from the deck to keep ids unique.
    const denizen = s.worldDeck.find((id) => id.startsWith('denizen:'))!;
    const vision = s.worldDeck.find((id) => id.startsWith('vision:'));
    const hand = vision ? [denizen, vision] : [denizen];
    s.worldDeck = s.worldDeck.filter((id) => !hand.includes(id));
    s.players[1].hand = hand;
    s.players[1].handDrawnAt = s.actionCount;
    // seat 1 is an Exile in baseState, so the Vision→vision-space branch is legal.
    expect(s.players[1].citizenship).toBe('exile');
    checkInvariants(s);

    const all = aff(s, 1);
    // Mid-Search the 'play' decision resolves only card.play; the sole other
    // offer is the universal standing.set (P4 unit 6).
    expect(new Set(all.map((e) => e.type))).toEqual(new Set(['card.play', 'standing.set']));
    const entries = all.filter((e) => e.type === 'card.play');
    const asOptionsForDenizen = entries
      .filter((e) => (e.fields[0] as any).options[0].value === 0)
      .flatMap((e) => ((e.fields[1] as any).options as { value: string }[]).map((o) => o.value));
    expect(asOptionsForDenizen).toContain('discard');
    if (vision) {
      const asForVision = entries
        .filter((e) => (e.fields[0] as any).options[0].value === 1)
        .flatMap((e) => ((e.fields[1] as any).options as { value: string }[]).map((o) => o.value));
      expect(asForVision).toContain('vision'); // Exile reveal
      expect(asForVision).not.toContain('site'); // a Vision cannot go to a site
    }
    expect(auditAffordances(s, 1)).toEqual([]);
  });
});

describe('warbands give/take between two Imperial players (a fixture-gap branch)', () => {
  function coLocatedCitizen(): OathState {
    const s = baseState();
    s.turn.activeSeat = 0; // the Chancellor
    s.players[2].citizenship = 'citizen';
    const siteId = s.players[0].pawnSite!;
    s.players[2].pawnSite = siteId;
    // Rebalance warbands for §1.8/§1.15 conservation with one Citizen:
    // Chancellor + Citizen must total 24 purple; the Exile stays at 14.
    for (const site of s.sites) site.warbands = s.players.map(() => 0);
    s.players[0].warbands = { bank: 20, board: 3 }; // 23 purple
    s.players[1].warbands = { bank: 11, board: 3 }; // 14 exile
    s.players[2].warbands = { bank: 0, board: 1 }; // 1 purple → 24 total
    checkInvariants(s);
    return s;
  }

  it('offers give and take to the co-located Citizen, each noting whose permission it needs', () => {
    const s = coLocatedCitizen();
    const entries = aff(s, 0).filter((e) => e.type === 'warbands.move');
    const give = entries.find((e) => (e.fields[0] as any).options[0].value === 'give');
    const take = entries.find((e) => (e.fields[0] as any).options[0].value === 'take');
    expect(give, 'a give entry to the Citizen').toBeDefined();
    expect(take, 'a take entry from the Citizen').toBeDefined();
    expect(give!.note).toMatch(/permission/);
    expect(take!.note).toMatch(/permission/);
    expect(auditAffordances(s, 0)).toEqual([]);
  });

  it('does NOT offer give/take when the approver has a standing denial (would bounce)', () => {
    const s = coLocatedCitizen();
    s.players[2].standing = { ...s.players[2].standing, warbands: 'deny' };
    const entries = aff(s, 0).filter(
      (e) => e.type === 'warbands.move' && ['give', 'take'].includes((e.fields[0] as any).options[0].value),
    );
    expect(entries).toEqual([]);
    expect(auditAffordances(s, 0)).toEqual([]);
  });
});

describe('power.use over a Reliquary power (Chancellor, uncovered space)', () => {
  it('offers the reliquary power, labelled by modifier not by a card id', () => {
    const s = baseState();
    s.turn.activeSeat = 0; // the Chancellor
    s.reliquary[0].relicId = null; // uncovered → §7.1.1 grants the mandatory power
    const power = aff(s, 0).find((e) => e.type === 'power.use')!;
    expect(power).toBeDefined();
    const cardId = power.fields.find((f) => f.name === 'cardId')!;
    if (cardId.kind !== 'choose-one') throw new Error('unreachable');
    const reliq = cardId.options.find((o) => o.value === `reliquary:${s.reliquary[0].modifier}`);
    expect(reliq, 'the uncovered reliquary power is offered').toBeDefined();
    expect(reliq!.label).toMatch(/Reliquary/);
    // power.use carries a free field, so the harness skips it — assert that
    // the rest of seat 0's affordances remain clean.
    expect(auditAffordances(s, 0)).toEqual([]);
  });
});

describe('the harness over a hand-built 6-seat state with Citizens', () => {
  it('stays green for every seat', () => {
    // A real 6-seat game with Citizens is the sixplayer fixture (run by
    // affordances.test.ts); here we exercise the give/take + citizen state
    // directly, for every seat, as the plan asks for the gaps.
    const s = baseState();
    s.turn.activeSeat = 0;
    s.players[2].citizenship = 'citizen';
    s.players[2].pawnSite = s.players[0].pawnSite;
    for (const site of s.sites) site.warbands = s.players.map(() => 0);
    s.players[0].warbands = { bank: 20, board: 3 };
    s.players[1].warbands = { bank: 11, board: 3 };
    s.players[2].warbands = { bank: 0, board: 1 };
    checkInvariants(s);
    for (const seat of [0, 1, 2]) {
      expect(auditAffordances(s, seat), `seat ${seat}`).toEqual([]);
    }
  });
});
