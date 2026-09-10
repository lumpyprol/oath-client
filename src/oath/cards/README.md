# `src/oath/cards` — the card database

Structured data for every card in base Oath. Engine-agnostic: ids, names,
suits, and structural facts only. Powers and card text are not modelled here
(text is an optional overlay; powers are player-declared from P2 on).

See the "Card data" section of the root `README.md` for the why. This is the
file map.

## Pipeline

```
vendor/oathparser/cards.lua        data/site-reveals.json
        │  lua.ts        parseCardsLua      │  hand-transcribed site reveal
        ▼                                   ▼  prompts (Law §2.8.2); cards.lua has none
   build.ts             buildDatabase       RawRecord[] + reveals → typed CardDatabase (schema-validated)
        │
        │  reconcile.ts  applyOverrides      apply data/overrides.json (canonical names + aliases)
        ▼
   generate.ts          generate()          the whole pipeline, no disk writes
        │
        │  scripts/build-cards.ts            writes the JSON, sorted by saveId
        ▼
   data/{denizens,sites,relics,visions,edifices,banners}.json   committed
        │
        │  index.ts      load + schema-validate + withText(overlay) + deep-freeze
        ▼
   cards, byId, findById, byName, bySaveId, denizensBySuit, edificeBySuit
```

`art.ts` sits beside the loader: `generateArtManifest(generate())` →
`data/art.json` (via `scripts/build-art-manifest.ts`, `npm run build:art`),
drift-guarded like the data files.

## Files

| File | What |
| --- | --- |
| `schema.ts` | zod schemas + inferred types; `SUITS`, `SUIT_INDEX`, `SetSchema`, `PowerKindSchema`; the `Card` union and `CardDatabase` with its cross-collection refinements |
| `ids.ts` | `slugify(name)` and `cardId(kind, name)` — deterministic id derivation |
| `lua.ts` | `parseCardsLua(source)` — a line parser for the mod's `cards.lua`, no Lua interpreter |
| `build.ts` | `buildDatabase(records, siteReveals)` — raw records → validated `CardDatabase`; the mod's banner tag is quarantined here in `MOD_BANNER_CARDTYPE` |
| `reconcile.ts` | `findDiscrepancies`, `applyOverrides`, `isCovered` — name reconciliation between the two upstream witnesses |
| `tsNames.ts` | reads the vendored parser's name tables as **text**, so `vendor/` never enters the TS build |
| `generate.ts` | `generate()` + `COLLECTIONS`, `DATA_DIR`, `serializeCollection` |
| `index.ts` | the runtime loader and lookup API; validates and deep-freezes at module load |
| `text.ts` | `loadTextOverlay(path?)`, `withText(db, overlay)` — the optional client-only text overlay |
| `art.ts` | `loadArtManifest`, `requiredArtKeys`, `generateArtManifest`, `missingArt`, `missingAssets` — the art manifest and asset presence checks |
| `data/*.json` | generated, committed card data — regenerate with `npm run build:cards` |
| `data/overrides.json` | hand-resolved name reconciliation, one reason per entry |
| `data/site-reveals.json` | hand-transcribed site reveal prompts (Law §2.8.2), keyed by saveId — `cards.lua` has no favor/secret data and its `relicCount` is wrong for 2 sites |
| `data/art.json` | generated art manifest (`npm run build:art`); asset files live in `ART_DIR`, not git |
| `data/text.json` | optional; not committed yet; tests use `test/fixtures/text.fake.json` |

## Tests

`test/oath/cards/` — one file per module, plus `drift.test.ts` guarding the
committed JSON against the generator. No test contains real card text.
