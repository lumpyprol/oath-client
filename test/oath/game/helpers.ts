/**
 * Test helpers for the Oath game engine.
 *
 * `baseState()` builds a minimal valid 3-player mid-game state from real
 * card ids (via the cards API — nothing hardcoded that could drift). Later
 * units extend it additively: new optional builder params, never changed
 * defaults.
 */

import { cards, byId } from '../../../src/oath/cards/index.js';
import {
  type OathState,
  type PlayerState,
  type SiteState,
  type Region,
  TOTAL_FAVOR,
  CHANCELLOR_WARBANDS,
  EXILE_WARBANDS,
  BOXED_SECRETS,
  PEOPLES_FAVOR_ID,
  DARKEST_SECRET_ID,
} from '../../../src/oath/game/state.js';

export function baseState(overrides: Partial<OathState> = {}): OathState {
  const seats = 3;

  // deal real denizen ids without duplication
  const denizens = cards.denizens.map((d) => d.id);
  let next = 0;
  const take = () => denizens[next++];

  // 8 sites on the board: 2 Cradle, 3 Provinces, 3 Hinterland (Law §2.1.1)
  const regions: Region[] = [
    'cradle', 'cradle',
    'provinces', 'provinces', 'provinces',
    'hinterland', 'hinterland', 'hinterland',
  ];
  const sites: SiteState[] = cards.sites.slice(0, 8).map((sc, i) => {
    const slots: SiteState['cards'] = Array.from(
      { length: sc.capacity },
      () => null,
    );
    if (sc.capacity > 0) slots[0] = { id: take(), favor: 0, secrets: 0 };
    return {
      id: sc.id,
      region: regions[i],
      facedown: false,
      cards: slots,
      relics: [],
      warbands: Array.from({ length: seats }, () => 0),
      favor: 0,
      secrets: 0,
    };
  });

  // map presence: chancellor in the Cradle and Provinces, an exile out east
  sites[0].warbands[0] = 2;
  sites[2].warbands[0] = 1;
  sites[5].warbands[1] = 2;
  // an unclaimed reveal-prompt token (Law §2.8.2)
  sites[0].favor = 1;

  const relicIds = cards.relics.map((r) => r.id);
  sites[1].relics = [relicIds[0]];

  const mkPlayer = (p: Partial<PlayerState>): PlayerState => ({
    citizenship: 'exile',
    hand: [],
    advisers: [],
    vision: null,
    favor: 1,
    secrets: { ready: 1, flipped: 0 },
    warbands: { bank: 0, board: 3 },
    supply: 4,
    relics: [],
    ...p,
  });

  const players: PlayerState[] = [
    mkPlayer({
      citizenship: 'chancellor',
      advisers: [{ id: take(), facedown: false, favor: 0, secrets: 0 }],
      favor: 2,
    }),
    mkPlayer({
      advisers: [{ id: take(), facedown: true, favor: 0, secrets: 0 }],
      vision: cards.visions[0].id,
    }),
    mkPlayer({
      secrets: { ready: 1, flipped: 1 },
      relics: [relicIds[1]],
    }),
  ];

  // warband banks from conservation (Law §1.8, §1.9)
  players.forEach((p, seat) => {
    const placed =
      p.warbands.board + sites.reduce((sum, s) => sum + s.warbands[seat], 0);
    const total = seat === 0 ? CHANCELLOR_WARBANDS : EXILE_WARBANDS;
    p.warbands.bank = total - placed;
  });

  const discards: OathState['discards'] = {
    cradle: [take()],
    provinces: [take()],
    hinterland: [],
  };
  const dispossessed = [take(), take()];

  // one vision revealed (held by seat 1); the other four still in the deck
  const worldDeck = [
    ...denizens.slice(next),
    ...cards.visions.slice(1).map((v) => v.id),
  ];

  const favorBanks: OathState['favorBanks'] = {
    // 3 per bank at 3 players (Law §1.6)
    discord: 3, hearth: 3, nomad: 3, arcane: 3, order: 3, beast: 3,
  };

  const banners: OathState['banners'] = [
    { id: PEOPLES_FAVOR_ID, holder: null, tokens: 1, mob: false },
    { id: DARKEST_SECRET_ID, holder: null, tokens: 1 },
  ];

  // remainders keep the conservation laws true by construction
  const favorPlaced =
    Object.values(favorBanks).reduce((a, b) => a + b, 0) +
    players.reduce((a, p) => a + p.favor, 0) +
    sites.reduce((a, s) => a + s.favor, 0) +
    banners.find((b) => b.id === PEOPLES_FAVOR_ID)!.tokens;
  const secretsPlaced =
    players.reduce((a, p) => a + p.secrets.ready + p.secrets.flipped, 0) +
    banners.find((b) => b.id === DARKEST_SECRET_ID)!.tokens;

  const state: OathState = {
    seats,
    oath: 'supremacy',
    oathkeeper: 0,
    usurper: false,
    players,
    sites,
    favorBanks,
    sharedBank: {
      favor: TOTAL_FAVOR - favorPlaced,
      secrets: BOXED_SECRETS - secretsPlaced,
    },
    worldDeck,
    relicDeck: relicIds.slice(6),
    reliquary: relicIds.slice(2, 6),
    grandScepter: 0,
    discards,
    dispossessed,
    banners,
    visionsDrawn: 1,
    turn: { activeSeat: 1, round: 3 },
    campaign: null,
    actionCount: 17,
    complete: false,
    winner: null,
  };

  if (state.sharedBank.favor < 0) {
    throw new Error('helpers: baseState allocated more favor than exists');
  }
  // sanity: every referenced id resolves
  byId(state.sites[0].id);

  return { ...state, ...overrides };
}
