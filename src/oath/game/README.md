# `src/oath/game` — the Oath rules engine (P2)

A `GameDefinition` (see `src/engine/types.ts`) implementing the Law well
enough to play a full game of base Oath from a chronicle seed to a win.

## The one bargain that shapes everything

**The engine does not know what cards do.** A card power is *declared* by
the player: `power.use` names the card and the deltas it produces, and the
engine checks only two things — that you have **access** to that power
(Law §7.1.1) and that the deltas are **feasible** (the favor exists, the
warbands are there, the card can hold a token). It never reads card text.

That is deliberate, and it is what makes a rules engine tractable at all:
Oath's ~230 cards are the entire difficulty of the game, and an engine that
adjudicated them would be a five-year project that is wrong in a hundred
places. An engine that adjudicates *structure* — turns, supply, campaigns,
titles, victory — and lets a trusted friend group declare card effects is
usable now and wrong nowhere.

Two consequences worth internalising:

- **A power a player can declare is not a deferral.** If a declared power
  can reach a state, that state has to be legal and conserved. The v1
  bargain is only honest while every structurally reachable state works;
  "the engine can't do that yet" is a bug the moment a declaration can
  produce it. Unit 20 found exactly this in `discard.ts`.
- `oath/powers/registry.ts` is the upgrade path. A registered implementation
  **replaces** the declaration for that card. It ships empty; v2 fills it in
  card by card, with no change to anything here.

## Citing the rules

`Law §x.y` means <https://rules.buriedgiant.com>, product `oath`, printing
`p1` — the edition this engine is pinned to. Cite it in comments and commit
messages whenever a line of code exists because a rule says so. "Playbook
p.N" is for component facts the Law doesn't state (how many warbands are in
the box).

Where the Law is genuinely ambiguous and we had to choose a reading, the
choice goes in `RULINGS.md` at the repo root, with the reasoning. Don't
re-litigate one silently.

`RULES-COVERAGE.md` at the repo root dispositions **every numbered
subsection** of §1–§11 as implemented (naming the file and function),
deferred (naming where it's recorded and where it will be done), or N/A.
When you implement or defer something, update it there.

## Layout

```
state.ts        the state shape, the constants, and checkInvariants()
setup.ts        Law §1 — oathSetup/init, first games and seeded chronicles
map.ts          regions, travel costs, the discard cycle
effects.ts      the effect vocabulary; applyEffects() — the ONLY mutator
turn.ts         Law §4.2/§4.3 — requireActiveSeat, the Act phase, Rest
victory.ts      Law §3 and §4.1 — the Wake phase, titles, the win checks
rule.ts         Law §10.21 "Rule" — who rules a site, shared by two callers
restrictions.ts Law §7.2 — restriction banners, for transcribed cards only
discard.ts      Glossary §10.5 — where a discarded card's tokens go
project.ts      Law §9.4 — per-seat redaction. The security boundary.
index.ts        the GameDefinition; the ONLY place handler tables merge
actions/        one module per action, each exporting a *_HANDLERS table
```

### How an action gets wired

Each `actions/<name>.ts` exports a `Record<string, Handler>` and
`index.ts` merges them. That merge point is the only one — adding an action
means adding a module and one line, never editing a switch someone else
owns. Actions needing randomness also register in the parallel `PREPARE`
map: dice are rolled once at append time and persisted into the payload
(HLD D14), never re-rolled during replay.

### `applyEffects` is the only mutator

Every state change goes through `applyEffects(state, actor, effects)`,
which `structuredClone`s internally and returns a **new** object. Effects
are zone-addressed movers (`{kind:'favor', from:{...}, to:{...}, amount}`)
plus a small closed set of non-movers (`flip`, `supply`). The vocabulary
grows only when a rule needs it (HLD D33) — resist adding a verb for a
single call site.

### `requireActiveSeat` is default-deny

`turn.ts#requireActiveSeat(state, action, opts)` refuses anything from a
seat that isn't on the clock, and refuses *everything* while a Search,
Campaign or Wake is mid-resolution. The `opts` (`midSearchOk`,
`campaignOk`, `wakeOk`) are the explicit escape hatches. A new handler that
forgets to call it is a hole, so call it first, always.

Not every prompt locks the table. Citizenship offers, warband permissions
and title choices are **non-locking**: they append to `pending()` and the
asker plays on, so the move is re-validated when it's answered rather than
trusted from when it was asked. Campaign and Wake do lock.

### `checkInvariants` is the safety net

Favor totals 36; each Exile's warbands total 14; the Chancellor plus every
Citizen share 24 purple. Secrets are deliberately **not** conserved (§9.3
exempts them). Call it after every action in tests — it has caught more
rules bugs in this phase than reading the code did, because it fires on
states no fixture was written for.

## Writing tests here

**`FIRST_GAME` is not representative.** It's a 4-player Supremacy first
game: no facedown Cradle top, no ruins, no Citizens, no faceup Opportunity
Site. Seven of P2's fifteen rules defects were invisible for exactly that
reason.
If the rule you're testing involves a chronicle, ruins, Citizens, or the
Reliquary, test it against a **seed** (`test/oath/game/seeded-setup.test.ts`
has two vendored ones) and not against `FIRST_GAME`.

**Don't assert a lucky outcome.** Several tests here asserted results that
depended on dice, on how many cards a Search happened to draw, or on a
shuffle — and were quietly flaky for weeks. Assert the *rule*: compute the
worst case, or assert that the roll was recorded rather than what it came
up. Before declaring anything done, run the suite in a loop, not once.

**Redaction tests compare whole ids, never substrings.**
`JSON.stringify(view).not.toContain(id)` looks right and is not:
`denizen:hospital` is a substring of `denizen:hospitality`, so the
assertion fires whenever the short card is hidden and the long one is
legitimately visible. Use `helpers.ts#expectHidden`, which walks the
structure and compares whole strings.

## Commands

```
npm test          # the full suite
npm run typecheck # src + test + scripts (build only covers src)
npm run build
npm run smoke     # 23 checks against a live server, including a hard restart
```
