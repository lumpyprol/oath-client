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
| 2026-09-09 | Exact numeric Supply value at each Supply-track space (needed for `turn.rest`'s refresh formula, unit 5, and for each seat's starting Supply at setup, unit 4) — no board prints a numeral directly on any space; only warband-count brackets (Rest refresh, §4.3.3) are printed. | Resolved by inspection of both boards' printed Supply tracks (Ben confirmed the mechanism: warband brackets set the Rest-refresh target, §4.3.3): both the Chancellor's and the Exile's Supply track have exactly **8 spaces** — one distinctly-colored "leftmost" space (unlabeled by any warband bracket), then the labeled brackets, then blanks down to the depleted end. Counting from the depleted end at 0, the leftmost space is **7 for both seats**. Corroboration: several citizenship rules (§6.6.2, §6.7, §6.8) say "refresh Supply to its leftmost space" as an effect distinct from a normal Rest — meaning it's a real, reachable position, not setup-only decoration, and the Rest formula's brackets (which never reach it on their own) top out one space short of it. `turn.rest`'s full bracket→value table (unit 5) still needs transcribing in full, but the *leftmost* value it must match is now settled. | Law §1.10 (leftmost at setup), §4.3.3 (Rest refresh by warband bracket), §6.6.2/§6.7/§6.8 (leftmost as a named citizenship-transition target); board diagrams (Chancellor and Exile Supply tracks) |
