import { normalise } from './narration.ts';
import { categoryOf } from './taxonomy.ts';
import type { Rule, RuleInput } from './types.ts';

/**
 * Turn form input into the canonical stored representation of a user rule.
 *
 * Patterns keep their human-readable spelling, while duplicates are detected
 * through the same punctuation-insensitive normalisation used by the matcher.
 */
export function buildUserRule(input: RuleInput, id: string, order: number): Rule {
  const patterns: string[] = [];
  const seen = new Set<string>();

  for (const raw of input.patterns) {
    const pattern = raw.trim();
    const key = normalise(pattern);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    patterns.push(pattern);
  }

  if (patterns.length === 0) throw new RangeError('A rule needs at least one pattern.');
  if (input.category === 'unclassified') {
    throw new RangeError('A rule must assign a category.');
  }
  // Runtime guard for form and persistence boundaries, where a cast could
  // otherwise smuggle an unknown category past TypeScript.
  categoryOf(input.category);

  return {
    id,
    order,
    operator: input.operator,
    patterns,
    category: input.category,
    origin: 'user',
  };
}
