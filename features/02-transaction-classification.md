# Feature 2: Transaction Classification

## Overview
Label every imported transaction so that aggregation, budgeting, and behavior analysis have meaningful categories to work with. Classification is a blend of automatic (predefined labels), custom (user-defined labels), and hybrid (system-suggested labels learned from both).

## Goals
- Maximize auto-classification coverage out of the box.
- Let users create and apply their own labels effortlessly.
- Learn from user behavior to improve and suggest new labels over time.

## Functional Requirements

### 2.1 Auto Classification (predefined labels)
- Ship a predefined taxonomy of common labels, e.g.:
  - **Income**: Salary, Interest, Refund, Dividend
  - **Essentials**: Rent, Groceries, Utilities, Petrol/Fuel, EMI/Loan, Insurance
  - **Lifestyle**: Dining, Shopping, Entertainment, Travel, Subscriptions
  - **Money movement**: Self-transfer, Investment (SIP/MF/stocks), Credit card payment, ATM/Cash
  - **Other**: Fees & Charges, Unclassified
- Classification engine (layered, cheapest first):
  1. **Rule/keyword matching** on narration (merchant names, UPI handles, keywords like "SALARY", "NEFT-RENT").
  2. **Merchant dictionary** — normalized merchant → category mapping, grown over time.
  3. **ML/LLM fallback** for narrations the rules miss (post-MVP if needed).
- Every auto-classified transaction stores a confidence score and the rule/source that classified it.
- Anything below confidence threshold → `Unclassified` (never guess wildly; unclassified is honest).

### 2.2 Custom Classification (user labels)
- Users can create, rename, color/icon, and archive custom labels (e.g. "Kid's school", "Side business").
- Apply a label to a single transaction or bulk-apply to a filtered set.
- "Always label like this" option: applying a custom label can create a personal rule (e.g. narration contains "ZERODHA" → "Investments").
- User overrides always beat auto classification and are never silently reverted.

### 2.3 Hybrid Classification (intelligence)
- Learn from the combination of predefined + custom labels:
  - Detect clusters of similar unclassified transactions and **suggest** a new label ("You have 14 similar payments to 'XYZ TUITION' — create a label?").
  - Propagate a user's manual label to future matching transactions automatically (with a visible "auto-applied from your rule" tag).
  - Periodically suggest merging/splitting labels when user behavior indicates it.
- Suggestions are always accept/reject — the system proposes, the user disposes.
- Feedback loop: every accept/reject and manual re-label is training signal for the personal rules and the global merchant dictionary.

### 2.4 Metrics & Quality
- Track and display per import: % auto-classified, % user-classified, % unclassified.
- Target: ≥80% auto-classification coverage on supported banks at MVP; unclassified queue is easy to triage (sorted by amount/frequency).

## Acceptance Criteria
- [ ] Every transaction has exactly one primary label at all times (default `Unclassified`).
- [ ] User can create a custom label and bulk-apply it in ≤3 interactions.
- [ ] A manual label on a recurring merchant auto-applies to future imports of that merchant.
- [ ] Auto vs custom vs hybrid provenance is stored per transaction and visible on tap.
- [ ] User overrides persist across re-imports and re-classification runs.

## Edge Cases
- Same merchant, different intent (Amazon = shopping vs Amazon = business purchases).
- Self-transfers between the user's own accounts must not count as income/expense (critical for Feature 3 accuracy).
- Split transactions (one payment covering multiple categories) — likely post-MVP, but design the schema to allow it.
- Narrations that are pure reference numbers with no semantic content.

## Open Questions
- Single-label vs multi-label (tags) per transaction for MVP?
- Is the merchant dictionary global (shared across users, anonymized) or per-user only?
- LLM-based classification in MVP or rules-only first?

## Dependencies
- Feature 1 (needs persisted transactions).
- Feeds Features 3, 4, 5 — all downstream analytics depend on label quality.
