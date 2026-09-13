# Prompt plan — Phase 4: the client

Phase 4 is where a person other than a test finally plays this game. P0–P3
built a server that is correct, rewindable, leak-audited and measured; none
of it has ever been touched by a human hand except through `curl`. The HLD's
goal for this phase is short — "a web client for tablets and laptops that
renders the full table from a projected view, shows the decision inbox, and
submits actions with `prevSeq`" — and the phase's real risk is hidden in the
word *renders*.

**A client that decides anything is a second implementation of the Law.**
Which sites can this pawn reach and at what Supply cost; which denizens can
be mustered; how many warbands may be committed; which relic slots are
recoverable — every one of those is a rule. P3's own post-mortem is the
warning: three copies of a test helper each re-derived §5.5.5's skull
ordering, each got it wrong, and the result was a flake that lived in the
suite for two units. A *client* re-deriving rules would be that same failure
at a larger scale, in a place `vitest` cannot see. So the architectural spine
of this phase is `affordances(state, seat)` (D56): **the server computes what
may be offered, the client only draws it**, and a conformance test ties the
two together in both directions.

Each unit below is a prompt to hand to Claude Code, in order. Every unit is
TDD — write the failing tests, watch them fail for the right reason, make
them pass, run the whole suite AND `npm run typecheck`, commit. Each stands
alone; a later unit never reopens an earlier one (additive registrations in
the affordance table, new pages under `src/client/pages/`, and new rows in a
conformance table don't count as reopening).

**One unit is not TDD and says so**: unit 16, the visual pass. Pretending a
CSS pass is test-driven would make this suite's green mean less, not more
(D65). It gets the two mechanical proxies that are honestly available and a
human gate for the rest.

---

## What was verified on 2026-09-13 (the PRE-PHASE snapshot)

Read the code, not the notes. That rule found fifteen P2 bugs and one P3
rules defect that had been "recorded as fine" since 09-11 — and it found the
first item below while this plan was being written.

- **P3 is complete**: 693 tests + 1 deliberately skipped across 41 files,
  `npm run typecheck` covering `src` + `test` + `scripts`, 23 smoke checks,
  two frozen fixtures (`fullgame.log.json`, `sixplayer.log.json`) that the
  audit suite refolds prefix by prefix for every seat.

- **`recover` leaks its site's facedown relics through its error text.**
  `src/oath/game/actions/recover.ts` takes `relicId: z.string()` and answers
  a wrong guess with `` `recover: no facedown relic ${relicId} at your
  site` ``; a right guess falls through to the §5.4.2 cost checks and fails
  with a different message. All 20 relic ids are public data in this repo
  (`src/oath/cards/data/relics.json`), the checks run BEFORE anything is
  spent, and an illegal action is never persisted — so a player can
  enumerate the facedown relics at their own site for free, without taking a
  turn. The P2 audit could not see this: it sweeps `project()`, and this
  leaks through the ACTION INTERFACE. Unit 1 closes it and makes the class
  of bug a conformance test (D59).

- **The one relic recover in the fixtures is `fullgame.log.json` seq 14**
  (`{ target: 'relic', relicId: 'relic:horned-mask' }`), so unit 1's shape
  change breaks exactly one frozen log and leaves `sixplayer.log.json`
  untouched. `sixplayer.log.json` carries seven `standing.set` actions,
  which is why unit 14's normalization has a real regression to prove
  itself against rather than a hypothetical one.

- **The action surface is 27 types** across 15 handler modules (plus the
  `game.created` marker): `muster`, `trade`, `travel`, `search`, `recover`,
  `card.play`, `adviser.play`, `power.use`, `warbands.move/allow/deny`,
  `citizenship.offer/accept/decline/exile/selfExile`,
  `campaign.declare/ally/permit/respond/resolve/casualties`, `turn.rest`,
  `wake.resolve`, `oathkeeper.grant`, `standing.set`, `setup.choose`. Every
  one of them needs an affordance builder or an explicit "never offered"
  row (unit 6).

- **The HTTP surface is seven routes**, all under `/api`, all authenticated
  by an `x-player-token` HEADER — except `POST /games/:id/rollback`, which
  has **no authentication at all** and whose only guard is a comment reading
  "Admin-only in any real deployment. Gate it before this leaves your LAN."
  It is already on a public Fly URL. Unit 8 gates it.

- **A header cannot ride an address bar or an `<img src>`.** Two P4 exit
  criteria — "decision deep link opens the right prompt with one tap" and
  "an unauthenticated asset request is refused" — are unsatisfiable under
  the current scheme. Cookies, bootstrapped once from a join link (D58).

- **`project()` cannot express per-seat knowledge yet.** `SiteView.relics`
  is `{ count }` and `reliquary[]` is `{ modifier, covered }`; both hide
  identity from *everyone*, including the site's own ruler. That is correct
  today and is exactly what §6.3 exists to change. `audit.test.ts` was
  written in P2 unit 20 with a per-seat accumulating `knownTo(seat)` set
  precisely so this phase would not have to reopen it — use it.

- **`ArtEntry` already reserves optional `width`/`height`** and
  `missingAssets()` already exists; `art.test.ts`'s real-asset check is
  `skipIf(!ART_DIR)` and has been skipped since P1. `ART_DIR` is empty.

- **`text.json` is an OPTIONAL overlay the engine never reads (D20)** and
  `loadTextOverlay` returns `{}` when the file is absent. The client's card
  text tap-through must degrade to "no text available" rather than assume
  the file exists.

- **There is no client code, no CSS, no browser JS, no cookie parsing and
  no static-file route anywhere in `src/`.** Dependencies are `express` and
  `zod` only. `express.static`, `res.sendFile` and `res.cookie` are built
  in; reading cookies needs about five lines, not `cookie-parser`.

## Decisions made at planning (recorded in HLD §7 as D56–D65)

1. **D56 — the client renders; the server decides.** `affordances(state,
   seat)` joins `project()` and `pending()` on `GameDefinition`: one entry
   per action this seat may submit now, carrying each payload field's legal
   domain and any precomputed cost. Enforced in both directions — every
   enumerated option is accepted by `reduce`, every near-miss rejected, and
   every rendered form field names a real affordance field.
2. **D57 — server-rendered HTML from the same express process.** No
   framework, no bundler, no client-side build; one hand-written ES2022 file
   for progressive enhancement. POST-Redirect-Get; a 409 is recovered
   server-side into a re-rendered page, never shown. Poll-`/inbox`-on-focus,
   no SSE. (Resolves Q7.)
3. **D58 — HttpOnly session cookie, bootstrapped from `/join/:token`.**
   `x-player-token` stays for the JSON API, the smoke script and P6's
   worker. Deep links carry no token.
4. **D59 — the hidden-information audit extends past `project()`** — to
   payload shapes, error strings, `affordances` output and rendered HTML.
   Card ids in payloads are addressed positionally unless the actor
   legitimately knows them.
5. **D60 — peeked knowledge is per-seat state**, revealed only into zones
   the view already exposes as slots (site relic slots, Reliquary spaces),
   never into the relic deck. Peek payloads carry an INDEX, never an id.
6. **D61 — D53's log freeze starts at the END of unit 1, not the start of
   the phase.** Unit 1 is the last unit permitted to change an action shape;
   it regenerates the frozen fixtures and drains the Fly smoke games.
   Everything after needs a migration story.
7. **D62 — conditional standing responses keep the scalar as the base
   case.** A channel is either today's scalar or `{ default, unless }`,
   normalized by `consultStanding`, which grows a context argument. Every
   pre-P4 `standing.set` payload folds unchanged.
8. **D63 — the art pipeline is an offline script**; the server only serves
   bytes. Two sizes per face by filename convention; `width`/`height` into
   the committed manifest; a missing file renders a placeholder.
9. **D64 — a dry-run submit** (`?dryRun=1`) runs `prepare` + `reduce` in a
   rolled-back transaction. Must return byte-identical errors to the real
   path, which is why unit 1 precedes it.
10. **D65 — unit 16 is not TDD and says so.** Its gate is human judgement
    plus a class-name conformance test and a scripted viewport check.

Also scoped out with homes, so nothing sits homeless the way the Peek family
did for four units: §6.6.1's "let them peek at the Reliquary" and §6.1/§9.4's
"let another player peek at your facedown adviser" are **negotiation, and
self-policed in v1** — recorded in RULES-COVERAGE against those sections
rather than left implied by unit 3. A general reaction window stays **v2**.
Nudge delivery against `since` stays **P6**.

## Decisions needed from Ben — Q15, Q16, Q17

These are in the HLD's open-questions table. **The plan assumes an answer for
each and says which**; a different answer changes one unit, not the phase.

- **Q15 — how much of `ART_DIR` must be filled for P4 to close?**
  *Assumed:* the route, the pipeline script and the placeholder fallback are
  P4's; collecting ~261 faces plus board art is Ben's own task, and the phase
  closes once the cards a real game touches are placed. Unit 15 is written
  that way. If the bar is "all 261", unit 15 grows a corpus checklist and the
  phase's close date moves.
- **Q16 — is a player token in a join-link URL acceptable?**
  *Assumed:* yes. `/join/:token` sets the cookie and 303s immediately;
  nothing in this server logs request paths today, and the Fly proxy is the
  only third party that sees them. If no, unit 8 ships a paste-your-token
  form instead — same security, worse first-run UX, one page either way.
- **Q17 — does P4 ship game creation and link handout in the client?**
  *Assumed:* yes, one page behind an admin token. Handing six people their
  links is the first thing that happens in a real campaign, and P6's "admin
  page" bullet then narrows to rollback-and-ops. If no, unit 8 drops its
  third section and games keep being made with `curl`.

---

## Conventions for every prompt

- Repo state assumed: P3 complete as committed. Node 22, TS, ESM, vitest,
  zod, express. `npm test` and `npm run typecheck` green before and after.
- Red, green, refactor. Watch each new test fail for the right reason.
- Engine tests in `test/oath/game/`; client tests in `test/client/`;
  HTTP-layer tests go through the in-process express app, as
  `fullgame.test.ts` and `decisions-http.test.ts` already do.
- Every game rule cited as `Law §x.y`; anything ambiguous → `RULINGS.md`,
  **re-derived from the printed sentence, never from an earlier ruling's
  prose** (D48, and D55 is why).
- Every test that produces a state runs `checkInvariants`.
- **No new runtime dependencies.** If a unit seems to need one, that is a
  finding to record, not a decision to make quietly. (Dev dependencies get
  the same bar: unit 11 explicitly decides against an HTML parser.)
- **No real card text anywhere**, as always — including in labels. Labels
  are generated from ids and public state; `text.json` is a tap-through the
  client requests separately and degrades without.
- Every unit that changes which decisions exist updates `INTERRUPTS.md`;
  every unit that closes a Law section updates `RULES-COVERAGE.md` in the
  same commit.
- After unit 1, **an action-shape change needs a migration story** (D61).
  State-shape changes are still fine and their migration story is the same
  one unit 2 writes: default it in `init` and prove both frozen fixtures
  still fold byte-identically.

---

## Unit 1 — Close the action interface

**Purpose.** Fix a live hidden-information leak, and turn the class of bug
into a conformance test. This is also the last unit allowed to change an
action shape, so it goes first by necessity as well as by severity.

**Depends on.** Nothing.

```
Unit 1 of Phase 4: close the action interface.

Verify the premise before trusting this prompt. Read every payload
schema in src/oath/game/actions/*.ts and list every field carrying a
CARD ID. For each, answer from the code: at the moment the actor
submits it, is that id something they legitimately know?
test/oath/game/audit.test.ts already defines "legitimately knows" as a
per-seat accumulating knownTo() set — reuse that definition, do not
invent a second one.

1. The one already found, as a RED test first.
   recover's relic branch takes relicId and answers a wrong guess with
   `recover: no facedown relic ${relicId} at your site`; a right guess
   falls through to the §5.4.2 cost checks and fails differently. All
   20 relic ids are in src/oath/cards/data/relics.json, the checks run
   before anything is spent, and an illegal action never persists.
   Write the exploit: from a state whose site holds a known relic and
   whose actor cannot pay the cost, submit a recover for every relic
   id and assert the error strings are indistinguishable. Watch it
   fail, and note in the test how many guesses it took to identify the
   relic — that number is the finding.

2. Fix by addressing the slot, not the card. Law §5.4.1 is literal:
   "Choose one facedown relic at your site." At a table you point at a
   card; you do not name it. Payload becomes
   { target: 'relic', relicIndex: number, siteId?: string }, resolved
   against site.relics by the reducer. An out-of-range index and a
   relic-free site produce ONE message, which may name the number of
   relics at the site (a public count, Law §9.4) and nothing else.

3. Sweep the rest into a conformance test,
   test/oath/game/oracle.test.ts: a table mapping every action type in
   the dispatch table to its id-bearing payload fields, each classified
   'public' (the id is in every seat's projected view), 'own' (the
   actor's own hand / advisers / relics), 'positional' (an index), or
   'none' (no id fields). A dispatch-table entry missing from the table
   FAILS — so a future action cannot add an oracle quietly. Assert the
   classification rather than trusting it: for 'public', the id really
   does appear in project(state, someOtherSeat); for 'own', it appears
   in the actor's own view and no one else's.

4. D61 fallout, deliberately and for the last time. VERIFIED while
   planning: test/fixtures/fullgame.log.json holds exactly one relic
   recover, at seq 14, actor 2, payload
   { target: 'relic', relicId: 'relic:horned-mask' } — so this fixture
   WILL stop folding and must be regenerated (delete, rerun its writer,
   re-freeze), and the audit suite rerun. sixplayer.log.json holds no
   recover at all and must fold unchanged — assert that rather than
   assuming it. Drain the Fly smoke games. State in the commit message
   that the log format is frozen from here (D61).

5. Tests: the red exploit goes green; an in-range index recovers the
   right relic and charges the right §5.4.2 cost; out-of-range and
   no-relics-here are indistinguishable; the conformance table covers
   every dispatch-table entry; invariants throughout.

Commit: "Address facedown relics by slot; close the recover oracle"
```

**Done when.** No action's error text discriminates a card the actor cannot
see, a conformance test says so for every action type, and the log format is
frozen behind an explicit line in the commit message.

---

## Unit 2 — A slot that can hold a known id

**Purpose.** Make the projection able to *express* per-seat knowledge before
anything grants it. A shape change whose proof of safety is that every
existing test passes unchanged — so unit 3 adds an action rather than
rewriting `project.ts` and the audit at the same time.

**Depends on.** Unit 1 (ordering only — unit 1 makes relic slots positional,
which is the same addressing this unit exposes).

```
Unit 2 of Phase 4: the third visibility class, empty.

Until now every card id is public or hidden from everyone. §6.3 makes a
facedown relic privately known to ONE seat. Build the shape now, with
the knowledge set always empty, and prove nothing changed.

1. PlayerState.peeked: string[] — sorted, deduplicated, empty for every
   existing game. init() defaults it, so every stored setup and both
   frozen fixtures fold BYTE-IDENTICALLY. That refold IS the migration
   story D61 requires for a state-shape change; assert it explicitly
   rather than relying on the audit noticing.
   checkInvariants validates: every entry is a real relic id (byId),
   the array is sorted, no duplicates.

2. project():
   - SiteView.relics becomes an ORDERED array of slots,
     { id: string | null } — non-null only when this seat has peeked
     it. Ordered because unit 1 made recover positional and a client
     has to be able to point at slot 1. The count stays derivable as
     relics.length; do not keep a redundant count field.
   - reliquary[i] gains id: string | null on the same rule, alongside
     the existing modifier/covered.
   - relicDeck stays a bare count and NEVER reveals a peeked id. Write
     the reason into the file header: §6.3 grants re-peeking a specific
     relic, not vision into the deck, and revealing there would leak
     deck contents — which Law §9.4 makes private.

3. audit.test.ts: knownTo(seat) gains that seat's peeked set. With
   peeked empty everywhere the audit result must be identical — run it
   before and after and say so in the commit message.

4. Tests: slots are ordered and all-null; both frozen fixtures fold
   byte-identically (compare the folded state, not just "it did not
   throw"); re-plant one of the audit's documented leaks and confirm it
   still fails, naming seat/action/path (the audit's own instruction —
   a green audit proves nothing on its own); invariants reject an
   unsorted, duplicated or unknown peeked id.

Commit: "A slot that can hold a known id; peeked knowledge as state"
```

**Done when.** The projection can express per-seat knowledge, nothing yet
grants it, and both fixtures fold unchanged.

---

## Unit 3 — Law §6.3 and §6.4: the Peek family

**Purpose.** The P2 hand-off that has been homeless longest. It lands here
because peeking only does anything once something can show the result — and
because it is the one feature in v1 that produces knowledge rather than
board state.

**Depends on.** Unit 2.

```
Unit 3 of Phase 4: peeking.

The Law, verbatim (Buried Giant p1). §6 opens: "These actions cost no
Supply."
  §6.3 Peek at a Relic — "Peek at any facedown relic card at your site.
  (If you have ever peeked at a specific relic, you may peek at it
  again from any site.)"
  §6.4 Peek at an Imperial Relic — "If you hold the Grand Scepter, you
  can peek at any relic in the Imperial Reliquary."

1. Two actions, both free (§6's opening line), both minor actions legal
   in your own Act Phase exactly as adviser.play is:
     peek.relic      { relicIndex }        — a facedown relic at YOUR site
     peek.reliquary  { spaces: number[] }  — requires the Grand Scepter
   §6.4 says "any relic", so a batched list of spaces is ONE action per
   D50, not one per relic. Both reduce to: resolve the index to an id,
   add it to players[seat].peeked.

2. THE PAYLOAD NEVER CARRIES THE ID (D60). The action log is safe to
   share (HLD §4) and a peeked identity is private to one seat, so it
   must not enter the log at all. card.play's keepIndex and
   setup.choose are the precedent — cite them in the header. Assert it:
   serialize the whole log after a game containing peeks and grep it
   for every peeked relic id.

3. Permanence. §6.3's parenthetical is persistent memory, not a
   momentary reveal: once in peeked, the relic stays visible to that
   seat wherever the view exposes a slot — including after it moves
   between sites or into the Reliquary. Test the clause literally: peek
   at your site, travel away, and the id is still yours in the view.

4. Legality. Re-peeking the same relic is legal and idempotent (the set
   does not grow; the action still logs, because it is a legal thing to
   do at a table). A site with no facedown relics, or an out-of-range
   index, is illegal-state with the unit-1 message. peek.reliquary
   without the Grand Scepter is illegal-actor. Neither peek raises a
   pending decision — assert that in the catalogue test rather than
   leaving it implied.

5. Docs, in this commit: RULES-COVERAGE §6.3/§6.4 flip DEFER → DONE
   naming file and function; INTERRUPTS.md's "Peeks → P4" out-of-scope
   row becomes a note saying where it landed.

6. Two related grants stay out WITH HOMES, recorded rather than
   silently skipped — the Peek family itself sat homeless for four
   units and that is the failure this project already named:
   - §6.6.1's "You can let them peek at any relics in the Imperial
     Reliquary" — the offer already publishes the ONE offered relic,
     which is what the decision needs; a broader grant is negotiation.
     Self-policed in v1; record against §6.6.1 in RULES-COVERAGE.
   - §6.1 / §9.4's "A player who holds a facedown adviser can peek at
     it and allow any other player to peek at it" — same: table talk.
     Record against §6.1.

7. Tests: §6.3 reveals exactly one id to exactly one seat — assert on
   EVERY OTHER seat's view, not just on yours; §6.4 reveals the named
   spaces and no others; the memory clause across a travel; each
   illegal case; the audit over a game containing peeks shows the ids
   only to the peeking seat and still fails on a planted leak; the log
   contains no peeked relic id; invariants.

Commit: "Law §6.3/§6.4: peeking, and knowledge that persists"
```

**Done when.** A peeked relic is visible to exactly one seat, permanently,
without ever appearing in the log; RULES-COVERAGE §6.3/§6.4 read DONE.

---

## Unit 4 — `affordances`: the contract and the harness

**Purpose.** D56's seam, plus the test that makes it trustworthy. The seam is
small; the harness is the unit's real product, because it is what stops the
affordance table and the reducer drifting apart — which is the exact failure
mode P3's post-mortem named as the one its risk register missed.

**Depends on.** Units 1–3 (so relic slots and peeked labels are already
final).

```
Unit 4 of Phase 4: the option space, and how it is kept honest.

D56: the client renders, the server decides. This unit builds the seam
and its conformance harness; units 5 and 6 fill the table in.

1. GameDefinition gains an OPTIONAL affordances(state, seat) — optional
   so the contract stays additive for any future game definition (the
   same reason setup() takes optional options). Oath implements it in a
   new src/oath/game/affordances.ts.

2. Shape. One entry per action type this seat may legally submit right
   now:
     { type, decisionId?, fields: Field[], note?: string }
   Field is one of:
     { name, kind: 'choose-one' | 'choose-many', options: Option[], max? }
     { name, kind: 'count', min, max }
     { name, kind: 'flag' }
     { name, kind: 'free', schema: string }   // declared powers only
   Option is { value, label, cost?, disabled?: string }.

   THE RULE, and it is the whole contract: an ENTRY appears only if the
   seat could submit that action now, and every OPTION without
   `disabled` is one reduce() accepts. `disabled` exists for options a
   client should show greyed — you can see the site, you cannot afford
   it — and carries the reason as a string; a disabled option is not
   claimed legal, and the harness checks it really is refused.

   Labels are generated from card ids and PUBLIC state only. The engine
   never reads card text (D20) and neither does this — "Mine (Provinces)"
   is a label, the card's printed text is not. An unpeeked relic slot
   labels as its position, never as its identity.

3. The harness, test/oath/game/affordances.ts — a TEST HELPER, like
   metrics.ts, not src/. Given a state and a seat it must:
   - for every entry, for every field, vary that field across its
     options while holding the others at a fixed legal choice (the
     cross-product is unbounded and a form does not explore it either),
     fold the resulting action, and assert no IllegalAction
   - for a 'count' field, assert max is accepted and max+1 rejected
   - for every `disabled` option, assert reduce DOES reject it and the
     message relates to the stated reason
   - negative direction: a sample of values NOT listed is rejected
   Fold against a CLONE each time; never leave the caller's state
   mutated.

4. Wire exactly three, chosen as the three easy shapes:
   - turn.rest      — no fields
   - travel         — choose-one over destinations, each carrying the
                      §5.6.1 Supply cost. CALL map.ts's travelCost; do
                      not re-derive the table. Sites you cannot afford
                      appear `disabled` with the cost in the reason
   - standing.set   — the three policy channels as choose-one fields
   Run the harness over both frozen fixtures, prefix by prefix, for
   every seat.

5. Transport: GET /api/games/:id grows `affordances`, computed for the
   REQUESTING seat only and omitted for a spectator (seat === null).
   Extend audit.test.ts to stringify affordances alongside the view in
   the SAME id sweep — an affordance naming a card this seat cannot see
   is a leak of exactly the kind unit 1 closed elsewhere, and it would
   otherwise be a brand-new unswept channel.

6. Tests: the harness itself, proven by planting a lie — add a
   destination that is out of Supply range without marking it disabled,
   and watch the harness fail naming the action; a seat with no legal
   move gets an empty list; a locked decision (any Campaign phase)
   yields only the action types that decision's `resolves` names;
   invariants.

Commit: "Affordances: the server computes what a client may offer"
```

**Done when.** Three action types are described by the server, the harness
proves the description true against `reduce`, and the audit sweeps
affordances.

---

## Unit 5 — Affordances for the major and minor actions

**Purpose.** Fill the table for everything a player does on their own turn.
This is where §7.2's untranscribed restrictions and unit 3's peeked relics
first become visible in the interface.

**Depends on.** Unit 4.

```
Unit 5 of Phase 4: affordances for the turn.

Add builders for: search, muster, trade, recover, card.play,
adviser.play, warbands.move, power.use. Run the unit-4 harness on every
one, over both frozen fixtures.

Per action, the fields and where their rules come from — CALL the
existing predicate in every case, never restate it:
- search: deck choice (world vs a region discard, §5.1.2) and the
  §5.1.1 Supply cost read off the Visions Drawn track. If the cost
  exceeds Supply the entry is absent, not disabled — you cannot search
  at all.
- muster: the denizens this seat has access to (power.ts hasAccess) and
  the §5.2.1 favor cost, disabled with the reason when unaffordable.
- trade: the cards at this seat's site and which resource (§5.3).
- recover: relic SLOTS by index (unit 1), the relic's cost read from
  the SITE's printed §5.4.2 cost, plus the two banners. The banner pay
  is a 'count' field and its bounds are not the same rule as a relic's:
  §5.4.2 says the People's Favor "costs any amount of favor greater
  than its current value", so min = the banner's current tokens + 1 and
  max = this seat's favor. §5.4.1's Darkest Secret precondition ("only
  if any card at the holder's site does not match any of their
  advisers, or you are recovering from yourself") decides whether the
  banner appears at all — export darkestSecretRecoverable and call it rather than
  restating it. A relic slot's label is its POSITION unless this seat has peeked
  it, in which case it is the card's name — this is where unit 3 first
  pays off in the interface, so assert both label forms in a test.
- card.play: the drawn cards (the actor's own hand, so ids are
  legitimate — cite the oracle table's 'own' row) and §5.1.4's three
  destinations plus discard: a specific site slot, the advisers, the
  Revealed Vision space IF this seat is an Exile, or the region discard
  pile. §7.2 restrictions applied via restrictions.ts.
  IMPORTANT: restrictionKnown(cardId) === false means "we never
  transcribed this card's banners", not "unrestricted" (D46). Surface
  it as a `note` on the entry saying §7.2 is self-policed for this
  card. Silently offering it as unrestricted would be the engine
  asserting something it does not know.
- adviser.play: the seat's facedown advisers, by index (they are the
  actor's own, but positional addressing costs nothing and keeps the
  oracle table uniform).
- warbands.move: direction and a 'count' field bounded by §6.5's "any
  number of your warbands, except the last one" and by rule of the
  site; the Citizen-permission and Imperial give/take variants appear
  as separate entries with a note naming whose permission they need.
- power.use: NOT enumerable, and say so. Fields are the accessible card
  ids (hasAccess) plus a 'free' effects field naming the Effect schema.
  A `note` states that v1 does not know what the card does (D9/D28) and
  that unit 7's dry run is how a player checks their declaration.

Tests: the harness green on all eight across both fixtures and over a
hand-built 6-seat state with Citizens (the fixtures are 3p and 6p but
neither exercises every branch — check which, and hand-build the gaps
rather than assuming coverage); the two recover label forms; a
restriction-unknown note present for a card restrictions.ts has never
read; invariants.

Commit: "Affordances for the six major actions and the minor ones"
```

**Done when.** Every action a seat can take on its own turn is described by
the server and proven against `reduce`.

---

## Unit 6 — Affordances for every pending decision, and the bidirectional tie

**Purpose.** Close the table, and bind it to `INTERRUPTS.md` so the two
contracts cannot drift. After this unit, "the client never computes a rule"
is a checkable claim rather than an intention.

**Depends on.** Unit 5.

```
Unit 6 of Phase 4: affordances for every decision.

Add builders for: campaign.declare / ally / permit / respond / resolve /
casualties, wake.resolve, setup.choose, citizenship.offer / accept /
decline / exile / selfExile, warbands.allow / deny, oathkeeper.grant.

Notes that matter per action:
- campaign.declare: target list by kind (site / pawnFavor / banner /
  relic — relics of the defender are PUBLIC, cite the oracle table),
  plus attack-dice as a 'count' bounded by the committable force. The
  defense total is public and belongs in the entry's `note` so a client
  can show the odds without computing them.
- campaign.resolve: sacrifice as a 'count', and the seizure block as
  fields that appear ONLY on the win branch — mirroring the reducer,
  which rejects a seize on a loss rather than ignoring it (P3 unit 4).
- wake.resolve: the §4.1.1 steps as an ordered list of choose-one
  fields whose length is stepsRemaining, plus the §4.1.4 take when
  owed. The batched shape is the affordance shape — one entry, every
  owed choice.
- setup.choose: faceup sites (the Chancellor's restricted to the top
  Cradle site, §1.23.1) and keepIndex over the three drawn cards,
  labelled from the actor's own hand.
- citizenship.offer: the Reliquary relics — which the Scepter holder
  may legitimately know (§6.4, and after unit 3 they may actually have
  peeked). If they have NOT peeked, the label is the space's position
  and its modifier, never the relic's name.

Then the bidirectional tie, test/oath/game/affordances.test.ts:
1. Every action type in the dispatch table either has a builder or
   appears in a NEVER_OFFERED table with a reason (game.created is the
   marker; anything else needs a real reason). A new action type with
   neither fails.
2. For every pending decision live in any fixture prefix, every action
   type in its `resolves` list has an affordance entry for the owning
   seat — INTERRUPTS.md's contract and this one agree. Conversely no
   entry exists for a seat with no standing to act.
3. The unit-4 harness runs over every prefix of both frozen fixtures
   for every seat, so the whole table is exercised by real games rather
   than by hand-built states alone.

Tests: the three conformance properties above (each proven by planting
a violation and watching it fail); a locked campaign phase offers
exactly the phase's resolver and standing.set and nothing else;
invariants.

Commit: "Every decision has an affordance; the two catalogues agree"
```

**Done when.** Every dispatch-table action type is described or explicitly
never-offered, and `pending()`'s `resolves` and `affordances` agree by test.

---

## Unit 7 — The dry run

**Purpose.** v1's bargain is that card powers are declared, so the composer's
hardest job is telling a player their declaration is infeasible *before* it
costs a log entry. The store already runs `reduce` inside a transaction; this
is a flag, not a mechanism.

**Depends on.** Units 1 (errors must already be leak-free) and 4.

```
Unit 7 of Phase 4: the dry run.

1. POST /api/games/:id/actions?dryRun=1 runs prepare() + reduce() in a
   transaction that is ALWAYS rolled back, and returns 200
   { dryRun: true, view, pending, affordances, speculative: string[] }
   or the same 400/409 body the real submit would produce. No log
   entry, no seq bump, no snapshot write.

2. Prove it left nothing behind, and prove it hard: headSeq unchanged;
   the actions table byte-identical; the snapshots table byte-identical
   (a dry run must not warm a cache with a state that never existed);
   a fold after 50 dry runs equals the fold before.

3. Dice. prepare() rolls at append time (D14), so a dry run of a
   dice-rolling action rolls dice that will never be the real ones.
   List every such field in `speculative` and say so in the response,
   and write into the route's header WHY this is not a randomness leak:
   each roll is independent and nothing about the discarded roll
   constrains the next. A client must render those numbers as a
   preview, never as a result.

4. Errors must be byte-identical to the real path — same message, same
   status. Test it by submitting the same illegal action both ways and
   comparing the bodies. This is why unit 1 came first: a dry run that
   leaked would be a free, unlimited oracle rather than a costly one.

5. Auth is the same as a real submit: the seat must own the action. A
   dry run is not a way to probe another seat's options.

Tests: all of the above; a dry run of a legal action returns the
would-be view and the would-be affordances; a dry run followed by the
real submit produces exactly the state the dry run predicted, except
for the speculative fields; concurrent dry run + real append does not
corrupt seq (submit both against the same prevSeq).

Commit: "A dry run: check a declaration before it costs a log entry"
```

**Done when.** A client can validate an action without writing one, and the
database is provably untouched.

---

## Unit 8 — Sessions, join links, and the gate on rollback

**Purpose.** Make a browser able to authenticate at all — and close the
open rollback endpoint, which is on a public URL today with only a comment
guarding it.

**Depends on.** Nothing (do it any time before unit 9).

```
Unit 8 of Phase 4: who is holding this browser.

1. Sessions. A signed, HttpOnly, SameSite=Lax cookie carrying the seat
   and game id, Secure when behind TLS, long-lived (this is a friend
   group playing over months — an expiring session is a way to lose
   players, not a security win). Sign it with a secret from the
   environment, defaulting to a per-boot random value in dev with a
   startup warning. Read cookies with about five lines of parsing; do
   NOT add cookie-parser (the no-new-dependency convention).

2. /join/:token — sets the cookie and 303s to /, immediately, with
   Cache-Control: no-store. The token is never echoed into the body and
   never survives into the redirect target. (Q16's assumption; if Ben
   says no, this becomes a POST form that takes a pasted token, and
   nothing else in the plan changes.)

3. Resolution order everywhere: x-player-token header first (the JSON
   API, the smoke script, P6's worker), then the session cookie. One
   helper, used by every route — extend routes.ts's existing seatOf()
   rather than writing a second one.

4. Gate POST /games/:id/rollback: a valid seat IN THIS GAME, or a
   configured admin token. It currently has no authentication of any
   kind and is reachable on oath-async.fly.dev; the comment above it
   says "Gate it before this leaves your LAN" and it has been outside
   the LAN since 09-10. Write the test as the exploit first.

5. Sign-in redirect: an unauthenticated GET of any HTML page 302s to a
   sign-in page that PRESERVES the destination, so a Discord deep link
   opened on a fresh device still lands on the right decision after
   signing in. That is the mechanism behind the "one tap" criterion —
   the tap is one tap on a device that has been signed in once.

6. (Q17's assumption) An admin page behind the admin token: create a
   game (kind, seats, optional chronicle seed) and display the per-seat
   join links exactly once, with the same "hand these out privately"
   warning the API's creation response carries.

Tests: cookie flags asserted literally; a tampered cookie is refused; a
cookie for game A is refused on game B; header auth still works
everywhere it did (re-run the existing HTTP tests unchanged — they are
the regression); rollback 401s for a stranger and works for a player;
a deep link while signed out round-trips through sign-in to the right
URL; /join responds no-store and does not echo the token.

Commit: "Sessions, join links, and a gate on rollback"
```

**Done when.** A browser can authenticate without setting a header, the API
is unchanged for every existing caller, and rollback is no longer open to the
internet.

---

## Unit 9 — The HTML shell, and the inbox

**Purpose.** The smallest end-to-end page, and the one the phone criterion
hangs off. Establishes the render pattern every later page follows: a pure
model, a dumb template, and assertions on the model.

**Depends on.** Unit 8.

```
Unit 9 of Phase 4: the shell and the inbox.

1. src/client/html.ts — a tagged template that ESCAPES every
   interpolation by default, plus an explicit raw() for composed
   fragments. About thirty lines, no dependency. The first test is a
   player named `<script>alert(1)</script>` appearing on a page
   harmlessly, because that is a real thing a friend group will do on
   purpose within a week.

2. src/client/layout.ts — the one document shell: viewport meta, the
   stylesheet link, the single progressive-enhancement script tag
   (deferred), a skip link, and a header carrying the game name and the
   signed-in seat.

3. src/client/model.ts — PURE model builders. The pattern, stated once
   here and followed by every later page: a page's logic lives in a
   function from (view, affordances, meta) to a plain object, and the
   template is dumb enough that its own tests are only about escaping
   and structure. Assertions go on the MODEL.

4. GET / — the inbox, and the landing view. For this token's game: what
   is waiting on me (from /inbox's own data — reuse the route's logic,
   do not duplicate it), each entry's prompt, its age rendered from
   `since` ("3 days"), and a link to its decision page. Then, below,
   what the game is waiting on from other people, so a player can see
   why nothing is moving. Then a link to the board and the history.

5. Phone-first, genuinely: this page is designed at 380px and allowed
   to look plain at 1024px. It is the one page an exit criterion names
   for the phone.

Tests: escaping (the script-name case, plus an id with a quote in it);
the model — entries sorted oldest-first, ages computed from `since`
against a fixed clock, an empty inbox producing the "nothing waiting"
branch, another seat's pending decisions summarised without leaking
their content; the page renders each decision's URL from the same
helper routes.ts uses; a signed-out GET redirects per unit 8.

Commit: "The HTML shell, and an inbox that says what is waiting"
```

**Done when.** A signed-in player can load `/` on a phone and see what is
waiting on them, with a link to each decision.

---

## Unit 10 — The board

**Purpose.** Render the whole table from one projected view, read-only. The
unit's real test is not that it looks right — it is that nothing appears on
the page that the seat is not allowed to know.

**Depends on.** Units 2, 3 (relic slots), 9.

```
Unit 10 of Phase 4: the table.

GET /g/:gameId — the full board from project(state, seat), read-only.
No forms yet; unit 11 adds them.

1. The model (pure, in model.ts): sites grouped by region in play
   order, each with its denizen/edifice slots, relic SLOTS (position,
   and a name only where this seat has peeked — unit 3's payoff),
   per-seat warbands, and site favor/secrets; each player's area with
   citizenship, pawn site, advisers (facedown as backs), revealed
   vision, favor, ready/flipped secrets, bank/board warbands, supply
   and held relics; the favor banks and shared bank; the Reliquary's
   four named spaces; the oath, the oathkeeper and the Usurper side;
   Visions Drawn; the round and whose turn it is; a live campaign
   summarised; any open citizenship offer or warband request.

2. Art keys resolve through the P1 manifest (loadArtManifest), one
   <img> per face, with width/height from the manifest when present so
   layout does not jump. A key with no asset renders the placeholder —
   unit 15 owns the real files; this unit must look correct with none
   of them present, because that is the state of the repo today.

3. THE TEST THAT MATTERS. Extend the audit discipline to the rendered
   page: fold each frozen fixture prefix by prefix, render this page
   for every seat and for a spectator, and run audit.test.ts's own
   whole-string id sweep over the HTML. Any id outside that seat's
   knownTo() set is a leak. Prove the sweep works by planting one —
   render facedown adviser ids and watch it fail naming the seat and
   prefix. This is D59's third channel, and it is the one a template
   makes easiest to get wrong.

4. Spectator view (seat === null): no hands, no advisers' faces, no
   standing policies, no peeked relics. Assert it separately; a
   spectator is the viewer most likely to be forgotten.

Tests: the model from a folded fixture state (every site slot, every
seat area, the banks summing to Law §1.4's 36 favor); the HTML sweep
above across both fixtures; the placeholder path with ART_DIR empty;
the spectator case; a peeked relic named for its peeker and positional
for everyone else, on the same prefix.

Commit: "The table, rendered — and swept for leaks like a projection"
```

**Done when.** Every seat's board renders from their own view, and the
rendered HTML passes the same hidden-information audit the projection does.

---

## Unit 11 — The composer, and forms ↔ affordances

**Purpose.** Turn affordances into forms, and bind the two by a conformance
test in both directions. This is the unit where "the client never computes a
rule" stops being a principle and becomes a property.

**Depends on.** Units 6, 10.

```
Unit 11 of Phase 4: composing an action.

1. One renderer PER FIELD KIND, not per action: choose-one → radios or
   a select, choose-many → checkboxes with the max enforced by the
   server (and by the script as a courtesy), count → a number input
   bounded by min/max, flag → a checkbox, free → the declared-effects
   builder. Every form is generated FROM an affordance entry. There is
   no per-action template, and no template may name a card, a site or a
   cost that did not come from an affordance.

2. THE CONFORMANCE TEST, both directions, test/client/forms.test.ts:
   - every affordance entry the server computes for a seat renders a
     form whose method, action URL and field names match it
   - every field name in every rendered form names a real field of a
     real affordance entry
   Run it over both frozen fixtures, prefix by prefix, for every seat —
   so it covers whatever the games actually reach rather than what was
   remembered. Plant a violation in each direction and watch it fail.
   This is INTERRUPTS.md's bidirectional trick applied to the UI, and
   it is what keeps a template from quietly inventing an option.

3. POST /g/:id/act — parse the form back into a payload (a per-kind
   decoder, mirroring the renderers), submit through the SAME store
   path the JSON API uses, then 303 to the page it came from. Never
   render a POST response directly; a refresh must never resubmit.

4. The 409 path, which is an exit criterion. On StaleSeq: do not
   redirect and do not show an error. Re-render the page server-side
   with the FRESH state, a banner saying what happened, and — where the
   submitted choices are still legal against the new affordances —
   the composer repopulated. Where they are not, say which one stopped
   being legal. Assert on the response: status 200, banner present,
   new seq present, and the JSON API's 409 behaviour UNCHANGED (two
   surfaces, two contracts; state that in the header).

5. The illegal-action path: an IllegalAction re-renders in place with
   the engine's own message. This should be rare precisely because the
   affordances are honest — so add a test that asserts it is reachable
   at all (a hand-built race), rather than assuming it.

6. The declared-power builder: pick a card from the accessible list,
   add effects from the Effect vocabulary, and a "check this" button
   that calls unit 7's dry run and shows the would-be result or the
   engine's refusal. Speculative dice are labelled as such.

7. The progressive-enhancement script, src/client/public/app.js: plain
   ES2022, no build. It upgrades form submits to fetch + re-render,
   refreshes /inbox on window focus (D57's transport), and does
   nothing else. Every page must work with it deleted — add a test
   that drives a full turn with no script involved at all, which is
   trivially true of a server-rendered app and is exactly the property
   that keeps unit 17's driver simple.

Tests: the bidirectional conformance above; a full turn composed and
submitted through forms; the 409 re-render; the illegal re-render; the
dry-run button's round trip; a form for every field kind.

Commit: "Compose an action from an affordance, and prove they match"
```

**Done when.** Every action a player can take is submittable from a form
generated by the server, and a conformance test ties forms to affordances in
both directions.

---

## Unit 12 — The decision page and deep links

**Purpose.** The URL a notification will carry (P6) and the "one tap" exit
criterion. P3 unit 2 built the API contract, including the 410; this gives it
a face.

**Depends on.** Unit 11.

```
Unit 12 of Phase 4: one tap.

GET /g/:gameId/d/:decisionId — the HTML mirror of P3 unit 2's API
route, with the same three cases and the same id regex:
- yours and live: the prompt, the relevant slice of the board, and the
  resolving form ALREADY RENDERED. "One tap" means one GET produces a
  page you can answer from — assert that the form is present in the
  first response, not behind another click.
- someone else's and live: the public framing, read-only, with who it
  is waiting on and for how long (`since`).
- gone (resolved, or rolled back away): NOT an error page. The 410
  case renders "this decision has been answered" plus your own inbox,
  which is what makes a link safe to post to Discord before anyone has
  acted. Assert the HTTP status is still 410 and the body is still a
  useful page — a status code and a dead end are different things.
- malformed: a 400 page, same shape.

Signed out, the sign-in redirect from unit 8 preserves this URL, so the
first tap from a new device costs one sign-in and then lands correctly.
Test that whole round trip as one test, because it is the criterion.

Tests: the four cases; the form-present-in-the-first-response
assertion; a deep link answered end to end (GET the page, POST its
form, land on the board with the decision resolved); the same link
after a rollback unwinds the decision.

Commit: "Decision deep links, answerable in one page"
```

**Done when.** A decision URL opens a page you can answer from, and a stale
one lands on something useful.

---

## Unit 13 — History, described, with rollback

**Purpose.** Rollback is this project's dispute-resolution mechanism (D10) and
until now it has been a `curl` with a sequence number. It needs a face, and
the log needs to be readable by a person.

**Depends on.** Units 8 (the gate), 11.

```
Unit 13 of Phase 4: the log, in English.

1. A PURE describer, src/client/describe.ts: (action, view) → one
   sentence. "Seat 1 travelled to the Mine (2 Supply)." "Seat 0 closed
   the response window; the dice came up 2 skulls." It reads the same
   public data the log carries and NEVER reveals more than the
   projection does — a card.play describes what the resulting board
   shows, not what was in the hand.

2. Bidirectional conformance again: every action type in the dispatch
   table has a describer arm, and every arm names a real action type.
   A new action type without a describer fails this test. Then run the
   describer over every action of both frozen fixtures for every seat
   and sweep the output with the audit's id check — a describer is the
   fourth channel D59 names and the easiest one to leak through, since
   its whole job is to say what happened.

3. GET /g/:id/history — the described log, newest first, with each
   entry's actor, time, and a "roll back to here" control for players
   in the game. Standing policies show as what they were set to, which
   is the thing that makes a short-circuited campaign explicable: the
   log shows declare → resolve with nothing between, and the history
   page can point at the standing.set that did it (INTERRUPTS.md's
   "the cause is visible earlier in the log" — make it literally
   visible, as a back-reference).

4. Rollback: a confirm step naming what will be discarded (how many
   actions, whose, and whether anyone's decision disappears with it),
   then a POST to the unit-8-gated route, then a redirect to the board.

Tests: the describer conformance both ways; the id sweep over described
output; a player rolls back and the page reflects it; a stranger gets
401; the confirm step's counts are right; a short-circuited campaign's
history points at the causing standing.set.

Commit: "The log in English, and a rollback you can see before you take"
```

**Done when.** Any player can read what happened and rewind it from a page,
and the describer is proven to cover every action type without leaking.

---

## Unit 14 — Conditional standing responses

**Purpose.** P3's deferral, and by P3's own measurement the single largest
remaining win: the six-player max of 7 visits per turn is entirely "nobody
set a policy".

**Depends on.** Unit 11 (the policy page needs the composer).

```
Unit 14 of Phase 4: policies with conditions.

D62: the scalar stays the base case.

1. State. A channel becomes `Scalar | { default: Scalar, unless: Cond }`
   where Cond is a small, CLOSED set grounded in the Law rather than in
   imagination:
     defense  — unless the campaign targets { kinds?: TargetKind[] }
                (§5.5.2's four target kinds) or { attacker?: seat[] }
     ally     — unless { attacker?: seat[] } or { defender?: seat[] }
     warbands — unless { requester?: seat[] }
   Nothing else, and say why in the header: a condition a player cannot
   author in the page below is a condition nobody will ever set.

2. consultStanding grows a CONTEXT argument — who is asking, what is
   targeted — and normalizes a scalar to { default, unless: {} } so
   every existing call site and every pre-P4 standing.set payload
   behaves identically. That normalization IS the migration story
   (D61); prove it by folding both frozen fixtures and asserting the
   sixplayer log's measured visit numbers are UNCHANGED, since that log
   contains standing.set actions and its metrics are pinned by test.

3. The short-circuit contract is untouched: a consulted condition never
   appends an action, never reads anything but state, and rolls back
   with the standing.set that wrote it. Re-run P3 unit 6's same-outcome
   property with conditions in play: a conditionally-answered decision
   lands in exactly the state the explicit action would have.

4. checkInvariants validates the shape, including that a seat named in
   a condition exists.

5. The policy page: GET /g/:id/policies renders this seat's three
   channels with their conditions and a form per channel, generated
   from an affordance like everything else (extend unit 4's
   standing.set entry rather than hand-rolling a form — if that is
   awkward, the awkwardness is telling you something about the
   affordance shape; fix it there).

Tests: a condition that fires and one that does not, per channel;
same-outcome vs the explicit action; rollback across a conditional
standing.set; both fixtures fold and sixplayer's metrics are identical;
revocation affects future raises only (P3's rule, re-proven with
conditions); INTERRUPTS.md's standing column updated to name the
conditional forms.

Commit: "Standing responses that can say 'unless'"
```

**Done when.** A policy can carry a condition, every pre-P4 policy still
folds, and the six-player measurement is unmoved.

---

## Unit 15 — Art: an offline pipeline and a gated route

**Purpose.** The P1 hand-off. The manifest has been complete since 09-08 and
`ART_DIR` has been empty since 09-08.

**Depends on.** Units 8 (the gate), 10 (the `<img>` tags).

```
Unit 15 of Phase 4: pictures.

1. scripts/build-art.mjs — an OFFLINE pipeline (D63), run on Ben's
   machine, never in the image and never in CI. It takes a directory of
   source renders and produces two sizes per key by filename
   convention — `<key>.webp` for the board and `<key>.thumb.webp` for
   the inbox and the phone — writing width/height back into the
   committed manifest (ArtEntry already reserves both fields). Document
   the external tools it shells out to and fail with a clear message
   when they are absent. No image library enters package.json; that is
   the same call D15 made about native modules.

2. GET /art/:file — serves from ART_DIR to an authenticated seat only
   (unit 8's helper), with: a 401 for anyone else (an exit criterion —
   write it as the exploit first), immutable long-lived caching (the
   filenames are content-stable), a 404 for any name not in the
   manifest, and path-traversal refused by checking membership in the
   manifest rather than by sanitising the string. Never serve a file
   the manifest does not name.

3. Client: the placeholder stays the fallback for a key with no file,
   so the board looks deliberate rather than broken while the corpus is
   being filled. The card-text tap-through reads the OPTIONAL text
   overlay and degrades to "no text available" when text.json is absent
   — which is its state in a fresh checkout, so test that path first.

4. art.test.ts's skipIf(!ART_DIR) check now covers BOTH sizes, and
   missingAssets reports them separately so a half-filled corpus is
   legible.

Tests: an unauthenticated asset request is refused (the criterion); a
traversal attempt is refused; a manifest-absent filename 404s; caching
headers present; the placeholder path with ART_DIR empty; the text
tap-through with and without text.json; the manifest still passes the
P1 drift test after the pipeline writes dimensions into it.

Commit: "Serve the art, to players only, and a pipeline that stays offline"
```

**Done when.** Art is served only to authenticated players, a missing file
degrades gracefully, and the pipeline is documented and runnable.

---

## Unit 16 — The visual pass (NOT TDD, and it says so)

**Purpose.** Make it look like Oath. This is craft, and the honest thing to
do is name it as the one unit whose gate is a person (D65).

**Depends on.** Units 9–13, 15.

```
Unit 16 of Phase 4: make it look like the game.

This unit is NOT test-driven and the commit message should say so. Its
gate is Ben's eye. What follows are the two mechanical proxies that are
honestly available, plus the checklist the eye is working from.

1. Proxy one — a class-name conformance test: every class used in a
   template exists in the stylesheet and every class in the stylesheet
   is used by a template. Regex-level, reliable because we control both
   sides, and it catches the two failures that actually happen: a
   typo'd class and a stylesheet full of dead rules.

2. Proxy two — scripts/viewport-check.mjs, run with the browser tools,
   NOT in npm test: load each page at 1024x768 (landscape tablet) and
   380x800 (phone) and assert
   document.documentElement.scrollWidth <= clientWidth. A board that
   scrolls sideways on the target device is the one visual failure that
   is objectively a bug rather than a taste.

3. The checklist the human is working from:
   - the whole table visible at 1024px landscape without scrolling
     sideways; sites in region order, top to bottom, as on the map
   - a site reads as a card: art, name, capacity, its denizens in their
     slots, relic slots as facedown backs, warbands by colour
   - a player area reads as a player board: supply track, banks,
     warbands split bank/board, advisers as backs, relics faceup
   - the active seat and the pending decision are findable in under a
     second on any page
   - facedown means facedown: a back, not a blank
   - the phone shows the inbox and a yes/no decision comfortably, and
     the board read-only without a horizontal scrollbar
   - it works with the enhancement script deleted, at every breakpoint

4. Capture a screenshot of each page at both viewports and keep them
   with the commit so the next visual change has a before.

Commit: "Make it look like the table (visual pass, not test-driven)"
```

**Done when.** Both proxies pass, the checklist is walked, and screenshots
exist. The tick is a judgement, recorded as one.

---

## Unit 17 — Acceptance: a full game through the client

**Purpose.** The phase's gate, and the P4 analogue of P2 unit 19 and P3 unit
9. A UI phase with no acceptance game drifts into polish forever.

**Depends on.** Everything above.

```
Unit 17 of Phase 4: play the whole game through the client.

1. test/client/fullgame-client.test.ts: a BROWSERLESS DRIVER that
   fetches an HTML page, extracts its forms (action, method, field
   names), chooses values by reading the SAME affordances the page was
   rendered from, and posts them — following redirects like a browser.
   This is only simple because unit 11's forms work without script and
   unit 11's conformance test guarantees the field names; say so in the
   header, because it is the payoff of two earlier decisions.

   Drive a 3-player game from a chronicle seed to a real ending. It
   must exercise: the setup choices for all three seats through the
   decision page; each of the six major actions; a peek at a facedown
   relic followed by a recover of that same slot (unit 3 and unit 1
   meeting, which is the phase's most satisfying end-to-end path); a
   declared power checked with the dry run before submitting; a
   campaign with a response; a 409 recovery (submit a stale form
   deliberately and assert the player is carried through it); a
   standing policy set with a condition and then fired; and a rollback
   followed by replaying forward.

2. Freeze its log as test/fixtures/clientgame.log.json exactly like the
   other two — written once, never regenerated on a green run — and add
   it to: audit.test.ts's inputs, interrupts.test.ts's catalogue fold,
   the unit-4 affordance harness, the unit-11 forms conformance, and
   the unit-13 describer sweep. One fixture, five contracts.

3. At every prefix of that game, render every page for every seat and
   run the id sweep (units 10 and 13's discipline, now over a game
   driven by the client itself rather than by the API).

4. Metrics: run P3's computeVisitMetrics over the new log and record
   the numbers in INTERRUPTS.md beside the other two. A client should
   not change the visit count — if it does, that is a finding about the
   composer forcing extra submits, and it belongs in the plan's risks
   table, not in a shrug.

5. The manual half, which no test can do: play a real game on a real
   tablet and on a real phone. Record the date and the devices in the
   HLD beside the criterion, as P0 did for its Fly deployment.

Commit: "A full game, played through the client"
```

**Done when.** A game is playable end to end through HTML alone, its log is
frozen and audited, and a human has taken a turn on a real device.

---

## Unit 18 — Docs and close

**Purpose.** Close the phase the way P2 unit 20 and P3 unit 10 did — with the
claims checked against the code.

**Depends on.** Unit 17.

```
Unit 18 of Phase 4: close.

1. README: a "Client" section — the routes, the auth model (join link
   once, cookie after), the affordances contract in a paragraph, the
   dry run, and the rule that the client never computes a rule. Update
   the API table with every new route. Update "Next" for P5.

2. src/client/README.md: the file map, the model/template split, the
   four conformance tests (affordances↔reduce, forms↔affordances,
   describer↔dispatch table, oracle table↔dispatch table) and what each
   one catches. A future maintainer should be able to tell from this
   file alone which invariant a red test is defending.

3. src/oath/game/README.md: affordances and the peek family added to
   the file map; the visibility classes written out — public, private
   to all, and private to one seat — since there are now three.

4. RULES-COVERAGE.md: §6.3/§6.4 read DONE; §6.6.1 and §6.1's peek
   grants carry their self-policed home; re-check every row this phase
   touched against the CODE and against the LAW TEXT (D48's both
   halves — D55 is what happens when only one is done).

5. INTERRUPTS.md: the standing column carries the conditional forms;
   the measurements table carries the client game; the Peeks row moves
   out of "out of scope".

6. HLD: tick every P4 exit criterion with a pointer; set P4 done in the
   phase board with a shipped paragraph; move anything deferred to its
   named home; record the manual acceptance with date and device;
   answer whatever Q15/Q16/Q17 turned out to be.

7. Run npm test, npm run typecheck, the smoke script, and the suite in
   a LOOP — thirty runs, not six. P3's close is the evidence: a
   1-in-25 flake survived every short loop and was only found when the
   loop was finally run long enough. Prove the loop ran.

Commit: "Document the client; close P4"
```

**Done when.** Docs match code by grep, the HLD is closed out, and the suite
is green in a long loop.

---

## Stretch unit S1 — `powerKind`, mined not transcribed (CUTTABLE)

**Purpose.** Resolves Q3's second half. The composer works without it; this
makes it better and pre-pays a v2 cost. **Cut it if the phase is running
long** — that is what it is here for.

**Depends on.** Unit 5.

```
Stretch unit of Phase 4: powerKind from the CDN.

The card CDN (cardcdn.buriedgiant.com/cards.min.json, already used on
09-12 to verify P1's transcriptions and to find Steppe's capacity
error) carries a `tags` field per card whose values include the POWER
TYPE: Battle Plan, Muster, Search, Travel, Recover, Trade, Campaign,
and plain Power. That is Law §7.4/§7.5's modifier classification,
mechanical and free — a classification, not card text, so unlike
text.json it is committable (contrast D20 and say why in the header).

1. Mine it into src/oath/cards/data/power-kinds.json with the P1
   pattern: a generator script, a committed JSON file, a drift test,
   and zod validation. Reuse the existing interning decoder rather than
   writing a second one.
2. Expose it on the card database as an optional field, read by NOTHING
   in the engine (the same rule text.json lives under).
3. The power.use affordance groups accessible cards by kind and, where
   the current action is known, lists the matching modifiers first.
4. Note in the file header that v2's battle-plan work should start from
   this file rather than re-deriving it — which is what the HLD's
   reference-sources section already recommends.

Tests: drift; every kind is one of the eight; every card id resolves;
the engine's behaviour is byte-identical with the file deleted (prove
it — that is the D20 property restated).

Commit: "Mine the power-kind classification; group the composer by it"
```

---

## Order and dependencies

```
ENGINE  1 close the interface ──> 2 visibility class ──> 3 peeks ──┐
                                                                   │
                                  4 affordances ◀────────────────── ┘
                                       │
                                       └──> 5 majors ──> 6 decisions ──> 7 dry run ──┐
                                                                                     │
CLIENT  8 sessions ──> 9 shell + inbox ──> 10 board ──> 11 composer ◀─────────────────┘
                                                            │
                                    ┌───────────────────────┼───────────────────────┐
                                    ▼                       ▼                       ▼
                             12 deep links            13 history          14 conditional policies
                                                                          15 art ──> 16 visual pass

        12,13,14,15,16 ──> 17 acceptance ──> 18 close     (S1 stretch: any time after 5)
```

Read it as three runs. **1–3** decide what a seat is allowed to know; **4–7**
decide what a seat is allowed to do and hand it to the transport; **8–16** are
the client, which cannot start before 8 and cannot compose before 7.

Units 1–3 are engine work that must precede the interface, because both
change what a seat is allowed to know. Units 4–7 are the phase's spine and
must land in order. Unit 8 is independent and can run any time before 9.
Units 9–13 are the client proper. 14–16 finish the deferred work.

**The phase's feasibility signal**, stated up front so it is not rationalised
away later: if unit 4's harness cannot be made to pass without duplicating
reducer logic inside `affordances.ts`, stop. That would mean the option space
is not derivable from the same predicates the reducer uses, and the honest
fallback is a thinner contract — affordances that enumerate only the
*cheaply* enumerable (travel destinations, relic slots, drawn cards) and a
client that submits optimistically and re-renders the engine's refusal
everywhere else. The composer gets worse; nothing else in the phase changes.
Record it as a reversed decision, not a silent retreat.

---

## Mapping to HLD P4 exit criteria

| Exit criterion | Unit(s) |
| --- | --- |
| A full game playable from a tablet and a laptop | 17 (driver + manual, recorded with date/device) |
| On a phone, the inbox loads and a yes/no decision can be answered | 9 (phone-first), 12, 16 |
| A stale-state conflict is handled without an error page | 11 §4 (409 re-render; the JSON API's 409 stays) |
| Decision deep link opens the right prompt with one tap | 12 (form present in the first response), 8 (sign-in preserves the destination) |
| Every card and site shows its art; unauthenticated asset request refused | 15 (the 401 written as an exploit first), 10 (the `<img>` tags) |
| The client never computes a rule | 4–6 (affordances ↔ reduce), 11 §2 (forms ↔ affordances) |
| Nothing leaks past the view | 1 (payloads + errors), 4 §5 (affordances), 10 §3 (HTML), 13 §2 (describer) |
| §6.3/§6.4 peeks are real actions with a third visibility class | 2, 3 |
| Conditional standing responses, with every pre-P4 policy still folding | 14 |

---

## Risks

Five, and the first two are the ones P3's post-mortem says to watch — because
both of P3's expensive failures were risks that were *not* on its register.

| Risk | Why it is plausible here | Mitigation |
| --- | --- | --- |
| **The client re-derives a rule** | It is the path of least resistance in every template: you have the view, the rule is two lines, and nothing fails if you get it wrong | D56 is structural, not advisory: `affordances` is the only source of legality, the harness proves it against `reduce`, and the forms conformance proves the template did not invent anything. If a template needs a fact it cannot get from an affordance, that is a missing affordance |
| **A leak through a channel nobody swept** | Already happened once, in `recover`, and the P2 audit was green throughout | D59 names four channels — payloads, errors, affordances, rendered HTML — and each gets a sweep in the unit that creates it, re-run over frozen fixtures. Every sweep is proven by planting a leak, per the audit's own instruction |
| **A UI phase never ends** | There is no natural stopping point in visual work, and unlike P2/P3 the suite cannot tell you when it is done | Unit 17 is the gate and it is objective. Unit 16 is exactly one unit, explicitly not TDD (D65), with a checklist rather than an ambition |
| **The art corpus stalls the phase** | ~261 faces plus board art is real manual labour, and it is outside the plan's control | Unit 10 renders correctly with `ART_DIR` empty and unit 15 keeps the placeholder path as a first-class case. The phase can close on a partial corpus — Q15 asks Ben to confirm the bar |
| **The log freezes one unit too early or too late** | D53 said "from P4", and P4 opens with a unit that must change an action shape | D61 moves the line to the end of unit 1 and names it in that commit. Any later shape change needs a migration story, and unit 2 writes the template for one: default it in `init`, prove both fixtures fold byte-identically |

**Two lessons carried forward from P3, written here so they are on the
register this time rather than in the post-mortem:**

1. **A helper that re-derives a rule will drift from it.** Three copies of
   `sacrificeFor` each re-derived §5.5.5 and each got it wrong. In this
   phase the equivalent is a template computing a cost. Call the predicate.
2. **A recorded ruling is evidence of a decision, never of its
   correctness.** D45 was faithfully implemented, tested, dispositioned
   DONE, and wrong — because nobody re-read §3.2's printed sentence. Every
   Law claim this phase touches gets re-read from the text, not from
   RULINGS.md's prose about the text.
