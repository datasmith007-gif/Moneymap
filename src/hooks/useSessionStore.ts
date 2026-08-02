import { useCallback, useRef, useState } from 'react';
import type { ParsedStatement } from '../model/canonical.ts';
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
  readonly record: (statement: ParsedStatement, meta: ImportMeta) => Promise<ImportSummary>;
  readonly clear: () => Promise<void>;
}

export function useSessionStore(): SessionStore {
  const storeRef = useRef<Store | null>(null);
  storeRef.current ??= createMemoryStore();
  const store = storeRef.current;

  const [revision, setRevision] = useState(0);
  const [imports, setImports] = useState<readonly ImportRecord[]>([]);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const record = useCallback(
    (statement: ParsedStatement, meta: ImportMeta): Promise<ImportSummary> => {
      const next = queue.current.then(async () => {
        const summary = await store.putStatement(statement, meta);
        setImports(await store.listImports());
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

  const clear = useCallback(async () => {
    await store.clear();
    setImports([]);
    setRevision((n) => n + 1);
  }, [store]);

  return { store, revision, imports, record, clear };
}
