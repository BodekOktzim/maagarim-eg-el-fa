# Unified Data Intelligence Lab

Synthetic-only research/demo application for source-aware search, deterministic entity resolution, family relationships, evidence and AI orchestration.

## Run

```bash
pnpm install
pnpm check
pnpm test
pnpm build
pnpm dev
```

The managed WebDev environment supplies the authenticated database/runtime. For local infrastructure, `docker compose up -d` starts PostgreSQL and Redis; the compose file is intentionally dev-only and contains no production secrets.

## Verified MVP capabilities

- Synthetic fixtures: DB_2006, DB_2020 and FACEBOOK_DEMO.
- National ID, phone, name and address normalization/search with pagination.
- Raw source payload preservation and source attribution.
- Deterministic person resolution by national ID; same name/address alone never merges.
- Parent and sibling relationship resolution with evidence and confidence.
- Bounded family expansion (`depth` 0–3).
- Streaming import generator with batch checkpoints and resumable result.
- Allowlisted AI orchestration over deterministic tools; no arbitrary SQL or external lookup.
- Truecaller adapter is present but disabled; no scraping is implemented.
- Audit events for searches and visible DEMO MODE banner.
- PostgreSQL migration SQL for people, raw records, sources, relationships, conflicts, imports and audit logs.
- Streaming parsers for CSV, JSON, JSONL, XLSX, ZIP and GZIP inputs, with resumable batch checkpoints.
- BullMQ queue/worker definitions for imports and indexing, plus API rate limiting.
- Deterministic conflict detection and derived extended-family relationships.
- Browser upload endpoint with 8MB chunks, offset writes, resume-friendly metadata and a 2GB per-file limit.
- Completed uploads automatically enqueue a BullMQ `imports` job; the browser polls `/api/import-jobs/:id` and displays processed-record progress.

## Phases

1. Project setup and runtime
2. Data model and migration baseline
3. Streaming import/checkpoint engine
4. Normalization and provenance
5. Entity resolution
6. Relationship/family graph
7. Unified search
8. Dashboard/profile/source UI
9. AI orchestrator
10. Synthetic source adapters
11. Performance/observability foundations
12. Security, audit, tests and end-to-end verification

## Important limitation

This session provides a managed WebDev database/runtime rather than a local Docker daemon, so local Docker execution and PostgreSQL migration execution cannot be performed inside the sandbox. The compose definition, environment contract, streaming implementation and bounded query APIs are included for deployment/CI verification.

`pnpm benchmark:stream` runs a bounded-memory synthetic benchmark. It does not create a 5GB file by default; set `BENCHMARK_RECORDS` explicitly for a controlled larger run.

Browser uploads are written to `UPLOAD_TMP_DIR` (default `/tmp/synthetic-data-lab-uploads`) and are ready for the import worker after completion. Use persistent object storage or a persistent volume in production; do not rely on ephemeral `/tmp` across autoscale instances.
