# onitask · Индекс документации

**Версия:** 2.8.0 · июль 2026

---

## Файлы

| Файл | Содержимое |
|---|---|
| `onitask_Architecture_Master_.md` | Инварианты (INV-01…INV-16), аксиомы (A-1…A-12), полная схема БД, task_relations, `data_sharing_level`, `mcp_api_keys`, конкурентность, retention |
| `onitask_ai_.md` | F-01 Cognitive Budget, F-03 Enrichment (RAG + implicit calibration + embedding cache + data_sharing_level), F-04 Instant Parse, F-06 MCP Router, Workspace Context Rebuild Pipeline, LTM Pipeline + Injection Linter |
| `onitask_flow_.md` | Flow Board UX, колонки, роли, Stream, аномалии, AI Flow Summary, Risk Pulse, Worker Sheet, Operator Queue, Task Sheet (Блокировки), Workspace Manager |
| `src/app/boards/page.tsx` | Boards Overview Page ("Стол") — RiskPulse сводка по всем доскам + список досок пользователя с карточками (BoardCard) |
| `onitask_team_tab.md` | ⚠️ Deprecated (v1.3.0) — SQL-запросы velocity/агентов, escalate_task MCP tool, Operator Queue SQL (справочник) |
| `onitask_bot.md` | Bot команды, workspace resolution, freemium, сценарии, Realtime-уведомления, output sanitization (escapeHtml, sanitizeOutput), Bot Notify Worker (§6.5, личная доставка + broadcast) |
| `onitask_calendar_.md` | Модуль «Календарь»: провайдеры Yandex/Outlook, OAuth flow, синхронизация, напоминания через бота, UI календаря, лицензионные ограничения |
| `onitask_mcp_contract_.md` | MCP tools: сигнатуры, blocked_by, subgraph, smart backlog, cascade unblock, allowed_tools scopes, rate limit, DFS cycle check, ошибки, рекомендации агентам *(операционное приложение)* |
| `onitask_sql_anomalies_.md` | SQL-вьюхи (orphan_blockers, handoff_chain), триггеры (cascade_unblock, handoff_chain_alert), воркер аномалий *(операционное приложение)* |
| `onitask_security_.md` | OWASP LLM Top 10 (2025): Prompt Injection (JSON mode, UUID-теги, LTM linter), data_sharing_level уровни, MCP allowed_tools scopes, HTML sanitization, DFS cycle detection, тест-векторы, pre-deploy чеклист *(операционное приложение)* |
| `onitask_product_vision.md` | Production Vision, JTBD, ODI-метрики, Four Forces, User Stories с AC, AI Security Principles, бренд |
| `onitask_dev_setup.md` | Dev Setup: структура проекта, build sequence, типизация Supabase, CI, переменные окружения, **§7 API-контракты MVP** |
| `supabase/migrations/001_init.sql` | Полная DDL-схема нового Supabase-проекта (канонический SQL, основан на Master Spec) |
| `supabase/migrations/002_rls.sql` | RLS-политики: helper-функции, 21 таблица, модель безопасности |

**Правило:** Master — всегда. Feature — по задаче. Операционные приложения — по конкретной реализации.

---

## Что делаю → что читаю

### Безопасность (Security Layer v0.13.0)

| Задача | Master | Feature |
|---|---|---|
| Понять архитектуру Security Layer | ✅ INV-15, A-2, A-7 | ✅ security §1–5 |
| Настроить data_sharing_level для workspace | ✅ 6.4, INV-15 | ✅ security §2.1 |
| Понять что передаётся провайдерам на каждом уровне | — | ✅ security §2.1 (таблица уровней) |
| Настроить allowed_tools для API-ключа агента | ✅ 6.4 | ✅ security §3.1, mcp_contract §2 |
| Реализовать MCP Middleware (allowed_tools enforcement) | ✅ A-2, A-7 | ✅ security §3.1, mcp_contract §2 |
| Реализовать rate limit для create_task | ✅ 6.4 (mcp_api_keys) | ✅ security §3.3, mcp_contract §4 |
| Реализовать DFS cycle detection (blocked_by) | ✅ 6.16 | ✅ security §5.1, mcp_contract §4 |
| Реализовать JSON mode для F-03 / F-04 | — | ✅ security §1.1, ai §2.3, ai §3.4 |
| Реализовать UUID-теги изоляции данных в промпте | — | ✅ security §1.2, ai §2.2 |
| Реализовать LTM Injection Linter | — | ✅ security §1.3, ai §5.1 |
| Реализовать sanitizeOutput() для Telegram | — | ✅ security §4.1, bot §6.3, mcp_contract §4 |
| Реализовать escapeHtml() для bot-шаблонов | — | ✅ security §4.3, bot §5.6, bot §6.2 |
| Настроить ESLint no-danger для TWA | — | ✅ security §4.2 |
| Провести security тестирование | — | ✅ security §6 (тест-векторы + чеклист) |

### База данных и инфраструктура

| Задача | Master | Feature |
|---|---|---|
| Написать миграцию (любую) | ✅ раздел 6 | — |
| Добавить поле в tasks | ✅ 6.1 | — |
| Настроить pg_cron / GC jobs | ✅ 9 | — |
| Реализовать optimistic locking (version) | ✅ 7.1 | — |
| Написать atomic quota RPC | ✅ аксиома A-3 | — |
| Добавить настройку в workspace_settings | ✅ 6.4, 8 | — |
| Настроить cron-алерты и триггеры аномалий | ✅ 9 | ✅ sql_anomalies §4–5 |

### Relational Context Layer (v0.12.0)

| Задача | Master | Feature |
|---|---|---|
| Понять архитектуру Relational Context Layer | ✅ A-12, INV-13, INV-14 | — |
| Создать таблицу task_relations (DDL) | ✅ 6.16 | — |
| Реализовать get_task_subgraph RPC | ✅ 6.16 | ✅ mcp_contract §4 (get_task_context) |
| Реализовать trg_cascade_unblock | ✅ 6.16 | ✅ sql_anomalies §5 (контракт триггеров) |
| Реализовать trg_context_invalidate | ✅ 6.16 | ✅ ai §2.9 (Workspace Context Rebuild) |
| Построить Workspace Context Rebuild Pipeline | ✅ 6.4, 6.5, A-12 | ✅ ai §2.9 |
| Реализовать Blocker Chain в Task Sheet | ✅ 6.16 | ✅ flow §22 |
| Реализовать Cascade Unblock toast | ✅ 6.16 (trg_cascade_unblock) | ✅ flow §13 |
| Реализовать Smart Backlog для агентов | ✅ 6.16 (task_relations) | ✅ mcp_contract §7 п.12 |
| Добавить orphan_blocker аномалию | ✅ 6.16 | ✅ sql_anomalies §3.10, §4 |
| Добавить handoff_chain аномалию | ✅ 6.7 (agent_events) | ✅ sql_anomalies §3.11, §5.7 |
| Реализовать blocked_by в create_task (MCP) | ✅ 6.16 (INV-13) | ✅ mcp_contract §4 (create_task) |
| Добавить blocked_by UI в Task Sheet | ✅ 6.16 | ✅ flow §22 |
| Понять путь миграции к entity_registry | ✅ 6.16 (примечание о миграции), A-12 | — |
| Настроить индексы task_relations | ✅ 6.16 | ✅ sql_anomalies §8 |
| Настроить weight-decay pg_cron (future) | ✅ 9 (placeholder) | — |

### AI-модули

| Задача | Master | Feature |
|---|---|---|
| Реализовать F-01 Cognitive Budget | ✅ инварианты, A-9 | ✅ ai §1 |
| Написать F-03 Edge Function (enrichment) | ✅ 6.5, 6.6, 7.2 | ✅ ai §2 |
| Реализовать retrieval через get_task_subgraph (структурный граф) | ✅ 6.16, A-12 | ✅ ai §2.2 шаг 1.5 |
| Реализовать implicit calibration через assignment_history | ✅ 6.14 | ✅ ai §2.2 шаг 4 |
| Реализовать workspace_context_cache в промпте F-03 | ✅ 6.4, INV-14 | ✅ ai §2.3 |
| Реализовать workspace_context_cache в промпте F-04 | ✅ 6.4, INV-14 | ✅ ai §3.4 |
| Реализовать retry / backoff для enrichment | ✅ 7.3 | ✅ ai §2.6 |
| Реализовать версионную защиту tasks при enrichment | ✅ 7.2, A-5 | ✅ ai §2.7 |
| Реализовать Workspace Context Rebuild Pipeline | ✅ 6.4, 6.5, 6.16 | ✅ ai §2.9 |
| Реализовать F-04 Intelligent Ingress (голос/текст/рерайт) | ✅ A-1, A-5, 6.1, 6.4 | ✅ ai §3 |
| Реализовать Gatekeeper (skip/light/standard) | ✅ A-5, INV-08 | ✅ ai §3.5 |
| Реализовать Correction Sheet (TWA) | — | ✅ ai §3.7 |
| Реализовать MCP create_task адаптер (blocked_by + новые поля) | ✅ 6.1, 6.16 | ✅ ai §3.9, mcp_contract §4 |
| Написать MCP Router (F-06) | ✅ 6.7, A-2/A-3/A-7 | ✅ ai §4 |
| Реализовать Memory Consolidation Pipeline | ✅ 6.8, 6.10, 9 | ✅ ai §5 |

### Flow Board

| Задача | Master | Feature |
|---|---|---|
| Написать `/api/flow/metrics` Edge Function | ✅ 4, 6.2, 6.3 | ✅ flow §9–10 |
| Настроить аномалии (stuck, overload, bottleneck, orphan, handoff_chain) | ✅ 8 | ✅ flow §11, sql_anomalies §3–5 |
| Реализовать SQL-детекцию аномалий | ✅ 8 (flow_config) | ✅ sql_anomalies §3–5 |
| Реализовать AI Flow Summary | ✅ A-6 | ✅ flow §12 |
| Построить UI колонок / Worker Load | ✅ 4 (workers) | ✅ flow §13 |
| Роли и права доступа в Flow | ✅ A-8 | ✅ flow §3 |

### Team Tab → Flow Board (перенесено)

> Team Tab упразднён. UX перенесён в Flow Board §19–22. SQL-запросы в `onitask_team_tab.md`.

| Задача | Master | Feature |
|---|---|---|
| Написать SQL velocity участника | ✅ 6.3, 6.4 | ✅ team_tab §4.1 (справочник) |
| Написать SQL метрик агента | ✅ 6.3, 6.7 | ✅ team_tab §4.2 (справочник) |
| Реализовать escalate_task MCP tool | ✅ 6.1 (поля tasks) | ✅ team_tab §3 (справочник) |
| Построить Risk Pulse (Люди/Процессы/Эскалации) | ✅ A-9, F-01 | ✅ flow §19 |
| Построить Worker Sheet (люди + агенты) | ✅ 6.3, 6.7 | ✅ flow §20–21 |
| Реализовать Operator Queue | ✅ 6.1 (needs_human) | ✅ flow §21, team_tab §2.7 (SQL) |
| Построить Task Sheet (Детали + Блокировки + Комментарии) | ✅ 6.10, 6.16 | ✅ flow §22 |
| Построить Workspace Manager | ✅ A-7 | ✅ flow §23 |
| Реализовать Invite FAB | — | ✅ team_tab §2.6 (справочник) |

### MCP / Agent Interface

| Задача | Master | Feature |
|---|---|---|
| Посмотреть сигнатуры MCP tools | ✅ A-2/A-3/A-7 | ✅ mcp_contract §3–4 |
| Добавить новый MCP tool | ✅ 6.1 (agent_events CHECK) | ✅ mcp_contract §3–4 |
| Реализовать undo endpoint | ✅ 6.7 (agent_events) | ✅ mcp_contract §4 |
| Обработка ошибок в агенте | — | ✅ mcp_contract §6 |
| Рекомендации для агентов | — | ✅ mcp_contract §7 |
| Smart Backlog (sort_by_blocking_value) | ✅ 6.16 | ✅ mcp_contract §7 п.12 |
| Cascade Unblock (unblocked_ids в move_task) | ✅ 6.16 | ✅ mcp_contract §7 п.13 |
| blocked_by в create_task | ✅ 6.16, INV-13 | ✅ mcp_contract §4 (create_task) |
| subgraph в get_task_context | ✅ 6.16 | ✅ mcp_contract §4 (get_task_context) |

### Telegram Bot

| Задача | Master | Feature |
|---|---|---|
| Написать Bot webhook handler | ✅ 6.9 | ✅ bot §6.1 |
| Адаптировать F-04 для бота | ✅ A-1 | ✅ bot §6.2, ai §3 |
| Реализовать workspace resolution | — | ✅ bot §3 |
| Настроить Realtime-уведомления | ✅ 6.9 | ✅ bot §6.4 |
| Freemium проверки в боте | — | ✅ bot §4 |
| Реализовать Bot Notify Worker (доставка bot_notify) | ✅ 6.5 (enrichment_queue), 9 (bot-notify-fallback) | ✅ bot §6.5, security §4.1 |
| Реализовать личную доставку (target_worker_id → DM) | ✅ 6.19 | ✅ bot §6.5.1, calendar §5 |

### Календарь

| Задача | Master | Feature |
|---|---|---|
| Понять архитектуру модуля Calendar | ✅ 6.19, INV-17 | ✅ calendar §1–2 |
| Создать миграцию calendar_events/calendar_connections | ✅ 6.19 | ✅ supabase/migrations/009 |
| Реализовать Edge Function calendar_sync | ✅ A-1, 6.19 | ✅ calendar §4 |
| Реализовать Edge Function calendar_reminder | ✅ 6.19, bot §6.5.1 | ✅ calendar §5 |
| Построить UI календаря (React-Day-Picker) | — | ✅ calendar §6.2 |
| Подключить OAuth Yandex/Outlook | ✅ 6.19, INV-17 | ✅ calendar §3 |

### Продукт и стратегия

| Задача | Master | Feature |
|---|---|---|
| Изучить JTBD и ODI-метрики | — | ✅ product_vision §2–3 |
| Посмотреть User Stories с AC | — | ✅ product_vision §6 |
| Проверить AI Security Principles | — | ✅ product_vision §8 |
| Посмотреть цветовую систему и голос бренда | — | ✅ product_vision §9 |
| Найти термин в глоссарии | — | ✅ product_vision §10 |

### Dev Setup и CI

| Задача | Master | Feature |
|---|---|---|
| Посмотреть структуру проекта | — | ✅ dev_setup §2 |
| Узнать последовательность разработки | — | ✅ dev_setup §3 |
| Настроить типизацию Supabase в CI | — | ✅ dev_setup §4 |
| Локальная разработка и тестирование MCP | — | ✅ dev_setup §6 |

---

## Модели (LLM stack)

| Контур | Модель | Провайдер | Лимит |
|---|---|---|---|
| Hot Path · F-04 Parse, F-06 summary | llama-3.3-70b-versatile | Groq | free tier |
| Hot Path · F-04 STT | whisper-large-v3-turbo | Groq | free tier |
| Cold Path · F-03 Enrichment, AI Flow Summary | GPT-OSS-120B | NeuralDeep Hub | 60 RPM |
| Cold Path · Workspace Context Rebuild (§2.9) | GPT-OSS-120B | NeuralDeep Hub | 60 RPM (общий) |
| Embeddings · F-03 RAG (tasks + docs + LTM) | bge-m3 | NeuralDeep Hub | 60 RPM (общий с Cold Path) |
| Reranker (post-MVP, task count > 1000) | bge-reranker-v2-m3 | NeuralDeep Hub | — |

> **Важно:** Cold Path, Workspace Context Rebuild и Embeddings делят 60 RPM NeuralDeep.
> Все три идут через `enrichment_queue` с приоритетами: `card (1)` > `workspace_context_rebuild (2)` > `doc_process (3)`.
> Дросселирование автоматически снижает давление на лимит.

---

## Версии

| Файл | Версия |
|---|---|
| onitask_Architecture_Master_.md | **0.14.0** |
| onitask_ai_.md | **0.10.1** |
| onitask_flow_.md | **3.6.0** |
| onitask_team_tab.md | **1.3.0 (Deprecated)** |
| onitask_bot.md | **0.7.0** |
| onitask_calendar_.md | **0.1.0 (новый)** |
| onitask_mcp_contract_.md | **0.7.1** |
| onitask_sql_anomalies_.md | **1.6** |
| onitask_security_.md | **0.1.1** |
| onitask_product_vision.md | 1.0.0 |
| onitask_dev_setup.md | **0.2.2** |
| supabase/migrations/001_init.sql | **1.0.0 (новый)** |
| supabase/migrations/002_rls.sql | **1.0.0 (новый)** |

---

## Changelog (актуальный)

**Master v0.14.0 / bot v0.7.0 / calendar v0.1.0 / INDEX v2.8.0 — июль 2026**

**Модуль «Календарь»:**
- Новый файл `onitask_calendar_.md` v0.1.0: спецификация модуля, провайдеры Yandex/Outlook,
  OAuth flow, синхронизация через Edge Functions, напоминания через enrichment_queue,
  UX-макеты, roadmap
- Master §6.19 (новый): таблицы `calendar_events`, `calendar_connections`; триггеры
  `trg_schedule_calendar_reminder`, `trg_cancel_calendar_reminder`, `trg_validate_calendar_times`;
  RLS-политики; INV-17 (шифрование OAuth-токенов); типы событий enrichment_queue; маршрутизация
  напоминаний через `target_worker_id`; политика хранения
- Migration `009_calendar_events.sql`: DDL таблиц, индексы, триггеры, RLS
- bot §6.5: расширение контракта Bot Notify Worker — поддержка `target_worker_id` для личной
  доставки (DM) vs broadcast; приоритет calendar_reminder в ORDER BY воркера
- bot §6.5.1 (новый): личная доставка — резолвинг worker → profile.telegram_id, обработка 403
- bot §6.5.2 (новый): broadcast — текущее поведение при отсутствии target_worker_id
- INDEX: раздел «Календарь», обновлённые версии Master/bot/calendar

---

**Master v0.13.4 / bot v0.6.0 / security v0.1.1 / dev_setup v0.2.2 / INDEX v2.7.4 — июнь 2026**

**Bot Notify Worker — закрытие архитектурного пробела, найденного при сверке дерева `dev_setup.md` с фактическими контрактами:**

- `dev_setup.md` §2.2/§2.3: дерево проекта синхронизировано с уже утверждёнными контрактами —
  добавлены 7 забытых в дереве маршрутов (`tasks/[id]/relations`, `mcp/get_task_context`,
  `mcp/handoff_task`, `workspaces/summary`, `bot/task/[fullId]`, `bot/task/[fullId]/resolve`,
  `bot/standup/[workspaceId]`) и Edge Function `bot-notify/`. Новой логики не вводит
- `bot.md` §6.5 (новый раздел): полный контракт Bot Notify Worker — единая точка доставки
  всех алертов из `enrichment_queue (type='bot_notify')`. Архитектура: DB Webhook (мгновенная
  доставка) + hourly pg_cron fallback (паттерн, консистентный с `workspace_context_rebuild`,
  Master §6.16/§9). `POST /api/bot/notify` зафиксирован как внутренний хелпер
  (sanitize + Bot API), не для внешних агентов. Документированы 6 источников записей,
  полный флоу воркера, retry/backoff при `429` от Telegram
- `security.md` §4.1: исправлена ссылка на несуществующую «Edge Function bot_notify воркер» —
  заменена на ссылку на реальный контракт `bot.md §6.5`
- `Master` §9: добавлен pg_cron job `bot-notify-fallback` (hourly), симметричный
  `workspace-context-fallback`
- ⚠️ **Follow-up:** `supabase/migrations/001_init.sql` должен получить `cron.schedule('bot-notify-fallback', ...)`
  вслед за Master (правило §10 — миграции не должны отставать от Master после мержа)

---

**Master v0.13.3 / ai v0.10.1 / mcp_contract v0.7.1 / dev_setup v0.2.1 / INDEX v2.7.3 — июнь 2026**

*New Supabase project init — закрытие блокеров документационного аудита:*

- Master §1: INV-16 — `/api/init` find-or-create только; автообновление `display_name`/`avatar_url`
  запрещено (автосинхронизация с Telegram ломает ожидания тимлида)
- Master §4: `workers.role text CHECK('owner','admin','member','viewer')` добавлен в DDL;
  NULL для агентов; смена role только через service role
- Master §6.1: `tracker.columns` — ALTER заменён на полный `CREATE TABLE` с FK `workspace_id`
  (tracker.projects упразднён); добавлен `trg_init_workspace_columns` (авто-сид 4 колонок)
- Master §6.1: tasks — `embedding_hash text`, `embedding_updated_at timestamptz`;
  `trg_invalidate_task_embedding` (cache-hit не обновляет `embedding_updated_at`)
- Master §6.17 (новый): `public.profiles` — DDL, `idx_profiles_telegram`, ссылка на INV-16
- Master §6.18 (новый): `public.invite_links` — DDL, два partial-индекса,
  `created_by → workers(id)`, семантика одного активного инвайта на workspace
- Master §10: раздел «Миграции» в иерархии документации
- ai §2.2: embedding cache — SHA-256 через Web Crypto API; cache-hit пропускает NeuralDeep;
  `model_used='cached'` при hit (обязательно); шаг 3.5 удалён (перенесён в шаг 2)
- mcp_contract §4: `priority 'normal' → 'medium'` (sync с tasks CHECK constraint и product_vision §6)
- dev_setup §7 (новый): API-контракты MVP — `/api/init` (find-or-create, INV-16),
  `GET /api/tasks` (без пагинации), `PATCH /api/tasks/[id]` (last-write-wins в TWA),
  `POST /api/workspaces` (транзакция + автотриггеры)
- Добавлены migration files: `001_init.sql v1.0.0`, `002_rls.sql v1.0.0`

---

**Master v0.13.2 — июнь 2026**

- §6.4: `workspace_context` hard limit снижен с 2000 до **800 символов**.
  UI-зоны: зелёная 0–600, amber 601–720, red 721–800, блокировка > 800.

---

**Master v0.13.1 / INDEX v2.7.1 — июнь 2026**

- Master §6.4: `workspace_context` hard limit снижен с 2000 до 800 символов.
  UI-зоны: зелёная 0–600, amber 601–720, red 721–800, блокировка > 800.
  Миграция: `LEFT(workspace_context, 800)` до применения нового CHECK.

---

**Master v0.13.0 / ai v0.10.0 / mcp_contract v0.7.0 / bot v0.5.0 / security v0.1.0 (NEW) / INDEX v2.7.0 — июнь 2026**

**Security Layer (OWASP LLM Top 10 2025) — hardening по результатам аудита (рейтинг до: 4.1/10):**

*Master v0.13.0:*
- §1: INV-15 — `data_sharing_level='full'` требует DPA с NeuralDeep Hub (IP-риск: doc RAG без порога);
  `minimal`/`standard` DPA не требуют; `assignment_history` — псевдоним. UUID (GDPR Recital 26)
- §6.4: `workspace_settings` — `data_sharing_level text DEFAULT 'standard'` (три уровня изоляции:
  minimal/standard/full); `mcp_api_keys jsonb DEFAULT '{}'` (allowed_tools per key, legacy mode `{}` = all)
- §8: consumers расширены — F-03, F-04 читают `data_sharing_level`; MCP читает `mcp_api_keys`;
  добавлен Security Layer как consumer; структура `mcp_api_keys` задокументирована
- §9: pg_cron `enrichment-failure-alert` (hourly) — алерт при ≥5 failed enrichments/час (Path A, A-6 intact)

*ai v0.10.0:*
- §2.2: settings SELECT + `data_sharing_level`; UUID-теги `wrapData()` per-request; `sharingLevel` const;
  Doc RAG branching (minimal=skip, standard=sim≥0.68, full=no threshold); LTM guard `!== 'minimal'`;
  `source_origin='doc_rag'` в meta_headers при индексации
- §2.3: JSON mode задокументирован как обязательный для F-03; UUID-инструкция в тело промпта;
  `workspaceContextCacheBlock` guard `!== 'minimal'`; три рубежа защиты задокументированы
- §3.4: settings SELECT + `data_sharing_level`; JSON mode + `sharingLevel`; cache block guard `!== 'minimal'`
- §5.1: LTM Injection Linter — 5 regex-паттернов перед INSERT в `agent_memory`; блокировка + лог в
  `consolidation_errors`; retry через cron при срабатывании

*mcp_contract v0.7.0:*
- §2: 3-уровневая Middleware проверка (timingSafeEqual + Tenant + Allowed Tools); исправлена
  некорректная ссылка на «JWT-сессию» → Bearer token + `mcp_api_keys`; TypeScript legacy mode
- §4 `create_task`: rate limit 50/min (NeuralDeep 60 RPM обоснование); DFS cycle check + `409 circular_dependency`
- §4 `send_message_to_chat`: `can_send_messages` check; HTML sanitization whitelist; 4096 символов max
- §5: Security Layer гарантии (Allowed Tools, Rate Limit, DFS, HTML sanitization)
- §6: три новых ошибки — `403 tool_not_permitted`, `409 circular_dependency`, `429 task_creation_rate_limit`
- §7 п.14 (новый): стратегии при `tool_not_permitted` и `task_creation_rate_limit`
- §8: примеры всех новых ошибок

*bot v0.5.0:*
- §5.6: `escapeHtml()` реализация в правилах форматирования standup-дайджеста
- §6.2: комментарий `escapeHtml()` в `buildConfirmation()`
- §6.3: `sanitizeOutput(text, 'tg')` TypeScript реализация; ссылка на mcp_contract §4

*security v0.1.0 (НОВЫЙ ФАЙЛ):*
- §1 Prompt Injection: JSON mode (F-03/F-04), UUID-теги wrapData(), LTM Injection Linter (5 паттернов)
- §2 Info Disclosure: data_sharing_level таблица уровней; GDPR Recital 26 обоснование; IP-риск full
- §3 Excessive Agency: allowed_tools профили; legacy mode; rate limit 50/min обоснование; Phase 2 approval queue
- §4 Output Handling: sanitizeOutput() + escapeHtml() реализации; таблица атак; ESLint no-danger
- §5 Plugin Design: DFS cycle detection TypeScript; производительность; fallback
- §6 Testing: 5 prompt injection векторов; 4 MCP adversarial сценария; pre-deploy чеклист (15 пунктов)

---

**Master v0.12.0 / ai v0.9.0 / flow v3.6.0 / mcp_contract v0.6.0 / sql_anomalies v1.6 / INDEX v2.6.0 — июнь 2026**

**Relational Context Layer (A-12) — структурный слой знаний поверх semantic RAG:**

*Master v0.12.0:*
- §1: INV-13 — `task_relations.workspace_id` явно при каждом INSERT; INV-14 — строгое разделение `workspace_context` (manual, Admin) и `workspace_context_cache` (derived, system)
- §3: аксиома A-12 «Relational Context Layer» — `task_relations` как структурный слой; три типа отношений с иммутабельной шкалой весов (`blocks`=1.0, `spawned_from`=0.8, `mentions`=0.3); двухуровневый JOIN без recursive CTE; fallback на `match_tasks()` при пустом графе; путь миграции к `entity_registry` при cross-entity traversal
- §6.4: `workspace_settings` — `workspace_context_cache text` (max 500 chars, system-only, INV-14), `context_stale boolean DEFAULT false`
- §6.5: `enrichment_queue` — тип `workspace_context_rebuild`; UNIQUE dedup-индекс; приоритет 2 в ORDER BY воркера
- §6.16 (новый): таблица `task_relations` — DDL, 4 индекса; RPC `get_task_subgraph` (depth 1 все типы, depth 2 только blocks); `trg_cascade_unblock` (AFTER UPDATE column → снимает is_blocked downstream, queue cascade_unblock); `trg_context_invalidate` (5 событий → stale + rebuild); placeholder `trg_mentions_parse` (Phase 1.1); примечание о миграции к entity_registry с SQL-шагами
- §9: pg_cron — `workspace-context-fallback` (hourly страховка); `weight-decay` (placeholder, неактивен)

*sql_anomalies v1.6:*
- §3.10 (новый): VIEW `orphan_blockers` — `is_blocked=true` без активных блокеров в task_relations; Phantom Block сценарий; примечание о данных до v0.12.0
- §3.11 (новый): VIEW `handoff_chain` — ≥3 handoff за 7 дней без done; порог кратности задокументирован; исключены `needs_human=true` задачи
- §3.9: примечание Phase 1.1 — `blocking_depth` из task_relations (вес ×8) повысит точность на 15–20%
- §4: Edge Function расширена блоками 6 (`orphan_blocker`) и 7 (`handoff_chain`); таблица допустимых alert_type
- §5.5: удалён дублирующийся код (баг v1.5)
- §5.7 (новый): `trg_handoff_chain_alert` — AFTER INSERT agent_events WHERE tool='handoff_task'; алерт при ≥3 + кратность 3; не использует `app.skip_alert_triggers`
- §8: `idx_task_relations_to_blocks` (orphan_blockers EXISTS), `idx_agent_events_handoff_task` (handoff_chain + триггер), `idx_tasks_id_column` (cascade_unblock JOIN)

*ai v0.9.0:*
- §2.2: RAG Pipeline — шаг 1.5 `get_task_subgraph` (структурный граф, первый приоритет); шаг 4 implicit calibration (`assignment_history` avg_completion_days в related tasks, порог ≥3); settings SELECT расширен `workspace_context_cache`; fallback при пустом subgraph
- §2.3: System Prompt — `workspaceContextCacheBlock` (derived cache, оперативное состояние); `structuralContextBlock` (граф зависимостей); ПОХОЖИЕ ЗАДАЧИ с `avg_completion_days`; anchor ai_hint для blocking задач
- §2.4: story_points — «effort-adjusted complexity»; implicit calibration задокументирована
- §2.9 (новый): Workspace Context Rebuild Pipeline — Edge Function с 5 источниками данных; компрессия NeuralDeep GPT-OSS-120B ≤200 tokens; hard limit 500 символов; INV-14 соблюдён; stale-режим
- §3.4: F-04 SELECT + `workspace_context_cache`; `workspaceContextCacheBlock` в промпт
- §4.1: `create_task` — `blocked_by?: string (UUID)`
- §4.3: Request Flow — шаг INSERT task_relations при blocked_by

*mcp_contract v0.6.0:*
- `get_tasks_by_column`: `sort_by_blocking_value?: boolean` + `blocking_value: number` в TaskPreview (Smart Backlog)
- `get_workspace_settings`: `workspace_context_cache`, `context_stale` в response
- `create_task`: `blocked_by?: string (UUID)` → ребро task_relations + `is_blocked=true`; `relation_created: boolean` в response; ошибка `404 blocker_not_found`
- `move_task`: `unblocked_ids: string[]` — downstream задачи разблокированные trg_cascade_unblock
- `handoff_task`: примечание о trg_handoff_chain_alert
- `get_task_context`: `subgraph: [...] | null` — рёбра get_task_subgraph RPC; блок-схема интерпретации
- §5: гарантия Relational Context Layer
- §6: строка `404 blocker_not_found`
- §7 п.1, п.8, п.10, п.12, п.13: расширены под новые возможности

*flow v3.6.0:*
- §11: `orphan_blocker` и `handoff_chain` в таблице аномалий
- §12: AI Flow Summary получает `workspace_context_cache`; пример инсайта с блокировками
- §13: иконка 🔒 для `is_blocked`; Cascade Unblock toast (Realtime)
- §17: Speed Tiers — Blocker Chain (Instant SQL JOIN) и Cascade Unblock (Realtime)
- §19: Risk Pulse «Процессы» расширен `orphan_blockers`; SQL обновлён
- §20: pill «🔄 Цепочка ×N» (Phase 1.1)
- §22: вкладка «Блокировки» — get_task_subgraph, orphan block detection, создание связей через UI

---

**Master v0.11.0 / ai v0.8.1 / flow v3.5.0 / sql_anomalies v1.5 / INDEX v2.5.0 — июнь 2026**

**Attention Risk Score (A-11):**
- Master: INV-12, аксиома A-11, таблица `assignment_history` (§6.14), `trg_record_assignment_snapshot`
- sql_anomalies: VIEW `attention_risk_pulse` (§3.9), `trg_update_assignment_outcome` (§5.6)
- flow: pre-flight scoring Worker Sheet, badge «⚠ Риск N»
- ai: разграничение F-01 / A-11

---

**ai v0.8.0 / flow v3.4.1 / INDEX v2.4.0 — июнь 2026**
- Prompt Quality Engineering: rewritten_description структура, ai_hint anchor-примеры, cognitive_weight domain-adaptive, XML-рефакторинг F-04
- flow §23: поле «Контекст команды»

---

**flow v3.4.0 / team_tab v1.3.0 / INDEX v2.3.0 — июнь 2026**
- Team Tab упразднён. §19–23 в flow_.md. team_tab → Deprecated

---

**Master v0.10.1 / ai v0.7.1 / mcp_contract v0.5.0 / bot v0.4.0 / team_tab v1.2.0 / flow v3.3.0 / sql_anomalies v1.4 / INDEX v2.2.0 — май 2026**
- CJM-аудит P0/P1: trg_resolution_notify, quota_config, generateTaskPrefix(), agent_active_tasks, move_task claim, retry backoff, quota fallback, polling loop, session resume, двухфазный бот-ответ

---

**Master v0.10.0 / ai v0.7.0 / mcp_contract v0.4.0 / sql_anomalies v1.3 / INDEX v2.1.0 — май 2026**
- F-04 Intelligent Ingress: raw_input, clarity_score, complexity, enrichment_strategy, Gatekeeper, Correction Sheet

---

**Master v0.9.1 / ai v0.6.3 / INDEX v2.0.1 — май 2026**
- Project Knowledge Base (Doc RAG): workspace_documents, workspace_doc_chunks, match_doc_chunks RPC

---

**Master v0.9.0 / ai v0.6.2 / mcp_contract v0.3.5 / bot v0.3.1 / team_tab v1.1.3 / INDEX v2.0.0 — май 2026**
- workspace_context, get_task_context (MCP), handoff_task, standup_config, Task ID ALPHA-123

---

*onitask · INDEX · v2.8.0 · июль 2026*
