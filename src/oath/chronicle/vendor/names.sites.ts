// Vendored from Vagabottos/OathParser @ 53b7f533b8fb7fbd617d6bde6fe824238680262f
// (src/interfaces/sites.ts). MIT — see vendor/oathparser/LICENSE and
// vendor/oathparser/PROVENANCE.md. Only change from upstream: explicit types on
// the two exports so the file compiles under `strict`. Behaviour is unchanged.

export const SiteName: Record<string, number> = {
  'Mine': 0,
  'Salt Flats': 1,
  'Fertile Valley': 2,
  'Barren Coast': 3,
  'Plains': 4,
  'River': 5,
  'Steppe': 6,
  'Mountain': 7,
  'Lush Coast': 8,
  'Marshes': 9,
  'Wastes': 10,
  'Rocky Coast': 11,
  'Narrow Pass': 12,
  'Charming Valley': 13,
  'Deep Woods': 14,
  'Standing Stones': 15,
  'Ancient City': 16,
  'Drowned City': 17,
  'Great Slum': 18,
  'Buried Giant': 19,
  'The Tribunal': 20,
  'Shrouded Wood': 21,
  'The Hidden Place': 22,

  'NONE': 255
};

export const SiteNameIndexes: Record<number, string> = Object.keys(SiteName)
  .reduce((prev, cur) => {
    prev[SiteName[cur]] = cur;
    prev[SiteName[cur] + 24] = cur;
    return prev;
  }, {} as Record<number, string>);
