import type { Account, Paise, ParsedStatement, Transaction } from '../../model/canonical.ts';
import type { StatementDocument } from '../document.ts';
import type { DetectionResult, BankParser, ParseContext } from '../parser.ts';
import type { NeedsReviewOutcome, ParseOutcome } from '../outcome.ts';
import { documentLines, type Line } from '../layout.ts';
import { parseDmyDate, parseIndianAmount } from '../fields.ts';

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
    const bands = deriveBands(lines[headerIndex]!);
    if (bands === null) {
      return unreadableFallback('The Axis column header was incomplete.');
    }

    const meta = parseMeta(doc);
    if (meta === null) {
      return unreadableFallback('Could not read the Axis account number or period.');
    }

    const account: Account = {
      id: `${ctx.statementId}:account`,
      type: 'savings',
      institution: this.bankName,
      identifierMasked: maskAccount(meta.accountNumber),
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
      const cells = classify(line, bands);

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
        category: null,
        counterparty: null,
        isInternalTransfer: false,
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

/** x-boundaries between columns, taken from the header row's token positions. */
interface Bands {
  readonly chqX: number;
  readonly debitX: number;
  readonly creditX: number;
  readonly balanceX: number;
  readonly initX: number;
}

function isColumnHeader(line: Line): boolean {
  const text = line.words.map((w) => w.text).join(' ').toUpperCase();
  return text.includes('PARTICULARS') && text.includes('BALANCE') && text.includes('DEBIT');
}

/**
 * Derive column boundaries from the header labels' left-x. Verified against real
 * data: each right-aligned amount's centre-x falls between its own header's x and
 * the next header's x, so the header left-x values are correct dividers.
 */
function deriveBands(header: Line): Bands | null {
  const at = (needle: string): number | null => {
    const w = header.words.find((word) => word.text.toUpperCase().startsWith(needle));
    return w ? w.x : null;
  };
  const chqX = at('CHQ');
  const debitX = at('DEBIT');
  const creditX = at('CREDIT');
  const balanceX = at('BALANCE');
  const initX = at('INIT');
  if (chqX === null || debitX === null || creditX === null || balanceX === null) return null;
  // Init.Br may occasionally be absent; default just past the balance column.
  return { chqX, debitX, creditX, balanceX, initX: initX ?? balanceX + 60 };
}

interface Cells {
  readonly date: string | null;
  readonly narration: string;
  readonly debit: Paise | null;
  readonly credit: Paise | null;
  readonly balance: Paise | null;
}

/** Assign a line's words to columns by centre-x, then interpret each column. */
function classify(line: Line, bands: Bands): Cells {
  const narration: string[] = [];
  let date: string | null = null;
  let debit: Paise | null = null;
  let credit: Paise | null = null;
  let balance: Paise | null = null;

  for (const word of line.words) {
    const centre = word.x + word.width / 2;
    if (centre < bands.chqX) {
      // Left column: the transaction date, when present.
      date ??= parseDmyDate(word.text);
    } else if (centre < bands.debitX) {
      narration.push(word.text);
    } else if (centre < bands.creditX) {
      debit ??= parseIndianAmount(word.text);
    } else if (centre < bands.balanceX) {
      credit ??= parseIndianAmount(word.text);
    } else if (centre < bands.initX) {
      balance ??= parseIndianAmount(word.text);
    }
    // centre >= initX is the branch-init column — ignored (no canonical field).
  }

  return { date, narration: narration.join(' '), debit, credit, balance };
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
