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
| `turn` | Default — no Wake, Campaign, or mid-Search hand is blocking `state.turn.activeSeat` | `turn.activeSeat` | `turn.rest`, `card.play`, `muster`, `trade`, `travel`, `search`, `recover`, `campaign.declare`, `campaign.ally`, `campaign.respond`, `campaign.resolve`, `campaign.casualties`, `power.use`, `citizenship.offer`, `citizenship.accept`, `citizenship.decline`, `citizenship.exile`, `citizenship.selfExile`, `adviser.play`, `warbands.move`, `warbands.allow`, `warbands.deny`, `wake.resolve`, `oathkeeper.grant` | no (the default; replaced by any row below that applies) | `turn.turnStartedAt` | naive | naive |
| `play` | `state.players[seat].hand` is non-empty — a Search's drawn cards await Law §5.1.4's play/discard step | active seat | `card.play` | yes (replaces `turn`) | `player.handDrawnAt` | naive (Search stays two actions per D50 — the draw is a reveal) | naive |
| `wake` | `state.wake` is set — Law §4.1.1's People's Favor maintenance is still owed, and/or the waking seat is standing on an unclaimed Opportunity Site (Law §4.1.4) | `state.wake.seat` | `wake.resolve` | yes (replaces `turn`) | `state.wake.startedAt` | **batched** (unit 3): every owed §4.1.1 step (up to 2, Mob side) and, if owed, the §4.1.4 take all ride one `wake.resolve` — at most one visit; fully forced/no-Opportunity Wakes stay zero, as before | naive |
| `campaign` | `state.campaign.phase === 'respond'` — the defender's response window (Law §5.5.3) | `state.campaign.defenderSeat` (numeric — bandits skip this phase) | `campaign.respond` | yes (replaces `turn`) | `state.campaign.declaredAt` | **closes the window and rolls** (unit 4, D51): the dice roll in this action's `prepare()`, deleting the attacker's old `campaign.roll` visit. Against bandits there is no window and `campaign.declare` itself rolls | naive |
| `campaign` | `state.campaign.phase === 'respond'`, once per eligible Citizen not yet in `allyVolunteers` (Law §5.5.2) | each eligible Citizen | `campaign.ally` | **no** — additional alongside the defender's `respond` decision; "optional and racy by design" (`campaign.ts`'s own words) — the defender's `respond` closes the window over any left unanswered | `state.campaign.declaredAt` | naive (P2's known gap: a Citizen Ally can never actually act in the window — unit 5's target) | naive |
| `campaign` | `state.campaign.phase === 'rolled'` — the attacker resolves sacrifice, victory AND the §5.5.7 seizure (Law §5.5.5-5.5.7) | `state.campaign.attackerSeat` | `campaign.resolve` | yes (replaces `turn`) | `state.campaign.declaredAt` | **batched** (unit 4, D50): sacrifice + placements/banish/burn in one payload; the old separate `campaign.seize` visit is gone | naive |
| `campaign` | `state.campaign.phase === 'casualties'` — the defeated force's kill allocation matters (Law §5.5.6's Imperial aside) | `casualtyChooser(state, campaign)` — usually the Chancellor, but the defeated player themselves when not Imperial | `campaign.casualties` | yes (replaces `turn`) | `state.campaign.declaredAt` | naive (a real handoff, not a batching miss — unit 4 leaves this phase alone) | naive |
| `citizenshipOffer` | `state.citizenshipOffer` is set, from `citizenship.offer` until accepted or declined (Law §6.6.1) | `state.citizenshipOffer.exile` | `citizenship.accept`, `citizenship.decline` | no | `state.citizenshipOffer.offeredAt` | naive | naive (negotiated — stays 'ask' per Q13's expected outcome) |
| `warbands` | `state.warbandRequest` is set — a Citizen's move off-site, or an Imperial give/take, awaiting the required permission (Law §6.5) | `state.warbandRequest.approver` | `warbands.allow`, `warbands.deny` | no | `state.warbandRequest.requestedAt` | naive | naive (unit 6/16b target: `warbands: 'allow'\|'deny'\|'ask'`) |
| `oathkeeper` | `state.titleChoice` is set — several other seats meet the current Oath's goal and the holder does not (Law §2.11) | `state.titleChoice.holder` | `oathkeeper.grant` | no | `state.titleChoice.raisedAt` | naive | naive (consequential — stays 'ask' per Q13's expected outcome) |

## Catalogue (planned)

| Kind | Home | Notes |
| --- | --- | --- |
| `setup` | Unit 8 | Law §1.23's pawn-placement and adviser-keep choices, currently made FOR the player by `oathSetup`'s defaults (`setup.ts`). Becomes a real, sequential, per-seat pending decision — one seat at a time, in turn order, locking (nothing else is legal before setup completes) — resolved by a batched `setup.choose`. Not yet built: today these are not decisions at all. |

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
