-- ============================================================================
-- 112_rls_phase2_cleanup.sql
-- onitask · Phase 2 RLS cleanup (после 109–111 private RLS helpers)
--
-- Контекст:
--   109 перевёл все tenant-политики на private-хелперы `onitask_private.*`
--   (owner = postgres, BYPASSRLS) и устранил рекурсию 42P17.
--   Phase 2 убирает оставшийся мусор доступа, который стал бессмысленным
--   после 109, и закрывает реальную дыру в `telegram_message_queue`.
--
-- Проверено перед применением (живая БД):
--   · pg_depend / pg_rewrite: 0 dependents на public get_my_workspace_ids,
--     is_workspace_admin, is_workspace_owner — ни views, ни functions.
--   · pg_policies: ни одна политика public/tracker больше не ссылается на эти
--     функции (все переведены на onitask_private.* в 109).
--   · grep по репозиторию: вызовов из TypeScript нет.
--   · get_task_feed (076) — SECURITY INVOKER, читает task_comments напрямую
--     под ролью вызывающего; сервисный путь идёт через service_role.
--
-- Сознательно НЕ делается здесь:
--   · DROP public-хелперов — REVOKE EXECUTE достаточно закрывает advisor
--     `authenticated_security_definer_function_executable`, а функции
--     остаются как совместимая точка входа для service_role.
--   · grants на схему `tracker` для authenticated — отдельная задача
--     (нужно сначала подтвердить, что браузерный клиент читает
--     tracker.columns напрямую; сейчас весь поток идёт через service_role).
--   · `workspaces_insert_anon` — формально дыра (anon может вставить
--     workspace с любым owner_id), но она появилась как fallback на случай
--     отсутствия SUPABASE_SERVICE_ROLE_KEY (миграция 011, комментарий
--     «fallback when service_role key is missing»). Убирать только вместе
--     с удалением fallback-ветки в lib/supabase.ts.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Public RLS-хелперы: закрыть EXECUTE для anon и authenticated
-- ---------------------------------------------------------------------------
--   Advisory `authenticated_security_definer_function_executable` (3 findings)
--   требует, чтобы подписанный пользователь не мог вызвать SECURITY DEFINER
--   функцию через /rest/v1/rpc/*. Функции SECURITY DEFINER + владелец postgres
--   (BYPASSRLS) → через них можно было узнать список workspace'ов, где
--   текущий пользователь состоит участником, и его admin/owner-статус.
--   Это не обход tenant boundary, но лишняя поверхность: единственный
--   легитимный потребитель — RLS-схема, которая уже переведена
--   на onitask_private.*.
--   service_role сохраняет EXECUTE (RLS bypass, вызовы не ограничены).
-- ---------------------------------------------------------------------------

REVOKE EXECUTE ON FUNCTION public.get_my_workspace_ids()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_workspace_ids() TO service_role;

REVOKE EXECUTE ON FUNCTION public.is_workspace_admin(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_workspace_admin(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.is_workspace_owner(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_workspace_owner(uuid) TO service_role;

COMMENT ON FUNCTION public.get_my_workspace_ids() IS
  'Deprecated compatibility wrapper. RLS использует onitask_private.user_workspace_ids(). Доступен только service_role; anon/authenticated EXECUTE отозван (миграция 112).';
COMMENT ON FUNCTION public.is_workspace_admin(uuid) IS
  'Deprecated compatibility wrapper. RLS использует onitask_private.is_workspace_admin(uuid). Доступна только service_role (миграция 112).';
COMMENT ON FUNCTION public.is_workspace_owner(uuid) IS
  'Deprecated compatibility wrapper. RLS использует onitask_private.is_workspace_owner(uuid). Доступна только service_role (миграция 112).';

-- ---------------------------------------------------------------------------
-- 2. telegram_message_queue: закрыть anon-доступ (реальная дыра)
-- ---------------------------------------------------------------------------
--   Миграция 024 создала политики с ролями {anon, authenticated} и условиями
--   USING (true) / WITH CHECK (true). Несмотря на имена
--   «own messages» / «own workspace's queue», условие — константа true,
--   то есть доступ не ограничен ничем.
--
--   Что лежит в таблице: telegram_chat_id, message, attachments
--   (jsonb с content_base64 — единственное место, где base64 живёт в БД,
--   миграция 077), metadata.
--
--   Кто реально работает с таблицей:
--     writer   — lib/domain/agent/sendMessageToChat.ts
--                (lib/shared/mcpAuth.ts → SUPABASE_SERVICE_ROLE_KEY);
--     consumer — supabase/functions/bot-notify/index.ts
--                (drainTelegramMessageQueue, тоже service_role);
--     GC       — public.gc_telegram_message_queue() (cron, миграция 073).
--   Оба живых пути идут через service_role, который обходит RLS.
--   Политики для anon — мёртвый код от эпохи, когда доступ был по anon-ключу.
--
--   anon-ключ (NEXT_PUBLIC_SUPABASE_ANON_KEY) попадает в клиентский бандл,
--   поэтому до этой миграции любой, кто знал anon-ключ проекта, мог:
--     · SELECT * из очереди (chat_id, тексты, base64 вложений);
--     · INSERT произвольных строк в очередь исходящих Telegram-сообщений.
--
--   Действие: удалить обе политики (RLS остаётся включённым → для
--   anon/authenticated таблица закрыта полностью) и отозвать table grants.
--   service_role сохраняет полный доступ через BYPASSRLS.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS agents_insert_own_messages_on_telegram_message_queue
  ON public.telegram_message_queue;
DROP POLICY IF EXISTS agents_read_own_workspace_queue_on_telegram_message_queue
  ON public.telegram_message_queue;

REVOKE ALL ON TABLE public.telegram_message_queue FROM anon, authenticated;
GRANT ALL ON TABLE public.telegram_message_queue TO service_role;

COMMENT ON TABLE public.telegram_message_queue IS
  'Асинхронная очередь исходящих Telegram-сообщений агента (миграция 024, файлы — 077). Writer: MCP send_message_to_chat; consumer: bot-notify drainTelegramMessageQueue. Оба пути — service_role. Доступ для anon/authenticated закрыт в миграции 112: политики 024 имели USING/WITH CHECK (true) и не ограничивали ничего. GC: gc_telegram_message_queue, sent/failed старше 7 дней.';
