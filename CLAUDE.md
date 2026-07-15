# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack & Setup

**Python Web App** for a personal finance management platform that parses bank statements, classifies transactions, and provides financial insights.

### Recommended Stack
- **Backend**: Python 3.10+ with FastAPI (async-first, type-safe, auto-docs)
- **Database**: PostgreSQL (transactional integrity, jsonb support for flexible schemas)
- **ORM**: SQLAlchemy 2.0+ (async support, type hints)
- **PDF Parsing**: pdfplumber + pypdf2
- **Task Queue**: Celery + Redis (async PDF parsing/classification jobs)
- **Frontend**: React 18+ with TypeScript (interactive dashboards)
- **Charts**: Recharts or Plotly (see `/dataviz` skill before building visualizations)
- **Classification**: scikit-learn for ML/NLP on transaction narrations
- **Testing**: pytest + pytest-asyncio

### Project Structure (once initialized)
```
moneymap/
├── backend/                 # FastAPI app
│   ├── app/
│   │   ├── main.py         # FastAPI entry point
│   │   ├── models/         # SQLAlchemy ORM models (accounts, transactions, etc.)
│   │   ├── schemas/        # Pydantic request/response schemas
│   │   ├── services/       # Business logic (parsing, classification, aggregation)
│   │   │   ├── pdf_parser.py        # Feature 1: PDF extraction
│   │   │   ├── classifier.py        # Feature 2: Transaction classification
│   │   │   ├── aggregator.py        # Feature 3: Dashboard data
│   │   │   └── analyzer.py          # Feature 4-5: Budgeting & trends
│   │   ├── api/            # Route handlers
│   │   └── tasks/          # Celery tasks (PDF parsing in background)
│   ├── tests/
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/               # React + TypeScript
│   ├── src/
│   │   ├── pages/         # Dashboard, Budgets, Goals views
│   │   ├── components/    # Reusable UI components
│   │   └── hooks/         # API calls, state management
│   └── package.json
├── features/              # Feature specs (already present)
├── docker-compose.yml     # Dev environment (PostgreSQL, Redis)
└── CLAUDE.md             # This file
```

## Development Commands

### Initial Setup
```bash
# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install backend dependencies
cd backend
pip install -r requirements.txt

# Set up database
createdb moneymap_dev  # or use Docker Compose
alembic upgrade head

# Start Redis (for Celery)
redis-server

# Start FastAPI dev server (reloads on changes)
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# In another terminal, start Celery worker
celery -A app.tasks worker --loglevel=info
```

### Frontend
```bash
cd frontend
npm install
npm run dev   # Vite dev server with HMR
```

### Testing
```bash
# Run all tests
pytest

# Run tests for a single module (e.g., PDF parsing)
pytest tests/services/test_pdf_parser.py

# Run with coverage
pytest --cov=app tests/

# Watch mode (requires pytest-watch)
ptw
```

### Linting & Formatting
```bash
# Format code
black backend/app backend/tests

# Lint
ruff check backend/

# Type checking
mypy backend/app
```

### Database Migrations
```bash
# Create a new migration
alembic revision --autogenerate -m "description"

# Apply migrations
alembic upgrade head

# Rollback one migration
alembic downgrade -1
```

### Docker Development
```bash
# Start PostgreSQL + Redis in background
docker-compose up -d

# Tear down
docker-compose down
```

## Architecture & Data Flow

The app follows a **pipeline architecture** with data flowing unidirectionally:

```
Upload PDF
    ↓
[Feature 1] Parse Statement
    ├─ Auto-detect bank format
    ├─ Extract transactions, account metadata
    ├─ Validate (balance checks, date continuity)
    └─ Persist to DB (idempotent on re-upload)
    ↓
[Feature 2] Classify Transactions
    ├─ Rule/keyword matching (confidence-first)
    ├─ Learn custom labels from user behavior
    └─ Store classification provenance & confidence
    ↓
[Feature 3] Aggregation & Dashboard
    ├─ Sum balances across accounts
    ├─ Calculate monthly averages (exclude self-transfers)
    ├─ Break down liquid vs invested
    └─ Render money-flow charts & drill-down
    ↓
[Feature 4] Budgeting & Spend Analysis
    ├─ Auto-suggest budgets from historical averages
    ├─ Track pace (on-track / at-risk / over)
    ├─ Detect recurring transactions
    └─ Analyze root causes of overspends
    ↓
[Feature 5] Investment Goals & Trends
    ├─ Flag idle funds
    ├─ Surface save/invest opportunities
    ├─ Track goal progress
    └─ Show long-term trend lines
```

**Key architectural decisions:**
- **Async-first**: PDF parsing and classification are long-running; use Celery tasks so the API never blocks.
- **Immutability of source data**: Parsed transactions include provenance (source file, page, raw text). Never delete transactions; mark as "hidden" if duplicates are detected.
- **User overrides survive re-imports**: Classification and labels are stored separately from the transaction row, so re-parsing the same statement doesn't lose manual edits.
- **Data quality is the foundation**: Features 3–5 are only as good as the accuracy of Features 1–2. Validation gates everything.

## Priority & Scope

**MVP scope (Features 1–2 + 3 basic):**
- Multi-bank PDF parsers (start with 2–3 banks)
- Transaction classification (rules-based + custom labels)
- Basic wealth aggregation dashboard (balances, monthly trends)

**Post-MVP (Features 4–5, advanced features):**
- Budgeting & spend pattern detection
- Investment goals & idle-funds detection
- Portfolio integration (requires external APIs)

## Critical Implementation Notes

### Data Accuracy & Validation
- Every parsed transaction must store its source (statement file, line number, raw text).
- Balance reconciliation checks are non-negotiable — flag ambiguous data for manual review rather than silently persisting.
- Deduplication is critical: overlapping statement periods must not double-count transactions.

### Security & Privacy
- Bank statements are highly sensitive. Encrypt them at rest; never log raw PDFs or passwords.
- Password-protected PDFs: decrypt in-memory only; never persist or log passwords.
- Test with real anonymized statements early to catch parsing issues.

### Classification Quality
- MVP target: ≥80% auto-classification coverage on supported banks.
- Unclassified transactions must be easy to triage (show them sorted by amount/frequency).
- Every classification stores its source (rule ID, confidence, user override). This enables learning.

### Frontend Charting
- Use `/dataviz` skill before building charts. It ensures consistent light/dark theme, accessible colors, and responsive layouts.
- Charts must support drill-down to underlying transactions (tap a bar → see the transactions that make up that amount/time period).

## Testing Strategy

- **Unit tests** for parsers (mock PDFs with known content; validate extraction accuracy).
- **Integration tests** for the classification pipeline (real transactions with labeled outputs).
- **End-to-end tests** for the dashboard (upload a statement → verify balances & aggregates are correct).
- **Data quality tests** for validation rules (run `pytest tests/services/test_validators.py` before each release).

## Useful Resources

- **Feature specs**: `features/` directory — read 00-overview.md for dependency flow.
- **API patterns**: FastAPI docs at `http://localhost:8000/docs` (auto-generated Swagger UI).
- **Database schema**: Check `app/models/` for the ORM models (they are the source of truth).
- **Celery tasks**: `app/tasks/` — all async work happens here.
