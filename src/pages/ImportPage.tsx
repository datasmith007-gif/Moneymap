import { useEffect, useRef, useState } from 'react';
import { useStatementImport } from '../hooks/useStatementImport.ts';
import { FileDrop } from '../components/FileDrop.tsx';
import { StatementReport } from '../components/StatementReport.tsx';
import { PasswordPrompt } from '../components/PasswordPrompt.tsx';
import { ImportedList } from '../components/ImportedList.tsx';
import type { ParseOutcome } from '../ingestion/outcome.ts';
import type { ParsedStatement } from '../model/canonical.ts';
import type { ImportSummary } from '../storage/store.ts';
import type { SessionStore } from '../hooks/useSessionStore.ts';

/**
 * Import a statement, see exactly what the parser made of it, and — if it
 * reconciled — have it recorded in the session store.
 *
 * This is still the validation surface it was built as: the report renders the
 * parser's output in full rather than a tidied summary, and every non-`parsed`
 * outcome gets its own explanation. What is new is the write policy below.
 */
export function ImportPage({ session }: { readonly session: SessionStore }) {
  const { state, importFile, retryWithPassword, reset } = useStatementImport();
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  /** The outcome object already written, so React's StrictMode double-invoke (and
   *  any re-render) cannot record the same statement twice. Identity comparison
   *  works because the outcome is a stable object held in the hook's state. */
  const recorded = useRef<ParseOutcome | null>(null);

  const outcome = state.status === 'done' ? state.outcome : null;
  const fileName = state.status === 'done' ? state.fileName : '';

  // A `parsed` outcome is parsed *and* reconciled by the facade's contract, so it
  // is recorded without asking. `needs_review` deliberately is not — see below.
  useEffect(() => {
    if (outcome?.kind !== 'parsed' || recorded.current === outcome) return;
    recorded.current = outcome;
    void record(outcome.statement);
  });

  async function record(statement: ParsedStatement) {
    setSummary(
      await session.record(statement, {
        statementId: statement.transactions[0]?.provenance.statementId ?? crypto.randomUUID(),
        fileName,
        importedAt: new Date().toISOString(),
        issues: outcome?.kind === 'needs_review' ? outcome.issues : [],
      }),
    );
  }

  function startOver() {
    recorded.current = null;
    setSummary(null);
    reset();
  }

  return (
    <>
      {state.status !== 'idle' && (
        <div className="page-actions">
          <button type="button" className="link" onClick={startOver}>
            Import another statement
          </button>
        </div>
      )}

      {(state.status === 'idle' || state.status === 'parsing') && (
        <FileDrop onFile={(file) => void importFile(file)} busy={state.status === 'parsing'} />
      )}

      {state.status === 'failed' && (
        <section className="panel verdict verdict-critical">
          <p className="verdict-line">
            <span aria-hidden="true" className="verdict-glyph">
              !
            </span>
            Something went wrong parsing {state.fileName}
          </p>
          <p className="verdict-sub">{state.message}</p>
        </section>
      )}

      {summary !== null && <SummaryLine summary={summary} />}

      {outcome !== null && (
        <Outcome
          outcome={outcome}
          fileName={fileName}
          recorded={summary !== null}
          onPassword={(pw) => void retryWithPassword(pw)}
          onRecord={(statement) => void record(statement)}
        />
      )}

      {/*
        Rendered last but shown in every state, including `idle`. Resetting the
        view to import another statement must not make the ones already imported
        look lost — they are still in the store and still counted, and before
        this panel existed nothing on the screen said so.
      */}
      <ImportedList imports={session.imports} accounts={session.accounts} />
    </>
  );
}

/** What the write actually did — feature §1.3's "show the user what was skipped
 *  as duplicate vs newly imported". */
function SummaryLine({ summary }: { readonly summary: ImportSummary }) {
  if (summary.kind === 'duplicate_statement') {
    return (
      <section className="panel verdict verdict-good">
        <p className="verdict-line">
          <span aria-hidden="true" className="verdict-glyph">
            ✓
          </span>
          Already imported — nothing was added
        </p>
        <p className="verdict-sub">
          This statement matches one imported from {summary.existing.fileName}. Your dashboard
          figures are unchanged.
        </p>
      </section>
    );
  }

  const { transactionsImported, transactionsSkipped } = summary.record;
  return (
    <section className="panel verdict verdict-good">
      <p className="verdict-line">
        <span aria-hidden="true" className="verdict-glyph">
          ✓
        </span>
        Added to your dashboard
      </p>
      <p className="verdict-sub">
        {transactionsImported} new transaction{transactionsImported === 1 ? '' : 's'}
        {transactionsSkipped > 0 &&
          ` · ${transactionsSkipped} skipped as already imported from an overlapping statement`}
      </p>
    </section>
  );
}

interface OutcomeProps {
  readonly outcome: ParseOutcome;
  readonly fileName: string;
  readonly recorded: boolean;
  readonly onPassword: (password: string) => void;
  readonly onRecord: (statement: ParsedStatement) => void;
}

/** One branch per `ParseOutcome` kind — the switch the tagged union exists to
 *  force, so no failure mode reaches the user as a blank screen. */
function Outcome({ outcome, fileName, recorded, onPassword, onRecord }: OutcomeProps) {
  switch (outcome.kind) {
    case 'parsed':
      return <StatementReport statement={outcome.statement} issues={[]} fileName={fileName} />;

    case 'needs_review':
      return (
        <>
          {/*
            A flagged statement is NOT recorded automatically. Its figures failed
            a reconciliation check, and feeding them into the net position would
            break the dashboard's promise in the quietest possible way — a total
            that looks authoritative and is wrong. The user decides, having just
            read the issues.
          */}
          {!recorded && (
            <section className="panel">
              <header className="panel-head">
                <h2>Not added to the dashboard</h2>
              </header>
              <p>
                This statement was flagged during import, so its figures are kept out of your
                totals until you say otherwise.
              </p>
              <button type="button" onClick={() => onRecord(outcome.statement)}>
                Include it anyway
              </button>
            </section>
          )}
          <StatementReport
            statement={outcome.statement}
            issues={outcome.issues}
            fileName={fileName}
          />
        </>
      );

    case 'encrypted':
      return <PasswordPrompt message={outcome.message} onSubmit={onPassword} />;

    case 'unsupported':
      return (
        <section className="panel">
          <header className="panel-head">
            <h2>Format not recognised</h2>
          </header>
          <p>{outcome.message}</p>
          <dl className="facts">
            <div>
              <dt>Bank guess</dt>
              <dd>{outcome.fingerprint.bankGuess ?? 'none'}</dd>
            </div>
            <div>
              <dt>Layout signature</dt>
              <dd className="mono">{outcome.fingerprint.signature}</dd>
            </div>
          </dl>
        </section>
      );

    case 'unreadable':
      return (
        <section className="panel">
          <header className="panel-head">
            <h2>Couldn&rsquo;t read this file</h2>
            <span className="muted mono">{outcome.reason}</span>
          </header>
          <p>{outcome.message}</p>
        </section>
      );
  }
}
