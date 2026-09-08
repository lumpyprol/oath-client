import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const vendorDir = join(here, '../../../vendor/oathparser');

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/**
 * Parse rows of the form `| \`file\` | \`upstream\` | \`hash\` |` out of
 * PROVENANCE.md. The hashes live only in the markdown; the test does not
 * duplicate them.
 */
function parseProvenanceHashes(md: string): Map<string, string> {
  const out = new Map<string, string>();
  const row = /^\|\s*`([^`]+)`\s*\|\s*`[^`]+`\s*\|\s*`([0-9a-f]{64})`\s*\|\s*$/;
  for (const line of md.split('\n')) {
    const m = line.match(row);
    if (m) out.set(m[1], m[2]);
  }
  return out;
}

describe('vendored OathParser provenance', () => {
  const md = readFileSync(join(vendorDir, 'PROVENANCE.md'), 'utf8');
  const hashes = parseProvenanceHashes(md);

  it('PROVENANCE.md lists every expected file', () => {
    expect([...hashes.keys()].sort()).toEqual(
      [
        'LICENSE',
        'cards.lua',
        'enums.ts',
        'names.cards.ts',
        'names.sites.ts',
        'parser.ts',
      ].sort(),
    );
  });

  for (const [file, expected] of parseProvenanceHashes(md)) {
    it(`${file} matches its recorded sha256`, () => {
      expect(sha256(join(vendorDir, file))).toBe(expected);
    });
  }
});
