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

**Right now it is a reference for _what the app must be able to do_, not for how it looks.** The UI design is being worked on separately and a final reference will be shared later. Until then: **no design-system port, no styling work, no new screens, no router or nav.** Build the headless capability those screens will need, so the UI drops onto finished, tested logic.

Two things the prototype gets wrong, worth remembering when the design does land:

1. **It has no visual language for failure** — no slot for a statement whose arithmetic does not reconcile, a partially covered month, or an unreadable PDF. Our reconciliation gate, `needs_review` outcome, coverage model and caveat list are real product value with nowhere to go in the mock. Do not delete honesty machinery to match it.
2. **It implies unscoped features** — "94% sorted itself out" (classification rate), "four times your usual shopping day" (anomaly detection), "March 2027" (goal pace projection).

It also shows five banks (HDFC, ICICI, SBI, Axis, Kotak). We parse two.

---

## Where we are

| Layer             | State                                                                                                                                                                              |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/ingestion/`  | Positional pdf.js extraction, Axis + ICICI parsers, confidence registry, five-outcome union, reconciliation gate proving `opening + credits − debits === closing` in integer paise |
| `src/model/`      | `Paise`, `Account`, `Transaction`, `ParsedStatement`, provenance on every row, month **and day** arithmetic with no `Date` object anywhere                                         |
| `src/enrichment/` | `classify()` over rules → merchant knowledge → transfer pairing; confidence bands; rule dry-run; per-import stats                                                                  |
| `src/storage/`    | `Store` interface + in-memory adapter, holding two record classes — derived-from-source and user-authored                                                                          |
| `src/engine/`     | Dashboard aggregation, review queue, enriched transaction query + deterministic CSV export, and per-account coverage gaps                                                          |
| UI                | Import-first shell and Dashboard; explicit light/dark mode, blurred dashboard entry backdrop, exact tables/KPIs, categorization review, manual choices, and session rule authoring |
| Tests             | **307 passing, 2 skipped.** The 2 are integration tests gated on real private PDFs and never run in CI.                                                                            |

### Shipped, in order

1. **Enrichment layer** — classification, transfer detection, counterparty extraction. Retired the standing caveat that told the user every income and spend figure was wrong by an unknown amount.
2. **Batch statement import** — many files per drop, sequential writes, parked passwords, bulk include.
3. **Classification completion** — review queue, rule dry-run preview, confidence bands, per-import stats.
4. **Transactions and accounts foundation** — enriched free-text/category query with deterministic paging, audit-friendly CSV export, and exact per-account statement gaps.
5. **Aggregation visibility** — exposed category shares, classification coverage, savings rate, variation, account lag/gaps, and monthly net inside the existing Dashboard. Exact tables and KPIs reuse the provisional UI without introducing another screen or visual system before the final design lands.
6. **Interactive categorization** — exposed classification source on enriched transaction rows, added a collapsible and paged frequency-first label queue with occurrence/total ordering, inline repeated-label transaction drill-downs, exact-row fallback, and bulk or individual manual choices, preview-before-save personal rules, honest count/amount coverage, and single-open category transaction drill-downs. All writes are serialized, retroactive, and session-scoped; every dashboard figure refreshes after a change.
7. **Import-first application shell** — replaced tab navigation with an explicit Import → Dashboard handoff and a small Dashboard → Import action, kept the live dashboard inert behind the import surface, and added a local-only light/dark preference. View changes never clear imported or user-authored session data.

---

## Decisions locked

| Decision              | Choice                             | Consequence                                                                    |
| --------------------- | ---------------------------------- | ------------------------------------------------------------------------------ |
| Classification method | Rules + merchant knowledge only    | No model, no LLM. Deterministic and fully testable.                            |
| Persistence           | **Stays in-memory**                | Budgets & Goals are out of scope; rules and overrides do not survive a reload. |
| Design fidelity       | Broadsheet + a derived dark ground | Deferred until the final UI reference arrives.                                 |
| Rule scope            | Always retroactive                 | See constraints below.                                                         |

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

---

## Next steps

Two independent tracks. Neither depends on the other; pick by value.

### A. More bank parsers

HDFC, SBI, Kotak — what makes the app usable by anyone not banking with Axis or ICICI. Largest single chunk, and fully independent of everything else.
⚠️ **Blocked on real statements.** Both existing parsers were built against real PDFs and verified by eye; synthetic fixtures alone would not prove a parser works. Needs sample statements before it can start.

### B. Anomaly detection

The "one purchase was four times your usual shopping day" insight, plus the per-category baselines it needs. Small, self-contained, deterministic — but a Dashboard garnish rather than something a screen depends on.

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
| **CSV ingestion**                                               | Nothing. Named in the stack, never built; every parser is PDF-only.                               |
| **Scanned-PDF OCR**                                             | Out of scope by choice. Detected and reported honestly instead.                                   |

## Known gaps in the code

- `CONFIDENCE_THRESHOLD` is currently unreachable — every confidence the classifier emits sits above it. Kept as the contract for a future strategy that scores lower; the confidence _bands_ carry the uncertainty in the meantime.
- ICICI consolidated statements import the savings ledger only and flag the rest, so **every ICICI import lands as `needs_review`**.
- No end-to-end tests. Playwright is named in the stack and is not installed.
- Component coverage is still partial — aggregation visibility, categorization controls/rules, and the batch import hook are tested; page-level interactions and most import components are not.
