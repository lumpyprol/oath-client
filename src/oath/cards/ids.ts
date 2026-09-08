export type CardKind =
  | 'denizen'
  | 'site'
  | 'relic'
  | 'vision'
  | 'edifice'
  | 'banner';

/**
 * Deterministic name -> slug. See the unit 3 spec in
 * prompts/prompt_plan_phase_1.md for the rules and rationale.
 */
export function slugify(name: string): string {
  // "A / B" compound names: keep only the part before the first " / ".
  const primary = name.split(' / ')[0];

  // Drop a leading article "the " (printings disagree on it); "a " stays.
  const dearticled = primary.replace(/^\s*the\s+/i, '');

  const slug = dearticled
    .toLowerCase()
    .replace(/['’]/g, '') // apostrophes are removed, not hyphenated
    .replace(/[^a-z0-9]+/g, '-') // every other non-alnum run -> one hyphen
    .replace(/^-+|-+$/g, ''); // trim leading/trailing hyphens

  if (!/^[a-z0-9-]+$/.test(slug) || slug.length === 0) {
    throw new Error(`slugify: ${JSON.stringify(name)} produces an invalid slug ${JSON.stringify(slug)}`);
  }
  return slug;
}

export function cardId(kind: CardKind, name: string): string {
  return `${kind}:${slugify(name)}`;
}
