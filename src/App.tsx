import { useEffect, useState } from 'react';
import { useSessionStore } from './hooks/useSessionStore.ts';
import { ImportPage } from './pages/ImportPage.tsx';
import { DashboardPage } from './pages/DashboardPage.tsx';

type View = 'import' | 'dashboard';
type Theme = 'light' | 'dark';

const THEME_KEY = 'moneymap-theme';

/**
 * The shell owns the session, explicit view transitions, and the non-financial
 * display preference.
 *
 * Two views rather than one screen, because they answer different questions.
 * Import is a validation surface — "did the parser read this file correctly?" —
 * and stays as detailed as it was. The dashboard answers "how am I doing across
 * everything I've imported?" Merging them would make both worse.
 */
export default function App() {
  const session = useSessionStore();
  const [view, setView] = useState<View>('import');
  const [theme, setTheme] = useState<Theme>(readInitialTheme);
  const hasData = session.imports.length > 0;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // A blocked storage API should not make the theme control unusable.
    }
  }, [theme]);

  return (
    <main className={`app app-${view}`}>
      <header className={`app-head app-head-${view}`}>
        <h1>MoneyMap</h1>
        <div className="app-actions">
          {view === 'dashboard' && (
            <button
              type="button"
              className="header-action button-secondary"
              onClick={() => setView('import')}
            >
              Import files
            </button>
          )}
          <button
            type="button"
            className="header-action button-secondary theme-action"
            aria-pressed={theme === 'dark'}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
        </div>
      </header>

      {view === 'import' ? (
        <div className="import-stage">
          <div className={`import-backdrop ${hasData ? 'import-backdrop-ready' : ''}`} inert>
            {hasData ? <DashboardPage session={session} /> : <DashboardPlaceholder />}
          </div>
          <div className="import-surface">
            <ImportPage
              session={session}
              canOpenDashboard={hasData}
              onOpenDashboard={() => setView('dashboard')}
            />
          </div>
        </div>
      ) : (
        <DashboardPage session={session} />
      )}
    </main>
  );
}

/** Structure only: the first visit must not invent financial figures. */
function DashboardPlaceholder() {
  return (
    <div className="dashboard-placeholder" aria-hidden="true">
      <div className="placeholder-actions" />
      <div className="placeholder-hero" />
      <div className="placeholder-grid">
        <div />
        <div />
        <div />
      </div>
      <div className="placeholder-panel" />
      <div className="placeholder-panel placeholder-panel-tall" />
    </div>
  );
}

function readInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // Fall through to the system preference when local storage is unavailable.
  }
  return typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}
