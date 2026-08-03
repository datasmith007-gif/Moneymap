import { describe, expect, it } from 'vitest';
import {
  buildAccountCoverage,
  coveredDays,
  loadAccountCoverage,
} from '../../src/engine/coverage.ts';
import { createMemoryStore } from '../../src/storage/memoryStore.ts';
import type { ImportRecord } from '../../src/storage/store.ts';
import { account, statement } from '../fixtures/canonical.ts';

const axis = account({ institution: 'Axis Bank', identifierMasked: 'XXXX1111' });
const icici = account({ institution: 'ICICI Bank', identifierMasked: 'XXXX2222' });

function record(over: Partial<ImportRecord> = {}): ImportRecord {
  return {
    statementId: 's1',
    accountId: axis.id,
    fileName: 'statement.pdf',
    importedAt: '2025-09-01T00:00:00Z',
    periodStart: '2025-08-01',
    periodEnd: '2025-08-31',
    openingBalance: 0,
    closingBalance: 0,
    transactionsImported: 0,
    transactionsSkipped: 0,
    issues: [],
    ...over,
  };
}

describe('account coverage gaps', () => {
  it('reports exact internal holes, including partial months', () => {
    const result = buildAccountCoverage(
      [axis],
      [
        record({ statementId: 'a', periodStart: '2025-07-01', periodEnd: '2025-07-10' }),
        record({ statementId: 'b', periodStart: '2025-07-20', periodEnd: '2025-08-31' }),
      ],
    );

    expect(result[0]).toEqual({
      accountId: axis.id,
      institution: 'Axis Bank',
      identifierMasked: 'XXXX1111',
      coverageStart: '2025-07-01',
      coverageEnd: '2025-08-31',
      gaps: [{ from: '2025-07-11', to: '2025-07-19' }],
    });
  });

  it('merges overlapping and directly adjacent periods', () => {
    const result = buildAccountCoverage(
      [axis],
      [
        record({ statementId: 'a', periodStart: '2025-01-01', periodEnd: '2025-03-31' }),
        record({ statementId: 'b', periodStart: '2025-02-01', periodEnd: '2025-04-30' }),
        record({ statementId: 'c', periodStart: '2025-05-01', periodEnd: '2025-05-31' }),
      ],
    );

    expect(result[0]?.gaps).toEqual([]);
    expect(result[0]?.coverageEnd).toBe('2025-05-31');
  });

  it('returns multiple gaps chronologically regardless of import order', () => {
    const result = buildAccountCoverage(
      [axis],
      [
        record({ statementId: 'c', periodStart: '2025-05-01', periodEnd: '2025-05-31' }),
        record({ statementId: 'a', periodStart: '2025-01-01', periodEnd: '2025-01-31' }),
        record({ statementId: 'b', periodStart: '2025-03-01', periodEnd: '2025-03-31' }),
      ],
    );

    expect(result[0]?.gaps).toEqual([
      { from: '2025-02-01', to: '2025-02-28' },
      { from: '2025-04-01', to: '2025-04-30' },
    ]);
  });

  it('handles leap-day boundaries exactly', () => {
    const result = buildAccountCoverage(
      [axis],
      [
        record({ statementId: 'a', periodStart: '2024-02-01', periodEnd: '2024-02-28' }),
        record({ statementId: 'b', periodStart: '2024-03-01', periodEnd: '2024-03-31' }),
      ],
    );
    expect(result[0]?.gaps).toEqual([{ from: '2024-02-29', to: '2024-02-29' }]);
  });

  it('does not infer leading or trailing gaps from another account', () => {
    const result = buildAccountCoverage(
      [axis, icici],
      [
        record({ accountId: axis.id, periodStart: '2025-01-01', periodEnd: '2025-12-31' }),
        record({
          accountId: icici.id,
          statementId: 'b',
          periodStart: '2025-04-01',
          periodEnd: '2025-06-30',
        }),
      ],
    );

    expect(result.find((item) => item.accountId === icici.id)).toMatchObject({
      coverageStart: '2025-04-01',
      coverageEnd: '2025-06-30',
      gaps: [],
    });
  });

  it('sorts accounts deterministically and omits accounts with no imports', () => {
    const noImports = account({ institution: 'Unused Bank', identifierMasked: 'XXXX9999' });
    const result = buildAccountCoverage(
      [icici, noImports, axis],
      [
        record({ accountId: icici.id, statementId: 'b' }),
        record({ accountId: axis.id, statementId: 'a' }),
      ],
    );
    expect(result.map((item) => item.accountId)).toEqual([axis.id, icici.id]);
  });

  it('counts a flagged statement as coverage', () => {
    const result = buildAccountCoverage([axis], [record({ issues: ['Statement needs review.'] })]);
    expect(result[0]?.gaps).toEqual([]);
    expect(result[0]?.coverageStart).toBe('2025-08-01');
  });

  it('returns no account coverage for empty input', () => {
    expect(buildAccountCoverage([], [])).toEqual([]);
  });

  it('fails fast when an import period is reversed', () => {
    expect(() =>
      buildAccountCoverage(
        [axis],
        [record({ periodStart: '2025-08-31', periodEnd: '2025-08-01' })],
      ),
    ).toThrow(/starts after it ends/);
  });
});

describe('coveredDays', () => {
  it('unions, clamps, and counts inclusive date ranges', () => {
    const records = [
      record({ statementId: 'a', periodStart: '2025-01-15', periodEnd: '2025-02-15' }),
      record({ statementId: 'b', periodStart: '2025-02-01', periodEnd: '2025-03-15' }),
    ];
    expect(coveredDays('2025-02-01', '2025-02-28', records)).toBe(28);
    expect(coveredDays('2025-04-01', '2025-04-30', records)).toBe(0);
  });
});

describe('loadAccountCoverage', () => {
  it('loads accounts and import periods through the Store interface', async () => {
    const store = createMemoryStore();
    await store.putStatement(
      statement({ account: axis, periodStart: '2025-08-01', periodEnd: '2025-08-31' }),
      {
        statementId: 's1',
        fileName: 'axis.pdf',
        importedAt: '2025-09-01T00:00:00Z',
        issues: ['Reviewed.'],
      },
    );

    expect(await loadAccountCoverage(store)).toEqual([
      {
        accountId: axis.id,
        institution: 'Axis Bank',
        identifierMasked: 'XXXX1111',
        coverageStart: '2025-08-01',
        coverageEnd: '2025-08-31',
        gaps: [],
      },
    ]);
  });
});
