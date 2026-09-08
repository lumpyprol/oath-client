
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
