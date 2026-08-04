// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useSessionStore } from '../../src/hooks/useSessionStore.ts';

describe('useSessionStore categorization writes', () => {
  it('serializes manual overrides and rule changes through the session store', async () => {
    const { result } = renderHook(() => useSessionStore());

    await act(async () => {
      await result.current.categorize('txn-1', 'travel');
    });
    expect(await result.current.store.listOverrides()).toEqual(new Map([['txn-1', 'travel']]));

    await act(async () => {
      await result.current.addRule({
        operator: 'contains',
        patterns: ['LOCAL MART'],
        category: 'groceries',
      });
    });
    const rules = await result.current.store.listRules();
    expect(rules).toMatchObject([
      { id: 'user:1', order: 0, patterns: ['LOCAL MART'], category: 'groceries' },
    ]);

    await act(async () => {
      await result.current.deleteRule(rules[0]!.id);
      await result.current.categorize('txn-1', null);
    });
    expect(await result.current.store.listRules()).toEqual([]);
    expect(await result.current.store.listOverrides()).toEqual(new Map());
    expect(result.current.revision).toBe(4);
  });
});
