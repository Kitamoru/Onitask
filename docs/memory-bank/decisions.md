# Architectural Decisions (ADR log)

## ADR-2026-09-06: Комментарии — отдельная таблица `task_comments` (миг. 076)

**Статус:** принято · **Задача:** AGENT-08 · **Дизайн:** Figma 322-27840

### Контекст

Первоначальный дизайн (flow §22, Master §6.10) предполагал хранить комментарии
в `task_events` с `event_type='comment'` («отдельная таблица не нужна») —
MVP-упрощение до появления реальной фичи «Комментарии». При планировании
реализации выявлены блокеры:

1. **Retention-конфликт:** `gc_task_events` (миг. 073) удаляет `task_events`
   старше 30 дней пакетами **без фильтра по `event_type`** → комментарии
   (пользовательский контент) молча исчезали бы на 31-й день.
2. **Нарушение Worker Model:** `task_events` не имеет FK на `workers(id)`;
   автор жил бы только в jsonb `payload`.
3. **Security-дыра:** RLS-политика `task_events_insert_comment` (002) позволяла
   любому члену воркспейса вставлять `event_type='comment'` с произвольным
   `payload` (в т.ч. чужой `author_id`) напрямую в БД, минуя сервер.
4. **Семантика:** `task_events` — immutable-лог для Memory Consolidation;
   комментариям нужны edit/delete/replies (Phase 2).
5. Фактически `status_change`/`assignment` в `task_events` никем не пишутся
   (grep по кодовой базе); durable-хроника статусов — `task_column_history`.

### Решение

- **R1:** отдельная таблица `task_comments` (durable, FK на `workers(id)`,
  `author_name` — снимок). `task_events` остаётся как есть (`parse_rewrite`).
- **R2:** retention безлимитный; per-workspace настройка — позже.
- **R3:** Phase 1 = create + read; `deleted_at` в схеме, edit/delete — Phase 2.
- **R4:** MCP `add_task_comment` — отдельная задача.
- **R5:** фид = RPC `get_task_feed`: `task_comments` + `task_column_history`
  + `agent_events` (окно 7д). `task_events` в UI-фид не входит.
- **R6:** автор — только server-side (`getActiveWorkerInWorkspace`); клиентские
  `author_id`/`author_name` игнорируются. Прямых INSERT-политик RLS нет.
- **R7:** live — optimistic submit + server-side broadcast `comment_created`
  на `task-comments-<task_id>` (TWA без Supabase-JWT → `postgres_changes`
  недоставляем клиенту).
- **R8:** аватары/◆ — через Worker Model (`author_type` human/agent/system).

### Альтернативы (отклонены)

- **Оставить в `task_events` + carve-out в GC:** одна таблица с двумя
  retention-политиками — ловушка для будущих GC-рефакторов; JSONB-авторство.
- **Только RPC-merge в JS без новой таблицы:** не решает durability/авторство.

### Последствия

- Миграция 076 дропнула `task_events_insert_comment` (закрытие п.3).
- Route Handlers `GET/POST /api/tasks/:id/comments`; UI — `TaskCommentsPanel`.
- Обновлены: flow §22, Master §6.10/§6.10-бис/§9.
