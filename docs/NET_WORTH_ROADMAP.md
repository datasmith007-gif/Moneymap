# Net Worth and Deeper Analytics Roadmap

**Status:** Deferred for future implementation.

## Summary

Evolve MoneyMap along two coordinated tracks:

1. **Financial health** from existing bank transactions.
2. **Net worth** from dated asset and liability valuations.

Persistence is the shared prerequisite. The first milestone will deliver persistent data, core financial-health indicators, manual/CSV position entry, and a real net-worth view. Budgets, goals, scenarios, and investment returns follow in later phases.

All analytics remain local-first, explainable, INR-denominated, and centered on one individual.

## Implementation Roadmap

### Phase 1 — Persistent health and net-worth foundation

This is the first shippable milestone.

- Implement the persistent SQLite/WASM-over-OPFS store behind the existing async `Store` seam. Retain `MemoryStore` for tests and as an explicitly labelled session-only fallback.
- Persist imported statements, categorization overrides, personal rules, planning traits, positions, and valuation history.
- Keep source records and user-authored records separate. Store no uploaded file bytes.
- Add editable transaction traits independent of category:
  - `essential | discretionary | unknown`
  - `fixed | variable | unknown`
- Centralize default traits:
  - Essentials default to essential.
  - Lifestyle defaults to discretionary.
  - Rent, EMI, insurance, and subscriptions default to fixed.
  - Money movement and ambiguous categories remain unknown.
  - User overrides always take precedence.

Add explainable financial-health analytics:

- Monthly savings amount and savings rate.
- Rolling 3-, 6-, and 12-month trends using fully covered months.
- Essential versus discretionary spending.
- Fixed versus variable spending and classification coverage.
- Income stability and spending volatility using median and median absolute deviation.
- Liquidity runway: liquid balance divided by median monthly essential spending.
- Category and counterparty contributions to month-over-month changes.
- Recurring commitment detection.
- Data confidence based on statement coverage, categorization amount coverage, trait coverage, and freshness.

Recurring detection will:

- Require at least three matching transactions.
- Group by normalized counterparty, direction, category, and account.
- Recognize weekly, monthly, quarterly, and annual cadence ranges.
- Report observed cadence, median amount, amount range, evidence transactions, and confidence.
- Never create a rule, budget, or future transaction automatically.

Add the Accounts/Net Worth workspace:

- Manual position and valuation entry.
- Generic CSV preview and all-or-nothing import.
- Total assets, total liabilities, and net worth.
- Historical net-worth chart.
- Allocation by asset class.
- Liquid versus illiquid assets.
- Position-level freshness and missing-value warnings.
- Net-worth change split into known contributions/withdrawals and unexplained valuation change where links exist.

Bank closing balances supply cash-account values. Investments and other assets use the latest valuation on or before the report date. Values are never interpolated, and stale values remain visibly marked.

### Phase 2 — Budgets, goals, debts, and scenarios

Add the focused Budgets workspace while keeping the Dashboard a concise briefing.

- Support user-owned monthly overall and category budgets.
- Suggest—but never automatically apply—starting limits using the median of the latest three fully covered months.
- Calculate usage and projected month-end position as of the latest imported date, not the current clock date.
- Show on-track, at-risk, and over-budget states with contributing transactions.
- Add emergency-fund targets measured in months of essential spending.
- Add goals with target amount, target date, linked positions, current progress, and required monthly contribution.
- Add reserved-funds earmarks so known obligations are excluded from idle-cash observations.
- Extend liability positions with interest rate, EMI, remaining term, and optional repayment schedule.
- Add debt-service ratio, payoff projection, and interest-cost scenarios.
- Add deterministic scenarios with editable income growth, spending inflation, contribution, return, and debt-rate assumptions.
- Label every result as a scenario rather than a prediction.

### Phase 3 — Investment performance

Activate performance analytics only where valuations and confirmed cash flows are sufficiently complete.

- Suggest links between categorized investment/loan transactions and positions using amount, date, direction, and counterparty; require user confirmation.
- Preserve unlinked movements visibly and never infer a holding or outstanding loan balance from a bank transaction alone.
- Calculate XIRR using confirmed contributions, withdrawals, and a dated terminal valuation.
- Show contribution rate, invested-amount trend, value change, and contribution-versus-growth decomposition.
- Add target allocation and allocation-drift views.
- Detect potentially idle liquid balances only after accounting for essential-spend runway, reserved funds, goals, and recurring commitments.
- Keep observations neutral and avoid product or security recommendations.

Time-weighted returns, trade-level realized gains, tax-lot accounting, live prices, tax advice, and automatic account connections remain deferred.

## Public Contracts and Data Rules

Add balance-sheet contracts alongside the canonical bank records:

- `Instrument`: identity, name, type, asset class, institution, and optional external identifier.
- `Holding`: relationship between an account and instrument, with optional units and cost basis.
- `ValuationSnapshot`: target position, non-negative paise value, as-of date, source, and import provenance.
- `PositionCashFlowLink`: transaction, position, linked amount, contribution/withdrawal/loan movement kind, and confirmation metadata.
- `TransactionPlanningTraits`: need, variability, and whether each value came from a default or user override.
- `FinancialHealthReport`: metrics, trend series, recurring commitments, coverage, freshness, and caveats.
- `NetWorthReport`: dated assets, liabilities, allocation, liquidity, net worth, freshness, and missing-position caveats.
- Later phases add `Budget`, `Goal`, `LiabilityTerms`, and `ScenarioAssumptions`.

The generic valuation CSV will support account-level or holding-level rows with:

- Required: record type, as-of date, stable account key, account name/type, liability flag, and exact INR value.
- Holding rows additionally require a stable instrument key, instrument name, and asset class.
- Optional: institution, last four digits, units, unit price, and cost basis.
- Account-total and holding-detail values cannot be mixed for the same account and date.
- Identical imports are idempotent. Conflicting values for the same target/date require explicit replacement confirmation.
- Money remains integer paise internally; units and rates use explicit decimal types rather than floating-point money.

## UI Ownership

- **Dashboard:** financial briefing, headline health indicators, net worth, important changes, and links to detailed workspaces.
- **Accounts:** accounts, assets, liabilities, holdings, valuations, allocation, freshness, and later investment performance.
- **Budgets:** budgets, goals, recurring commitments, debt planning, and scenarios.
- **Transactions and Review:** transaction traits, proposed position links, categorization, and supporting evidence.

Every headline metric must drill down to its contributing periods, positions, or transactions.

## Test Plan

- Persistence across reloads, schema upgrades, idempotent imports, clearing, and session-only fallback.
- Savings-rate, runway, stability, volatility, trait coverage, refunds, transfers, and incomplete-month handling.
- Recurring cadence detection, irregular amounts, false-positive prevention, and evidence output.
- Manual and CSV valuation validation, previews, duplicates, conflicts, liabilities, and exact paise conversion.
- Point-in-time net worth, stale values, missing positions, allocation, historical snapshots, and double-count prevention.
- Suggested transaction links, confirmation, unlinking, partial amounts, and unlinked-flow visibility.
- Budget suggestions, progress as of imported coverage, relabeling effects, overspend evidence, and irregular income.
- Goal progress, deterministic scenario repeatability, debt schedules, and insufficient-data states.
- XIRR contribution signs, terminal valuation, multiple cash flows, numerical failure states, and incomplete-link warnings.
- Accessibility and responsive checks for the Dashboard, Accounts, and Budgets workspaces.
- Retain all existing transaction, classification, transfer, aggregation, anomaly, import, and Review regressions.

## Assumptions

- The model represents one individual, not a household.
- INR remains the only currency initially.
- Valuations are user-supplied through manual entry or CSV; no live market-price dependency.
- Net worth is never inferred from investment transfers alone.
- Money lent and borrowed become receivable/liability positions only after explicit user confirmation.
- Health is presented as separate explainable indicators, not a composite score.
- Insufficient, stale, or poorly categorized data produces a caveat or unavailable state rather than a confident estimate.
- The main roadmap is updated after each phase with shipped contracts, test counts, and remaining data-quality limitations.
