# Prompt plan — Phase 3: interrupts

Phase 3 makes multi-party decisions survivable asynchronously. The HLD calls
it the hardest design work in the project, and its constraint section says
why: unmitigated, Oath's campaign resolution and reactive powers make a
six-player async game take months of wall clock. P2 built every decision as
a pending decision resolved by an ordinary action; P3's job is to make the
NUMBER OF PLAYER VISITS small and provable — batching, standing responses,
deep links, and a measured six-player game.

Each unit below is a prompt to hand to Claude Code, in order. Every unit is
TDD: write the failing tests, watch them fail for the right reason, make
them pass, run the whole suite AND `npm run typecheck`, commit. Each stands
alone — a later unit never reopens an earlier one (additive registrations in
the dispatch table, the turn-boundary pipelines, and the standing-response
consult points don't count as reopening).

---

## What was verified on 2026-09-12

Read the code, not the notes — that rule found fifteen P2 bugs, and this
section was compiled the same way.

- P2 is complete: 598 tests + 1 deliberately skipped, `npm run typecheck`
  covers `src` + `test` + `scripts`, 23 smoke checks pass against a live
  server. `RULES-COVERAGE.md` dispositions every Law section.
- **Every interrupt is already a pending decision resolved by an ordinary
  action.** `pending(state)` (src/oath/game/index.ts) emits kinds:
  `turn`, `play` (mid-Search), `wake`, `campaign` (phases respond / roll /
  rolled / casualties / seize, plus per-Citizen ally-volunteer decisions),
  `citizenshipOffer`, `warbands` (permission requests), `oathkeeper`
  (title choice). Ids are `` `${kind}:${seat}:${anchor}` `` where anchor is
  the `actionCount` when the decision arose — stable across polls, distinct
  per instance. Locking decisions (wake, campaign, mid-Search) REPLACE the
  turn decision; the rest are appended alongside.
- **The attacker needs three visits per campaign**: `campaign.roll` (dice
  land in `prepare()`), then `campaign.resolve` (sacrifice), then
  `campaign.seize` (placements/banish/burn). Casualties, when the chooser
  is a different seat, add a fourth party visit. The defender needs one
  (`campaign.respond`), plus each eligible Citizen gets a volunteer
  decision that is "optional and racy by design" (index.ts's own words) —
  the defender's respond closes the window over unanswered volunteers.
- **A Citizen Ally can never act in the window** (campaign.ts header,
  RULES-COVERAGE §5.5.3): with one response phase, a Citizen's permission
  arrives in the very `campaign.respond` that closes the window. The Law's
  own order — §5.5.2 join, then §5.5.3 battle plans — needs two windows.
  Only the mandatory Chancellor Ally (joined at declare) can act today.
- **The Wake Phase takes up to three visits by one seat**: `wake.favor`
  once per `stepsRemaining` (twice on the Mob side), then `wake.take` at an
  Opportunity Site. No information is revealed between the steps.
- **§1.23's setup choices are made FOR the player** (`oathSetup` defaults:
  pawn to the first faceup site, keep the first card drawn). Recorded in
  RULES-COVERAGE §1.23.1/.2 with "Home: P3". The two choices are coupled
  (the pawn's region decides where the two rejects are discarded) and
  sequential (§1.23: "starting with the Chancellor, in turn order").
- **`/inbox`** returns `{gameId, seat, seq, waitingOnYou}` per player
  token. There is no way to resolve a decision id to anything — deep links
  have a stable id to point at but nothing to point it at.
- **The fullgame fixture is frozen on purpose** (unit 20: written once,
  never regenerated on a green run) and `audit.test.ts` refolds it. Any
  change to action shapes or setup semantics breaks the fold of committed
  logs and of any live game on the Fly box. P2 had no such constraint
  stated; P3 must state one before unit 4 changes campaign's shape.
- `standing` appears nowhere in src/. There is no reaction-window
  machinery of any kind; in v1 the campaign response window is the only
  reactive window (all card-text windows are v2).

## Decisions made (recorded in HLD §7 as D49–D54)

1. **D49 — interrupts stay ordinary; P3 ships contracts, not a subsystem.**
   No new dispatcher, no decision queue table: a pending decision computed
   by `pending()` and resolved by a logged action is already rewindable,
   replayable, and projectable for free. What P3 adds is a normative
   catalogue (`INTERRUPTS.md`) enforced by conformance tests: every kind
   the engine can emit is catalogued, every catalogued kind is exercised,
   ids are stable and unique, `resolves` lists are accurate.
2. **D50 — the batching floor is information reveals.** A player's
   consecutive choices collapse into one action's payload unless separated
   by a reveal they had to see first (dice faces, drawn cards). Corollaries:
   the Wake Phase is one action; sacrifice and seizure choices ride on one
   post-roll action; Search stays two actions (the draw is a reveal).
3. **D51 — campaign dice roll in the `prepare()` of the action that closes
   the response window**, not in a dedicated `campaign.roll` submitted by
   the attacker. The roller of record is the window-closer (`respond`, or
   `declare` itself against bandits); the faces land in that action's
   payload exactly as before. This deletes the attacker's pure "come online
   to roll" visit. With D50, the attacker's campaign is two visits
   (declare; resolve-with-seizure) and the defender's is one.
4. **D52 — standing responses are state, written by a logged action.**
   `standing.set` (per seat, global scope in P3) writes a typed policy
   into that seat's state; the engine consults it at the exact point it
   would otherwise raise a pending decision, and short-circuits purely.
   The log stays complete — the policy that caused a skipped window is
   itself in the log, and rollback restores the old policy with everything
   else. Revocation is `standing.set` again and affects future raises
   only. Timeouts never auto-resolve anything (HLD constraint; P6 nudges).
5. **D53 — log compatibility gets an explicit rule.** Through P3, action
   shapes and setup semantics may still change, at the cost of
   regenerating the frozen fixtures (a code-driven regen, which is the
   acceptable kind) and draining the handful of smoke games on the Fly
   box. From P4 on (a client ships; real campaigns start), the log format
   freezes and any change needs an explicit migration story. Every unit
   that breaks folding of existing logs must say so in its commit message.
6. **D54 — §1.23's setup choices become from-init pending decisions**,
   with back-compat carried by the setup record: `OathSetup` grows a field
   saying whether the choices are open or were pre-applied. Old stored
   setups (and the P2 fixtures) fold exactly as before; new games raise
   the decisions. The two coupled choices are one batched action per seat
   (D50), sequential in turn order per the Law.

Also scoped out, with homes: a GENERAL "anyone want to react?" window is
v2 — in v1 no card text is enforced, so the campaign response window is the
only reactive window there is; the HLD's v2 list gains that line. Peeks
stay P4. Notification delivery stays P6 — P3 only guarantees what P6 needs:
stable ids to dedupe on, and a wall-clock "pending since" per decision.

## Decisions needed from you — resolved 2026-09-12

- **Q13 — the standing-response starter set: resolved, proposed set
  stands.** Unit 6 ships exactly three global policies: `defense: 'close'
  | 'ask'` (auto-close my response window), `ally: 'pass' | 'ask'` (never
  volunteer), and `warbands: 'allow' | 'deny' | 'ask'` (Chancellor's
  answer to garrison permission requests). Conditional variants (per site,
  per opponent) stay out until P4 gives them a UI.
- **Q14 — D53's drain rule: resolved, disposable.** The games currently on
  the Fly volume are disposable; unit 4 regenerates the frozen fixture and
  drains them per D53, no fold-compat shim for the old campaign shapes.

---

## Conventions for every prompt

- Repo state assumed: P2 complete as committed. Node 22, TS, ESM, vitest,
  zod. `npm test` and `npm run typecheck` green before and after.
- Red, green, refactor. Watch each new test fail for the right reason.
- Tests in `test/oath/game/` unless a unit says otherwise; HTTP-layer
  tests go through the in-process express app like `fullgame.test.ts`.
- Every game rule cited as `Law §x.y`; anything ambiguous → `RULINGS.md`.
- Every test that produces a state runs `checkInvariants`.
- Every unit that changes which decisions exist updates `INTERRUPTS.md`
  in the same commit — the conformance test makes forgetting impossible.
- No real card text anywhere, as always.

---

## Unit 1 — Interrupt catalogue and pending() contracts ✅ (completed 2026-09-12)

**Purpose.** Fix the ground truth before changing it: one normative
document listing every decision the engine can raise, conformance tests
that keep it honest forever, and a baseline measurement of how many player
visits a P2 game actually took.

**Depends on.** Nothing.

```
Unit 1 of Phase 3: the interrupt catalogue.

1. Write INTERRUPTS.md at the repo root. One row per decision KIND the
   engine can emit (read pending() in src/oath/game/index.ts and every
   sub-state it reads — do not work from memory): kind, who raises it,
   the owning seat, what resolves it (action types), locking or
   non-locking, the id's anchor, and its batching/standing status (all
   'naive' today; later units update rows in their own commits).
   Include a section for decisions that are POSSIBLE but not yet built
   (setup.choose from unit 8) marked 'planned', and a section for shapes
   deliberately out of scope with their homes (general reaction windows
   → v2; peeks → P4; nudge delivery → P6).

2. Conformance tests, test/oath/game/interrupts.test.ts:
   - parse INTERRUPTS.md's table (kind + resolves columns; parse, don't
     duplicate — the provenance test in P1 set the pattern)
   - fold the committed fullgame fixture prefix by prefix; collect every
     pending decision ever emitted: every emitted kind appears in the
     catalogue, and every catalogued kind marked 'built' is emitted
     somewhere in the suite's fixtures (use the fullgame log plus
     hand-built states for the kinds a 3p Supremacy game never raises —
     titleChoice, citizenshipOffer, warbands)
   - for every emitted decision: its `resolves` action types all exist
     in the dispatch table, and at least one test in the suite resolves
     a decision of that kind (assert by folding: after applying a
     resolving action, the decision id is gone)
   - id contracts: within any state, ids are unique; the same state
     folded twice yields identical ids (purity); a decision that
     survives an unrelated action keeps its id (stability across polls
     — pick a non-locking case: a citizenshipOffer while the active
     seat travels)

3. The visit metric, exported from test/oath/game/metrics.ts (a test
   helper, not src/): given an action log, group actions into turns by
   'turn.rest' boundaries; within each turn, a VISIT is a maximal run
   of consecutive actions by the same actor. Report visits per turn
   (avg, max) and visits per campaign. Run it on the fullgame fixture
   and write the numbers into INTERRUPTS.md under "Baseline (P2)" —
   these are the numbers units 4–7 exist to shrink and unit 9 must
   beat.

Commit: "Catalogue every interrupt; enforce the catalogue by test"
```

**Done when.** The catalogue matches the engine bidirectionally, by test;
baseline visit numbers are recorded.

---

## Unit 2 — Decision endpoint, deep links, and pending-since ✅ (completed 2026-09-12)

**Purpose.** Give every stable id something to resolve against: the URL a
notification will carry (P6) and a client will open (P4). Server-side only.

**Depends on.** Nothing (unit 1 for vocabulary only).

```
Unit 2 of Phase 3: resolve a decision id.

1. Add GET /games/:id/decisions/:decisionId to src/routes.ts:
   - auth like /inbox (x-player-token), and the token must belong to a
     seat IN this game (any seat — you can open a link about someone
     else's decision and see the public framing of it)
   - live decision: 200 { gameId, seq, decision, yours: boolean,
     view } where `decision` is the PendingDecision and `view` is
     project() for the REQUESTING seat
   - unknown id that is well-formed: 410 { gone: true, seq,
     waitingOnYou } — a stale deep link (the decision was resolved or
     rolled back away) lands the player somewhere useful, never on an
     error page. This is what makes deep links safe to send to Discord.
   - malformed id: 400
   Decision ids contain ':' — legal in a path segment (RFC 3986); add
   a test that the route matches one literally, no encoding games.

2. Pending-since, for P6's stalled-decision nudges: the anchor inside a
   decision id is an actionCount; the wall-clock moment it arose is the
   createdAt of the action with that seq. In the decision endpoint and
   in /inbox's waitingOnYou entries, attach `since` (ISO string) by
   looking up the anchor's log row. Add `url` (the API path above) to
   each inbox entry. The ENGINE's PendingDecision type does not change
   — since and url are transport concerns, attached in routes.ts
   (record that boundary in a comment; it is a deliberate D49 line).

3. Tests, test/oath/game/decisions-http.test.ts, over the in-process
   app: live 200 with correct `yours` for owner and non-owner; 410
   after resolving it (and after a rollback that unwinds it); 400
   malformed; 401 wrong token; `since` equals the anchor action's
   createdAt; inbox entries carry url + since.

Commit: "Resolve decision ids over HTTP; deep links and pending-since"
```

**Done when.** A decision id from any poll resolves to a live decision or
a useful 410, with wall-clock age attached.

---

## Unit 3 — Batch the Wake Phase ✅ (completed 2026-09-12)

**Purpose.** The simplest locking flow becomes one visit, establishing
D50's pattern (one decision, one action, all owed choices in the payload)
before the campaign units use it in anger.

**Depends on.** Unit 1 (catalogue update).

```
Unit 3 of Phase 3: one-visit Wake.

Today WakeState is resolved by up to stepsRemaining wake.favor actions
plus wake.take — three visits with no information revealed in between,
a pure D50 violation.

1. Replace the flow with ONE pending decision (kind 'wake', same id
   anchor) resolved by ONE action 'wake.resolve' whose payload carries
   every owed choice: an array of §4.1.1 steps (each 'place' |
   {return: suit} — the tied-bank choice per step stays, Law §4.1.1),
   and, when standing at an Opportunity Site, the §4.1.4 take
   ({take: 'favor'|'secret'} | {take: 'none'}). The reducer validates
   the array length against stepsRemaining (recomputing Mob-side
   doubling as it applies step 1 — the payload declares choices, the
   engine still derives obligations), applies in Law order, and clears
   state.wake. Reject wrong-length arrays, illegal returns, takes when
   not at an Opportunity Site.

2. Auto-resolution when NO choice exists: if every owed step is forced
   (§4.1.1's "must place unless you have none" with an empty board and
   no take available), resolve the whole Wake inside the turn-boundary
   pipeline and raise no decision at all — the common case for seats
   not holding the People's Favor is already zero visits and must stay
   zero. (Verify that is true today; keep it true.)

3. Delete 'wake.favor' and 'wake.take' handlers. This breaks folding of
   logs containing them (D53): regenerate the fullgame fixture ONLY IF
   it contains any (check first — its game may hold no People's Favor
   wake), rerun the audit, and say so in the commit message either way.

4. Tests: a Mob-side People's-Favor wake at an Opportunity Site — five
   owed choices, one action, hand-computed final banks (Law §4.1.1,
   §4.1.4); wrong-length and illegal-step rejections; the forced case
   raises nothing; id unchanged across polls while open; catalogue row
   updated to 'batched'; invariants throughout.

Commit: "Batch the Wake Phase into one visit"
```

**Done when.** Any Wake is at most one visit, and forced Wakes are zero.

---

## Unit 4 — Campaign in two attacker visits ✅ (completed 2026-09-12)

> **Finding recorded during this unit.** The prompt's fourth test bullet
> asked for "campaign visits strictly below the recorded baseline" on the
> regenerated fixture. That assertion is **false and was not written**: a
> visit is a maximal same-actor run, and the attacker's old
> `roll`/`resolve`/`seize` were already consecutive, so batching them cuts
> ACTIONS (8 → 5 across the fixture's two campaigns) without cutting
> visits. D51's own arithmetic agrees — it predicts 2 attacker + 1 defender
> = 3 visits for a contested campaign, which is exactly the baseline. A
> visit is only saved where another seat interleaves, i.e. the casualties
> handoff (5 → 4). `metrics.ts` grew a `campaignActions` counter, the three
> cases are pinned in `metrics.test.ts`, and INTERRUPTS.md carries the
> explanation. The phase's headline visit reduction lands in unit 7.

**Purpose.** D50 + D51 applied to the flow that dominates async wall
clock: dice move to the window-closing action, and everything the
attacker decides after seeing the faces becomes one action.

**Depends on.** Units 1, 3 (pattern). **Q14 resolved: disposable, no shim.**

```
Unit 4 of Phase 3: the two-visit campaign.

Today: declare -> respond -> roll -> resolve -> [casualties] -> seize.
Target: declare -> respond* -> resolve -> [casualties], where respond*
carries the dice and resolve carries every post-reveal attacker choice.

1. D51 — dice at window close. Move the dice roll from campaign.roll's
   prepare into the prepare of whichever action closes the response
   window: campaign.respond normally; campaign.declare itself when the
   defender is bandits (no window). The faces land in THAT action's
   payload; reduce stores them and sets phase 'rolled' directly. The
   pool sizes are already fixed at declare, so nothing about the roll
   depends on who submits it. Dice are public; the log stays readable
   (HLD D14's rationale is unchanged — cite it). Delete campaign.roll
   and the 'roll' phase.

2. D50 — one post-reveal action. campaign.resolve's payload becomes
   { sacrifice, seize?: { placements, banishTo?, burnFavor } }:
   sacrifice decides victory (unchanged arithmetic), and on a win the
   seizure choices apply in the same reduce — they depend only on the
   faces and the declare-time targets, no reveal separates them. On a
   loss a supplied seize is rejected (nothing to seize — reject, don't
   ignore: a silently dropped choice is how a client bug hides).
   Delete campaign.seize and the 'seize' phase. The casualties phase
   stays exactly as is — its chooser is usually ANOTHER seat (Law
   §5.5.6 aside), which is a real handoff, not a batching miss; run it
   AFTER resolve as today.

3. D53 fallout, deliberately: the committed fullgame fixture contains
   campaign.roll and campaign.seize actions and no longer folds.
   Regenerate it (delete, rerun unit 19's writer, re-freeze), rerun
   the audit suite, update INTERRUPTS.md's campaign rows AND its
   baseline table (the baseline column keeps the old numbers; add the
   new ones beside them). Commit message names the break per D53.

4. Tests (rework campaign1/campaign2 test files as needed — this unit
   deliberately reopens unit 12's shape, sanctioned by D51):
   - a full campaign against a player: attacker submits exactly two
     actions, defender one; faces arrive in respond's payload; replay
     after snapshot wipe is byte-identical (prepare-persistence
     regression, HLD D14)
   - against bandits: faces arrive in declare's payload; attacker
     total = two actions including declare
   - sacrifice + seizure in one payload: win path applies placements/
     banish/burn; loss path rejects a seize block; sacrifice-exactness
     unchanged (Law §9.5)
   - casualties handoff unchanged when the Chancellor chooses
   - the visit metric on the regenerated fixture: campaign visits
     strictly below the recorded baseline
   - invariants throughout

Commit: "Campaign: dice at window close; one post-reveal attacker action"
```

**Done when.** Attacker two visits (one vs bandits after declare),
defender one, replay exact, fixture regenerated and audited.

---

## Unit 5 — The two campaign windows (§5.5.3) ✅ (completed 2026-09-12)

**Purpose.** Close P2's known gap: a Citizen Ally can never act inside the
single window. The Law's order — §5.5.2 join, THEN §5.5.3 battle plans —
gets its two windows, without adding a visit for anyone in the common case.

**Depends on.** Unit 4.

```
Unit 5 of Phase 3: join window, then plan window.

1. Split phase 'respond' into 'join' then 'respond':
   - 'join' (§5.5.2): every eligible Citizen (the existing eligibility
     rules) owes an answer: campaign.ally { join: boolean } — no more
     racy fire-and-forget volunteering; the decision is owed, with a
     stable id each. The defender simultaneously owes nothing yet.
     The window closes automatically when every eligible Citizen has
     answered (or immediately if none exist), moving to 'respond'.
     The DEFENDER's permission (Law: "with the defender's permission")
     moves to the join window's close: when the last answer arrives,
     raise the defender's permission decision ONLY IF someone joined —
     campaign.permit { allies: number[] } (subset of joiners). If
     nobody joined, skip straight to 'respond' with allies = the
     mandatory Chancellor only (or none).
   - 'respond' (§5.5.3): unchanged from unit 4 — defender and PERMITTED
     Allies may power.use; the defender's campaign.respond closes it
     and its prepare rolls the dice. A permitted Citizen Ally can now
     genuinely act inside the window — the thing P2 could not do.
2. Visit accounting (this is the point — write it in the header):
   worst case adds the defender's permit visit and one visit per
   eligible Citizen. Unit 6's standing responses erase the Citizen
   visits ('ally: pass' answers the join decision at raise time) and
   unit 7 erases the defender's ('defense: close' auto-permits nobody
   and closes both windows). The DESIGN allows one-visit defence; the
   POLICY delivers it.
3. INTERRUPTS.md: campaign rows split into join / permit / respond;
   catalogue test forces the update.
4. Tests: join owed by every eligible Citizen with stable ids;
   auto-close on last answer; permit raised only when someone joined,
   subset-validated; a permitted Citizen power.use in 'respond'
   succeeds (the §5.5.3 regression P2 documented — cite
   RULES-COVERAGE §5.5.3 and flip its DEFER to DONE in this commit);
   an unpermitted joiner is illegal-actor; bandits campaigns skip both
   windows entirely (unit 4 behaviour intact); dice still roll at
   respond; invariants; visit metric on a no-Citizens fixture is
   unchanged from unit 4 (no regression for the common 3p game).

Commit: "Two campaign windows: join then battle plans"
```

**Done when.** A Citizen Ally can act in the window; no-Citizen games pay
no extra visits; every new decision is catalogued.

---

## Unit 6 — Standing responses ✅ (completed 2026-09-12)

**Purpose.** D52's machinery plus the first three policies (Q13). The
principle: a policy is consulted at the exact point a decision would be
raised, and the raise is short-circuited purely.

**Depends on.** Unit 5. **Q13 resolved: proposed set stands.**

```
Unit 6 of Phase 3: standing responses.

1. State: players[seat].standing, a small versioned object:
   { defense: 'close'|'ask', ally: 'pass'|'ask',
     warbands: 'allow'|'deny'|'ask' } — default all 'ask' (identical to
   today). Global only; no per-site/per-opponent conditions in P3
   (HLD's own "start global"). checkInvariants validates the shape.

2. Action 'standing.set': any seat, ON THEIR OWN TURN OR NOT — this is
   the one action legal outside your turn and outside campaign locks
   (it resolves no decision and changes no game object; gate it
   through its own guard, not requireActiveSeat — document why in the
   header). Payload is a partial policy, merged. It is an ordinary
   logged action: rollback restores the previous policy (test this
   explicitly — it is an HLD exit criterion).

3. The consult helper: one function raiseOrResolve(state, decision,
   policyAnswer) used at every raise point that has a policy — NOT ad
   hoc ifs at each site. Raise points wired in this unit:
   - ally join (unit 5): 'pass' answers { join: false } at raise time —
     the join window can close in the same reduce that opened it
   - warband permission (unit 16b's request): 'allow'/'deny' resolves
     the request in the raising action's own reduce — the requester's
     move applies or bounces immediately, zero Chancellor visits
   The defender's 'defense' policy is unit 7's (it composes two
   windows and deserves its own tests).
   Semantics to pin in tests: the SHORT-CIRCUIT NEVER APPENDS AN
   ACTION. The log shows the raising action and a state in which the
   decision never existed; the causing policy is visible earlier in
   the log as its standing.set. Replay is identical because the policy
   is state (D52 — cite it in the helper's header).

4. Revocation: standing.set back to 'ask' affects future raises only —
   a decision already short-circuited stays resolved (test: set pass,
   open+close a join window, revoke, next campaign raises the join
   decision again).

5. INTERRUPTS.md: a standing-response column filled for every row —
   which policy short-circuits it, or why none can (wake and title
   choices are consequential; casualties allocation is consequential;
   citizenshipOffer is negotiated — all stay 'ask' forever unless Ben
   says otherwise; record that as the Q13 outcome).

6. Tests: each policy answer produces the same end state as the
   explicit action it replaces (fold both, deep-equal minus
   actionCount bookkeeping — same-outcome is the correctness claim);
   rollback across a standing.set restores 'ask' behaviour; a 6-seat
   hand-built campaign where all four Citizens have ally:'pass' opens
   and closes the join window in declare's reduce alone; invariants.

Commit: "Standing responses: logged policies consulted at raise time"
```

**Done when.** Policies short-circuit raises purely, log-visibly, and
rollback-safely; the catalogue says which decisions can never be defaulted.

---

## Unit 7 — One-visit defence

**Purpose.** The phase's headline exit criterion: a campaign against a
defender with a standing response resolves in one round trip.

**Depends on.** Units 4, 5, 6.

```
Unit 7 of Phase 3: the one-visit campaign.

1. Wire 'defense: close' into the window machinery: at the moment the
   join window would close into 'respond' (or at declare when both
   windows are empty), a defender whose policy is 'close' auto-permits
   NOBODY (their choice to forgo battle plans includes their allies'
   — document the reading against Law §5.5.3, which makes the defender
   the window's owner; if Ben reads it otherwise, permit joiners and
   still auto-close — RULINGS.md either way) and campaign.respond's
   work happens without the action: the dice then roll in the prepare
   of... nothing. THIS IS THE ONE PLACE D51 NEEDS CARE: dice must
   still roll in SOME action's prepare (D14 — never in reduce). The
   window-closing action is now the LAST JOIN ANSWER, or DECLARE
   itself when no Citizens are eligible. prepareCampaign already
   computes "would this action close the window given standing
   policies" — roll there. The dice land in declare's or the last
   ally's payload; both are public actions everyone can read.
2. End-to-end exit-criterion test (name it after the criterion): a
   campaign where the defender has defense:'close' and every Citizen
   ally:'pass' — the ONLY actions in the log between declare and
   resolve are... none. Attacker declares (dice in its payload),
   attacker resolves. The defender submitted ZERO actions and the
   metric counts ONE defender-side visit total: zero. Assert on the
   log's actor sequence, not just on state.
3. The mixed case: defender 'close', one Citizen 'ask' who joins —
   the join answer closes the window, carries the dice, no defender
   or permit visit (auto-permit rule above). Assert actor sequence.
4. Replay: snapshot wipe + refold byte-identical for both cases (the
   dice moved again — prove D14 held).
5. INTERRUPTS.md: update campaign rows' standing column; update the
   measured-visits table with a "standing defence" row.

Commit: "One-visit campaign against a standing defence"
```

**Done when.** The exit-criterion test asserts a defender-actionless
campaign from the raw log, and replay is exact.

---

## Unit 8 — Setup choices (§1.23)

**Purpose.** The two choices currently made for the player become real,
batched, sequential decisions — the unusual shape (pending from `init`,
before any action) P2 flagged for P3.

**Depends on.** Units 1, 3 (pattern only).

```
Unit 8 of Phase 3: Law §1.23's setup decisions.

1. OathSetup gains setupChoices: 'open' | 'applied' (D54). oathSetup()
   writes 'open' for NEW games and stops defaulting the pawn and
   adviser: the three dealt cards stay in hand, the pawn is unplaced
   (represent explicitly — null pawnSite is new; audit every reader,
   checkInvariants included, for the pre-placement window). Stored
   setups without the field read as 'applied' — old logs and the P2
   fixtures fold byte-identically (test by refolding the committed
   fullgame fixture unchanged; that is D54's whole point).
2. state.setupChoices sub-state while open: seats remaining IN TURN
   ORDER (Law §1.23 is sequential, Chancellor first — only ONE seat
   has a pending decision at a time). pending() emits kind 'setup'
   for the head seat only, locking (nothing else is legal before
   setup completes — even standing.set can wait; simplest lock wins).
3. Action 'setup.choose', one per seat, batched per D50:
   { pawnSite, keepIndex } — pawn to any faceup site (Chancellor:
   must be the top Cradle site, Law §1.23.1 — validate, don't
   default), keep 1 of the 3 (§1.23.2), discard the other two to the
   pile the CHOSEN site's region dictates (Glossary "Discard" — the
   coupling that makes this one decision, cite it). Advance to the
   next seat; after the last, clear the sub-state and start the
   Chancellor's Wake as usual.
4. FIRST_GAME games raise these too (§1.23 applies to any game; the
   box prescribes the map, not your pawn). The 3p/6p test helpers
   gain a completeSetup() driver so every existing test that creates
   a NEW game keeps passing with three extra scripted actions — if
   that touches more than the helpers, stop and reconsider the lock.
5. Tests: sequential order enforced (seat 2 acting before seat 1 is
   illegal-actor); Chancellor's pawn restriction; discard piles land
   by chosen region (hand-computed, both regions); hidden-info — the
   two discarded ids never appear in the action log or another
   seat's view (payload is keepIndex, not card ids — same trick as
   card.play, cite unit 10's precedent); old-setup fold-compat;
   catalogue row 'setup' added; invariants (including the unplaced-
   pawn window).

Commit: "Law §1.23: setup choices are the players', batched and ordered"
```

**Done when.** New games open with real setup decisions; every committed
log still folds; RULES-COVERAGE §1.23.1/.2 flip to DONE.

---

## Unit 9 — The six-player game, measured

**Purpose.** The phase's acceptance: a simulated 6-player game with mixed
citizenship, campaigns with allies, and standing responses — and the
visits-per-turn number the HLD wants recorded.

**Depends on.** Everything above.

```
Unit 9 of Phase 3: six players, measured.

1. test/oath/game/sixplayer.test.ts: a scripted 6-player game over the
   in-process HTTP app, from a chronicle seed that yields Citizens
   (reuse unit 18's machinery; hand-pick or construct a seed with a
   Chancellor + 2 Citizens + 3 Exiles). Drive it like fullgame.test.ts
   (intents against projected views). It must exercise: setup.choose
   for all six; at least two campaigns against an Imperial defender
   with a Citizen joining as Ally and acting in the plan window; one
   campaign against a standing defence (zero defender actions —
   re-assert unit 7's criterion in the 6p context); warband
   permissions answered by policy; a batched Mob-side wake; at least
   one citizenshipOffer negotiated mid-game; play several full rounds
   — enough for the metric to mean something (say through round 3);
   invariants after every action.
2. Freeze its log as test/fixtures/sixplayer.log.json exactly like the
   fullgame fixture (write once; never regenerate on green) and add it
   to the audit suite's inputs — six seats' projections re-audited
   prefix by prefix, and to unit 1's catalogue-coverage fold.
3. Metrics: run the unit-1 visit metric over the frozen log. Write
   into INTERRUPTS.md's table: visits/turn avg and max, visits per
   campaign by flavour (contested, allied, standing). Then write the
   headline numbers into the HLD P3 section (the exit criterion says
   "measured and recorded HERE"). If visits/turn max exceeds 3, treat
   it as a finding: name the decision responsible and either fix it in
   this unit if it is a batching miss, or record it as a Q if it is
   genuinely irreducible (an information reveal).
4. Update RULES-COVERAGE.md rows this phase completed (§1.23, §5.5.3)
   — the unit-20 review discipline: check each claimed DONE against
   the code while writing it.

Commit: "Six players, measured: the async cost of a turn, recorded"
```

**Done when.** The frozen 6p log passes audit and catalogue coverage; the
numbers are in INTERRUPTS.md and the HLD; no unexplained visit spikes.

---

## Unit 10 — Docs and close

**Purpose.** Close the phase the way unit 20 closed P2 — with the claims
checked against the code.

**Depends on.** Unit 9.

```
Unit 10 of Phase 3: close.

1. README: an "Interrupts" section — the decision lifecycle (raise,
   poll, deep-link, resolve, or short-circuit by standing policy), the
   D50 reveal-floor rule, the D51 dice placement, and the visit
   numbers with a pointer to INTERRUPTS.md. Update "Next" for P4.
2. src/oath/game/README.md: update the campaign sequence diagram to
   the two-window shape; note where standing policies are consulted.
3. INTERRUPTS.md: final pass — every row's batching and standing
   columns current; verify each claim names a real symbol (grep it —
   the RULES-COVERAGE discipline, cite D48).
4. HLD: tick P3 exit criteria with pointers (including the recorded 6p
   numbers), set P3 done in the phase board with a shipped paragraph,
   move anything deferred to its named home (P4: conditional standing
   responses if Ben wants them; P6: nudge delivery against the
   pending-since field; v2: reaction windows). Update RULINGS.md if
   any reading was added (unit 7's ally-permission reading).
5. Run npm test, npm run typecheck, and the smoke script; run the
   suite in a loop (the unit-20 lesson — prove the loop ran) before
   calling it done.

Commit: "Document the interrupt machinery; close P3"
```

**Done when.** Docs match code by grep; HLD closed out; suite green in a
loop.

---

## Order and dependencies

```
1 catalogue ──┬──> 3 wake batch ──┐
              │                   ├──> 4 campaign 2-visit ──> 5 two windows ──> 6 standing ──> 7 one-visit defence
2 deep links ─┘ (independent)     │
                                  └──> 8 setup choices (independent of 4–7)

4,5,6,7,8 ──> 9 six-player measured ──> 10 close
```

Units 1–2 are safe warm-ups that harden what exists. Units 4–7 are the
design core and must land in order. Unit 8 can run any time after 1.
The phase's own feasibility signal: if unit 4's dice-at-window-close
fights the store or the replay tests, stop and fall back to keeping
`campaign.roll` (the batching in units 3 and 4.2 still cuts the attacker
to two visits; D51 is the optimization, not the requirement) — record the
fallback as a reversed decision, not a silent retreat.

## Mapping to HLD P3 exit criteria

| Exit criterion | Unit(s) |
| --- | --- |
| Campaign vs standing defender in one round trip | 7 (asserted from the raw log), re-proven in 9 |
| Every interrupt maps to a stable-id pending decision | 1 (catalogue + conformance), maintained by every unit |
| Standing responses are logged actions, roll back cleanly | 6 |
| 6-player round-trip count measured and recorded | 9 (numbers into INTERRUPTS.md + HLD) |
| §1.23 setup choices are real decisions (P2 hand-off) | 8 |
| Citizen Ally can act in the battle-plan window (P2 hand-off) | 5 |

## Risks

- **D51 moves dice across actors.** Dice in another player's action
  payload is novel; if it complicates prepare, rollback, or the audit,
  take the recorded fallback (keep roll, batch the rest) — two visits
  instead of one on defence, still far below baseline.
- **Fixture churn.** Units 3, 4, 8 can each break the frozen fixtures.
  D53 makes that legal but each regen must be deliberate, audited, and
  named in the commit — three casual regens in one phase would erode
  exactly the discipline unit 20 bought.
- **The setup lock (unit 8) touches every test that creates a game.** The
  completeSetup() helper contains the blast radius; if it doesn't, the
  lock design is wrong — reconsider before pushing through.
- **Standing-response scope creep.** Conditional policies (per site, per
  opponent) are seductive and P4's problem. Three global policies, Q13,
  nothing else.
- **The 6p script is the biggest test in the repo.** Keep it intents-
  driven like fullgame; if it balloons, cut scripted rounds before
  cutting exercised decision kinds — coverage of kinds is the acceptance,
  length is not.
