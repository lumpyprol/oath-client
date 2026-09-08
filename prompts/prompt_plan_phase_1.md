# Prompt plan — Phase 1: card data

Phase 1 produces the structured card database everything after it depends on:
every denizen, site, relic, vision, edifice/ruin, and banner in base Oath, with
stable ids, suits, and the structural facts the engine and the chronicle need.
It is engine-agnostic. If the server were thrown away tomorrow this data would
still be worth having.

Each unit below is a prompt to hand to Claude Code (or whatever you're driving),
in order. Every unit is TDD: write the failing tests, make them pass, run the
whole suite, commit. Each stands alone — a later unit never requires reopening
an earlier one, and the repo is in a green, committed state after each.

---

## What was verified on 2026-09-08

I cloned `Vagabottos/OathParser` (MIT, master @ `53b7f533b8fb7fbd617d6bde6fe824238680262f`,
2022-01-24) and inspected it. Facts the plan relies on:

- `lua/cards.lua` is the official TTS mod's card table (AgentElrond, by permission
  of Leder), copied in for reference. It has **name, saveid, cardtype, suit** for
  every card, plus **capacity and relicCount** for sites. It has **no card text and
  no power classification.**
- Counts: 198 denizens, 23 sites (a 24th slot is reserved/unused), 20 relics,
  5 visions, 6 edifice/ruin cards, 2 banners (`SuperRelic` in the mod).
- Two numbering systems share the 0–255 byte space: sites have their own
  (facedown = saveid + 24), everything else shares one. `255` is a sentinel.
- Edifice and ruin are two faces of one card; the ruin face is `saveid + 1`.
- Suit enum order in the seed format is Discord 0, Hearth 1, Nomad 2, Arcane 3,
  Order 4, Beast 5. This must be preserved for chronicle interop.
- `src/index.ts` implements both `parseOathTTSSavefileString` and
  `serializeOathGame` (~400 lines). `test/savefile.ts` contains sample seeds.
- **The Lua table and the TypeScript name tables disagree.** Some indices are
  swapped (16/98 Gossip vs Sleight of Hand; 111/112 Forced Labor vs Secret
  Police), some are renamed between printings (Bandit King/Chief, Cult of Chaos/
  Chaos Cult, Surprise/Sneak Attack, Banner of Devotion/Ring of Devotion, Proof
  of Nobility/Ivory Eye, Imperial Seat/The Tribunal, The Drowned City/Drowned
  City), and the edifice/ruin entries are structured differently. Unit 6 exists
  because of this.

---

## Decisions made

1. **Data lives in this repo**, under `src/oath/cards/`. No separate package.
2. **Source of truth is JSON, validated by zod at load and in tests.** Data is
   data, not code: it diffs cleanly and card text can be edited without touching
   TypeScript. Types are inferred from the zod schemas.
3. **Generated JSON is committed; the generator is committed too.** The build
   script is provenance, not a runtime step. A drift test (unit 7) ensures the
   committed data matches what the script produces.
4. **Canonical structural source is `cards.lua`.** It is the mod's own data. The
   TypeScript name tables are treated as a second witness for reconciliation.
5. **Ids are namespaced slugs**: `denizen:wrestlers`, `site:mine`,
   `relic:brass-horse`. Readable in the action log (which we made human-readable
   on purpose), collision-proof across kinds. `saveId` is kept as an attribute for
   seed interop, never used as an identifier in our own code.
6. **Edifice/ruin is one entity with two faces.** State will track which face is
   up. Matches the physical card and the seed encoding.
7. **Banners are their own kind** (not relics), with faces, because the People's
   Favor / Mob's Favor card flips.
8. **Card text is an optional overlay** in a separate file, merged at load.
   Tests never assert on real card text. The engine never reads it; only the
   client does.
9. **Base game only.** A `set` field is reserved so New Foundations can be added
   later without a schema change.
10. **Vendor, don't depend.** The relevant OathParser files are copied into
    `vendor/oathparser/` with a provenance record and the MIT license, pinned to
    the commit above. The npm package (`@seiyria/oath-parser` 1.0.8) is not used:
    it is a webpack bundle of uncertain vintage and the source is 400 lines.
11. **Name discrepancies are resolved by hand**, in an overrides file with a
    stated reason per entry, verified against physical cards. A test enforces
    that zero discrepancies remain unresolved.

## Decisions needed from you

- **Which printing do you own?** The renames above are almost certainly
  printing differences. Your physical cards decide canonical names in unit 6.
  Older names become aliases, so seeds from either era still parse.
- **Does the client need power classification** (action / persistent / battle /
  when-played / locked) before P4? It is a UI hint in the player-declared model,
  not enforcement. The schema reserves an optional `powerKind` on the text
  overlay; deciding whether to fill it can wait.
- **Is `text.json` committed?** The repo is private and the group owns the game,
  so I'd commit it. If you'd rather not, gitignore it and the loader already
  tolerates its absence.

---

## Conventions for every prompt

- Repo state assumed: P0 as committed. Node 22, TypeScript, ESM (`.js` import
  suffixes), vitest, zod already a dependency. `npm test` must be green before
  and after.
- Red, green, refactor. Write the test file first, run it, watch it fail for
  the right reason, then implement.
- Tests go in `test/oath/cards/`. Fixtures in `test/fixtures/`.
- No real card text appears in any test. Use obviously fake strings.
- Finish with `npm test`, then commit with the message given.

---

## Unit 1 — Vendor the source data with provenance

**Purpose.** Pin the upstream files so every later unit works from a known
input, and make silent drift impossible.

**Depends on.** Nothing.

```
We're starting Phase 1 (card data) of oath-async. First unit: vendor the
upstream data with provenance.

Create `vendor/oathparser/` containing these files copied verbatim from
https://github.com/Vagabottos/OathParser at commit
53b7f533b8fb7fbd617d6bde6fe824238680262f:
  - lua/cards.lua
  - src/interfaces/cards.ts   (rename to names.cards.ts)
  - src/interfaces/sites.ts   (rename to names.sites.ts)
  - src/interfaces/enums.ts
  - src/index.ts              (rename to parser.ts)
  - LICENSE

Fetch them with git (shallow clone at that commit), not by hand.

Write `vendor/oathparser/PROVENANCE.md` recording: repo URL, commit, commit
date, the date vendored, and the sha256 of each vendored file.

TDD:
1. Write `test/oath/cards/provenance.test.ts`: for each file listed in
   PROVENANCE.md, compute sha256 and assert it matches. Parse the hashes out
   of the markdown; don't duplicate them in the test.
2. Run it — it fails because the files don't exist.
3. Vendor the files, write PROVENANCE.md, make it pass.

The vendored .ts files are reference material. Do not import them from
src/ yet; a later unit decides how they're consumed. Make sure tsconfig
`include` does not pick up vendor/ (it's `["src"]` today — keep it that way).

Commit: "Vendor OathParser card data with provenance"
```

**Done when.** Hash test passes; `vendor/` is excluded from the TS build.

**Status.** ✅ Completed 2026-09-08. `vendor/oathparser/` holds the six files
+ `PROVENANCE.md`; `test/oath/cards/provenance.test.ts` verifies the hashes
(7 tests pass). `tsconfig` include stays `["src"]`.

---

## Unit 2 — Schema and types

**Purpose.** Define what a card *is* before any data exists. Everything downstream
validates against this.

**Depends on.** Nothing (unit 1 is data, this is shape).

```
Unit 2 of Phase 1: the card schema.

Create `src/oath/cards/schema.ts` using zod. Export both the schemas and
their inferred types.

Shapes:

  Suit: enum of 'discord' | 'hearth' | 'nomad' | 'arcane' | 'order' | 'beast'.
  Also export SUIT_INDEX: Record<Suit, number> with the seed-format order
  Discord 0, Hearth 1, Nomad 2, Arcane 3, Order 4, Beast 5, and SUITS as
  an ordered array in that order.

  Every card has: id (string, must match /^(denizen|site|relic|vision|
  edifice|banner):[a-z0-9-]+$/), name (nonempty string), set ('base' for
  now; the enum can grow), saveId (integer 0..254).

  Denizen: + suit.
  Site: + capacity (integer >= 0), relicCount (integer >= 0).
  Relic: no extra fields.
  Vision: no extra fields.
  EdificeRuin: + suit, faces: { edifice: {name, saveId}, ruin: {name, saveId} }.
    The top-level `name` and `saveId` are the edifice face's. Refinement:
    ruin.saveId === edifice.saveId + 1.
  Banner: + faces: string[] with 1 or 2 entries. name is faces[0].

  CardDatabase: { denizens: Denizen[], sites: Site[], relics: Relic[],
  visions: Vision[], edifices: EdificeRuin[], banners: Banner[] }.
  Refinements on the database:
    - all ids unique across every collection
    - saveIds unique within sites
    - saveIds unique across everything that isn't a site (denizens, relics,
      visions, banners, and BOTH faces of each edifice)

TDD, in `test/oath/cards/schema.test.ts`:
  - a minimal valid database (two or three cards per kind, fake names)
    parses
  - rejects: unknown suit; saveId 255; id with wrong prefix for its kind
    (e.g. a Denizen with id 'site:foo' — add a per-kind refinement);
    ruin saveId not edifice + 1; duplicate id across two collections;
    duplicate saveId between a denizen and a relic; a site and a denizen
    sharing a saveId is FINE (separate numbering) — assert that explicitly.

Don't create any real data yet. No loader yet.

Commit: "Add card schema"
```

**Done when.** Schema tests pass; no data files exist yet.

**Status.** ✅ Completed 2026-09-08. `src/oath/cards/schema.ts` exports the zod
schemas + inferred types, `SUITS`, `SUIT_INDEX`, `SetSchema`, and a `Card`
union. `test/oath/cards/schema.test.ts` — 12 tests pass; `npm run build` clean.
No data files.

---

## Unit 3 — Slug and id derivation

**Purpose.** One deterministic function from a card's name to its id, tested on
the awkward cases, so ids never drift between runs of the generator.

**Depends on.** Unit 2 (for the id regex).

```
Unit 3 of Phase 1: id derivation.

Create `src/oath/cards/ids.ts` exporting:
  slugify(name: string): string
  cardId(kind: 'denizen'|'site'|'relic'|'vision'|'edifice'|'banner',
         name: string): string

Rules for slugify:
  - lowercase
  - apostrophes (' and ’) removed, not replaced: "Tinker's Fair" -> tinkers-fair
  - every other run of non-alphanumerics becomes a single hyphen
  - leading/trailing hyphens trimmed
  - a leading "the " is dropped: "The Hidden Place" -> hidden-place.
    (Rationale: printings disagree on the article; see unit 6.)
  - for "A / B" compound names, slug the part before the first " / " only:
    "Sprawling Rampart / Bandit Rampart" -> sprawling-rampart
  - result must match /^[a-z0-9-]+$/ and be nonempty; throw otherwise

cardId prefixes the kind: cardId('relic', 'Brass Horse') -> 'relic:brass-horse'.

TDD, `test/oath/cards/ids.test.ts`, table-driven. Include at least:
  "Tinker's Fair", "Long-Lost Heir", "The Hidden Place", "The Drowned City",
  "A Small Favor" (leading "A " is NOT dropped — only "The "),
  "Sprawling Rampart / Bandit Rampart", "The People's Favor / The Mob's Favor"
  (-> peoples-favor), a name with a curly apostrophe, and an empty/whitespace
  name that must throw. Assert every produced id satisfies the schema's id
  regex from unit 2.

Commit: "Add card id derivation"
```

**Done when.** Table test passes; every slug validates against the schema regex.

---

## Unit 4 — Lua table parser

**Purpose.** Read `cards.lua` without a Lua interpreter. The file is one large
table literal with a very regular line shape; a line parser is enough and is
far easier to test than a grammar.

**Depends on.** Nothing at runtime (tests use inline snippets).

```
Unit 4 of Phase 1: a parser for the mod's Lua card table.

Create `src/oath/cards/lua.ts` exporting:

  interface RawRecord { name: string; fields: Record<string, string | number> }
  parseCardsLua(source: string): RawRecord[]

The input is the vendored cards.lua. Every record we care about is a single
line of the form:

  ["Some Name"] = { key = value, key2 = "str", ... },

Requirements:
  - one RawRecord per such line, in file order
  - numeric values become numbers, double-quoted values become strings
  - lines that are commented out (start with -- after whitespace) are
    skipped, even if they look like records. There are commented-out
    entries in the real file.
  - trailing -- comments after a record are ignored
  - lines that don't match the record shape are ignored (function
    headers, nested tables like ttsDeckInfo, closing braces)
  - names may contain apostrophes and slashes; the name is everything
    between the [" and "] — there are no escaped quotes in the file
  - throw with a line number if a line looks like a record but the body
    can't be parsed

Do NOT try to handle general Lua. This is a line parser for one file.

TDD, `test/oath/cards/lua.test.ts`, using small inline snippets:
  - a three-record snippet parses to three RawRecords with correct types
  - a commented-out record is skipped
  - a record with a trailing comment parses cleanly
  - a nested-table line is ignored, not an error
  - a malformed record body throws and the error message includes the
    line number
Then one integration assertion: parsing the real vendored file yields at
least 250 records and every record has a numeric saveid (except any with
cardtype "None").

Commit: "Add line parser for the mod's Lua card table"
```

**Done when.** Snippet tests pass; the real file parses with expected count.

---

## Unit 5 — Build the database from raw records

**Purpose.** The pure transform: raw records in, a validated `CardDatabase`
out. Kept separate from file I/O so it's fully testable.

**Depends on.** Units 2, 3, 4.

```
Unit 5 of Phase 1: transform raw Lua records into the typed database.

Create `src/oath/cards/build.ts` exporting:
  buildDatabase(records: RawRecord[]): CardDatabase

Mapping from the mod's cardtype:
  "Site"        -> Site. capacity and relicCount from fields. Skip any
                   record named "UNUSED".
  "Denizen"     -> Denizen. suit lowercased.
  "Relic"       -> Relic.
  "Vision"      -> Vision.
  "EdificeRuin" -> EdificeRuin. Name is "Edifice / Ruin"; split on " / ".
                   edifice.saveId = saveid, ruin.saveId = saveid + 1.
  "SuperRelic"  -> Banner. If the name contains " / ", faces are the two
                   parts; otherwise one face.
  "None"        -> skipped.
  anything else -> throw; the file should contain nothing else.

Every record: id via cardId(kind, name), set 'base'. Validate the result
with the unit-2 schema before returning — the function should throw on
invalid output, never return it.

TDD, `test/oath/cards/build.test.ts`:
  Unit tests on small hand-made RawRecord arrays:
    - each cardtype maps to the right kind with the right fields
    - "UNUSED" and "None" are dropped
    - an unknown cardtype throws
    - an EdificeRuin without " / " in its name throws
  Then integration on parseCardsLua(vendored file):
    - counts: 198 denizens, 23 sites, 20 relics, 5 visions, 6 edifices,
      2 banners
    - every suit appears among denizens, and every suit appears exactly
      once among edifices
    - the result passes the schema (implicitly, since build validates —
      but assert it explicitly too)

Commit: "Build typed card database from Lua records"
```

**Done when.** Counts match; schema validation passes on real data.

---

## Unit 6 — Name reconciliation and overrides

**Purpose.** The Lua data and the TypeScript name tables disagree on ~20 cards.
This unit surfaces every disagreement, lets you resolve each one against your
physical cards, and locks the result in with a test so it can never regress.

**Depends on.** Units 1, 5. **Needs your input** to finish.

```
Unit 6 of Phase 1: reconcile card names between the two upstream witnesses.

Background: vendor/oathparser/cards.lua (the mod data) and
vendor/oathparser/names.cards.ts + names.sites.ts (the parser's tables)
disagree on some names at the same index. Some are index swaps, some are
renames between printings.

Create `src/oath/cards/reconcile.ts` exporting:

  interface Discrepancy {
    numbering: 'site' | 'card';
    saveId: number;
    lua: string | null;
    ts: string | null;
  }
  findDiscrepancies(db: CardDatabase, tsCardNames: Record<string, number>,
                    tsSiteNames: Record<string, number>): Discrepancy[]

Read the TS name tables by importing the vendored files directly
(they're plain object literals; add vendor/oathparser/names.*.ts to
tsconfig include ONLY if needed, or re-export them through
src/oath/cards/vendor.ts — your call, but keep vendor/ out of the runtime
bundle path).

For edifice/ruin cards the TS table has separate entries at n and n+1 for
the two faces; compare each face to its TS entry, not the compound name.
Ignore index 255 and the TS 'NONE' entries.

Create `src/oath/cards/data/overrides.json`:
  [
    {
      "numbering": "card",
      "saveId": 16,
      "name": "<canonical name>",
      "aliases": ["<other witness's name>"],
      "reason": "<why — e.g. 'physical card (2nd printing) says X'>"
    },
    ...
  ]

and `applyOverrides(db, overrides): CardDatabase` that sets `name` (and
recomputes `id` from it) and stores `aliases` on the card. Add
`aliases?: string[]` to the schema's base card in unit 2's file — that's
a schema addition, not a change, and the drift test doesn't exist yet.

TDD, `test/oath/cards/reconcile.test.ts`:
  - unit: two tiny fake witnesses with one swap and one rename produce
    exactly two Discrepancy entries
  - unit: applyOverrides changes name and id, keeps saveId, records
    aliases; recomputed id still passes the schema
  - integration: after applyOverrides on the real data, findDiscrepancies
    returns [] when every remaining difference is covered by an alias.
    Define "covered": for each discrepancy, the TS name must equal either
    the card's name or one of its aliases.
  - every override has a nonempty reason

Start by making the integration test print the current discrepancy list
so I can resolve them. The list I expect to see (card numbering unless
noted): 16, 97, 98, 99, 100, 111, 112, 198–209 (edifice faces), 229, 233;
site numbering: 17, 20. I will fill overrides.json by checking my cards.
Leave the integration test failing and tell me the list; do not guess
canonical names.

Commit (after I fill overrides): "Reconcile card names against physical
printing; record aliases"
```

**Done when.** Zero uncovered discrepancies; every override has a reason.

**Your part.** For each saveId in the list, look at the physical card and put
the printed name in `name`, the other witness's name in `aliases`. If a swap
(16/98, 111/112) means the *Lua index* is wrong rather than the name, the
override still just says "at index 16 the name is X" — the reconciliation
doesn't care why.

---

## Unit 7 — Generator script and drift test

**Purpose.** Write the JSON files to disk, commit them, and make it impossible
for them to silently diverge from the generator.

**Depends on.** Units 4, 5, 6.

```
Unit 7 of Phase 1: emit the data files and guard against drift.

Create `scripts/build-cards.ts` (run with tsx) that:
  1. reads vendor/oathparser/cards.lua
  2. parseCardsLua -> buildDatabase -> applyOverrides(overrides.json)
  3. writes src/oath/cards/data/{denizens,sites,relics,visions,edifices,
     banners}.json, each sorted by saveId, 2-space indent, trailing newline
  4. prints a one-line summary of counts

Add an npm script: "build:cards": "tsx scripts/build-cards.ts".

Extract the read-transform part into an exported function
`generate(): CardDatabase` in `src/oath/cards/generate.ts` so the test
can call it without touching disk; the script is a thin wrapper that
writes the result.

TDD, `test/oath/cards/drift.test.ts`:
  - for each of the six files, JSON.parse(committed file) deep-equals the
    corresponding collection from generate(). If this fails the message
    should say "run npm run build:cards".
  - the committed files, assembled into a CardDatabase, pass the schema

Run the script, commit the generated JSON alongside.

Commit: "Generate card data files; add drift test"
```

**Done when.** Data files exist and are committed; drift test is green.

---

## Unit 8 — Loader and lookup API

**Purpose.** The single import every other module will use. Validated once,
frozen, indexed.

**Depends on.** Unit 7.

```
Unit 8 of Phase 1: the runtime loader.

Create `src/oath/cards/index.ts` that imports the six JSON files
(resolveJsonModule is on), validates them through the schema at module
load (throw loudly on failure — a bad data file should crash at startup,
not mid-game), deep-freezes the result, and exports:

  cards: CardDatabase                        (frozen)
  byId(id: string): Card                     throws on unknown id
  findById(id: string): Card | undefined
  byName(name: string): Card                 matches name OR any alias,
                                             case-insensitive; throws if
                                             none or if ambiguous
  bySaveId(numbering: 'site' | 'card', n: number): Card
                                             for 'card', an edifice's ruin
                                             saveId also resolves to the
                                             edifice entity
  denizensBySuit(suit: Suit): readonly Denizen[]
  edificeBySuit(suit: Suit): EdificeRuin

`Card` is the union of the six kinds. Build the indexes once at load.

TDD, `test/oath/cards/index.test.ts`:
  - byId round-trips every card in every collection
  - byId on 'denizen:nope' throws with the id in the message
  - byName is case-insensitive and resolves an alias (pick one from
    overrides.json dynamically; don't hardcode a name)
  - bySaveId('card', <a ruin saveId>) returns the edifice entity
  - bySaveId('site', n) and bySaveId('card', n) can return different cards
    for the same n
  - denizensBySuit returns only that suit, and the six results partition
    all 198 denizens
  - the exported `cards` object is frozen: assigning throws in strict
    mode (vitest runs ESM, so strict)

Commit: "Add card loader and lookup API"
```

**Done when.** All lookups tested; module is frozen.

---

## Unit 9 — Text overlay

**Purpose.** Let the client render card text without the engine ever depending
on it, and without any test depending on real text.

**Depends on.** Unit 8.

```
Unit 9 of Phase 1: optional card text overlay.

Create `src/oath/cards/text.ts` exporting:

  const TextEntry = z.object({
    text: z.string().min(1),
    powerKind: z.enum(['action','persistent','battle','whenPlayed',
                       'locked','none']).optional(),
    notes: z.string().optional(),
  })
  const TextOverlay = z.record(/* card id */ z.string(), TextEntry)
  loadTextOverlay(path?: string): TextOverlay      default path
                                                  src/oath/cards/data/text.json;
                                                  returns {} if missing
  withText(db: CardDatabase, overlay: TextOverlay): CardDatabase
                                                  attaches text/powerKind
                                                  to matching cards

Schema change: add `text?: string`, `powerKind?: ...`, `notes?: string`
as optional fields on the base card. Regenerate nothing — the generator
never writes text; withText is applied at load in index.ts AFTER
validation and before freezing.

Validation: every key in the overlay must be an existing card id;
loadTextOverlay throws listing the unknown ids.

Do NOT create a real text.json in this unit. Create
`test/fixtures/text.fake.json` with two entries using obviously fake
text ("FAKE TEXT ONE") keyed by real ids read from the data.

TDD, `test/oath/cards/text.test.ts`:
  - missing file -> {}
  - fixture loads and withText attaches text to exactly those two cards
  - an overlay with an unknown id throws and names it
  - cards without an entry have text === undefined
  - the engine-facing exports from unit 8 are unaffected in shape

Also: add src/oath/cards/data/text.json to .gitignore ONLY IF I said
not to commit it (see "Decisions needed"). Default: commit it.

Commit: "Add optional card text overlay"
```

**Done when.** Overlay tests pass with fake data; real `text.json` still empty
or absent.

---

## Unit 10 — Chronicle seed mapping

**Purpose.** The acceptance test for the whole phase: every card the shared
TTS/Vassal seed format can reference maps to one of our ids, and back. This is
not the Chronicle (that's P5); it is proof the identifiers line up.

**Depends on.** Units 1, 8.

```
Unit 10 of Phase 1: prove our ids are seed-compatible.

The vendored vendor/oathparser/parser.ts implements
parseOathTTSSavefileString and serializeOathGame over an OathGame object
whose cards are { name: string } referencing the TS name tables.

Make parser.ts importable from src without pulling vendor/ into the
build output ambiguously: copy it to src/oath/chronicle/vendor/parser.ts
(keep the MIT header; add a comment pointing at PROVENANCE.md and the
commit) together with the enums and name tables it imports. Fix any
strict-mode type errors minimally; do not change behaviour.

Create `src/oath/chronicle/seed.ts` exporting:

  interface SeedCard { id: string; faceDown?: boolean; ruined?: boolean }
  parseSeed(seed: string): {
    version, gameCount, chronicleName, oath, suitOrder: Suit[],
    winner, playerCitizenship, prevPlayerCitizenship,
    sites: { id: string; ruined: boolean; cards: SeedCard[] }[],
    world: SeedCard[], dispossessed: SeedCard[], relics: SeedCard[]
  }
  serializeSeed(parsed): string

Mapping rules:
  - a parser card name resolves via byName (aliases make old names work)
  - suitOrder maps the numeric enum through SUITS from unit 2
  - sites resolve via byName against the site collection
  - an unknown name throws with the name and the position

TDD, `test/oath/chronicle/seed.test.ts`:
  - use the sample seed strings from vendor/oathparser (they're in the
    original test/savefile.ts; copy the two strings into the test file
    with a comment saying where they came from)
  - parseSeed succeeds on both; every card id it returns exists in
    byId; no id appears that isn't in the data
  - serializeSeed(parseSeed(s)) === s for both samples
  - the suit order round-trips through the enum
  - a seed with a corrupted name byte throws with a useful message
    (construct one by parsing, editing one card's name to "FAKE", and
    calling the vendored serializer directly)

Commit: "Map chronicle seeds to card ids; round-trip sample seeds"
```

**Done when.** Both sample seeds round-trip byte-for-byte through our ids.

---

## Unit 11 — Document the module

**Purpose.** Close the phase.

**Depends on.** Everything above.

```
Unit 11 of Phase 1: docs.

Add a "Card data" section to README.md covering: where the data comes
from (vendor + provenance), how to regenerate (npm run build:cards), what
the drift test enforces, the id scheme with three examples, how aliases
work and why (printing differences), the text overlay and the rule that
tests never contain real text, and that seeds round-trip.

Add a short `src/oath/cards/README.md` with the file map.

Update the "Next" section of the root README so P1 is marked done and P2
is described in one paragraph: a real GameDefinition using this data —
turn structure, the six actions, supply and banks, campaign resolution,
with card powers player-declared.

No code changes. Run npm test anyway.

Commit: "Document card data module"
```

---

## Order and dependencies

```
1 vendor ──┐
2 schema ──┼──> 5 build ──> 6 reconcile ──> 7 generate/drift ──> 8 loader ──> 9 text
3 ids ─────┤                                                        │
4 lua ─────┘                                                        └──> 10 seed ──> 11 docs
```

Units 1–4 are independent of each other and could be done in any order.
Unit 6 blocks on you. Everything after 7 is fast.

## Risks

- **The mod data is from ~2020–2022, pre–New Foundations.** Fine for base
  game; NF will need its own extraction from a newer source.
- **Name drift may be larger than the 20 I found**, since the parser's
  tables could themselves be stale. The reconciliation test catches anything
  by index; it cannot catch a card both witnesses name identically but
  wrongly. Your physical cards are the tiebreaker.
- **Vendored parser type errors.** It was written for a looser TS config.
  Budget an hour in unit 10 for `strict` fixes; keep them minimal.
- **Seed samples may not exercise every card.** The round-trip test proves
  the mapping works, not that it covers all 255 indices. Unit 8's byId test
  over every card is what covers the full set.
