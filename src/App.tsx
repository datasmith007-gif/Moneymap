import { useState } from 'react';
import { useSessionStore } from './hooks/useSessionStore.ts';
import { ImportPage } from './pages/ImportPage.tsx';
import { DashboardPage } from './pages/DashboardPage.tsx';

type View = 'import' | 'dashboard';

/**
 * The shell: owns the session store and which view is showing.
 *
 * Two views rather than one screen, because they answer different questions.
 * Import is a validation surface — "did the parser read this file correctly?" —
 * and stays as detailed as it was. The dashboard answers "how am I doing across
 * everything I've imported?" Merging them would make both worse.
 */
export default function App() {
  const session = useSessionStore();
  const [view, setView] = useState<View>('import');
  const hasData = session.imports.length > 0;

  return (
    <main className="app">
      <header className="app-head">
        <h1>MoneyMap</h1>
        <nav className="tabs">
          <button
            type="button"
            className={view === 'import' ? 'tab tab-active' : 'tab'}
            aria-current={view === 'import' ? 'page' : undefined}
            onClick={() => setView('import')}
          >
            Import
          </button>
          <button
            type="button"
            className={view === 'dashboard' ? 'tab tab-active' : 'tab'}
            aria-current={view === 'dashboard' ? 'page' : undefined}
            disabled={!hasData}
            title={hasData ? undefined : 'Import a statement first'}
            onClick={() => setView('dashboard')}
          >
            Dashboard
            {hasData && <span className="tab-count">{session.imports.length}</span>}
          </button>
        </nav>
      </header>

      {view === 'import' ? (
        <ImportPage session={session} />
      ) : (
        <DashboardPage session={session} />
      )}
    </main>
  );
}
