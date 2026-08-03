import { useState } from 'react';
import { useStatementQueue } from '../hooks/useStatementQueue.ts';
import { FileDrop } from '../components/FileDrop.tsx';
import { StatementReport } from '../components/StatementReport.tsx';
import { ImportQueue } from '../components/ImportQueue.tsx';
import { ImportedList } from '../components/ImportedList.tsx';
import type { SessionStore } from '../hooks/useSessionStore.ts';

/**
 * Import statements, see exactly what the parser made of each, and have the ones
 * that reconciled recorded in the session store.
 *
 * The screen has three layers now, coarsest first, because a batch changes what
 * the user is looking for:
 *
 *  1. **What needs me?** — locked and flagged files, surfaced above the list.
 *  2. **What happened to each file?** — one row per file in this drop.
 *  3. **Is this statement right?** — the full parser report, for one selected
 *     statement at a time. This is the original validation surface, unchanged,
 *     but no longer the whole page.
 *
 * Below all of it sits everything imported this session, which survives a reset
 * so that starting another import never looks like losing the last one.
 */
export function ImportPage({ session }: { readonly session: SessionStore }) {
  const queue = useStatementQueue(session);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = queue.items.find((item) => item.id === selectedId) ?? null;
  const detail =
    selected?.outcome?.kind === 'parsed' || selected?.outcome?.kind === 'needs_review'
      ? selected.outcome
      : null;

  // Every file resolved and none of them needs anything: the batch is finished,
  // so offer the empty dropzone again rather than making the user hunt for it.
  const settled =
    queue.items.length > 0 &&
    !queue.busy &&
    queue.items.every((item) => item.status === 'done' || item.status === 'rejected');

  return (
    <>
      {queue.items.length > 0 && (
        <div className="page-actions">
          <button
            type="button"
            className="link"
            onClick={() => {
              setSelectedId(null);
              queue.reset();
            }}
          >
            Import more statements
          </button>
        </div>
      )}

      {(queue.items.length === 0 || settled) && (
        <FileDrop onFiles={queue.addFiles} busy={queue.busy} />
      )}

      <ImportQueue
        queue={queue}
        selectedId={selectedId}
        onSelect={(id) => setSelectedId(id === selectedId ? null : id)}
      />

      {selected !== null && detail !== null && (
        <StatementReport
          statement={detail.statement}
          issues={detail.kind === 'needs_review' ? detail.issues : []}
          fileName={selected.fileName}
        />
      )}

      {/*
        Shown in every state, including before the first import. Resetting the
        view must not make the statements already recorded look lost — they are
        still in the store and still counted, and nothing else on screen says so.
      */}
      <ImportedList imports={session.imports} accounts={session.accounts} />
    </>
  );
}
