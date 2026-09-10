# oath-async — High-Level Design

**Status:** living document. Update the tracking section at the end of every
unit of work; update the decision log whenever a decision is made or reversed.

| Field | Value |
| --- | --- |
| Started | 2026-09-07 |
| Last updated | 2026-09-10 |
| Current phase | P2 (in progress, units 1–9 done) |
| Owner | Ben |

---

## 1. Purpose

A private, async-first server for playing *Oath: Chronicles of Empire and
Exile* with a fixed group of friends over weeks and months. Games are taken one
turn at a time, mostly from a tablet or laptop. The Chronicle — Oath's persistence of one game's
outcome into the next — is a first-class feature, not an afterthought.

This is not a product. It is for a handful of people who own the game.

### Goals

- A group of 2–6 can finish a game of Oath asynchronously, taking turns from
  tablets and laptops, without the game dying of "whose turn is it."
- Chronicles persist across games and interoperate with the existing
  TTS/Vassal seed format, so campaigns can move between platforms.
- Any player can rewind the game to any prior point. Disputes are resolved by
  rollback, not by argument.
- The server runs unattended on cheap infrastructure and survives restarts
  and redeploys without losing anything.
- Card powers are player-declared in v1, but **nothing in the design impedes
  enforcing them later**, card by card. Declared and enforced powers share
  one representation, so enforcement is an addition, never a rewrite.
- **Card art and board art are included.** Cards, sites, and the table render
  with the real artwork, sourced from the group's own copies and kept private.

### Non-goals

- Enforcing card powers *in v1*. The engine enforces structure (turn order,
  action legality, resource arithmetic, dice); players declare what cards do.
  See §4 for how this stays open.
- Matchmaking, accounts, rankings, public access, or anyone outside the group.
- Rules for the solo Clockwork Prince.
- New Foundations, in v1. The data model reserves room for it.
- Real-time play. If the group is on a call together they can still use it,
  but nothing is optimised for that.

### Why not BGA or TTS

Investigated and rejected before P0:

- **TTS:** an official scripted mod already exists (AgentElrond, sponsored by
  Leder). Building another is redundant; the module is also synchronous by
  nature.
- **BGA:** requires a publisher license. Oath's IP moved to Buried Giant
  Studios in January 2026, and Dire Wolf holds digital rights to Root and Arcs
  with Arcs Digital in progress. BGA's own FAQ says publishers refuse or
  remove games when they have their own adaptation. Even with a license, BGA
  demands full rules enforcement — the multi-year part.

---

## 2. Constraints

- **Legal.** Rules and mechanics are not copyrightable; card text and art are.
  Text and art stay private, among people who own the game. Art is never
  committed to a public location and never served without a player token.
- **Hidden information at rest.** Async means state lives on disk while
  players are away. Hands and deck order must not be readable by players.
- **Interrupts.** Oath's campaign resolution and reactive powers create
  multi-round-trip decisions between two players. Unmitigated, this makes a
  six-player async game take months of wall clock.
- **Single writer.** SQLite. One server process, one machine, ever.
- **Tablet and laptop are the primary surfaces.** Most turns will be taken
  on a tablet or laptop with a full view of the table. Phones are secondary:
  they should be able to show the decision inbox and take simple decisions,
  but the board is not designed for them.
- **One maintainer.** Everything should be understandable in one sitting a
  year from now.

---

## 3. System overview

```
                     ┌──────────────────────────────────────────────┐
                     │  Server (Node 22 / TypeScript, one process)  │
                     │                                              │
  tablet ──HTTPS──▶  │  routes ──▶ actionlog ──▶ GameDefinition     │
   (client, P4)      │               │   ▲            (oath, P2/3)  │
                     │               ▼   │                          │
                     │           node:sqlite ◀── cards data (P1)    │
                     │         setups · actions ·                   │
                     │         snapshots · players                  │
                     │               │                              │
                     │           notifier (P6) ──▶ Discord webhook  │
                     │               │                              │
                     │           chronicle (P5) ◀─▶ seed string     │
                     └──────────────────────────────────────────────┘
                              Fly.io or VPS, one machine, one volume
```

### Components

| Component | Phase | Responsibility |
| --- | --- | --- |
| `actionlog` | P0 | Append-only log, fold, snapshots, rollback, optimistic concurrency |
| `engine/types` | P0 | `GameDefinition` contract every rules module implements |
| `oath/cards` | P1 | Validated card database, ids, aliases, text overlay |
| `oath/game` | P2 | The `GameDefinition` for Oath: state, actions, reducer, projection |
| `oath/interrupts` | P3 | Pending-decision design: batching, standing responses |
| `client` | P4 | Web UI for tablet/laptop: board, hand, decision inbox; inbox usable on phone |
| `oath/chronicle` | P5 | Chronicle phase, seed import/export, lineage |
| `notifier` | P6 | Discord webhook, deep links, stalled-turn nudges |

---

## 4. Core principles

These hold across every phase. Each is recorded in the decision log with its
rationale; this section is the summary.

**Reducers are pure.** `reduce(state, action)` returns the same result every
time. It runs once when an action is submitted and again on every replay —
after a restart, from a snapshot, after a rollback. Anything that could differ
between runs is decided once and persisted before the reducer sees it.

**Randomness is decided once and stored.** The shuffle happens in `setup()`
at creation and is stored in a table that is never served. Dice roll in
`prepare()` at append time and the results go into the action payload. Draws
are then `pop()`. There is no PRNG anywhere.

**The action log is safe to share.** It contains only what players did plus
dice results everyone saw. Hidden information (deck order, hands) is derived
state, never logged. This is what makes rollback comfortable and history
readable.

**Actions carry the expected sequence number.** Two players acting on stale
state is routine in async play. A `prevSeq` mismatch is a 409 and a retry,
never corruption.

**Views are projected server-side.** `project(state, seat)` redacts. Hidden
information is enforced in the process, not in CSS.

**Pending decisions are first-class.** `pending(state)` returns everything the
game is waiting on, keyed by seat, with stable ids. This drives the inbox,
notifications, and deep links. It is the feature that decides whether games
finish.

**Card powers are declared by default, enforceable per card.** The engine
knows a card's identity, suit, and type; in v1 it does not know what the card
does. A `power.use` action names the card and carries a structured list of
*effects* — favor spent, warbands moved, cards drawn — which the engine applies
and (cheaply) checks for feasibility. Later, a per-card implementation can be
registered against the card's id: it takes the same state and produces the
same effects list, and the player's declaration is replaced or validated by
it. The action shape, the log, and the reducer do not change when a card
becomes enforced. This is what keeps the two-year phase out of v1 without
closing the door on it.

**Rollback is the rules engine.** With a full log and a friendly group, a
disputed declaration is a rewind, not an adjudication. Any player can roll
back; the log shows who did what.

**Vocabulary.** Log entries are *actions*. *Chronicle* is reserved for
cross-game history because that is what Oath calls it. The word *event* does
not appear in the codebase — Oath has no events, and the software sense
collides with game vocabulary.

---

## 5. Data model

### Tables

| Table | Purpose | Mutability |
| --- | --- | --- |
| `games` | id, kind, seats, created_at, complete | complete flag only |
| `players` | seat, name, token (per-player secret) | write-once |
| `setups` | opening position incl. deck order; **never served** | write-once |
| `actions` | append-only log; sole source of truth with `setups` | append; truncated only by rollback |
| `snapshots` | fold cache | disposable; `DELETE FROM` is always safe |

### Action shape

```ts
{ gameId, seq, type, actor: seat | null, payload, createdAt }
```

`seq` 0 is always `game.created`. `payload` is whatever `prepare()` returned.

### Effects (P2)

The shared currency between declared and enforced powers. An effect is a
small tagged object the reducer knows how to apply: `spend-favor`,
`gain-secret`, `move-warbands`, `draw`, `discard`, `move-card`, `flip-face`,
and so on. A `power.use` action carries `effects: Effect[]`. In v1 the player
composes them in the client; an enforced card produces them in code. The
vocabulary of effects is designed in P2 and grows only when a card needs it.

### Art (P1, P4)

`src/oath/cards/data/art.json` maps card id (and each face for edifice/ruin
and banners) to an asset filename. Assets themselves live outside git (see
Q8); the manifest is committed so a missing asset is a test failure, not a
broken image at play time.

### Card ids (P1)

Namespaced slugs: `denizen:wrestlers`, `site:mine`, `relic:brass-horse`,
`edifice:sprawling-rampart`, `banner:peoples-favor`, `vision:dynasty`.
Readable in the log; collision-proof across kinds. `saveId` is an attribute
kept for seed interop, never used as an identifier internally.

### Game state (P2 — as built in unit 1, `src/oath/game/state.ts`)

The pre-P2 sketch survived, with rulebook-derived additions found while
transcribing the Law of Oath (citations in the file; see `RULINGS.md` for
the edition):

- Sites in play order with denizen/edifice slots (fixed length = the site
  card's capacity), facedown flag, relics, per-seat warbands, and favor/
  secret tokens sitting *on the site* (reveal prompts, Law §2.8.2).
- Tokens also sit *on cards in play* — Muster/Trade place favor/secrets on
  denizens; Rest and discard return them — so every in-play card entry
  carries favor/secret counts.
- Per seat: a **transient** hand (Oath has no persistent hand — it exists
  only mid-Search), advisers (limit 3, facedown allowed, Visions included),
  revealed vision, favor, secrets split ready/flipped (spent secrets flip
  facedown until Rest), warbands split bank/board (personal-bank reserve vs
  the force that travels with the pawn), supply, relics.
- The Chancellor/Exile/Citizen structure (seat 0 is the Chancellor by
  convention); oath type, oathkeeper seat, and the title's Usurper side.
- Banner placards as first-class state: holder, favor/secret stake, and the
  People's Favor Mob side.
- The Imperial Reliquary (4 facedown relics) and the Grand Scepter holder —
  the Scepter is not in the P1 card database, so only its holder is tracked.
- World deck, relic deck, dispossessed as ordered id lists; **one discard
  pile per region** (Law §2.1.2), not a single pile.
- Round and Visions Drawn track counters; turn bookkeeping; `actionCount`
  for pending-decision ids; campaign placeholder (unit 12).

Conservation laws enforced by `checkInvariants`: favor totals 36 across all
zones (Law §1.4 — burns return tokens to the shared bank); warbands total 24
purple pooled across Chancellor + Citizens and 14 per exile color (Law §1.8,
§1.9, §1.15). **Secrets are deliberately not conserved:** Law §9.3 exempts
secrets (and dice) from component limits (see D36).

---

## 6. Phases

Status values: `not started` · `planned` (prompt plan exists) · `in progress`
· `done` · `deferred`.

---

### P0 — Skeleton — `done`

**Goal.** A deployed server that survives a restart, with the append/fold/
rollback machinery proven end to end on a toy game.

**Delivered.** `actionlog.ts`, `engine/types.ts`, `engine/random.ts`, the
`cradle` toy game, HTTP API (`/api/games`, `/actions`, `/inbox`, `/history`,
`/rollback`), 10 unit tests, 18-check smoke script including a hard restart,
Dockerfile, `fly.toml`.

**Decisions made.** D4–D14 in the log.

**Exit criteria.**
- [x] `npm test` green
- [x] smoke script kills the server mid-game and state is byte-identical after
- [x] hidden information never appears in the action log or in another seat's view
- [x] stale `prevSeq` rejected with 409; illegal action never persisted
- [x] deployed to Fly and a turn taken from a tablet or laptop *(done 09-10: `oath-async.fly.dev`, `cradle` game `73b1a40a-...`, `draw` action taken from a real device, seq 0→1)*

---

### P1 — Card data — `done`

**Goal.** Every card in base Oath as validated JSON with stable ids, sourced
from the official mod's data via `Vagabottos/OathParser`, reconciled against
physical cards, and proven seed-compatible.

**Prompt plan.** `prompt_plan_phase_1.md` — 11 TDD units, plus
`prompt_plan_phase_1_addendum.md` adding unit 12 (art manifest) on 09-08.

**Delivered (09-08).** All 12 units. The card database lives at
`src/oath/cards/` (198 denizens, 23 sites, 20 relics, 5 visions, 6
edifice/ruin, 2 banners), generated from the vendored mod data and
drift-guarded, with hand-reconciled names (12 overrides, old names kept as
aliases), a frozen loader, an optional text overlay, an art manifest (261
keys), and byte-exact chronicle seed interop at `src/oath/chronicle/`.
112 tests pass; 1 intentionally skipped (`skipIf` on the art-asset
presence check — filling `ART_DIR` is P4 work, so the manifest criterion
below is ticked with that caveat). Deferred to P4: placing and
normalising the actual image files.

**Scope.**
- Vendor OathParser at a pinned commit with provenance and hash test
- zod schema for Denizen, Site, Relic, Vision, EdificeRuin, Banner
- Deterministic id derivation from names
- Line parser for the mod's Lua card table
- Build + generator script + drift test (committed JSON must equal output)
- Name reconciliation: ~20 discrepancies between upstream witnesses,
  resolved by hand against physical cards, old names kept as aliases
- Frozen loader with `byId`, `byName`, `bySaveId`, `denizensBySuit`
- Optional text overlay; tests never contain real text
- Chronicle seed parse/serialize round-trip on sample seeds
- Art manifest: id → asset filename for every card face and site, with a
  test that flags missing assets when the asset directory is present

**Decisions made.** D15–D21, D27.

**Decisions resolved during the phase.**
- Ben owns a 2nd-printing-or-later copy; newer names are canonical, 2020
  TTS-mod names are aliases (unit 6; resolves Q1)
- `powerKind` on the text overlay: fill if convenient, decide for real in
  P4 (Q3 moved to P4)
- `text.json` is committed when it exists (Q4, default stood)

**Exit criteria.**
- [x] 198 denizens, 23 sites, 20 relics, 5 visions, 6 edifices, 2 banners
- [x] zero unresolved name discrepancies; every override has a reason
- [x] drift test green; data regenerable with one command
- [x] both sample seeds round-trip byte-for-byte through our ids
- [x] no real card text in any test
- [x] art manifest covers every card face and site; asset presence test is
      `skipIf(!ART_DIR)` and stays skipped until assets are placed (P4)

---

### P2 — Core loop — `in progress`

**Goal.** A real `GameDefinition` for Oath. A full game is playable start to
finish with the six actions enforced and card powers player-declared. This is
the feasibility milestone: if the state machine is painful here, stop.

**Prompt plan.** `prompt_plan_phase_2.md` — 20 TDD units. Campaign design
(units 12–13) is the explicit feasibility gate.

**Scope.**
- State shape (see §5) and `setup()` per the rulebook's setup procedure,
  including chronicle-seeded setup when a seed is supplied
- Turn structure: supply reset, action phase, end-of-turn checks
- The six actions with supply costs and site/adjacency rules: Muster, Trade,
  Travel, Search, Recover, Campaign
- Playing cards from hand: as adviser or to a site, slot limits, discards
- Favor and secret banks per suit; warband supply per seat
- Campaign resolution: warband commitment, dice via `prepare()`, results,
  casualties, sacrifice, defender choices (interrupt design deferred to P3;
  P2 may resolve defender decisions naively as a pending decision)
- Oathkeeper and succession checks; Vision victory checks; game end
- Citizenship: Chancellor, Exiles, Citizens; becoming a Citizen
- `power.use` action: names a card and carries `effects: Effect[]` (see §5).
  The reducer applies each effect and checks feasibility (enough favor,
  warbands present, card where claimed). It does not check that the effects
  match the card's text — that is the player's job in v1
- `oath/powers/` registry keyed by card id, **empty in v1**, with the
  interface an enforced card will implement: `(state, seat, choices) =>
  Effect[]`. Its existence is the proof that enforcement is not impeded;
  one card should be implemented in a test to exercise the seam
- `project()` redacting hands, advisers face-down, deck order
- `pending()` for turn and for every blocking decision
- Delete `cradle`

**Decisions made at planning (09-08, see D30–D35).**
- Setup is seed-shaped; the first game is a built-in constant spec; the
  engine contract gains `setup(seats, options?)` (D30, D31)
- State is plain TS types + `checkInvariants`; no runtime schema on the
  fold path (D32)
- Effect vocabulary starts minimal, grows only when an action or power
  needs it; additions are additive (D33)
- Enforced cards *replace* the declaration (produce the effects; the
  client stops asking); relic/banner powers use the same `power.use`
  shape (D34)
- The structural endgame — oathkeeper, succession, visions, citizenship
  transitions, game end — is enforced, not declared (D35)
- Rulings are recorded in `RULINGS.md` with date and rulebook ref

**Decisions made in flight (09-09, unit 1).**
- Rulebook edition (Q5): the Buried Giant rules library, Oath printing p1
  (Ben's call) — numbering identical to the Law of Oath, Oct 20 2020.
  Citations are `Law §x.y`; details in `RULINGS.md`
- Secrets have no conservation invariant — Law §9.3 exempts them from
  component limits (D36); favor and warbands are the conserved currencies
- State grew rulebook-derived fields beyond the §5 sketch (tokens on cards
  and sites, ready/flipped secrets, bank/board warbands, per-region
  discards, Reliquary, Grand Scepter holder, banner stakes) — see §5

**Decisions still open.**
- The campaign action sequence — designed in unit 12, the hardest call
  in the phase

**Exit criteria.**
- [ ] a 3-player game plays to completion through the API with powers declared
- [ ] every action has reducer tests for legal, illegal-actor, illegal-state
- [ ] `power.use` rejects infeasible effects (spending favor you lack, moving
      warbands that aren't there)
- [ ] one card is enforced through the registry in a test, producing the same
      log shape as a declaration
- [ ] campaign dice come from `prepare()` and survive snapshot wipe + replay
- [ ] hidden information audit: fuzz `project()` for every seat over a
      played game; no other seat's hand or deck order leaks
- [ ] `cradle` deleted

---

### P3 — Interrupts — `not started`

**Goal.** Make multi-party decisions survivable asynchronously. This is the
hardest design work in the project.

**Scope.**
- Catalogue every point where a non-active player must decide something
  (defender choices in campaign, reactive powers, Chancellor decisions,
  trades, gifts, sacrifice, secret reveals)
- **Batched prompts:** a single pending decision bundles every choice a
  player must make before the action can continue, so one round trip
  resolves it
- **Standing responses:** players pre-commit defaults ("auto-defend with all
  warbands at my sites", "auto-pass unless the site is X") stored as their
  own actions so they are logged and rewindable
- **Timeouts as nudges, not auto-resolution.** Stalled decisions trigger
  notifications (P6), never automatic choices — Oath decisions are too
  consequential
- Deep-linkable decision ids: every pending decision resolves to a URL the
  client can open directly

**Decisions to make in P3.**
- Whether standing responses can be conditional (per site, per opponent) or
  only global — start global
- Whether a player can revoke a standing response mid-campaign
- How declared powers with a reactive window are surfaced: probably as a
  "anyone want to declare a reaction?" batched prompt with a pass default

**Exit criteria.**
- [ ] a campaign against a defender who has a standing response resolves in
      one round trip
- [ ] every interrupt in the catalogue maps to a pending decision with a
      stable id
- [ ] standing responses are actions in the log and roll back cleanly
- [ ] a simulated 6-player game's round-trip count per turn is measured and
      recorded here

---

### P4 — Client — `not started`

**Goal.** A web client for tablets and laptops that renders the full table
from a projected view, shows the decision inbox, and submits actions with
`prevSeq`. The inbox and simple decisions also work on a phone.

**Scope.**
- Board: sites in play with denizens, relics, warbands; hand; advisers;
  banks; supply; oath and oathkeeper; visions held
- Decision inbox as the landing view: what is waiting on *me*
- Action composer per action type, including the declared-power form
- Conflict handling: 409 refetches and re-presents
- History view with rollback (gated to players in the game)
- Cards and sites render with real art from the P1 manifest; card text
  overlay available as a tap-through for legibility on small screens
- Board art: the table layout, site backgrounds, banks, and player areas
  styled after the physical game
- Assets served only to requests carrying a valid player token
- Designed for landscape tablet (~1024px) and laptop; art sized for those,
  with smaller variants for the phone inbox view
- On a phone (~380px): the inbox, simple yes/no and pick-one decisions, and
  a read-only board. Composing a full turn on a phone is not a target

**Decisions to make in P4.**
- Framework: plain server-rendered + small JS, or a React SPA. Leaning
  small: this is one maintainer and a fixed audience
- Image pipeline: source resolution, output sizes, format (WebP/AVIF), and
  whether resizing happens at build time or on first request
- Transport: poll `/inbox` on focus vs SSE. Start with poll-on-focus; async
  play doesn't need live updates
- Where the client is served from: same process (simplest) vs static hosting
- Auth upgrade: keep per-player tokens or move to magic links

**Exit criteria.**
- [ ] a full game playable from a tablet and from a laptop
- [ ] on a phone, the inbox loads and a pending yes/no decision can be answered
- [ ] a stale-state conflict is handled without the user seeing an error page
- [ ] decision deep link opens the right prompt with one tap
- [ ] every card and site shows its art; an unauthenticated asset request is
      refused

---

### P5 — Chronicle — `not started`

**Goal.** One game's ending becomes the next game's setup, and campaigns move
between this server and TTS/Vassal.

**Scope.**
- Chronicle phase per the rulebook: winner's oath and citizenship changes,
  edifice building and ruin flips, world deck rebuilding from sites,
  dispossessed and archive handling, relic redistribution
- Chronicle as a pure function: game-end state in, next setup out — testable
  with no server
- Seed export to the TTS/Vassal string (P1 proved the mapping; P5 uses it)
- Seed import as a game-creation option
- Lineage: a browsable history of the chronicle's games, winners, oaths
- Since state lives in `setups`/`actions`, a chronicle is a chain of games;
  store the parent game id on `games`

**Decisions to make in P5.**
- Which chronicle steps are randomised and how they use `setup()`
- Whether edifice/ruin choices are winner-declared or enforced
- Storage of chronicle metadata: separate table vs derived from the chain

**Exit criteria.**
- [ ] a completed game produces a valid next-game setup
- [ ] export → TTS mod → import round-trips a real campaign
- [ ] lineage view shows every game in the chain

---

### P6 — Notifications and polish — `not started`

**Goal.** The game finishes because people know it is their turn.

**Scope.**
- Discord webhook per game: post on every new pending decision, with a deep
  link; dedupe by decision id
- Stalled-decision nudges (configurable, default ~48h), escalating gently
- Per-player mute / digest preference
- Operational: backups of the SQLite file, health check, simple admin page
  for rollback and game creation
- Whatever P2–P5 deferred as "later"

**Decisions to make in P6.**
- Webhook only vs a bot that can accept simple actions from Discord
  (leaning webhook only; the client is the place to act)
- Backup target (Fly volume snapshot vs `litestream` vs nightly copy)

**Exit criteria.**
- [ ] every new pending decision produces exactly one Discord post with a
      working deep link
- [ ] a stalled decision produces a nudge and is logged as such
- [ ] backups exist and a restore has been rehearsed once

---

## 7. Decision log

Format: id, decision, rationale, status. Reversed decisions stay in the log
with `reversed by`.

| ID | Date | Decision | Rationale | Status |
| --- | --- | --- | --- | --- |
| D1 | 09-07 | Build a private server rather than a BGA or TTS module | Official TTS mod exists; BGA needs a license Buried Giant is unlikely to grant given Dire Wolf's digital rights | active |
| D2 | 09-07 | Async-first | Oath campaigns want to unfold over months; the group can't sync schedules | active |
| D3 | 09-07 | Always-on server with public URL and per-player tokens; no Tailscale | Players act from their own devices wherever they are; tokens adequate for a friend group | active |
| D4 | 09-07 | Node 22 + TypeScript, single process, SQLite | OathParser ecosystem is TS; write volume is a few actions a day; one file to back up | active |
| D5 | 09-07 | Reducers are pure; randomness decided once and persisted | Reducers replay; divergence would silently corrupt state | active |
| D6 | 09-07 | Optimistic concurrency via `prevSeq`, 409 on mismatch | Stale submissions are routine in async play | active |
| D7 | 09-07 | Per-seat views projected server-side | Hidden info must not leave the process | active |
| D8 | 09-07 | Pending decisions are first-class with stable ids; `/inbox` endpoint | Drives notifications and deep links; the finish-rate feature | active |
| D9 | 09-07 | Card powers are player-declared; engine enforces structure only | Removes ~200 bespoke implementations; rollback covers mistakes | **amended by D28** |
| D10 | 09-07 | Rollback is the dispute-resolution mechanism | Friendly group + full log; cheaper and more trustworthy than a rules engine | active |
| D11 | 09-07 | Per-action `rngSeed` with a seeded PRNG in the reducer | Replay exactness | **reversed by D13, D14** |
| D12 | 09-07 | Log entries are *actions*; *chronicle* reserved; no *events* | Oath has no events; avoid vocabulary collision | active |
| D13 | 09-07 | Shuffle once in `setup()`; store the order in a never-served `setups` table | A seed is only obfuscation — the shuffle function is in the repo; keep the order out of the log instead | active |
| D14 | 09-07 | Dice roll in `prepare()` at append time; results in the payload | Dice are public; log stays human-readable; `prepare` keeps rules knowledge out of the store | active |
| D15 | 09-07 | `node:sqlite` instead of `better-sqlite3` | No native build in the image; `--experimental-sqlite` on Node 22 is the cost | active |
| D16 | 09-08 | Card data as committed JSON validated by zod; generator committed; drift test | Data not code; diffable; regenerable | active |
| D17 | 09-08 | Namespaced slug ids (`denizen:wrestlers`); `saveId` kept as attribute | Readable in the log; collision-proof; seed interop preserved | active |
| D18 | 09-08 | Vendor OathParser at a pinned commit; do not depend on the npm package | Provenance; the package is a stale webpack bundle | active |
| D19 | 09-08 | `cards.lua` is canonical for structure; name discrepancies resolved by hand with aliases | Two upstream witnesses disagree; physical cards are the tiebreaker | active |
| D20 | 09-08 | Card text is an optional overlay never read by the engine or tests | Copyright exposure isolated to one private file | active |
| D21 | 09-08 | Base game only; `set` field reserved for New Foundations | Scope | active |
| D22 | 09-07 | Text-only cards; no art | Removes asset work and the heaviest IP exposure | **reversed by D27** |
| D23 | 09-07 | Chronicle seeds use the TTS/Vassal string format | Interop with existing tools; format already reverse-engineered | active |
| D24 | 09-07 | Discord webhook is the notification channel | Group already uses Discord; highest-value single P6 feature | active |
| D25 | 09-07 | Clockwork Prince (solo) is out of scope | Cut | active |
| D26 | 09-07 | One machine, ever | SQLite single writer; concurrency check assumes one process | active |
| D27 | 09-08 | Card art and board art are in scope; assets private, token-gated, outside git | Ben's call: the real table matters to the group; private use among owners keeps exposure bounded | active |
| D28 | 09-08 | Powers declared by default but enforceable per card via a registry; declared and enforced powers share one `effects` representation | Keeps v1 small without foreclosing enforcement; adding a card never changes the log or reducer shape | active |
| D29 | 09-08 | Tablet and laptop are the primary client surfaces; phone supports the inbox and simple decisions only | That's how the group will actually play; a full Oath table doesn't fit a phone and designing for it would compromise the real target | active |
| D30 | 09-08 | Oath setup is seed-shaped: `setup()` consumes a `SetupSpec` matching the parsed-seed shape; the standard first game is a built-in constant spec | One setup path serves first games, imported seeds, and P5's chronicle output; P5 becomes a spec producer | active |
| D31 | 09-08 | `GameDefinition.setup` accepts optional creation options, opaque to the store, threaded from the create body | The mechanism by which a seed string (or a pinned test setup) reaches a game's setup without the engine knowing what it means | active |
| D32 | 09-08 | Game state is plain TS types plus a `checkInvariants` checker run in every test; no runtime schema on the fold path | Snapshots are disposable so runtime validation buys little; conservation-law checks catch real reducer bugs where it matters | active |
| D33 | 09-08 | Effect vocabulary starts minimal (zone-addressed movers for favor/secrets/warbands/cards + a small closed set) and grows only when an action or power needs it; additions are additive | Guards against pre-building effects for card text; `power.use` shape never changes | active |
| D34 | 09-08 | Enforced powers replace the declaration — the registered impl produces the effects, the client stops asking; relic and banner powers use the same `power.use` shape | One code path, one log shape; validation-mode would need both paths forever | active |
| D35 | 09-08 | The structural endgame (oathkeeper, succession, vision victory, citizenship transitions, game end) is enforced by the engine, not declared | These are the game's skeleton, not card text; declaring them would make every ending disputable | active |
| D36 | 09-09 | Conservation invariants cover favor (36 total) and warbands (24 purple pooled across Imperial seats, 14 per exile color) only; secrets are unconstrained | Law §9.3: Oath is component-limited *except secrets and dice* — the planned secret-supply invariant was wrong against the rulebook; purple pooling follows the Kill glossary (purple warbands return to the Chancellor) | active |
| D37 | 09-09 | `SetupSpec` fixes board structure (sites, starting denizens, relic placements, oath, citizenship, starting pawns) only; the world deck and relic deck pools are shuffled fresh by `oathSetup` on every call, never fixed by the spec, even for `FIRST_GAME` | Real chronicle seeds don't carry player hands/advisers either (checked the vendored `OathGame` interface) — the "draw 3, keep 1" deal is a universal setup step, not first-game-specific; keeping it out of `SetupSpec` is what lets `FIRST_GAME` be a plain constant (D30) while still producing a different game each time | active |
| D38 | 09-10 | Projection hides the world deck's SIZE entirely (`worldDeck: {}`), not just its contents; every other hidden-count zone (relic deck, reliquary, dispossessed, discards) still shows a count | Law §9.4 singles out "the number of cards in the world deck" as private, distinct from the general rule that counts are public — the P2 plan's own text ("world deck... as counts only") over-revealed against this; caught before it shipped | active |

---

## 8. Tracking

### Phase board

| Phase | Status | Started | Done | Prompt plan | Notes |
| --- | --- | --- | --- | --- | --- |
| P0 Skeleton | done | 09-07 | 09-10 | — | deployed to `oath-async.fly.dev` 09-10, tablet turn confirmed |
| P1 Card data | done | 09-08 | 09-08 | `prompt_plan_phase_1.md` + addendum | art assets themselves deferred to P4 (manifest done) |
| P2 Core loop | in progress | 09-09 | | `prompt_plan_phase_2.md` | feasibility gate; units 1–9 done (… + `card.play`, Muster, Trade, Travel); next is unit 10 (Search) |
| P3 Interrupts | not started | | | | |
| P4 Client | not started | | | | |
| P5 Chronicle | not started | | | | |
| P6 Notify & polish | not started | | | | |

### How to use this section

- When starting a phase: set status `in progress`, fill `Started`, write its
  `prompt_plan_phase_N.md`, link it here.
- After each unit: tick the exit criteria it satisfies in §6. If a unit
  changes a decision, add a row to §7 and mark the old one reversed.
- When a phase's exit criteria are all ticked: set `done`, fill `Done`,
  and write one paragraph under the phase describing what shipped and
  what was deferred to a later phase.
- Anything cut mid-phase goes in the phase's notes with the phase it moved to.
- Update `Last updated` at the top.

### Open questions (all phases)

| # | Question | Blocks | Owner |
| --- | --- | --- | --- |
| Q1 | ~~Which Oath printing does Ben own?~~ **Resolved 09-08:** 2nd printing or later; newer names canonical, old names aliased | — | — |
| Q2 | ~~Fly.io vs VPS?~~ **Resolved 09-10:** Fly — `fly launch --copy-config` against the existing `fly.toml`/Dockerfile, volume created, deployed, tablet turn confirmed against `oath-async.fly.dev` | — | — |
| Q3 | Does the client need `powerKind`? | P4 | Ben, decide in P4 |
| Q4 | ~~Commit `text.json`?~~ **Resolved 09-08:** yes, when it exists (default stood) | — | — |
| Q5 | ~~Rulebook edition~~ **Resolved 09-09:** the Buried Giant rules library, Oath printing p1 (Ben's pick), numbering-identical to the Law of Oath Oct 20 2020; cited as `Law §x.y`; edition + p1-vs-2nd-printing caveat recorded in `RULINGS.md` | — | — |
| Q6 | ~~Validate declared-power effects for feasibility?~~ **Resolved 09-08:** yes — `applyEffects` checks feasibility, never card text (P2 units 3, 14) | — | — |
| Q7 | Client framework and transport | P4 | defer to P4 |
| Q8 | ~~Where do art assets live?~~ **Resolved 09-08:** Fly volume beside the db; only the manifest is committed (see P1 addendum) | — | — |
| Q9 | ~~Art source?~~ **Resolved 09-08:** composite — Buried Giant card search for faces, Dev Kit for frames, Vassal module for boards (see P1 addendum); filling `ART_DIR` is P4 work | — | — |
| Q10 | ~~Initial effect vocabulary~~ **Resolved 09-08 in principle (D33):** minimal zone-addressed movers, growth only on need; concrete set designed in P2 unit 3 | — | — |
| Q11 | Is any phone support required for v1, or is inbox-on-phone a P6 nicety? | P4 | Ben — HLD assumes inbox-on-phone is in P4 |

---

## 9. Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| P2 state machine turns out painful | Project stalls | P2 is explicitly the feasibility gate; stop or rescope if so |
| Interrupt round-trips make 6p games take months | Group stops playing | P3 measures round-trips per turn; standing responses; 4p as the real target |
| Motivation decay in P2–P4 | Project dies half-built | Ship a playable 3p game with declared powers before any polish |
| Upstream data is pre-NF and partly stale | Wrong names/indices | P1 reconciliation by index against physical cards; aliases |
| `node:sqlite` API changes behind the experimental flag | Break on Node upgrade | `db.ts` is the only file that touches it; pin Node in Docker |
| Hidden-info leak via a projection bug | Trust | P2 fuzz audit of `project()` over full games |
| Single machine dies | Game state lost | P6 backups; SQLite is one file to copy |
| Art assets leak or bloat the repo | IP exposure; unwieldy clones | Assets outside git, token-gated; only the manifest is committed |
| Enforcement creep: implementing "just a few" cards eats P2 | Schedule | Registry stays empty in v1 except the one test card; enforced cards are a post-P6 backlog |

---

## 10. Glossary

| Term | Meaning here |
| --- | --- |
| action | One log entry: something a player (or the system) did |
| setup | The stored opening position, including deck order; never served |
| fold | Rebuilding state by applying actions in order over the setup |
| snapshot | A cached fold result; disposable |
| pending decision | Something the game is waiting on a specific seat for |
| effect | A small tagged state change (`spend-favor`, `move-warbands`, …) the reducer applies; the shared currency of declared and enforced powers |
| declared power | A `power.use` whose effects the player composed |
| enforced power | A `power.use` whose effects a registered per-card implementation produced |
| chronicle | The cross-game history; also the end-of-game phase that produces the next setup |
| seed | The TTS/Vassal chronicle string |
| witness | One of the two upstream data sources being reconciled in P1 |
