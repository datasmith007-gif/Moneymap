import type { Page, PositionedWord, StatementDocument } from '../../src/ingestion/document.ts';

/**
 * Synthetic, fabricated statement documents for parser tests. These carry NO real
 * financial data and are safe to commit — the rule that keeps real statements out
 * of git (see fixtures/private/README.md). Coordinates mirror the real Axis
 * layout closely enough to exercise the column-by-x classification.
 */

function w(text: string, x: number, y: number, width = text.length * 6): PositionedWord {
  return { text, x, y, width, height: 8 };
}

function page(pageNumber: number, words: PositionedWord[]): Page {
  return { pageNumber, width: 595, height: 842, words };
}

/**
 * A tiny Axis statement: identity + column header + an opening-balance row + three
 * transactions (one with a two-line narration) + a trailing legend line that must
 * be ignored. Chosen so `opening + credits − debits === closing` exactly:
 *   1000.00 + 5000.00 − 200.00 − 300.50 = 5499.50
 */
export function axisSyntheticDoc(): StatementDocument {
  const words: PositionedWord[] = [
    // Identity / detection markers.
    w('SAMPLE HOLDER', 38, 60),
    w('IFSC Code :UTIB0004502', 459, 138),
    w('Scheme :AXIS LIBERTY SALARY ACCOUNT', 38, 203),
    w(
      'Statement of Account No :922010001234567 for the period (From : 01-08-2025 To : 31-08-2025)',
      93,
      220,
    ),
    // Column header row — parser reads column x-positions from here.
    w('Tran Date', 40, 242),
    w('Chq No', 92, 242),
    w('Particulars', 203, 242),
    w('Debit', 339, 242),
    w('Credit', 400, 242),
    w('Balance', 473, 242),
    w('Init.', 538, 242),
    // Opening balance (no date) — sets the opening, not a transaction.
    w('OPENING BALANCE', 132, 270),
    w('1000.00', 490, 270, 30),
    // Txn 1: debit 200.00 -> 800.00
    w('02-08-2025', 40, 290, 42),
    w('UPI/PAYMENT/TEST', 132, 290),
    w('200.00', 350, 290, 30),
    w('800.00', 490, 290, 30),
    w('4502', 538, 290, 18),
    // Txn 2: two-line narration, credit 5000.00 -> 5800.00
    w('SALARY/CREDIT/LONG', 132, 308),
    w('03-08-2025', 40, 321, 42),
    w('ACME CORP', 132, 321),
    w('5000.00', 410, 321, 30),
    w('5800.00', 490, 321, 30),
    w('248', 538, 321),
    // Txn 3: debit 300.50 -> 5499.50 (closing)
    w('04-08-2025', 40, 340, 42),
    w('POS/PURCHASE', 132, 340),
    w('300.50', 350, 340, 30),
    w('5499.50', 490, 340, 30),
    w('4502', 538, 340),
    // Trailing legend line (no balance) — must be discarded, not attached.
    w('Legend', 36, 372),
    w('UPI - Unified Payments Interface', 80, 372),
  ];
  return { pages: [page(1, words)] };
}

/**
 * A tiny ICICI *consolidated* statement: a PPF ledger and a Savings ledger, each
 * with its own "Statement of Transactions … Account Number: N" header, B/F opening,
 * rows, and TOTAL closing. The savings ledger includes a transaction whose narration
 * wraps both above and below the amount line (the ICICI quirk). Chosen so the
 * savings ledger reconciles: 1000.00 + 500.00 − 200.00 = 1300.00.
 */
export function iciciSyntheticDoc(): StatementDocument {
  const words: PositionedWord[] = [
    w('ICICI BANK LTD', 27, 60),
    // Column header — parser reads column x-positions from here.
    w('DATE', 27, 140),
    w('MODE**', 75.7, 140),
    w('PARTICULARS', 158.5, 140),
    w('DEPOSITS', 387.5, 140),
    w('WITHDRAWALS', 443.9, 140),
    w('BALANCE', 545.5, 140),
    // --- PPF ledger (should NOT be imported; only flagged) ---
    w(
      'Statement of Transactions in Account Number: 007218019874 in INR for the period April 01, 2025 - March 31, 2026',
      27,
      170,
    ),
    w('01-04-2025', 27, 185, 40),
    w('B/F', 158.5, 185),
    w('5,000.00', 541, 185, 42),
    w('01-05-2025', 27, 200, 40),
    w('PPF CREDIT', 158.5, 200),
    w('100.00', 396, 200, 31),
    w('5,100.00', 541, 200, 42),
    w('TOTAL', 158.5, 215),
    w('100.00', 396, 215, 31),
    w('0.00', 474, 215, 31),
    w('5,100.00', 541, 215, 42),
    // --- Savings ledger (imported) ---
    w(
      'Statement of Transactions in Savings Account Number: 343901513458 in INR for the period April 01, 2025 - March 31, 2026',
      27,
      245,
    ),
    w('01-04-2025', 27, 285, 40),
    w('B/F', 158.5, 285),
    w('1,000.00', 541, 285, 42),
    // Txn 1: deposit 500.00 -> 1500.00
    w('02-04-2025', 27, 305, 40),
    w('UPI', 75.7, 305),
    w('PAYMENT ONE', 158.5, 305),
    w('500.00', 396, 305, 31),
    w('1,500.00', 541, 305, 42),
    // Txn 2: narration wraps above AND below the amount line; withdrawal 200.00 -> 1300.00
    w('UPI/LONG/NARRATION', 158.5, 320),
    w('03-04-2025', 27, 331, 40),
    w('200.00', 474, 331, 31),
    w('1,300.00', 541, 331, 42),
    w('CONTINUED/PART', 158.5, 340),
    w('TOTAL', 158.5, 360),
    w('500.00', 396, 360, 31),
    w('200.00', 474, 360, 31),
    w('1,300.00', 541, 360, 42),
  ];
  return { pages: [page(1, words)] };
}

/** A text-bearing document that no parser recognises — for the unsupported path. */
export function unknownBankDoc(): StatementDocument {
  return {
    pages: [
      page(1, [
        w('MYSTERY BANK LIMITED', 38, 60),
        w('Some Statement', 38, 100),
        w('Date Description Amount', 40, 140),
      ]),
    ],
  };
}
