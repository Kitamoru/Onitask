# Architectural Decisions (ADR log)

## ADR-2026-09-10: Файлы задач — вариант B (Storage + манифест), base64 только транспорт (FILE-01..08)

**Статус:** принято · **Задачи:** FILE-01..08 (TASKS.md Stage 14)

### Контекст

Понадобился обмен файлами агент ↔ человек через Telegram + прикрепление файлов к задачам
(TWA и бот). Два архитектурных решения обсуждены детально:

- **Вариант A:** хранить base64 прямо в `task_executions.attachments` (JSONB) — без bucket.
  Проблемы: раздувание JSONB (3MB → ~4MB на строку), GC `gc_ops_history` (073, 30 дней)
  сжигает файлы вместе с execution, retry `ops_terminal` (version_conflict) дублирует файлы
  без idempotency-ключа.
- **Вариант B (принят):** Storage bucket `task-attachments` (бинарник, приватный) + таблица
  `task_attachments` (манифест). base64 — ТОЛЬКО транспорт для JSON-каналов агента
  (ops_terminal / send_message_to_chat), декодируется на сервере и не хранится.

### Решение

- **F1:** `task_attachments` — манифест (workspace/task/execution/filename/mime/size/path/source/author_type).
  `execution_id` + `UNIQUE(execution_id, filename)` → идемпотентный retry ops_terminal.
  Каскад строк — ON DELETE CASCADE; бинарники — явный `storage.remove()` в `DELETE /api/tasks/[id]`
  (порядок: файлы из Storage → DELETE tasks) + GC-сирот (Phase 2).
- **F2:** reply-маппинг `bot_task_messages` (UNIQUE(chat_id, message_id)) — флоу «reply на карточку + файл →
  прикрепить». Пишут webhook (карточки /task) и bot-notify (task_review/task_done карточки,
  локальный helper с ON CONFLICT DO NOTHING).
- **F3:** `send_message_to_chat` + `attachments[]` + `task_id` → inline-кнопка «Обсудить задачу»
  (deep-link `task_<full_id>_comments` → TaskViewEdit вкладка Комментарии). Доставка через
  `telegram_message_queue`, консьюмер — bot-notify `drainTelegramMessageQueue` (чинит MCP-15).
- **F4:** входящие файлы в TG: `/attach` (reply/full_id), файл+caption→задача+attach,
  буфер `bot_attach_pending` (TTL 15 мин). full_id — всегда явно, списки задач в TG не показываем.
- **F5:** TWA — блок «📎 Файлы» в TaskViewEdit (GET-подгрузка при открытии, multipart-upload).
  Убран toggle «Зависимые задачи» (UI-only артефакт `metadata.dependent_tasks`, не `task_relations`).
- **F6:** входные файлы агенту — `get_task_context` + `include_attachments` (манифест + signed URL TTL 1ч,
  не base64; default false по CTX-02).
- **F7:** MIME — whitelist app-level (`lib/shared/attachments.ts`, НЕ CHECK в БД) + magic-bytes;
  лимиты ≤5 файлов, ≤2MB/файл (base64), ≤3MB суммарно.
- **F8:** duty poll — read-only MCP tool `get_task_comments` (обёртка над RPC `get_task_feed`).
  Realtime (`task-comments-<task_id>`) — перспектива (вариант B, не MVP).

### Последствия

- Хранение файлов едино: Storage + манифест; base64 живёт только в транзите (JSON MCP / outbox-очередь,
  GC telegram_message_queue 7 дней).
- Идемпотентность retry ops_terminal без дублей; файлы переживают GC execution.
- Две изолированные сущности: `documents` (Knowledge Base, RAG) и `task-attachments` (артефакты задач) — не смешиваются.

---

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
