import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { parseStatement } from '../../src/ingestion/parseStatement.ts';

/**
 * Local-only integration test against a REAL ICICI consolidated statement. Skipped
 * unless pointed at a real file (the file is git-ignored and password-protected):
 *
 *   ICICI_FIXTURE=fixtures/private/<file>.pdf ICICI_PDF_PASSWORD=<pw> npm test
 *
 * Asserts structure and reconciliation of the imported savings ledger only.
 */
const fixture = process.env.ICICI_FIXTURE;
const password = process.env.ICICI_PDF_PASSWORD;
const available = Boolean(fixture && existsSync(fixture));

describe.skipIf(!available)('ICICI parser against a real consolidated statement', () => {
  it('imports the savings ledger, reconciles, and flags other ledgers', async () => {
    const bytes = new Uint8Array(readFileSync(fixture!));
    const outcome = await parseStatement(bytes, {
      statementId: 'integration',
      importedAt: '2026-07-22T00:00:00Z',
      ...(password ? { password } : {}),
    });

    // Consolidated statement -> needs_review (other ledgers not imported).
    expect(outcome.kind).toBe('needs_review');
    if (outcome.kind !== 'parsed' && outcome.kind !== 'needs_review') return;

    const s = outcome.statement;
    expect(s.transactions.length).toBeGreaterThan(0);

    const credits = s.transactions.filter((t) => t.type === 'credit').reduce((n, t) => n + t.amount, 0);
    const debits = s.transactions.filter((t) => t.type === 'debit').reduce((n, t) => n + t.amount, 0);
    expect(s.openingBalance + credits - debits).toBe(s.closingBalance);

    let prev = s.openingBalance;
    for (const t of s.transactions) {
      const expected = t.type === 'credit' ? prev + t.amount : prev - t.amount;
      if (t.balanceAfter !== null) {
        expect(t.balanceAfter).toBe(expected);
        prev = t.balanceAfter;
      }
    }
  });
});
