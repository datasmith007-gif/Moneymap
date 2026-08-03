import type { Account, Paise, ParsedStatement, Transaction } from '../../model/canonical.ts';
import type { StatementDocument } from '../document.ts';
import type { DetectionResult, BankParser, ParseContext } from '../parser.ts';
import type { NeedsReviewOutcome, ParseOutcome } from '../outcome.ts';
import { documentLines, type Line } from '../layout.ts';
import { firstParsed, hasLabels, headerX, joinText, splitColumns } from '../columns.ts';
import { parseDmyDate, parseIndianAmount } from '../fields.ts';
import { accountKey } from '../../model/identity.ts';

/**
 * Parser for Axis Bank savings/salary account statements (the "Tran Date | Chq No
 * | Particulars | Debit | Credit | Balance | Init.Br" layout).
 *
 * Two facts about this format drive the whole implementation, both established
 * from a real 26-page statement:
 *
 *  1. Columns are defined by horizontal position, and the amount columns are
 *     right-aligned. We do NOT trust reading order or whitespace — we read the
 *     header row's x-positions and classify every later token by its centre-x.
 *
 *  2. One logical transaction spans several physical lines: narration wraps, and
 *     only the *last* line of the group carries the date, debit/credit, and the
 *     running balance. Exactly one balance per transaction — so the balance token
 *     is the row terminator. We buffer narration lines until a balance appears,
 *     emit a transaction, and clear the buffer. Trailing non-transaction text
 *     (the abbreviations legend at the end) never carries a balance, so it is
 *     harmlessly discarded.
 *
 * If Axis changes this layout, that is a *new* parser version (a new BankParser),
 * not edits here — see the registry design.
 */
export class AxisParser implements BankParser {
  readonly id = 'axis';
  readonly bankName = 'Axis Bank';
  readonly formatVersion = '2025-08';

  detect(doc: StatementDocument): DetectionResult {
    const first = doc.pages[0];
    if (!first) return { confidence: 0 };
    const text = first.words.map((w) => w.text).join(' ').toUpperCase();

    // UTIB is Axis's IFSC prefix — highly specific. "AXIS" appears in the scheme
    // name. The column set guards against matching a non-statement Axis PDF.
    const hasIfsc = text.includes('UTIB');
    const hasAxis = text.includes('AXIS');
    const hasColumns =
      text.includes('PARTICULARS') &&
      text.includes('BALANCE') &&
      text.includes('DEBIT') &&
      text.includes('CREDIT');

    if (hasColumns && (hasIfsc || hasAxis)) return { confidence: hasIfsc ? 0.98 : 0.9 };
    if (hasIfsc) return { confidence: 0.7 };
    return { confidence: 0 };
  }

  parse(doc: StatementDocument, ctx: ParseContext): ParseOutcome {
    const first = doc.pages[0];
    if (!first) return unreadableFallback('The statement has no pages.');

    const lines = documentLines(doc);
    const headerIndex = lines.findIndex(isColumnHeader);
    if (headerIndex === -1) {
      return unreadableFallback('Could not locate the Axis column header row.');
    }
    const boundaries = deriveBoundaries(lines[headerIndex]!);
    if (boundaries === null) {
      return unreadableFallback('The Axis column header was incomplete.');
    }

    const meta = parseMeta(doc);
    if (meta === null) {
      return unreadableFallback('Could not read the Axis account number or period.');
    }

    const identifierMasked = maskAccount(meta.accountNumber);
    const account: Account = {
      // Content-derived, not import-derived: the same bank account must get the
      // same id every upload, or the store cannot recognise a re-import.
      id: accountKey(this.bankName, identifierMasked),
      type: 'savings',
      institution: this.bankName,
      identifierMasked,
      currency: 'INR',
      isLiability: false,
      source: 'upload',
      lastUpdated: ctx.importedAt,
    };

    const transactions: Transaction[] = [];
    const issues: string[] = [];
    let openingBalance: Paise | null = null;
    let closingBalance: Paise | null = null;
    let pendingNarration: string[] = [];
    let lastDate: string | null = null;
    let index = 0;

    for (const line of lines.slice(headerIndex + 1)) {
      const cells = classify(line, boundaries);

      // Not a terminating line: accumulate its narration and move on.
      if (cells.balance === null) {
        if (cells.narration) pendingNarration.push(cells.narration);
        continue;
      }

      const narration = [...pendingNarration, cells.narration].filter(Boolean).join(' ').trim();
      pendingNarration = [];

      // Opening/closing marker rows carry a balance but no date — they set the
      // statement bounds and are not transactions.
      if (cells.date === null && /OPENING BALANCE/i.test(narration)) {
        openingBalance = cells.balance;
        continue;
      }
      if (cells.date === null && /CLOSING BALANCE/i.test(narration)) {
        closingBalance = cells.balance;
        continue;
      }

      const rowDate: string | null = cells.date ?? lastDate;
      if (rowDate === null) {
        issues.push(`A row with balance ${cells.balance} had no date and no prior date to use.`);
        continue;
      }
      lastDate = rowDate;

      // A transaction is a debit or a credit, never both. If neither column has a
      // value, the row is malformed — flag rather than invent an amount.
      const debit = cells.debit;
      const credit = cells.credit;
      if (debit === null && credit === null) {
        issues.push(`The ${rowDate} row "${truncate(narration)}" had no debit or credit amount.`);
        continue;
      }

      transactions.push({
        id: `${ctx.statementId}:txn:${index++}`,
        accountId: account.id,
        date: rowDate,
        type: debit !== null ? 'debit' : 'credit',
        amount: debit ?? credit ?? 0,
        balanceAfter: cells.balance,
        description: narration,
        provenance: { statementId: ctx.statementId, page: line.page, rawLine: narration },
      });
    }

    if (transactions.length === 0) {
      return unreadableFallback('No transactions were found in the Axis statement.');
    }

    // No explicit closing-balance row in this format: the last running balance is
    // the closing balance.
    closingBalance ??= transactions[transactions.length - 1]!.balanceAfter;
    // Opening balance defended: if the marker row was missed, reconstruct it from
    // the first transaction (balanceAfter ∓ its own amount).
    if (openingBalance === null) {
      const firstTxn = transactions[0]!;
      const delta = firstTxn.type === 'credit' ? firstTxn.amount : -firstTxn.amount;
      openingBalance = (firstTxn.balanceAfter ?? 0) - delta;
      issues.push('Opening-balance row not found; inferred from the first transaction.');
    }

    const statement: ParsedStatement = {
      account,
      transactions,
      openingBalance,
      closingBalance: closingBalance ?? 0,
      periodStart: meta.periodStart,
      periodEnd: meta.periodEnd,
    };

    if (issues.length > 0) {
      const outcome: NeedsReviewOutcome = { kind: 'needs_review', statement, issues };
      return outcome;
    }
    return { kind: 'parsed', statement };
  }
}

// ── Column geometry ─────────────────────────────────────────────────────────

/**
 * The Axis columns, left→right, named for `splitColumns`. `date` sits left of the
 * Chq column; the Chq column's content folds into narration (narration text often
 * begins left of the Particulars header); `init` is the trailing branch-init
 * column, kept as a name so it is captured and then ignored (no canonical field).
 * Six names for the five boundaries `deriveBoundaries` produces.
 */
const AXIS_COLUMNS = ['date', 'narration', 'debit', 'credit', 'balance', 'init'] as const;

function isColumnHeader(line: Line): boolean {
  return hasLabels(line, ['PARTICULARS', 'BALANCE', 'DEBIT']);
}

/**
 * Derive the ascending column boundaries from the header labels' left-x. Verified
 * against real data: each right-aligned amount's centre-x falls between its own
 * header's x and the next header's x, so the header left-x values are correct
 * dividers. Init.Br may occasionally be absent; default just past the balance
 * column so the balance region still terminates.
 */
function deriveBoundaries(header: Line): number[] | null {
  const chqX = headerX(header, 'CHQ');
  const debitX = headerX(header, 'DEBIT');
  const creditX = headerX(header, 'CREDIT');
  const balanceX = headerX(header, 'BALANCE');
  if (chqX === null || debitX === null || creditX === null || balanceX === null) return null;
  const initX = headerX(header, 'INIT') ?? balanceX + 60;
  return [chqX, debitX, creditX, balanceX, initX];
}

interface Cells {
  readonly date: string | null;
  readonly narration: string;
  readonly debit: Paise | null;
  readonly credit: Paise | null;
  readonly balance: Paise | null;
}

/** Assign a line's words to columns by centre-x (shared helper), then interpret
 *  each column with the Indian field grammar. */
function classify(line: Line, boundaries: readonly number[]): Cells {
  const cols = splitColumns(line, boundaries, AXIS_COLUMNS);
  return {
    date: firstParsed(cols.date!, parseDmyDate),
    narration: joinText(cols.narration!),
    debit: firstParsed(cols.debit!, parseIndianAmount),
    credit: firstParsed(cols.credit!, parseIndianAmount),
    balance: firstParsed(cols.balance!, parseIndianAmount),
  };
}

// ── Header metadata ─────────────────────────────────────────────────────────

interface Meta {
  readonly accountNumber: string;
  readonly periodStart: string;
  readonly periodEnd: string;
}

/** Read account number and statement period from the "Statement of Account No …
 *  for the period (From : … To : …)" line, wherever it sits on page 1. */
function parseMeta(doc: StatementDocument): Meta | null {
  const first = doc.pages[0];
  if (!first) return null;
  const text = first.words.map((w) => w.text).join(' ');
  const account = /Account No\s*:?\s*(\d+)/i.exec(text);
  const period = /From\s*:?\s*(\d{2}-\d{2}-\d{4})\s*To\s*:?\s*(\d{2}-\d{2}-\d{4})/i.exec(text);
  if (!account || !period) return null;
  const start = parseDmyDate(period[1]!);
  const end = parseDmyDate(period[2]!);
  if (start === null || end === null) return null;
  return { accountNumber: account[1]!, periodStart: start, periodEnd: end };
}

/** Keep only the last four digits; mask the rest — never store a full number. */
function maskAccount(accountNumber: string): string {
  const last4 = accountNumber.slice(-4);
  return `${'X'.repeat(Math.max(0, accountNumber.length - 4))}${last4}`;
}

// ── Small helpers ───────────────────────────────────────────────────────────

function truncate(s: string, max = 40): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/**
 * A structural failure mid-parse (a corrupted or unexpected layout) surfaces as
 * `unreadable/corrupt` with an actionable message — never a thrown error and
 * never a silent partial. The user learns the file couldn't be read and why.
 */
function unreadableFallback(detail: string): ParseOutcome {
  return {
    kind: 'unreadable',
    reason: 'corrupt',
    message: `This Axis statement couldn't be read as expected. ${detail}`,
  };
}
