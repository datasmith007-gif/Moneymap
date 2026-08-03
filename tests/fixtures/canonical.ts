import type { Account, ParsedStatement, Transaction } from '../../src/model/canonical.ts';
import { accountKey } from '../../src/model/identity.ts';

/**
 * Builders for canonical entities, so store and engine tests describe only the
 * fields the case is actually about. Everything else takes a sensible default —
 * a test that spells out all eleven `Transaction` fields buries its own point.
 */

export function account(over: Partial<Account> = {}): Account {
  const institution = over.institution ?? 'Test Bank';
  const identifierMasked = over.identifierMasked ?? 'XXXX0000';
  return {
    id: accountKey(institution, identifierMasked),
    type: 'savings',
    institution,
    identifierMasked,
    currency: 'INR',
    isLiability: false,
    source: 'upload',
    lastUpdated: '2025-09-01T00:00:00Z',
    ...over,
  };
}

let nextId = 0;

export function txn(
  over: Partial<Transaction> & Pick<Transaction, 'date' | 'type' | 'amount'>,
): Transaction {
  return {
    id: `t${nextId++}`,
    accountId: account().id,
    balanceAfter: null,
    description: 'test row',
    provenance: { statementId: 'test', page: 1, rawLine: '' },
    ...over,
  };
}

export function statement(over: Partial<ParsedStatement> = {}): ParsedStatement {
  return {
    account: account(),
    transactions: [],
    openingBalance: 0,
    closingBalance: 0,
    periodStart: '2025-08-01',
    periodEnd: '2025-08-31',
    ...over,
  };
}
