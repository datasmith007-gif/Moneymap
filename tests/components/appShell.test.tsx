// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const shellState = vi.hoisted(() => ({ hasData: false }));

vi.mock('../../src/hooks/useSessionStore.ts', () => ({
  useSessionStore: () => ({
    imports: shellState.hasData ? [{ statementId: 'statement-1' }] : [],
  }),
}));

vi.mock('../../src/pages/ImportPage.tsx', () => ({
  ImportPage: ({
    canOpenDashboard,
    onOpenDashboard,
  }: {
    canOpenDashboard: boolean;
    onOpenDashboard: () => void;
  }) => (
    <section>
      <h2>Import screen</h2>
      <button type="button" disabled={!canOpenDashboard} onClick={onOpenDashboard}>
        To dashboard
      </button>
    </section>
  ),
}));

vi.mock('../../src/pages/DashboardPage.tsx', () => ({
  DashboardPage: () => <section aria-label="Dashboard content">Dashboard content</section>,
}));

const { default: App } = await import('../../src/App.tsx');

beforeEach(() => {
  shellState.hasData = false;
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

afterEach(cleanup);

describe('application shell', () => {
  it('starts on Import, unlocks the dashboard after data exists, and returns without clearing it', () => {
    const { rerender } = render(<App />);

    expect(screen.getByRole('heading', { name: 'Import screen' })).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'To dashboard' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(document.querySelector('.import-backdrop')?.hasAttribute('inert')).toBe(true);
    expect(document.querySelector('.dashboard-placeholder')).toBeTruthy();

    shellState.hasData = true;
    rerender(<App />);
    const dashboardButton = screen.getByRole('button', { name: 'To dashboard' });
    expect((dashboardButton as HTMLButtonElement).disabled).toBe(false);
    expect(document.querySelector('.import-backdrop-ready')).toBeTruthy();

    fireEvent.click(dashboardButton);
    expect(screen.queryByRole('heading', { name: 'Import screen' })).toBeNull();
    expect(screen.getByLabelText('Dashboard content')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Import files' }));
    expect(screen.getByRole('heading', { name: 'Import screen' })).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'To dashboard' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('restores and changes the local light/dark preference', async () => {
    localStorage.setItem('moneymap-theme', 'dark');
    render(<App />);

    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
    fireEvent.click(screen.getByRole('button', { name: 'Light mode' }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'));
    expect(localStorage.getItem('moneymap-theme')).toBe('light');
    expect(screen.getByRole('button', { name: 'Dark mode' })).toBeTruthy();
  });
});
