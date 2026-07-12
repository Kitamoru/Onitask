# onitask · Декомпозиция проекта по задачам (компакт)

**Собрано:** 12 июля 2026 · **Всего задач:** 109

## Статус и назначение файла

Это **не** канонический `.clinerules/01-detailed-flow.md` — тот пока не готов (per Dev Flow v7.3, обязателен к прочтению на каждом Шаге 0). Это промежуточная рабочая декомпозиция уровня «крупная задача на фичу/DDL-блок», а не микро-задача уровня файла. Ожидаемый объём финального `01-detailed-flow.md` — 145–200 микро-задач (см. Memory Bank); здесь — 109 задач-агрегатов, каждая из которых при сборке канонического файла, скорее всего, разъедется на 1–3 более мелкие.

**Что делать с этим файлом:**
1. Использовать как основу при сборке `01-detailed-flow.md` — секции ниже (`## Stage N`) один в один становятся секциями канонического файла (Dev Flow v7.2: «активный этап определяется по секции, в которой физически расположена задача»).
2. Для INV-привязанных задач при переносе — раскрыть однострочное описание согласно правилу §2.3 Dev Flow: «что именно делать, отсылая к параграфу Master, не дублируя его».
3. Перед стартом Stage 1 — обязательный pre-flight чек Plan/Act (см. `.clinerules/00-system-flow.md [v7.3]`), Stage 0 / `INFRA-01` уже отслеживаются отдельно, здесь не дублируются.

## Нотация (Dev Flow v7.3 §2.3)

```
- [ ] ID Название #тег !приоритет @blocked_by:ID
      Однострочное описание — обязательно для INV-задач, отсылает к параграфу Master.
```

**Тег → предполагаемая MOC-карта:** формально Dev Flow предписывает `#тег → MOC-<область>-*.md` (например `#db → MOC-DB-Migrations.md`). По факту такие sub-карты **не существуют** (см. Memory Bank: «Domain MOC sub-cards не существуют») — вместо них читать `onitask_Architecture_Master_.md` + профильный feature-документ напрямую. Ниже в колонке «источник» у каждой задачи указан конкретный документ и параграф, а не MOC-карта — это компенсирует разрыв.

**Используемые теги:** `#db` `#auth` `#ui` `#ai` `#mcp` `#bot` `#infra` — Dev Flow приводит только `#db/#ui/#bot/#infra` как пример («например»), не исчерпывающий список; `#auth`, `#ai`, `#mcp` — естественное расширение под структуру этого проекта. Если работает не так на практике — скорректировать при первом реальном запуске Шага 0.

**`@blocked_by`** — только внутри этого файла; сквозная нумерация ID уникальна по всему документу.

---

## Stage 1 · DB Migrations

> dev_setup §3: все таблицы Master §6, RLS-политики, seed, pg_cron. DoD: Dashboard показывает все таблицы, RLS блокирует анонимный SELECT, cron.job содержит все jobs.

- [ ] DB-01 Core identity: `workspaces`, `profiles`, `workers` + role-триггер #db !high
      Master §4, §6.17. `workers.role` NULL для agent, смена role — только service role.
- [ ] DB-02 `tasks` — все ALTER COLUMN + `trg_invalidate_task_embedding` + IVFFlat индекс #db !high @blocked_by:DB-01
      Master §6.1.
- [ ] DB-03 `tracker.columns` + автосид 4 колонок (`trg_init_workspace_columns`) #db !high @blocked_by:DB-01
      Master §6.1. WIP-лимиты: backlog=15, in_progress=5, review=4, done=null.
- [ ] DB-04 `sprints` #db !med @blocked_by:DB-01
      Master §6.2.
- [ ] DB-05 `task_column_history` + `trg_record_task_column_move` #db !high @blocked_by:DB-02
      Master §6.3.
- [ ] DB-06 `workspace_settings` — все jsonb-конфиги включая `data_sharing_level`, `mcp_api_keys` #db !high @blocked_by:DB-01
      Master §6.4.
- [ ] INV-11 `workspaces.task_prefix` иммутабелен + нумерация задач (`workspace_task_counters`, `next_task_number`, `trg_assign_task_number`, `task_full_id`, `find_task_by_full_id`) #db !high @blocked_by:DB-01,DB-02
      Master §6.12, INV-11.
- [ ] DB-07 `enrichment_queue` — 7 типов + dedup-индексы + приоритет в ORDER BY воркера #db !high @blocked_by:DB-01
      Master §6.5.
- [ ] DB-08 `task_enrichments` #db !med @blocked_by:DB-02
      Master §6.6.
- [ ] INV-04 `agent_events` + CHECK на `tool` + `trg_auto_create_agent_worker` #db !high @blocked_by:DB-01
      Master §6.7, §4, INV-04.
- [ ] DB-09 `agent_memory` + RPC `match_agent_memory` (IVFFlat lists=50) #db !med @blocked_by:DB-01
      Master §6.8.
- [ ] INV-10 `workspace_telegram_chats` (`linked_by → profiles`) #db !med @blocked_by:DB-01
      Master §6.9, INV-10.
- [ ] DB-10 `task_events` + `consolidation_errors` #db !med @blocked_by:DB-02
      Master §6.10, §6.11.
- [ ] DB-11 `workspace_documents` + `workspace_doc_chunks` + RPC `match_doc_chunks` (IVFFlat lists=10) #db !med @blocked_by:DB-01
      Master §6.13.
- [ ] DB-12 `assignment_history` — таблица (без триггера) #db !med @blocked_by:DB-02
      Master §6.14.
- [ ] DB-13 SQL-вьюхи аномалий: `stuck_tasks`, `overloaded_workers`, `bottleneck_columns`, `duplicate_tasks` (+`pg_trgm`), `stale_blocked`, `velocity_drop`, `pending_escalations`, `review_backlog`, `attention_risk_pulse` #db !high @blocked_by:DB-02,DB-06
      sql_anomalies §3.1–3.9. `attention_risk_pulse` нужна ДО INV-12 (следующая задача).
- [ ] INV-12 `trg_record_assignment_snapshot` (BEFORE UPDATE OF assigned_to) #db !high @blocked_by:DB-12,DB-13
      Master §6.14, INV-12. Зависит от `attention_risk_pulse` из DB-13.
- [ ] INV-13 `task_relations` + RPC `get_task_subgraph` + `trg_cascade_unblock` + `trg_context_invalidate` (A-12) #db !high @blocked_by:DB-02,DB-06,DB-07
      Master §6.16, INV-13. Триггеры пишут в `enrichment_queue` — отсюда зависимость от DB-07.
- [ ] DB-14 `orphan_blockers` + `handoff_chain` вьюхи + `trg_handoff_chain_alert` + `trg_escalation_alert` + `trg_resolution_notify` + `enqueue_duplicate_check` + `send_alert_immediate()` #db !med @blocked_by:DB-13,INV-13
      sql_anomalies §3.10–3.11, §5.
- [ ] INV-14 Контрактная проверка: ни один Route Handler не пишет в `workspace_context_cache` напрямую (только Edge Function rebuild) #db !low @blocked_by:DB-06
      Master §6.4 comment, A-12, INV-14. Актуализировать при появлении Route Handler'ов на Stage 6.
- [ ] DB-15 `invite_links` #db !low @blocked_by:DB-01
      Master §6.18.
- [ ] INV-15 RLS-политики (`002_rls.sql`, 21 таблица) + ограничение записи `data_sharing_level` только Admin/Owner + `get_my_workspace_ids()` #db !high @blocked_by:DB-01,DB-02,DB-03,DB-04,DB-05,DB-06,DB-07,DB-08,DB-09,DB-10,DB-11,DB-12,DB-13,DB-14,DB-15,INV-04,INV-10,INV-11,INV-12,INV-13
      security §2.1, Master §6.4. Последняя задача перед seed — блокирует всё вышеперечисленное.
- [ ] DB-16 pg_cron jobs: `memory-consolidation`, `gc-agent-events`, `gc-enrichment-queue`, `monitor-enrichment-queue`, `auto-fail-locked-queue`, `standup-dispatcher`, `workspace-context-fallback`, `enrichment-failure-alert`, `bot-notify-fallback` #infra !med @blocked_by:INV-15
      Master §9.
- [ ] DB-17 Seed: тестовый workspace + worker #db !low @blocked_by:INV-15
      dev_setup §3, Stage 1 DoD.
- [ ] DB-18 CI: `supabase gen types` + type drift check в GitHub Actions #infra !med @blocked_by:DB-17
      dev_setup §4.

---

## Stage 2 · Auth / Init

> dev_setup §3: `validateTelegramInitData` + `timingSafeEqual`, `/api/init` upsert. DoD: валидный initData → 200 + worker profile, невалидный → 401.

- [ ] INV-06 `lib/telegramAuth.ts`: `validateTelegramInitData` + `timingSafeEqual` #auth !high @blocked_by:DB-01
      Master A-2, INV-06. Первое реальное место применения инварианта.
- [ ] AUTH-01 `useTelegram` hook (`tg.ready()`, `expand()`, MainButton, BackButton) #ui !med @blocked_by:INV-06
- [ ] INV-16 `POST /api/init` — find-or-create, без автообновления `display_name`/`avatar_url` #auth !high @blocked_by:INV-06,DB-01
      Master §6.17, dev_setup §7.1, INV-16.
- [ ] AUTH-02 Контракт ответа `{ worker, workspaces, is_new_user }` + роутинг на WorkspaceWizard при `is_new_user` #auth !med @blocked_by:INV-16
- [ ] AUTH-03 401-обработка невалидного initData + интеграционный тест (валидный→200, невалидный→401) #auth !med @blocked_by:INV-16

---

## Stage 3 · Workspace Wizard

> dev_setup §3: GET/POST `/api/workspaces`, `WorkspaceWizard.tsx`, seed `workspace_settings`. DoD: новый пользователь видит wizard, после заполнения — попадает в Flow Board.

- [ ] WS-01 `POST /api/workspaces` — атомарная транзакция (workspaces → triggers → workspace_settings → workers owner → sprint если enabled) #db !high @blocked_by:INV-16
      dev_setup §7.4.
- [ ] WS-02 `generateTaskPrefix()` (slug → prefix, `needsManualReview`) #ui !med @blocked_by:WS-01
      Master §8.
- [ ] WS-03 `WorkspaceWizard.tsx` (slug, task_prefix, `workspace_context` опционально со Skip) #ui !high @blocked_by:WS-01,WS-02
- [ ] WS-04 `GET /api/workspaces` — список workspace пользователя #db !med @blocked_by:WS-01
- [ ] WS-05 Роутинг: `is_new_user` → wizard; существующий пользователь → Flow Board #ui !med @blocked_by:AUTH-02,WS-03

---

## Stage 4 · Flow Board без AI

> dev_setup §3: GET/PATCH `/api/tasks`, `KanbanBoard` + DnD, Realtime, `SprintBar`, ручное создание, `UrgencyBadge`. DoD: DnD работает, Realtime синхронизирует клиентов, `trg_record_task_column_move` пишет историю.

- [ ] FLOW-01 `GET/PATCH /api/tasks` — last-write-wins, **без** version-check (см. INV-09 примечание в Architecture-Compact) #db !high @blocked_by:WS-01
      dev_setup §7.2, §7.3.
- [ ] FLOW-02 `KanbanBoard.tsx` + `KanbanColumn` + `KanbanCard` + `DragOverlay` (`@dnd-kit`) #ui !high @blocked_by:FLOW-01
- [ ] FLOW-03 Fractional indexing (`position = (prev+next)/2`) #ui !high @blocked_by:FLOW-02
      product_vision UC-03.
- [ ] FLOW-04 Realtime-подписка на `tasks` #ui !high @blocked_by:FLOW-02
- [ ] FLOW-05 `SprintBar.tsx` (метрики скрыты в статусе `planning`) #ui !med @blocked_by:FLOW-02
      flow_.md §7.
- [ ] FLOW-06 Ручное создание задачи (`TaskForm.tsx`) + `is_inbox=false` при явном column #ui !high @blocked_by:FLOW-01
      Master §5.
- [ ] FLOW-07 `UrgencyBadge.tsx` — светофор по дедлайну #ui !med @blocked_by:FLOW-02
      product_vision US-04.
- [ ] FLOW-08 `GET /api/flow/metrics` → Edge Function `flow-metrics` (кэш 5с columns / 60с workers+alerts) #db !high @blocked_by:DB-13
      flow_.md §9–10, A-10.
- [ ] FLOW-09 Column Health Grid 2×2 + bottom sheet по тапу колонки #ui !med @blocked_by:FLOW-08
- [ ] FLOW-10 Stream — персональная лента (Фокус/В работе/На проверке/Надо сделать/Черновики) #ui !med @blocked_by:FLOW-01

---

## Stage 5 · Voice / NL Input (F-04)

> dev_setup §3: `/api/ai/transcribe`, `/api/ai/parse-task`, `VoiceRecorder`, `AiInput`, confidence handling. DoD: голос → транскрипт ≤400мс, парсинг корректный, fallback при ошибке Groq.

- [ ] F04-01 `POST /api/ai/transcribe` (Groq Whisper) + `detectSTTStrategy` (web-speech / groq-whisper) #ai !high @blocked_by:WS-01
      ai_.md §3.1–3.2.
- [ ] F04-02 `VoiceRecorder.tsx` + waveform + MediaRecorder lifecycle #ui !high @blocked_by:F04-01
- [ ] F04-03 `POST /api/ai/parse-task` (Groq llama-3.3-70b, JSON mode обязателен) + `ParseResponseV2` #ai !high @blocked_by:WS-01
      ai_.md §3.3–3.4.
- [ ] F04-04 Детерминированный Gatekeeper (skip/light/standard) #ai !high @blocked_by:F04-03
      ai_.md §3.5.
- [ ] F04-05 `AiInput.tsx` — единая строка NL + голос #ui !high @blocked_by:F04-02,F04-03
- [ ] F04-06 Correction Sheet (TWA) при `clarity_score`/`confidence` ниже порога #ui !med @blocked_by:F04-05
      ai_.md §3.7.
- [ ] F04-07 Route Handler полный поток: INSERT `tasks` + условный `task_enrichments`(skip) или `enrichment_queue` #db !high @blocked_by:F04-04
      ai_.md §3.6.
- [ ] INV-05 Ревью: все AI-outputs F-04 содержат `workspace_id` (tenant isolation) #ai !high @blocked_by:F04-07
      Master A-7, INV-05.

---

## Stage 6 · Card Enrichment (F-03)

> dev_setup §3: Edge Function `enrich-task`, `enrichment_queue` polling, идемпотентность, retry backoff. DoD: фоновое обогащение работает, Realtime обновляет UI, при ошибке — тихий toast.

- [ ] F03-01 Edge Function `enrich-task`: settings SELECT (`data_sharing_level`, `doc_kb_config`, ...) #ai !high @blocked_by:F04-07
      ai_.md §2.2.
- [ ] F03-02 UUID-теги `wrapData()` изоляции динамических данных (LLM-1) #ai !high @blocked_by:F03-01
      security §1.2.
- [ ] F03-03 Embedding с кэшированием (SHA-256 hash, cache-hit/miss) #ai !high @blocked_by:F03-01
      ai_.md §2.2 шаг 2, Master §6.1 (`embedding_hash`).
- [ ] F03-04 Structural context: `get_task_subgraph` (A-12), fallback на пустой subgraph #ai !high @blocked_by:INV-13
      ai_.md §2.2 шаг 1.5.
- [ ] F03-05 Semantic top-5 (`match_tasks`) + implicit calibration через `assignment_history` (avg_completion_days, порог ≥3) #ai !high @blocked_by:F03-03,DB-12
      ai_.md §2.2 шаг 3–4.
- [ ] F03-06 Doc RAG с ветвлением по `data_sharing_level` (minimal=skip, standard=sim≥0.68, full=без порога) #ai !med @blocked_by:F03-01
      ai_.md §2.2 шаг 2.5.
- [ ] F03-07 LTM RAG (порог ≥500 done задач) #ai !low @blocked_by:F03-01
      ai_.md §2.2 шаг 2.6.
- [ ] F03-08 System Prompt (JSON mode, output schema, anchor-примеры `ai_hint`) #ai !high @blocked_by:F03-02,F03-04,F03-05,F03-06,F03-07
      ai_.md §2.3.
- [ ] F03-09 Идемпотентность (`requested_at` vs `updated_at`, stale enrichment) #ai !high @blocked_by:F03-08
      ai_.md §2.7, Master §7.2.
- [ ] F03-10 Retry backoff (0 / 5мин / 30мин, `markFailed` после 3-й) #ai !med @blocked_by:F03-09
      ai_.md §2.6.
- [ ] F03-11 `EnrichmentBadge.tsx` (pending/done/failed) + `realtimePush` #ui !med @blocked_by:F03-09
- [ ] F03-12 Workspace Context Rebuild Pipeline (Edge Function `rebuild-workspace-context`, 5 источников, компрессия ≤500 симв, соблюдение INV-14) #ai !med @blocked_by:F03-01,INV-13
      ai_.md §2.9.

---

## Stage 7 · MCP Agent Router (F-06)

> dev_setup §3: `/api/mcp/*`, `mcpAuth.ts`, atomic quota, Memento, `auto_create_agent_worker`, undo. DoD: Cursor/Claude Code создают и двигают задачи, `agent_events` пишутся корректно, undo работает в окне 5 мин.

- [ ] MCP-01 `lib/mcpAuth.ts`: `timingSafeEqual` (INV-06 повторно, теперь для MCP-ключей) + Tenant Isolation через `mcp_api_keys` #mcp !high @blocked_by:DB-06
      mcp_contract §2, security §3.1.
- [ ] MCP-02 Allowed Tools enforcement (`getKeyPermissions`/`isToolAllowed`, legacy mode `{}`) #mcp !high @blocked_by:MCP-01
      security §3.1.
- [ ] INV-07 Atomic Quota RPC (`check_and_decrement_quota`) #mcp !high @blocked_by:DB-06
      ai_.md §4.2, Master A-3, INV-07.
- [ ] MCP-03 `create_task` + Rate Limit (50/мин, `max_tasks_per_minute`) + DFS Cycle Check (`blocked_by`, `409 circular_dependency`) #mcp !high @blocked_by:MCP-01,MCP-02,INV-07,INV-13
      mcp_contract §4, security §5.1.
- [ ] INV-09 `move_task` — версионная проверка (`WHERE version=$expected`) + `claim` + `unblocked_ids` из `trg_cascade_unblock` #mcp !high @blocked_by:MCP-03
      mcp_contract §4, Master §7.1, INV-09.
- [ ] MCP-04 `escalate_task` + `handoff_task` #mcp !high @blocked_by:INV-09
      mcp_contract §4. Alert-триггеры уже созданы в DB-14.
- [ ] MCP-05 `get_tasks_by_column` (+ `sort_by_blocking_value` Smart Backlog) #mcp !med @blocked_by:MCP-01
- [ ] MCP-06 `get_workspace_settings` + `get_task_context` (subgraph, `relevant_docs` по `data_sharing_level`) #mcp !high @blocked_by:MCP-01,F03-04
- [ ] MCP-07 `send_message_to_chat` + HTML sanitization (`sanitizeOutput`, whitelist тегов) #mcp !med @blocked_by:MCP-02
      security §4.1.
- [ ] MCP-08 `undo/:event_id` (`state_before` Memento, окно 5 мин) #mcp !med @blocked_by:MCP-03
- [ ] MCP-09 `state_before` Memento + INSERT `agent_events` + шаблонная генерация summary #mcp !high @blocked_by:MCP-03
- [ ] MCP-10 Error handling matrix (все HTTP-коды §6 mcp_contract) #mcp !med @blocked_by:MCP-03,INV-09,MCP-04,MCP-05,MCP-06,MCP-07,MCP-08

---

## Stage 8 · Team Tab → Flow Board §19–21 (Risk Pulse)

> dev_setup §3: Risk Pulse, карточки участников, velocity SQL, Invite FAB. DoD: Risk Pulse актуален, SP/день корректен, Invite FAB генерирует ссылку.

- [ ] RISK-01 Risk Pulse — три сигнала (Люди/Процессы/Эскалации) + tappable drill-down #ui !high @blocked_by:DB-13
      flow_.md §19.
- [ ] RISK-02 Предупреждение «уведомления выключены» при отсутствии Telegram-чата #ui !low @blocked_by:RISK-01
- [ ] RISK-03 Worker Load (человек collapsed/expanded, badge «⚠ Риск N» из `attention_risk_pulse`) #ui !high @blocked_by:DB-13
      flow_.md §20.
- [ ] RISK-04 Worker Sheet — участник (Сейчас/Метрики, pre-flight scoring при назначении) #ui !high @blocked_by:RISK-03
      flow_.md §21.
- [ ] RISK-05 Velocity SQL интеграция в блок «Метрики» #db !med @blocked_by:RISK-04
      team_tab §4.1 (справочник).
- [ ] RISK-06 Поле «Контекст команды» (WorkspaceWizard + Settings, лимит 800 симв) #ui !med @blocked_by:WS-03
      flow_.md §23, Master §6.4.
- [ ] RISK-07 Invite FAB + реферальная ссылка (`t.me/onitask_bot?start=ws_CODE`) #ui !med @blocked_by:DB-15

---

## Stage 9 · Agent Cards + Escalations

> dev_setup §3: Agent cards, Escalation queue, `escalate_task`, метрики агента. DoD: оператор видит очередь эскалаций, `needs_human=true` отображается корректно.

- [ ] AGENT-01 Agent Card collapsed (◆ + цвет throughput + queue depth) #ui !high @blocked_by:RISK-03
      flow_.md §20.
- [ ] AGENT-02 Agent Card expanded (Interpretation hint, «Флоу · 7 дней») #ui !high @blocked_by:AGENT-01
- [ ] AGENT-03 Operator Queue (`pending_escalations`, [Разрешить]/[Открыть задачу→]) #ui !high @blocked_by:DB-13,MCP-04
      flow_.md §21, team_tab §2.7 (SQL-справочник).
- [ ] AGENT-04 Task Sheet, вкладка «Блокировки» (`get_task_subgraph`, orphan block detection, `POST /api/tasks/:id/relations`) #ui !high @blocked_by:MCP-06
      flow_.md §22.
- [ ] AGENT-05 Cascade Unblock toast (Realtime `cascade_unblock`) #ui !med @blocked_by:INV-13
- [ ] AGENT-06 Pill «🔄 Цепочка ×N» для `handoff_chain` (Phase 1.1 — можно отложить за MVP) #ui !low @blocked_by:AGENT-01

---

## Stage 10 · Telegram Bot

> dev_setup §3: `/api/bot/*`, webhook, F-04 адаптер, workspace resolution, команды, deep links. DoD: голосовое → задача, `/flow` актуален, deep link открывает нужную задачу.

- [ ] BOT-01 `POST /api/bot/webhook` + HMAC-подпись (SEC-03) #bot !high @blocked_by:DB-11
      bot_.md §6.1, product_vision SEC-03.
- [ ] BOT-02 Workspace resolution (6 приоритетов, last-used SQL) #bot !high @blocked_by:BOT-01
      bot_.md §3.
- [ ] BOT-03 `/task` текст+голос, двухфазный ответ (typing+placeholder → editMessageText), duplicate guard (`message_id`) #bot !high @blocked_by:BOT-02,F04-03
      bot_.md §5.1, §6.2.
- [ ] BOT-04 `@onitask` инлайн-вызов #bot !med @blocked_by:BOT-03
- [ ] BOT-05 `/inbox`, `/flow`, `/task ALPHA-123` #bot !med @blocked_by:BOT-02
      bot_.md §5.3, §5.7.
- [ ] BOT-06 `/resolve ALPHA-123` (`needs_human=false` + `skip_alert_triggers` + INSERT `enrichment_queue`) #bot !med @blocked_by:BOT-05
      bot_.md §5.8.
- [ ] BOT-07 Онбординг через invite (`/start ws_CODE`) #bot !high @blocked_by:DB-15
      bot_.md §5.9.
- [ ] BOT-08 Freemium boundary (тариф-гейты, таблица §4) #bot !med @blocked_by:BOT-03
- [ ] BOT-09 Daily Standup (`/standup` ручной вызов + `escapeHtml` санитизация) #bot !med @blocked_by:BOT-05
      bot_.md §5.6.
- [ ] BOT-10 Bot Notify Worker (Edge Function `bot-notify`, DB Webhook + hourly cron fallback, retry/backoff при 429) #bot !high @blocked_by:DB-16,DB-14
      bot_.md §6.5.

---

## Stage 11 · AI Flow Summary

> dev_setup §3: Edge Function `flow-metrics` Cold Path, кэш 5/60с, кнопка «Применить». DoD: инсайты видны Admin/Owner, при ошибке LLM — последние успешные из кэша.

- [ ] SUM-01 Edge Function `flow-metrics` Cold Path (NeuralDeep GPT-OSS-120B) #ai !high @blocked_by:F03-12
      flow_.md §12.
- [ ] SUM-02 Снапшот для модели (100 активных задач + 20 `agent_events`/час + `workspace_context_cache`) #ai !high @blocked_by:SUM-01
- [ ] SUM-03 Кнопка «Применить» → `move_task` через MCP #ui !med @blocked_by:SUM-01,INV-09
- [ ] SUM-04 Fallback на последние успешные инсайты из кэша при ошибке LLM #ai !med @blocked_by:SUM-01
- [ ] SUM-05 `/summary` команда бота (только AI Dev/Team план) #bot !med @blocked_by:SUM-01,BOT-08

---

## Stage 12 · LTM Pipeline

> dev_setup §3: Edge Function `consolidate`, `task_events` → `agent_memory`, `consolidation_errors`. DoD: задачи старше 30 дней консолидируются, RAG через `match_tasks()` находит релевантные.

- [ ] LTM-01 Edge Function `consolidate` (`task_events` > 30 дней → `agent_memory`) #ai !high @blocked_by:DB-10
      ai_.md §5.1.
- [ ] LTM-02 LTM Injection Linter (5 regex-паттернов перед INSERT в `agent_memory`) #ai !high @blocked_by:LTM-01
      security §1.3.
- [ ] LTM-03 Активационная проверка `memory-consolidation` (уже создан в DB-16) — подтвердить подключение Edge Function #infra !low @blocked_by:LTM-02
- [ ] LTM-04 Интеграционный тест: `match_agent_memory` возвращает релевантные задачи #ai !med @blocked_by:LTM-02,F03-07

---

## Сводка по стадиям

| Stage | Тема | Задач |
|---|---|---|
| 1 | DB Migrations | 25 |
| 2 | Auth / Init | 5 |
| 3 | Workspace Wizard | 5 |
| 4 | Flow Board без AI | 10 |
| 5 | Voice / NL Input (F-04) | 8 |
| 6 | Card Enrichment (F-03) | 12 |
| 7 | MCP Agent Router (F-06) | 12 |
| 8 | Team Tab → Risk Pulse | 7 |
| 9 | Agent Cards + Escalations | 6 |
| 10 | Telegram Bot | 10 |
| 11 | AI Flow Summary | 5 |
| 12 | LTM Pipeline | 4 |
| **Итого** | | **109** |

---

*onitask · Декомпозиция по задачам · компакт-версия · 12 июля 2026*
