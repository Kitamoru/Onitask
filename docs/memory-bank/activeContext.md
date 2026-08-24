# Active Context

## Current Task: Database Cleanup — Delete all workspaces + clean related tables (2026-08-02)

**Status**: ✅ Completed

## Bugfix: Sprint "не найден" при activate/edit (2026-08-24)

**Status**: ✅ Fixed

**Symptom:** Sprint создаётся в БД и виден на FlowBoard, но «Активировать» / «Редактировать» → модалка «Спринт не найден».

**Root cause:** Хелпер `getAuthenticatedWorker()` в sprint API резолвил «рабочий воркспейс» через `.eq('source_id', profileId).eq('is_active', true).limit(1)` — возвращал **первый** активный воркер пользователя без привязки к воркспейсу спринта. У обоих пользователей (**kitamoru**, **truebulat**) по 2 активных воркера (Булатово `cf9684bf` + Онитаск `ed93e8c5`). `.limit(1)` без `ORDER BY` стабильно возвращал воркера из «Булатово» (создан раньше), а спринт создавался в «Онитаск» → tenancy-проверка `sprint.workspace_id !== worker.workspace_id` → 404 «Спринт не найден».

**Факты из БД (`atarmvtzvlwhkheeabeb`):**
- sprint `38ac068e…` (Онитаск-1, status=active) → workspace `ed93e8c5` (Онитаск)
- `.limit(1)` для kitamoru → worker `49c7059b` (Булатово); для truebulat → `3357e5e8` (Булатово) — оба НЕ в воркспейсе спринта → 404.

**Fix (Act-mode):**
1. `src/app/api/sprints/[id]/route.ts` — PATCH/DELETE: сначала найти спринт по id, затем `getAuthenticatedWorker(request, existing.workspace_id)` (резолв воркера в воркспейсе спринта); task-привязка по `existing.workspace_id`.
2. `src/app/api/sprints/[id]/activate/route.ts` — тот же паттерн с `sprint.workspace_id`.
3. `src/app/api/sprints/route.ts` — GET: опциональный `?workspace_id=` + фильтр по всем воркспейсам пользователя (без `.limit(1)`).

**Second bug (disturbed body) + architectural refactor (2026-08-24, Act):**
- **Root #2:** после реструктуризации, PATCH вызвал `request.json()` до `getAuthenticatedWorker(request, …)`. Внутри хелпера `req.clone().json()` на уже прочитанном теле бросает TypeError («disturbed request»); исключение глоталось try/catch → initData=undefined → 401-заглушка → «Спринт не найден». Молча.
- **Решение (единая архитектура):**
  - `lib/api-auth.ts`: добавлены `extractInitData(req)` (извлекает initData из клона ДО любого чтения тела), `isWorkspaceMember(profileId, workspaceId)` (resource-scoped tenancy по воркспейсу ресурса), `getUserWorkspaceIds(profileId)` (детерминированный список членств).
  - `sprints/route.ts` (GET+POST), `sprints/[id]/route.ts` (PATCH+DELETE), `sprints/[id]/activate/route.ts`: убраны все копии `getAuthenticatedWorker`, везде единый паттерн — `authenticateRequest(await extractInitData(req))` в начале (до тела) + tenancy по `workspace_id` самого спринта.
  - POST: fallback на первый воркспейс из `getUserWorkspaceIds` (а не случайный воркер/профиль).

**Validation:** `npm run type-check` ✅ (прим.: lint падает на инфраструктурной ошибке `@rushstack/eslint-patch` — не связано с изменениями). Эмуляция запроса в БД: оба пользователя теперь резолвятся в воркере «Онитаск» → tenancy OK.

**Tasks API: тот же рефактор (2026-08-24, Act):**
- **Проблема:** `src/app/api/tasks/route.ts` (GET/POST) и `src/app/api/tasks/[id]/route.ts` (PATCH/DELETE) использовали хелперы `getAuthenticatedProfile`/`getAuthenticatedWorker` с тем же недетерминированным `.limit(1)` — при мульти-воркспейс пользователе задачи создавались/искались в случайном board. Плюс:
  - PATCH **вообще не проверял tenancy** (update по голому `id`, `worker` — только для broadcast);
  - DELETE проверял хрупкий `profiles.last_active_workspace_id === task.workspace_id` → 403 валидному члену после переключения борда.
- **Fix (единые хелперы `lib/api-auth.ts`):**
  - добавлены `getActiveWorkerInWorkspace(profileId, workspaceId)` (воркер-строка внутри воркспейса для `created_by`) и `getDefaultWorkspaceId(profileId)` (last_active → первый из членств, детерминировано).
  - `tasks/route.ts`: GET+POST через `extractInitData` + `isWorkspaceMember` + дефолт-воркспейс; POST принимает `workspace_id` из тела с проверкой.
  - `tasks/[id]/route.ts`: PATCH/DELETE — auth через `extractInitData`, tenancy по `workspace_id` самой задачи (`isWorkspaceMember`); DELETE вместо `last_active`-сравнения; broadcast по `task.workspace_id`.
- **Validation:** `npm run type-check` ✅. `npm test`: `workspaceContextCache` 4/4 ✅; `init.test` 4/4 — это **пред-существующий** env-фейл теста (mock `@/lib/telegramAuth` не совпадает с реальным импортом; `TELEGRAM_BOT_TOKEN` не настроен), к изменениям отношения не имеет.

**Out-of-scope items закрыты (2026-08-24, Act, вторая волна):**
1. `tasks/[id]` DELETE: удалены мёртвые cleanup-вызовы к несуществующим таблицам `enrichments` и `task_vector_chunks` (остались только реальные: `task_relations`, `task_column_history`, `assignment_history`, `bot_task_drafts`).
2. `ai/create-task`: fallback `.limit(1)` заменён на `getDefaultWorkspaceId`; явный `workspace_id` теперь проверяется на членство через `getUserWorkspaceIds.includes` → 403 не-члену (раньше любой аутентифицированный мог вставить задачу в чужой воркспейс — дыра INV-05/A-07). Bot-путь (service-token + `profile_id`) работает так же.
3. `flow/metrics`: fallback «primary workspace» `.limit(1)` заменён на `getDefaultWorkspaceId(profileId)`. Проверка доступа к явному `requestedWorkspaceId` оставлена как была (она корректна — workspace-scoped).
- **Validation:** `npm run type-check` ✅ после всех правок.

---

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
