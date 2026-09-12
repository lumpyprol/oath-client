# INTERRUPTS.md — the interrupt catalogue

Every decision the `oath` engine can raise through `pending(state)`
(`src/oath/game/index.ts`), read from the code rather than from memory
(unit 1 of Phase 3; see `prompts/prompt_plan_phase_3.md`). This is
normative: `test/oath/game/interrupts.test.ts` enforces it bidirectionally
— every kind the engine actually emits is catalogued here, and every row
marked **built** is exercised somewhere in the suite. A row that stops
matching a real symbol is a bug in this file, not in the engine.

D49 (HLD §7): interrupts stay ordinary. There is no decision queue and no
new dispatcher — a pending decision is computed fresh by `pending()` and
resolved by an ordinary logged action, which is already rewindable,
replayable, and projectable for free. What follows is the catalogue that
keeps that claim honest.

Every id is `` `${kind-prefix}:${seat}:${anchor}` `` where `anchor` is the
`actionCount` at the moment the decision arose — stable across polls
(nothing about re-fetching `pending()` changes it) and distinct per
instance (a new occurrence of the same kind gets a new anchor).

**Locking** means the decision REPLACES the normal `turn` decision — Law
requires it resolved before anything else can happen (a Wake Phase, a
mid-Search hand, a Campaign's own phases). **Non-locking** decisions are
appended ALONGSIDE whatever else is pending — the rest of the game plays
on while they wait (a Citizenship offer, a warband permission request, the
Oathkeeper's choice, and — while a Campaign's response window is open — a
Citizen's opportunity to volunteer as an Ally).

## Catalogue (built)

| Kind | Raised when | Owning seat | Resolves | Locking | Id anchor | Batching (P3) | Standing (P3) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `setup` | `state.setupChoices` is open — Law §1.23's pawn placement and adviser keep, for the head seat of `remaining` | `state.setupChoices.remaining[0]` | `setup.choose` | yes — a FULL lock: §1.23 precedes §4, so nothing else is legal, not even `standing.set` | `0` (the decision exists from `init`, before any action) | **batched** (unit 8, D50): §1.23.1's pawn and §1.23.2's keep ride one action — coupled, since the chosen site's region decides where §1.23.3's two rejects are discarded | **never** — it is your own opening position, and the game has not started |
| `turn` | Default — no Wake, Campaign, or mid-Search hand is blocking `state.turn.activeSeat` | `turn.activeSeat` | `turn.rest`, `card.play`, `muster`, `trade`, `travel`, `search`, `recover`, `campaign.declare`, `campaign.ally`, `campaign.permit`, `campaign.respond`, `campaign.resolve`, `campaign.casualties`, `power.use`, `citizenship.offer`, `citizenship.accept`, `citizenship.decline`, `citizenship.exile`, `citizenship.selfExile`, `adviser.play`, `warbands.move`, `warbands.allow`, `warbands.deny`, `standing.set`, `setup.choose`, `wake.resolve`, `oathkeeper.grant` | no (the default; replaced by any row below that applies) | `turn.turnStartedAt` | naive | **never** — it is your turn; there is nothing to default |
| `play` | `state.players[seat].hand` is non-empty — a Search's drawn cards await Law §5.1.4's play/discard step | active seat | `card.play` | yes (replaces `turn`) | `player.handDrawnAt` | naive (Search stays two actions per D50 — the draw is a reveal) | **never** (Q13) — consequential, and looking at the draw is the point |
| `wake` | `state.wake` is set — Law §4.1.1's People's Favor maintenance is still owed, and/or the waking seat is standing on an unclaimed Opportunity Site (Law §4.1.4) | `state.wake.seat` | `wake.resolve` | yes (replaces `turn`) | `state.wake.startedAt` | **batched** (unit 3): every owed §4.1.1 step (up to 2, Mob side) and, if owed, the §4.1.4 take all ride one `wake.resolve` — at most one visit; fully forced/no-Opportunity Wakes stay zero, as before | **never** (Q13) — consequential: a §4.1.1 step spends your own favor, and §4.1.4 draws on a supply that is never replenished |
| `campaign` | `state.campaign.phase === 'join'`, once per eligible Citizen not yet in `allyAnswered` (Law §5.5.2) | each Citizen in the frozen `allyEligible` | `campaign.ally` | yes (replaces `turn`) | `state.campaign.declaredAt` | **owed, not optional** (unit 5): every eligible Citizen answers `{ join }` and the window closes on the last answer. Skipped entirely when nobody is eligible, so a 3p game pays nothing | **`ally: 'pass'`** (unit 6) answers `{ join: false }` at raise time, inside `campaign.declare`'s own reduce |
| `campaign` | `state.campaign.phase === 'permit'` — the join window closed with at least one joiner (Law §5.5.2's "with the defender's permission") | `state.campaign.defenderSeat` | `campaign.permit` | yes (replaces `turn`) | `state.campaign.declaredAt` | raised ONLY when somebody joined, so the visit is never spent for nothing (unit 5) | **`defense: 'close'`** (unit 7) auto-permits NOBODY and skips this window — see RULINGS.md 2026-09-12 for the §5.5.3 reading |
| `campaign` | `state.campaign.phase === 'respond'` — §5.5.3's battle-plan window (Law §5.5.3) | `state.campaign.defenderSeat` (numeric — bandits skip this phase) | `campaign.respond` | yes (replaces `turn`) | `state.campaign.declaredAt` | **closes the window and rolls** (unit 4, D51): the dice roll in this action's `prepare()`, deleting the attacker's old `campaign.roll` visit. Against bandits there is no window and `campaign.declare` itself rolls | **`defense: 'close'`** (unit 7) closes this window too, so the defender submits ZERO actions and the roll moves again — to `declare`, or to the last `campaign.ally` answer |
| `campaign` | `state.campaign.phase === 'rolled'` — the attacker resolves sacrifice, victory AND the §5.5.7 seizure (Law §5.5.5-5.5.7) | `state.campaign.attackerSeat` | `campaign.resolve` | yes (replaces `turn`) | `state.campaign.declaredAt` | **batched** (unit 4, D50): sacrifice + placements/banish/burn in one payload; the old separate `campaign.seize` visit is gone | **never** (Q13) — consequential, and it is the attacker's own campaign |
| `campaign` | `state.campaign.phase === 'casualties'` — the defeated force's kill allocation matters (Law §5.5.6's Imperial aside) | `casualtyChooser(state, campaign)` — usually the Chancellor, but the defeated player themselves when not Imperial | `campaign.casualties` | yes (replaces `turn`) | `state.campaign.declaredAt` | naive (a real handoff, not a batching miss — unit 4 leaves this phase alone) | **never** (Q13) — consequential: the allocation decides which warbands die and where survivors land |
| `citizenshipOffer` | `state.citizenshipOffer` is set, from `citizenship.offer` until accepted or declined (Law §6.6.1) | `state.citizenshipOffer.exile` | `citizenship.accept`, `citizenship.decline` | no | `state.citizenshipOffer.offeredAt` | naive | **never** (Q13) — negotiated: the terms differ every time, so a standing answer cannot mean anything |
| `warbands` | `state.warbandRequest` is set — a Citizen's move off-site, or an Imperial give/take, awaiting the required permission (Law §6.5) | `state.warbandRequest.approver` | `warbands.allow`, `warbands.deny` | no | `state.warbandRequest.requestedAt` | naive | **`warbands: 'allow'\|'deny'`** (unit 6) resolves the request inside the requester's own `warbands.move` — allowed applies, denied bounces; zero approver visits |
| `oathkeeper` | `state.titleChoice` is set — several other seats meet the current Oath's goal and the holder does not (Law §2.11) | `state.titleChoice.holder` | `oathkeeper.grant` | no | `state.titleChoice.raisedAt` | naive | **never** (Q13) — consequential: it hands the Oathkeeper title to a named rival |

## Standing responses (unit 6, D52)

The **Standing** column above is the Q13 outcome, decided 2026-09-12: three
global policies, written by a logged `standing.set` and consulted at the
exact point a decision would otherwise be raised.

| Channel | Answers | Consulted in | Wired |
| --- | --- | --- | --- |
| `ally` | `'pass'` → `{ join: false }` | `campaign.declare` | unit 6 |
| `warbands` | `'allow'` / `'deny'` | `warbands.move` | unit 6 |
| `defense` | `'close'` | `settleWindows` — the permit and plan windows | **unit 7** |

Every other row is marked **never**, and that is a decision rather than a
backlog: those decisions are *consequential* (they spend your own
resources, kill your own warbands, or hand a title to a rival) or
*negotiated* (a Citizenship offer's terms differ every time), so a standing
answer could not mean anything. Conditional policies — per site, per
opponent — are P4's, once a UI exists to author them.

Two properties hold for every channel, and `standing.test.ts` asserts both:

- **The short-circuit never appends an action.** The log shows the raising
  action and a state in which the decision never existed. Replay is
  identical because the policy is *state*, reached by folding the same log;
  the cause of a skipped window is visible earlier in that log as its own
  `standing.set`. Rollback across it restores the old behaviour for free.
- **Same outcome.** A short-circuited path lands in exactly the state the
  explicit action would have, modulo `actionCount` and the decision-id
  anchors stamped from it — which differ precisely because one path logged
  one fewer action.

`standing.set` is the one action legal outside your turn and outside a
Campaign's locks. It resolves no decision and touches no game object, and
gating it on `requireActiveSeat` would break the case it exists for: you
suppress a question *while someone else's turn is what keeps asking it*.

## Out of scope

| Shape | Home | Why |
| --- | --- | --- |
| A general "does anyone want to react?" window | v2 | No card text is enforced in v1, so the Campaign response window above is the only reactive window there is; a general window has nothing to attach to yet. |
| Peeks (Law §6.3) | P4 | Needs a client before it means anything; `sites[].relics` stays a redacted count for every viewer, including the site's own ruler, until then. |
| Notification delivery against a stalled decision | P6 | P3 only guarantees what P6 needs: stable ids to dedupe on (above), and a wall-clock "pending since" per decision (unit 2). |

## Baseline (P2)

Measured by `test/oath/game/metrics.ts`'s `computeVisitMetrics` over the
frozen `test/fixtures/fullgame.log.json` (a real 3-player game, unit 19).
A VISIT is a maximal run of consecutive actions by the same actor; turns
are split at `turn.rest` boundaries. These are the numbers units 4-7 exist
to shrink and unit 9 must beat in the six-player game.

| Metric | P2 baseline | After unit 4 | Avg (P2 → u4) | Max (P2 → u4) |
| --- | --- | --- | --- | --- |
| Visits per turn | `[1, 1, 1, 3, 1, 3, 1]` (7 turns) | `[1, 1, 1, 3, 1, 3, 1]` | 1.571 → 1.571 | 3 → 3 |
| Visits per campaign | `[1, 3]` | `[1, 3]` | 2 → 2 | 3 → 3 |
| **Actions** per campaign | `[4, 4]` | `[2, 3]` | 4 → 2.5 | 4 → 3 |
| Total actions in the game | 29 | 26 | — | — |

### Unit 4's finding: batching cut actions, not visits

D50 and D51 did what they set out to do — a contested campaign went from
four actions to three, a bandits campaign from four to two — but the
**visit** numbers did not move at all, and that is not a measurement bug.

A visit is a maximal run of consecutive actions by ONE actor. The
attacker's old `roll` → `resolve` → `seize` were already consecutive:
nobody else acted between them, so they were always *one* visit and
collapsing them into one action cannot save a round trip. What D51
actually deleted was a submit, not a wait.

Two corollaries, both now pinned by tests in `metrics.test.ts`:

1. **Batching only saves a visit when another seat interleaves.** The one
   place unit 4 does buy a real round trip is the casualties handoff: the
   old `seize` came *after* the Chancellor's `campaign.casualties`, so the
   attacker had to come back a third time. Riding the seizure on `resolve`
   drops that campaign from 5 visits to 4. The fullgame fixture happens to
   contain no casualties phase, which is why its numbers are flat.
2. **The defender's visit is untouched by unit 4**, and is where the
   remaining wall clock lives. Units 6-7 are what remove it: a standing
   `defense: 'close'` policy means the defender submits *zero* actions and
   the contested campaign drops from 3 visits to 1. Unit 5's join/permit
   windows will push it up first; units 6-7 pull it back down past the
   baseline.

So the phase's headline number is still on track, but it lands in unit 7
rather than here — and the metric table above should be read as two
independent columns, not one. Actions measure the client's submit count
and the log's length; visits measure the async wall clock.

### Units 5-7: the visits added, then taken back

Unit 5 split the response window into §5.5.2's join window and §5.5.3's
plan window, which is what finally lets a Citizen Ally act inside the
latter. Its worst case costs one visit per eligible Citizen plus one for
the defender's `campaign.permit`. Units 6-7 then answer those windows by
policy. Measured with `computeVisitMetrics` over each flavour's actor
sequence:

| Campaign flavour | Actions | **Visits** |
| --- | --- | --- |
| No eligible Citizens, no policies (every 3p game) | `declare/1`, `respond/0`, `resolve/1` | **3** |
| Unit 5 worst case: one joiner, defender asks | `declare/1`, `ally/2`, `permit/0`, `respond/0`, `resolve/1` | **4** |
| **Standing defence** — defender `close`, every Citizen `pass` | `declare/1`, `resolve/1` | **1** |
| Standing defence, one Citizen still asking | `declare/1`, `ally/2`, `resolve/1` | **3** |

The third row is the phase's headline exit criterion, and it is asserted
from the RAW LOG's actor sequence in `standing.test.ts` — two actions, both
the attacker's, the defender having submitted nothing at all.

The frozen fullgame fixture is the FIRST row, so its numbers and the log
itself are **unchanged by units 5, 6 and 7** — the no-regression property
each had to hold.

Note the fourth row: a single Citizen who has not set `ally: 'pass'` costs
a visit the defender's policy cannot remove, because it is not the
defender's question to answer. That is correct rather than a gap, and it is
why unit 9's six-player measurement is the number that finally matters.

### Where the dice roll now

D14 says dice roll in a `prepare()` and never in a reducer. D51 moved the
roll off a dedicated `campaign.roll` onto the window-closing action, and
units 6-7 made *which action that is* depend on the policies in force. It
can now be `campaign.declare`, `campaign.ally`, `campaign.permit` or
`campaign.respond`.

Rather than enumerate those cases twice, `settleWindows` is the single
function that decides them, and `prepareCampaign` runs it against a
throwaway CLONE of the campaign the reducer is about to produce, rolling
exactly when the clone reports "ready". The reducer then runs the same
function on the real campaign and agrees by construction. A divergence
would be the worst kind of bug — a `'rolled'` phase with no faces, or faces
rolled and discarded — so it is made structurally impossible rather than
tested for.
