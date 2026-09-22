# Architectural Decisions (ADR log)

## ADR-2026-09-22: Agent Connectors — Onitask-as-Runtime для внешних агентов (Stage 15)

### Контекст

Пользователь подключает агента парой «endpoint + API-ключ» (эталон — Drift:
OpenAI-совместимый `/v1/chat/completions`, ключ `dft_…`, синхронный ответ ~8.6 с,
базовый prompt ~13.5k токенов). Onitask должен сам отправить задачу, проверить
исполнение и забрать результат. Прежняя модель требовала внешнего pull-рантайма
(MCP/CLI сам зовёт `ops_lease`), а wake-webhook из миграции `061` был удалён в `072`
как нереализованный — механизма push-доставки не было вообще.

### Решение

1. **Вариант A — Onitask-as-Runtime.** Edge Function `agent-runtime` ведёт тот же цикл,
   что внешний рантайм: `ops_lease → контекст → вызов агента → ops_terminal → ops_ack`.
   Второго пути к `tasks` не появляется: INV-04 (терминал только через ops), INV-09
   (CAS по `version`) и фенсинг (`execution_id` + `runtime_id`) сохраняются.
2. **Доставка: pg_net push** (триггер `AFTER INSERT` на `dispatch_outbox`) в горячем пути,
   **cron-sweeper 30 с** — полнота (потерянный push, `next_poll_at`, осиротевшие прогоны),
   reaper `067` — инвариант. Realtime остаётся wake для pull-рантаймов и live-UI.
3. **Секреты — Vault** (`agent_connector_set/get/delete_secret`), наружу только `secret_hint`
   (INV-19). Ключ агента не покидает сервер и не попадает в логи/дайджесты.
4. **Свой секрет вызова рантайма** (`get_agent_runtime_secret`) + `verify_jwt=false`:
   vault `service_role_key` расходится с env функции (новый формат ключей), а hex-секрет
   не является JWT — обе причины давали 401 (поймано smoke-тестом). Авторизация —
   timing-safe сравнение, вызовы делает только БД (cron/триггер).
5. **UI-канал:** «Добавить агента» открывает `AgentConnectorSheet` (Название/URL/API Key);
   сервер валидирует бесплатным `GET /models` (0 токенов) и только потом создаёт коннектор
   и воркера (`ops_ensure_worker`, INV-04) — «подключения без ключа» и пустых воркеров нет.

### Альтернативы (отклонены)

- **Agent-as-Runtime (B)**: Drift сам вызывает `ops_lease` через наш MCP — доставка зависит
  от «пробуждённости» и дисциплины LLM, а broadcast по канону проекта это wake, не доставка.
  Оставляем как будущий адаптер (`kind='mcp_runtime'`), интерфейс уже заложен.
- **`postgres_changes` как доставка**: нет реплея для offline-потребителей, требует
  RNL/JWT-инфраструктуры, риск RLS-утечек outbox.
- **Always-on раннер на нашей инфраструктуре**: противоречит Canon v1.3 (Runtime — сторона
  пользователя) и добавляет нам аптайм; возможен в P2 для прогонов >400 с.

### Последствия

- Прогон ограничен платформенным wall-clock Edge (150/400 с): свой таймаут режем до 120 с,
  провал → `ops_nack` (requeue либо escalate на `max_attempts`) — «тихого зависания» нет.
- Гарантия at-least-once: дубль прогона возможен, потеря результата — нет (БД источник истины).
- У Drift нет `session_id`/job-id → обрыв соединения = потеря результата прогона (риск R9);
  при появлении async-режима добавляется адаптер `async_task` без изменения схемы.
- Стоимость прогонов оплачивает пользователь своим ключом → лимиты и `usage` в `agent_runs`
  обязательны (stop-cran UC-10 — следующий слайс).

### Факт (2026-09-22)

Миграции `089`/`090`/`091` применены; Edge Function `agent-runtime` v3 задеплоена;
push/sweep → 200, мусорный токен → 401, cron → 200; 33 unit-теста на SSRF/probe и
валидаторы — зелёные; UI-канал собран. Открыто: боевой E2E-прогон (DS-07), статусы и
стоимость в UI (DS-08), MCP-инъекция read-only ключа (DS-09).

---

## ADR-2026-09-11: Реинтродукция @tanstack/react-query — управление серверным состоянием (FILE-09)

**Статус:** принято · **Задачи:** FILE-09 (выполнено), FILE-10/11 (follow-up)

### Контекст

`@tanstack/react-query` и `zustand` были удалены в CLEANUP (28ed059, 2026-09-09) как
неиспользуемые. Проверка git-истории: react-query добавлен в Initial commit и **никогда
не импортировался** (0 импортов в src/ перед cleanup); zustand — один store на 20 строк,
добавлен и откачён в один день (2026-08-07). Т.е. удаляли мёртвые депы, а не работающий
механизм — удаление было корректным.

Позже вскрылись три задачи, требующие кэша серверного состояния: гонка файлов между
задачами (файлы A показывались в шторке B), повторная загрузка манифеста на каждое
открытие, сломанное скачивание в TWA. Для «постоянно открытого серверного состояния»
react-query — канонический инструмент; ручной TTL-кэш переизобретал бы его хуже
(изоляция ключей — самое хрупкое место, и именно его react-query решает by design).

### Решение

- **@tanstack/react-query v5 возвращается** осознанно: attachments — первый потребитель
  (`useQuery` + `['task-attachments', taskId]`), комментарии с пагинацией — второй
  (FILE-10, follow-up **до** коммита зафиксирован в TASKS.md — гарант против
  «зомби-зависимости №2»).
- **zustand НЕ возвращается** — state manager, не query-кэш; для серверного состояния
  не подходит.
- Дефолты QueryClient (TWA-специфика): `staleTime: 60_000`, `gcTime: 30*60_000`,
  `retry: 1` (не штормить при 401 после истечения initData 24ч),
  `refetchOnWindowFocus: false` (focus-события webview ненадёжны).
- Модель триггеров: свои мутации — мгновенно через `setQueryData` + invalidate после
  каскада; внешние писатели (агент/бот/другой юзер) — фоновый refetch по staleTime.
  Живое обновление открытой шторки — Phase 2 (FILE-11, Realtime, требует security-review).
- Скачивание — on-demand подпись (POST `[attachmentId]`, `download: filename`) +
  `Telegram.WebApp.openLink` → fallback `window.open`; signed URL не кэшируются
  и не живут в клиентской памяти.

### Факт (2026-09-12)

FILE-12 выполнен: комментарии — второй гарантированный потребитель React Query
(`useInfiniteQuery`, ключ `['task-feed', taskId]`, optimistic-сабмит и broadcast через
`setQueryData`). «Зомби-зависимость №2» исключена.


### Триггер пересмотра

Если FILE-10 (комментарии) не будет реализован в течение разумного срока после
FILE-09 — реактивировать обсуждение: single-use зависимость против философии
CLEANUP. Третий+ read-ресурс (метрики, воркспейс-документы) — автоматическое
обоснование.

---

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
