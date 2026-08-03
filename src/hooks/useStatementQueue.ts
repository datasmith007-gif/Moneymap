import { useCallback, useRef, useState } from 'react';
import { parseStatement } from '../ingestion/parseStatement.ts';
import type { ParseOutcome } from '../ingestion/outcome.ts';
import type { ImportSummary } from '../storage/store.ts';
import type { SessionStore } from './useSessionStore.ts';

/**
 * Importing a batch of statements: files in, recorded imports out.
 *
 * This hook owns the whole lifecycle — read, parse, decide, record — rather than
 * stopping at the parse and letting the page record. That is the difference
 * between one file and many. With a batch, "has this item been written yet?" has
 * to be answered per item on every render, and an effect in the component that
 * gets it wrong double-counts money. Owning the write here makes the guarantee
 * structural: an item is recorded on the single code path that moves it to
 * `done`, and nothing re-renders its way into a second write.
 *
 * Three properties the implementation exists to hold:
 *
 *  - **Writes are serialised.** The `Store` contract says overlapping writes race
 *    on "is this row already here?", making the new/duplicate split
 *    nondeterministic. Files are therefore processed strictly one at a time —
 *    never `Promise.all`. Parsing is sequential for the same reason plus a
 *    second one: it bounds peak memory.
 *  - **Raw bytes are held only as long as they are needed.** Twelve statements
 *    is up to 300 MB of raw financial content, so bytes are dropped the moment
 *    an item reaches a state that cannot need them again. Only a `locked` item
 *    keeps them, because only a password retry re-reads the file. They live in a
 *    ref, never in state, so they cannot reach a devtools snapshot.
 *  - **Partial failure is normal.** If the seventh file fails, the first six are
 *    already recorded and stay recorded. Dedup is content-derived and
 *    order-independent, so re-dropping the whole batch is safe.
 */

export type ItemStatus =
  /** Waiting its turn. */
  | 'queued'
  | 'parsing'
  /** Encrypted, and parked rather than blocking the batch behind a prompt. */
  | 'locked'
  /** Parsed but flagged by the reconciliation gate — awaiting the user. */
  | 'review'
  /** Recorded in the store. */
  | 'done'
  /** Not a statement we can use, and no user action would change that. */
  | 'rejected';

export interface QueueItem {
  readonly id: string;
  readonly fileName: string;
  readonly status: ItemStatus;
  /** The parse result, once there is one. */
  readonly outcome: ParseOutcome | null;
  /** What the store did with it — `imported` or `duplicate_statement`. */
  readonly summary: ImportSummary | null;
  /** Why it was rejected. Never contains file content. */
  readonly message: string | null;
}

export interface StatementQueue {
  readonly items: readonly QueueItem[];
  /** True while any file is being read or parsed. */
  readonly busy: boolean;
  readonly addFiles: (files: readonly File[]) => void;
  /**
   * Try a password against **every** locked file.
   *
   * One field rather than a prompt per file, because Indian bank statements are
   * commonly locked with the same PAN+DOB-derived password across every
   * statement from one bank. Files it does not open simply stay locked, so
   * trying it everywhere costs the user nothing.
   */
  readonly unlockAll: (password: string) => Promise<void>;
  /** Record one flagged statement the user has chosen to trust. */
  readonly include: (id: string) => Promise<void>;
  /** Record every flagged statement at once. */
  readonly includeAll: () => Promise<void>;
  /** Clear the queue. Does not touch what has already been recorded. */
  readonly reset: () => void;
}

export function useStatementQueue(session: SessionStore): StatementQueue {
  const [items, setItems] = useState<readonly QueueItem[]>([]);
  const [busy, setBusy] = useState(false);

  /**
   * The authoritative queue. React state is a mirror of it, published after
   * every mutation — the drain loop is async, so reading item status out of
   * state inside it would read a snapshot that has already moved on.
   */
  const itemsRef = useRef<QueueItem[]>([]);
  const bytesRef = useRef(new Map<string, Uint8Array>());
  /** Chains drains rather than guarding them with a boolean. A boolean guard
   *  makes a second call return immediately, which strands any item added in
   *  the instant the first drain was finishing; chaining makes the second call
   *  wait and then find whatever is left. Same pattern as `useSessionStore`. */
  const drainRef = useRef<Promise<void>>(Promise.resolve());
  /** How many operations are in flight. A boolean would be set false by the
   *  first one to finish while a second was still working. */
  const activeRef = useRef(0);

  const publish = useCallback(() => {
    setItems([...itemsRef.current]);
  }, []);

  /** Bracket an operation so `busy` is true for exactly as long as work is
   *  happening — including the file-reading that precedes the first parse. */
  const begin = useCallback(() => {
    activeRef.current++;
    setBusy(true);
  }, []);

  const end = useCallback(() => {
    activeRef.current--;
    if (activeRef.current === 0) setBusy(false);
  }, []);

  const update = useCallback(
    (id: string, patch: Partial<QueueItem>) => {
      const index = itemsRef.current.findIndex((item) => item.id === id);
      if (index === -1) return;
      itemsRef.current[index] = { ...itemsRef.current[index]!, ...patch };
      publish();
    },
    [publish],
  );

  /** Write a parsed statement and move the item to `done`. The one path to a
   *  recorded import — every caller funnels through here. */
  const record = useCallback(
    async (item: QueueItem, outcome: Extract<ParseOutcome, { kind: 'parsed' | 'needs_review' }>) => {
      const summary = await session.record(outcome.statement, {
        statementId: item.id,
        fileName: item.fileName,
        importedAt: new Date().toISOString(),
        issues: outcome.kind === 'needs_review' ? outcome.issues : [],
      });
      bytesRef.current.delete(item.id);
      update(item.id, { status: 'done', summary });
    },
    [session, update],
  );

  /** Route one parse result to its resting state. */
  const settle = useCallback(
    async (item: QueueItem, outcome: ParseOutcome) => {
      update(item.id, { outcome });

      switch (outcome.kind) {
        case 'parsed':
          // Parsed means parsed *and* reconciled, by the facade's contract.
          await record({ ...item, outcome }, outcome);
          return;

        case 'needs_review':
          // Deliberately not recorded. Its figures failed a reconciliation
          // check, and feeding them into the net position would break the
          // dashboard's promise in the quietest possible way. The statement is
          // already parsed, so the bytes are no longer needed either way.
          bytesRef.current.delete(item.id);
          update(item.id, { status: 'review' });
          return;

        case 'encrypted':
          update(item.id, { status: 'locked', message: outcome.message });
          return;

        case 'unsupported':
          bytesRef.current.delete(item.id);
          update(item.id, { status: 'rejected', message: outcome.message });
          return;

        case 'unreadable':
          bytesRef.current.delete(item.id);
          update(item.id, { status: 'rejected', message: outcome.message });
          return;
      }
    },
    [record, update],
  );

  /**
   * Process queued items one at a time until none are left.
   *
   * Re-entrant by design: `addFiles` can be called while a drain is running, and
   * the new items are picked up by the loop already in flight rather than
   * starting a second one that would race it.
   */
  const drain = useCallback(() => {
    const next = drainRef.current.then(async () => {
      for (;;) {
        const item = itemsRef.current.find((candidate) => candidate.status === 'queued');
        if (item === undefined) return;

        update(item.id, { status: 'parsing' });
        const bytes = bytesRef.current.get(item.id);
        if (bytes === undefined) {
          update(item.id, { status: 'rejected', message: 'The file could not be read.' });
          continue;
        }

        try {
          const outcome = await parseStatement(bytes, {
            statementId: item.id,
            importedAt: new Date().toISOString(),
          });
          await settle(item, outcome);
        } catch (err) {
          // Only unexpected faults land here — the parser returns its expected
          // failures as values. Surface the message, never the file's contents.
          bytesRef.current.delete(item.id);
          update(item.id, {
            status: 'rejected',
            message: err instanceof Error ? err.message : 'Unknown error while parsing.',
          });
        }
      }
    });
    // Keep the chain alive even if one drain rejects, or every later one would
    // be dropped along with it.
    drainRef.current = next.catch(() => undefined);
    return next;
  }, [settle, update]);

  const addFiles = useCallback(
    (files: readonly File[]) => {
      if (files.length === 0) return;
      // Synchronously, before any await: otherwise `busy` stays false for the
      // whole file-reading window and the dropzone re-enables mid-batch.
      begin();
      void (async () => {
        for (const file of files) {
          const id = crypto.randomUUID();
          try {
            bytesRef.current.set(id, new Uint8Array(await file.arrayBuffer()));
            itemsRef.current.push({
              id,
              fileName: file.name,
              status: 'queued',
              outcome: null,
              summary: null,
              message: null,
            });
          } catch {
            itemsRef.current.push({
              id,
              fileName: file.name,
              status: 'rejected',
              outcome: null,
              summary: null,
              message: 'The file could not be read from disk.',
            });
          }
        }
        publish();
        try {
          await drain();
        } finally {
          end();
        }
      })();
    },
    [begin, drain, end, publish],
  );

  const unlockAll = useCallback(
    async (password: string) => {
      const locked = itemsRef.current.filter((item) => item.status === 'locked');
      if (locked.length === 0) return;

      begin();
      try {
        // Sequential, like the main drain, and for the same two reasons.
        for (const item of locked) {
          const bytes = bytesRef.current.get(item.id);
          if (bytes === undefined) continue;
          try {
            const outcome = await parseStatement(bytes, {
              statementId: item.id,
              importedAt: new Date().toISOString(),
              password,
            });
            // Still encrypted means this password was not the one for this file;
            // leave it locked and untouched so another can be tried.
            if (outcome.kind === 'encrypted') continue;
            await settle(item, outcome);
          } catch (err) {
            bytesRef.current.delete(item.id);
            update(item.id, {
              status: 'rejected',
              message: err instanceof Error ? err.message : 'Unknown error while parsing.',
            });
          }
        }
      } finally {
        end();
      }
    },
    [begin, end, settle, update],
  );

  const include = useCallback(
    async (id: string) => {
      const item = itemsRef.current.find((candidate) => candidate.id === id);
      if (item?.status !== 'review' || item.outcome?.kind !== 'needs_review') return;
      await record(item, item.outcome);
    },
    [record],
  );

  const includeAll = useCallback(async () => {
    // Snapshot first: `record` mutates the list as it goes.
    const flagged = itemsRef.current.filter((item) => item.status === 'review').map((item) => item.id);
    for (const id of flagged) await include(id);
  }, [include]);

  const reset = useCallback(() => {
    itemsRef.current = [];
    bytesRef.current.clear();
    publish();
  }, [publish]);

  return { items, busy, addFiles, unlockAll, include, includeAll, reset };
}
