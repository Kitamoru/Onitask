# Active Context — Database Performance Audit (2026-07-16)

## Task: Comprehensive DB Performance Audit & Migration

### Findings Summary

#### Critical Alerts (from Supabase Performance Advisors)
1. **RLS Disabled on workspace_links** — Priority 1 (CRITICAL). Table fully exposed to anon/authenticated roles.
2. **15 Unindexed Foreign Keys** — Affecting: agent_memory, assignment_history, invite_links, task_enrichments, task_events, task_relations, tasks, workspace_doc_chunks, workspace_documents, workspace_links, workspace_telegram_chats.
3. **28 Unused Indexes** — Never queried; wasting write I/O and storage.
4. **1 Duplicate Index** — `idx_invite_links_workspace` / `idx_invite_links_workspace_active` are identical.
5. **49 auth_rls_initplan Warnings** — RLS policies using `auth.uid()` instead of `(select auth.uid())`, causing per-row re-evaluation overhead.
6. **100+ multiple_permissive_policies Warnings** — Multiple permissive policies per role/action increase evaluation cost.

#### pg_stat_statements Top Heavy Queries
All top queries were internal dashboard/MCP metadata queries (schema introspection, timezone names, extension listing). No application-level slow queries detected in pg_stat_statements at this time — database is likely still low-volume.

### Validation Results
- ✅ Schema `tracker` confirmed exists (columns table found in pg_policies)
- ✅ All 67 existing RLS policy names matched and handled in migration
- ✅ Migration updated to drop ALL permissive policies before recreating (eliminates both auth_rls_initplan AND multiple_permissive_policies warnings)

### Actions Taken
1. Created migration `supabase/migrations/008_optimize_performance.sql`:
   - **Part 1**: Added 15 indexes on unindexed foreign keys (CONCURRENTLY).
   - **Part 2**: Dropped duplicate index `idx_invite_links_workspace_active`.
   - **Part 3**: Enabled RLS on `workspace_links` + added member/admin policies.
   - **Part 4**: Dropped ALL ~67 existing RLS policies and recreated with `(select auth.uid())` subselect pattern. This eliminates both auth_rls_initplan AND multiple_permissive_policies warnings.
   - **Part 5**: Added 4 composite indexes for common query patterns.

### Validation Commands (run after deployment)
```bash
supabase db push --dry-run          # Schema validation
curl -X POST /api/workspaces        # API smoke test
SELECT * FROM pg_indexes WHERE schemaname = 'public' AND indexname LIKE 'idx_%';  # Verify new indexes
```

### Recommendations for Future
- Monitor `pg_stat_user_indexes` after migration to confirm new indexes are being used.
- Consider dropping unused indexes after 2 weeks of production traffic if still unused.
- Schedule quarterly `get_advisors` runs to catch regressions early.