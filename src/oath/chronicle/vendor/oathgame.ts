// Vendored from Vagabottos/OathParser @ 53b7f533b8fb7fbd617d6bde6fe824238680262f
// (src/interfaces/oathgame.ts). MIT — see vendor/oathparser/PROVENANCE.md.
// Change from upstream: `winner` is optional (the parser leaves it unset for
// pre-3.1.1 savefiles); import list trimmed to what is used.
import type { PlayerColor, PlayerCitizenship, Suit } from './enums.js';

export interface Card {
  name: string;
}

export interface Site {
  name: string;
  ruined: boolean;
  cards: Card[];
}

export interface OathGame {
  version: {
    major: string
    minor: string
    patch: string
  }

  gameCount: number;
  chronicleName: string;

  playerCitizenship: PlayerCitizenship;
  oath: string;
  suitOrder: Suit[];
  sites: Site[];
  world: Card[];
  dispossessed: Card[];
  relics: Card[];

  prevPlayerCitizenship: PlayerCitizenship;
  winner?: PlayerColor;
}
