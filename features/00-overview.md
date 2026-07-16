# Finance Management App — MVP Feature Specs

This folder contains the feature specifications for the core MVP, broken down from the initial rough feature list.

These specs cover the bank-statement slice of the full product vision (see the Personal Finance Organiser planning doc in Notion for the net-worth scope: CAS/demat, FD, EPF/NPS, manual assets). The canonical schema is general enough to grow into that scope; the implementation here is bank-only.

## Feature Index

| # | Feature | File | MVP Priority | Version |
|---|---------|------|--------------|---------|
| 1 | PDF Statement Parsing | [01-pdf-statement-parsing.md](01-pdf-statement-parsing.md) | P0 — foundational | V1 |
| 2 | Transaction Classification | [02-transaction-classification.md](02-transaction-classification.md) | P0 — foundational | V1 (learned personal rules: V2) |
| 3 | Aggregation & Wealth Dashboard | [03-aggregation-dashboard.md](03-aggregation-dashboard.md) | P1 | V1 (history across sessions: V2) |
| 4 | Account Behavior Analysis & Budgeting | [04-account-behavior-analysis.md](04-account-behavior-analysis.md) | P1 | V2 — needs persisted history |
| 5 | Investment Habits & Goal Setting | [05-investment-habits-goal-setting.md](05-investment-habits-goal-setting.md) | P2 | V2 — needs persisted history |

V1 = in-memory store, nothing persists past the session. V2 = local persistence on the user's device. Same features, different storage adapter (below).

## Storage Adapter (the seam everything depends on)

All features read and write through one **Store interface** over the canonical data model (Account, Instrument, Holding, Transaction, Snapshot — see planning doc §6). No feature may assume where or whether data is persisted; that decision lives inside the adapter and nowhere else.

- **V1 adapter**: in-memory. Data lives for the session only.
- **V2 adapter**: local SQLite (WASM + OPFS) on the user's device, with `.sqlite` export/import.
- No adapter ever sends user data to a server.

Consequence: a feature is "V2" only because it needs data that outlives a session (history, budgets, learned rules) — not because it talks to storage differently.

## Dependency Flow

```
PDF Parsing ──► Canonical Store (via adapter) ──► Classification ──► Aggregation
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
- **Privacy & security**: bank statements are highly sensitive. All parsing and computation happens on the user's device; encryption at rest is a concern of persistent adapters only; no raw statement PDFs retained longer than needed; password handling never logged.
- **Idempotency**: re-uploading the same statement must never duplicate transactions.
- **Auditability**: every transaction should be traceable back to its source file, page, and raw text line.
