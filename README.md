# FlagShip — Enterprise Feature Flag & Gradual Rollout Platform

FlagShip is an enterprise-grade Feature Flag, Gradual Rollout, Governance, and Experiment Analytics platform designed for safe software delivery without application redeployment.

## Core Capabilities

- **Multi-Project & Environment Isolation**: Projects with Development, Staging, and Production environments, per-environment SDK API keys with instant rotation, and backend-enforced Project-Level RBAC (`ADMIN`, `EDITOR`, `APPROVER`, `VIEWER`).
- **Four Typed Flag Variations**: Boolean, String, Number, and JSON feature flags with named variations and environment-specific defaults.
- **Deterministic 5-Step Targeting & Gradual Rollout Engine**:
  1. Emergency Kill Switch
  2. Individual User Targeting
  3. Reusable Segments & Nested AND/OR Attribute Rules (all 12 operators: `EQUALS`, `NOT_EQUALS`, `IN`, `NOT_IN`, `CONTAINS`, `STARTS_WITH`, `ENDS_WITH`, `REGEX`, `SEMVER_GT`, `SEMVER_LT`, `DATE_BEFORE`, `DATE_AFTER`)
  4. Deterministic MurmurHash3_32 Percentage Rollout (`0..99,999` buckets; 10% -> 20% retains 100% of original users)
  5. Default Variation Fallback
- **Real-Time Server-Sent Events (SSE) & Offline Resilience**: Live configuration & kill-switch broadcast with polling fallback, local in-memory evaluation, and persisted offline snapshots (`<= 2s` startup bound, zero exceptions on server outage).
- **Two-Person Production Approval Workflow & Version History**: Production changes queue with before/after configuration diffs until independently approved; immutable version history with one-click restore and distributed-trace Audit Logs.
- **Experiment Analytics & Flag Hygiene**: Exposure/conversion event tracking, two-proportion Z-test significance, Pearson Chi-Square Sample Ratio Mismatch (SRM) detection, and automated detection of stale (>30d unused or >14d at 100% rollout) flags.
- **Full Day Mode & Night Mode**: OS-aware first-visit theme with instant zero-reload switching and `localStorage` persistence across all 22 screens, tables, dialogs, and Recharts visualizations.
- **Reusable Java 21 / Spring Boot 4 Starter**: Auto-configured starter (`/flagship-spring-boot-starter`) with `@FeatureEnabled` AOP guard, typed evaluation API, `/actuator/flagship`, Micrometer metrics, and working example app (`/flagship-example-app`).

## Repository Structure

```text
/
├── server.ts                         # Full-stack Express + Vite server (port 3000)
├── src/
│   ├── core/                         # Pure evaluation engine, statistics, TypeScript SDK & unit tests
│   ├── db/                           # PostgreSQL Drizzle schema (17 tables), embedded local PGlite & pg pool
│   ├── server/                       # Local JWT Auth/RBAC, SSE hub, RFC 9457 errors, REST routers, seeder
│   ├── context/                      # ThemeContext (Day/Night) & AuthContext (Local JWT + SSE)
│   ├── components/                   # Responsive SaaS Layout shell, Quick Start Wizard & ConfirmDialog
│   └── pages/                        # All 22 enterprise dashboard screens
├── flagship-spring-boot-starter/     # Reusable Maven starter (@FeatureEnabled, 5-step evaluator, MurmurHash3, SSE)
├── flagship-example-app/             # Working Spring Boot example integrating the starter
├── backend-java/                     # Flyway V1 PostgreSQL schema migration
├── scripts/qa-benchmarks.ts          # Runnable QA1 & QA4 performance & consistency benchmarks
├── docs/                             # Architecture, C4/ER diagrams, ADRs, ATAM, Guides, AI Log
├── docker-compose.yml                # Local PostgreSQL 16 + FlagShip container deployment (<= 8 GB RAM)
└── PROJECT_PROGRESS.md               # Phase-by-phase progress & verification log
```

## Quick Start (100% Local & Offline-Ready — Zero Paid Cloud Dependencies)

### Local Development (Embedded Local PostgreSQL via PGlite)
```bash
npm install
npm run test                       # Run core evaluator & statistics unit tests
npx tsx scripts/qa-benchmarks.ts   # Run QA1 & QA4 measurement benchmarks
npm run dev                        # Starts FlagShip on http://localhost:3000 with local PostgreSQL (.flagship-data/pgdata)
```

### Docker Compose (Local PostgreSQL 16 Container, <= 8 GB RAM)
```bash
docker compose up --build
```

### Demo Role Accounts (Seeded Automatically in PostgreSQL)
Password for all evaluation accounts: `FlagShip2026!`
- **Admin**: `admin@flagship.dev` (Aria Chen)
- **Editor**: `editor@flagship.dev` (Marcus Vance)
- **Approver**: `approver@flagship.dev` (Priya Nair)
- **Viewer**: `viewer@flagship.dev` (David Okafor)

## Documentation Index

- [Architecture, C4 Diagrams, ER Diagram, Utility Tree & Mini-ATAM](docs/ARCHITECTURE.md)
- [Architecture Decision Records (ADR-001 through ADR-004)](docs/ADRS.md)
- [Deployment, Free-Tier Hosting, Starter Quick Start & User Guide](docs/DEPLOYMENT_AND_USER_GUIDE.md)
- [AI Usage Log & Defect Corrections](docs/AI_USAGE_LOG.md)
- [Project Progress & Real Measured Benchmarks](PROJECT_PROGRESS.md)
