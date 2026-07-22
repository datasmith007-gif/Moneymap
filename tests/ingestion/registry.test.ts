import { describe, it, expect } from 'vitest';
import { ParserRegistry } from '../../src/ingestion/registry.ts';
import type { BankParser, ParseContext } from '../../src/ingestion/parser.ts';
import type { ParseOutcome } from '../../src/ingestion/outcome.ts';
import type { ParsedStatement } from '../../src/model/canonical.ts';
import { axisSyntheticDoc, unknownBankDoc } from '../fixtures/statements.ts';

const ctx: ParseContext = { statementId: 'test', importedAt: '2026-07-22T00:00:00Z' };

const emptyStatement: ParsedStatement = {
  account: {
    id: 'a',
    type: 'savings',
    institution: 'Test',
    identifierMasked: 'XXXX0000',
    currency: 'INR',
    isLiability: false,
    source: 'upload',
    lastUpdated: ctx.importedAt,
  },
  transactions: [],
  openingBalance: 0,
  closingBalance: 0,
  periodStart: '2025-08-01',
  periodEnd: '2025-08-31',
};

/** A parser that reports a fixed confidence and, when it wins, tags the outcome
 *  with its id so we can see which one ran. */
function fakeParser(id: string, confidence: number): BankParser {
  return {
    id,
    bankName: id,
    formatVersion: '1',
    detect: () => ({ confidence }),
    parse: (): ParseOutcome => ({
      kind: 'parsed',
      statement: { ...emptyStatement, account: { ...emptyStatement.account, institution: id } },
    }),
  };
}

describe('ParserRegistry', () => {
  it('dispatches to the highest-confidence parser above the threshold', () => {
    const registry = new ParserRegistry().register(fakeParser('low', 0.6)).register(fakeParser('high', 0.9));
    const outcome = registry.dispatch(axisSyntheticDoc(), ctx);
    expect(outcome.kind).toBe('parsed');
    if (outcome.kind === 'parsed') expect(outcome.statement.account.institution).toBe('high');
  });

  it('breaks confidence ties in favour of the earlier-registered parser', () => {
    const registry = new ParserRegistry().register(fakeParser('first', 0.8)).register(fakeParser('second', 0.8));
    const outcome = registry.dispatch(axisSyntheticDoc(), ctx);
    if (outcome.kind === 'parsed') expect(outcome.statement.account.institution).toBe('first');
  });

  it('returns unsupported when no parser clears the threshold', () => {
    const registry = new ParserRegistry().register(fakeParser('weak', 0.3));
    const outcome = registry.dispatch(unknownBankDoc(), ctx);
    expect(outcome.kind).toBe('unsupported');
  });

  it('returns unsupported (with a fingerprint) when no parsers are registered', () => {
    const outcome = new ParserRegistry().dispatch(unknownBankDoc(), ctx);
    expect(outcome.kind).toBe('unsupported');
    if (outcome.kind === 'unsupported') {
      expect(outcome.fingerprint.signature).toMatch(/^[0-9a-f]{8}$/);
      // A privacy-safe guess derives only from fixed markers; this doc has none.
      expect(outcome.fingerprint.bankGuess).toBeNull();
    }
  });

  it('guesses a known bank name for the unsupported fingerprint when a marker is present', () => {
    // Axis doc, but an empty registry -> unsupported with an "Axis Bank" guess.
    const outcome = new ParserRegistry().dispatch(axisSyntheticDoc(), ctx);
    if (outcome.kind === 'unsupported') expect(outcome.fingerprint.bankGuess).toBe('Axis Bank');
  });

  it('rejects duplicate parser ids', () => {
    const registry = new ParserRegistry().register(fakeParser('dup', 0.9));
    expect(() => registry.register(fakeParser('dup', 0.9))).toThrow(/already registered/);
  });
});
