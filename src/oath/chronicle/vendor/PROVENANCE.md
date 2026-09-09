# Vendored: OathParser seed parser

These files are a working copy of the seed parser, imported into `src/` so the
build can use it. The pristine copies (with sha256 hashes) live in
`vendor/oathparser/` — see `vendor/oathparser/PROVENANCE.md`.

- **Repo:** https://github.com/Vagabottos/OathParser
- **Commit:** `53b7f533b8fb7fbd617d6bde6fe824238680262f` (2022-01-24)
- **License:** MIT (`vendor/oathparser/LICENSE`)

| File here | Upstream |
| --- | --- |
| `parser.ts` | `src/index.ts` |
| `enums.ts` | `src/interfaces/enums.ts` |
| `oathgame.ts` | `src/interfaces/oathgame.ts` |
| `names.cards.ts` | `src/interfaces/cards.ts` |
| `names.sites.ts` | `src/interfaces/sites.ts` |

Changes from upstream are limited to what `strict` TypeScript requires plus the
`./interfaces` barrel being split into explicit `.js` imports. Each file's
header lists its edits. Parsing and serialization behaviour is unchanged — the
two sample seeds in `test/oath/chronicle/seed.test.ts` round-trip byte for byte.
