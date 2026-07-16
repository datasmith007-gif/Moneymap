# CLAUDE.md

Guidance for Claude Code working in this repository. **Project-level guidelines only** — stack, commands, structure, and cross-cutting engineering conventions.

Anything about *what* we're building — features, the data model, scope, version split, per-feature rules — lives in the planning docs, **not here**. Do not add feature or product-design detail to this file; put it in the planning docs and link if needed.

## Source of truth

| For… | Go to |
|------|-------|
| Product vision, architecture, canonical data model, version split, per-feature design | [Personal Finance Organiser — Planning Document](https://app.notion.com/p/39a65a498a9780b0aa18d166368c8d2b) |
| Milestones, sequencing, blocking decisions | [Project Planner](https://app.notion.com/p/39e65a498a9781b4b9eaf23bfe2f401d) |
| Feature specs | `features/` |

When this file and a planning doc disagree, **the planning doc wins** and this file is the bug.

## The project in one line

A local-first, privacy-first net-worth organiser for India. All parsing, valuation, and computation happen on the user's device; **no server ever reads user data.**

## Non-negotiable engineering constraints

These govern all code, regardless of feature. Breaking one is a design error, not a trade-off:

- **Local-first, no server reads user data.** No backend database, no server-side processing of financial content. If a design pushes user data to a server, it is the wrong design — stop and reconsider.
- **Deterministic where money is involved.** Any figure with financial or tax consequence comes from explicit, testable logic — never improvised by an LLM.
- **Talk to the storage-adapter interface, never a concrete store.** This seam is what keeps versions additive instead of rewrites. (Interface design lives in planning doc §5.1.)
- **Never log or persist secrets or raw financial data.** Decrypt protected PDFs in memory only; store masked identifiers only; keep raw financial content out of logs, telemetry, and crash reports.
- **Never delete source data; store user overrides separately** so a re-import never loses manual edits.

## Stack

- **Language**: TypeScript (strict)
- **UI**: React 18+ with Vite
- **In-browser parsing**: pdf.js (PDF, in-memory decryption for protected files), a client-side CSV parser
- **Storage**: in-memory adapter (V1) / WASM SQLite over OPFS (V2), behind the storage-adapter interface
- **Charts**: Recharts
- **Tests**: Vitest + React Testing Library; Playwright (end-to-end)
- **Lint/format**: ESLint + Prettier; `tsc --noEmit` for type checking

There is no backend, server database, or task queue by design.

## Commands

```bash
npm install              # install
npm run dev              # Vite dev server (HMR)
npm run typecheck        # tsc --noEmit
npm run lint             # eslint
npm run format           # prettier --write
npm test                 # vitest (all); append a name to scope, e.g. npm test parsers
npm run test:coverage    # coverage
npm run test:e2e         # Playwright
npm run build            # production build
```

## Project structure (once initialized)

```
moneymap/
├── src/
│   ├── ingestion/    # File intake, in-memory decryption, format detection, parsers
│   ├── model/        # Canonical data model (design lives in planning doc §6)
│   ├── enrichment/   # Classification, dedup, internal-transfer detection, valuation
│   ├── engine/       # Deterministic net-worth + snapshot engine
│   ├── storage/      # Storage-adapter interface + concrete adapters
│   ├── components/   # Reusable UI
│   ├── pages/        # Views
│   └── hooks/        # State + data access
├── tests/
├── features/         # Feature specs
├── index.html
└── package.json
```

## Working conventions

- **Design decisions must use the `software-design-philosophy` skill** (`.agents/skills/software-design-philosophy/`). Apply it whenever designing a module or interface, judging whether an abstraction earns its place, or making an architectural call — then record the decision **and its reasoning in the planning docs**, not in this file.
- **Before building any chart or visualization, read the `/dataviz` skill.**
- **Strategic over tactical.** Invest the extra ~10–20% to leave structure better than you found it; match the conventions of surrounding code.
