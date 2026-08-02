# Active Context

## Current Task: Database Cleanup — Delete all workspaces + clean related tables (2026-08-02)

**Status**: ✅ Completed

**Summary:**
Inspected the Supabase database (project: Onitask, ref: `atarmvtzvlwhkheeabeb`) via Supabase MCP and performed a full cleanup of all workspace data.

**Before cleanup — row counts:**
| Table | Rows |
|---|---|
| workspaces | 8 |
| workers | 8 |
| workspace_settings | 6 |
| workspace_task_counters | 8 |
| tracker.columns | 32 |
| sprints | 4 |
| tasks | 0 |
| task_column_history | 0 |
| task_enrichments | 0 |
| agent_events | 0 |
| agent_memory | 0 |
| workspace_telegram_chats | 0 |
| task_events | 0 |
| consolidation_errors | 0 |
| workspace_documents | 0 |
| workspace_doc_chunks | 0 |
| assignment_history | 0 |
| task_relations | 0 |
| workspace_links | 1 |
| invite_links | 3 |
| calendar_connections | 0 |
| calendar_events | 0 |
| enrichment_queue | 1 |
| profiles | 2 |

**Actions taken:**
1. **Nulled `profiles.last_active_workspace_id`** — Both profiles (`truebulat`, `kitamoru`) had `last_active_workspace_id` pointing to workspaces. This FK has no `ON DELETE CASCADE`, so it was set to `NULL` first to avoid constraint violations.
2. **Deleted all 8 workspaces** via `DELETE FROM workspaces` — PostgreSQL `ON DELETE CASCADE` on all workspace-related FKs automatically cleaned up:
   - `workspace_task_counters`, `workers`, `workspace_settings`, `tracker.columns`, `sprints`, `tasks`, `invite_links`, `workspace_telegram_chats`, `task_events`, `agent_events`, `agent_memory`, `enrichment_queue`, `task_enrichments`, `assignment_history`, `task_relations`, `workspace_links`, `workspace_documents`, `workspace_doc_chunks`, `calendar_events`, `calendar_connections`
   - Plus task-level CASCADE: `task_column_history`, `task_enrichments` (via tasks)

**After cleanup — row counts:**
All workspace-related tables: **0 rows** ✅
`profiles`: **2 rows** (preserved — user identities tied to Supabase Auth, not workspace-specific) ✅

**INV/Architecture checks:**
- INV-01 through INV-16: No violations — all FK constraints with CASCADE properly cleaned up
- INV-10 (`workspace_telegram_chats.linked_by → profiles(id)`): No data to clean (0 rows)
- INV-16 (`/api/init` find-or-create): profiles preserved, `last_active_workspace_id` nulled
- A-07 (Tenant Isolation): All workspace-scoped data removed
- A-02 (Timing Safe): No secrets affected

**Next Steps:**
- Database is now in a clean state for fresh workspace creation
- No schema changes were made — only data cleanup
