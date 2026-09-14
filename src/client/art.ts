/**
 * The art edge (P4 units 10 & 15). Card art lives outside git in ART_DIR.
 * This resolver reads the bundled manifest (P1) and checks the asset
 * directory ONCE, then answers, per card face, either an <img> descriptor
 * (asset present) or a signal to render the placeholder (asset absent) — so
 * a missing file degrades to a named placeholder instead of a broken image,
 * and a half-filled corpus reads as deliberate.
 *
 * Impure by nature (it touches the filesystem), so it stays OUT of the pure
 * board model: the model carries card names and structure, and the template
 * asks this resolver only how to draw each face.
 */

import { ART_MANIFEST, missingAssets, ART_DIR, type ArtManifest } from '../oath/cards/art.js';

export interface ArtRef {
  /** The <img> src, only when the asset is present; its absence means "placeholder". */
  src?: string;
  width?: number;
  height?: number;
  alt: string;
}

export type ArtResolver = (key: string, alt: string) => ArtRef;

/**
 * Build a resolver. `manifestPath`/`dir` are injectable for tests; the
 * defaults are the committed manifest and the (empty, today) ART_DIR. A
 * manifest that fails to load degrades to all-placeholder rather than
 * throwing — the board is readable even if the manifest is missing.
 *
 * The served URL is `/art/<file>`, backed by the gated route in web.ts —
 * authenticated seats only. A key whose asset is absent still falls back to
 * the placeholder, so a half-filled corpus reads as deliberate.
 */
export function makeArtResolver(opts?: { manifest?: ArtManifest; dir?: string }): ArtResolver {
  // The bundled manifest by default — no fs read at runtime (it ships in
  // dist like the card data). Tests may inject a manifest or an empty `dir`.
  const manifest = opts?.manifest ?? ART_MANIFEST;
  const absent = new Set(missingAssets(manifest, opts?.dir ?? ART_DIR));
  return (key, alt) => {
    const entry = manifest[key];
    if (!entry || absent.has(key)) return { alt };
    return { src: `/art/${entry.file}`, width: entry.width, height: entry.height, alt };
  };
}
