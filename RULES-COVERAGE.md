# Rules coverage — every section of the Law, dispositioned

Reference: the Buried Giant Studios rules library, **Oath, printing p1**
(<https://rules.buriedgiant.com/?product=oath&locale=en-US&printing=p1>),
which is the edition RULINGS.md pins. Every numbered subsection of §1–§11
appears below exactly once, with one of three dispositions:

| | meaning |
| --- | --- |
| **DONE** | implemented, naming the file/function so the claim is checkable |
| **DEFER** | not implemented, naming **where it is recorded** and **where it will be done** |
| **N/A** | not a rules obligation for this engine, with the reason |

**"v2" alone is not a home.** A deferral has to name a unit, a phase scope
bullet, or a Q. (The Peek family sat on the deferred list for four units
described as "the v2/P4 boundary" while P4's scope never mentioned it —
nothing would ever have picked it up. It is now a P4 scope bullet.)

## How this was produced, and how to redo it

Written in unit 20, walking the Law top to bottom. The method matters more
than the table: P2 found **ten** rules bugs that were all already "recorded
as fine", so a review that re-reads our own notes is worthless.

- Check every claim against the **code**, not the notes.
- **Distrust "inert in FIRST_GAME."** Seven of the ten were invisible
  because the fixture the tests use is a Supremacy first game with no
  facedown Cradle top, no ruins, no Citizens and no faceup Opportunity
  Site. Re-check §1 against a **seeded** game.
- Anything deferred to a *declared* power must actually be **declarable**.
- Where a rule **is** enforced, check the enforcement is **reachable**.

---

## §1 Setup — `setup.ts` (`oathSetup`, `init`, `specFromSeed`)

| § | Rule | Disposition |
| --- | --- | --- |
| 1.1 | Deal Chronicled sites and their attached cards | **DONE** `SetupSpec.sites`; from a chronicle via `specFromSeed` |
| 1.2 | Round marker at 1, Visions Drawn at 0 | **DONE** `turn.round`; and see 1.22 |
| 1.3 | Chronicled goal reference near the map | **DONE** `state.oath` |
| 1.4 | Collect the shared bank | **DONE** for favor/secrets. Dice are not components — §9.3 exempts them |
| 1.5 | 1 favor on the People's Favor, 1 secret on the Darkest Secret | **DONE** `init` banners |
| 1.6 | 3 favor per bank; 4 at 5–6 players | **DONE** `favorBankSize` |
| 1.7 | Choose the Chancellor, seat the rest | **N/A** table procedure; seat 0 is the Chancellor by convention (`checkInvariants`) |
| 1.8 | Chancellor takes 24 warbands, Scepter, Reliquary | **DONE** `init`, `grandScepter`, `reliquary` |
| 1.9 | Others take 14 warbands of their colour | **DONE** `init`; a Chronicled Citizen instead draws purple, see 1.15 |
| 1.10 | Supply markers leftmost | **DONE** `LEFTMOST_SUPPLY` |
| 1.11 | Chancellor takes 2 favor, 1 secret | **DONE** `init` |
| 1.12 | 3 on board, 2 on the topmost **faceup** Cradle site, 1 on each other faceup site with a denizen or **intact** edifice | **DONE** `init` — both qualifiers were wrong until unit 20 (finding 8) |
| 1.13 | Devotion/The People hand the Chancellor a banner | **DONE** `init` — unimplemented until 09-12 (finding 2) |
| 1.14 | Chancellor takes the Oathkeeper title | **DONE** `oathkeeper: 0`, `usurper: false` |
| 1.15 | Each Exile/Citizen takes 1 favor + 1 secret; Exiles 3 own warbands, **Citizens 3 purple** | **DONE** `init` — the Citizen branch was wrong until unit 18 (finding 5) |
| 1.16 | Place reveal-prompt tokens on faceup sites | **DONE** `init` — unimplemented until 09-12 (finding 3) |
| 1.17 | Chancellor draws 4 relics to the Reliquary | **DONE** `oathSetup`, capped by §9.3 when a chronicle carries fewer (finding 6) |
| 1.18 | Remaining relics form the relic deck | **DONE** `oathSetup` |
| 1.19 | 3 cards from the bottom, 1 per discard pile | **DONE** `oathSetup` |
| 1.20 | Each player draws 3 from the bottom | **DONE** `oathSetup` |
| 1.21 | The rest is the world deck | **DONE** `oathSetup` |
| 1.22 | Advance Visions Drawn by the number drawn | **DONE** `oathSetup` — unimplemented until unit 19 (finding 7); counts §1.20's draws only, see RULINGS.md |
| 1.23.1 | Each player places their pawn on any faceup site | **DEFER** — only the Chancellor's is fixed; the rest default to the first faceup site. Recorded: `setup.ts`, prompt plan unit 18 note. Home: **P3 scope bullet** (a setup-time pending decision) |
| 1.23.2 | Each player chooses 1 of 3 as a facedown adviser | **DEFER** — `oathSetup` keeps the first drawn. Recorded: `setup.ts`. Home: **P3 scope bullet**, with 1.23.1 (coupled: the pawn decides where the 2 rejects are discarded) |
| 1.23.3 | Discard the other 2 | **DONE** `oathSetup` |

## §2 Key Components

| § | Rule | Disposition |
| --- | --- | --- |
| 2.1.1 | Regions and their site counts | **DONE** `map.ts REGION_SITE_COUNTS` |
| 2.1.2 | A discard pile per region | **DONE** `state.discards` |
| 2.1.3 | Favor banks | **DONE** `state.favorBanks` |
| 2.1.4 | Round track | **DONE** `turn.round` |
| 2.1.5 | World deck | **DONE** `state.worldDeck` |
| 2.1.6 | Visions Drawn track drives the Search cost | **DONE** `search.ts worldDeckCost` |
| 2.1.7 | Shared bank | **DONE** `state.sharedBank` |
| 2.2.1 | Board holds favor/secrets/warbands; Exile side has a Revealed Vision space | **DONE** `PlayerState` |
| 2.2.2 | Up to three advisers | **DONE** `ADVISER_LIMIT`, `checkInvariants` |
| 2.2.3 | Personal bank holds warbands, relics, banners | **DONE** `PlayerState` |
| 2.3 | Reliquary: 4 relics; excluded from Campaign, Recover and victory goals; powers unusable; uncovering grants the Chancellor its modifier | **DONE** all five clauses — `ReliquarySpace`, `power.ts hasAccess`, `victory.ts relicsAndBanners` |
| 2.4.1 | Relic Recover cost comes from the site | **DONE** `site-reveals.json recoverCost` |
| 2.4.2 | Relic defense dice | **DONE** `relic-defense-dice.json`, verified against the card CDN |
| 2.5.1 | Banner Recover cost is variable | **DONE** `recover.ts` |
| 2.5.2 | Banner defense dice = tokens on it | **DONE** `campaign.ts declare` |
| 2.5.3 | Seize Penalty | **DONE** `campaign.ts applyVictorySpoils` |
| 2.6.1 | Denizen suit | **DONE** card data |
| 2.6.2 | Restriction banner | **DONE (partial by design)** `restrictions.ts` — only cards whose faces were read; absent means UNREAD. Rest: **v2**, per D46 |
| 2.6.3 | Denizen power | **DEFER** the v1/v2 bargain (D9/D28). Home: **HLD §6 "v2 — Engine-enforced card powers"** |
| 2.7.1 | A Vision drawn advances the track | **DONE** `search.ts`, `oathSetup` |
| 2.7.2 | Vision goals; the Conspiracy's When Played | **DONE** goals (`victory.ts VISION_GOALS`). Conspiracy's power: **DEFER** → v2 card powers |
| 2.8.1 | Card capacity | **DONE** card data + `checkInvariants` (Steppe corrected, RULINGS.md) |
| 2.8.2 | Reveal prompt | **DONE** `init` (§1.16) and `travel.ts` (§5.6.2) |
| 2.8.3 | Site defense die and bandit | **DONE** `campaign.ts` |
| 2.8.4 | Relic Recover cost on the site | **DONE** `site-reveals.json` |
| 2.8.5 | Site power | **DEFER** → v2 card powers. (§11.1 and §11.4 are exceptions — implemented, being identity-only and mandatory) |
| 2.9 | Edifices; a ruin has no suit and cannot Muster or Trade | **DONE** `CardInPlay.ruined`, refused in `muster.ts`/`trade.ts`. Building them is §8.3.1 → **P5** |
| 2.10 | Goal reference | **DONE** `state.oath` |
| 2.11 | Oathkeeper goals, tie rules, flip-on-take, title defense dice, the Empire's Supremacy clause | **DONE** `victory.ts updateTitle`/`seatsMeetingOath`, `campaign.ts titleDefenseDice`. Tie reading: D45 |

## §3 Victory — `victory.ts`

| § | Rule | Disposition |
| --- | --- | --- |
| 3.1 | Usurper Win | **DONE** `finishWake` |
| 3.2 | Visionary Win, incl. the three-Vision floor | **DONE** `visionGoalMet`, `VISION_FLOOR` |
| 3.3 | Stable Regime, rounds 5–7, die faces | **DONE** `roundEnd`, `STABLE_REGIME_TARGET`; die from `prepareRest` (D14) |
| 3.3.1 | Successor goals (crossed against the oath) | **DONE** `meetsSuccessorGoal` |
| 3.4 / 3.4.1–3.4.4 | War Exhaustion and its priority order, incl. the Vision tiebreak | **DONE** `warExhaustion`, `VISION_TIEBREAK` |

## §4 Sequence of Play — `turn.ts`, `victory.ts`, `index.ts`

| § | Rule | Disposition |
| --- | --- | --- |
| 4 | Rounds, turn order, round end, Stable Regime check, advance marker | **DONE** `turn.ts rest`, `victory.ts afterAction` |
| 4.1 | Wake Phase resolved in order | **DONE** `beginWake`/`advanceWake`/`finishWake`; also run for the opening turn from `init` |
| 4.1.1 | People's Favor maintenance, Mob repeat, flip at 6 | **DONE** `wakeOptions`, `wake.favor` |
| 4.1.2 | Check for Win (Exiles) | **DONE** `finishWake` — before 4.1.3, which is the Usurper clock |
| 4.1.3 | Flip to Usurper | **DONE** `finishWake` |
| 4.1.4 | Opportunity Site take | **DONE** `offerOpportunity`, `wake.take` — was wrongly deferred until 09-12 (finding 4, D47) |
| 4.2 | Act Phase; one action at a time; Supply spent by moving the marker | **DONE** `requireActiveSeat` (mid-Search, Campaign and Wake locks); Supply decremented per action |
| 4.3.1 | Return favor on denizens/edifices to their banks | **DONE** `turn.ts returnCardFavor` |
| 4.3.2 | Return secrets to your board; flip facedown ones up | **DONE** `turn.ts returnCardSecrets` — site cards were never swept until 09-12 (finding 1). Scoping reading in RULINGS.md |
| 4.3.3 | Refresh Supply (bracket table; Citizens copy the Chancellor) | **DONE** `refreshTarget`; table in RULINGS.md |
| 4.3.4 | Save Supply, capped at leftmost | **DONE** `turn.ts rest` |
| 4.3.5 | Use Rest powers | **DEFER** → v2 card powers |

## §5 Major Actions

| § | Rule | Disposition |
| --- | --- | --- |
| 5.1.1–5.1.3 | Search: cost, draw 3, stop on a Vision, discard the rest | **DONE** `search.ts`, `play.ts` |
| 5.1.4 | Play one card | **DONE** `play.ts` |
| 5.1.4.I | To your site, gain matching favor | **DONE**. The People's Favor holder's cross-site variant: **DEFER** → v2 |
| 5.1.4.II | To your advisers, faceup or facedown; adviser-limit discard | **DONE** |
| 5.1.4.III | Visions: Exiles only, Revealed Vision space, discard the prior one | **DONE** |
| 5.1.4.IV | The Conspiracy's faceup play | **DEFER** → v2 card powers |
| 5.2.1–5.2.2 | Muster; Citizens gain purple | **DONE** `muster.ts` (purple is an invariant-level fact, D41) |
| 5.3.1–5.3.2 | Trade, both options | **DONE** `trade.ts` |
| 5.4.1–5.4.4 | Recover: target, cost, take, resolve banner | **DONE** `recover.ts` incl. §5.4.1's Darkest Secret restriction |
| 5.5.1 | Choose defender; §5.5.1's Imperial carve-out | **DONE** `campaign.ts declare`, `rule.ts imperialExclusionFor` |
| 5.5.2 | Declare targets, dice pools, Allies, title dice | **DONE** targets (incl. the Grand Scepter), Ally joining, §2.11 dice. "Activate all Campaign modifiers": **DEFER** → v2 |
| 5.5.3 | Battle plans | **DEFER (window half DONE)** — who may act in the window is enforced (`power.ts`); the plans themselves and the once-each bookkeeping → v2. A Citizen Ally cannot reach the window with one response phase: **P3** |
| 5.5.4 | Roll defense; site/board/Ally warbands; shield doubling | **DONE** `defenseTotal`, `defendingForce` |
| 5.5.5 | Roll attack; skulls; exact sacrifice | **DONE** `resolve`, per §9.5 |
| 5.5.6 | Resolve defeat; the Chancellor allocates an Imperial force's losses | **DONE** `applyDefeat`, `campaign.casualties` |
| 5.5.7 | Attacker's victory: placements, Imperial consolidation, relics/banners, banish and burn | **DONE** `seize`, `survivorBoardOf`, `applyVictorySpoils` |
| 5.5.8 | Battle-plan triggers | **DEFER** → v2, with §5.5.3 |
| 5.6.1–5.6.2 | Travel cost table; move and reveal | **DONE** `map.ts travelCost`, `travel.ts`. Site-specific cost modifiers (§11.3/11.6/11.7) → v2, declarable since unit 16d's `supply` effect |

## §6 Minor Actions

| § | Rule | Disposition |
| --- | --- | --- |
| 6.1 | Play or discard a facedown adviser | **DONE** `adviser.ts` |
| 6.2 | Use an Action power | **DONE (structurally)** `power.use`; what the power does → v2 |
| 6.3 | Peek at a relic at your site | **DEFER** — needs persistent peek memory + a projection change. Home: **P4 scope bullet** |
| 6.4 | Peek at an Imperial relic | **DEFER** — with 6.3, **P4** |
| 6.5 | Move warbands to/from your site; Citizen permission; Imperial give/take | **DONE** `warbands.ts` |
| 6.6.1–6.6.3 | Offering, accepting, Imperial players | **DONE** `citizenship.ts`, `rule.ts`. The Reliquary's revealed modifier: access **DONE**, its effect → v2 |
| 6.7 | Exiling a Citizen | **DONE** `citizenship.ts` |
| 6.8 | Self-exiling | **DONE** `citizenship.ts` |

## §7 Powers

| § | Rule | Disposition |
| --- | --- | --- |
| 7.1.1 | Access | **DONE** `power.ts hasAccess` |
| 7.1.2 | Cost; the occupied-card rule; paying outside your turn | **DONE** the occupied-card rule (`effects.ts checkPlaceable`, unit 16d). Card cost braids and the outside-your-turn secret flip → **v2** (`effects.ts` header records the flipped-pool gap) |
| 7.1.3 | Resolve as much as possible | **N/A in v1** — the engine never resolves power text; D9/D28 |
| 7.1.4 | Persistent powers | **DEFER** → v2 |
| 7.2 / 7.2.1 / 7.2.2 | Restriction banners; tree/person; locked | **DONE for transcribed cards** `restrictions.ts`, enforced in the zone-choosing paths. Remaining cards → v2, per D46 |
| 7.3.1–7.3.4 | Wake / Action / When Played / Rest powers | **DEFER** → v2. (§4.1.1's People's Favor Wake power is the one exception — implemented, being turn-sequence structure) |
| 7.4.1–7.4.3 | Major action modifiers | **DEFER** → v2 |
| 7.5.1–7.5.4 | Battle plans | **DEFER** → v2, with §5.5.3 |
| 7.6.1–7.6.5 | Forced Citizenship, Free Travel, Binding, Adviser Limiters, Bandit Crown | **DEFER** → v2 (all are specific card powers) |

## §8 Writing the Chronicle

| § | Rule | Disposition |
| --- | --- | --- |
| 8.1–8.8 | Vow an Oath, offer Citizenship, clean up the map, build edifices, rebuild the world deck, clean up relics, save the boards | **DEFER (whole chapter)** — this is the chronicle-WRITING direction. P2 implements the READING direction (unit 18's `specFromSeed`). Home: **P5 Chronicle**, whose scope names it |

## §9 Interpreting Rules

| § | Rule | Disposition |
| --- | --- | --- |
| 9.1 | Interpret literally; italics are reminders; the Law supersedes play aids | **N/A** a reading rule. Followed as a convention — RULINGS.md records every place we had to choose a reading |
| 9.2 | Must / if able / cannot / ignore | **N/A** a reading rule; applied case by case (e.g. §4.1.1's skip when neither half is possible) |
| 9.3 | Component limits; take as many as possible | **DONE** where reachable: `search.ts`, `travel.ts` reveal, `play.ts` favor gain, §1.17's Reliquary fill. Secrets exempt — `effects.ts` allows the shared secret pool to go negative |
| 9.4 | Public and private information | **DONE** `project.ts`, audited over a full game by `audit.test.ts` |
| 9.5 | No unprompted losses | **DONE** `campaign.ts` sacrifice exactness; effect amounts are always prompted |
| 9.6 | No unprompted binding promises | **N/A** table rule. Its two exceptions are modelled: Citizenship offers (`citizenship.ts`) and §7.6.3 binding powers → v2 |

## §10 Glossary

| § | Term | Disposition |
| --- | --- | --- |
| 10.2 After, 10.14 Match, 10.15 Move, 10.17 Peek, 10.19 Play, 10.20 Reveal, 10.25 Swap, 10.26 Take, 10.11 Give, 10.8 Exchange | **N/A / v2** — vocabulary used by card powers; the movers that exist follow them |
| 10.3 Bandit | **DONE** `campaign.ts` — bandits are not warbands and are never killed |
| 10.4 Burn | **DONE** `sharedFavor`/`sharedSecrets` destinations |
| 10.5 Discard | **DONE** region cycle (`map.ts discardRegion`) and the token rule (`discard.ts`, finding 9). The cross-region exception ("discard based on the region of the card") is reachable only from v2 powers → **v2** |
| 10.6 Draw | **DONE** `search.ts` |
| 10.7 Enemy, 10.28 You, 10.29 Your Enemy | **N/A / v2** — used by card text |
| 10.9 Force | **DONE** `campaign.ts ForceEntry` |
| 10.10 Gain | **DONE** effect movers |
| 10.12 Imperial Player | **DONE** `rule.ts imperialForce` |
| 10.13 Kill | **DONE** `killBankOf` — purple to the Chancellor |
| 10.16 Locked | **DONE** `restrictions.ts` (transcribed cards) |
| 10.21 Rule | **DONE** `rule.ts rulersOf`, incl. §6.6.3 and bandits |
| 10.22 Sacrifice | **DONE** `campaign.ts resolve` |
| 10.23 Seize | **DONE** `applyVictorySpoils` |
| 10.27 Travel Cost | **DONE** `map.ts` |
| 10.30 Your Site/Region | **DONE** `pawnSite` |
| 10.1, 10.18, 10.24 | Cross-references to §2 | **N/A** |

## §11 Site Reference

| § | Rule | Disposition |
| --- | --- | --- |
| 11.1 | Opportunity Sites | **DONE** `victory.ts OPPORTUNITY_SITES` (D47) |
| 11.4 | Plains / Mountain attack die | **DONE** `campaign.ts declare` — identity-only and mandatory, so structural |
| 11.2 Homeland, 11.3 Coast, 11.5 River, 11.6 Charming Valley, 11.7 Shrouded Wood, 11.8 Narrow Pass, 11.9 The Tribunal | **DEFER** → v2 site powers. All are declarable today; the Travel-cost ones only since unit 16d added the `supply` effect |

---

## What this pass changed

Three findings, all fixed in unit 20 (findings 8–10 of P2's ten):

1. **§1.12** placed the Chancellor's 2 warbands on the topmost Cradle site
   rather than the topmost **faceup** one.
2. **§1.12** also gave a warband to a site holding only a **ruin**, where
   the Law says "denizen or **intact** edifice".
3. **§10.5** — discarding a card carrying tokens refused outright with a
   "see v2" note that was recorded nowhere. A declared power can put a
   secret on an adviser today, so this was a live breach of the v1 bargain,
   not a deferral. Now `discard.ts`.

All three were invisible from `FIRST_GAME`, like most of this phase's bugs:
a chronicle can start with a facedown Cradle top and with ruins on the map,
and a first game has neither.
