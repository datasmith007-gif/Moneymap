import type { Account, Paise, ParsedStatement, Transaction } from '../../model/canonical.ts';
import type { StatementDocument } from '../document.ts';
import type { DetectionResult, BankParser, ParseContext } from '../parser.ts';
import type { ParseOutcome } from '../outcome.ts';
import { documentLines, type Line } from '../layout.ts';
import { parseDmyDate, parseIndianAmount, parseMonthNameDate } from '../fields.ts';

/**
 * Parser for ICICI consolidated account statements (the "DATE | MODE | PARTICULARS
 * | DEPOSITS | WITHDRAWALS | BALANCE" layout). Note the column order differs from
 * Axis: DEPOSITS (credit) precedes WITHDRAWALS (debit).
 *
 * Two format facts shape this parser, both from a real 29-page statement:
 *
 *  1. It is *consolidated*: one PDF holds several ledgers (Savings, PPF, …), each
 *     delimited by a "Statement of Transactions in … Account Number: N" header, a
 *     "B/F" opening row, transaction rows, and a "TOTAL" closing row. This ticket
 *     imports the **Savings** ledger and reports the others as not-yet-imported,
 *     rather than silently dropping them (§1.4). Full multi-account import is a
 *     follow-up.
 *
 *  2. A long narration wraps to lines both *above and below* the row that carries
 *     the date/amount/balance. So the balance-bearing line alone is unreliable as
 *     a text delimiter. Instead we treat each balance-bearing "anchor" line as one
 *     transaction (it fully determines date, amount, and balance — all that
 *     reconciliation needs) and attach narration lines to their nearest anchor.
 *     Financial correctness therefore never depends on narration grouping.
 */
export class IciciParser implements BankParser {
  readonly id = 'icici';
  readonly bankName = 'ICICI Bank';
  readonly formatVersion = 'consolidated-2026';

  detect(doc: StatementDocument): DetectionResult {
    const first = doc.pages[0];
    if (!first) return { confidence: 0 };
    const text = first.words.map((w) => w.text).join(' ').toUpperCase();
    const hasIcici = text.includes('ICICI');
    const hasColumns =
      text.includes('PARTICULARS') &&
      text.includes('DEPOSITS') &&
      text.includes('WITHDRAWALS') &&
      text.includes('BALANCE');
    if (hasColumns && hasIcici) return { confidence: 0.97 };
    if (hasColumns) return { confidence: 0.4 };
    return { confidence: 0 };
  }

  parse(doc: StatementDocument, ctx: ParseContext): ParseOutcome {
    const lines = documentLines(doc);

    const sections = findSections(lines);
    const savings = sections.find((s) => s.isSavings);
    if (!savings) return unreadableFallback('No ICICI savings-account ledger was found.');

    const bandsHeader = lines.find(isColumnHeader);
    if (!bandsHeader) return unreadableFallback('No ICICI transaction header row was found.');
    const bands = deriveBands(bandsHeader);
    if (bands === null) return unreadableFallback('The ICICI transaction header was incomplete.');

    const period = parsePeriod(savings.periodText);
    if (period === null) return unreadableFallback('Could not read the ICICI statement period.');

    // The savings ledger runs from just after its header to the next ledger
    // header (or end). Only these lines are considered.
    const nextHeaderIndex = sections
      .map((s) => s.lineIndex)
      .filter((i) => i > savings.lineIndex)
      .reduce((min, i) => Math.min(min, i), lines.length);
    const topHeaderY = columnHeaderYByPage(lines);

    const account: Account = {
      id: `${ctx.statementId}:account`,
      type: 'savings',
      institution: this.bankName,
      identifierMasked: maskAccount(savings.accountNumber),
      currency: 'INR',
      isLiability: false,
      source: 'upload',
      lastUpdated: ctx.importedAt,
    };

    // Pass 1: split the ledger's lines into anchors (balance-bearing) and
    // narration-only lines, skipping page furniture (headers, page numbers, the
    // repeated name line above each page's header).
    const anchors: AnchorLine[] = [];
    const narrationLines: { page: number; y: number; text: string }[] = [];
    let openingBalance: Paise | null = null;
    let closingBalance: Paise | null = null;

    for (let i = savings.lineIndex + 1; i < nextHeaderIndex; i++) {
      const line = lines[i]!;
      if (isColumnHeader(line) || isPageMarker(line)) continue;
      if (line.y < (topHeaderY.get(line.page) ?? 0)) continue; // above the header = page furniture

      const cells = classify(line, bands);

      if (cells.balance === null) {
        if (cells.narration) narrationLines.push({ page: line.page, y: line.y, text: cells.narration });
        continue;
      }

      // Balance-bearing line. Which kind?
      if (cells.date === null) {
        // No date on a balance line = the closing TOTAL row. Ledger ends here.
        closingBalance = cells.balance;
        break;
      }
      if (cells.deposit === null && cells.withdrawal === null) {
        // Date + balance but no amount = the opening "B/F" row.
        openingBalance ??= cells.balance;
        continue;
      }
      anchors.push({
        page: line.page,
        y: line.y,
        date: cells.date,
        deposit: cells.deposit,
        withdrawal: cells.withdrawal,
        balance: cells.balance,
        narration: cells.narration ? [{ y: line.y, text: cells.narration }] : [],
      });
    }

    if (anchors.length === 0) {
      return unreadableFallback('No transactions were found in the ICICI savings ledger.');
    }

    // Pass 2: attach each narration line to the nearest anchor on the same page.
    for (const n of narrationLines) {
      const anchor = nearestAnchor(anchors, n.page, n.y);
      if (anchor) anchor.narration.push({ y: n.y, text: n.text });
    }

    const transactions: Transaction[] = anchors.map((a, index) => {
      const isCredit = a.deposit !== null;
      return {
        id: `${ctx.statementId}:txn:${index}`,
        accountId: account.id,
        date: a.date,
        type: isCredit ? 'credit' : 'debit',
        amount: (isCredit ? a.deposit : a.withdrawal) ?? 0,
        balanceAfter: a.balance,
        description: orderedNarration(a),
        category: null,
        counterparty: null,
        isInternalTransfer: false,
        provenance: { statementId: ctx.statementId, page: a.page, rawLine: orderedNarration(a) },
      };
    });

    openingBalance ??= inferOpening(transactions[0]!);
    closingBalance ??= transactions[transactions.length - 1]!.balanceAfter ?? 0;

    const statement: ParsedStatement = {
      account,
      transactions,
      openingBalance,
      closingBalance,
      periodStart: period.start,
      periodEnd: period.end,
    };

    // Honesty about the consolidated statement: name the ledgers we did not import.
    const others = sections.filter((s) => s.accountNumber !== savings.accountNumber);
    if (others.length > 0) {
      const list = others.map((s) => `A/c ${maskAccount(s.accountNumber)}`).join(', ');
      return {
        kind: 'needs_review',
        statement,
        issues: [
          `This consolidated statement also contains ${others.length} other account ledger(s) ` +
            `(${list}) that were not imported. Only the savings account was imported.`,
        ],
      };
    }
    return { kind: 'parsed', statement };
  }
}

// ── Sections ────────────────────────────────────────────────────────────────

interface Section {
  readonly lineIndex: number;
  readonly accountNumber: string;
  readonly isSavings: boolean;
  readonly periodText: string;
}

const SECTION_RE =
  /Statement of Transactions in (.*?)Account Number:\s*(\d+)\s+in INR for the period\s+(.+)$/i;

function findSections(lines: readonly Line[]): Section[] {
  const sections: Section[] = [];
  lines.forEach((line, lineIndex) => {
    const text = line.words.map((w) => w.text).join(' ');
    const m = SECTION_RE.exec(text);
    if (m) {
      sections.push({
        lineIndex,
        accountNumber: m[2]!,
        isSavings: /savings/i.test(m[1]!),
        periodText: m[3]!,
      });
    }
  });
  return sections;
}

function parsePeriod(text: string): { start: string; end: string } | null {
  const [a, b] = text.split(/\s+-\s+/);
  if (!a || !b) return null;
  const start = parseMonthNameDate(a);
  const end = parseMonthNameDate(b);
  if (start === null || end === null) return null;
  return { start, end };
}

// ── Column geometry ─────────────────────────────────────────────────────────

interface Bands {
  readonly modeX: number;
  readonly depositsX: number;
  readonly withdrawalsX: number;
  readonly balanceX: number;
}

function isColumnHeader(line: Line): boolean {
  const text = line.words.map((w) => w.text).join(' ').toUpperCase();
  return (
    text.includes('PARTICULARS') &&
    text.includes('DEPOSITS') &&
    text.includes('WITHDRAWALS') &&
    text.includes('BALANCE')
  );
}

function deriveBands(header: Line): Bands | null {
  const at = (needle: string): number | null =>
    header.words.find((w) => w.text.toUpperCase().startsWith(needle))?.x ?? null;
  const modeX = at('MODE');
  const depositsX = at('DEPOSITS');
  const withdrawalsX = at('WITHDRAWALS');
  const balanceX = at('BALANCE');
  if (modeX === null || depositsX === null || withdrawalsX === null || balanceX === null) return null;
  return { modeX, depositsX, withdrawalsX, balanceX };
}

interface Cells {
  readonly date: string | null;
  readonly narration: string;
  readonly deposit: Paise | null;
  readonly withdrawal: Paise | null;
  readonly balance: Paise | null;
}

function classify(line: Line, bands: Bands): Cells {
  const narration: string[] = [];
  let date: string | null = null;
  let deposit: Paise | null = null;
  let withdrawal: Paise | null = null;
  let balance: Paise | null = null;

  for (const word of line.words) {
    const centre = word.x + word.width / 2;
    if (centre < bands.modeX) {
      date ??= parseDmyDate(word.text);
    } else if (centre < bands.depositsX) {
      narration.push(word.text); // MODE + PARTICULARS columns are both description
    } else if (centre < bands.withdrawalsX) {
      deposit ??= parseIndianAmount(word.text);
    } else if (centre < bands.balanceX) {
      withdrawal ??= parseIndianAmount(word.text);
    } else {
      balance ??= parseIndianAmount(word.text);
    }
  }
  return { date, narration: narration.join(' '), deposit, withdrawal, balance };
}

// ── Anchors & narration ─────────────────────────────────────────────────────

interface NarrationFragment {
  readonly y: number;
  readonly text: string;
}

interface AnchorLine {
  readonly page: number;
  readonly y: number;
  readonly date: string;
  readonly deposit: Paise | null;
  readonly withdrawal: Paise | null;
  readonly balance: Paise;
  readonly narration: NarrationFragment[];
}

/** Nearest anchor on the same page by vertical distance; null if none on page. */
function nearestAnchor(anchors: AnchorLine[], page: number, y: number): AnchorLine | null {
  let best: AnchorLine | null = null;
  let bestDist = Infinity;
  for (const a of anchors) {
    if (a.page !== page) continue;
    const d = Math.abs(a.y - y);
    if (d < bestDist) {
      best = a;
      bestDist = d;
    }
  }
  return best;
}

/** The anchor's own particulars plus attached narration lines, read top-to-bottom. */
function orderedNarration(a: AnchorLine): string {
  return [...a.narration]
    .filter((n) => n.text.trim() !== '')
    .sort((x, y) => x.y - y.y)
    .map((n) => n.text)
    .join(' ')
    .trim();
}

function inferOpening(first: Transaction): Paise {
  const delta = first.type === 'credit' ? first.amount : -first.amount;
  return (first.balanceAfter ?? 0) - delta;
}

// ── Page furniture ──────────────────────────────────────────────────────────

/** The y of the topmost column-header on each page — anything above it (page
 *  number, repeated name) is furniture to skip. */
function columnHeaderYByPage(lines: readonly Line[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const line of lines) {
    if (!isColumnHeader(line)) continue;
    const prev = map.get(line.page);
    if (prev === undefined || line.y < prev) map.set(line.page, line.y);
  }
  return map;
}

function isPageMarker(line: Line): boolean {
  return /^Page \d+ of \d+$/i.test(line.words.map((w) => w.text).join(' ').trim());
}

// ── Small helpers ───────────────────────────────────────────────────────────

function maskAccount(accountNumber: string): string {
  const last4 = accountNumber.slice(-4);
  return `${'X'.repeat(Math.max(0, accountNumber.length - 4))}${last4}`;
}

function unreadableFallback(detail: string): ParseOutcome {
  return {
    kind: 'unreadable',
    reason: 'corrupt',
    message: `This ICICI statement couldn't be read as expected. ${detail}`,
  };
}
