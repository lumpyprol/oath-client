import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  COLLECTIONS,
  DATA_DIR,
  generate,
  serializeCollection,
} from '../src/oath/cards/generate.js';

const db = generate();

for (const name of COLLECTIONS) {
  writeFileSync(join(DATA_DIR, `${name}.json`), serializeCollection(db, name));
}

const summary = COLLECTIONS.map((name) => `${name} ${db[name].length}`).join(', ');
console.log(`build-cards: wrote ${DATA_DIR}\n  ${summary}`);
