import { describe, it, expect } from 'vitest';
import { AxisParser } from '../../src/ingestion/parsers/axis.ts';
import type { ParseContext } from '../../src/ingestion/parser.ts';
import { axisSyntheticDoc, unknownBankDoc } from '../fixtures/statements.ts';

const ctx: ParseContext = { statementId: 'test', importedAt: '2026-07-22T00:00:00Z' };

describe('AxisParser.detect', () => {
  it('recognises an Axis statement with high confidence', () => {
    expect(new AxisParser().detect(axisSyntheticDoc()).confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('does not recognise an unrelated document', () => {
    expect(new AxisParser().detect(unknownBankDoc()).confidence).toBe(0);
  });
});

describe('AxisParser.parse', () => {
  const outcome = new AxisParser().parse(axisSyntheticDoc(), ctx);

  it('produces a parsed statement', () => {
    expect(outcome.kind).toBe('parsed');
  });

  it('masks the account number to the last four digits only', () => {
    if (outcome.kind !== 'parsed') throw new Error('not parsed');
    expect(outcome.statement.account.identifierMasked).toBe('XXXXXXXXXXX4567');
    expect(outcome.statement.account.institution).toBe('Axis Bank');
  });

  it('reads the statement period', () => {
    if (outcome.kind !== 'parsed') throw new Error('not parsed');
    expect(outcome.statement.periodStart).toBe('2025-08-01');
    expect(outcome.statement.periodEnd).toBe('2025-08-31');
  });

  it('extracts the three transactions, ignoring the opening row and the legend', () => {
    if (outcome.kind !== 'parsed') throw new Error('not parsed');
    const txns = outcome.statement.transactions;
    expect(txns).toHaveLength(3);
    expect(txns.map((t) => [t.date, t.type, t.amount])).toEqual([
      ['2025-08-02', 'debit', 20000],
      ['2025-08-03', 'credit', 500000],
      ['2025-08-04', 'debit', 30050],
    ]);
  });

  it('joins a two-line narration into one description', () => {
    if (outcome.kind !== 'parsed') throw new Error('not parsed');
    expect(outcome.statement.transactions[1]!.description).toBe('SALARY/CREDIT/LONG ACME CORP');
  });

  it('reconciles: opening + credits - debits === closing (exact, in paise)', () => {
    if (outcome.kind !== 'parsed') throw new Error('not parsed');
    const s = outcome.statement;
    const credits = s.transactions.filter((t) => t.type === 'credit').reduce((n, t) => n + t.amount, 0);
    const debits = s.transactions.filter((t) => t.type === 'debit').reduce((n, t) => n + t.amount, 0);
    expect(s.openingBalance).toBe(100000);
    expect(s.closingBalance).toBe(549950);
    expect(s.openingBalance + credits - debits).toBe(s.closingBalance);
  });

  it('records provenance (page and raw line) on every transaction', () => {
    if (outcome.kind !== 'parsed') throw new Error('not parsed');
    for (const t of outcome.statement.transactions) {
      expect(t.provenance.statementId).toBe('test');
      expect(t.provenance.page).toBe(1);
      expect(t.provenance.rawLine.length).toBeGreaterThan(0);
    }
  });
});
