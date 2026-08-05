// @vitest-environment jsdom

import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AveragesPanel } from '../../src/components/AveragesPanel.tsx';
import { CategoryBreakdownPanel } from '../../src/components/CategoryBreakdownPanel.tsx';
import { AccountCoveragePanel } from '../../src/components/AccountCoveragePanel.tsx';
import { NetPositionPanel } from '../../src/components/NetPositionPanel.tsx';
import type { Averages, ClassificationCoverage, NetPosition } from '../../src/engine/aggregate.ts';
import type { CategoryId } from '../../src/enrichment/taxonomy.ts';
import type { TransactionRegisterRow } from '../../src/engine/transactions.ts';
import { txn } from '../fixtures/canonical.ts';

afterEach(cleanup);

describe('dashboard aggregation visibility', () => {
  it('shows the mean and savings rate only — dispersion is not part of this panel', () => {
    const averages: Averages = {
      income: { mean: 10_000_00, min: 8_000_00, max: 12_000_00, stdDev: 1_000_00, months: 3 },
      spend: { mean: 7_500_00, min: 6_000_00, max: 9_000_00, stdDev: 800_00, months: 3 },
      savings: { mean: 2_500_00, min: 1_000_00, max: 4_000_00, stdDev: 500_00, months: 3 },
      monthsCounted: ['2025-06', '2025-07', '2025-08'],
      monthsExcluded: [{ month: '2025-05', reason: 'partial_coverage' }],
    };

    render(<AveragesPanel averages={averages} savingsRate={0.25} />);

    expect(screen.getByText('Savings rate')).toBeTruthy();
    expect(screen.getByText('25%')).toBeTruthy();
    expect(screen.getByText('10,000.00')).toBeTruthy();
    expect(screen.getByText('7,500.00')).toBeTruthy();
    expect(screen.getByText('2,500.00')).toBeTruthy();

    expect(screen.queryByText(/Standard deviation/)).toBeNull();
    expect(screen.queryByText(/Range /)).toBeNull();
    // Exclusions are reported once, by DashboardNotices — not per panel.
    expect(screen.queryByText(/Left out/)).toBeNull();
  });

  it('shows category amount, share, classification rate, and unexplained spend', () => {
    const coverage: ClassificationCoverage = {
      classifiedCount: 2,
      unclassifiedCount: 1,
      unclassifiedSpend: 2_000_00,
      countRate: 2 / 3,
      amountRate: 0.8,
    };

    render(
      <CategoryBreakdownPanel
        categories={[
          {
            category: 'food_dining',
            label: 'Food & dining',
            total: 6_000_00,
            txnCount: 2,
            share: 0.6,
          },
        ]}
        coverage={coverage}
        selectedCategory={null}
        rows={null}
        onSelectCategory={() => undefined}
        onCategorize={async () => undefined}
      />,
    );

    expect(screen.getByText('66.6%')).toBeTruthy();
    expect(screen.getByText('2 of 3 transactions')).toBeTruthy();
    expect(screen.getByText('Categorised amount')).toBeTruthy();
    expect(screen.getByText('80%')).toBeTruthy();
    expect(screen.getByText('2,000.00')).toBeTruthy();
    expect(screen.getByText('Food & dining')).toBeTruthy();
    expect(screen.getByText('6,000.00')).toBeTruthy();
    expect(screen.getByText('60%')).toBeTruthy();
  });

  it('never rounds incomplete transaction coverage up to 100%', () => {
    render(
      <CategoryBreakdownPanel
        categories={[]}
        coverage={{
          classifiedCount: 999,
          unclassifiedCount: 1,
          unclassifiedSpend: 1,
          countRate: 0.999,
          amountRate: 0.99999,
        }}
        selectedCategory={null}
        rows={null}
        onSelectCategory={() => undefined}
        onCategorize={async () => undefined}
      />,
    );

    expect(screen.getAllByText('99.9%')).toHaveLength(2);
    expect(screen.queryByText('100%')).toBeNull();
    expect(screen.getByText('999 of 1000 transactions')).toBeTruthy();
  });

  it('opens one category transaction list at a time and toggles it closed', () => {
    function Harness() {
      const [selected, setSelected] = useState<CategoryId | null>(null);
      const rows: readonly TransactionRegisterRow[] | null =
        selected === null
          ? null
          : [
              {
                transaction: txn({
                  id: `row-${selected}`,
                  date: '2025-08-10',
                  type: 'debit',
                  amount: 500_00,
                  description: selected === 'food_dining' ? 'UPI SWIGGY' : 'UPI BIGBASKET',
                }),
                account: { institution: 'Test Bank', identifierMasked: 'XXXX0000' },
                classification: {
                  transactionId: `row-${selected}`,
                  category: selected,
                  confidence: 0.85,
                  source: 'shipped_rule',
                  ruleId: `shipped:${selected}`,
                  counterparty: selected === 'food_dining' ? 'SWIGGY' : 'BIGBASKET',
                  isInternalTransfer: false,
                  transferPeerId: null,
                },
              },
            ];

      return (
        <CategoryBreakdownPanel
          categories={[
            {
              category: 'food_dining',
              label: 'Food & dining',
              total: 500_00,
              txnCount: 1,
              share: 0.5,
            },
            {
              category: 'groceries',
              label: 'Groceries',
              total: 500_00,
              txnCount: 1,
              share: 0.5,
            },
          ]}
          coverage={{
            classifiedCount: 2,
            unclassifiedCount: 0,
            unclassifiedSpend: 0,
            countRate: 1,
            amountRate: 1,
          }}
          selectedCategory={selected}
          rows={rows}
          onSelectCategory={(category) => setSelected(category === selected ? null : category)}
          onCategorize={async () => undefined}
        />
      );
    }

    render(<Harness />);
    const foodButton = screen.getByRole('button', { name: /Food & dining/ });
    fireEvent.click(foodButton);
    expect(screen.getByRole('heading', { name: 'Food & dining transactions' })).toBeTruthy();
    expect(screen.getByText('SWIGGY')).toBeTruthy();
    expect(
      foodButton.closest('tr')?.nextElementSibling?.classList.contains('category-inline-row'),
    ).toBe(true);

    const groceriesButton = screen.getByRole('button', { name: /Groceries/ });
    fireEvent.click(groceriesButton);
    expect(screen.queryByRole('heading', { name: 'Food & dining transactions' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Groceries transactions' })).toBeTruthy();
    expect(screen.getByText('BIGBASKET')).toBeTruthy();
    expect(
      groceriesButton.closest('tr')?.nextElementSibling?.classList.contains('category-inline-row'),
    ).toBe(true);

    fireEvent.click(groceriesButton);
    expect(screen.queryByRole('heading', { name: 'Groceries transactions' })).toBeNull();
  });

  it('shows exact internal account gaps and complete observed histories', () => {
    render(
      <AccountCoveragePanel
        accounts={[
          {
            accountId: 'axis',
            institution: 'Axis Bank',
            identifierMasked: 'XXXX1111',
            coverageStart: '2025-07-01',
            coverageEnd: '2025-08-31',
            gaps: [{ from: '2025-07-11', to: '2025-07-19' }],
          },
          {
            accountId: 'icici',
            institution: 'ICICI Bank',
            identifierMasked: 'XXXX2222',
            coverageStart: '2025-08-01',
            coverageEnd: '2025-08-31',
            gaps: [],
          },
        ]}
      />,
    );

    expect(screen.getByText(/11 Jul 2025/)).toBeTruthy();
    expect(screen.getByText(/19 Jul 2025/)).toBeTruthy();
    expect(screen.getByText(/no internal gaps/)).toBeTruthy();
  });

  it('shows account lag and import flags independently', () => {
    const position: NetPosition = {
      total: 10_000_00,
      asOf: '2025-06-30',
      newestAsOf: '2025-08-31',
      accounts: [
        {
          accountId: 'axis',
          institution: 'Axis Bank',
          identifierMasked: 'XXXX1111',
          balance: 10_000_00,
          asOf: '2025-06-30',
          monthsBehind: 2,
          staleForWindow: true,
          hasFlaggedStatements: true,
        },
      ],
      excluded: [],
    };

    render(<NetPositionPanel position={position} />);
    expect(screen.getByText(/2 months behind/)).toBeTruthy();
    expect(screen.getByText(/flagged on import/)).toBeTruthy();
  });
});
