-- ============================================================================
-- 120_revoke_truncate_references_trigger.sql
-- onitask · Отзыв табличных привилегий, которые не покрываются RLS
--
-- Находка (2026-09-26, live-SQL аудит): роль anon и authenticated имели
-- привилегии TRUNCATE / REFERENCES / TRIGGER на 28 из 39 таблиц
-- public-схемы, включая `tasks`.
--
-- Почему это дыра, а не шум:
--   · RLS регулирует SELECT / INSERT / UPDATE / DELETE — и только их.
--   · TRUNCATE, REFERENCES и TRIGGER — привилегии уровня таблицы, которые
--     выполняются ДО проверки политик. Политика RLS на `tasks` не может
--     запретить `TRUNCATE public.tasks`.
--   · Итог: обладатель anon-ключа удалял бы все задачи целиком, независимо
--     от того, какие политики написаны.
--
-- Почему это латентный, а не эксплуатируемый сегодня риск (проверено):
--   · PostgREST не exposes TRUNCATE — через Data API его не вызвать.
--   · Функций с привилегией EXECUTE для anon/authenticated в схеме public
--     нет ни одной (проверено 2026-09-26) — SQL-обёртки, которая дёрнула
--     бы TRUNCATE, отсутствует.
--   То есть прямого пути нет. Но дыра закрывается одной строкой, а цена
--   ошибки при её появлении (например, после добавления любой SECURITY
--   DEFINER-функции с плохим GRANT) — полная потеря данных.
--
-- Что НЕ отзываем: SELECT / INSERT / UPDATE / DELETE. Ими пользуется Data API
-- (см. политики RLS) и Route Handler через anon/authenticated-клиент; их
-- ограничивают именно политики, а не привилегии.
--
-- service_role не затрагивается: у него BYPASSRLS и полные права по умолчанию.
-- ============================================================================

DO $$
DECLARE
  v_table text;
  v_count int := 0;
BEGIN
  -- Перечисляем таблицы динамически: набор растёт с каждой миграцией,
  -- хардкод-список быстро устарел бы.
  FOR v_table IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      -- Только те, у кого эти привилегии действительно выданы (иначе REVOKE
      -- выдаст notice и засорит вывод; для triggers их выдаёт только superuser).
      AND (
        has_table_privilege('anon', c.oid, 'TRUNCATE')
        OR has_table_privilege('authenticated', c.oid, 'TRUNCATE')
      )
    ORDER BY c.relname
  LOOP
    EXECUTE format('REVOKE TRUNCATE ON public.%I FROM anon, authenticated', v_table);
    EXECUTE format('REVOKE REFERENCES ON public.%I FROM anon, authenticated', v_table);
    EXECUTE format('REVOKE TRIGGER ON public.%I FROM anon, authenticated', v_table);
    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE '120_revoke: привилегии отозваны на % таблицах', v_count;
END
$$;
