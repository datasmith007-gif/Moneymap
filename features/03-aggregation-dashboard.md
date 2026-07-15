# Feature 3: Aggregation of Account Statement Figures

## Overview
Combine data across all of a user's imported accounts into a single financial picture: overall wealth, monthly averages, investment vs liquid split, and money-flow visualizations.

## Goals
- One dashboard answering "how am I doing overall?" across all accounts.
- Accurate cross-account math (self-transfers excluded, currencies handled).
- Visual, glanceable charts rather than raw tables.

## Functional Requirements

### 3.1 Overall Wealth Numbers
- Net position = sum of latest closing balances across all linked accounts.
- Per-account breakdown with "as of" date (statement freshness matters — show staleness clearly, e.g. "last updated from statement ending 31 May").
- Handle gaps: if an account's data is 3 months stale, flag it rather than presenting a misleading total.

### 3.2 Monthly Averages (all accounts combined)
- Average monthly income, average monthly spend, average monthly savings (income − spend).
- Rolling windows: last 3 / 6 / 12 months, selectable.
- Exclude self-transfers and reversals from both sides (depends on Feature 2 labels).
- Show variance, not just the mean (a ₹40k average hides a ₹10k–₹90k swing).

### 3.3 Investment vs Liquid Asset Breakdown
- Classify outflows/holdings into buckets:
  - **Liquid**: savings/current account balances
  - **Invested**: SIP/mutual fund/stock/FD outflows detected via classification
- MVP scope note: from bank statements alone we see investment *contributions*, not market value. Show "amount invested (from statements)" and be explicit it is not portfolio value. Portfolio integration is post-MVP.
- Ratio visualization (e.g. donut: liquid vs invested contributions).

### 3.4 Money Flow (incoming vs outgoing)
- Monthly bar/line chart: total inflow vs total outflow per month.
- Category-level flow: top spend categories per month (stacked bars or Sankey inflow → categories).
- Drill-down: tap a month/category → underlying transaction list.
- Cash-flow trend line: cumulative savings over time.

## Acceptance Criteria
- [ ] Dashboard totals reconcile exactly with the sum of per-account statement balances.
- [ ] Self-transfers between the user's own accounts do not inflate income or spend.
- [ ] Every chart supports drill-down to the transactions behind the number.
- [ ] Stale-data indicators appear when any account's latest statement is older than the selected window.
- [ ] Monthly averages update automatically when a new statement is imported.

## Edge Cases
- Overlapping statement uploads (must not double-count — relies on Feature 1 dedup).
- Partial months at the edges of the data range (exclude or clearly mark partial months in averages).
- Joint accounts appearing in two users' data (post-MVP).
- Credit card statements (spend without a bank balance) if/when supported.

## Open Questions
- Do we include credit card statements in MVP or bank accounts only?
- Charting library / rendering approach (native charts vs web view)?
- Default time window on the dashboard (last 6 months?)

## Dependencies
- Feature 1 (accurate balances & transactions), Feature 2 (labels, especially self-transfer detection).
- Feeds Feature 4 (budgets use these aggregates as baselines).
