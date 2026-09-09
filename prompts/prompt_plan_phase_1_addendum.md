# Prompt plan — Phase 1 addendum

**Date:** 2026-09-08
**Applies to:** `prompt_plan_phase_1.md`, which was already in progress when
these changes landed. That file is left as written; this addendum extends it.

## What changed

Two scope decisions were made after Phase 1 started (see HLD §7):

- **D27 — card art and board art are in scope.** Reverses D22 (text-only
  cards). Assets stay outside git and are token-gated; only a manifest is
  committed.
- **D28 — power enforcement must not be impeded.** Declared and enforced
  powers will share one `effects` representation. This has no Phase 1 work;
  it is noted here because it slightly raises the value of `powerKind` on the
  text overlay (unit 9). Fill it if convenient, don't block on it.

D29 (tablet/laptop as the primary surface) has no Phase 1 impact.

## Effect on existing units

- **Unit 9 (text overlay).** Unchanged. Text remains the accessible fallback
  and the tap-through on small screens; it is not replaced by art.
- **Unit 7 (drift test).** Unit 12 below adds `art.json` to the set of
  generated files the drift test covers. Do that as part of unit 12, not by
  reopening unit 7.
- **Unit 11 (docs).** Add a paragraph on the art manifest and the asset
  directory. If unit 11 is already done, do it in unit 12's commit.
- **Order.** Unit 12 depends on unit 8 and is otherwise independent; it can
  run before or after units 9–11.

## Exit criterion added to Phase 1

- [ ] art manifest covers every card face and site; asset presence test
      passes against the local asset directory

## Open questions this unit needs answered

- **Q8** — where do art assets live? Leaning Fly volume beside the db.
- **Q9** — art source: own scans vs mod atlases; source resolution.

The unit is written so the manifest and tests can be completed before either
is answered; only the skipped integration test waits on the assets.

---

## Unit 12 — Art manifest

**Purpose.** Map every card face and every site to an asset filename so the
client (P4) can render real art, and so a missing asset fails a test rather
than a page. Added 09-08 when art came into scope (HLD D27). Assets
themselves stay out of git.

**Depends on.** Unit 8. **Needs your input** on asset source and location
(HLD Q8, Q9).

```
Unit 12 of Phase 1: the art manifest.

Create `src/oath/cards/art.ts` exporting:

  const ArtEntry = z.object({
    file: z.string().regex(/^[a-z0-9._-]+\.(webp|png|jpg)$/),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
  })
  // key is a card id, or `${id}#ruin` / `${id}#1` for the second face of an
  // edifice/ruin or a two-faced banner; sites use their normal id
  const ArtManifest = z.record(z.string(), ArtEntry)

  loadArtManifest(path?: string): ArtManifest   default
                                                src/oath/cards/data/art.json
  requiredArtKeys(db: CardDatabase): string[]   one per card, plus one per
                                                extra face
  missingArt(manifest, db): string[]            required keys absent from
                                                the manifest
  missingAssets(manifest, dir): string[]        manifest entries whose file
                                                isn't in `dir`

Validation: every manifest key must be a required key (no orphans);
loadArtManifest throws listing unknown keys.

Read the asset directory from env ART_DIR (default ./assets/art). Add
`assets/` to .gitignore.

TDD, `test/oath/cards/art.test.ts`:
  - requiredArtKeys yields one key per denizen/relic/vision/site, two per
    edifice/ruin, and one per banner face — assert the total against the
    collection counts
  - a manifest with an orphan key throws naming it
  - missingArt on an empty manifest returns every required key
  - missingAssets against a temp dir containing one fake file returns
    everything but that one
  - integration, SKIPPED unless ART_DIR exists: missingArt(real manifest)
    is [] and missingAssets is []. Use vitest's `it.skipIf`.

Create `src/oath/cards/data/art.json` with every required key and a
filename derived from the id (`denizen-wrestlers.webp`,
`edifice-sprawling-rampart-ruin.webp`, …). Generate it with a small
script `scripts/build-art-manifest.ts` (npm script "build:art") so it can
be regenerated when the naming convention changes. Add it to the unit-7
drift test.

Filling the directory is my job. The test stays skipped until I do.

Commit: "Add art manifest and asset presence checks"
```

**Done when.** Manifest covers every face; presence test passes locally with
your assets and is skipped in CI.

---

## Updated dependency graph

```
1 vendor ──┐
2 schema ──┼──> 5 build ──> 6 reconcile ──> 7 generate/drift ──> 8 loader ──> 9 text
3 ids ─────┤                                                        │
4 lua ─────┘                                                        ├──> 10 seed ──> 11 docs
                                                                    └──> 12 art
```
