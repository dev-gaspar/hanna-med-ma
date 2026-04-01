# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

HannaMed MA is a medical assistant system that automates clinical data extraction from hospital EMR systems using RPA and AI. It has three components in a monorepo:

- **hanna-med-ma-server** — NestJS backend (API, AI agents, WebSocket chat, RPA orchestration)
- **hanna-med-ma-client** — React/Vite frontend (doctor chat UI, admin dashboard)
- **hanna-med-ma-rpa** — Python RPA agent (headless EMR scraping, CareTracker billing automation)

## Build & Dev Commands

### Server (NestJS)
```bash
cd hanna-med-ma-server
npm run dev              # Start with --watch
npm run build            # Production build
npm run lint             # ESLint with --fix
npx prisma generate      # Regenerate Prisma client after schema changes
npx prisma migrate dev   # Create and apply migration
npx prisma migrate deploy # Apply pending migrations (production)
npx prisma studio        # Visual DB browser
npx tsc --noEmit         # Type check without emitting
```

### Client (React/Vite)
```bash
cd hanna-med-ma-client
npm run dev              # Dev server on all interfaces
npm run build            # tsc + vite build
npm run lint             # ESLint
npx tsc --noEmit         # Type check without emitting
```

### RPA (Python)
```bash
cd hanna-med-ma-rpa
python app.py                    # Run locally
pyinstaller hannamed-rpa.spec    # Build single-file .exe
```

### Docker (production deploy)
```bash
docker compose -f docker-compose.yml up -d --build
```

## Architecture

### Data Flow
1. RPA scrapes EMR systems (Jackson, Baptist, Steward) → sends patient data to server via REST
2. Server ingests and syncs patient census via `PatientSyncService` → stores in PostgreSQL
3. Doctor interacts via React chat UI → WebSocket → server's LangGraph AI agent (Gemini)
4. Doctor marks patient as "Seen" → creates `Encounter` → triggers CareTracker RPA via Redis queue
5. Python RPA worker (BRPOP on `caretracker:tasks`) runs Playwright headless to register patient in billing EMR

### Server Module Map
- `src/ai/` — LangGraph router agent, 10 tools (patient list, summary, insurance, lab, seen), sub-agents for formatting
- `src/rpa/` — RPA node management, mark-patient-seen workflow, CareTracker result handler
- `src/ingest/` — Patient census sync, raw data (summary/insurance/lab) ingestion
- `src/chat/` — WebSocket gateway, message persistence
- `src/credentials/` — Encrypted EMR credential storage (AES)
- `src/notifications/` — Firebase Cloud Messaging push notifications
- `src/core/` — PrismaService (global), RedisService (global), `date.util.ts` (centralized dayjs)

### Key Database Models (Prisma)
- **Patient** — Global record per EMR patient (unique by `[emrSystem, normalizedName]`). Holds `billingEmrStatus`.
- **DoctorPatient** — Many-to-many join linking doctors to their patient census. Tracks `isActive` per doctor.
- **Encounter** — Each time a doctor marks a patient as seen. Has `type` (CONSULT/PROGRESS), `dateOfService`, `deadline`.
- **PatientRawData** — Raw text from EMR (SUMMARY, INSURANCE, LAB) linked to Patient.

### Client Structure
- `src/pages/doctor/DoctorChat.tsx` — Main chat interface with patient list rendering and encounter modal
- `src/pages/doctor/PatientCard.tsx` — Individual patient card with action buttons (Summary, Insurance, Lab, Seen)
- `src/services/` — API client (`patientService`, `chatService`, `socketService`)
- Toast notifications via `sonner`

### RPA Architecture
- `app.py` → `RpaNode` — registers with backend, runs extraction loop per hospital
- `flows/` — Per-hospital automation (jackson, baptist, steward) with unified batch flows
- `agentic/` — OmniParser + LangChain screen navigation agents
- `caretracker/` — Playwright-based billing EMR automation (runs headless via Redis queue)
- `core/redis_consumer.py` — BRPOP listener for async CareTracker tasks

## Critical Conventions

### Dates
All dates use `src/core/date.util.ts` (dayjs UTC). Never use `new Date()` directly.
- `nowDate()` for timestamps, `deadlineFromNow(hours)` for deadlines
- `formatForDisplay(date)` converts UTC → America/New_York for user-facing output
- Display timezone is a constant in `date.util.ts`, not an env var

### Environment Variables
Variable names are identical across `.env`, `docker-compose.yml`, and code — no prefix indirection.
- Server vars: `SERVER_DATABASE_URL`, `SERVER_JWT_SECRET`, `SERVER_REDIS_URL`, etc.
- Client build args: `VITE_API_URL`, `VITE_FIREBASE_*`
- RPA vars: `BACKEND_URL`, `REDIS_URL`, `GOOGLE_VISION_API_KEY`

### Patient Data Model
Patients are **global** (shared across doctors). The `DoctorPatient` join table tracks which doctors see which patients. A patient's `billingEmrStatus` is per-patient (not per-encounter) since CareTracker registration happens once.

### Prisma Migrations
Migration files are gitignored by default. Use `git add -f` when committing new migrations. The server Dockerfile uses `process.env.SERVER_DATABASE_URL ?? ""` in `prisma.config.ts` so `prisma generate` works during Docker build without a live DB.

### RPA Build
GitHub Actions workflow (`.github/workflows/rpa-release.yml`) builds `HannamedRPA.exe` via PyInstaller on push to main. The `.env` is baked into the exe from GitHub Secrets. Version is in `hanna-med-ma-rpa/version.py`.
