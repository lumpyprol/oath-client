export interface RawRecord {
  name: string;
  fields: Record<string, string | number>;
}

// ["Some Name"] = { body }  — optional trailing comma, optional trailing -- comment
const RECORD_RE = /^\s*\["([^"]+)"\]\s*=\s*\{(.*)\}\s*,?\s*(?:--.*)?$/;

/**
 * Parse the mod's cards.lua card table. This is a line parser for one specific
 * file, not a Lua interpreter: every record we care about is a single line of
 * the form `["Name"] = { key = value, ... },`.
 */
export function parseCardsLua(source: string): RawRecord[] {
  const out: RawRecord[] = [];
  const lines = source.split('\n');

  lines.forEach((line, i) => {
    const lineNo = i + 1;

    // Commented-out lines are skipped even if they look like records.
    if (/^\s*--/.test(line)) return;

    const m = line.match(RECORD_RE);
    if (!m) return; // function headers, nested tables, closing braces, etc.

    const [, name, body] = m;
    out.push({ name, fields: parseBody(body, lineNo) });
  });

  return out;
}

function parseBody(body: string, lineNo: number): Record<string, string | number> {
  const fields: Record<string, string | number> = {};
  const trimmed = body.trim();
  if (trimmed === '') return fields;

  for (const part of trimmed.split(',')) {
    if (part.trim() === '') continue;
    const pair = part.match(/^\s*(\w+)\s*=\s*(.+?)\s*$/);
    if (!pair) {
      throw new Error(`parseCardsLua: line ${lineNo}: cannot parse field ${JSON.stringify(part)}`);
    }
    const [, key, rawValue] = pair;
    const str = rawValue.match(/^"([^"]*)"$/);
    if (str) {
      fields[key] = str[1];
    } else if (/^-?\d+(?:\.\d+)?$/.test(rawValue)) {
      fields[key] = Number(rawValue);
    } else {
      throw new Error(`parseCardsLua: line ${lineNo}: cannot parse value ${JSON.stringify(rawValue)} for ${key}`);
    }
  }

  return fields;
}
