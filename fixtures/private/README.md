# Private sample statements

Drop **real** bank statement PDFs here to build and test parsers against.

**Nothing in this folder is committed** (see `.gitignore`) except this README.
That is by design — real financial data must never enter git, logs, or telemetry.

- Password-protected PDFs are fine; the password is supplied at parse time and used
  in memory only, never written down here or anywhere else.
- Suggested naming: `axis-2026-01.pdf`, `icici-2026-01.pdf` — bank + period.
- If you ever need a shareable fixture, use a **synthetic/redacted** statement and
  put it under a tracked `fixtures/` path instead, never here.
