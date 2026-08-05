// @vitest-environment jsdom

import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DashboardNotices } from '../../src/components/DashboardNotices.tsx';
import { AccountCoveragePanel } from '../../src/components/AccountCoveragePanel.tsx';
import { CategorizationReviewPanel } from '../../src/components/CategorizationReviewPanel.tsx';
import { Modal } from '../../src/components/Modal.tsx';
import type { Caveat, Dashboard } from '../../src/engine/aggregate.ts';

afterEach(cleanup);

/** A ready dashboard with nothing to warn about; each test adds only its own. */
function dashboardWith(patch: Partial<Dashboard>): Dashboard {
  const flat = { mean: 0, min: 0, max: 0, stdDev: 0, months: 1 };
  return {
    kind: 'ready',
    window: 6,
    anchorMonth: '2025-08',
    range: { from: '2025-03', to: '2025-08' },
    netPosition: {
      total: 10_000_00,
      asOf: '2025-08-31',
      newestAsOf: '2025-08-31',
      accounts: [],
      excluded: [],
    },
    flows: [],
    cumulative: [],
    averages: {
      income: flat,
      spend: flat,
      savings: flat,
      monthsCounted: ['2025-08'],
      monthsExcluded: [],
    },
    spendByCategory: [],
    coverage: {
      classifiedCount: 0,
      unclassifiedCount: 0,
      unclassifiedSpend: 0,
      countRate: 1,
      amountRate: 1,
    },
    savingsRate: null,
    monthsSinceLatestStatement: 0,
    caveats: [],
    ...patch,
  };
}

const flagged: Caveat = {
  id: 'flagged_statements',
  text: 'Some figures come from statements that were flagged for review during import.',
  severity: 'warning',
  affects: ['income', 'spend', 'savings', 'net_position'],
};

const singleMonth: Caveat = {
  id: 'single_month',
  text: 'Only one full month of data — there is no variation to show yet.',
  severity: 'note',
  affects: ['income', 'spend', 'savings'],
};

describe('dashboard notices', () => {
  it('renders nothing when there is nothing to qualify', () => {
    const { container } = render(<DashboardNotices dashboard={dashboardWith({})} />);
    expect(container.textContent).toBe('');
  });

  it('keeps every caveat closed until the indicator is hovered', () => {
    render(<DashboardNotices dashboard={dashboardWith({ caveats: [flagged, singleMonth] })} />);

    expect(screen.queryByText(/flagged for review/)).toBeNull();
    expect(screen.queryByText(/no variation to show/)).toBeNull();

    const trigger = screen.getByRole('button', { name: /2 things to know/ });
    expect(trigger.textContent).toContain('Data quality');
    expect(trigger.textContent).toContain('2');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    fireEvent.mouseEnter(trigger.parentElement as HTMLElement);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText(/flagged for review/)).toBeTruthy();
    expect(screen.getByText(/no variation to show/)).toBeTruthy();

    fireEvent.mouseLeave(trigger.parentElement as HTMLElement);
    expect(screen.queryByText(/flagged for review/)).toBeNull();
  });

  it('opens on keyboard focus and closes on Escape', () => {
    render(<DashboardNotices dashboard={dashboardWith({ caveats: [singleMonth] })} />);
    const trigger = screen.getByRole('button', { name: /1 thing to know/ });

    fireEvent.focus(trigger);
    expect(screen.getByText(/no variation to show/)).toBeTruthy();

    fireEvent.keyDown(trigger, { key: 'Escape' });
    fireEvent.blur(trigger);
    expect(screen.queryByText(/no variation to show/)).toBeNull();
  });

  it('collects staleness, excluded months, and non-rupee accounts alongside engine caveats', () => {
    render(
      <DashboardNotices
        dashboard={dashboardWith({
          monthsSinceLatestStatement: 2,
          caveats: [singleMonth],
          averages: {
            ...dashboardWith({}).averages,
            monthsExcluded: [{ month: '2025-07', reason: 'partial_coverage' }],
          },
          netPosition: {
            ...dashboardWith({}).netPosition,
            excluded: [{ accountId: 'usd-1', reason: 'currency' }],
          },
        })}
      />,
    );

    const trigger = screen.getByRole('button', { name: /4 things to know/ });
    fireEvent.mouseEnter(trigger.parentElement as HTMLElement);

    expect(screen.getByText(/2 months ago/)).toBeTruthy();
    expect(screen.getByText(/Jul 2025 \(partly covered\)/)).toBeTruthy();
    expect(screen.getByText(/1 account is not in rupees/)).toBeTruthy();
    expect(screen.getByText(/no variation to show/)).toBeTruthy();
  });

  it('leads with the warning tone when any notice is a warning', () => {
    const { rerender } = render(
      <DashboardNotices dashboard={dashboardWith({ caveats: [singleMonth] })} />,
    );
    expect(document.querySelector('.infotip-warning')).toBeNull();

    rerender(<DashboardNotices dashboard={dashboardWith({ caveats: [singleMonth, flagged] })} />);
    expect(document.querySelector('.infotip-warning')).toBeTruthy();

    // Warnings sort above notes so the list never opens with the mildest item.
    const items = [...document.querySelectorAll('.notice')];
    expect(items).toHaveLength(0);
    fireEvent.mouseEnter(screen.getByRole('button', { name: /2 things/ }).parentElement!);
    expect(document.querySelector('.notice')?.classList.contains('notice-warning')).toBe(true);
  });
});

describe('statement coverage dialog', () => {
  const accounts = [
    {
      accountId: 'axis',
      institution: 'Axis Bank',
      identifierMasked: 'XXXX1111',
      coverageStart: '2025-07-01',
      coverageEnd: '2025-08-31',
      gaps: [{ from: '2025-07-11', to: '2025-07-19' }],
    },
  ];

  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Statement coverage
        </button>
        {open && (
          <Modal label="Statement coverage" onClose={() => setOpen(false)}>
            <AccountCoveragePanel accounts={accounts} />
          </Modal>
        )}
      </>
    );
  }

  it('stays closed until asked for, then closes on Escape', () => {
    render(<Harness />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText(/11 Jul 2025/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Statement coverage' }));
    const dialog = screen.getByRole('dialog', { name: 'Statement coverage' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByText(/11 Jul 2025/)).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on the backdrop but not on a click inside the dialog', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Statement coverage' }));

    fireEvent.click(screen.getByRole('dialog'));
    expect(screen.getByRole('dialog')).toBeTruthy();

    fireEvent.click(document.querySelector('.modal-backdrop') as HTMLElement);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('categorization review guidance', () => {
  it('hides the label-grouping explanation behind a hover tip', () => {
    render(<CategorizationReviewPanel rows={[]} onCategorize={async () => undefined} />);

    expect(screen.queryByText(/Labels combine/)).toBeNull();

    const trigger = screen.getByRole('button', { name: 'How label grouping works' });
    fireEvent.mouseEnter(trigger.parentElement as HTMLElement);
    expect(screen.getByText(/Labels combine/)).toBeTruthy();
  });
});
