import { useState } from 'react';
import { useStatementImport } from './hooks/useStatementImport.ts';
import { FileDrop } from './components/FileDrop.tsx';
import { StatementReport } from './components/StatementReport.tsx';
import type { ParseOutcome } from './ingestion/outcome.ts';

/**
 * The import screen: pick a statement, see exactly what the parser made of it.
 *
 * This is a validation surface first and a product screen second — its job is to
 * make a wrong figure visible, so it renders the parser's output in full rather
 * than a tidied summary, and gives every non-`parsed` outcome its own explanation
 * instead of collapsing them into "couldn't read that".
 */
export default function App() {
  const { state, importFile, retryWithPassword, reset } = useStatementImport();

  return (
    <main className="app">
      <header className="app-head">
        <h1>MoneyMap</h1>
        <p className="tagline">Statement import — on-device parsing check</p>
        {state.status !== 'idle' && (
          <button type="button" className="link" onClick={reset}>
            Start over
          </button>
        )}
      </header>

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

      {state.status === 'done' && (
        <Outcome
          outcome={state.outcome}
          fileName={state.fileName}
          onPassword={(pw) => void retryWithPassword(pw)}
        />
      )}
    </main>
  );
}

interface OutcomeProps {
  readonly outcome: ParseOutcome;
  readonly fileName: string;
  readonly onPassword: (password: string) => void;
}

/** One branch per `ParseOutcome` kind — the switch the tagged union exists to
 *  force, so no failure mode reaches the user as a blank screen. */
function Outcome({ outcome, fileName, onPassword }: OutcomeProps) {
  switch (outcome.kind) {
    case 'parsed':
      return <StatementReport statement={outcome.statement} issues={[]} fileName={fileName} />;

    case 'needs_review':
      return (
        <StatementReport
          statement={outcome.statement}
          issues={outcome.issues}
          fileName={fileName}
        />
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

function PasswordPrompt({
  message,
  onSubmit,
}: {
  readonly message: string;
  readonly onSubmit: (password: string) => void;
}) {
  const [password, setPassword] = useState('');

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Password needed</h2>
      </header>
      <p>{message}</p>
      <form
        className="password-form"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(password);
          setPassword(''); // used for this parse only; never retained or stored
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
          Unlock and parse
        </button>
      </form>
      <p className="drop-note">
        Used in memory to decrypt this file only. Never stored, never logged, never sent anywhere.
      </p>
    </section>
  );
}
