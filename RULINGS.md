# Rulings

Rulebook edition (Q5): the **Buried Giant Studios rules library, Oath,
printing p1** — <https://rules.buriedgiant.com/?product=oath&locale=en-US&printing=p1>
— which reproduces the *Law of Oath* (October 20, 2020, Leder Games) with
identical section numbering. Code citations use `Law §x.y`; setup steps are
`Law §1.n` (step *n* of the Setup chapter).

Open point: the P1 card data was reconciled against a 2nd-printing-or-later
card set, while this reference is printing p1. If a card-text ruling ever
differs by printing, record it below.

Anything the rulebook leaves ambiguous, and any table ruling the group makes,
is recorded here with the date and the rulebook edition it interprets.

| Date | Question | Ruling | Rulebook ref |
| ---- | -------- | ------ | ------------ |
| 2026-09-09 | The Playbook's "Setup for the First Game" names only 6 of the 8 opening sites in prose (Plains/Mountain/Rocky Coast faceup; Lush Coast/Wastes/Salt Flats facedown) — the 2 remaining facedown slots (Provinces' 2nd, Hinterland's 2nd) are unnamed in that prose. | Resolved definitively (not a judgment call): the publisher's own "Oath Deck Order" packet PDF (buriedgiant.com/oath/Oath%20Deck%20Order.pdf) gives the full 8-site packet sequence and a slot-number diagram. Provinces' 2nd = **Buried Giant**; Hinterland's 2nd = **Great Slum**. Full first-game board: Cradle = Plains (faceup) + Lush Coast (facedown); Provinces = Mountain (faceup) + Buried Giant + Salt Flats (facedown); Hinterland = Rocky Coast (faceup) + Wastes + Great Slum (facedown). | Law §1.1; Oath Deck Order PDF, Packet A 1–2 of 4 |
| 2026-09-09 | Exact numeric Supply value at each Supply-track space (needed for `turn.rest`'s refresh formula, unit 5, and for each seat's starting Supply at setup, unit 4) — no board prints a numeral directly on any space; only warband-count brackets (Rest refresh, §4.3.3) are printed. | **Resolved in full** by inspection of both boards' printed Supply tracks (Ben confirmed the mechanism: warband brackets set the Rest-refresh target, §4.3.3). Both tracks have exactly **8 spaces** — a distinctly-colored "leftmost" space (unlabeled by any warband bracket), then the labeled brackets, then blanks down to the depleted end. Counting from the depleted end at 0, the leftmost space is **7 for both seats** (setup, and the "refresh to leftmost space" citizenship effects — §6.6.2, §6.7, §6.8 — which are distinct from an ordinary Rest and confirm this is a real reachable position, not setup-only decoration). Full Rest-refresh table (§4.3.3), by warband count remaining in personal bank: **Chancellor** — 18+ → 6, 17–11 → 5, 10–4 → 4, 3–0 → 3 (positions 0–2, i.e. supply 0–2, exist on the track but are reachable only by spending down to them, never by a Rest refresh). **Exile** — 9+ → 6, 8–4 → 5, 3–0 → 4 (positions 0–3 likewise unreachable via refresh). **Citizen** does not use their own warband count at all: §4.3.3 says a Citizen "refresh[es] Supply to the space corresponding to the Chancellor's Supply" — i.e. copies whatever value the Chancellor currently holds. | Law §1.10 (leftmost at setup), §4.3.3 (Rest refresh: warband bracket for Exile/Chancellor, copy-Chancellor for Citizen), §6.6.2/§6.7/§6.8 (leftmost as a named citizenship-transition target); board diagrams (Chancellor and Exile Supply tracks) |
