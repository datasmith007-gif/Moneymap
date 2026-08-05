// @vitest-environment jsdom

import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CategorizationReviewPanel } from '../../src/components/CategorizationReviewPanel.tsx';
import { ReviewCategorizationSection } from '../../src/components/ReviewCategorizationSection.tsx';
import { ReviewCenter } from '../../src/components/ReviewCenter.tsx';
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
    const { rerender } = render(<TransactionCategoryControl row={row()} onChange={onChange} />);

    const select = screen.getByLabelText('Category for UPI LOCAL MART');
    expect(screen.queryByRole('option', { name: 'Salary' })).toBeNull();
    expect(screen.getByRole('option', { name: 'Groceries' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Money lent' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Borrowed money' })).toBeNull();
    fireEvent.change(select, { target: { value: 'shopping' } });
    expect(onChange).toHaveBeenCalledWith('shopping');
    expect(screen.getByText('Needs category')).toBeTruthy();

    const creditRow = {
      ...row(),
      transaction: { ...row().transaction, type: 'credit' as const },
    };
    rerender(<TransactionCategoryControl row={creditRow} onChange={onChange} />);
    expect(screen.getByRole('option', { name: 'Borrowed money' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Loan repayment received' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Business & freelance income' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Money lent' })).toBeNull();
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

    // Ordering is in the column headings now: click Total to rank by value.
    fireEvent.click(screen.getByRole('button', { name: /Total/ }));
    expect(screen.getAllByRole('row')[1]?.textContent).toContain('CORNER CAFE');
    fireEvent.click(screen.getByRole('button', { name: /Occurrences/ }));

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

  it('sorts from the column headings, showing direction and flipping on a second click', () => {
    render(
      <CategorizationReviewPanel
        rows={[
          unclassifiedRow('mart-a', 'LOCAL MART', '2025-08-12'),
          unclassifiedRow('mart-b', 'Local-Mart', '2025-08-11'),
          unclassifiedRow('cafe', 'CORNER CAFE', '2025-08-10', 10_000_00),
        ]}
        onCategorize={async () => undefined}
      />,
    );

    // Default: most repeated first, and the heading says so.
    const occurrences = () => screen.getByRole('columnheader', { name: /Occurrences/ });
    expect(occurrences().getAttribute('aria-sort')).toBe('descending');
    expect(screen.getAllByRole('row')[1]?.textContent).toContain('LOCAL MART');

    // A second click on the active column reverses it.
    fireEvent.click(screen.getByRole('button', { name: /Occurrences/ }));
    expect(occurrences().getAttribute('aria-sort')).toBe('ascending');
    expect(screen.getAllByRole('row')[1]?.textContent).toContain('CORNER CAFE');

    // Moving to another column hands the sort over, and the old one goes quiet.
    fireEvent.click(screen.getByRole('button', { name: /Label/ }));
    expect(occurrences().getAttribute('aria-sort')).toBe('none');
    expect(screen.getByRole('columnheader', { name: /Label/ }).getAttribute('aria-sort')).toBe(
      'ascending',
    );
    expect(screen.getAllByRole('row')[1]?.textContent).toContain('CORNER CAFE');

    // Category holds a control, not a value, so it is not a sort target.
    expect(screen.getByRole('columnheader', { name: 'Category' }).hasAttribute('aria-sort')).toBe(
      false,
    );
  });

  it('sorts the exact-row view by its own columns', () => {
    render(
      <CategorizationReviewPanel
        rows={[
          unclassifiedRow('small', 'CORNER CAFE', '2025-08-10', 100_00),
          unclassifiedRow('large', 'LOCAL MART', '2025-08-12', 90_000_00),
        ]}
        onCategorize={async () => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Transactions' }));
    // Oldest first to begin with — the order the store already returns.
    expect(screen.getAllByRole('row')[1]?.textContent).toContain('CORNER CAFE');

    fireEvent.click(screen.getByRole('button', { name: /Amount/ }));
    expect(screen.getAllByRole('row')[1]?.textContent).toContain('LOCAL MART');
    expect(screen.getByRole('columnheader', { name: /Amount/ }).getAttribute('aria-sort')).toBe(
      'descending',
    );
  });

  it('returns to page one when the order changes', () => {
    const rows = Array.from({ length: 12 }, (_, index) =>
      unclassifiedRow(`txn-${index}`, `LABEL ${String(index).padStart(2, '0')}`, '2025-08-10'),
    );
    render(<CategorizationReviewPanel rows={rows} onCategorize={async () => undefined} />);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Page 2 of 2')).toBeTruthy();

    // Page 2 of the old order holds unrelated rows in the new one.
    fireEvent.click(screen.getByRole('button', { name: /Total/ }));
    expect(screen.getByText('Page 1 of 2')).toBeTruthy();
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
        rules={[]}
        onAdd={onAdd}
        onDelete={async () => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create rule' }));

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

describe('review center', () => {
  it('is collapsed by default and reports the same loaded work it opens', async () => {
    const store = createMemoryStore();
    const rows = [
      unclassifiedRow('mart-a', 'LOCAL MART', '2025-08-12'),
      unclassifiedRow('mart-b', 'Local-Mart', '2025-08-11'),
    ];

    render(
      <ReviewCenter
        store={store}
        revision={0}
        rows={rows}
        onCategorize={async () => undefined}
        onAddRule={async () => ({
          id: 'user:1',
          order: 0,
          operator: 'contains',
          patterns: ['MART'],
          category: 'groceries',
          origin: 'user',
        })}
        onDeleteRule={async () => undefined}
      />,
    );

    expect(screen.getByText('2 uncategorized')).toBeTruthy();
    expect(screen.getByText('1 repeated label groups')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Categorization review' })).toBeNull();
    await waitFor(() => expect(screen.getByText('0 personal session rules')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Open review' }));
    expect(screen.getByRole('heading', { name: 'Categorization review' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Categorization rules' })).toBeTruthy();
    expect(screen.queryByLabelText('Merchant or narration text')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Create rule' }));
    expect(screen.getByLabelText('Merchant or narration text')).toBeTruthy();
  });

  it('filters before grouping and paging, combines filters, and clears them', () => {
    const axis = unclassifiedRow('axis-debit', 'LOCAL-MART', '2025-08-12');
    const icici = {
      ...unclassifiedRow('icici-credit', 'LOCAL MART', '2025-08-11'),
      transaction: {
        ...unclassifiedRow('icici-credit', 'LOCAL MART', '2025-08-11').transaction,
        accountId: 'icici',
        type: 'credit' as const,
      },
      account: { institution: 'ICICI Bank', identifierMasked: 'XXXXXXXX7654' },
    };
    render(
      <ReviewCategorizationSection rows={[axis, icici]} onCategorize={async () => undefined} />,
    );

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'local, mart' } });
    fireEvent.change(screen.getByLabelText('Account'), { target: { value: 'icici' } });
    fireEvent.change(screen.getByLabelText('Direction'), { target: { value: 'debit' } });
    expect(screen.getByText('0 of 2 transactions')).toBeTruthy();
    expect(screen.getByText('No uncategorized transactions match these filters.')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Direction'), { target: { value: 'credit' } });
    expect(screen.getByText('1 of 2 transactions')).toBeTruthy();
    expect(screen.getByText('LOCAL MART')).toBeTruthy();
    expect(screen.getByRole('option', { name: 'ICICI Bank 7654' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByText('2 of 2 transactions')).toBeTruthy();
  });

  it('offers exact Undo for single and bulk categorization actions', async () => {
    const onCategorize = vi.fn(async () => undefined);
    render(
      <ReviewCategorizationSection
        rows={[
          unclassifiedRow('mart-a', 'LOCAL MART', '2025-08-12'),
          unclassifiedRow('mart-b', 'Local-Mart', '2025-08-11'),
        ]}
        onCategorize={onCategorize}
      />,
    );

    fireEvent.change(screen.getByLabelText('Category for LOCAL MART debit'), {
      target: { value: 'groceries' },
    });
    await screen.findByText('Categorized 2 LOCAL MART transactions as Groceries.', {
      selector: '.action-toast p',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(onCategorize).toHaveBeenCalledTimes(4));
    expect(onCategorize.mock.calls).toEqual([
      ['mart-a', 'groceries'],
      ['mart-b', 'groceries'],
      ['mart-a', null],
      ['mart-b', null],
    ]);
    expect(screen.getByText('Undid categorization for 2 transactions.')).toBeTruthy();
  });

  it('restores an explicit unclassified override instead of clearing it', async () => {
    const explicit = {
      ...unclassifiedRow('explicit', 'LOCAL MART', '2025-08-12'),
      classification: {
        ...unclassifiedRow('explicit', 'LOCAL MART', '2025-08-12').classification,
        source: 'user' as const,
      },
    };
    const onCategorize = vi.fn(async () => undefined);
    render(<ReviewCategorizationSection rows={[explicit]} onCategorize={onCategorize} />);
    fireEvent.change(screen.getByLabelText('Category for LOCAL MART debit'), {
      target: { value: 'groceries' },
    });
    await screen.findByText('Categorized LOCAL MART as Groceries.', {
      selector: '.action-toast p',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(onCategorize).toHaveBeenLastCalledWith('explicit', 'unclassified'));
  });

  it('offers Undo for the successful subset of a failed bulk action', async () => {
    const onCategorize = vi.fn(async (id: string) => {
      if (id === 'mart-b') throw new Error('write failed');
    });
    render(
      <ReviewCategorizationSection
        rows={[
          unclassifiedRow('mart-a', 'LOCAL MART', '2025-08-12'),
          unclassifiedRow('mart-b', 'Local-Mart', '2025-08-11'),
        ]}
        onCategorize={onCategorize}
      />,
    );
    fireEvent.change(screen.getByLabelText('Category for LOCAL MART debit'), {
      target: { value: 'groceries' },
    });
    await screen.findByRole('alert');
    expect(screen.getByRole('alert').textContent).toContain('Saved 1 of 2');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(onCategorize).toHaveBeenLastCalledWith('mart-a', null));
  });

  it('moves focus to the next category control after a saved row disappears', async () => {
    function Harness() {
      const [rows, setRows] = useState([
        unclassifiedRow('cafe', 'CORNER CAFE', '2025-08-12'),
        unclassifiedRow('mart', 'LOCAL MART', '2025-08-11'),
      ]);
      return (
        <ReviewCategorizationSection
          rows={rows}
          onCategorize={async (id) =>
            setRows((current) => current.filter((item) => item.transaction.id !== id))
          }
        />
      );
    }
    render(<Harness />);
    const first = screen.getByLabelText('Category for CORNER CAFE debit');
    first.focus();
    fireEvent.change(first, { target: { value: 'food_dining' } });
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText('Category for LOCAL MART debit')),
    );
  });
});
