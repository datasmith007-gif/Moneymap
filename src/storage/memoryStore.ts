import type { Account, ParsedStatement, Transaction } from '../model/canonical.ts';
import { statementKey, transactionKey } from '../model/identity.ts';
import type {
  ImportMeta,
  ImportRecord,
  ImportSummary,
  Store,
  TransactionQuery,
} from './store.ts';

/**
 * The V1 storage adapter: everything in memory, for the life of the session
 * (overview — "V1 = in-memory store, nothing persists past the session").
 *
 * This is the only file that knows the data lives in a `Map`. Callers see the
 * `Store` interface, so replacing this with the V2 SQLite/OPFS adapter touches
 * nothing else.
 *
 * Dedup lives here rather than in a pipeline stage above, because it *is* the
 * write semantics of the store: "putting a statement is idempotent". Placing it
 * upstream would require the parse side to know what is already stored — the one
 * thing the store exists to hide.
 */
export function createMemoryStore(): Store {
  const accounts = new Map<string, Account>();
  const imports: ImportRecord[] = [];
  /** Keyed by `statementKey`, so a re-uploaded PDF is recognised whole. */
  const statementIds = new Map<string, ImportRecord>();
  /** Keyed by `transactionKey`. The presence set that makes writes idempotent. */
  const rowKeys = new Set<string>();
  const transactions: Transaction[] = [];

  return {
    async putStatement(statement: ParsedStatement, meta: ImportMeta): Promise<ImportSummary> {
      const existing = statementIds.get(statementKey(statement));
      if (existing) return { kind: 'duplicate_statement', existing };

      // Upsert the account. A second statement for the same account must not
      // create a second account, or every row would look new and the net
      // position would double. `lastUpdated` advances only forward, so importing
      // an older statement after a newer one cannot walk the freshness backwards.
      const prior = accounts.get(statement.account.id);
      accounts.set(
        statement.account.id,
        prior && prior.lastUpdated > statement.account.lastUpdated
          ? prior
          : statement.account,
      );

      // Occurrence numbering is per-statement, so two identical rows *within*
      // this statement get distinct keys and both survive, while the same two
      // rows arriving again from an overlapping period reproduce the same two
      // keys and are both skipped. See `transactionKey`.
      const seen = new Map<string, number>();
      let imported = 0;
      let skipped = 0;

      for (const txn of statement.transactions) {
        const base = transactionKey(txn, 0);
        const occurrence = seen.get(base) ?? 0;
        seen.set(base, occurrence + 1);

        const key = transactionKey(txn, occurrence);
        if (rowKeys.has(key)) {
          skipped++;
          continue;
        }
        rowKeys.add(key);
        transactions.push(txn);
        imported++;
      }

      const record: ImportRecord = {
        statementId: meta.statementId,
        accountId: statement.account.id,
        fileName: meta.fileName,
        importedAt: meta.importedAt,
        periodStart: statement.periodStart,
        periodEnd: statement.periodEnd,
        openingBalance: statement.openingBalance,
        closingBalance: statement.closingBalance,
        transactionsImported: imported,
        transactionsSkipped: skipped,
        issues: meta.issues,
      };
      imports.push(record);
      statementIds.set(statementKey(statement), record);
      return { kind: 'imported', record };
    },

    async listImports() {
      return [...imports];
    },

    async listAccounts() {
      return [...accounts.values()];
    },

    async listTransactions(query: TransactionQuery) {
      return transactions
        .filter((txn) => {
          if (query.accountId !== undefined && txn.accountId !== query.accountId) return false;
          // ISO dates compare correctly as strings; bounds are inclusive.
          if (query.from !== undefined && txn.date < query.from) return false;
          if (query.to !== undefined && txn.date > query.to) return false;
          return true;
        })
        .sort(
          (a, b) =>
            a.date.localeCompare(b.date) ||
            a.accountId.localeCompare(b.accountId) ||
            a.id.localeCompare(b.id),
        );
    },

    async clear() {
      accounts.clear();
      imports.length = 0;
      statementIds.clear();
      rowKeys.clear();
      transactions.length = 0;
    },
  };
}
