# Roadmap

Where the build has got to, what is next, and the constraints that came out of getting here.

**Scope of this file:** sequencing and the reasoning behind it. Product vision, the canonical data model, and the V1/V2 split live in the [Planning Document](https://app.notion.com/p/39a65a498a9780b0aa18d166368c8d2b); milestones and blocking decisions live in the [Project Planner](https://app.notion.com/p/39e65a498a9781b4b9eaf23bfe2f401d); a session-by-session record of what changed lives in the [Worklog](https://app.notion.com/p/3a065a498a9781348a65db6605ecd213). When this file and a planning doc disagree, the planning doc wins.

> The `features/` folder that used to hold per-feature specs was removed on 2026-08-03 — the specs had drifted out of date with the code and were being read as current. They remain in git history (`git log -- features/`) and their product content is in the planning doc.

### Reading the `§` references in code comments

Around thirty comments across `src/` cite a requirement by number — `(§1.2)`, `feature §2.1`, `planning doc §5.1`. They were not rewritten when the specs were removed, because the numbers still resolve and the comments explain _why_ a design choice was made against a specific requirement, which is the most perishable thing in the codebase.

- **`planning doc §N`** — a section of the [Planning Document](https://app.notion.com/p/39a65a498a9780b0aa18d166368c8d2b). Still live; read it there.
- **`§N.M` / `feature §N.M`** — section `M` of feature `N` in the removed specs, where the features were: **1** PDF statement parsing · **2** transaction classification · **3** aggregation & dashboard · **4** account behaviour analysis · **5** investment habits & goal setting. Recover one with `git show HEAD~1:features/0N-*.md`.

---

## The target

**The Ledger Finance App** (`Ledger.dc.html`, shared separately) is the agreed end state. Seven screens: Dashboard, Import, Review, Transactions, Budgets, Accounts, Rules.

**Right now it is a reference for _what the app must be able to do_, not for how it looks.** A scoped calm-editorial visual system now covers the existing Import → Dashboard flow, but the seven-screen design-system port remains deferred: **no new screens, router, or navigation have been added.** Continue building capability against the finished engine contracts rather than copying unsupported prototype surfaces.

Two things the prototype gets wrong, worth remembering when the design does land:

1. **It has no visual language for failure** — no slot for a statement whose arithmetic does not reconcile, a partially covered month, or an unreadable PDF. Our reconciliation gate, `needs_review` outcome, coverage model and caveat list are real product value with nowhere to go in the mock. Do not delete honesty machinery to match it.
2. **It implies unscoped features** — "94% sorted itself out" (classification rate), "four times your usual shopping day" (anomaly detection), "March 2027" (goal pace projection).

It also shows five banks (HDFC, ICICI, SBI, Axis, Kotak). We parse two.

---

## Where we are

| Layer             | State                                                                                                                                                                                                                                                      |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/ingestion/`  | Positional pdf.js extraction, Axis + ICICI parsers, confidence registry, five-outcome union, reconciliation gate proving `opening + credits − debits === closing` in integer paise                                                                         |
| `src/model/`      | `Paise`, `Account`, `Transaction`, `ParsedStatement`, provenance on every row, month **and day** arithmetic with no `Date` object anywhere                                                                                                                 |
| `src/enrichment/` | `classify()` over rules → merchant knowledge → transfer pairing; confidence bands; rule dry-run; per-import stats                                                                                                                                          |
| `src/storage/`    | `Store` interface + in-memory adapter, holding two record classes — derived-from-source and user-authored                                                                                                                                                  |
| `src/engine/`     | Dashboard aggregation, review queue, enriched transaction query + deterministic CSV export, per-account coverage gaps, and robust per-category spend baselines                                                                                             |
| UI                | Calm editorial Import-first shell and briefing-led Dashboard; light/dark mode, responsive open analysis sections, readable data-quality disclosure, collapsed Review center, filters, exact Undo, stable focus, manual choices, and session rule authoring |
| Tests             | **353 passing, 2 skipped.** The 2 are integration tests gated on real private PDFs and never run in CI.                                                                                                                                                    |

### Shipped, in order

1. **Enrichment layer** — classification, transfer detection, counterparty extraction. Retired the standing caveat that told the user every income and spend figure was wrong by an unknown amount.
2. **Batch statement import** — many files per drop, sequential writes, parked passwords, bulk include.
3. **Classification completion** — review queue, rule dry-run preview, confidence bands, per-import stats.
4. **Transactions and accounts foundation** — enriched free-text/category query with deterministic paging, audit-friendly CSV export, and exact per-account statement gaps.
5. **Aggregation visibility** — exposed category shares, classification coverage, savings rate, variation, account lag/gaps, and monthly net inside the existing Dashboard. Exact tables and KPIs reuse the provisional UI without introducing another screen or visual system before the final design lands.
6. **Interactive categorization** — exposed classification source on enriched transaction rows, added a collapsible and paged frequency-first label queue with occurrence/total ordering, inline repeated-label transaction drill-downs, exact-row fallback, and bulk or individual manual choices, preview-before-save personal rules, honest count/amount coverage, and single-open category transaction drill-downs. All writes are serialized, retroactive, and session-scoped; every dashboard figure refreshes after a change.
7. **Import-first application shell** — replaced tab navigation with an explicit Import → Dashboard handoff and a small Dashboard → Import action, kept the live dashboard inert behind the import surface, and added a local-only light/dark preference. View changes never clear imported or user-authored session data.
8. **Dashboard signal-to-noise** — collected every standing caveat into one hover/focus indicator instead of a box per panel (which also surfaced the net-position-only caveats that were previously rendered nowhere), moved statement coverage into a dialog, dropped range and standard deviation from the averages tiles, hid the categorization guidance behind a tip, and removed the redundant "import more statements" control. Nothing was deleted from the honesty machinery — it was collapsed, not dropped.
9. **Anomaly detection** — robust per-category spend baselines (median + median absolute deviation, integer paise) and the payments that sit far outside them, with a dashboard panel that renders only when there is something to report.
10. **Sortable review columns** — retired the "order by" dropdown for per-column sorting in the headings themselves, on both the label queue and the exact-row view, with `aria-sort` carrying the state. Comparators live in `engine/categorization.ts` so they are testable and total.
11. **Calm editorial UI/UX refresh** — centralized the light/dark visual tokens, made the Dashboard a financial briefing before its workbench, changed analytical cards into open sections, added the queue-derived three-step Import marker, and consolidated categorization and rules under a collapsed Review center. Review filters run before grouping and paging; the latest single or bulk decision can be undone to its exact prior override state, partial failures remain recoverable, and focus follows disappearing rows.
12. **Expanded practical taxonomy** — added business, rental, pension, education, tax, dependant, household-service, personal-care, gift, fitness and pet categories, plus direction-safe Money lent, Borrowed money and Loan repayment received labels. Loan principal movements are flow-neutral, so they do not masquerade as income, spending, savings or anomalies; automatic rules remain conservative and these subjective labels are available for manual choices and personal rules.

---

## Decisions locked

| Decision              | Choice                               | Consequence                                                                     |
| --------------------- | ------------------------------------ | ------------------------------------------------------------------------------- |
| Classification method | Rules + merchant knowledge only      | No model, no LLM. Deterministic and fully testable.                             |
| Persistence           | **Stays in-memory**                  | Budgets & Goals are out of scope; rules and overrides do not survive a reload.  |
| Design fidelity       | Calm editorial + derived dark ground | Applied to the existing two-view shell; broader screen design remains deferred. |
| Rule scope            | Always retroactive                   | See constraints below.                                                          |

---

## Constraints that came out of building

These are not preferences. Designing against them will produce something that does not fit.

- **Classification lives _beside_ the canonical record, never inside it.** `Transaction` has no category field. A rule edit re-runs the classifier over unchanged rows, so nothing stored is ever rewritten, there is no migration, and a manual edit cannot be lost to a re-import.
- **Rules are always retroactive.** Because classification is derived on every read rather than stored per row, "apply to future entries only" cannot exist without giving every rule an effective-from date. The trade is a **preview** instead of a toggle. A user override always outranks a rule, so a backfill can never overwrite a decision someone actually made.
- **Category menus share one grouped taxonomy renderer.** Transaction review and rule authoring use the same Income, Essentials, Lifestyle, Money movement, and Other grouping, while each caller controls which categories are valid for its context.
- **Uncategorized label counts use the complete enriched result, not a register page.** Labels are punctuation-insensitive and split by debit/credit direction before frequency sorting, so a bulk choice cannot cross category applicability boundaries or report a partial count as complete.
- **Account display is bank plus the final four digits everywhere.** The canonical record retains its full masked identifier for identity and audit behavior, while one display formatter prevents mask length or `X` characters from leaking into user-facing account labels.
- **The store holds two record classes.** Derived-from-source (accounts, transactions, imports) and user-authored (overrides, rules). An import has no code path that can reach the second — that is how "overrides survive a re-import" stays cheap.
- **Writes are not concurrency-safe and callers must serialise.** Overlapping writes race on "is this row already here?", making the new/duplicate split nondeterministic.
- **Money is integer paise everywhere.** Rupees are a display-edge concern only.
- **Every figure originates in `src/engine/`.** Components render values, never derive them — the test runner only collects `.ts`/`.tsx` under `tests/`, and a number computed inside a component is a number nobody can test.
- **Two rates, deliberately different.** Classification coverage by **count** answers "how much work is left"; by **amount** answers "how much of the money is explained". One ₹80,000 rent payment is 1% of the work and 40% of the money. Do not merge them.
- **A baseline is never windowed.** The dashboard's 3/6/12/all selector chooses which anomalies are _reported_, never the history they are measured against — `loadAnomalies` reads the whole store on purpose. A three-month baseline would call an ordinary quarter unusual, and "usual" would change every time the reader touched a control.
- **Outlier statistics must be robust.** Median and MAD, never mean and σ: the single large payment being searched for is exactly the value that drags a mean toward itself and inflates σ, so a mean-based test hides what it was built to find. MAD of zero is a normal case (a fixed monthly recharge), not an error — it falls back to a multiple of the median.
- **A multiple is not a finding.** Any "N× your usual" claim needs an absolute floor beneath it, or a ₹60 coffee against a ₹15 median is reported as four times normal. It also needs a minimum sample size, below which the honest output is nothing at all.
- **One definition of spend, exported.** `isSpendRow` in `aggregate.ts` is the single answer to "is this spending?" — a second copy is how the category breakdown and any other spend figure quietly start disagreeing about the same rupees.
- **A panel that is always on screen saying everything is fine is a panel nobody reads.** Standing caveats live behind one indicator; findings-style panels render nothing when there is nothing to report, and their presence is the signal.

---

## Next steps

Two candidates. Neither depends on the other; pick by value.

### A. More bank parsers

HDFC, SBI, Kotak — what makes the app usable by anyone not banking with Axis or ICICI. Largest single chunk, and fully independent of everything else.
⚠️ **Blocked on real statements.** Both existing parsers were built against real PDFs and verified by eye; synthetic fixtures alone would not prove a parser works. `fixtures/private/` holds one Axis and one ICICI PDF — i.e. only the two banks already covered. Needs sample statements before it can start.

### B. CSV ingestion

Promoted out of the deferred table, where it sat blocked on nothing. It is the one path that routes **around** Track A's blocker: a user of any bank that exports CSV stops needing a bespoke PDF parser.

Bigger than the deferred table implied, and the reasons are worth knowing before starting:

- `StatementDocument` is a **positional PDF IR** (x/y per word, because bank tables are defined by column position). A CSV carries no such thing, so `ParserRegistry` cannot be the dispatch point — format detection has to happen ahead of it, in `parseStatement`.
- The **reconciliation gate has nothing to check.** `opening + credits − debits === closing` is the guarantee the whole ingestion layer rests on, and most CSV exports carry neither opening nor closing balance. Either the gate learns a second, weaker mode (running-balance continuity where a balance column exists) or CSV imports land somewhere honest that is not `parsed`. **This is the decision to make first** — it governs everything else.
- Column mapping varies per bank, so the confidence-scored parser-per-bank shape probably still applies, just over rows instead of positioned words.

Formerly Track B, anomaly detection, shipped as item 9 above.

---

## Deferred, with the reason

| Item                                                            | Blocked on                                                                                        |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Budgets & Goals**                                             | Persistence. Budget limits, goal targets and progress are meaningless if they vanish on reload.   |
| **Persistent rules and overrides**                              | Persistence. They work today, for the session only.                                               |
| **Persistent lifetime rule match counts** ("matched 142 times") | Persistence. The session UI previews current-history reach, but cannot retain lifetime history.   |
| **V2 storage adapter** (SQLite/WASM over OPFS)                  | Nothing — it is a choice not yet made. The `Store` seam is async-ready, so the swap is contained. |
| **Custom user-defined labels**                                  | Persistence. A label that cannot outlive the session is not one anyone would invest in creating.  |
| **Account behaviour analysis, investment habits, goal setting** | Persistence. Previously specced as features 4 and 5; product content is in the planning doc.      |
| **Real net worth** — investments, FD, EPF, NPS, manual assets   | `Instrument`, `Holding` and `Snapshot` do not exist yet. Bank accounts only today.                |
| ~~**CSV ingestion**~~                                           | Nothing — promoted to Next steps B above.                                                         |
| **Scanned-PDF OCR**                                             | Out of scope by choice. Detected and reported honestly instead.                                   |

## Known gaps in the code

- `CONFIDENCE_THRESHOLD` is currently unreachable — every confidence the classifier emits sits above it. Kept as the contract for a future strategy that scores lower; the confidence _bands_ carry the uncertainty in the meantime.
- ICICI consolidated statements import the savings ledger only and flag the rest, so **every ICICI import lands as `needs_review`**.
- No end-to-end tests. Playwright is named in the stack, `npm run test:e2e` exists as a script, and `@playwright/test` is **not a dependency** — there is no config and no spec directory either.
- Component coverage is still partial — aggregation visibility, categorization controls/rules, disclosures, the anomaly panel, and the batch import hook are tested; page-level interactions and most import components are not.
- `AnomalyPanel` reports findings but does not link into them. Clicking a row should open the transaction the way the category and month drill-downs already do.
- The anomaly unit is one transaction, not one day's total. A day-level baseline ("four times your usual shopping _day_") is an addition to `anomalies.ts`, not a rewrite of it — the per-transaction unit was chosen because every other surface points at a row the reader can open and check.
