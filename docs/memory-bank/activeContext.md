# Active Context

## Current Task: Fix workspace creation - owner_id NULL error (2026-07-21)

**Status**: ✅ Completed

**Problem Analysis:**
- Error `postgres 23502` — null value in column "owner_id" violates not-null constraint
- Error `edge 400` — POST to `/rest/v1/workspaces` with `auth_user: null`
- Root cause: `auth.uid()` returns NULL для service_role, но миграция 011 использовала `DEFAULT auth.uid()`

**Root causes identified:**
1. ✅ `DEFAULT auth.uid()` в миграции 011 возвращает NULL для service_role (bypasses RLS)
2. ✅ Триггер `trg_init_workspace_columns` был создан в 001_init.sql, но **не привязан** к таблице workspaces
3. ✅ `tracker.columns` имел политику `columns_insert` с проверкой `auth.uid() = workers.id`, что не работает для service_role
4. ✅ Политика `authenticated_can_create_workspaces` требовала `auth.uid() IS NOT NULL`, что падает для Telegram WebApp auth (нет JWT)

**Changes made:**
1. **Migration `011_fix_workspace_columns_trigger_and_add_owner.sql`** — исправлена:
   - Добавлен `trg_init_workspace_columns` trigger (был отсутствовать!)
   - Функция `init_workspace_columns()` пересоздана как `SECURITY DEFINER`
   - Предоставлены права `USAGE` и `INSERT` на схему `tracker` для `service_role`
   - Добавлены RLS политики: `workspaces_insert_service_role`, `workspaces_insert_anon`, `workspaces_insert_own`
   - Удалена конфликтующая политика `authenticated_can_create_workspaces`

2. **Route handler `src/app/api/workspaces/route.ts`** — улучшена обработка ошибок:
   - Добавлено детальное логирование с `message`, `details`, `hint`, `code`
   - Добавлен отдельный чек на `!workspaceData`
   - Возвращает детали ошибки в ответе для диагностики

3. **lib/supabase.ts** — добавлен warning при отсутствии `SUPABASE_SERVICE_ROLE_KEY`

**Database state (проверено через Supabase MCP):**
- ✅ Триггер `trg_init_workspace_columns` создан и привязан к `public.workspaces`
- ✅ Функция `init_workspace_columns()` имеет `SECURITY DEFINER`
- ✅ Политика `columns_insert_service_role` существует для `tracker.columns`
- ✅ Политика `workspaces_insert_service_role` существует для `public.workspaces`
- ✅ Политика `workspaces_insert_anon` существует для `public.workspaces`
- ✅ Политика `workspaces_insert_own` существует для `public.workspaces`

**Validation:**
- ✅ `npm run type-check` passed with no errors
- ✅ Триггер `trg_init_workspace_columns` создан и привязан
- ✅ Функция `init_workspace_columns()` имеет `SECURITY DEFINER`
- ✅ Политика `columns_insert_service_role` существует
- ✅ Политика `workspaces_insert_service_role` существует
- ✅ Политика `workspaces_insert_anon` существует
- ✅ Политика `workspaces_insert_own` существует

**Next steps for deployment:**
1. Убедиться, что `SUPABASE_SERVICE_ROLE_KEY` установлен в Vercel Environment Variables
2. Перезапустить приложение после деплоя
3. Проверить логи на наличие warning'а о missing service role key
4. Протестировать создание workspace через Telegram WebApp
