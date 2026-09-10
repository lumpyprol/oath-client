# Prompt plan — Phase 2: core loop

Phase 2 builds the real `GameDefinition` for Oath: state, setup, the turn
structure, the six actions, campaign resolution, declared powers with the
effects vocabulary, citizenship, victory, projection, and pending decisions.
At the end a 3-player game is playable start to finish through the API with
card powers player-declared.

**This phase is the feasibility gate** (HLD §9). If the state machine turns
out painful, stop and rescope rather than push through.

Each unit below is a prompt to hand to Claude Code, in order. Every unit is
TDD: write the failing tests, watch them fail for the right reason, make them
pass, run the whole suite, commit. Each stands alone — a later unit never
reopens an earlier one (additive registrations in a dispatch table or check
pipeline don't count as reopening), and the repo is green and committed after
each.

---

## What was verified on 2026-09-08

- P1 is complete: 112 tests pass, 1 intentionally skipped (art assets on
  disk, deferred to P4). `npm run build` clean.
- The engine contract (`src/engine/types.ts`): `setup(seats)`, `init(setup)`,
  optional `prepare(state, proposed)` (impure, runs once at append, returns
  the payload to persist), `reduce(state, action)` (pure; receives a private
  deep clone, mutate-and-return is fine), `project(state, seat|null)`,
  `pending(state)`, `isComplete(state)`. `IllegalAction` → 400,
  `StaleSeq` → 409. Seq 0 is always `game.created`.
- The cards API (`src/oath/cards/index.ts`): `byId`, `byName` (aliases,
  case-insensitive), `bySaveId`, `denizensBySuit`, `edificeBySuit`, frozen
  `cards` database. Counts: 198 denizens, 23 sites, 20 relics, 5 visions,
  6 edifice/ruin, 2 banners.
- Seed interop (`src/oath/chronicle/seed.ts`): `parseSeed` / `serializeSeed`
  round-trip the two sample seeds byte-for-byte. `ParsedSeed` carries oath,
  suit order, winner, citizenship, sites with their cards, world deck,
  dispossessed, relics.
- `cradle` (the P0 toy game) is referenced by `src/routes.ts` (DEFS),
  `replay.test.ts`, and `scripts/smoke.mjs`. Unit 20 deletes it.
- Registration point: `DEFS` in `src/routes.ts`; game `kind` comes from the
  create body.

## Rules authority

The rulebook is the authority for every game rule; this plan is the authority
for architecture only. **Where this plan states a game rule (a cost, a dice
face, a timing), treat it as a claim to verify against the rulebook before
encoding it in a test.** Constants in code carry a comment citing the
rulebook section. Anything ambiguous, and any table ruling the group makes,
goes in `RULINGS.md` at the repo root (created in unit 1), with the date and
the rulebook edition it interprets.

**Q5 answered (2026-09-09):** the edition is the Buried Giant rules library,
Oath printing p1 —
<https://rules.buriedgiant.com/?product=oath&locale=en-US&printing=p1> —
whose section numbering is identical to the *Law of Oath* (Oct 20, 2020).
Citations are written `Law §x.y`; setup steps are `Law §1.n`. The site is an
SPA whose full rules text is embedded in its JS bundle; the extraction recipe
is recorded in the session memory (`oath-rules-reference`), and a Law of Oath
PDF mirror cross-checks it. One caveat lives in `RULINGS.md`: P1's card data
was reconciled against a 2nd-printing card set while this reference is
printing p1.

## What unit 1 established (as built, 2026-09-09)

Later units should treat these as ground truth; they amend this plan's
sketches where the two disagree.

- **Secrets are not conserved.** Law §9.3: Oath is component-limited
  *except secrets and dice*. `checkInvariants` conserves favor (36 total,
  Law §1.4) and warbands (24 purple pooled across Chancellor + Citizens per
  the Kill glossary; 14 per exile color — Law §1.8/1.9/1.15). Don't write
  tests asserting a secret total (HLD D36).
- **Tokens sit on cards and sites.** Muster/Trade place favor/secrets *on*
  denizen cards (returned at Rest, Law §4.3, or on discard); reveal prompts
  put tokens on sites (Law §2.8.2). Every in-play card entry and every site
  carries favor/secret counts — units 7–8 pay onto cards, not into banks.
- **There is no persistent hand.** `players[i].hand` exists but is transient:
  cards drawn mid-Search awaiting keep/discard (Law §5.1). Unit 6 ("playing
  cards from hand") really means playing within Search and the facedown-
  adviser minor action — design it against the Law, not the plan's framing.
- **Discards are per region and cross-region.** One pile per region (Law
  §2.1.2); the Discard glossary sends cards to the *next* region's pile
  (Cradle pawn → Provinces pile, etc.), returns favor on them to matching
  banks, and flips secrets on them facedown to the acting player's board.
- **Secrets flip.** Spent secrets sit flipped on the board until Rest
  (Law §4.3): `secrets: { ready, flipped }`.
- **Warbands split bank/board.** Personal-bank reserve vs the force that
  travels with the pawn (Law §2.2.1/2.2.3); Supply refresh reads the bank
  (unit 5). Site warbands are per-seat; Imperial seats' entries are purple.
- **Extra zones exist:** the Imperial Reliquary (4 facedown relics, Law
  §2.3), banner placards with holder/stake/Mob-side (Law §2.5), facedown
  relics at sites, facedown sites. The Grand Scepter is **not** in the P1
  card database — state tracks only its holder (`grandScepter: seat`).
- **`Region` lives in `state.ts`.** Unit 2's `map.ts` should import/re-export
  it rather than define a competing type.
- **Projection warning for unit 5:** Law §9.4 makes the *number of cards in
  the world deck* private, along with discard-pile fronts and facedown card
  fronts. The plan's "world deck as counts only" over-reveals — project the
  deck as present/absent, not as a count. Public: discard-pile counts and
  backs, all token counts on boards.
- Adviser limit is 3, Visions included (Law §2.2.2), enforced as an
  invariant; powers may override at play-time (Law §9.2) — if one ever does,
  relax the invariant then, not before.

## What unit 3 established (as built, 2026-09-09)

The plan's `ZoneRef` list ("a seat's hand/advisers/favor/secrets/warband
supply; a site's slots/relics/warbands; a suit's favor bank; the secret
supply; the world deck; a discard pile; the dispossessed; the relic deck;
a banner") undercounted what the six actions actually touch. The built
vocabulary (`src/oath/game/effects.ts`) has 22 zone kinds, each traced to a
specific action or to `power.use` itself — none spec­ulative:

- **Warbands split into three pools, not one "warband supply".** Muster
  (Law §5.2.2) gains warbands from the personal bank onto *your board*, not
  onto the site; moving board warbands onto a *ruled site* is a separate
  Minor Action. So `seatWarbandBank`, `seatWarbandBoard`, and
  `siteWarbands` are three distinct zones, matching unit 1's state split.
- **Muster and Trade place tokens directly on cards** (Law §5.2.1, §5.3.2:
  "place one favor/secret on a denizen... at your site"), so
  `siteCardFavor`/`siteCardSecrets` (and `adviserFavor`/`adviserSecrets`,
  for power.use paying a cost on an adviser, Law §7.1.2) are core, not
  edge cases.
- **`siteFavor`/`siteSecrets`** (tokens on the site itself) exist for
  Travel's reveal prompt (Law §5.6.2) — needed by one of the six actions.
- **`seatRelics` and `seatVision`** exist because Recover (Law §5.4.3) and
  Search's Vision play (Law §5.1.4.3) target them directly.
- **Banners address only their token stake**, one currency each
  (`bannerFavor` for the People's Favor, `bannerSecrets` for the Darkest
  Secret — Law §2.5) — no generic `{kind:'banner', id}` pairing was needed
  since there's exactly one banner per currency. **Banner HOLDER transfer
  is NOT in this vocabulary** — it's a structural reassignment
  (`BannerState.holder`), not a currency move; Recover (unit 11) and
  Campaign seizure (unit 13) mutate it directly, the same way turn.ts's
  Rest sweep (unit 5) will move `secrets.flipped -> ready` directly.
- **The Imperial Reliquary is NOT a zone.** Setup deals into it directly
  (bypassing effects); nothing in `reduce` moves a card there until
  Citizenship (unit 16) hands out a promised relic — add it then.
- **`draw`'s `from` is restricted to `worldDeck`/`discard`/`relicDeck`**
  (the ordered/hidden sources with a "top"); its `to` is unrestricted
  within `CardZone` since both Search (-> `seatHand`) and Travel's reveal
  (relicDeck -> `siteRelics`) are legitimate destinations.
- **Two real gaps deferred, not silently built around:**
  - Relic power-cost tokens (Law §7.1.2: relics have costs too) have no
    zone here because `player.relics` is still a bare `string[]` from
    unit 1. Extending it to carry favor/secrets is unit 11's or unit 14's
    call — it reshapes an existing field, which is a stop-and-reassess
    case per the plan's risk list, not an additive one.
  - `seatSecrets` addresses only the READY pool. Paying a power cost
    "outside your turn" flips a secret facedown in place instead of
    moving it (Law §7.1.2) — relevant once `power.use` is usable during
    another seat's turn (the naive campaign response window, unit 12+).
    Needs either a pool parameter on `seatSecrets` or a new flip target;
    unit 14/15's call.
  - Flipping a site facedown/faceup (Travel's arrival reveal, Law §5.6.2)
    isn't a `flip` target yet — only adviser and edifice are. Add it in
    unit 9.
- **Runtime exhaustiveness matters.** A zone object with an unrecognized
  `kind` must throw the same `IllegalAction` as any other infeasibility,
  not silently no-op — `EffectSchema` blocks this from the HTTP path, but
  `applyEffects` is also callable directly by trusted code, so every
  zone-dispatch switch has an explicit runtime default case
  (`badZone` in effects.ts), not just an exhaustive-union compile check.

## Decisions made (recorded in HLD §7 as D30–D35)

1. **D30 — setup is seed-shaped.** `setup()` takes a `SetupSpec` — the same
   shape `parseSeed` produces — and the standard first game is a built-in
   constant spec matching the rulebook's first-chronicle layout. One setup
   path serves the first game, imported seeds (unit 18), and P5's chronicle
   output. P5 becomes a producer of `SetupSpec`, nothing more.
2. **D31 — the engine contract gains creation options.**
   `setup(seats, options?)`, opaque to the store, passed through from the
   create body. This is how a seed string reaches Oath's setup. Small,
   backward-compatible change to `engine/types.ts` (unit 4).
3. **D32 — state is plain TypeScript types plus an invariant checker.** No
   zod on the fold path; `checkInvariants(state)` (conservation laws,
   uniqueness, capacity) runs in every test after every reduce. Snapshots
   are disposable, so runtime validation buys little; the checker is the
   safety net where it matters.
4. **D33 — the effect vocabulary starts minimal and grows only on need.**
   Zone-addressed movers for the four currencies (favor, secrets, warbands,
   cards) plus a small fixed set. Adding an effect is additive: a new tag, an
   `applyEffect` case, tests. The `power.use` action shape never changes.
5. **D34 — enforced powers replace the declaration**, they don't validate
   it: a registered card implementation produces the effects and the client
   stops asking. Relic and banner powers use the same `power.use` shape.
6. **D35 — the structural endgame is enforced.** Oathkeeper tracking,
   succession checks, vision victory, citizenship transitions, and game end
   are engine rules, not declarations. Card-text exceptions to them ride on
   `power.use` like everything else.

Architecture within the phase (not decision-log material):

- **Dispatch-table reducer.** `reduce` looks up handlers in a
  `Record<actionType, handler>`; end-of-turn/start-of-turn checks are an
  ordered pipeline array. Later units register handlers and checks
  additively; no unit edits another unit's handler.
- **Pending-decision ids are pure and stable.** State carries `actionCount`
  (incremented by every reduce); a decision's id is
  `` `${kind}:${seat}:${actionCount when it arose}` ``. Same decision, same
  id across polls; distinct decisions never collide. P3 builds on this.
- **Module layout.** `src/oath/game/`: `state.ts`, `map.ts`, `effects.ts`,
  `setup.ts`, `turn.ts`, `actions/<name>.ts`, `project.ts`, `index.ts`
  (assembles the `GameDefinition`). `src/oath/powers/registry.ts`. Tests in
  `test/oath/game/`.

## Decisions needed from you

- ~~**Q5 — rulebook edition.**~~ **Resolved 2026-09-09** — the Buried Giant
  rules reference, printing p1 (see "Rules authority" above and
  `RULINGS.md`).
- **Q2 — deploy.** The P0 exit criterion "deployed to Fly and a turn taken
  from a tablet" is still open and the HLD says do it before P2. It doesn't
  block units 1–4 technically, but don't let it slip past unit 5.

## Decisions deferred into specific units

- Exact effect tags and zone addressing — unit 3, within D33's frame.
- The campaign action sequence (declare / respond / roll / resolve split)
  — unit 12; this is P2's hardest design call and P3's foundation.
- Whether the whole-campaign flow supports multiple targets in one
  declaration — unit 12, per the rulebook.
- What the defender can do in the naive P2 response window — unit 12.
- How `prepare()` substitutes registry-produced effects — unit 15.

---

## Conventions for every prompt

- Repo state assumed: P1 complete as committed. Node 22, TypeScript, ESM
  (`.js` import suffixes), vitest, zod available. `npm test` green before
  and after.
- Red, green, refactor. Test file first; watch it fail for the right reason.
- Tests in `test/oath/game/` (unit 19's fixture in `test/fixtures/`).
- **No real card text in any test or in code.** Card *identities* (ids,
  names, suits) are fine — that's P1 data. Text is not.
- Every game rule encoded in a test cites its rulebook section in a comment.
- Reducer tests for every action cover at minimum: legal, illegal-actor
  (not your turn / not your decision), illegal-state (can't afford it /
  target absent). This is an HLD exit criterion.
- Every test that produces a state runs `checkInvariants` on it.
- Test helpers live in `test/oath/game/helpers.ts`: a `baseState()` builder
  producing a minimal valid mid-game state, extended additively by later
  units (new optional builder params, never changed defaults).
- States are plain JSON-serializable data: no `Map`, `Set`, `undefined` in
  arrays, or class instances. `null` for empty slots.
- Finish with `npm test`, then commit with the message given.

---

## Unit 1 — State shape and invariants ✅ (completed 2026-09-09)

**Purpose.** Define what an Oath game *is* in memory before any rule exists.
Everything downstream builds states by hand in tests; this unit makes that
possible and safe.

**Depends on.** Nothing.

```
We're starting Phase 2 (core loop) of oath-async. First unit: the state
shape and its invariant checker.

Create RULINGS.md at the repo root: a heading, the rulebook edition (leave
a TODO for me to fill — Q5), and an empty table (date, question, ruling,
rulebook ref).

Create `src/oath/game/state.ts` exporting plain TypeScript types (no zod)
for the full game state. Derive the component list from the rulebook's
component inventory and HLD §5's sketch. It must include at least:

  - seats: number; seat 0 is the Chancellor (document this convention)
  - citizenship: per seat, 'chancellor' | 'exile' | 'citizen'
  - oath: which of the four oaths this game is under; oathkeeper: seat
  - sitesInPlay: ordered array of { id, region, cards: (cardId|null)[]
    (denizen slots, length = the site's capacity), relics: cardId[],
    warbands: per-seat counts, ruined?: ... } — check the rulebook for
    what a site tracks and add what's missing
  - per seat: hand (cardId[]), advisers ({ id, facedown }[]), favor,
    secrets (with flipped/exhausted state if the rulebook has it), warband
    supply, supply (the action currency), vision held if any
  - favor banks per suit; secret supply; relic deck order; world deck
    order; dispossessed; discard piles (check the rulebook for how many
    and where)
  - turn: { activeSeat, ...phase bookkeeping }
  - campaign: null | <sub-state placeholder type, filled in unit 12>
  - actionCount: number (incremented by every reduce; pending-decision ids
    derive from it)
  - complete: boolean; winner: seat | null

Also export `checkInvariants(state): void` (throws with a specific
message) enforcing at least:
  - every card id appears in exactly one zone (slots, hands, advisers,
    decks, discards, dispossessed, relic locations), and exists in the
    P1 database
  - site denizen slots don't exceed the site card's capacity
  - warband conservation per seat: supply + on-map (+ committed, once
    campaigns exist) equals that seat's rulebook total
  - favor conservation: banks + players (+ banners) equals the rulebook
    total for the player count
  - seats/citizenship consistent (exactly one chancellor, seat 0)

Rulebook totals go in a CONSTANTS block with section citations.

Create `test/oath/game/helpers.ts` with `baseState(overrides?)`: a minimal
valid 3-player mid-game state built from real card ids (pick them via the
cards API, don't hardcode strings that could drift).

TDD, `test/oath/game/state.test.ts`:
  - baseState() passes checkInvariants
  - each invariant has a test that breaks it and asserts the error names
    the problem (duplicate card id, over-capacity site, warband count off
    by one, favor total off, two chancellors)

Commit: "Add Oath game state shape and invariant checker"
```

**Done when.** `baseState()` validates; every invariant has a failing-case
test; `RULINGS.md` exists.

---

## Unit 2 — Map geometry ✅ (completed 2026-09-09)

**Purpose.** Regions and travel costs as a small pure module, so Travel and
Campaign never embed geometry.

**Depends on.** Nothing (uses only card data).

```
Unit 2 of Phase 2: map geometry.

Create `src/oath/game/map.ts` exporting:
  - Region: 'cradle' | 'provinces' | 'hinterland'
  - REGION_SITE_COUNTS: sites per region on the board (rulebook: the map
    has fixed slots per region — cite the section)
  - travelCost(from: Region, to: Region): number — the rulebook's travel
    cost table, cited
  - any other pure geometry the rulebook defines that actions will need
    (e.g. which region is "adjacent" to which for card purposes) — add
    only what the rulebook states, nothing speculative

TDD, `test/oath/game/map.test.ts`, table-driven:
  - every (from, to) pair has the rulebook's cost, all 9 asserted
  - REGION_SITE_COUNTS sums to the board's site count
  - costs are symmetric or asymmetric exactly as the rulebook says —
    encode whichever it is explicitly

Commit: "Add map regions and travel cost table"
```

**Done when.** The full cost table is asserted against the rulebook.

---

## Unit 3 — Effect vocabulary ✅ (completed 2026-09-09)

**Purpose.** The shared currency of declared and enforced powers (HLD D28),
and the vocabulary `power.use` speaks. Designed once here; grows only on
need.

**Depends on.** Unit 1.

```
Unit 3 of Phase 2: the effect vocabulary and applier.

Create `src/oath/game/effects.ts`. Design a tagged union `Effect` around
zone-addressed movers for the four currencies:

  - a ZoneRef type addressing: a seat's hand / advisers / favor / secrets
    / warband supply; a site's slots / relics / warbands; a suit's favor
    bank; the secret supply; the world deck (top); a discard pile; the
    dispossessed; the relic deck (top); a banner
  - movers: { kind: 'favor'|'secret'|'warbands', from: ZoneRef,
    to: ZoneRef, amount } and { kind: 'card', id, from: ZoneRef,
    to: ZoneRef } — with per-kind restrictions on which zones are legal
    endpoints (favor can't enter a hand, cards can't enter a favor bank…)
  - a small closed set of non-mover effects only if a mover genuinely
    can't express them: 'flip' (adviser facedown/up, edifice↔ruin),
    'draw' (top-of-deck to hand, since the drawer can't name a hidden id)
  - keep the initial set MINIMAL. If you're unsure a tag is needed for
    the six actions or an obvious denizen power, leave it out. The growth
    rule (HLD D33): a new effect lands only when an action or power needs
    it, as a new tag + applyEffect case + tests — never by widening an
    existing tag.

Export:
  applyEffects(state: OathState, actor: seat, effects: Effect[]): OathState
    — applies in order; throws IllegalAction naming the failing effect's
    index and reason on ANY infeasibility (zone lacks the amount, card not
    in the from-zone, illegal endpoint kind, over-capacity destination).
    Feasibility only: it never asks whether a card's text permits this.
    Pure; clone-and-mutate is fine.

Zod schemas for Effect (EffectSchema) alongside the types — power.use
payloads arrive over HTTP and must be shape-validated in prepare later.

TDD, `test/oath/game/effects.test.ts`, on hand-built states:
  - each mover kind: a legal move lands (both zones change, invariants
    hold)
  - each infeasibility listed above throws, message includes the index
  - effects apply in order: a sequence where step 2 is only feasible
    because of step 1 succeeds; the reverse order throws
  - applyEffects does not mutate its input state
  - EffectSchema rejects a malformed payload

Commit: "Add effect vocabulary and applier"
```

**Done when.** All movers and failure modes tested; vocabulary documented in
the file header with the growth rule.

---

## Unit 4 — Setup and init ✅ (completed 2026-09-09)

**Purpose.** A game can begin. All setup randomness happens here, once, and
is persisted (HLD D5/D13).

**Depends on.** Units 1, 2. Touches `src/engine/types.ts` (D31).

```
Unit 4 of Phase 2: setup.

Engine change first (D31): in `src/engine/types.ts`, widen the contract to
`setup(seats: number, options?: unknown)`. Thread `options` from the
create-game route body (optional, kind-specific, opaque) through to
setup(). cradle ignores it. Adjust routes/actionlog minimally; P0 tests
must stay green untouched apart from type-level fallout.

Create `src/oath/game/setup.ts`:

  - SetupSpec: the seed-shaped description of an opening position — reuse
    or mirror ParsedSeed from src/oath/chronicle/seed.ts (sites + their
    cards, world deck contents, dispossessed, relic locations, oath,
    citizenship, suit order). Define it here; unit 18 converts a real
    seed string into it.
  - FIRST_GAME: SetupSpec — the rulebook's prescribed first-chronicle
    layout (sites and starting denizens are FIXED for the first game;
    transcribe them from the rulebook's setup diagram, citing it). Every
    id must resolve via byId; get ids from byName so aliases protect you.
  - OathSetup: what gets persisted — the spec plus every random outcome:
    world deck order (shuffled per rulebook), relic deck order, initial
    deals (starting hands if the rulebook deals any, relics placed at
    sites per their relicCount), starting warbands/favor/secrets per the
    rulebook's player-count table.
  - oathSetup(seats, options?): OathSetup — impure (real shuffles via
    engine/random), called once at creation. options may carry a seed
    string LATER (unit 18); for now only FIRST_GAME.
  - init(setup: OathSetup): OathState — pure assembly, no randomness.

TDD, `test/oath/game/setup.test.ts`:
  - init(fixed OathSetup) is deterministic: two calls deep-equal
  - init output passes checkInvariants for 2..6 seats
  - the un-dealt world deck + hands + sites + dispossessed partition the
    denizen set (nothing lost, nothing duplicated)
  - two oathSetup() runs differ in world deck order (shuffle happened)
  - FIRST_GAME resolves: every card id exists; site count and regions
    match REGION_SITE_COUNTS
  - per-seat starting resources match the rulebook table (cited)

Commit: "Add Oath setup and initial state; engine accepts creation options"
```

**Done when.** A valid opening state exists for 2–6 seats; randomness lives
only in `oathSetup`.

## What unit 4 established (as built, 2026-09-09)

- **`SetupSpec` fixes board structure only — never the world/relic deck
  order.** Sites, their starting denizens, pre-placed relics, oath,
  citizenship, and starting pawn sites are the spec's job; the world pool
  and relic pool are fields on the spec (`worldPool`/`relicPool` — "every
  card not otherwise placed"), but their SHUFFLE happens in `oathSetup`,
  every call, using real randomness. This is why `FIRST_GAME` can be a
  plain static constant (matching D30) while still yielding a different
  deal each time it's used — and it's why the "two `oathSetup()` calls
  differ" test is meaningful at all despite `FIRST_GAME` being fixed.
  Unit 18's `specFromSeed` should follow the same split: whatever a real
  seed's export already fixed goes in the spec; the deal is still fresh.
- **The Archive is out of scope for P2 — confirmed, not assumed.** Oath
  does not put all 198 denizens into a single game (Law §8.4/§8.8: most
  of them sit in per-suit "Archive" stacks, entering play only via
  chronicle-transition rules). A single non-chronicle game's active pool
  (world deck + sites + discards + hands) is a SUBSET of the full card
  set, confirmed against the box's own first-game packet (41 world-deck
  cards, not 198). `checkInvariants` (unit 1) already tolerates this — it
  never required full 198-card coverage, so no state.ts change was
  needed. `oathSetup` puts every non-fixed denizen/vision into `worldPool`
  (not a smaller curated subset) since P2 has no Archive zone to hold the
  rest and unit 19 needs a deck deep enough to finish a game.
- **FIRST_GAME's site layout required going beyond the rulebook's own
  prose.** The Playbook's "Setup for the First Game" names only 6 of 8
  opening sites; the publisher's own "Oath Deck Order" packet PDF
  resolved the other 2 (Provinces' 2nd site is Buried Giant, Hinterland's
  2nd is Great Slum) — recorded in RULINGS.md with the source.
- **FIRST_GAME is fixed at exactly 4 seats** (the box's Chancellor + 3
  Exiles) — the rulebook has no other-seat-count first-game layout.
  `oathSetup` throws `IllegalAction` for any other seat count until unit
  18 adds seed-driven setups. `init`, however, is fully general (tested
  for 2–6 seats via hand-built `OathSetup` fixtures) — only the *spec*
  is 4p-specific, not the assembly code.
- **Per-player starting pawn site, for seat counts other than 4, is an
  engineering choice, not a rulebook fact** — the rulebook only
  demonstrates 4 players. Not exercised by `FIRST_GAME` itself; unit 18's
  seed-driven setups won't have this problem (a real seed fixes pawn
  positions... except it doesn't, per the next point).
- **Real chronicle seeds don't carry player hands/advisers/pawn positions
  at all** (checked the vendored `OathGame` interface — no such fields).
  So the "steps 19–23" deal (region discards, each seat drawing 3 and
  keeping 1 as a facedown adviser) is NOT first-game-specific — it is
  something `oathSetup` must do for EVERY new game, seeded or not. Unit
  18 should reuse this unit's dealing logic rather than re-deriving it.
- **Resolved: starting Supply is 7 for both the Chancellor and the
  Exile**, not 7/5 as first guessed. Neither board prints a numeral
  directly, but both Supply tracks have the same length (8 spaces: a
  distinct unlabeled "leftmost" space, then warband-count brackets for
  the Rest refresh per Law §4.3.3, then blanks) — counting from the
  depleted end at 0, leftmost is 7 on both. Corroborated by the
  citizenship rules (§6.6.2, §6.7, §6.8), which all say "refresh Supply
  to its leftmost space" as an effect distinct from a normal Rest — a
  real, named position, not setup-only decoration. `CHANCELLOR_STARTING_SUPPLY`
  / `EXILE_STARTING_SUPPLY` in `setup.ts` are both 7. The full Rest-refresh
  table (Law §4.3.3) is now resolved too, ready for unit 5: Chancellor
  18+/17–11/10–4/3–0 → supply 6/5/4/3; Exile 9+/8–4/3–0 → supply 6/5/4;
  a Citizen doesn't use their own warband count at all — they copy
  whatever Supply value the Chancellor currently holds. See RULINGS.md.

---

## Unit 5 — Turn skeleton and definition assembly ✅ (completed 2026-09-10)

**Purpose.** The game becomes a registered, runnable `GameDefinition` with
the smallest real loop: turns advance, supply refreshes, pending and
projection work. Everything after this unit plugs into it.

**Depends on.** Units 1, 4. **Needs Q5 answered.**

```
Unit 5 of Phase 2: the turn skeleton and GameDefinition.

Create `src/oath/game/turn.ts` and `src/oath/game/index.ts` exporting
`oath: GameDefinition<OathState, OathSetup>` with kind 'oath', and
register it in DEFS in src/routes.ts.

Architecture (this is the phase's chassis — get it right here):
  - reduce dispatches on action.type through a Record<string, Handler>;
    unknown type → IllegalAction. Handlers are registered by each action
    module; this unit registers 'game.created' and 'turn.rest'.
  - an ordered array of turn-boundary checks (start-of-turn and
    end-of-turn pipelines). Units 16–17 append checks; nothing edits
    existing ones. Each check is (state) => state and may set pending
    flags or complete the game.
  - every handler increments actionCount exactly once, in one shared
    wrapper — not per-handler.

Behaviour in this unit (rulebook-cited):
  - turn order: who acts first and how the turn passes (rulebook)
  - 'turn.rest': ends the acting player's turn, refreshes their supply
    per the rulebook's rest rule, advances activeSeat, runs the
    end-of-turn then start-of-turn pipelines
  - pending(): while the game runs, exactly one decision — the active
    seat's turn — kind 'turn', id per the actionCount convention,
    resolves listing the action types that exist so far
  - project(state, seat): REDACTING FROM DAY ONE — own hand visible,
    other hands as counts; facedown advisers as counts/backs for others,
    identities for the owner; world deck, relic deck, dispossessed as
    counts only; everything public passes through. Spectator (null) sees
    what a player-agnostic observer may see per the rulebook.
  - isComplete reads state.complete (false until unit 17 sets it)

TDD, `test/oath/game/turn.test.ts` (+ extend helpers if needed):
  - rest: legal for the active seat; illegal-actor for another seat;
    supply refreshed per rulebook; activeSeat advances in rulebook order
    and wraps
  - pending returns exactly one decision for the active seat with a
    stable id that CHANGES after the turn passes
  - project: own hand ids visible; other seat's hand is a count with no
    ids anywhere in the JSON (assert by stringify + absence of the ids);
    deck orders absent
  - through the HTTP layer (in-process, like P0's tests): create a kind
    'oath' game, GET the view for two different seats, POST a rest with
    prevSeq, get 409 on a stale replay of it

Commit: "Add Oath turn skeleton; register the definition"
```

**Done when.** An `oath` game can be created over HTTP and turns pass by
resting; projection redacts; 409s work.

## What unit 5 established (as built, 2026-09-10)

- **Projection is stricter than the plan's own text.** The plan said
  "world deck... as counts only" — that over-reveals. Law §9.4 makes the
  world deck's SIZE private, not just its contents (every other zone —
  relic deck, reliquary, dispossessed, discards — shows a count with
  identities stripped; only the world deck shows nothing at all,
  `worldDeck: {}`). Verified live: `JSON.stringify(view.worldDeck)`
  contains no digit. Discard-pile counts ARE public per the same
  section's explicit carve-out ("this includes... number of cards in
  discard piles") — don't hide those.
- **Site relics redact to a count for EVERY viewer, including the
  ruler.** Law's minor-action list has "peek at relics at your site" as
  something you DO, not something you already know — nobody has relic
  identity by default. Revisit this the moment a peek action exists.
- **A facedown site hides its own identity, not just its cards.** `id:
  null` when `facedown: true` — the site card itself hasn't been
  revealed (Law §2.8), so its region and slot-facing show, nothing else.
- **`OathState.turn` gained `turnStartedAt`** (additive, per unit 1's own
  convention) to make the 'turn' pending decision's id
  (`` `turn:${activeSeat}:${turnStartedAt}` ``) stable across every
  action taken mid-turn while still changing the instant the turn
  passes — using live `actionCount` directly would have churned the id
  on every action, breaking the notification-dedup promise (HLD D8) the
  whole convention exists for. **Any future decision kind needs the same
  pattern**: capture the actionCount value once, when the decision
  arises, not read it live.
- **`reduce`'s shared wrapper increments `actionCount` BEFORE dispatch,
  not after** — the one deliberate deviation from a literal reading of
  "every handler increments actionCount... in one shared wrapper." This
  lets `turn.rest` stamp `turnStartedAt` from the very value this action
  will be remembered by, with no special-casing in the generic wrapper
  itself.
- **Handlers are assembled by import, not a mutable registry.** Each
  action module exports its own `*_HANDLERS` map (`TURN_HANDLERS` here);
  `index.ts` is the only file that spreads them together
  (`{ ...TURN_HANDLERS, ...PLAY_HANDLERS, ... }` as units 6+ land). No
  registration side effects, and each module's handlers are unit-testable
  in isolation.
- **`pending()`'s `resolves` list is live, not hand-maintained** — it's
  `Object.keys(HANDLERS)` minus `'game.created'`, read from the same
  assembled map `reduce` dispatches through. It grows automatically as
  units 6+ register actions; nobody needs to remember to update a
  separate list.
- **Two Rest sub-rules deliberately simplified, both flagged in
  `turn.ts`'s header, not silently guessed:**
  - **Law §4.3.2's secret return only sweeps the resting seat's own
    adviser cards**, not secrets on site cards. The rule returns them
    "to YOUR board," but state doesn't track WHICH seat placed a token
    on a shared site card (unit 3's `siteCardSecrets` zone has no owner
    field) — that's unit 14/15's question once `power.use` is what
    actually places such tokens. Currently unreachable either way: no
    action yet exists that could put a secret on a site card.
  - **Law §4.3.4's "Save Supply" reads the player's CURRENT supply
    value as "not spent this turn"** rather than tracking a separate
    "supply at turn start" field — correct for now because no action
    costs Supply yet (units 6+), so nothing could have been spent.
    Whichever unit adds the first Supply-costing action must add that
    tracking field and revisit `rest()`'s computation in `turn.ts` —
    flagged there explicitly so it isn't missed.
- **`'game.created'` is registered but dead code in the current fold
  path** — confirmed by reading `actionlog.ts#loadState`: it folds from
  `init()`'s seq-0 output, never replaying the seq-0 marker through
  `reduce` at all (cradle's own reducer has no `'game.created'` case
  either). Registered anyway, per the plan, as free insurance against a
  future fold path that does include it.

---

## Unit 6 — Playing cards from hand ✅ (completed 2026-09-10)

**Purpose.** Cards leave hands and enter the world — the prerequisite for
Muster, Trade, and every power.

**Depends on.** Units 3, 5.

```
Unit 6 of Phase 2: playing cards.

Create `src/oath/game/actions/play.ts` registering 'card.play':
payload { cardId, as: 'adviser' | 'site', siteId?, facedown? }.

Encode the rulebook's card-playing rules, cited per rule:
  - when a card may be played and what it costs, if anything
  - adviser placement: facedown/faceup rules, any per-seat limit
  - site placement: which site is legal (your site?), slot capacity,
    and what happens on a full site (whatever the rulebook says —
    replacement/discard/refusal — encode exactly that)
  - where a displaced or discarded card goes (which discard pile)
  - visions: the rulebook's special handling (who may hold/play them,
    what playing one means). If vision victory mechanics belong to unit
    17, here only enforce placement legality and leave a TODO citing
    unit 17.

Implement the state change through applyEffects with card movers where
the vocabulary fits; add an effect tag only if genuinely needed (D33).

TDD, `test/oath/game/play.test.ts`:
  - legal adviser play and legal site play from baseState variants
  - illegal-actor; illegal-state: card not in hand, wrong site, capacity
    exceeded (or the rulebook's full-site behaviour asserted)
  - discard destination is the rulebook's pile
  - invariants hold after every case

Commit: "Add playing cards from hand"
```

**Done when.** Both placements work with the rulebook's constraints; the
full-site rule is encoded and cited.

## What unit 6 established (as built, 2026-09-10)

- **`PlayerState.pawnSite` added** (additive). Unit 4 left pawn location
  out of state entirely ("a seat's location is wherever its warbands
  sit" — which was wrong: warbands and pawns move independently). Unit 6
  is the first that needs "your site" (§5.1.4.1). `init()` seeds it from
  `SetupSpec.startingPawnSite`; **unit 9 (Travel) mutates it**;
  `checkInvariants` requires it to name a real site. Every "your site" /
  "your region" rule from here on resolves through this field.
- **`card.play` is the placement step of Search (§5.1.4), not a
  standalone turn move.** It operates on the transient `hand`, which
  nothing populates yet (Search's draw step is unit 10). Unit 6 tests it
  against hand-built states. It does NOT advance the turn (Search is one
  Act-Phase action; you keep playing after). **pending() and turn.rest
  are untouched** — enforcing "a non-empty hand is a blocking decision
  you must resolve" is unit 10's job (Search owns its flow); unit 6 just
  registers the handler so `pending().resolves` picks it up.
- **Payload extended past the plan's `as: 'adviser' | 'site'`** to
  `'site' | 'adviser' | 'vision' | 'discard'` — the rulebook demands it:
  §5.1.4.3 puts a revealed Vision on the Revealed Vision space (neither a
  site nor an adviser), and §5.1.4 lets you discard the kept card
  outright. `card.play` also auto-discards every OTHER card left in hand
  (Search §5.1.3+5.1.4 combined into one action — the "one action
  indexing the drawn set" model unit 10's prompt lists first).
- **Over the 3-adviser limit → `discardAdviserId` in the payload**, not a
  mid-action pending decision. Keeps the whole choice in one log entry.
  A guard rejects discarding a token-bearing adviser ("not yet
  supported") — unreachable now (nothing puts tokens on advisers yet),
  resolved properly in unit 14 alongside the flipped-secret gap.
- **No new effect tag** (D33 held). Everything composes from unit 3's
  `card`/`favor`/`flip` movers — including the "clear the slot first"
  ordering for replacing a Revealed Vision (old vision → discard, then
  new vision → the now-empty slot).
- **Deferred, flagged in `actions/play.ts`'s header:**
  - The People's Favor holder's §5.1.4.1 exception (play to any site in
    your region, discarding a card there first) — needs a "which card"
    choice; TODO.
  - The Conspiracy's faceup play (§5.1.4.4: burn a secret, seize a
    relic/banner) — that's `power.use` territory (D34), unit 14. Unit 6
    allows the Conspiracy only as a facedown adviser.
  - Vision victory (§3.2) — unit 17's pipeline. Unit 6 only places the
    card.

---

## Unit 7 — Muster

**Purpose.** First of the six actions: warbands onto the map.

**Depends on.** Unit 5 (and 6 for realistic states).

```
Unit 7 of Phase 2: Muster.

Create `src/oath/game/actions/muster.ts` registering 'muster'. Encode the
rulebook's Muster action precisely and cite it: its supply cost, what you
choose (which card/site), how many warbands arrive and from where
(the seat's supply), and every precondition the rulebook states.

TDD, `test/oath/game/muster.test.ts`:
  - legal muster moves the right number of warbands supply→site and
    spends the right supply
  - illegal-actor; illegal-state: insufficient supply, invalid choice,
    empty warband supply (whatever the rulebook says happens then —
    encode it)
  - invariants (warband conservation) after each case

Commit: "Add Muster action"
```

**Done when.** Muster matches the rulebook with citations.

---

## Unit 8 — Trade

**Purpose.** The favor/secret economy comes alive: banks, suit counting.

**Depends on.** Units 5, 6.

```
Unit 8 of Phase 2: Trade.

Create `src/oath/game/actions/trade.ts` registering 'trade'. Encode the
rulebook's Trade action, cited: supply cost, choosing a card to trade
with, what determines how much favor (or secrets) you gain — the
rulebook's counting rule over suits among your advisers/sites — which
bank it comes from, and what happens when a bank runs dry.

Put the suit-counting rule in a pure exported helper — Search or powers
may need it later.

TDD, `test/oath/game/trade.test.ts`:
  - a favor trade and a secret trade with hand-built adviser/site
    configurations whose expected yield is computed in the test from the
    rulebook rule (cited)
  - the empty-bank edge per the rulebook
  - illegal-actor; illegal-state: insufficient supply, invalid card
  - favor conservation invariant throughout

Commit: "Add Trade action"
```

**Done when.** Yields match hand-computed rulebook examples.

---

## Unit 9 — Travel

**Purpose.** Movement, using unit 2's geometry, plus whatever the rulebook
says happens on arrival.

**Depends on.** Units 2, 5.

```
Unit 9 of Phase 2: Travel.

Create `src/oath/game/actions/travel.ts` registering 'travel'. Encode,
cited: supply cost from travelCost(from, to) plus any modifiers the
rulebook states; where your pawn may go; what happens when arriving at
a site (the rulebook's arrival/reveal procedure, if any — if a site can
be facedown/undiscovered in the base game, implement the reveal here;
if that's chronicle-only, note it for unit 18).

TDD, `test/oath/game/travel.test.ts`:
  - travel within and across each region pair charges the table cost
  - illegal-actor; illegal-state: insufficient supply, no-op travel if
    the rulebook forbids it
  - the arrival procedure's observable effects, if any
  - invariants throughout

Commit: "Add Travel action"
```

**Done when.** All region-pair costs exercised through the action.

---

## Unit 10 — Search

**Purpose.** The world deck moves. Hidden information is handled for real:
draws, choices, discards — none of it may leak through the log or views.

**Depends on.** Units 5, 6.

```
Unit 10 of Phase 2: Search.

Create `src/oath/game/actions/search.ts` registering the search flow.
Encode the rulebook's Search, cited: supply cost, choosing what to search
(world deck vs which discard pile, per the rulebook's location rules),
how many cards you draw, what you may keep vs must discard and where
discards go (order/facing per rulebook), and the rulebook's vision rule
during Search if there is one.

Design constraint (HLD D5/D13): draws are pop() from the stored order.
The action payload names the CHOICE (deck vs pile), never the drawn ids —
the reducer learns them from state. If the keep/discard decision is a
separate choice the player makes after seeing the draw, model it as the
rulebook implies: either one action whose payload indexes into the drawn
set, or a two-step action with a pending decision in between — pick the
smallest shape that keeps drawn-card identities OUT of the payload of the
first step and OUT of other seats' projections. Document the choice in
the file header.

TDD, `test/oath/game/search.test.ts`:
  - a search draws the rulebook count from the chosen source in stored
    order; kept card reaches the hand; discards land per rulebook
  - the action log for a search (through the HTTP layer) never contains
    a drawn card id that ended up hidden — assert on the raw log
  - another seat's projection during/after the search shows counts only
  - illegal-actor; illegal-state: insufficient supply, empty source per
    rulebook
  - invariants throughout

Commit: "Add Search action"
```

**Done when.** Search works and the log/projection leak test passes.

---

## Unit 11 — Recover

**Purpose.** Relics and banners change hands outside campaigns.

**Depends on.** Unit 5.

```
Unit 11 of Phase 2: Recover.

Create `src/oath/game/actions/recover.ts` registering 'recover'. Encode,
cited: supply cost; recovering a relic at your site (its cost per the
rulebook and where the payment goes); recovering a banner (the rulebook's
bid/threshold rule — pay more than what's on it, per its exact wording —
and what happens to the previous holder's stake); anything special the
two banners' own rules add STRUCTURALLY (their ongoing powers are
declared via power.use later, not implemented here — but if the rulebook
ties recovery conditions to a banner's identity, encode that).

TDD, `test/oath/game/recover.test.ts`:
  - relic recovery: payment flows to the rulebook destination, relic
    reaches the seat
  - banner recovery: the threshold rule with boundary cases (equal is
    illegal if the rulebook says "more"), stake handling
  - illegal-actor; illegal-state: wrong site, can't pay
  - invariants (favor/secret conservation) throughout

Commit: "Add Recover action"
```

**Done when.** Both recovery types match cited rules with boundary tests.

---

## Unit 12 — Campaign I: declare, respond, roll

**Purpose.** The campaign's action sequence — the hardest design in P2 and
the foundation P3 builds interrupts on. Dice roll in `prepare()` and land in
the payload (HLD D14).

**Depends on.** Units 2, 5. **Design-heavy; read the campaign chapter fully
before writing anything.**

```
Unit 12 of Phase 2: campaign declaration through dice.

Read the rulebook's campaign chapter end to end first. Then design the
action sequence and record it in `src/oath/game/actions/campaign.ts`'s
header as the authoritative description. Constraints:

  - Multi-step: at minimum 'campaign.declare' (attacker: targets and
    committed warbands, legality checked — supply cost, targetable
    things per the rulebook incl. citizenship restrictions read from
    state), then a defender response window surfaced via pending() (the
    naive P2 window: the defender may power.use battle-relevant cards,
    then submits 'campaign.respond' to close the window; P3 will batch
    this), then 'campaign.roll'.
  - Dice: 'campaign.roll' computes dice counts (attack dice from the
    rulebook's formula over committed forces and modifiers; defense dice
    likewise) in prepare(), rolls there via engine/random, and persists
    the FACES (not sums) in the payload. reduce only reads faces. Cite
    the dice faces and counts.
  - Whether one declaration can name multiple targets, and how rolls
    relate to targets, is whatever the rulebook says — encode exactly
    that and note it in the header.
  - The in-progress campaign lives in state.campaign (fill unit 1's
    placeholder type); while it is non-null, pending() surfaces whose
    move it is instead of the normal turn decision, and other actions
    by either party are illegal-state.

TDD, `test/oath/game/campaign1.test.ts`:
  - a legal declare stores the campaign sub-state and pending() moves to
    the defender with a stable id
  - illegal declares: bad target, over-commit, citizenship restriction,
    insufficient supply
  - respond closes the window; pending() moves to the attacker's roll
  - roll: payload contains faces; reduce is a pure function of them —
    fold the same log twice (wipe snapshots via the actionlog API) and
    deep-equal the states (HLD exit criterion)
  - dice counts match the rulebook formula for two hand-built forces
  - invariants throughout (committed warbands counted)

Commit: "Add campaign declaration, response window, and dice"
```

**Done when.** The sequence is documented and tested through the roll, and
replay reuses persisted dice.

---

## Unit 13 — Campaign II: resolution

**Purpose.** Campaigns finish: winner, casualties, sacrifice, seizure.

**Depends on.** Unit 12.

```
Unit 13 of Phase 2: campaign resolution.

Extend the campaign module (additively — new action types, no edits to
unit 12's handlers) with resolution per the rulebook, cited:

  - computing the outcome from the persisted faces: the rulebook's
    attack/defense arithmetic, exactly
  - the attacker's sacrifice option (if losing, per the rulebook's rule)
    — a choice, so it's an action ('campaign.sacrifice' or a payload
    field on a resolution action; pick the shape that keeps every choice
    in the log)
  - casualties on both sides per the rulebook (skull faces etc.), where
    dead warbands go
  - per-target seizure on a win: site control effects, relics/banners
    taken (if the rulebook gives the loser or winner choices about which,
    surface them as pending decisions naively — one at a time is fine in
    P2), oath-relevant transfers (oathkeeper status is unit 17's check;
    here just move the objects)
  - campaign sub-state cleared; turn continues per the rulebook

TDD, `test/oath/game/campaign2.test.ts`:
  - a scripted win and a scripted loss from fixed faces, outcomes
    hand-computed from the rulebook (cited)
  - sacrifice branch: taking it flips the outcome per the rules
  - casualties match the faces; conservation invariant catches any drift
  - seizure choices appear as pending decisions and resolve
  - full campaign end to end through the HTTP layer: declare → respond →
    roll → resolve, then a snapshot wipe + refold reproduces the final
    state byte-identically

Commit: "Add campaign resolution"
```

**Done when.** Scripted campaigns resolve to hand-computed outcomes and
survive replay.

---

## Unit 14 — Declared powers: `power.use`

**Purpose.** The v1 answer to 200 cards (HLD D9/D28): name the card, declare
the effects, engine checks feasibility only.

**Depends on.** Units 3, 5 (6 for realistic states).

```
Unit 14 of Phase 2: the power.use action.

Create `src/oath/game/actions/power.ts` registering 'power.use':
payload { cardId, effects: Effect[], note?: string }, validated by
EffectSchema in prepare (reject malformed shapes before they're logged).

Legality (structural only — HLD §4):
  - the named card must be visible in play in a zone the actor could
    plausibly use it from (their adviser, a site card where the rulebook
    would let them, a relic/banner they hold — D34: relics and banners
    use this same action); encode the zone check, cite what the rulebook
    says about who may use a card's power
  - effects apply via applyEffects — every infeasibility rejects the
    whole action, nothing partial
  - timing: usable on your turn; during a campaign response window,
    usable by the window's owner (unit 12 opened this door). Nothing
    finer — v1 leaves text-level timing to the players.
  - the engine never checks effects against card text. Say so in the
    file header.

TDD, `test/oath/game/power.test.ts`:
  - a declared power spending favor and moving warbands applies and logs
    with the card id and effects visible in the log (the log is safe to
    share — this action is exactly what players did)
  - infeasible effects reject: favor you lack, warbands not present,
    card not where claimed (HLD exit criterion — cite it)
  - malformed payload rejected in prepare, nothing persisted
  - a power.use during another seat's campaign window by the window
    owner succeeds; by anyone else is illegal-actor
  - invariants throughout

Commit: "Add declared power.use action"
```

**Done when.** Declared powers work; every infeasibility class tested.

---

## Unit 15 — Powers registry and the enforcement seam

**Purpose.** Prove D28: enforcement can arrive card by card with no change to
the log, the reducer, or the action shape. The registry ships empty.

**Depends on.** Unit 14.

```
Unit 15 of Phase 2: the enforcement registry.

Create `src/oath/powers/registry.ts`:
  - PowerImpl = (state: OathState, seat: number, choices: unknown)
      => Effect[]
  - an EMPTY Record<cardId, PowerImpl> plus register/lookup helpers
    (register throws on duplicate id; a test-only reset helper is fine)

Wire the seam into power.use's prepare (D34 — enforced replaces
declared): if the payload's cardId has a registered impl, prepare IGNORES
any client-declared effects, calls the impl with payload.choices, and
persists { cardId, effects: <produced>, choices } — the SAME payload
shape a declaration produces, so the log and reducer are unchanged. If no
impl, prepare passes the declared effects through as before.

The registry stays empty in src/. One card is implemented INSIDE A TEST
to exercise the seam (HLD exit criterion): pick a mechanically simple
real card by id, register an impl in the test (using the reset helper),
and implement its effect production from state — using only its identity
and structure, no card text in the code or test.

TDD, `test/oath/game/registry.test.ts`:
  - with the impl registered: power.use with { cardId, choices } logs a
    payload deep-equal in SHAPE to a declared use of the same card —
    assert the same keys and effect tags; assert declared-vs-enforced is
    indistinguishable to reduce by folding both logs
  - client-declared effects for a registered card are ignored/replaced
  - with the registry empty (reset): the same payload is rejected unless
    it declares effects — the default path still works
  - registry in src/ is empty: assert its size is 0 (guard against
    enforcement creep — HLD §9)

Commit: "Add powers registry; prove the enforcement seam"
```

**Done when.** The same action shape flows both paths; the shipped registry
is provably empty.

---

## Unit 16 — Citizenship

**Purpose.** The Chancellor/Exile/Citizen structure moves: joining the
Empire and its consequences. The static restrictions were already read from
state by earlier units; this unit adds the transitions.

**Depends on.** Unit 5 (12–13 for campaign-adjacent rules).

```
Unit 16 of Phase 2: citizenship transitions.

Create `src/oath/game/actions/citizenship.ts`. Encode the rulebook's
citizenship chapter, cited:
  - how an Exile becomes a Citizen (the rulebook's procedure: when it may
    happen, what is given up or exchanged — warbands, vision, whatever
    the rules say), as an action (plus a Chancellor consent step as a
    pending decision if the rulebook requires consent)
  - how citizenship is lost, if the base rules allow it, likewise
  - the mechanical consequences the rulebook states (warband color/supply
    handling, what happens to the seat's held objects)
  - start/end-of-turn pipeline checks IF the rulebook ties any
    citizenship consequence to turn boundaries — appended to the
    pipeline, never editing existing checks

TDD, `test/oath/game/citizenship.test.ts`:
  - a legal join: state reflects every rulebook consequence; invariants
    (warband conservation across the exchange) hold
  - consent flow if applicable: pending decision for the Chancellor with
    a stable id; refusal path
  - illegal-actor and illegal-state paths per the rulebook's
    preconditions
  - after joining, a previously-legal exile-only act (e.g. holding a
    vision, campaigning against the Empire) is now illegal — pick
    whichever the rulebook states and cite it

Commit: "Add citizenship transitions"
```

**Done when.** Joining works with cited consequences; restrictions flip.

---

## Unit 17 — Victory and game end

**Purpose.** Games end (D35: structurally enforced). Oathkeeper, succession,
visions, and the end-of-game clock.

**Depends on.** Units 5, 16.

```
Unit 17 of Phase 2: victory.

Create `src/oath/game/victory.ts`, appending checks to the turn-boundary
pipelines (never editing existing ones). Encode, cited:

  - oathkeeper tracking: the check that moves oathkeeper status when the
    oath's condition holds for someone else (the rulebook's exact timing
    and tiebreak)
  - the winner check: when the rulebook says the game ends with the
    oathkeeper winning (the timing chapter — encode its exact trigger)
  - vision victory: the check for an Exile holding a satisfied Vision at
    the rulebook's stated moment
  - the end-of-game clock: the rulebook's mechanism for the final rounds
    (IF it involves a die roll, that die is randomness — it must roll in
    prepare() of the action whose resolution needs it and persist in the
    payload, like campaign dice; DO NOT roll in a reducer or pipeline.
    Design the check to read the persisted roll.)
  - on completion: state.complete, state.winner set; every action
    thereafter is illegal-state; pending() returns []

TDD, `test/oath/game/victory.test.ts`:
  - hand-built states on either side of the oath condition: oathkeeper
    moves exactly when the rulebook says
  - a succession/win scenario reaches complete with the right winner
  - a vision win scenario likewise; the same state WITHOUT citizenship
    eligibility does not win (ties to unit 16)
  - the clock: fold a log where the persisted roll ends the game and one
    where it doesn't; wipe snapshots and refold — identical outcomes
  - after complete: any action 400s; pending is empty; isComplete true
    end to end through the HTTP layer

Commit: "Add oathkeeper, vision victory, and game end"
```

**Done when.** All three roads to game end are enforced, cited, and
replay-safe.

---

## Unit 18 — Chronicle-seeded setup

**Purpose.** A game can start from a real TTS/Vassal seed string (D30 pays
off; P5 will produce these).

**Depends on.** Units 4, 5 (P1's `parseSeed`).

```
Unit 18 of Phase 2: create a game from a seed.

Extend `src/oath/game/setup.ts` additively:
  - specFromSeed(parsed: ParsedSeed): SetupSpec — map the parsed seed
    (sites, cards, world deck, dispossessed, relics, oath, citizenship,
    suit order) onto the spec. Where a seed encodes something the state
    tracks (ruined sites, facedown cards, prior citizenship), carry it;
    where the rulebook's setup procedure transforms seed contents
    (shuffles, deals, per-count adjustments for the new player count —
    whatever the rulebook's "setting up from a chronicle" section says),
    apply it in oathSetup as usual, cited.
  - oathSetup(seats, options): if options is { seed: string }, parseSeed
    → specFromSeed; invalid seed or card-count mismatch for the seat
    count throws a message the route surfaces as 400. Otherwise
    FIRST_GAME as before.

TDD, `test/oath/game/seeded-setup.test.ts`:
  - both P1 sample seeds (reuse the strings from
    test/oath/chronicle/seed.test.ts by import or copy-with-comment)
    produce OathSetups whose init passes checkInvariants
  - seed-carried facts survive to state: spot-check oath type,
    citizenship, a ruined/edifice site, a specific site's cards
  - a corrupted seed string → 400 through the HTTP create route, no game
    row created
  - randomized-per-rulebook parts differ between two setups from the
    same seed; seed-fixed parts don't

Commit: "Create games from chronicle seeds"
```

**Done when.** Both sample seeds boot playable, invariant-clean games.

---

## Unit 19 — Acceptance: a full 3-player game

**Purpose.** The phase's headline exit criterion: a 3-player game plays to
completion through the API with powers declared — and its log becomes the
fixture for the audit in unit 20.

**Depends on.** Everything above.

```
Unit 19 of Phase 2: the full-game acceptance test.

Write `test/oath/game/fullgame.test.ts`: a scripted 3-player game driven
entirely through the HTTP layer (in-process), from create to complete.

Scripting approach: the world deck order is whatever setup() rolled, so
the script cannot be a fixed action list. Write a small scripted driver:
a sequence of intents ("seat 1 trades with its hearth adviser", "seat 2
campaigns seat 0's site") that reads each seat's PROJECTED view (never
raw state) to fill in payload details. If an intent is illegal in the
rolled world, the driver fails loudly — adjust the script, don't touch
the engine. Alternatively: make setup() accept a test-only fixed
OathSetup via options and pin the whole game — pick whichever gives a
more readable test and note the choice.

The script must exercise: every one of the six actions at least once,
card.play both ways, at least two power.use declarations, one full
campaign with a defender response, one citizenship transition if the
script can reach it (skip with a comment if not), rests, and an ending
via one of unit 17's roads.

Assertions along the way:
  - after every action: checkInvariants on the folded state
  - mid-game: wipe snapshots, refold, deep-equal (restart survival)
  - at the end: isComplete, winner set, pending empty
  - write the final action log to test/fixtures/fullgame.log.json (only
    if it changed — a drift-style comparison keeps it stable) for unit 20

Commit: "Play a full 3-player game through the API"
```

**Done when.** The game completes; the fixture log is committed.

---

## Unit 20 — Hidden-information audit, cradle removal, docs

**Purpose.** Close the phase: prove projection leaks nothing over a real
game, delete the toy, document.

**Depends on.** Unit 19.

```
Unit 20 of Phase 2: audit and close.

1. Hidden-info audit, `test/oath/game/audit.test.ts` (HLD exit
   criterion): fold test/fixtures/fullgame.log.json prefix by prefix.
   At EVERY prefix, for every seat plus spectator:
     - compute the hidden set from the full state: other seats' hand
       ids, facedown adviser ids of other seats, undrawn world deck ids,
       relic-deck ids, dispossessed ids — minus any id the rulebook
       makes public knowledge in that position
     - JSON.stringify(project(state, seat)) must contain NONE of them
     - the projection also must not encode order info for hidden zones
       (counts are numbers, never arrays of anything id-like)
   Also stringify the raw action log once and assert no hidden-at-end id
   appears in any payload (the log is safe to share — HLD §4).

2. Delete cradle (HLD exit criterion):
   - remove src/engine/cradle.ts and its DEFS entry
   - replay.test.ts: port to a ~20-line inline toy definition declared in
     the test file itself — the actionlog tests must not depend on oath's
     complexity
   - scripts/smoke.mjs: rewrite the game-flow steps against kind 'oath'
     (create, view two seats, one legal action from the projected view, a
     409 check, restart survival) — keep the check count meaningful

3. Docs: root README gains a "Game engine" section (module layout, the
   action list, effects and the enforcement seam, how a game is created
   from a seed, the audit); update "Next" for P3. Short
   src/oath/game/README.md with the file map and the campaign sequence
   diagram from unit 12's header.

4. HLD: tick every P2 exit criterion this closes, set P2 done in the
   phase board, add the shipped-paragraph, note anything deferred to
   P3/P4 in the phase notes.

Run npm test AND the smoke script.

Commit: "Audit projections over a full game; remove cradle; document P2"
```

**Done when.** Audit green over every prefix × seat; cradle gone; smoke
passes against oath; HLD updated.

---

## Order and dependencies

```
1 state ──┬──> 3 effects ──┬────────────────────────> 14 power.use ──> 15 registry
          │                │
2 map ────┼──> 4 setup ──> 5 turn ──> 6 play ──> 7 muster
          │                │          │          8 trade
          │                │          └────────> 10 search
          │                ├──> 9 travel
          │                ├──> 11 recover
          │                ├──> 12 campaign I ──> 13 campaign II
          │                └──> 16 citizenship ──> 17 victory
          └──> 4 ────────────────────────────────> 18 seeded setup

7,8,9,10,11,13,14,15,16,17,18 ──> 19 full game ──> 20 audit + close
```

Q5 (rulebook edition) is resolved — see "Rules authority". Units 6–11 and
14 are parallelizable in principle but do them in
order — each extends `helpers.ts` additively and later ones lean on earlier
states being buildable. 12–13 are the design risk; if they fight back,
that's the feasibility gate talking — stop and reassess rather than hack.

## Mapping to HLD P2 exit criteria

| Exit criterion | Unit(s) |
| --- | --- |
| 3-player game to completion via API, powers declared | 19 |
| Every action: legal / illegal-actor / illegal-state tests | 6–13, 16 (convention enforced throughout) |
| `power.use` rejects infeasible effects | 3, 14 |
| One enforced card via registry, same log shape | 15 |
| Campaign dice from `prepare()` survive snapshot wipe + replay | 12, 13 |
| Hidden-information fuzz over a played game | 10 (spot), 20 (full) |
| `cradle` deleted | 20 |

## Risks

- **Rules fidelity.** I don't have the rulebook; every rule statement above
  is a claim to verify. The conventions (citations on constants, RULINGS.md,
  tests hand-computed from the book) are the mitigation. Budget real time
  with the physical rulebook in units 12–13 and 17.
- **Campaign design (units 12–13) is the feasibility gate.** If the action
  sequence can't be made clean, the HLD says stop and rescope — that's a
  feature of the plan, not a failure.
- **Effect vocabulary creep.** The temptation is to pre-build effects for
  card text. D33's growth rule and unit 15's empty-registry assertion are
  the guardrails.
- **State sprawl.** Unit 1 will miss fields; later units may add optional
  fields to state (additive) — that's expected and fine. Changing the
  meaning of an existing field is not; if that seems needed, stop and
  reassess the unit.
- **Scripting the acceptance game (19) against rolled randomness.** The
  driver-reads-projection approach or the pinned-setup escape hatch — one of
  them will work; don't let this unit balloon.
- **Pending-decision id churn.** The actionCount convention is simple but
  P3 depends on it; if a unit finds a decision whose id can't be derived
  that way, flag it in the unit's commit message rather than inventing a
  second convention silently.
