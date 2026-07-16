# Feature 4: Account Behavior Analysis (Budgeting & Spend Patterns)

**Version: V2.** Budgets, learned patterns, and personal inflation only make sense when data outlives a session — this feature requires a persistent adapter. Nothing in it talks to storage directly; it reads the same store as everything else.

## Module Promise
> Budget status is always computed from stored transactions and clearly stamped "as of" the latest import — the module never implies real-time freshness it doesn't have. Overspend explanations always point to the specific transactions responsible.

## Overview
Turn historical transaction data into forward-looking guidance: budgets with on-track indicators and overspend warnings, plus pattern detection that groups spends and predicts what's coming.

## Goals
- Let users set budgets that the app actively monitors, not just record.
- Pinpoint *which transactions* caused an overspend, not just that it happened.
- Detect recurring patterns and predict upcoming spends, including personal inflation.

## Functional Requirements

### 4.1 Budget Creator
- Create budgets at two levels:
  - **Overall** monthly spend budget.
  - **Per-category** budgets (Groceries ₹12k/month, Dining ₹5k/month, …) using auto + custom labels.
- Budget periods: daily / weekly / monthly (weekly and monthly are the MVP core; daily derived as pace).
- Smart defaults: suggest starting budgets from the user's last 3-month category averages (from Feature 3).

### 4.2 On-Track Indicator
- Pace-based status per budget: e.g. "Day 14 of 30 — you've used 43% of your Dining budget → On track".
- States: **On track / At risk / Over budget**, with simple visual (progress bar + color).
- At-risk logic: projected month-end spend (current pace × remaining days) exceeds budget.

### 4.3 Overspend Warnings & Root Cause
- Notification/alert when a budget crosses configurable thresholds (e.g. 80%, 100%).
- "Why did I overspend?" view: ranked list of the transactions that pushed the category over — largest and most anomalous first (vs that category's historical norm).
- Distinguish one-off spikes (annual insurance premium) from behavioral drift (dining out 2× more each week).

### 4.4 Spend Pattern Detection
- Recurring transaction detection: same merchant/label at regular cadence and similar amount → mark as recurring (rent, SIP, subscriptions, EMI).
- Predict upcoming spends: calendar of expected recurring debits with expected amount and date window.
- **Custom inflation**: track how the user's own recurring costs trend over time (e.g. "your monthly grocery spend has grown ~9% year-over-year") — the user's personal inflation rate, overall and per category.
- Group analysis by label: weekday vs weekend spend, salary-day spikes, month-start vs month-end behavior.

## Acceptance Criteria
- [ ] User can create an overall and at least one category budget in ≤1 minute.
- [ ] On-track status updates whenever new statements are imported.
- [ ] Overspend view shows the specific contributing transactions, ranked.
- [ ] Recurring transactions are auto-detected with ≥90% precision on obvious cases (rent, SIPs, subscriptions).
- [ ] Personal inflation figure is shown when ≥12 months of data exists for a category (graceful "not enough data" state otherwise).

## Edge Cases
- Statement-based data lags real time — budgets are only as fresh as the last import; UI must show "as of" clearly and prompt re-import.
- Users with irregular income (freelancers) — pace logic anchored to spend, not salary date.
- Category re-labeling after the fact must retroactively recompute budget usage.
- Refunds landing in a later month than the original spend.

## Open Questions
- In-app indicators only, or also browser-local notifications? (Server push is off the table — there is no backend in V1/V2, and data freshness depends on manual uploads anyway.)
- Rollover budgets (unused budget carries to next month) — MVP or later?
- Minimum data history before predictions activate (suggest: 2–3 months)?

## Dependencies
- Feature 2 (label quality drives budget accuracy), Feature 3 (baselines/averages).
- Feeds Feature 5 (budget headroom informs investment opportunities).
