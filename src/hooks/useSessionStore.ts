import { useCallback, useRef, useState } from 'react';
import type { Account, ParsedStatement } from '../model/canonical.ts';
import type { CategoryId } from '../enrichment/taxonomy.ts';
import { nextRuleOrder } from '../enrichment/preview.ts';
import type { Rule, RuleInput } from '../enrichment/types.ts';
import { buildUserRule } from '../enrichment/userRules.ts';
import { createMemoryStore } from '../storage/memoryStore.ts';
import type { ImportMeta, ImportRecord, ImportSummary, Store } from '../storage/store.ts';

/**
 * The session's one store, and the revision counter that tells readers when it
 * changed.
 *
 * The store is deliberately mutable state held outside React: it is a container,
 * not a value, and copying it into state on every write would defeat the point of
 * the adapter seam. Instead `revision` increments on each successful write, and
 * read hooks depend on it — the standard way to subscribe to an external mutable
 * source without leaking its internals into the component tree.
 *
 * Writes are serialised through a promise chain. The `Store` contract says
 * overlapping writes race on "is this row already here?", which would make the
 * new/duplicate split nondeterministic — and money must be deterministic.
 */
export interface SessionStore {
  readonly store: Store;
  /** Bumped on every accepted write. Read hooks key their effects on this. */
  readonly revision: number;
  /** Import metadata for the header and the import list. */
  readonly imports: readonly ImportRecord[];
  /** Every account seen, so the import list can name one without each caller
   *  re-reading the store to turn an `accountId` into a bank and a mask. */
  readonly accounts: readonly Account[];
  readonly record: (statement: ParsedStatement, meta: ImportMeta) => Promise<ImportSummary>;
  /** Set a manual category, or clear it to return the row to automatic classification. */
  readonly categorize: (transactionId: string, category: CategoryId | null) => Promise<void>;
  /** Add or remove retroactive classification rules for this session. */
  readonly addRule: (input: RuleInput) => Promise<Rule>;
  readonly deleteRule: (ruleId: string) => Promise<void>;
  readonly clear: () => Promise<void>;
}

export function useSessionStore(): SessionStore {
  const storeRef = useRef<Store | null>(null);
  storeRef.current ??= createMemoryStore();
  const store = storeRef.current;

  const [revision, setRevision] = useState(0);
  const [imports, setImports] = useState<readonly ImportRecord[]>([]);
  const [accounts, setAccounts] = useState<readonly Account[]>([]);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const ruleSequence = useRef(0);

  const record = useCallback(
    (statement: ParsedStatement, meta: ImportMeta): Promise<ImportSummary> => {
      const next = queue.current.then(async () => {
        const summary = await store.putStatement(statement, meta);
        const [nextImports, nextAccounts] = await Promise.all([
          store.listImports(),
          store.listAccounts(),
        ]);
        setImports(nextImports);
        setAccounts(nextAccounts);
        setRevision((n) => n + 1);
        return summary;
      });
      // Keep the chain alive even if one write rejects, or every later write
      // would be dropped along with it.
      queue.current = next.catch(() => undefined);
      return next;
    },
    [store],
  );

  const clear = useCallback((): Promise<void> => {
    const next = queue.current.then(async () => {
      await store.clear();
      setImports([]);
      setAccounts([]);
      setRevision((n) => n + 1);
    });
    queue.current = next.catch(() => undefined);
    return next;
  }, [store]);

  const categorize = useCallback(
    (transactionId: string, category: CategoryId | null): Promise<void> => {
      const next = queue.current.then(async () => {
        await store.putOverride(transactionId, category);
        setRevision((n) => n + 1);
      });
      queue.current = next.catch(() => undefined);
      return next;
    },
    [store],
  );

  const addRule = useCallback(
    (input: RuleInput): Promise<Rule> => {
      const next = queue.current.then(async () => {
        const rules = await store.listRules();
        let id: string;
        do {
          ruleSequence.current++;
          id = `user:${ruleSequence.current}`;
        } while (rules.some((rule) => rule.id === id));

        const rule = buildUserRule(input, id, nextRuleOrder(rules));
        await store.putRule(rule);
        setRevision((n) => n + 1);
        return rule;
      });
      queue.current = next.catch(() => undefined);
      return next;
    },
    [store],
  );

  const deleteRule = useCallback(
    (ruleId: string): Promise<void> => {
      const next = queue.current.then(async () => {
        await store.deleteRule(ruleId);
        setRevision((n) => n + 1);
      });
      queue.current = next.catch(() => undefined);
      return next;
    },
    [store],
  );

  return {
    store,
    revision,
    imports,
    accounts,
    record,
    categorize,
    addRule,
    deleteRule,
    clear,
  };
}
