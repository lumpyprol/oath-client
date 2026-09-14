/**
 * The art edge (P4 unit 10). Card art is optional and lives outside git —
 * the asset FILES are unit 15's, and are absent from the repo today — so the
 * board must render correctly with none of them present. This resolver reads
 * the committed manifest (P1) and the asset directory ONCE, then answers,
 * per card face, either an <img> descriptor (asset present) or a signal to
 * render the placeholder (asset absent). With an empty ART_DIR, which is the
 * state of the repo, every face is a placeholder.
 *
 * Impure by nature (it touches the filesystem), so it stays OUT of the pure
 * board model: the model carries card names and structure, and the template
 * asks this resolver only how to draw each face.
 */

import { loadArtManifest, missingAssets, ART_DIR, type ArtManifest } from '../oath/cards/art.js';

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
 * The served URL is `/assets/art/<file>`; unit 15 owns the route that backs
 * it. Nothing emits that URL today, because every asset is absent.
 */
export function makeArtResolver(opts?: { manifestPath?: string; dir?: string }): ArtResolver {
  let manifest: ArtManifest;
  try {
    manifest = loadArtManifest(opts?.manifestPath);
  } catch {
    manifest = {};
  }
  const absent = new Set(missingAssets(manifest, opts?.dir ?? ART_DIR));
  return (key, alt) => {
    const entry = manifest[key];
    if (!entry || absent.has(key)) return { alt };
    return { src: `/assets/art/${entry.file}`, width: entry.width, height: entry.height, alt };
  };
}
