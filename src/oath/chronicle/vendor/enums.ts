// Vendored from Vagabottos/OathParser @ 53b7f533b8fb7fbd617d6bde6fe824238680262f
// (src/interfaces/enums.ts). MIT — see vendor/oathparser/LICENSE and
// vendor/oathparser/PROVENANCE.md. Unchanged from upstream.

export enum Suit {
  Discord = 0,
  Hearth = 1,
  Nomad = 2,
  Arcane = 3,
  Order = 4,
  Beast = 5
}

export enum Oath {
  Supremacy = 0,
  People = 1,
  Devotion = 2,
  Protection = 3,
  Conspiracy = 4
}

export enum PlayerColor {
  Purple = 'Purple',
  Brown = 'Brown',
  Yellow = 'Yellow',
  White = 'White',
  Blue = 'Blue',
  Red = 'Red'
}

export enum Citizenship {
  Exile = 'Exile',
  Citizen = 'Citizen'
}

export type PlayerCitizenship = Omit<
  Record<PlayerColor, Citizenship>,
  PlayerColor.Purple
>;
