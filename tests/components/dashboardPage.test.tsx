// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const readyDashboard = {
  kind: 'ready' as const,
  window: 6 as const,
  anchorMonth: '2025-08' as const,
  range: { from: '2025-03' as const, to: '2025-08' as const },
  netPosition: {
    total: 0,
    asOf: '2025-08-31',
    newestAsOf: '2025-08-31',
    accounts: [],
    excluded: [],
  },
  flows: [],
  cumulative: [],
  spendByCategory: [],
  savingsRate: null,
  monthsSinceLatestStatement: 0,
  averages: {
    income: { mean: 0, min: 0, max: 0, stdDev: 0, months: 1 },
    spend: { mean: 0, min: 0, max: 0, stdDev: 0, months: 1 },
    savings: { mean: 0, min: 0, max: 0, stdDev: 0, months: 1 },
    monthsCounted: ['2025-08'],
    monthsExcluded: [],
  },
  coverage: {
    classifiedCount: 0,
    unclassifiedCount: 0,
    unclassifiedSpend: 0,
    countRate: 1,
    amountRate: 1,
  },
  caveats: [],
};

vi.mock('../../src/hooks/useDashboard.ts', () => ({
  useDashboard: () => readyDashboard,
  useAccountCoverage: () => [],
  useTransactionRows: () => [],
  useAnomalies: () => [{}],
}));

function marker(name: string) {
  return () => <section data-testid="dashboard-order">{name}</section>;
}

vi.mock('../../src/components/NetPositionPanel.tsx', () => ({
  NetPositionPanel: marker('Net position'),
}));
vi.mock('../../src/components/AveragesPanel.tsx', () => ({
  AveragesPanel: marker('Monthly KPIs'),
}));
vi.mock('../../src/components/MoneyFlowChart.tsx', () => ({
  MoneyFlowChart: marker('Money flow'),
}));
vi.mock('../../src/components/CategoryBreakdownPanel.tsx', () => ({
  CategoryBreakdownPanel: marker('Spending by category'),
}));
vi.mock('../../src/components/SavingsTrendChart.tsx', () => ({
  SavingsTrendChart: marker('Cumulative savings'),
}));
vi.mock('../../src/components/AnomalyPanel.tsx', () => ({
  AnomalyPanel: marker('Unusual spending'),
}));
vi.mock('../../src/components/ReviewCenter.tsx', () => ({ ReviewCenter: marker('Review center') }));
vi.mock('../../src/components/DashboardNotices.tsx', () => ({
  DashboardNotices: () => <span>Data quality: 1 item</span>,
}));

const { DashboardPage } = await import('../../src/pages/DashboardPage.tsx');

afterEach(cleanup);

describe('dashboard hierarchy', () => {
  it('reads as a briefing before the review workbench', () => {
    const session = {
      store: {},
      revision: 0,
      categorize: async () => undefined,
      addRule: async () => {
        throw new Error('unused');
      },
      deleteRule: async () => undefined,
    };
    render(<DashboardPage session={session as never} />);

    expect(screen.getByText('Data quality: 1 item')).toBeTruthy();
    expect(screen.getAllByTestId('dashboard-order').map((node) => node.textContent)).toEqual([
      'Net position',
      'Monthly KPIs',
      'Money flow',
      'Spending by category',
      'Cumulative savings',
      'Unusual spending',
      'Review center',
    ]);
  });
});
