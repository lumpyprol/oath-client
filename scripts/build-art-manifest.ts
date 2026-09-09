import { writeFileSync } from 'node:fs';
import { generate } from '../src/oath/cards/generate.js';
import { DEFAULT_ART_PATH, generateArtManifest } from '../src/oath/cards/art.js';

const manifest = generateArtManifest(generate());
writeFileSync(DEFAULT_ART_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`build-art-manifest: wrote ${DEFAULT_ART_PATH} (${Object.keys(manifest).length} keys)`);
