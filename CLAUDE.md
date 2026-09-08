# Project Rules

This project is a synthetic-data research/demo application.

- Never use real personal data, scraping, leaks, or unauthorized third-party lookups.
- Never invent people, IDs, relationships, source records, or evidence.
- All relationships must be backed by deterministic database evidence.
- Preserve source provenance and raw payloads.
- Never load multi-gigabyte datasets entirely into RAM; use streaming, batching, pagination and checkpoints.
- All search endpoints must be paginated.
- Never expose database credentials to the frontend or commit secrets.
- External integrations must use authorized APIs only; Truecaller remains disabled until authorized.
- Every relationship must expose evidence, confidence and source.
- Conflicts between sources must remain visible.
- Run tests, typecheck and build before declaring a phase complete.
