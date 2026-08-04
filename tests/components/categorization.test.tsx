// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CategorizationReviewPanel } from '../../src/components/CategorizationReviewPanel.tsx';
import { RuleManagerPanel } from '../../src/components/RuleManagerPanel.tsx';
import { TransactionCategoryControl } from '../../src/components/TransactionCategoryControl.tsx';
import type { TransactionRegisterRow } from '../../src/engine/transactions.ts';
import { createMemoryStore } from '../../src/storage/memoryStore.ts';
import { account, statement, txn } from '../fixtures/canonical.ts';

afterEach(cleanup);

function row(
  source: TransactionRegisterRow['classification']['source'] = 'none',
): TransactionRegisterRow {
  const transaction = txn({
    id: 'txn-1',
    date: '2025-08-10',
    type: 'debit',
    amount: 1_250_00,
    description: 'UPI LOCAL MART',
  });
  return {
    transaction,
    account: { institution: 'Test Bank', identifierMasked: 'XXXX0000' },
    classification: {
      transactionId: transaction.id,
      category: source === 'none' ? 'unclassified' : 'groceries',
      confidence: source === 'none' ? 0 : source === 'user' ? 1 : 0.95,
      source,
      ruleId: source === 'user_rule' ? 'user:1' : null,
      counterparty: 'LOCAL MART',
      isInternalTransfer: false,
      transferPeerId: null,
    },
  };
}

function unclassifiedRow(
  id: string,
  label: string,
  date: string,
  amount = 1_250_00,
): TransactionRegisterRow {
  const base = row();
  return {
    ...base,
    transaction: {
      ...base.transaction,
      id,
      date,
      amount,
      description: `UPI ${label}`,
    },
    classification: {
      ...base.classification,
      transactionId: id,
      counterparty: label,
    },
  };
}

describe('transaction category controls', () => {
  it('offers direction-compatible categories and records an exact manual choice', () => {
    const onChange = vi.fn();
    render(<TransactionCategoryControl row={row()} onChange={onChange} />);

    const select = screen.getByLabelText('Category for UPI LOCAL MART');
    expect(screen.queryByRole('option', { name: 'Salary' })).toBeNull();
    expect(screen.getByRole('option', { name: 'Groceries' })).toBeTruthy();
    fireEvent.change(select, { target: { value: 'shopping' } });
    expect(onChange).toHaveBeenCalledWith('shopping');
    expect(screen.getByText('Needs category')).toBeTruthy();
  });

  it('shows manual provenance and can return a row to automatic classification', () => {
    const onChange = vi.fn();
    render(<TransactionCategoryControl row={row('user')} onChange={onChange} />);

    expect(screen.getByText('Manual choice')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use automatic' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('turns the unclassified register into an actionable review queue', async () => {
    const onCategorize = vi.fn(async () => undefined);
    render(<CategorizationReviewPanel rows={[row()]} onCategorize={onCategorize} />);

    expect(screen.getByText('1 transaction need a category')).toBeTruthy();
    expect(screen.getByText('LOCAL MART')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Category for LOCAL MART debit'), {
      target: { value: 'groceries' },
    });
    await waitFor(() => expect(onCategorize).toHaveBeenCalledWith('txn-1', 'groceries'));
  });

  it('ranks normalized labels by frequency and categorizes a whole label group', async () => {
    const onCategorize = vi.fn(async () => undefined);
    render(
      <CategorizationReviewPanel
        rows={[
          unclassifiedRow('mart-new', 'LOCAL MART', '2025-08-12'),
          unclassifiedRow('cafe', 'CORNER CAFE', '2025-08-11', 10_000_00),
          unclassifiedRow('mart-old', 'Local-Mart', '2025-08-10'),
        ]}
        onCategorize={onCategorize}
      />,
    );

    const bodyRows = screen.getAllByRole('row').slice(1);
    expect(bodyRows[0]?.textContent).toContain('LOCAL MART');
    expect(bodyRows[0]?.textContent).toContain('2');

    fireEvent.change(screen.getByLabelText('Order labels by'), {
      target: { value: 'total' },
    });
    expect(screen.getAllByRole('row')[1]?.textContent).toContain('CORNER CAFE');
    fireEvent.change(screen.getByLabelText('Order labels by'), {
      target: { value: 'occurrences' },
    });

    fireEvent.change(screen.getByLabelText('Category for LOCAL MART debit'), {
      target: { value: 'groceries' },
    });
    await waitFor(() => expect(onCategorize).toHaveBeenCalledTimes(2));
    expect(onCategorize.mock.calls).toEqual([
      ['mart-new', 'groceries'],
      ['mart-old', 'groceries'],
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Transactions' }));
    expect(screen.getByRole('columnheader', { name: 'Date' })).toBeTruthy();
  });

  it('expands a repeated label inline and allows different categories per transaction', async () => {
    const onCategorize = vi.fn(async () => undefined);
    render(
      <CategorizationReviewPanel
        rows={[
          unclassifiedRow('mart-new', 'LOCAL MART', '2025-08-12'),
          unclassifiedRow('mart-old', 'Local-Mart', '2025-08-10'),
        ]}
        onCategorize={onCategorize}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'LOCAL MART' }));
    expect(screen.getByText('2 transactions with this label')).toBeTruthy();
    expect(screen.getByText('UPI LOCAL MART')).toBeTruthy();
    expect(screen.getByText('UPI Local-Mart')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Category for UPI Local-Mart'), {
      target: { value: 'shopping' },
    });
    await waitFor(() => expect(onCategorize).toHaveBeenCalledWith('mart-old', 'shopping'));

    fireEvent.click(screen.getByRole('button', { name: 'LOCAL MART' }));
    expect(screen.queryByText('2 transactions with this label')).toBeNull();
  });

  it('shows ten review rows per page and can collapse the section', () => {
    const rows = Array.from({ length: 12 }, (_, index) =>
      unclassifiedRow(`txn-${index}`, `LABEL ${String(index).padStart(2, '0')}`, '2025-08-10'),
    );
    render(<CategorizationReviewPanel rows={rows} onCategorize={async () => undefined} />);

    expect(screen.getAllByLabelText(/^Category for /)).toHaveLength(10);
    expect(screen.getByText('Page 1 of 2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getAllByLabelText(/^Category for /)).toHaveLength(2);
    expect(screen.getByText('Page 2 of 2')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Hide review' }));
    expect(screen.queryByRole('table')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show review' }));
    expect(screen.getByRole('table')).toBeTruthy();
  });
});

describe('rule authoring', () => {
  it('previews a retroactive rule with the real classifier before saving it', async () => {
    const store = createMemoryStore();
    const transaction = txn({
      id: 'local-1',
      date: '2025-08-10',
      type: 'debit',
      amount: 500_00,
      description: 'UPI LOCAL MART',
    });
    await store.putStatement(statement({ account: account(), transactions: [transaction] }), {
      statementId: 'statement-1',
      fileName: 'test.pdf',
      importedAt: '2025-09-01T00:00:00Z',
      issues: [],
    });
    const onAdd = vi.fn(async () => ({
      id: 'user:1',
      order: 0,
      operator: 'contains' as const,
      patterns: ['LOCAL MART'],
      category: 'groceries' as const,
      origin: 'user' as const,
    }));

    render(
      <RuleManagerPanel
        store={store}
        revision={0}
        onAdd={onAdd}
        onDelete={async () => undefined}
      />,
    );

    const categorySelect = screen.getByLabelText('Category');
    expect(
      Array.from(categorySelect.querySelectorAll('optgroup')).map((group) => group.label),
    ).toEqual(['Income', 'Essentials', 'Lifestyle', 'Money movement', 'Other']);
    expect(
      Array.from(categorySelect.querySelectorAll('option')).some(
        (option) => option.textContent === 'Unclassified',
      ),
    ).toBe(false);

    fireEvent.change(screen.getByLabelText('Merchant or narration text'), {
      target: { value: 'LOCAL MART' },
    });
    expect((await screen.findByRole('status')).textContent).toMatch(/Matches 1 past entry/);
    expect(screen.getByText(/500.00/)).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save rule' }));
    });
    expect(onAdd).toHaveBeenCalledWith({
      operator: 'contains',
      patterns: ['LOCAL MART'],
      category: 'groceries',
    });
  });
});
