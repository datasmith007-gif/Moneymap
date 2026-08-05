import { useState } from 'react';
import type { QueueItem, StatementQueue } from '../hooks/useStatementQueue.ts';

/**
 * The batch: what happened to every file in this drop.
 *
 * The single-file screen could afford to be a full report, because there was
 * only ever one thing to say. A batch needs the opposite shape — one line per
 * file, and the two things that need a decision pulled out above the list where
 * they cannot be missed. The detailed report still exists; it moves below, for
 * whichever statement the user selects.
 *
 * Only two states ever require the user: a locked file needs a password, and a
 * flagged one needs a judgement. Everything else has already resolved itself,
 * so the list is a record rather than a worklist.
 */
export function ImportQueue({
  queue,
  selectedId,
  onSelect,
}: {
  readonly queue: StatementQueue;
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
}) {
  const { items } = queue;
  if (items.length === 0) return null;

  const locked = items.filter((item) => item.status === 'locked');
  const flagged = items.filter((item) => item.status === 'review');

  return (
    <>
      {locked.length > 0 && <UnlockPanel count={locked.length} onUnlock={queue.unlockAll} />}
      {flagged.length > 0 && <ReviewPanel items={flagged} queue={queue} />}

      <section className="panel">
        <header className="panel-head">
          <h2>This import</h2>
          <span className="muted">{summarise(items)}</span>
        </header>

        <div className="table-scroll">
          <table className="txns">
            <thead>
              <tr>
                <th>File</th>
                <th>Status</th>
                <th className="num">Rows</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className={item.id === selectedId ? 'row-selected' : undefined}>
                  <td className="narration">{item.fileName}</td>
                  <td className="nowrap">
                    <StatusCell item={item} />
                  </td>
                  <td className="num nowrap">{rowCount(item)}</td>
                  <td className="num nowrap">
                    {item.outcome !== null &&
                      (item.outcome.kind === 'parsed' || item.outcome.kind === 'needs_review') && (
                        <button type="button" className="link" onClick={() => onSelect(item.id)}>
                          {item.id === selectedId ? 'Hide' : 'Show'} detail
                        </button>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

/**
 * One password field for the whole batch.
 *
 * A prompt per file would block the queue on the first locked statement and ask
 * the same question repeatedly. Statements from one bank usually share a
 * password, so trying it against every locked file is both fewer keystrokes and
 * the more likely-correct guess. Files it does not open stay locked.
 */
function UnlockPanel({
  count,
  onUnlock,
}: {
  readonly count: number;
  readonly onUnlock: (password: string) => Promise<void>;
}) {
  const [password, setPassword] = useState('');
  const [tried, setTried] = useState(false);

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>
          {count} file{count === 1 ? ' is' : 's are'} password-protected
        </h2>
      </header>
      <p>
        Everything else has been imported already — these were set aside rather than holding up the
        batch. Statements from the same bank usually share a password, so we&rsquo;ll try this
        against all {count} of them.
      </p>
      <form
        className="password-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (password === '') return;
          setTried(true);
          void onUnlock(password).then(() => setPassword(''));
        }}
      >
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Statement password"
          aria-label="Statement password"
          autoComplete="off"
        />
        <button type="submit" disabled={password === ''}>
          Unlock
        </button>
      </form>
      {tried && (
        <p className="muted">
          Any file still listed as locked needs a different password. The password is used to open
          the file and is never stored.
        </p>
      )}
    </section>
  );
}

/** The flagged statements, and the decision they need. */
function ReviewPanel({
  items,
  queue,
}: {
  readonly items: readonly QueueItem[];
  readonly queue: StatementQueue;
}) {
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>
          {items.length} statement{items.length === 1 ? '' : 's'} flagged during import
        </h2>
      </header>
      <p>
        {/*
          The same policy as the single-file screen, restated for a batch: a
          flagged statement's figures failed a reconciliation check, so they stay
          out of the totals until the user says otherwise.
        */}
        These didn&rsquo;t fully reconcile, so their figures are kept out of your totals until you
        say otherwise. Open the detail on any of them to see exactly what was flagged.
      </p>
      <div className="page-actions">
        {items.length > 1 && (
          <button type="button" onClick={() => void queue.includeAll()}>
            Include all {items.length}
          </button>
        )}
        {items.map((item) => (
          <button key={item.id} type="button" onClick={() => void queue.include(item.id)}>
            Include {item.fileName}
          </button>
        ))}
      </div>
    </section>
  );
}

function StatusCell({ item }: { readonly item: QueueItem }) {
  switch (item.status) {
    case 'queued':
      return (
        <span className="status status-note">
          <span aria-hidden="true">…</span> Waiting
        </span>
      );
    case 'parsing':
      return (
        <span className="status status-note">
          <span aria-hidden="true">…</span> Reading…
        </span>
      );
    case 'locked':
      return (
        <span className="status status-note">
          <span aria-hidden="true">●</span> Locked
        </span>
      );
    case 'review':
      return (
        <span className="status status-critical">
          <span aria-hidden="true">!</span> Needs review
        </span>
      );
    case 'rejected':
      return (
        <span className="status status-critical" title={item.message ?? undefined}>
          <span aria-hidden="true">!</span> Not imported
        </span>
      );
    case 'done':
      return item.summary?.kind === 'duplicate_statement' ? (
        <span className="status status-note">
          <span aria-hidden="true">↺</span> Already imported
        </span>
      ) : (
        <span className="status status-good">
          <span aria-hidden="true">✓</span> Added
        </span>
      );
  }
}

function rowCount(item: QueueItem): string {
  if (item.summary?.kind === 'imported') {
    const { transactionsImported, transactionsSkipped } = item.summary.record;
    return transactionsSkipped > 0
      ? `${transactionsImported} +${transactionsSkipped} dup`
      : String(transactionsImported);
  }
  if (item.outcome?.kind === 'needs_review')
    return String(item.outcome.statement.transactions.length);
  return '—';
}

/**
 * The batch in one line.
 *
 * Counts every file exactly once, so the parts always add up to the total — a
 * summary whose numbers do not reconcile with the list beneath it is worse than
 * no summary.
 */
function summarise(items: readonly QueueItem[]): string {
  const counts = { added: 0, duplicate: 0, review: 0, locked: 0, rejected: 0, working: 0 };
  for (const item of items) {
    if (item.status === 'done') {
      if (item.summary?.kind === 'duplicate_statement') counts.duplicate++;
      else counts.added++;
    } else if (item.status === 'review') counts.review++;
    else if (item.status === 'locked') counts.locked++;
    else if (item.status === 'rejected') counts.rejected++;
    else counts.working++;
  }

  const parts = [`${items.length} file${items.length === 1 ? '' : 's'}`];
  if (counts.added > 0) parts.push(`${counts.added} added`);
  if (counts.duplicate > 0) parts.push(`${counts.duplicate} already imported`);
  if (counts.review > 0) parts.push(`${counts.review} need review`);
  if (counts.locked > 0) parts.push(`${counts.locked} locked`);
  if (counts.rejected > 0) parts.push(`${counts.rejected} not imported`);
  if (counts.working > 0) parts.push(`${counts.working} in progress`);
  return parts.join(' · ');
}
