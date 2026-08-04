import { describe, expect, it } from 'vitest';
import { buildUserRule } from '../../src/enrichment/userRules.ts';

describe('buildUserRule', () => {
  it('trims patterns and removes punctuation-insensitive duplicates', () => {
    expect(
      buildUserRule(
        {
          operator: 'contains',
          patterns: [' Local-Mart ', 'local mart', '', 'Neighbour Foods'],
          category: 'groceries',
        },
        'user:1',
        20,
      ),
    ).toMatchObject({
      id: 'user:1',
      order: 20,
      patterns: ['Local-Mart', 'Neighbour Foods'],
      category: 'groceries',
      origin: 'user',
    });
  });

  it('rejects empty rules and rules that deliberately assign unclassified', () => {
    expect(() =>
      buildUserRule(
        { operator: 'contains', patterns: [' , '], category: 'groceries' },
        'user:1',
        0,
      ),
    ).toThrow('at least one pattern');
    expect(() =>
      buildUserRule(
        { operator: 'exact', patterns: ['merchant'], category: 'unclassified' },
        'user:1',
        0,
      ),
    ).toThrow('must assign a category');
  });
});
