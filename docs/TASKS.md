# Task List (generated)

Each task references the original document section it originates from.  The
format is deliberately compact so that agents can load the file quickly.

---

## P0 – Must‑Do (Foundation & Core)

| ID | Title | Source | Priority | Estimate |
|----|-------|--------|----------|----------|
 | **TASK‑P0‑001** | Implement DB schema & migrations (`001_init.sql`, `002_rls.sql`) | Architecture §1 | P0 | 5 sp | ✅ Completed, schema deployed on Supabase
| **TASK‑P0‑002** | Create `/api/init` endpoint with timing‑safe secret checks | Architecture §7 | P0 | 3 sp |
| **TASK‑P0‑003** | Build `workers` table & RLS policies (worker model) | Architecture §4‑5 | P0 | 4 sp |
| **TASK‑P0‑004** | Implement task CRUD routes (`/api/tasks*`) respecting invariants | Architecture §6 | P0 | 6 sp |
| **TASK‑P0‑005** | Wire up Flow Board UI (TWA) using `workspace_settings` | Product Vision §3 | P0 | 8 sp |
| **TASK‑P0‑006** | Add atomic AI quota handling (`INSERT … ON CONFLICT DO UPDATE`) | Architecture §3‑9 | P0 | 3 sp |
| **TASK‑P0‑007** | Deploy CI/CD pipeline (Vercel preview + Supabase Edge) | dev_setup.md §2 | P0 | 2 sp |
| **TASK‑P0‑008** | Implement `auto_create_agent_worker` trigger on `agent_events` (INV‑04) | Architecture §4 | P0 | 3 sp |
| **TASK‑P0‑009** | Ensure all AI‑outputs include `workspace_id` (INV‑05) | Architecture §5 | P0 | 3 sp |
| **TASK‑P0‑010** | Use `timingSafeEqual` for all secret comparisons (INV‑06) | Architecture §7 | P0 | 2 sp |
| **TASK‑P0‑011** | Enforce `workspace_settings` as single source of truth (INV‑08) | Architecture §8 | P0 | 3 sp |
| **TASK‑P0‑012** | Implement atomic version increment on `tasks` (INV‑09) | Architecture §9 | P0 | 3 sp |
| **TASK‑P0‑013** | Add FK `workspace_telegram_chats.linked_by → profiles(id)` (INV‑10) | Architecture §10 | P0 | 2 sp |
| **TASK‑P0‑014** | Make `workspaces.task_prefix` immutable via trigger (INV‑11) | Architecture §11 | P0 | 2 sp |
| **TASK‑P0‑015** | Add `trg_record_assignment_snapshot` trigger for `assignment_history` (INV‑12) | Architecture §12 | P0 | 4 sp |
| **TASK‑P0‑016** | Ensure `task_relations.workspace_id` is passed explicitly on INSERT (INV‑13) | Architecture §13 | P0 | 3 sp |
| **TASK‑P0‑017** | Separate `workspace_context` and `workspace_context_cache` with RLS (INV‑14) | Architecture §14 | P0 | 3 sp |
| **TASK‑P0‑018** | Restrict `data_sharing_level='full'` to Admin/Owner (INV‑15) | Architecture §15 | P0 | 3 sp |
| **TASK‑P0‑019** | Enforce `/api/init` find‑or‑create only, no auto‑updates (INV‑16) | Architecture §16 | P0 | 3 sp |

## P1 – Important (AI‑Native & Scaling)

| ID | Title | Source | Priority | Estimate |
|----|-------|--------|----------|----------|
| **TASK‑P1‑001** | Implement `/api/ai/transcribe` (Instant tier) | AI Contract §2 | P1 | 5 sp |
| **TASK‑P1‑002** | Add task decomposition endpoint (`/api/tasks/[id]/decompose`) | Architecture §12 | P1 | 8 sp |
| **TASK‑P1‑003** | Show `attention_risk_score` on task cards | Security §5 | P1 | 4 sp |
| **TASK‑P1‑004** | Implement data‑sharing level controls (`minimal/standard/full`) | Product Vision §8 | P1 | 3 sp |
| **TASK‑P1‑005** | Switch vector index to HNSW when >5k vectors | Architecture §4‑5 | P1 | 6 sp |
| **TASK‑P1‑006** | Add layered metrics cache (`Layered Metrics Cache`) | Architecture §10 | P1 | 5 sp |
| **TASK‑P1‑007** | Extend MCP contract with bulk move RPCs | MCP Contract md | P1 | 4 sp |

## P2 – Optional (Enterprise & Compliance)

| ID | Title | Source | Priority | Estimate |
|----|-------|--------|----------|----------|
| **TASK‑P2‑001** | Draft DPA for `full` data‑sharing level | Product Vision §8 | P2 | 8 sp |
| **TASK‑P2‑002** | Encrypt AI payloads before sending to LLM providers | Security §2 | P2 | 6 sp |
| **TASK‑P2‑003** | Expand RBAC for bot actions (granular permissions) | Architecture §8 | P2 | 5 sp |
| **TASK‑P2‑004** | Create versioned migration scripts with rollback | dev_setup.md §5 | P2 | 4 sp |

---

## Маппинг задач к миграциям и структуре проекта

| Task ID | Related migration | Affected directory/file |
|---------|-------------------|--------------------------|
| TASK‑P0‑001 | `001_init.sql`, `002_rls.sql` | `supabase/migrations/` |
| TASK‑P0‑002 | — | `app/api/init/route.ts` |
| TASK‑P0‑003 | — | `src/lib/supabase/server.ts`, `src/lib/supabase/client.ts` |
| TASK‑P0‑004 | — | `app/api/tasks/*` routes |
| TASK‑P0‑005 | — | `app/(twa)/workspace/[slug]/` UI components |
| TASK‑P0‑006 | — | `supabase/functions/enrich-task/` (quota handling) |
| TASK‑P0‑007 | — | CI/CD config (`vercel.json`, GitHub Actions) |
| TASK‑P1‑001 | — | `app/api/ai/transcribe/` |
| TASK‑P1‑002 | — | `app/api/tasks/[id]/decompose/` |
| TASK‑P1‑003 | — | UI component displaying `attention_risk_score` |
| TASK‑P1‑004 | — | `src/lib/workspace.ts` (data_sharing_level) |
| TASK‑P1‑005 | — | Vector index config in Supabase (`pgvector` settings) |
| TASK‑P1‑006 | — | `src/lib/flow.ts` (metrics cache) |
| TASK‑P1‑007 | — | MCP contract updates in `supabase/functions/_shared/` |
| TASK‑P2‑001 | — | Legal docs (outside repo) |
| TASK‑P2‑002 | — | Encryption utilities in `src/lib/ai.ts` |
| TASK‑P2‑003 | — | RBAC checks in middleware (`src/middleware.ts`) |
| TASK‑P2‑004 | — | Migration scripts in `supabase/migrations/` |

---

*Generated on $(date)*
