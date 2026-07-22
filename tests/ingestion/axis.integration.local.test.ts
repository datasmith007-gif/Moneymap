import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { parseStatement } from '../../src/ingestion/parseStatement.ts';

/**
 * Local-only integration test against a REAL Axis statement. It never runs in CI
 * (the file is git-ignored and password-protected) — it is skipped unless the
 * developer points it at a real file:
 *
 *   AXIS_FIXTURE=fixtures/private/<file>.pdf AXIS_PDF_PASSWORD=<pw> npm test
 *
 * The password is read from the environment and never written to disk or logs.
 * The assertions check structure and reconciliation only, not specific values.
 */
const fixture = process.env.AXIS_FIXTURE;
const password = process.env.AXIS_PDF_PASSWORD;
const available = Boolean(fixture && existsSync(fixture));

describe.skipIf(!available)('Axis parser against a real statement', () => {
  it('parses and reconciles opening + credits - debits === closing', async () => {
    const bytes = new Uint8Array(readFileSync(fixture!));
    const outcome = await parseStatement(bytes, {
      statementId: 'integration',
      importedAt: '2026-07-22T00:00:00Z',
      ...(password ? { password } : {}),
    });

    expect(['parsed', 'needs_review']).toContain(outcome.kind);
    if (outcome.kind !== 'parsed' && outcome.kind !== 'needs_review') return;

    const s = outcome.statement;
    expect(s.transactions.length).toBeGreaterThan(0);

    const credits = s.transactions.filter((t) => t.type === 'credit').reduce((n, t) => n + t.amount, 0);
    const debits = s.transactions.filter((t) => t.type === 'debit').reduce((n, t) => n + t.amount, 0);
    expect(s.openingBalance + credits - debits).toBe(s.closingBalance);

    // Running-balance continuity: every row follows from the previous.
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
