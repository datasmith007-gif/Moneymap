# Finance Management App — MVP Feature Specs

This folder contains the feature specifications for the core MVP, broken down from the initial rough feature list.

## Feature Index

| # | Feature | File | MVP Priority |
|---|---------|------|--------------|
| 1 | PDF Statement Parsing | [01-pdf-statement-parsing.md](01-pdf-statement-parsing.md) | P0 — foundational |
| 2 | Transaction Classification | [02-transaction-classification.md](02-transaction-classification.md) | P0 — foundational |
| 3 | Aggregation & Wealth Dashboard | [03-aggregation-dashboard.md](03-aggregation-dashboard.md) | P1 |
| 4 | Account Behavior Analysis & Budgeting | [04-account-behavior-analysis.md](04-account-behavior-analysis.md) | P1 |
| 5 | Investment Habits & Goal Setting | [05-investment-habits-goal-setting.md](05-investment-habits-goal-setting.md) | P2 |

## Dependency Flow

```
PDF Parsing ──► Persistent Transaction Store ──► Classification ──► Aggregation
                                                      │                  │
                                                      ▼                  ▼
                                            Behavior Analysis ◄── Budgeting
                                                      │
                                                      ▼
                                        Investment Habits & Goals
```

Parsing and classification are the data backbone — everything downstream (dashboards, budgets, insights) depends on their accuracy. Ship and harden 1 & 2 first.

## Cross-Cutting Concerns (apply to all features)

- **Data accuracy first**: every derived number (aggregates, budgets, trends) is only as good as parsed data. Data quality checks in Feature 1 gate everything else.
- **Privacy & security**: bank statements are highly sensitive. Encryption at rest, no raw statement PDFs retained longer than needed, password handling never logged.
- **Idempotency**: re-uploading the same statement must never duplicate transactions.
- **Auditability**: every transaction should be traceable back to its source file, page, and raw text line.
