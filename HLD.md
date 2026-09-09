# oath-async — High-Level Design

**Status:** living document. Update the tracking section at the end of every
unit of work; update the decision log whenever a decision is made or reversed.

| Field | Value |
| --- | --- |
| Started | 2026-09-07 |
| Last updated | 2026-09-08 |
| Current phase | P1 (in progress, nearly complete) |
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

### Game state (P2, sketch — subject to P2 design)

Sites in play order with denizen slots and relics; per-seat hands, advisers,
warbands (in supply and on the map), favor, secrets, supply, banners, relics,
vision; the Chancellor/Exile/Citizen structure; oath type and oathkeeper;
world deck and dispossessed as ordered id lists; the current turn phase and
whatever `pending()` needs.

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
- [ ] deployed to Fly and a turn taken from a tablet or laptop *(not yet done — do before P2)*

---

### P1 — Card data — `in progress`

**Goal.** Every card in base Oath as validated JSON with stable ids, sourced
from the official mod's data via `Vagabottos/OathParser`, reconciled against
physical cards, and proven seed-compatible.

**Prompt plan.** `prompt_plan_phase_1.md` — 11 TDD units, plus
`prompt_plan_phase_1_addendum.md` adding unit 12 (art manifest) on 09-08.

**Progress note (09-08).** Nearly complete per Ben. Verify each exit
criterion below against `npm test` and tick it; the art criterion is new
and will be the last one open.

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

**Decisions open.**
- Which printing Ben owns (drives canonical names in unit 6)
- Whether the client needs `powerKind` before P4
- Whether `text.json` is committed (default: yes, repo is private)

**Exit criteria.**
- [ ] 198 denizens, 23 sites, 20 relics, 5 visions, 6 edifices, 2 banners
- [ ] zero unresolved name discrepancies; every override has a reason
- [ ] drift test green; data regenerable with one command
- [ ] both sample seeds round-trip byte-for-byte through our ids
- [ ] no real card text in any test
- [ ] art manifest covers every card face and site; asset presence test passes
      against the local asset directory

---

### P2 — Core loop — `not started`

**Goal.** A real `GameDefinition` for Oath. A full game is playable start to
finish with the six actions enforced and card powers player-declared. This is
the feasibility milestone: if the state machine is painful here, stop.

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

**Decisions to make in P2.**
- How much of the Oathkeeper/Vision endgame is enforced vs declared
- The initial effect vocabulary, and the rule for adding to it
- Whether an enforced card *replaces* the declaration or *validates* it
  (leaning: enforced cards produce the effects; the client stops asking)
- Rulebook edition to follow, and how to record rulings that come up
- Whether relic/banner powers use the same `power.use` shape (leaning yes)

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

---

## 8. Tracking

### Phase board

| Phase | Status | Started | Done | Prompt plan | Notes |
| --- | --- | --- | --- | --- | --- |
| P0 Skeleton | done | 09-07 | 09-07 | — | Fly deploy still pending |
| P1 Card data | in progress | 09-08 | | `prompt_plan_phase_1.md` + addendum | nearly complete; unit 12 (art manifest) in addendum |
| P2 Core loop | not started | | | | feasibility gate |
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
| Q1 | Which Oath printing does Ben own? | P1 unit 6 | Ben |
| Q2 | Fly.io vs VPS? | P0 exit (deploy) | Ben |
| Q3 | Does the client need `powerKind`? | P4 | Ben, decide by end of P1 |
| Q4 | Commit `text.json`? | P1 unit 9 | Ben (default yes) |
| Q5 | Rulebook edition and where rulings are recorded | P2 | Ben |
| Q6 | Validate `power.declare` deltas for feasibility? | P2 | leaning yes |
| Q7 | Client framework and transport | P4 | defer to P4 |
| Q8 | Where do art assets live? Fly volume, object storage, or git LFS | P1 unit 12, P4 | Ben — leaning Fly volume alongside the db |
| Q9 | Art source: own scans vs mod atlases; source resolution | P1 unit 12 | Ben |
| Q10 | Initial effect vocabulary | P2 | design at P2 start |
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
