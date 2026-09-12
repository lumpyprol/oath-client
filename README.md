# oath-async

An async-first, append-only server for playing Oath with a private group.
**P0** (the plumbing), **P1** (the card database) and **P2** (the rules
engine) are done: you can create a game from a chronicle seed and play it
through to a win over the HTTP API.

Private use, among people who own the game. Card text belongs to Buried
Giant Studios — keep this repo private and don't publish assets.

## Running it

```
npm install
npm test          # ~600 tests: the engine, the rules, the card data
npm run typecheck # src + test + scripts (build compiles only src)
npm run build
npm run smoke     # 23 checks against a live server, including a hard restart
```

The smoke test kills the server mid-game and brings it back, then asserts
the state is byte-identical. That was the whole point of P0, and it now
runs against a real Oath game rather than a toy.

## Vocabulary

Log entries are **actions** — things a player did. "Chronicle" is reserved
for cross-game history, since that is what Oath calls it. There is no such
thing as an "event" in this codebase.

## The four decisions, and where they live

**1. Reducers are pure; randomness is decided once and persisted.**
Nothing random happens inside `reduce`, because `reduce` runs again on
every replay. Randomness happens in exactly two places:

- `setup()` shuffles the deck once at creation. The resulting order is
  stored verbatim in the `setups` table, which is never served over the
  API. Drawing is then just `pop()` — fully deterministic.
- `prepare()` rolls dice at append time and folds the results into the
  payload before it is written. Dice are public information anyway, so
  the log stays readable: you can see the campaign that went badly
  without running any code.

`prepare` exists so the storage layer never needs to know which action
types involve dice — that stays in the rules module.

**2. Actions carry the expected sequence number.** `appendAction` takes a
`prevSeq` and rejects with 409 if the game has moved on. In async play two
people acting on stale state is routine, not exceptional — the client
refetches and retries. The reducer runs *inside* the transaction, so an
illegal action rolls back and never lands in the log.

**3. Per-player views are computed server-side.** `project(state, seat)`
redacts. Hidden state never leaves the process, so the deck order and other
players' hands aren't sitting in a payload waiting to be read in devtools.

**4. Pending decisions are first-class.** `pending(state)` returns
everything the game is waiting on, keyed by seat, with stable ids so
notifications can be deduplicated. `GET /api/inbox` is what a Discord
worker polls and what a deep link resolves against. In an async game this
is the feature that determines whether you finish.

## Layout

```
src/
  engine/
    types.ts     GameDefinition contract, action shape, error types
    random.ts    one-shot crypto randomness. setup() and prepare() only.
  oath/
    cards/       the P1 card database (see src/oath/cards/README.md)
    chronicle/   seed parsing / serialization (parseSeed, serializeSeed)
    game/        the P2 rules engine (see src/oath/game/README.md)
    powers/      registry for engine-enforced card powers. Empty; that's v2.
  db.ts          schema (games, players, setups, actions, snapshots)
  actionlog.ts   append / fold / snapshot / rollback
  routes.ts      HTTP API
  index.ts       server
vendor/oathparser/   upstream card data, pinned + hash-checked
test/
scripts/smoke.mjs
RULINGS.md           every place the Law was ambiguous and we chose
RULES-COVERAGE.md    every section of the Law, implemented or deferred
```

State is `setups` plus a fold over `actions`. Setup is written once and
never mutated; actions are append-only and truncated only by rollback.
`snapshots` is a pure cache — `DELETE FROM snapshots` at any time and
everything rebuilds. There's a test for exactly that.

Persistence uses Node's built-in `node:sqlite`, so there is no native
module and no build toolchain in the runtime image. On Node 22 it needs
`--experimental-sqlite`, which the npm scripts and Dockerfile set for you.

## API

Auth is a per-player token, returned once at game creation, sent as
`x-player-token`. Adequate for a friend group; replace before this is
reachable by anyone else.

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/api/games` | `{kind, players: string[], options?}` → gameId + one token per seat |
| `GET` | `/api/games/:id` | redacted view, current `seq`, pending decisions |
| `POST` | `/api/games/:id/actions` | `{prevSeq, type, payload}` → 201, or 409 if stale |
| `GET` | `/api/inbox` | what this token's player is on the clock for |
| `GET` | `/api/games/:id/history` | full action log |
| `POST` | `/api/games/:id/rollback` | `{toSeq}` — truncate the log. **Gate this.** |

`options` is opaque to the store and handed straight to the game's
`setup()` (HLD D31). For Oath it carries the chronicle seed:
`{"kind":"oath","players":["Chancellor","Red","Blue"],"options":{"seed":"0303..."}}`.
Oath refuses a seatless first game, so a real game always names one.

Rollback is the dispute-resolution mechanism. With a full log and a
friendly group, "wait, back up" is a rewind button rather than an argument
about rules — which is why the engine doesn't need to adjudicate card
powers to be trustworthy.

## Game engine

`src/oath/game/` implements base Oath as a `GameDefinition` — turn
structure, the six major actions, minor actions, campaigns, Citizenship,
the Wake phase, titles, and all four win conditions. It plays from a
chronicle seed to a finished game; `test/oath/game/fullgame.test.ts` does
exactly that over real HTTP.

**The engine does not know what cards do.** Card powers are *declared*:
`power.use` names the card and the deltas it produces, and the engine
checks only that you have access to that power (Law §7.1.1) and that the
deltas are feasible. It never reads card text. Oath's ~230 cards are the
entire difficulty of the game; an engine that adjudicated them would be a
five-year project that is wrong in a hundred places, while one that
adjudicates *structure* and lets a trusted group declare card effects is
usable now and wrong nowhere. `src/oath/powers/registry.ts` is the upgrade
path — a registered implementation replaces the declaration for that card,
one card at a time, with no change to the rest.

The corollary matters more than the rule: **a power a player can declare is
not a deferral**. If a declaration can reach a state, that state has to be
legal and conserved, and "the engine can't do that yet" is a bug rather
than a note. That is how unit 20 found §10.5 — a declared power could put a
secret on an adviser that could then never be discarded.

**Rules are cited.** `Law §x.y` refers to <https://rules.buriedgiant.com>,
product `oath`, printing `p1`. Two documents keep it honest:

- `RULINGS.md` — every place the Law is genuinely ambiguous, the reading we
  took, and why.
- `RULES-COVERAGE.md` — every numbered subsection of §1–§11, dispositioned
  as implemented (naming the file and function), deferred (naming where
  it's recorded **and** where it will be done), or N/A. "v2" alone is not
  a home: a deferral names a unit, a phase, or a question.

**Hidden information is enforced server-side**, in `project(state, seat)`.
`test/oath/game/audit.test.ts` replays a full recorded game and re-audits
every seat's view plus a spectator's after every action, sweeping the whole
projection for anything shaped like a card id rather than checking fields
someone remembered to list.

## Card data

Everything from P2 on depends on the card database in `src/oath/cards/`: every
denizen, site, relic, vision, edifice/ruin, and banner in base Oath, with
stable ids, suits, and the structural facts the engine and the chronicle need.
It is engine-agnostic — if the server were deleted tomorrow this data would
still be worth having. See `src/oath/cards/README.md` for the file map.

**Source and provenance.** The structural facts come from
`Vagabottos/OathParser` (the official TTS mod's card table), vendored verbatim
into `vendor/oathparser/` and pinned to one commit. `vendor/oathparser/PROVENANCE.md`
records the commit, dates, and a sha256 per file; a test recomputes and checks
them, so upstream can't drift silently.

**Regenerating.** `npm run build:cards` runs the pipeline — parse `cards.lua`,
build the typed database, apply name overrides — and writes the six
`src/oath/cards/data/*.json` files (sorted by `saveId`). The generated JSON is
committed; the script is provenance, not a runtime step. `drift.test.ts`
regenerates in memory and fails if any committed file differs, or if the
assembled files don't pass the schema — the fix it names is `npm run build:cards`.

**Ids** are namespaced slugs derived deterministically from the printed name:
`denizen:sneak-attack`, `site:drowned-city`, `relic:brass-horse`. Readable in
the action log, collision-proof across kinds. `saveId` is kept as an attribute
for seed interop but is never an identifier in our own code.

**Aliases.** The mod's table and the parser's name tables disagree on ~12
cards — printing renames (this repo takes the 2nd-printing name as canonical)
and two index-swap pairs. Each is resolved by hand in
`src/oath/cards/data/overrides.json` with a stated reason; the other name is
kept as an alias. `byName()` matches the printed name **or any alias**,
case-insensitive, so a seed from either printing still resolves.

**Text overlay.** Card text is optional and lives apart from the structural
data, in `src/oath/cards/data/text.json` (`{ cardId: { text, powerKind?, notes? } }`),
merged at load by `withText`. The engine never reads it; only the client does.
No real `text.json` is committed yet, and **no test contains real card text** —
fixtures use obviously fake strings like `"FAKE TEXT ONE"`.

**Seed interop.** `src/oath/chronicle/seed.ts` (`parseSeed` / `serializeSeed`)
maps the shared TTS/Vassal seed format to our ids and back. It resolves each
card by its `saveId` byte, so the index swaps and edifice ruin faces line up;
the two sample seeds round-trip byte for byte.

**Art manifest.** `src/oath/cards/data/art.json` maps every card face and every
site to an asset filename — one key per denizen/site/relic/vision, two per
edifice/ruin (`…#ruin`), one per banner face (`…#1`). Regenerate with
`npm run build:art`; the drift test guards it. The image files themselves stay
out of git (token-gated) and live in `ART_DIR` — `./assets/art` locally
(gitignored), a path on the Fly volume beside `games.db` in production. Sources:
per-card faces from cards.buriedgiant.com, frames/backs/symbol font from the
official Oath Development Kit, map/boards from the Vassal module (see the
addendum for links). `missingArt` catches a face with no manifest entry;
`missingAssets` catches a manifest entry with no file. The against-real-assets
test is skipped unless `ART_DIR` exists, so a fresh checkout stays green.

## Deploying

```
fly volumes create data --size 1 --region ewr
fly deploy
```

Keep it at one machine. SQLite has a single writer, and the concurrency
check assumes one process owns the file.

## Next

- **P1** — card data. ✅ Done. The card database under `src/oath/cards/`,
  sourced from `Vagabottos/OathParser` rather than transcribed by hand,
  validated by zod, with name reconciliation, a text overlay, and seed
  interop. See "Card data" above.
- **P2** — the core loop as a real `GameDefinition`. ✅ Done. Turn
  structure, the six major actions, minor actions, campaigns with allies
  and casualties, Citizenship, the Wake phase, titles, and all four win
  conditions, playable from a chronicle seed to a win. Card powers stay
  player-declared. See "Game engine" above and `src/oath/game/README.md`.
- **P3** — interrupts. Batched defender prompts, standing pre-commitments.
  The hardest design work in the project. Also picks up the two setup
  choices P2 defaulted (§1.23.1 each player's starting site, §1.23.2 the
  choice of starting adviser) and §5.5.3's Citizen-ally battle window.
- **P4** — the Peek family (§6.3/§6.4), which needs persistent per-seat
  memory and a projection that can reveal to one seat only.
- **P5** — writing the chronicle (§8): vowing an Oath, building edifices,
  rebuilding the world deck, and saving the boards back out to a seed.
