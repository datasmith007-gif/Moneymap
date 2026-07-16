# Feature 5: Investment Habits & Goal Setting

**Version: V2.** Goals, streaks, and long-horizon trends need data that outlives the session — requires a persistent adapter, same store interface as everything else.

## Module Promise
> Every nudge is an observation computed from the user's own stored data, is dismissible, and never crosses into financial advice or product recommendations.

## Overview
Nudge users from passive tracking to active wealth-building: surface idle money, flag opportunities to save or invest based on budget headroom, and track trends against the budgets they've set.

## Goals
- Detect funds sitting idle that could be working harder.
- Turn budget discipline (Feature 4) into concrete save/invest moments.
- Show long-term trends so users see their habits improving (or slipping).

## Functional Requirements

### 5.1 Idle Funds Indicator
- Detect persistently high liquid balances: e.g. account balance stays above X for N consecutive weeks beyond the user's typical monthly outflow needs.
- Compute a suggested "safe buffer" (e.g. 1.5–2× average monthly spend from Feature 3) and flag the surplus above it as *idle*.
- Present neutrally: "₹85k has been idle in HDFC Savings for 6+ weeks beyond your usual buffer" — informational, not financial advice. Include a disclaimer that this is an observation from their data, not investment advice.

### 5.2 Opportunity Marking (save/invest moments)
- When Feature 4 shows the user is under budget with headroom at mid/end of month → surface an opportunity card: "You're ₹6k under budget this month — a good moment to move it to savings/investments."
- When a recurring investment (SIP) hasn't grown while income has → note the gap ("salary up 12% over the year, SIP unchanged").
- All opportunities are suggestions the user can act on outside the app (MVP does not execute transactions); user can dismiss or snooze, and dismissals teach the system to quiet down.

### 5.3 Goal Setting
- Users define simple goals: target amount + optional target date + optional linked category (e.g. "Emergency fund ₹3L by Dec 2026").
- Progress computed from labeled inflows to savings/investment categories or a designated account.
- Goal status: on track / behind / ahead, with required monthly contribution to stay on track.

### 5.4 Trend Analysis on Budget
- Long-horizon views (6–24 months):
  - Savings rate trend (savings ÷ income per month).
  - Budget adherence trend (% of months each budget was met).
  - Invested-amount trend (from Feature 3's investment contributions).
- Habit streaks: consecutive months under budget / consecutive months SIP maintained.

## Acceptance Criteria
- [ ] Idle funds indicator triggers only after a stable pattern (no single-week false positives) and never presents itself as investment advice.
- [ ] Opportunity cards appear only when backed by actual budget headroom data.
- [ ] A goal can be created in ≤1 minute and shows correct progress from labeled transactions.
- [ ] Trend charts render with graceful empty/insufficient-data states.
- [ ] Every nudge is dismissible, and dismissed nudge types reduce in frequency.

## Edge Cases
- Idle-looking balance that is actually earmarked (upcoming tuition/tax payment) — allow the user to mark funds as "reserved".
- Users who move money to investment platforms not visible in bank statements (only the outflow is visible).
- Goal contributions that are later withdrawn.
- Irregular-income users: buffer and idle thresholds must adapt to income volatility.

## Compliance & Tone Note
This feature borders on financial guidance. Keep all copy observational ("your data shows…") rather than prescriptive ("you should invest in…"). Never recommend specific financial products in MVP. Check local regulatory requirements (e.g. investment-advice regulations) before any product-specific suggestions.

## Open Questions
- Is goal setting in MVP scope or fast-follow? (It's the most self-contained cut if scope pressure hits.)
- Should "reserved funds" marking ship with idle-funds detection (recommended — kills the biggest false-positive)?
- Notification strategy shared with Feature 4?

## Dependencies
- Feature 3 (balances, averages, investment contributions) and Feature 4 (budget headroom, recurring detection).
