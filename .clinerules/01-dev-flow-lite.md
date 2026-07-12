# Dev Flow Lite (≈ 50 lines)

## Overview
This file defines the step‑by‑step workflow that the Cline agent follows when executing a task in the onitask project. It is designed to be lightweight and easy to load.

---

## Steps

### 1. Initialize Context
- Read the main `.clinerules` file from the project root. It contains Plan Mode guidelines, required documents, and architectural constraints.
- Load the Memory Bank files from `docs/memory-bank/`:
  - `projectbrief.md`, `productContext.md`, `systemPatterns.md`, `techContext.md` – project context.
  - `activeContext.md` – current focus, decisions, blockers.
  - `progress.md` – overall status (may be used for high‑level summary).
  - `decisions.md` – architectural decisions.
- Also load the task list from `docs/TASKS.md` (this is the single source of truth for task status).

### 2. Identify First Unblocked Task
- Scan `docs/TASKS.md` for the first `- [ ]` entry that does not have a `@blocked_by` tag pointing to an incomplete task.
- If the user specified a particular task (e.g., "DB-01"), use that instead, but verify its dependencies are satisfied.
- Write the task identifier and description to `docs/memory-bank/activeContext.md`.

### 3. Gather Map of Context (MOC)
- Resolve any `MOC-<tag>` references from the task description (if present).
- Pull relevant architecture snippets from `docs/onitask_Architecture_Master_.md`, `docs/onitask_ai_.md`, etc.
- Use `docs/onitask_INDEX_.md` to navigate to the correct documents.

### 4. Plan (Plan Mode)
- Follow the **Plan Mode guidelines** defined in `.clinerules`.
- Generate a structured plan containing:
  - Architectural Analysis (dependencies, cross‑document impact, risks, INV/axiom check).
  - File Mutation Map (new/modified/forbidden files, schema migration flag).
  - Atomic Implementation Steps (critical order for schema changes).
  - Definition of Done & Validation (specific criteria and CLI commands).
- Present the plan to the user for approval.

### 5. Execute (Act Mode)
- Only switch to Act Mode after receiving explicit user approval ("Approved", "Go", or toggle).
- Run the actions sequentially (code generation, SQL migrations, tests, etc.).
- After each successful action, update the task status in `docs/TASKS.md` (mark subtasks if applicable) and note progress in `activeContext.md`.

### 6. Testing & Verification
- Run the validation commands specified in the plan (from `.clinerules`):
  - `supabase db push --dry-run` – schema validation.
  - `npm run type-check` – TypeScript validation.
  - `npm run lint` – linting.
  - `supabase functions serve <function-name>` – Edge Function test.
  - `curl -X POST /api/mcp/<tool>` – MCP contract test.
  - SQL view verification: `SELECT * FROM view_name LIMIT 1;`.
- If any test fails, increment `retry_count` in `activeContext.md` and repeat from step 4.

### 7. Commit & Review
- Commit changes with a message referencing the task ID (e.g., `feat: implement #DB-02`).
- Open a diff for review (if applicable).

### 8. Finalize
- Mark the task as completed in `docs/TASKS.md` by changing `- [ ]` to `- [x]`.
- Update the high‑level progress in `docs/memory-bank/progress.md` (optional, may be done periodically).
- Clear `activeContext.md` (reset `retry_count`, archive new decisions to `decisions.md` if needed).

---

## Notes
- The `pg-aiguide` MCP server (from `cline_mcp_settings.json`) is used for database queries.
- All environment variables are read from the MCP server configuration.
- For large features, consider using `/deep-planning` first.
- This flow is intended for individual tasks; multiple tasks are processed sequentially.

---
*Generated for onitask project – 2026-07-12*