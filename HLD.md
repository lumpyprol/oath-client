# oath-async — High-Level Design

**Status:** living document. Update the tracking section at the end of every
unit of work; update the decision log whenever a decision is made or reversed.

| Field | Value |
| --- | --- |
| Started | 2026-09-07 |
| Last updated | 2026-09-11 |
| Current phase | P2 (in progress, units 1–16, 16a–16d and 17 done; 18–20 to go) |
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

### Reference sources — use these, not PDFs

Two live, official tools cover everything a unit should need to look up. Both
are JS-rendered SPAs — `WebFetch` gets a 403 or an empty shell; use the
Chrome browser tools (`navigate` + `computer` zoom/screenshot, or
`get_page_text`) instead.

- **Card data and art** — `https://cards.buriedgiant.com/search?q=game:oath`.
  Search by `name:"Card Name"` for an exact single hit. This renders every
  card's actual face at full resolution — icons, costs, suit symbols — and is
  the source for anything not in the vendored Lua (e.g. site reveal prompts,
  recover costs). Already the decided art source (Q9).
- **Rules text** — `https://rules.buriedgiant.com/?product=oath&locale=en-US`
  (the Oath printing p1 edition, already decided as canonical — Q5). Cite as
  `Law §x.y`.

Before cropping the Oath Deck Order PDF or `pdftotext`-ing the rulebook PDF
for anything, check whether the answer is just a search away on one of these
two sites — it usually is, and it's both faster and more reliable than
pixel-hunting a page render.

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
`edifice:sprawling-rampart`, `banner:peoples-favor`, `vision:sanctuary`.
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
  for pending-decision ids; the in-progress Campaign sub-state (unit 12,
  D39) — attacker/defender, targets, dice-pool sizes, phase, rolled faces.

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

**Prompt plan.** `prompt_plan_phase_2.md` — 20 TDD units, plus units
16b–16d added by the 09-11 Law review (a chapter-by-chapter sweep of the
Law against units 1–16; findings table in the plan). Campaign design
(units 12–13) was the explicit feasibility gate — passed.

**Scope.**
- State shape (see §5) and `setup()` per the rulebook's setup procedure,
  including chronicle-seeded setup when a seed is supplied
- Turn structure: supply reset, action phase, end-of-turn checks
- The six actions with supply costs and site/adjacency rules: Muster, Trade,
  Travel, Search, Recover, Campaign
- The minor actions (Law §6) that aren't card powers: facedown-adviser
  play/discard, warband movement with its permission flows, Citizenship
  (§6.6–6.8); peeks (§6.3/§6.4) deferred to the v2/P4 boundary
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
- ~~The campaign action sequence~~ **Resolved 09-11 (unit 12, D39):** one
  `state.campaign` sub-state, three actions (declare/respond/roll), a
  central lock via `requireActiveSeat`'s `campaignOk` opt. Full target
  vocabulary (site/pawnFavor/banner/relic — the relic defense-dice P1 gap
  closed same-day, `data/relic-defense-dice.json`). Imperial Allies alone
  stay deferred (documented, not silent) — see D39 and `campaign.ts`'s
  header

**Exit criteria.**
- [ ] a 3-player game plays to completion through the API with powers declared
- [x] every action has reducer tests for legal, illegal-actor, illegal-state
      (all six, plus `power.use`, as of unit 14)
- [x] `power.use` rejects infeasible effects (spending favor you lack, moving
      warbands that aren't there) (unit 14, `power.test.ts`'s "infeasible
      effects reject the whole action" cases)
- [x] one card is enforced through the registry in a test, producing the same
      log shape as a declaration (unit 15, `registry.test.ts` — the shipped
      registry itself stays empty, `registrySize() === 0`)
- [x] campaign dice come from `prepare()` and survive snapshot wipe + replay
      (unit 12, `campaign1.test.ts`'s "prepare() persists dice" test)
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

### v2 — Engine-enforced card powers — `not started`

**Goal.** The engine knows what every card does. `power.use` still exists
and its log/reducer/action shape never change (D28/D34) — enforcement
means a registered per-card implementation produces the effects instead of
the player composing them. v2 is "fill in the registry", not a rewrite.

This is the deliberately-deferred half of v1. The seam ships empty in P2
(unit 15); the storage/fold/rollback layer and the client (P4) need no
change — only *who composes the effects* changes.

**What it requires (rough order of size).**

1. **Card text as structured power specs.** Today `text.json` is a
   display-only overlay the engine never reads (D20). Enforcement needs a
   machine-readable spec per power: cost, timing, the effects it produces,
   the choices it asks for. ~230 powers (198 denizens, 23 site powers, 20
   relics, 6 edifices/ruins, 5 visions, 2 banners). This is the bulk of
   the work and the bulk of the IP-exposure surface — keep it private,
   same as text and art.
2. **Effect-vocabulary growth (D33).** Many powers need effects the six
   actions never did: swap, exchange, kill (distinct from a warband
   mover), sacrifice, burn-to-box, peek, banner-holder transfer, plus the
   two gaps unit 3 already flagged — the secret ready/flipped distinction
   (§7.1.2 "pay a cost outside your turn") and relic power-cost tokens
   (`player.relics` needs a token-bearing shape). Each lands additively:
   a tag, an `applyEffect` case, tests.
3. **Timing / interrupt integration.** Persistent powers modify an action
   in flight; "When Played" triggers; Wake/Rest powers; battle plans
   (used in a specific Campaign step). Needs P3's interrupt machinery
   mature, plus a representation for power *windows* and *triggers*.
4. **Choice modeling.** Enforced powers take `choices`; each needs a
   schema and, for powers that ask mid-resolution, a pending-decision
   flow.
5. **A registry entry per card.** Additive, one at a time — the point of
   D28. The v1 exit criterion (unit 15: `registry.size === 0`) flips to
   "coverage" tracking.

**Deferred from v1 — the running list of specific card-text rules the
engine does NOT enforce, to be picked up here.** Units 6–20 append as
they go.

- **Travel (unit 9):** Coast cost = 1 (§11.3), Charming Valley +1 (§11.6),
  Shrouded Wood cost = 2 + forced destination (§11.7), "spend no Supply"
  powers ignore Travel cost (§7.6.2), Narrow Pass forced destination
  *and* forced Campaign target (§11.8).
- **card.play (unit 6):** the People's Favor holder's "discard a card at
  any site in your region, then play to any site in your region"
  (§5.1.4.1); the Conspiracy's faceup play — burn a secret to seize a
  relic/banner (§5.1.4.4).
- **Rest (unit 5):** §4.3.5 "Use Rest Powers"; the §7.1.2 "pay a cost
  outside your turn" secret-flip nuance.
- **Campaign (unit 12), Imperial Allies RESOLVED 09-11 (D44) — landed
  2026-09-11 as unit 16a, both parts:** the five
  Imperial campaign asides below were re-checked against the code on
  request and were scheduled as plan unit 16a, not deferred — §5.5.2's
  join mechanic, §5.5.3's *window* (who may act), §5.5.4's Ally board
  bonus, §5.5.6's Chancellor-chooses casualties, §5.5.7's
  consolidate-to-the-Chancellor. Two of them (§5.5.6, §5.5.7) turned out
  to be reachable with a single Citizen and no Allies at all, and one is a
  seam D42 itself opened (every Imperial seat now rules a purple site, but
  `defenseTotal` still counts only the recorded defender's credited
  warbands there) — so this was a live correctness gap, not a clean
  deferral. What REMAINS deferred from those asides: the battle plans
  themselves (below), §5.5.3's "a specific battle plan cannot be used by
  multiple players" once-each bookkeeping, and §5.5.2's "activate all
  Campaign modifiers ruled by the defender and all Allies" — all three are
  card-power effects, i.e. ordinary v2 scope. One further gap surfaced
  while building it and is recorded rather than hidden: with a single
  response window, a Citizen Ally's permission arrives in the action that
  closes that window, so only the mandatory Chancellor Ally can actually
  act inside §5.5.3's battle-plan window. The Law wants §5.5.2's join and
  §5.5.3's plans in that order, which needs P3's two windows — a batching
  gap, not a missing rule.
- **Campaign (unit 12):** battle plans (§5.5.3, card powers used mid-
  Campaign — the naive P2 response window just skips straight to roll);
  every OTHER site/card power that adds or removes attack or defense
  dice (Plains/Mountain's own §11.4 modifier is NOT on this list — it's
  identity-only and mandatory, so it's implemented directly in
  `campaign.ts`, not deferred; see below). Imperial Allies were once on
  this list too ("pending Citizenship existing at all") — they are not
  any more; see the D44 entry above, landed as unit 16a. Two things
  flagged for this list at first turned out not to
  belong on it, closed same-day (09-11) instead: relic targets (§5.5.2 —
  P1 had no per-relic defense-dice count, §2.4.2; `data/relic-defense-
  dice.json`, all 20 relics) and Plains/Mountain's attack-die modifier
  itself (§11.4 — no new data needed, just the site's name, which P1
  already has). See `campaign.ts`'s header and D39.
- **Campaign resolution (unit 13):** battle plans' §5.5.8 triggers ("if
  you're victorious"/"if you're defeated"/"at end, discard [card]") —
  same battle-plan deferral as unit 12's §5.5.3. ("Imperial warbands at
  sites move to the Chancellor's board", §5.5.7, was also on this list;
  unit 16a part 1 implemented it — `campaign.ts#survivorBoardOf`.)
- **Citizenship (unit 16), RESOLVED same-day (2026-09-11) once flagged —
  see D42:** §6.6.3's "every Imperial player rules every purple site" and
  the Imperial Reliquary's 4 action-modifier spaces are no longer
  deferred; `rule.ts` and `power.ts`'s `reliquary:<modifier>` access gate
  close both. What's STILL deferred, narrower than originally scoped:
  Imperial Allies' actual joining mechanic and the defense-total/casualty
  DICE ARITHMETIC across multiple Imperial seats' combined "force"
  (§5.5.1's Chancellor-joins/Citizen-may-join, §5.5.4's Ally warband
  bonus, §5.5.6-7's consolidation) — ruling legality is fixed, the
  arithmetic still only reads the single recorded defender's own counts.
  **Superseded 09-11 by D44:** that last sentence described a live bug,
  not a safe deferral — unit 16a closed it the same day.
  Also still deferred: the 4 reliquary modifiers' actual EFFECTS (Brutal/
  Decadent/Careless/Greedy — RULINGS.md has the transcription) stay
  declared, not enforced, same v1/v2 split as every other card power
  (D9/D28); and the Peek family (§6.3/§6.4), not built anywhere in this
  engine, still unnecessary since a pending offer's relic is public to
  the deciding party regardless.
- **Law review (09-11, D43) — the sweep that added plan units 16b–16d.**
  Newly recorded deferrals: the **Peek family (§6.3/§6.4)** now has a
  home — it needs peek-memory state plus a projection change
  (`project.ts` carries the "revisit when a peek action exists" marker)
  and is only useful with a client, so it sits on the v2/P4 boundary;
  the **opportunity-site Wake take (§4.1.4/§11.1)** stays declared
  (expressible today as a `siteFavor`/`siteSecrets` mover); **battle
  plans' multi-roll defense doubling (§5.5.4)** rides with the existing
  battle-plans deferral; **restriction banners (§7.2)** — site-only /
  adviser-only / locked are per-card structural facts absent from the P1
  database, so the play paths can't enforce them; enforcement is a
  one-line check once the data exists (Q12, Ben: small P1-style data
  addendum from cards.buriedgiant.com vs leave self-policed until v2).
  Also note: unit 16d's `supply` effect is what makes the Travel-cost
  deferrals above (§11.3/§11.6/§11.7/§7.6.2) *declarable* at all — until
  it landed, the engine charged base cost with no way to give Supply
  back, so that entry's "players declare these via power.use" premise
  held only from 16d onward. **Landed 2026-09-11**; a Coast trip is now
  an ordinary `travel` plus a `power.use` refunding the difference,
  proven end to end. Unit 16d also closed §7.1.2 (nothing may be placed
  on a card that already carries favor or secrets) as a feasibility
  rule, so a declared power can no longer do what no rule permits.

**Not in scope for v2.** The append-only log, fold, snapshots, rollback,
optimistic concurrency, projection, and the chronicle/seed interop are
all v1 and unchanged. So is the structural endgame (D35).

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
| D39 | 09-11 | Campaign (unit 12) is one in-progress sub-state (`state.campaign`) with a `phase` enum (`respond`\|`roll`\|`rolled`) walked by three actions (`declare`/`respond`/`roll`); a single central lock (`turn.ts#requireActiveSeat`'s `campaignOk` opt, checked by every OTHER action's existing call site) makes every non-campaign action illegal-state for free, with no per-file edits. Full target vocabulary ships (`site`/`pawnFavor`/`banner`/`relic` — the relic defense-dice P1 gap was closed same-day rather than left deferred, once flagged as a mistake to defer: relics are a common, often game-swinging campaign target, not a minor completeness gap). Imperial Allies (meaningless before Citizenship, unit 16, gives a Citizen seat a way to exist and opt in) are the one thing still deferred, documented in `campaign.ts`'s header, not silently dropped | Keeps the hardest sequence in P2 clean and provably lockable without threading a flag through 6 existing action files; ships a complete, correct 1-attacker-vs-1-defender campaign — with its full target vocabulary — now, rather than a half-built one | active |
| D40 | 09-11 | Campaign resolution (unit 13) splits into two more phases/actions on the SAME sub-state rather than one big action: `'rolled' -> campaign.resolve -> ('seize' \| cleared)`, `'seize' -> campaign.seize -> cleared`. `resolve` alone handles a loss (nothing left to choose) and applies every MANDATORY win effect (relics, banners); `seize` exists only to gate the win-only CHOICES (placements, banish, burn-favor) behind their own pending decision, so a client can show the outcome before asking for them. One function (`resolveDefeatForSeat`) computes §5.5.6's casualty split for EITHER side by parameterizing which sites count and whether the board does — the attacker is just the `siteIds: []`/`includeBoard: true` case | Keeps each action's payload single-purpose and lets the UI reveal win/loss before demanding seizure choices, without inventing a second sub-state; one casualty function instead of two near-duplicates (attacker/defender) that would drift apart under future edits | active |
| D41 | 09-11 | Citizenship (unit 16) is five actions: `citizenship.offer`/`accept`/`decline` (Law §6.6, one pending `state.citizenshipOffer` — unlike Campaign, it does NOT lock other actions, so `pending()` appends it rather than preempting), `citizenship.exile` (§6.7, unilateral, no consent step), `citizenship.selfExile` (§6.8). The load-bearing call: our per-seat warband model has only TWO conserved buckets (each Exile's own 14; Chancellor+Citizens' combined 24 purple), never a third "idle reserve" or "unattributed purple" bucket, so §6.6.2's "replace with purple, if not enough the Exile chooses" and §6.7/§6.8's "replace with your own color" are generalized rather than taken as literally scoped (board+map only, silent on bank): joining wipes a seat's ENTIRE current holding (bank+board+every site — always exactly 14, no tracked destination, mirroring how setup hands a new Exile 14 from nowhere); leaving moves the ENTIRE current purple holding to the Chancellor's bank (Glossary "Kill"'s own disposal, reused) and grants a fresh 14 (3 board / 11 bank, Law §1.15's own setup split). Given this, the "capacity" formula for how much purple a joining Exile could keep is computed generally but is PROVABLY always 0 in a state that satisfied the invariant beforehand (Chancellor+Citizens already hold the full 24 between them) — `accept` throws rather than silently mishandling the unreached positive-capacity branch | Matches unit 7 (Muster)'s already-established precedent that the physical purple/own-color distinction is a token detail our invariant-only conservation model doesn't need; avoids inventing new state-shape (a third warband bucket) for a corner the model's own math proves unreachable, while still computing the general formula rather than hardcoding the specific number | active |
| D42 | 09-11 | Unit 16 follow-up, same day, on user review: (1) Law §6.6.3 "every Imperial player rules every purple site" + §5.5.1's Campaign-scoped carve-out, implemented in a new shared `rule.ts` (`rulersOf`/`imperialExclusionFor`) imported by both `campaign.ts` and `power.ts` rather than duplicated; (2) the Imperial Reliquary's 4 fixed named spaces (Brutal/Decadent/Careless/Greedy — printed board text, RULINGS.md has the transcription) are now structural state: `reliquary: string[]` became `reliquary: ReliquarySpace[]` (`{modifier, relicId}`, always length 4), letting `power.ts#hasAccess` grant the Chancellor a `reliquary:<modifier>` id once its covering relic is gone — the MODIFIER's actual effects stay declared (v1, same as every other card power, D9/D28), only ACCESS is structural. Deliberately NOT done: the Allies mechanic itself (defense-total/casualty arithmetic across multiple Imperial seats' combined force) — ruling legality and access are now correct for any number of Imperial seats, but the DICE math still reads only the single recorded defender's own counts, since combining forces needs the opt-in Ally mechanic (who joins, the Chancellor's mandatory join) to do correctly | The user flagged these as under-scoped in the initial unit 16 pass rather than genuinely low-priority — same pattern as unit 12's relic-targets pushback: a "ripple" that looked deferrable on paper turns out to matter the instant a second Imperial seat exists, which unit 16 itself just made possible for the first time | active |
| D43 | 09-11 | Full Law review before unit 17 (findings table in the plan) added three units and rewrote unit 17's prompt with the now-known Law specifics. Structural closures, all by unit 12's Plains/Mountain precedent (identity-only + mandatory ⇒ engine's job, not card text): the §6.1/§6.5 minor actions (unit 16b — a game literally cannot garrison a site or surface a facedown adviser without them), the §2.11 Oathkeeper/Usurper mandatory defense dice and the Grand Scepter as a campaign target (unit 16c), a `supply` effect + the §7.1.2 occupied-card feasibility rule (unit 16d — without the supply effect, every deferred Supply-touching power was *undeclarable*, breaking the v1 deferral premise, not just unenforced). The People's Favor Wake maintenance (§4.1.1) is Law ch. 4 turn sequence, so it's structural and folded into unit 17 alongside the Wake-timed win checks. Deferred with a recorded home instead of silently: peeks (§6.3/§6.4 → v2/P4 boundary), opportunity-site Wake take (§4.1.4, declared), §5.5.4 multi-roll doubling (rides with battle plans), restriction banners (§7.2 → Q12, pending a data decision) | A one-sitting sweep of the reference against the built system is cheap insurance right before the victory unit locks in endgame semantics; the alternative — discovering §6.5 during unit 19's scripted game — would have cost more and been diagnosed worse | active |
| D45 | 09-11 | Unit 17 reads "meets the Oathkeeper goal" as INCLUDING a tie, on the strength of §2.11's own tie rule ("if the title's holder becomes tied with another player *for meeting* the goal, the holder keeps the token"), which only parses if both tied players meet it. The same reading then settles a question §3.2 leaves open — whether an Exile tied for "rules the most sites" wins a Visionary Win — in favour of yes. Also: only Supremacy is collective (§2.11 names the Chancellor's Empire clause for it alone, and §6.6.3 is why it must be — every Imperial seat rules the same purple sites and can never break that tie internally); the other three goals stay individual, so a Citizen can hold the Oathkeeper of Protection | The alternative reading ("strictly the most") would make the §2.11 tie rule dead text, and would silently change who wins a game; a rule that decides games belongs in RULINGS.md with its evidence rather than buried in a predicate | active |
| D44 | 09-11 | Imperial Allies are pulled forward into P2 as plan unit 16a rather than left on the v2 deferred list. Prompted by a re-check of all eight of the Law's purple Imperial asides against the code: three (§5.2.2 Muster purple, §4.3.3 Citizen Supply, §5.5.1's carve-out) are implemented; the other five are not. Two of those five — §5.5.6's "the Chancellor chooses which warbands die" and §5.5.7's "Imperial warbands at sites move to the Chancellor's board" — are reachable with ONE Citizen and no Allies whatsoever, and `defenseTotal`'s site bonus is a seam D42 itself opened (D42 made every Imperial seat rule a purple site, so a Citizen can now be declared defender of a site garrisoned by the Chancellor and defend it with zero site warbands counted). The unit therefore splits along reachability, not along "Allies vs not": part 1 is the correctness fix (combined site warbands, §5.5.7 consolidation, §5.5.6's allocation choice as a `casualties` phase, auto-skipped when allocation cannot change the outcome — unit 13's existing shortcut stays valid for single-owner forces), part 2 is the opt-in mechanic (Chancellor mandatory join, Citizens' permissioned join via `campaign.ally` + `respond.allies`, §5.5.4's per-Ally board bonus, and §5.5.3's response-window membership). Battle-plan effects, §5.5.3's once-each bookkeeping, and §5.5.2's modifier activation stay v2 — they are card powers | Third time a "documented deferral" turned out to be a reachable defect the moment a prerequisite shipped (relic targets in D39, site ruling in D42, now the Imperial force): the pattern is that deferrals reasoned about on paper age badly against code, so the check is now against the code. Deferring further would also have left unit 19's acceptance game unable to campaign against a Citizen correctly | active |

---

## 8. Tracking

### Phase board

| Phase | Status | Started | Done | Prompt plan | Notes |
| --- | --- | --- | --- | --- | --- |
| P0 Skeleton | done | 09-07 | 09-10 | — | deployed to `oath-async.fly.dev` 09-10, tablet turn confirmed |
| P1 Card data | done | 09-08 | 09-08 | `prompt_plan_phase_1.md` + addendum | art assets themselves deferred to P4 (manifest done) |
| P2 Core loop | in progress | 09-09 | | `prompt_plan_phase_2.md` | feasibility gate; units 1–16 done (all six actions + card.play + `power.use` + the (empty) enforcement registry + Citizenship transitions); 09-11 Law review (D43) inserted units 16b–16d and rewrote unit 17's prompt, and its Imperial second pass (D44) added 16a. 16a-16d and 17 done 09-11; next is 18 (chronicle-seeded setup) |
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
| Q12 | Restriction banners (Law §7.2): add a `restriction` field to the P1 card data (transcribed from cards.buriedgiant.com, drift-tested) so `card.play`/`adviser.play` can enforce site-only/adviser-only/locked — or leave self-policed until v2? | nothing in P2; play-legality correctness | Ben — leaning add the data (structural facts, not text; enforcement is then one line) |

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
| Enforcement creep: implementing "just a few" cards eats P2 | Schedule | Registry stays empty in v1 except the one test card; enforced cards are v2 (§6, "v2 — Engine-enforced card powers"), which carries the running list of deferred card-text rules |

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
| v1 | The initial build, phases P0–P6: a full async Oath server whose engine enforces structure but not card text — powers are player-declared via `power.use`, mistakes fixed by rollback. The registry seam ships but empty. |
| v2 | Engine-enforced card powers: a registered implementation per card produces the effects instead of the player. Additive on top of v1 (§6, "v2 — Engine-enforced card powers"); the log, reducer, and action shape don't change. |
