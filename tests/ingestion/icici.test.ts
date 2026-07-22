import { describe, it, expect } from 'vitest';
import { IciciParser } from '../../src/ingestion/parsers/icici.ts';
import type { ParseContext } from '../../src/ingestion/parser.ts';
import { iciciSyntheticDoc, axisSyntheticDoc } from '../fixtures/statements.ts';

const ctx: ParseContext = { statementId: 'test', importedAt: '2026-07-22T00:00:00Z' };

describe('IciciParser.detect', () => {
  it('recognises an ICICI statement with high confidence', () => {
    expect(new IciciParser().detect(iciciSyntheticDoc()).confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('does not recognise an Axis statement (different columns)', () => {
    expect(new IciciParser().detect(axisSyntheticDoc()).confidence).toBe(0);
  });
});

describe('IciciParser.parse', () => {
  const outcome = new IciciParser().parse(iciciSyntheticDoc(), ctx);

  it('imports the savings ledger and flags the other ledger (needs_review)', () => {
    expect(outcome.kind).toBe('needs_review');
    if (outcome.kind !== 'needs_review') throw new Error('expected needs_review');
    expect(outcome.issues[0]).toMatch(/007218019874|9874/);
  });

  it('imports only the savings account, masked', () => {
    if (outcome.kind !== 'needs_review') throw new Error('not parsed');
    expect(outcome.statement.account.identifierMasked).toBe('XXXXXXXX3458');
    expect(outcome.statement.account.institution).toBe('ICICI Bank');
  });

  it('reads the period from the month-name header', () => {
    if (outcome.kind !== 'needs_review') throw new Error('not parsed');
    expect(outcome.statement.periodStart).toBe('2025-04-01');
    expect(outcome.statement.periodEnd).toBe('2026-03-31');
  });

  it('maps DEPOSITS->credit and WITHDRAWALS->debit', () => {
    if (outcome.kind !== 'needs_review') throw new Error('not parsed');
    const txns = outcome.statement.transactions;
    expect(txns.map((t) => [t.date, t.type, t.amount])).toEqual([
      ['2025-04-02', 'credit', 50000],
      ['2025-04-03', 'debit', 20000],
    ]);
  });

  it('joins narration that wraps above and below the amount line', () => {
    if (outcome.kind !== 'needs_review') throw new Error('not parsed');
    expect(outcome.statement.transactions[1]!.description).toBe('UPI/LONG/NARRATION CONTINUED/PART');
  });

  it('reconciles: B/F + deposits - withdrawals === closing (exact, in paise)', () => {
    if (outcome.kind !== 'needs_review') throw new Error('not parsed');
    const s = outcome.statement;
    const credits = s.transactions.filter((t) => t.type === 'credit').reduce((n, t) => n + t.amount, 0);
    const debits = s.transactions.filter((t) => t.type === 'debit').reduce((n, t) => n + t.amount, 0);
    expect(s.openingBalance).toBe(100000);
    expect(s.closingBalance).toBe(130000);
    expect(s.openingBalance + credits - debits).toBe(s.closingBalance);
  });
});
