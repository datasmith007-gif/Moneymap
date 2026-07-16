# Feature 1: PDF Statement Parsing

**Version: V1** (writes through the storage adapter; persistence is the adapter's concern, not this module's).

## Module Promise
> Given an uploaded PDF, returns a parsed statement whose transactions reconcile to the stated closing balance, or flags it for review — never silently stores unreconciled data. Callers see only canonical entities; they never see bank-specific formats.

## Overview
Ingest bank account statements uploaded as PDFs, extract transactions and account metadata accurately, validate the extracted data, and write it to the canonical store. This is the foundational data pipeline for the entire app.

## Goals
- Support statements from the major banks with bank-specific parsers.
- Guarantee data accuracy through automated data-quality checks.
- Handle password-protected PDFs, unsupported files, and duplicate uploads gracefully.

## Functional Requirements

### 1.1 Bank-Specific Parsers
- Identify the major banks to support at launch (shortlist based on target market, e.g. top 8–10 banks by customer base).
- Build one parser per bank/statement format. Each parser must extract:
  - Account holder name, account number (masked), account type
  - Statement period (from date, to date)
  - Opening balance and closing balance
  - Transaction rows: date, description/narration, reference no., debit, credit, running balance
- Auto-detect which bank a PDF belongs to (via header text, logos-as-text, format fingerprinting) and route to the correct parser.
- Parser registry pattern: adding a new bank = adding a new parser module, no core changes.

### 1.2 Data Quality Checks (post-parse validation)
Every parsed statement must pass these checks before being written to the store:
- **Transaction count**: parsed row count matches the count derivable from the document (or a stated summary count if present).
- **Balance reconciliation**: `opening balance + sum(credits) − sum(debits) = closing balance` (within rounding tolerance).
- **Running-balance continuity**: each row's running balance is consistent with the previous row.
- **Date range**: all transaction dates fall within the statement period; dates are monotonically ordered (or match the bank's ordering).
- Statements failing checks are flagged for review rather than silently stored.

(Classification coverage is reported per import as a metric — see Feature 2 — but it is not a gate here: classification runs after the store, per the dependency flow.)

### 1.3 Deduplication
- Compute a file-level hash (e.g. SHA-256 of file bytes) — reject/skip exact re-uploads with a friendly message.
- Transaction-level dedup for overlapping statement periods (e.g. same account uploaded for Jan–Mar and Feb–Apr): dedupe on `(account_id, date, amount, narration, reference/balance)` composite key.
- Show the user what was skipped as duplicate vs newly imported.

### 1.4 Fallbacks & Exception Handling
- Unsupported bank/format → clear message. To prioritize new parser development, capture only a local format fingerprint (bank name + layout signature, never transaction data) that the user can choose to report. The statement itself never leaves the device.
- Scanned/image PDFs → detect and either route to OCR fallback (post-MVP) or inform the user it's unsupported.
- Partially parseable files → import what passes validation, flag the rest for manual review.
- Corrupt/empty/oversized files → validation at upload with actionable error messages.

### 1.5 Password Management
- Detect password-protected PDFs and prompt the user for the password.
- Support common bank password conventions (e.g. PAN, DOB-based patterns) as hints only — never guess or store patterns tied to identity without consent.
- Passwords used in-memory for decryption only; never persisted or logged.
- Optionally remember the password per account for repeat uploads (V2 only — requires persistence; opt-in; encrypted with a key that never leaves the device — key management TBD with the V2 adapter).

### 1.6 Writing to the Canonical Store
- Validated data is written through the storage adapter using the canonical model (planning doc §6): `Account`, `Transaction`, with `Instrument`, `Holding`, and `Snapshot` reserved for the non-bank scope (CAS, holdings, net-worth history). Bank statements populate only the Account/Transaction slice — but the schema is the general one, so adding demat/MF later is new parsers, not a schema migration.
- Every transaction stores provenance (`source`, `raw_ref`): source statement id, page number, raw text line.
- Import runs as an idempotent job with statuses: `uploaded → parsing → validating → stored / failed / needs_review`. Whether "stored" survives the session is the adapter's decision (V1: no, V2: yes).

## Acceptance Criteria
- [ ] ≥99% field-level accuracy on the supported banks' sample statement corpus.
- [ ] Balance reconciliation check passes on all clean statements; failures are surfaced, never silently ignored.
- [ ] Re-uploading the same file creates zero new transactions.
- [ ] Password-protected PDFs from supported banks can be imported.
- [ ] Unsupported files fail gracefully with a clear reason shown to the user.

## Edge Cases
- Multi-account statements in one PDF.
- Multi-currency accounts / foreign transactions.
- Reversals, failed transactions, and zero-amount rows.
- Statements with page breaks mid-transaction-row.
- Banks that change their statement layout over time (version the parsers).

## Open Questions
- Which banks are in the launch shortlist?
- (V2) Do we retain the original PDF after successful import, and for how long? (V1 has no persistence — nothing is retained past the session by construction.)
- Is OCR for scanned statements in MVP scope or post-MVP?

## Dependencies
- None (this is the root of the pipeline). Feeds Features 2–5.
