# oath-async — P0 skeleton

An async-first, append-only server for playing Oath with a private group.
This is **P0 only**: the plumbing, proven end to end with a throwaway toy
game. There are no Oath rules in here yet.

Private use, among people who own the game. Card text belongs to Buried
Giant Studios — keep this repo private and don't publish assets.

## What P0 proves

```
npm install
npm test          # 10 tests: replay determinism, snapshots, concurrency, hidden info
npm run build
npm run smoke     # 18 checks against a live server, including a hard restart
```

The smoke test kills the server mid-game and brings it back, then asserts
the state is byte-identical. That is the whole point of the phase.

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
    cradle.ts    toy game. DELETE once real rules land.
  db.ts          schema (games, players, setups, actions, snapshots)
  actionlog.ts   append / fold / snapshot / rollback
  routes.ts      HTTP API
  index.ts       server
test/replay.test.ts
scripts/smoke.mjs
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
| `POST` | `/api/games` | `{kind, players: string[]}` → gameId + one token per seat |
| `GET` | `/api/games/:id` | redacted view, current `seq`, pending decisions |
| `POST` | `/api/games/:id/actions` | `{prevSeq, type, payload}` → 201, or 409 if stale |
| `GET` | `/api/inbox` | what this token's player is on the clock for |
| `GET` | `/api/games/:id/history` | full action log |
| `POST` | `/api/games/:id/rollback` | `{toSeq}` — truncate the log. **Gate this.** |

Rollback is the dispute-resolution mechanism. With a full log and a
friendly group, "wait, back up" is a rewind button rather than an argument
about rules — which is why the engine doesn't need to adjudicate card
powers to be trustworthy.

## Deploying

```
fly volumes create data --size 1 --region ewr
fly deploy
```

Keep it at one machine. SQLite has a single writer, and the concurrency
check assumes one process owns the file.

## Next

- **P1** — card data. Denizens, sites, relics, visions as structured TS,
  sourced from `Vagabottos/OathParser` rather than transcribed by hand.
- **P2** — core loop as a real `GameDefinition`: turn structure, the six
  actions, supply and banks, campaign resolution. Card powers stay
  player-declared: the action records "used X, spent 2 favor, moved these
  warbands" and applies the stated deltas without knowing what X does.
- **P3** — interrupts. Batched defender prompts, standing pre-commitments.
  The hardest design work in the project.
