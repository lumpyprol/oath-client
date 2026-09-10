import { describe, it, expect } from 'vitest';
import { cards } from '../../../src/oath/cards/index.js';
import { checkInvariants, type OathState } from '../../../src/oath/game/state.js';
import { oath } from '../../../src/oath/game/index.js';
import { IllegalAction, type GameAction } from '../../../src/engine/types.js';
import { baseState } from './helpers.js';

function muster(state: OathState, actor: number | null, payload: unknown): OathState {
  const action: GameAction = {
    gameId: 'test',
    seq: state.actionCount + 1,
    type: 'muster',
    actor,
    payload,
    createdAt: '2026-09-10T00:00:00.000Z',
  };
  return oath.reduce(state, action);
}

/** baseState: seat 1 is active, pawn at sites[5], which holds one denizen. */
function ready() {
  const s = baseState();
  const site = s.sites.find((x) => x.id === s.players[1].pawnSite)!;
  const target = site.cards.find((c) => c !== null)!;
  return { s, siteId: site.id, cardId: target.id };
}

describe('muster (Law §5.2)', () => {
  it('spends 1 Supply, places 1 favor on the card, and gains 2 warbands bank->board', () => {
    const { s, cardId } = ready();
    const supplyBefore = s.players[1].supply;
    const favorBefore = s.players[1].favor;
    const bankBefore = s.players[1].warbands.bank;
    const boardBefore = s.players[1].warbands.board;

    const out = muster(s, 1, { cardId });

    expect(out.players[1].supply).toBe(supplyBefore - 1);
    expect(out.players[1].favor).toBe(favorBefore - 1);
    const site = out.sites.find((x) => x.id === out.players[1].pawnSite)!;
    expect(site.cards.find((c) => c?.id === cardId)!.favor).toBe(1);
    expect(out.players[1].warbands.bank).toBe(bankBefore - 2);
    expect(out.players[1].warbands.board).toBe(boardBefore + 2);
    checkInvariants(out);
  });

  it('defaults the site to your pawn site', () => {
    const { s, cardId } = ready();
    const out = muster(s, 1, { cardId });
    const site = out.sites.find((x) => x.id === out.players[1].pawnSite)!;
    expect(site.cards.find((c) => c?.id === cardId)!.favor).toBe(1);
  });

  it('gains as many warbands as the personal bank has, even if fewer than 2 (Law §9.3)', () => {
    const { s, cardId } = ready();
    // drain the bank to 1 by pushing warbands onto a site (keeps conservation)
    const drain = s.players[1].warbands.bank - 1;
    s.players[1].warbands.bank = 1;
    s.sites[5].warbands[1] += drain;
    checkInvariants(s);

    const out = muster(s, 1, { cardId });
    expect(out.players[1].warbands.bank).toBe(0);
    expect(out.players[1].warbands.board).toBe(3 + 1); // only 1 was available
    expect(out.players[1].supply).toBe(s.players[1].supply - 1); // cost still paid
    checkInvariants(out);
  });

  it('gains zero warbands when the bank is empty, still paying the cost', () => {
    const { s, cardId } = ready();
    const drain = s.players[1].warbands.bank;
    s.players[1].warbands.bank = 0;
    s.sites[5].warbands[1] += drain;
    checkInvariants(s);

    const out = muster(s, 1, { cardId });
    expect(out.players[1].warbands.board).toBe(3);
    expect(out.players[1].supply).toBe(s.players[1].supply - 1);
    expect(out.players[1].favor).toBe(s.players[1].favor - 1);
    checkInvariants(out);
  });

  it('is illegal for a seat that is not the active one', () => {
    const { s, cardId } = ready();
    expect(() => muster(s, 2, { cardId })).toThrow(IllegalAction);
  });

  it('is illegal with insufficient Supply (Law §5.2.1)', () => {
    const { s, cardId } = ready();
    s.players[1].supply = 0;
    expect(() => muster(s, 1, { cardId })).toThrow(IllegalAction);
  });

  it('is illegal with no favor to place (Law §5.2.1)', () => {
    const { s, cardId } = ready();
    s.sharedBank.favor += s.players[1].favor;
    s.players[1].favor = 0;
    expect(() => muster(s, 1, { cardId })).toThrow(IllegalAction);
  });

  it('is illegal against a card that is not at your site', () => {
    const { s } = ready();
    const elsewhere = s.sites.find(
      (x) => x.id !== s.players[1].pawnSite && x.cards.some((c) => c !== null),
    )!;
    const cardId = elsewhere.cards.find((c) => c !== null)!.id;
    expect(() => muster(s, 1, { cardId, siteId: elsewhere.id })).toThrow(IllegalAction);
  });

  it('is illegal against a card that already has favor or secrets on it (Law §5.2.1)', () => {
    const { s, cardId, siteId } = ready();
    const site = s.sites.find((x) => x.id === siteId)!;
    site.cards.find((c) => c?.id === cardId)!.secrets = 1;
    s.players[1].secrets.ready -= 1; // source it, keep counts sane
    expect(() => muster(s, 1, { cardId })).toThrow(IllegalAction);
  });

  it('is illegal against a ruined edifice (Law §5.2.1 / §2.9)', () => {
    const { s, siteId } = ready();
    const site = s.sites.find((x) => x.id === siteId)!;
    const edificeId = cards.edifices[0].id;
    site.cards[0] = { id: edificeId, favor: 0, secrets: 0, ruined: true };
    expect(() => muster(s, 1, { cardId: edificeId })).toThrow(IllegalAction);
  });

  it('is illegal once the game is complete', () => {
    const { s, cardId } = ready();
    s.complete = true;
    expect(() => muster(s, 1, { cardId })).toThrow(IllegalAction);
  });

  it('does not advance the turn', () => {
    const { s, cardId } = ready();
    const out = muster(s, 1, { cardId });
    expect(out.turn.activeSeat).toBe(1);
  });
});
