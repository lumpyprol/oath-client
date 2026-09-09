import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The vendored parser's name tables (`names.cards.ts`, `names.sites.ts`) are
 * plain `export const X = { 'Name': n, ... }` object literals. We read them as
 * text rather than importing them, so `vendor/` never enters the TS build.
 */
export function parseTsNameTable(source: string): Record<string, number> {
  const out: Record<string, number> = {};
  const row = /^\s*'((?:[^'\\]|\\.)*)'\s*:\s*(\d+)\s*,?\s*$/;
  for (const line of source.split('\n')) {
    if (/^\s*\/\//.test(line)) continue; // comment line
    const m = line.match(row);
    if (!m) continue;
    const name = m[1].replace(/\\(['"\\])/g, '$1');
    out[name] = Number(m[2]);
  }
  return out;
}

const vendorDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../vendor/oathparser',
);

export function loadTsCardNames(
  path = join(vendorDir, 'names.cards.ts'),
): Record<string, number> {
  return parseTsNameTable(readFileSync(path, 'utf8'));
}

export function loadTsSiteNames(
  path = join(vendorDir, 'names.sites.ts'),
): Record<string, number> {
  return parseTsNameTable(readFileSync(path, 'utf8'));
}
