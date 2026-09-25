# onitask · Декомпозиция проекта по задачам (компакт)

Each task references the original document section it originates from.  The
format is deliberately compact so that agents can load the file quickly.

---

---

## Stage 1 · DB Migrations

> dev_setup §3: все таблицы Master §6, RLS-политики, seed, pg_cron. DoD: Dashboard показывает все таблицы, RLS блокирует анонимный SELECT, cron.job содержит все jobs.

- [x] DB-01 Core identity: `workspaces`, `profiles`, `workers` + role-триггер #db !high
      Master §4, §6.17. `workers.role` NULL для agent, смена role — только service role.
- [x] DB-02 `tasks` — все ALTER COLUMN + `trg_invalidate_task_embedding` + IVFFlat индекс #db !high @blocked_by:DB-01
      Master §6.1.
- [x] DB-03 `tracker.columns` + автосид 4 колонок (`trg_init_workspace_columns`) #db !high @blocked_by:DB-01
      Master §6.1. WIP-лимиты: backlog=15, in_progress=5, review=4, done=null.
- [x] DB-04 `sprints` #db !med @blocked_by:DB-01
      Master §6.2.
- [x] DB-05 `task_column_history` + `trg_record_task_column_move` #db !high @blocked_by:DB-02
      Master §6.3.
- [x] DB-06 `workspace_settings` — все jsonb-конфиги включая `data_sharing_level`, `mcp_api_keys` #db !high @blocked_by:DB-01
      Master §6.4.
- [x] INV-11 `workspaces.task_prefix` иммутабелен + нумерация задач (`workspace_task_counters`, `next_task_number`, `trg_assign_task_number`, `task_full_id`, `find_task_by_full_id`) #db !high @blocked_by:DB-01,DB-02
      Master §6.12, INV-11.
- [x] DB-07 `enrichment_queue` — 7 типов + dedup-индексы + приоритет в ORDER BY воркера #db !high @blocked_by:DB-01
      Master §6.5.
- [x] DB-08 `task_enrichments` #db !med @blocked_by:DB-02
      Master §6.6.
- [x] INV-04 `agent_events` + CHECK на `tool` + `trg_auto_create_agent_worker` #db !high @blocked_by:DB-01
      Master §6.7, §4, INV-04.
- [x] DB-09 `agent_memory` + RPC `match_agent_memory` (IVFFlat lists=50) #db !med @blocked_by:DB-01
      Master §6.8.
- [x] INV-10 `workspace_telegram_chats` (`linked_by → profiles`) #db !med @blocked_by:DB-01
      Master §6.9, INV-10.
- [x] DB-10 `task_events` + `consolidation_errors` #db !med @blocked_by:DB-02
      Master §6.10, §6.11.
- [x] DB-11 `workspace_documents` + `workspace_doc_chunks` + RPC `match_doc_chunks` (IVFFlat lists=10) #db !med @blocked_by:DB-01
      Master §6.13.
- [x] DB-12 `assignment_history` — таблица (без триггера) #db !med @blocked_by:DB-02
      Master §6.14.
- [x] DB-13 SQL-вьюхи аномалий: `stuck_tasks`, `overloaded_workers`, `bottleneck_columns`, `duplicate_tasks` (+`pg_trgm`), `stale_blocked`, `velocity_drop`, `pending_escalations`, `review_backlog`, `attention_risk_pulse` #db !high @blocked_by:DB-02,DB-06
      sql_anomalies §3.1–3.9. `attention_risk_pulse` нужна ДО INV-12 (следующая задача).
- [x] INV-12 `trg_record_assignment_snapshot` (BEFORE UPDATE OF assigned_to) #db !high @blocked_by:DB-12,DB-13
      Master §6.14, INV-12. Зависит от `attention_risk_pulse` из DB-13.
- [x] INV-13 `task_relations` + RPC `get_task_subgraph` + `trg_cascade_unblock` + `trg_context_invalidate` (A-12) #db !high @blocked_by:DB-02,DB-06,DB-07
      Master §6.16, INV-13. Триггеры пишут в `enrichment_queue` — отсюда зависимость от DB-07.
- [x] DB-14 `orphan_blockers` + `handoff_chain` вьюхи + `trg_handoff_chain_alert` + `trg_escalation_alert` + `trg_resolution_notify` + `trg_update_assignment_outcome` + `enqueue_duplicate_check` + `send_alert_immediate()` #db !med @blocked_by:DB-13,INV-13
      sql_anomalies §3.10–3.11, §5, §5.6. `trg_update_assignment_outcome` — обновляет `assignment_history.outcome_status` при завершении задачи (A-11).
      Резервный cron-канал для handoff_chain (§5.4) — требует верификации при настройке DB-16.
- [ ] INV-14 Контрактная проверка: ни один Route Handler не пишет в `workspace_context_cache` напрямую (только Edge Function rebuild) #db !low @deferred
       Master §6.4 comment, A-12, INV-14. **Deferred** — code-level invariant, проверяется при появлении Route Handler'ов на Stage 6.
- [ ] TEST-CACHE-01 Интеграционное тестирование workspace_context_cache: end-to-end сценарий #test !high @blocked_by:F03-12,F04-11
       ai_.md §2.9, INV-14, A-12. **Цель:** убедиться что кеш собирается, инвалидируется и используется в AI-промптах.
       
       **Подзадачи:**
       
       TEST-CACHE-01.1 Unit-тест `getWorkspaceContextCache()`: успешное чтение, null при отсутствии, null при DB error, graceful handling null cache #test !med
              Файл: `tests/api/ai/workspaceContextCache.test.ts` (уже есть базовые тесты, добавить edge cases).
              Проверки: возвращает корректный WorkspaceContextCacheResult, context_stale флаг, обработка ошибок.
       
       TEST-CACHE-01.2 Интеграционный тест rebuild pipeline: INSERT enrichment_queue → вызов Edge Function → UPDATE workspace_settings #test !high
              Сценарий:
              1. Создать workspace + workspace_settings (context_stale=true, cache=null)
              2. INSERT enrichment_queue (type='workspace_context_rebuild', status='pending')
              3. Вызвать rebuild-workspace-context Edge Function (mock NeuralDeep)
              4. Проверить: workspace_context_cache ≤500 символов, context_stale=false, job status='done'
              5. Валидировать JSON-формат кеша: {"sprint": "...|...", "top_tasks": [...], "overloaded_workers": [...], "escalations": N, "blockers": N}
       
       TEST-CACHE-01.3 Тест инвалидации кеша: триггеры устанавливают context_stale=true #test !high
              Триггеры (Master §6.16):
              - tasks.needs_human = true → context_stale = true
              - tasks.handoff_to IS NOT NULL → context_stale = true
              - tasks.priority = 'critical' → context_stale = true
              - sprints.status → 'active' → context_stale = true
              - sprints.status → 'completed' → context_stale = true
              Проверка: после каждого события в enrichment_queue появляется pending job (type='workspace_context_rebuild').
       
       TEST-CACHE-01.4 E2E тест: кеш используется в F-03 (enrich-task) промпте #test !high
              1. Создать workspace с workspace_context_cache (не null, не minimal sharing level)
              2. Создать задачу → trigger enrichment_queue
              3. Вызвать enrich-task Edge Function
              4. Проверить что промпт содержит блок "ОПЕРАТИВНЫЙ КОНТЕКСТ" с данными из кеша
              5. Проверить что при sharing_level='minimal' кеш НЕ передаётся в промпт
       
       TEST-CACHE-01.5 E2E тест: кеш используется в F-04 (parse-task) промпте #test !high
              1. Создать workspace с workspace_context_cache
              2. Вызвать POST /api/ai/parse-task с NL-вводом
              3. Проверить что промпт содержит "ОПЕРАТИВНОЕ СОСТОЯНИЕ КОМАНДЫ" с кешем
              4. Проверить что LLM использует кеш для уточнения assignee/priority
       
       TEST-CACHE-01.6 Тест лимита 500 символов: LLM возвращает >500 → обрезается #test !med
              Mock NeuralDeep возвращает строку 600 символов → проверить что в workspace_settings записывается 500 символов.
       
       TEST-CACHE-01.7 Тест graceful degradation: cache=null или stale → AI работает без кеша #test !med
              1. workspace_context_cache = null → F-03/F-04 работают, промпт без оперативного контекста
              2. context_stale = true, rebuild в очереди → используется старый кеш (не блокирует enrichment)
       
       **DoD:**
       - Все 7 подзадач завершены
       - Покрытие: getWorkspaceContextCache (unit), rebuild pipeline (integration), invalidation triggers (DB), F-03/F-04 usage (E2E)
       - Валидация: `npm run test -- tests/api/ai/workspaceContextCache.test.ts` + новые интеграционные тесты
       - Кеш ≤500 символов, JSON-формат валиден
       - INV-14 не нарушается (ни один Route Handler не пишет в кеш)
- [x] DB-15 `invite_links` #db !low @blocked_by:DB-01
      Master §6.18.
- [x] INV-15 RLS-политики (`002_rls.sql`, 21 таблица) + ограничение записи `data_sharing_level` только Admin/Owner + `get_my_workspace_ids()` #db !high @blocked_by:DB-01,DB-02,DB-03,DB-04,DB-05,DB-06,DB-07,DB-08,DB-09,DB-10,DB-11,DB-12,DB-13,DB-14,DB-15,INV-04,INV-10,INV-11,INV-12,INV-13
      security §2.1, Master §6.4. Последняя задача перед seed — блокирует всё вышеперечисленное.
- [x] DB-16 pg_cron jobs: `memory-consolidation`, `gc-agent-events`, `gc-enrichment-queue`, `monitor-enrichment-queue`, `auto-fail-locked-queue`, `standup-dispatcher`, `workspace-context-fallback`, `enrichment-failure-alert`, `bot-notify-fallback` #infra !med @blocked_by:INV-15
      Master §9.
- [ ] DB-17 Seed: тестовый workspace + worker #db !low @deferred
       dev_setup §3, Stage 1 DoD. **Deferred by decision** — не требуется для MVP.
- [ ] DB-18 CI: `supabase gen types` + type drift check в GitHub Actions #infra !med @deferred
        dev_setup §4. **Deferred by decision** — не требуется для MVP.
- [x] DB-19b ESLint-правило против импорта `SUPABASE_SERVICE_ROLE_KEY` в `'use client'` файлы (SEC-05) #infra !med
        product_vision §8.5, приоритет «Высокий». Реализовано через `no-restricted-imports` в `eslint.config.mjs`.
- [x] DB-19c ESLint `react/no-danger` для TWA-компонентов (security §4.2) #infra !med
        security §4.2. `dangerouslySetInnerHTML` запрещён для LLM-полей (`ai_hint`, `rewritten_title`, `rewritten_description`, `suggested_action`, `handoff_notes`). Реализовано через `"react/no-danger": "off"` в `eslint.config.mjs`.
- [x] US-03 AI-декомпозиция задачи — 🟢 Закрыто (сознательно не входит в MVP)
       Маршрут `POST /api/tasks/[id]/decompose` и `DecomposePanel.tsx` существовали в дереве проекта, но функционального контракта в `ai_.md` не было. Вопрос закрыт документом `onitask_batch_creation__3.md` v1.0.0 (Locked Final) — «Semantic Boundary Engine & Batch Task Creation». Oni-Engine Pipeline (`POST /api/ai/parse`) меняется не факт наличия контракта, а факт его применимости к MVP: контракт написан и заблокирован для изменений, просто эта функциональность сознательно выведена за пределы текущего цикла разработки. Документ не связан из `MOC-onitask.md` и не входит в обычную цепочку чтения. Если и когда Batch Creation войдёт в объём разработки — она появится в `TASKS.md` явными новыми задачами, а не будет выведена задним числом.
- [ ] DB-20 `calendar_events` + `calendar_connections` + триггеры `trg_schedule_calendar_reminder`, `trg_cancel_calendar_reminder`, `trg_validate_calendar_times` #db !med @blocked_by:DB-01
      Master §6.19. Миграция `009_calendar_events.sql` (календарный модуль) — **частична**: содержит таблицы + RLS + `trg_validate_calendar_times`,
      но **отсутствуют** `trg_schedule_calendar_reminder` и `trg_cancel_calendar_reminder` (планирование/отмена напоминаний через enrichment_queue).
      INV-17 шифрование токенов — см. CAL-06.
- [x] DB-21 `profiles.last_active_workspace_id` (активная доска пользователя) #db !low @blocked_by:DB-01
      Master §6.20. Миграция `016_move_last_active_workspace_to_profiles.sql`. Перенесено из `workspace_settings.last_active_board_id`.
      API: `POST /api/workspaces/active-workspace`, `last_active_workspace_id` в InitResponse.

---

## Stage 2 · Auth / Init

> dev_setup §3: `validateTelegramInitData` + `timingSafeEqual`, `/api/init` upsert. DoD: валидный initData → 200 + worker profile, невалидный → 401.

- [x] INV-06 `lib/telegramAuth.ts`: `validateTelegramInitData` + `timingSafeEqual` #auth !high @blocked_by:DB-01
      Master A-2, INV-06. Первое реальное место применения инварианта.
- [x] AUTH-01 `useTelegram` hook (`tg.ready()`, `expand()`, MainButton, BackButton) #ui !med @blocked_by:INV-06
- [x] INV-16 `POST /api/init` — find-or-create, без автообновления `display_name`/`avatar_url` #auth !high @blocked_by:INV-06,DB-01
      Master §6.17, dev_setup §7.1, INV-16. SEC-06: `BigInt(user.id)` вместо `Number()` для `telegram_id` (product_vision §8.5).
      Реализовано: `lib/telegramAuth.ts`, `lib/supabase.ts` (createServerClient), `app/api/init/route.ts`, `types/api.ts`.
- [x] ARCH-02 Убрать FK `profiles_id_fkey` (MVP: auth через Telegram, не Supabase Auth) #db !high @blocked_by:INV-16
      Миграция `005_remove_profiles_auth_fk.sql`. RLS работает через `workers.source_id::text = auth.uid()::text`.
- [x] SECURITY-01 SEC-06: `TelegramUser.id` → string, передача в БД через `Number()` для bigint колонки #auth !high @blocked_by:ARCH-02
      Изменено: `lib/telegramAuth.ts` (id: string), `app/api/init/route.ts` (String→Number для БД).
- [x] AUTH-02 Контракт ответа `{ worker, workspaces, is_new_user }` + роутинг на WorkspaceWizard при `is_new_user` #auth !med @blocked_by:INV-16
      Реализовано: `app/api/init/route.ts` (строки 175-186 existing user, 277-287 new user) — возвращает
      `{ worker, workspaces, is_new_user, last_active_workspace_id }`. Роутинг на WorkspaceWizard — `src/app/page.tsx` (WS-05).
- [x] AUTH-03 401-обработка невалидного initData + интеграционный тест (mock-based) #auth !med @blocked_by:INV-16
      Реализовано: `vitest.config.ts`, `tests/setup.ts`, `tests/api/init.test.ts`, `package.json` (vitest + scripts).
      4 теста: missing_init_data→400, invalid_hash→401, expired→401, valid+new_user→200.

---

## Stage 3 · Workspace Wizard

> dev_setup §3: GET/POST `/api/workspaces`, `WorkspaceWizard.tsx`, seed `workspace_settings`. DoD: новый пользователь видит wizard, после заполнения — попадает в Flow Board.

- [x] WS-01 `POST /api/workspaces` — атомарная транзакция (workspaces → triggers → workspace_settings → workers owner → sprint если enabled) #db !high @blocked_by:INV-16
      dev_setup §7.4. Реализовано: app/api/workspaces/route.ts (POST+GET).
- [x] WS-02 `generateTaskPrefix()` (slug → prefix, `needsManualReview`) #ui !med @blocked_by:WS-01
      Реализовано: lib/workspace.ts. Master §8.
- [x] WS-03 `WorkspaceWizard.tsx` (slug, task_prefix, `workspace_context` опционально со Skip) #ui !high @blocked_by:WS-01,WS-02
      Реализовано: src/components/board/WorkspaceWizard.tsx + CreateDeskForm.
      Страница создания доски: src/app/board/create/page.tsx.
- [x] WS-04 `GET /api/workspaces` — список workspace пользователя #db !med @blocked_by:WS-01
      Реализовано: app/api/workspaces/route.ts (POST+GET).
- [x] WS-05 Роутинг: `is_new_user` → wizard; существующий пользователь → Flow Board #ui !med @blocked_by:AUTH-02,WS-03
      Реализовано: src/app/page.tsx (Guard + redirect на /board/create или /flowboard).
- [x] WS-06 Rate limit + randomBytes(16) для `/api/invite` (SEC-02) #auth !high @blocked_by:DB-15
      product_vision §8.5. `randomBytes(16).toString('base64url')`, rate limit 10/IP/15мин. Таблица `invite_links` создана в DB-15.
      Реализовано: supabase/migrations/006_invite_unique_index.sql, app/api/invite/route.ts (POST+GET),
      app/api/init/route.ts (start_param обработка), hooks/useTelegramAuth.ts (startParam), types/api.ts (InviteGenerateResponse).
      Механика: одна активная ссылка на workspace, 24h expiry, многоразовая, частичный уникальный индекс.

---

## Stage 4 · Flow Board без AI

> dev_setup §3: GET/PATCH `/api/tasks`, `KanbanBoard` + DnD, Realtime, `SprintBar`, ручное создание, `UrgencyBadge`. DoD: DnD работает, Realtime синхронизирует клиентов, `trg_record_task_column_move` пишет историю.

- [x] FLOW-01 `GET/POST/PATCH/DELETE /api/tasks` — last-write-wins, **без** version-check (см. INV-09 примечание в Architecture-Compact) #db !high @blocked_by:WS-01
      dev_setup §7.2, §7.3. Реализовано: app/api/tasks/route.ts (GET+POST), app/api/tasks/[id]/route.ts (PATCH+DELETE).
- [x] FLOW-02 `KanbanBoard` — реализовано через BottomSheet + SwipeableTaskCard с 4 колонками (backlog, in_progress, review, done) и оптимистичным UI #ui !high ✅
      Реализовано: `src/components/flowboard/ColumnTasksSheet.tsx` + `SwipeableTaskCard.tsx`. Свайпы для перемещения между колонками, exit-анимации, swappedTasks/PendingExit state.
      **Примечание:** Не через `@dnd-kit`, а через swipeable-паттерн для TWA.
- [ ] FLOW-03 Fractional indexing (`position = (prev+next)/2`) #ui !low @deferred
      product_vision UC-03. `lib/fractionalIndex.ts` существует как заготовка на будущее.
      **Использование пока не требуется** — задачи сортируются по created_at в текущей архитектуре.
      Возможные применения: приоритизация "мои задачи сверху", drag-and-drop позиционирование, pin задач, смарт-сортировка.
- [x] FLOW-04 Realtime-подписка на `tasks` #ui !high ✅
      Реализовано в `src/contexts/DataContext.tsx` (строки 559-598): подписка на `postgres_changes` для tasks таблицы, автоматическое обновление через dispatch PATCH_TASK/REMOVE_TASK.
- [x] FLOW-05 Sprint CRUD API + `SprintBar.tsx` (метрики скрыты в статусе `planning`) #ui !med @blocked_by:FLOW-01
      flow_.md §7. Реализовано: app/api/sprints/route.ts (POST+GET), app/api/sprints/[id]/route.ts (PATCH+DELETE),
      PATCH /api/sprints/[id]/activate, SprintCreateSheet/SprintEditSheet/SprintViewSheet,
      `SprintCompressedInfo` внутри `FlowBoard.tsx`.
- [x] FLOW-06 Ручное создание задачи (`TaskForm.tsx`) + `is_inbox=false` при явном column #ui !high @blocked_by:FLOW-01
      Master §5. Реализовано: src/components/flowboard/TaskForm.tsx.
      is_inbox=true при отсутствии column, is_inbox=false при явном column.
- [x] FLOW-07 `UrgencyBadge.tsx` — светофор по дедлайну #ui !med @blocked_by:FLOW-01
      product_vision US-04. Реализовано: src/components/flowboard/UrgencyBadge.tsx.
      Цвета: red (просрочено/≤24ч), amber (≤48ч), green (>48ч).
- [x] FLOW-08 `POST /api/flow/metrics` — единый server-side flow read model (columns/workers/risk) #db !high @blocked_by:DB-13
      flow_.md §9–10, A-10. Реализовано: `src/app/api/flow/metrics/route.ts` и общий
      `src/lib/server/flowMetrics.ts`; тот же calculator используется в `my-data`.
      Контракт возвращает `risk`/`riskBreakdown`; `handoff_chain` в «Процессы» не входит.
- [x] FLOW-09 Column Health Grid 2×2 + bottom sheet по тапу колонки #ui !med ✅
      Реализовано: `TaskStatusCard` в `FlowBoard.tsx` (строки 404-477) + `handleColumnClick` → `ColumnTasksSheet`.
      WIP-метрики вычисляются из `metrics.columns[].health` (green/yellow/red).
- [x] FLOW-10 Stream — персональная лента (Фокус/В работе/На проверке/Надо сделать/Черновики) #ui !med ✅
      Реализовано: `src/components/stream/StreamView.tsx` + интеграция в `src/app/flowboard/page.tsx` (view=stream).
      Группировка задач по колонкам с groupByColumn, отображение статусов.
- [x] STREAM-01 Персональный фильтр задач в Stream (assigned/created/reviewer/handoff) #ui !med ✅
      Лента показывает только свои задачи: `assigned_to`, `created_by`, `reviewer_id`, `handoff_to` = текущий
      пользователь (owner/admin без исключений — «все задачи» во flowboard). Реализовано: `src/lib/streamFilter.ts`
      (`filterTasksForUser`) + `useMemo` в `flowboard/page.tsx`, StreamView получает отфильтрованный `streamTasks`.
      Тесты: `tests/lib/streamFilter.test.ts` (11). Boot-фаза без userId — без фильтра.
- [x] FLOW-11 `SprintCloseWizard.tsx` + переход `sprint.status→completed` #ui !med @blocked_by:FLOW-05
      product_vision US-06 (AC-06-1…3). Триггер `trg_context_invalidate_sprints` (Master §6.16) реагирует на событие.
      Реализовано в текущем уровне готовности: DELETE /api/sprints/[id] (complete), PATCH /api/sprints/[id]/activate.
      Sprint sheets: SprintViewSheet с кнопками Activate/Complete, SprintEditSheet.

- [x] FLOW-12 Feature gates Story Points / Cognitive Weight в Task/FlowBoard/Stream #ui !high ✅
      Реализовано 2026-09-25: `FlowMetricsResponse.evaluation`; отключённые контуры скрыты и исключены из пользовательских метрик; SP scale Фибоначчи; ручной SP в `task_enrichments`; A-11 и Sprint независимы. Regression: `tests/lib/storyPoints.test.ts`, `tests/lib/flowMetrics.test.ts`, `tests/api/tasks/evaluationSettings.test.ts`; type-check, lint 0 errors, Vitest 259/259.

- [x] FLOW-13 Story Point calibration ranges + done-task references #ui !high ✅
      Стандартные ориентиры `1–2 / 2–4 / 4–8 / 8–16 / 16–32`; максимум один уникальный `done`-эталон на SP; server tenant/status validation; F-03 data-block. Без SQL-миграции. Проверки: type-check, lint 0 errors, Vitest 269/269.

---

## Stage 5 · Voice / NL Input (F-04)

> dev_setup §3: `/api/ai/transcribe`, `/api/ai/parse-task`, `VoiceRecorder`, `AiInput`, confidence handling. DoD: голос → транскрипт ≤400мс, парсинг корректный, fallback при ошибке Groq.

- [x] F04-01 `POST /api/ai/transcribe` (Groq Whisper) + `detectSTTStrategy` (web-speech / groq-whisper) #ai !high @blocked_by:WS-01
      ai_.md §3.1–3.2. Реализовано: `src/app/api/ai/transcribe/route.ts`, `src/lib/ai/stt.ts`.
- [x] F04-02 `VoiceRecorder.tsx` + waveform + MediaRecorder lifecycle #ui !high @blocked_by:F04-01
      Реализовано: `src/hooks/useVoiceRecorder.ts`.
- [x] F04-03 `POST /api/ai/parse-task` (Groq llama-3.3-70b, JSON mode обязателен) + `ParseResponseV2` #ai !high @blocked_by:WS-01
      ai_.md §3.3–3.4. Реализовано: `src/app/api/ai/parse-task/route.ts`, `src/lib/ai/groq.ts`, `src/lib/ai/prompts.ts`, `src/lib/ai/types.ts`.
- [x] F04-04 Детерминированный Gatekeeper (skip/light/standard) #ai !high @blocked_by:F04-03
      ai_.md §3.5. Реализовано: `determineEnrichmentStrategy()` в `src/lib/ai/types.ts`.
- [x] F04-05 `AiInput.tsx` — единая строка NL + голос #ui !high @blocked_by:F04-02,F04-03
      Реализовано: `src/components/ai/AiInput.tsx`.
- [x] F04-06 Correction Sheet (TWA) при `clarity_score`/`confidence` ниже порога #ui !med @blocked_by:F04-05
      ai_.md §3.7. Реализовано: `src/components/ai/CorrectionSheet.tsx`.
- [x] F04-07 Route Handler полный поток: INSERT `tasks` + условный `task_enrichments`(skip) или `enrichment_queue` #db !high @blocked_by:F04-04
      ai_.md §3.6. Реализовано: `src/app/api/ai/create-task/route.ts` — полный Route Handler: parse → assignee matching → INSERT `tasks` со всеми полями (raw_input, clarity_score, complexity, enrichment_strategy, cognitive_weight, tags, column) → условный `task_enrichments`(skip) или `enrichment_queue` → `task_events` (parse_rewrite). `AiInput.tsx` вызывает `/api/ai/create-task`; `CorrectionSheet.tsx` редактирует уже созданную задачу через PATCH `/api/tasks/:id` (условный показ по §3.7).
- [x] INV-05 Ревью: все AI-outputs F-04 содержат `workspace_id` (tenant isolation) #ai !high @blocked_by:F04-07
      Master A-7, INV-05. Закрыто: `/api/ai/parse-task` резолвит `workspace_id` через `workers.source_id = profileId`, `/api/tasks` POST использует `worker.workspace_id`.
- [x] F04-08 JSON mode enforcement (LLM-1): `response_format: { type: 'json_object' }` в F-04 Parse #ai !high ✅
       security §1.1, ai_.md §3.4. Реализовано: `src/lib/ai/groq.ts` строка 96 (`response_format: { type: 'json_object' }`).
       Параметр передаётся в каждый API-запрос Groq через `chatCompletion()`.
- [x] F04-09 data_sharing_level branching в F-04: `sharingLevel !== 'minimal'` guard для `workspace_context_cache` #ai !high ✅
       ai_.md §3.4 (v0.10.0), security §2.1. Реализовано: `src/lib/ai/prompts.ts` строки 41-45.
       При 'minimal' — cache блок пропускается, отправляются только teamBlock + workspace_context.
- [x] F04-10 Zod-валидация F-04 output с безопасным fallback #ai !high ✅
       security §1.1, ai_.md §2.5. Реализовано: `src/lib/ai/types.ts` (schema строки 29-41, validateParseResponse строки 126-132, SAFE_FALLBACK_PARSE строки 108-120).
       При несоответствии схеме — возвращается SAFE_FALLBACK_PARSE, сырой LLM-вывод не пробрасывается.
- [x] F04-11 `workspace_context_cache` в F-04: settings SELECT + `workspaceContextCacheBlock` в промпт #ai !med ✅
       ai_.md §3.4 (v0.9.0). Реализовано: `src/app/api/ai/create-task/route.ts` строки 98-99 (GET cache), строка 114 (передача в промпт).
       `src/lib/ai/workspaceContextCache.ts` (getWorkspaceContextCache utility).
       `src/lib/ai/prompts.ts` строки 39-45 (workspaceContextCacheBlock builder).

---

## Stage 6a · Document Upload (DOC)

> DOC-01 Upload API + DOC-02 Document UI — добавлены в этой сессии.

- [x] DOC-01 `POST /api/workspaces/[id]/documents` — Upload API #db !high
      Реализовано: app/api/workspaces/[id]/documents/route.ts.
      POST: file validation (.md, ≤512KB), Supabase Storage upload, workspace_documents INSERT, enrichment_queue(doc_process).
      GET: list documents with status tracking.
- [x] DOC-02 Edge Function `doc-process` развёрнута на atarmvtzvlwhkheeabeb #infra !med
      Развёрнута: 2026-07-15. Переименованы env vars (SUPABASE_ префикс заблокирован): SB_URL, SB_SERVICE_ROLE_KEY, NEURALDEEP_KEY.
      Обновлено: 2026-07-16 — код + перезадеплоена.
      Реализация (чанкование + embedding + `source_origin='doc_rag'` tag + graceful degradation `docContext=''`) — см. F03-13.
 [x] DOC-03 Создать bucket 'documents' в Supabase Storage (ручное создание через Dashboard) #infra !high
      Dashboard → Storage → Create Bucket → name: `documents`, public: OFF, file_size_limit: 524288.

---

## Stage 6b · Card Enrichment (F-03)

> dev_setup §3: Edge Function `enrich-task`, `enrichment_queue` polling, идемпотентность, retry backoff. DoD: фоновое обогащение работает, Realtime обновляет UI, при ошибке — тихий toast.

 - [x] F03-01 Edge Function `enrich-task`: settings SELECT (`data_sharing_level`, `doc_kb_config`, ...) #ai !high @blocked_by:F04-07
      ai_.md §2.2.
 - [x] F03-02 UUID-теги `wrapData()` изоляции динамических данных (LLM-1) #ai !high @blocked_by:F03-01
      security §1.2.
 - [x] F03-03 Embedding с кэшированием (SHA-256 hash, cache-hit/miss) #ai !high @blocked_by:F03-01
      ai_.md §2.2 шаг 2, Master §6.1 (`embedding_hash`). Реализовано: `supabase/functions/enrich-task/index.ts` — `computeContentHash()`, cache-hit path пропускает NeuralDeep, `model_used='cached'` при hit.
 - [x] F03-04 Structural context: `get_task_subgraph` (A-12), fallback на пустой subgraph #ai !high @blocked_by:INV-13
      ai_.md §2.2 шаг 1.5.
 - [x] F03-05 Semantic top-5 (`match_tasks`) + implicit calibration через `assignment_history` (avg_completion_days, порог ≥3) #ai !high @blocked_by:F03-03,DB-12
      ai_.md §2.2 шаг 3–4. Реализовано: `supabase/functions/enrich-task/index.ts` — постобработка `relatedWithHistory` с запросом `assignment_history` WHERE `outcome_status='completed_on_time'`, avg вычисляется при ≥3 записях.
 - [x] F03-06 Doc RAG с ветвлением по `data_sharing_level` (minimal=skip, standard=sim≥0.68, full=без порога) #ai !med @blocked_by:F03-01
      ai_.md §2.2 шаг 2.5.
 - [x] F03-07 LTM RAG (порог ≥500 done задач) #ai !low @blocked_by:F03-01
      ai_.md §2.2 шаг 2.6. Реализовано: `supabase/functions/enrich-task/index.ts` — `match_agent_memory` вызывается только если `sharingLevel !== 'minimal'` AND COUNT(done tasks) ≥ 500.
 - [x] F03-08 System Prompt (JSON mode, output schema, anchor-примеры `ai_hint`) #ai !high @blocked_by:F03-02,F03-04,F03-05,F03-06,F03-07
      ai_.md §2.3.
 - [x] F03-09 Идемпотентность (`requested_at` vs `updated_at`, stale enrichment) #ai !high @blocked_by:F03-08
      ai_.md §2.7, Master §7.2.
 - [x] F03-10 Retry backoff (0s → 60s → 5min → 30min, `markFailed` после 4-й) #ai !med @blocked_by:F03-09
      ai_.md §2.8, F03-10. Реализовано: `supabase/functions/enrich-task/index.ts` — `getBackoffDelay()`, `applyJitter()` (±10%), обновлённый `handleFailure()` с логированием и корректным расчётом `scheduled_at`.
 - [ ] F03-11 `EnrichmentBadge.tsx` (pending/done/failed) + `realtimePush` #ui !med @blocked_by:F03-09
 - [x] F03-12 Workspace Context Rebuild Pipeline (Edge Function `rebuild-workspace-context`, 5 источников, компрессия ≤500 симв, соблюдение INV-14) #ai !med @blocked_by:F03-01,INV-13
      ai_.md §2.9.
 - [x] F03-13 Edge Function `doc_process` (чанкование + embedding + `source_origin` tag) #ai !med @blocked_by:DB-11
      ai_.md §2.2. Реализовано: supabase/functions/doc-process/index.ts.
      Graceful degradation: `docContext=''` при отсутствии данных.
      Интегрировано с DOC-01 Upload API. Развёртывание — см. DOC-02.
 - [x] F03-14 Zod-валидация F-03 output с безопасным fallback #ai !high @blocked_by:F03-08
      security §1.1, ai_.md §2.5. При несоответствии схеме — fallback на безопасные дефолты.
 - [x] F03-15 JSON mode enforcement (LLM-1): `response_format: { type: 'json_object' }` в F-03 #ai !high @blocked_by:F03-08
      security §1.1, ai_.md §2.3. Проверка: параметр передаётся в каждый API-запрос NeuralDeep.

---

## Stage 7 · MCP Agent Router (F-06)

> dev_setup §3: `/api/mcp/*`, `mcpAuth.ts`, atomic quota, Memento, `auto_create_agent_worker`, undo. DoD: Cursor/Claude Code создают и двигают задачи, `agent_events` пишутся корректно, undo работает в окне 5 мин.

- [x] MCP-01 `lib/mcpAuth.ts`: `timingSafeEqual` (INV-06 повторно, теперь для MCP-ключей) + Tenant Isolation через `mcp_api_keys` #mcp !high @blocked_by:DB-06
      mcp_contract §2, security §3.1. Реализовано: `src/lib/mcpAuth.ts`.
- [x] MCP-02 Allowed Tools enforcement (`getKeyPermissions`/`isToolAllowed`, legacy mode `{}`) #mcp !high @blocked_by:MCP-01
      security §3.1. Встроено в `mcpAuth.ts`.
- [x] INV-07 Atomic Quota RPC (`check_and_decrement_quota`) #mcp !high @blocked_by:DB-06
      ai_.md §4.2, Master A-3, INV-07. Миграция: `024_mcp_router_support.sql` Part 3.
- [x] MCP-03 `create_task` + Rate Limit (50/мин, `max_tasks_per_minute`) + DFS Cycle Check (`blocked_by`, `409 circular_dependency`) #mcp !high @blocked_by:MCP-01,MCP-02,INV-07,INV-13
      mcp_contract §4, security §5.1. Файл: `src/app/api/mcp/create_task/route.ts`.
- [x] INV-09 `move_task` — версионная проверка (`WHERE version=$expected`) + `claim` + `unblocked_ids` из `trg_cascade_unblock` #mcp !high @blocked_by:MCP-03
      mcp_contract §4, Master §7.1, INV-09. Файл: `src/app/api/mcp/move_task/route.ts`.
- [x] MCP-04 `escalate_task` + `handoff_task` #mcp !high @blocked_by:INV-09
      mcp_contract §4. Alert-триггеры уже созданы в DB-14. Файлы: `escalate_task/route.ts`, `handoff_task/route.ts`.
- [x] MCP-05 `get_tasks_by_column` (+ `sort_by_blocking_value` Smart Backlog) #mcp !med @blocked_by:MCP-01
      Файл: `src/app/api/mcp/get_tasks_by_column/route.ts`.
- [x] MCP-06 `get_workspace_settings` + `get_task_context` (subgraph, `relevant_docs` по `data_sharing_level`) #mcp !high @blocked_by:MCP-01,F03-04
      Файлы: `get_workspace_settings/route.ts`, `get_task_context/route.ts`.
- [x] MCP-07 `send_message_to_chat` + HTML sanitization (`sanitizeOutput`, whitelist тегов) #mcp !med @blocked_by:MCP-02
      security §4.1. Файл: `src/app/api/mcp/send_message_to_chat/route.ts`.
- [x] MCP-08 `undo/:event_id` (`state_before` Memento, окно 5 мин) #mcp !med @blocked_by:MCP-03
      Файл: `src/app/api/mcp/undo/[eventId]/route.ts`.
- [x] MCP-15 `telegram_message_queue` — консьюмер добавлен (FILE-01, 2026-09-10) #mcp #bot !med ✅
      bot-notify `drainTelegramMessageQueue()`: pending/retrying → sendMessage
      (+inline-кнопка «Обсудить задачу» по metadata.full_id) + файлы (base64 →
      multipart) → sent/failed, retry max_retries=3. Оживляет send_message_to_chat.
- [x] MCP-09 `state_before` Memento + INSERT `agent_events` + шаблонная генерация summary #mcp !high @blocked_by:MCP-03
      Встроено во все handler'ы через `logAgentEvent()` в `mcpAuth.ts`.
- [x] MCP-10 Error handling matrix (все HTTP-коды §6 mcp_contract) #mcp !med @blocked_by:MCP-03,INV-09,MCP-04,MCP-05,MCP-06,MCP-07,MCP-08
      Все handler'ы возвращают стандартизированные ошибки с HTTP-кодами согласно §6 mcp_contract.
- [x] MIGRATION-024 SQL migration `024_mcp_router_support.sql` (RPC, tables, indexes, triggers) #db !high
      Применена через Supabase MCP. Содержит: `check_and_decrement_quota`, `telegram_message_queue`, `is_undone`,
      `next_task_number`, `detect_circular_dependency`, `resolve_agent_worker_id`, триггеры, RLS policies.

---

## Stage 8 · Team Tab → Flow Board §19–21 (Risk Pulse)

> dev_setup §3: Risk Pulse, карточки участников, velocity SQL, Invite FAB. DoD: Risk Pulse актуален, SP/день корректен, Invite FAB генерирует ссылку.

- [x] RISK-00 Risk Pulse server read model: единый F-01/A-11/Risk Pulse contract для `flow-metrics` и `my-data` #api !high @blocked_by:FLOW-08
      **Реализовано 2026-09-25:** `src/lib/server/flowMetrics.ts` — чистый typed calculator;
      F-01 считает assigned in_progress + reviewer review, A-11 `attention_risk_score` отдельный;
      Processes = review_backlog + stuck_tasks + orphan_blockers; handoff_chain исключён.
      `FlowMetricsResponse` расширен `risk` и `riskBreakdown`; 6 unit-теста формул.
- [x] RISK-01 Risk Pulse — три сигнала (Люди/Процессы/Эскалации) + tappable drill-down #ui !high @blocked_by:RISK-00
      **Реализовано 2026-09-25:** Flow Board использует `metrics.risk` вместо клиентских
      колонок; все три карточки tappable. People → перегруженные участники + A-11 score;
      Processes → review-backlog/stuck/orphan; Escalations → существующий Operator Queue.
- [ ] RISK-02 Предупреждение «уведомления выключены» при отсутствии Telegram-чата #ui !low @blocked_by:RISK-01
      **Сверка 2026-09-19:** не реализовано — `workspace_telegram_chats` в `src/` не используется.
- [x] RISK-03 Worker Load (человек collapsed/expanded, badge «⚠ Риск N» из `attention_risk_pulse`) #ui !high @blocked_by:RISK-00
      **Реализовано 2026-09-25:** `attention_risk_score`/`attention_risk_level` из общего
      metrics-контракта пробрасываются в worker/agent cards; `PersonCard` показывает A-11
      badge «⚠ Риск N» при score ≥ 60, отдельно от F-01 badge «Перегружен».
      `flow_.md §20`; `RISK-04/05` остаются отдельными pre-flight/velocity срезами.
- [x] RISK-04 Worker Sheet — участник (Статус/Доступы, pre-flight scoring при назначении) #ui !high @blocked_by:RISK-03
      **Реализовано 2026-09-25:** Worker Sheet использует вкладки «Статус» / «Доступы»;
      в статусе показывает velocity window, SP/день, forecast, assigned SP, Gap и реальные
      `rework_count`/`rework_rate` по уникальным задачам `review → in_progress`.
      A-11 pre-flight в `WorkerSelectSheet` показывает score/level, текущую F-01 нагрузку,
      вес новой задачи и действия «Назначить» / «Выбрать другого».
- [x] RISK-05 Velocity SQL интеграция в блок «Метрики» #db !med @blocked_by:RISK-04
      **Реализовано 2026-09-25:** `flowMetrics` считает SP/день server-side из завершённых
      задач за `workspace_settings.velocity_window_days` (fallback 14 дней) и `task_enrichments.story_points`.
      `my-data` и `flow-metrics` используют один расчёт; Worker Load больше не содержит hardcoded
      `3.5/5.0`; Worker Sheet получает фактическое окно и скорость. 2 unit-теста velocity.
- [ ] RISK-06 Поле «Контекст команды» (WorkspaceWizard + Settings, лимит 800 симв) #ui !med @blocked_by:WS-03
      **Сверка 2026-09-25:** не реализовано — `workspace_context` пишет только Edge Function
      `rebuild-workspace-context`. Канонический лимит — 800 символов (совпадает с DB CHECK и Master §6.4).
- [x] RISK-07 Invite FAB + реферальная ссылка (`t.me/onitask_bot?start=ws_CODE`) #ui !med @blocked_by:DB-15
      **Сверка 2026-09-19:** реализовано — `InviteModal.tsx` + FAB (`src/app/flowboard/page.tsx:534,548`), ссылка из `GET/POST /api/workspaces/[id]/invite`. Фактический формат — `https://t.me/onitaskbot/onitask?startapp=<code>` (deep link в TWA), а не `?start=ws_CODE`.
- [ ] RISK-08 Workspace Manager (вкладка «Доски»): карточки workspace, глобальные алерты, переключение #ui !med @blocked_by:WS-01
      **Сверка 2026-09-19:** частично — карточки досок и RiskPulse-агрегат есть (`src/app/boards/page.tsx`, `useBoardCounts`); отдельного списка глобальных алертов нет, источник агрегатов — `useBoardCounts`, а не Edge Function `/api/workspaces/summary`.
      flow_.md §23. Источник: `/api/workspaces/summary` (Edge Function, cache 60–300с).
- [x] RISK-09 Risk Pulse «Процессы»: добавить `orphan_blockers` в формулу и drill-down (v3.6.0) #ui !med @blocked_by:RISK-01
      **Реализовано 2026-09-25:** `RiskPulseSheet` показывает review-backlog, stuck и
      phantom-blockers из `riskBreakdown.processes`; backend formula и UI-группы готовы.
      `handoff_chain` сознательно остаётся отдельным Agent/Operator-сигналом (ADR-2026-09-25).
      **Bugfix 2026-09-25:** boards `People` использует F-01 cognitive load, `Processes` — review backlog + stuck + orphan blockers, `Escalations` — pending escalations; sprint read model возвращает `taskIds`/`doneTasks` и API принимает `taskIds`/`task_ids`. Agent delete доступен только в режиме редактирования, Add Agent Sheet очищен от лишнего текста.

- [x] NAV-01 Unified task navigation resolver: task/flow/invite namespace, cross-workspace launch, `open_task_id`, global/local Operator Queue scopes #api !high @blocked_by:INV-13
      **Реализовано 2026-09-25:** `/api/init` server-side резолвит task `full_id` в UUID задачи и workspace с проверкой membership; root/FlowBoard/useTaskNavigator используют единый путь; `comments` tab сохраняется; legacy `open_task` и invite поддержаны; `TelegramDeepLinkRouter` удалён; `DataContext` получил stale-load generation guard; `/boards` открывает `scope=all` Operator Queue. Regression: parser, resolver, init, queue, SDK tests.


---

## Stage 9 · Agent Cards + Escalations

> dev_setup §3: Agent cards, Escalation queue, `escalate_task`, метрики агента. DoD: оператор видит очередь эскалаций, `needs_human=true` отображается корректно.

- [ ] AGENT-01 Agent Card collapsed (◆ + цвет throughput + queue depth) #ui !high @blocked_by:RISK-03
      **Частично 2026-09-25:** Agent Card показывает ◆-маркер, `задач/д · 7д` и открывает Agent Sheet.
      Полноценный цветовой throughput и collapsed queue-depth badge остаются отдельным follow-up;
      Agent Sheet от этого не зависит.
- [x] AGENT-02 Agent Card expanded (Interpretation hint, «Метрики · 7 дней») #ui !high
      **Реализовано 2026-09-25:** отдельный `AgentSheet` с вкладками «Статус» / «Подключение».
      Статус использует throughput, pending escalations, handoff и interpretation hint;
      блок недельных данных называется «Метрики · 7 дней». Подключение использует
      существующие `listAgents` / `updateAgent` / `revokeAgent`, имеет read-only просмотр,
      редактирование и удаление с подтверждением. Когнитивная нагрузка агента в UI не отображается.
      Agent Sheet не зависит от оставшихся cosmetic follow-up пунктов Agent Card.
- [x] AGENT-03 Operator Queue (`pending_escalations`, «Попробовать снова» / «Открыть задачу») #ui !high @blocked_by:DB-13,MCP-04
      **Реализовано 2026-09-25:** tappable Risk Pulse «Эскалации», workspace-scoped
      oldest-first queue, readable reasons, suggested_action/nack diagnostics,
      empty/error/loading states. Retry подтверждается и атомарно создаёт
      `dispatch_outbox(attempt=1)` через миграцию 105; blocked/done/unassigned/
      open-claim guards, idempotent replay, audit feed и existing resolution/push
      triggers. GET/POST Route Handlers + 7 Vitest route-тестов.
      flow_.md §21, team_tab §2.7 (SQL-справочник).
- [x] AGENT-04 Task Sheet, блок «Связанные задачи» (relations API, orphan repair) #ui !high @blocked_by:MCP-06
      **Реализовано 2026-09-24:** отдельная вкладка отменена по решению владельца;
      постоянный блок в «Дополнительном контексте», только `blocks`, два направления,
      поиск по full_id/title, progress блокеров, downstream impact, переход/назад.
      DB RPC + sync is_blocked create/delete/complete/reopen; cycle helper исправлен.
- [ ] AGENT-05 Cascade Unblock toast (Realtime `cascade_unblock`) #ui !med @blocked_by:INV-13
      **Частично закрыто 2026-09-24:** DB cascade/reopen, atomic `is_blocked` и
      `affected_task` sync в relations API готовы; отдельный глобальный toast — P2.
- [ ] AGENT-06 Pill «🔄 Цепочка ×N» для `handoff_chain` (Phase 1.1 — можно отложить за MVP) #ui !low @blocked_by:AGENT-01
      **Сверка 2026-09-19:** не реализовано (Phase 1.1, по описанию отложено).
- [ ] AGENT-07 Task Sheet, вкладка «Детали» (`ai_hint`, описание, метаданные, кнопка «→ следующая колонка») #ui !high @blocked_by:AGENT-04
      **Сверка 2026-09-19:** частично — `ai_hint` приходит в типах (`src/types/flowboard.ts:259`) и в `DataContext.tsx:53`, но в `TaskViewEdit.tsx` не отображается; кнопки «→ следующая колонка» нет.
      flow_.md §22.
- [x] AGENT-08 Task Sheet, вкладка «Комментарии» (фид: `task_comments` + `task_column_history` + `agent_events` через RPC `get_task_feed`; composer → POST `/api/tasks/:id/comments`; live через broadcast `task-comments-<task_id>`; ADR-2026-09-06, миг. 076) #ui !med
      flow_.md §22, Master §6.10.
- [x] AGENT-09 Route Handler relations (`GET/POST/DELETE`, только `blocks`) #api !med @blocked_by:INV-13
      **Реализовано 2026-09-24:** resource-scoped TWA auth/tenancy, server-owned
      `workspace_id`/`weight`/`created_by`, self-link/duplicate/cycle/done guards,
      atomic `is_blocked`, orphan repair. Vitest: 7 route-тестов.

---

## Stage 10 · Telegram Bot

> dev_setup §3: `/api/bot/*`, webhook, F-04 адаптер, workspace resolution, команды, deep links. DoD: голосовое → задача, `/flow` актуален, deep link открывает нужную задачу.

- [x] BOT-01 `POST /api/bot/webhook` + HMAC-подпись (SEC-03) #bot !high @blocked_by:INV-10
      **Сверка 2026-09-19:** реализовано — `src/app/api/bot/webhook/route.ts`, проверка `X-Telegram-Bot-Api-Secret-Token` (`route.ts:1901–1907`, `verifyTelegramWebhookSecret`); фактически secret-token, а не HMAC-подпись.
      bot_.md §6.1, product_vision SEC-03. SEC-06: `BigInt(user.id)` вместо `Number()` для `telegram_id`.
      Зависимость исправлена: `INV-10` (workspace_telegram_chats) вместо ошибочной `DB-11`.
- [ ] BOT-02 Workspace resolution (6 приоритетов, last-used SQL) #bot !high @blocked_by:BOT-01
      **Сверка 2026-09-19:** частично — `src/lib/bot/workspaceResolver.ts` реализует 4 приоритета (explicit @workspace, linked chat bindings, единственный workspace, несколько → inline-кнопки); приоритеты с last-used (`profiles.last_active_workspace_id`) в коде не найдены.
      bot_.md §3. SEC-06: `BigInt(user.id)` вместо `Number()` для `telegram_id`.
- [x] BOT-03 `/task` текст+голос, двухфазный ответ (typing+placeholder → editMessageText), duplicate guard (`message_id`) #bot !high @blocked_by:BOT-02,F04-03
      **Сверка 2026-09-19:** реализовано — `src/lib/bot/taskHandler.ts` (`handleTextTask`/`handleVoiceTask`: transcribe → parse → dedup → create → карточка подтверждения, `ephemeralMsgId` + edit); duplicate guard через `dedup_key` (§6.2a), а не `message_id`.
      bot_.md §5.1, §6.2. SEC-06: `BigInt(user.id)` вместо `Number()` для `telegram_id`.
- [ ] BOT-04 `@onitask` инлайн-вызов #bot !med @blocked_by:BOT-03
      **Сверка 2026-09-19:** не реализовано — обработчика `inline_query` в `src/` нет (совпадения только в типах telegramsjs).
- [ ] BOT-05 `/inbox`, `/flow`, `/task ALPHA-123` #bot !med @blocked_by:BOT-02
      **Сверка 2026-09-19:** частично — `/task ALPHA-123` покрыт командой `/call` (+алиасы `/run`, `/run-task`, `commands.ts:79`), работают `/task`, `/backlog`, `/help`, `/start`; `/inbox` и `/flow` отсутствуют (`COMMANDS_REQUIRING_WORKSPACE = ['task','backlog']`).
      bot_.md §5.3, §5.7.
- [ ] BOT-06 `/resolve ALPHA-123` (`needs_human=false` + `skip_alert_triggers` + INSERT `enrichment_queue`) #bot !med @blocked_by:BOT-05
      **Сверка 2026-09-19:** не реализовано — `handleResolveTask` (`src/app/api/bot/webhook/route.ts:1856`) только отдаёт карточку задачи: `needs_human` не сбрасывается, INSERT в `enrichment_queue` отсутствует.
      bot_.md §5.8.
- [x] BOT-07 Онбординг через invite (`/start ws_CODE`) #bot !high @blocked_by:DB-15
      **Сверка 2026-09-19:** реализовано — `src/lib/bot/onboarding.ts` (`/start ws_CODE`, срез префикса `ws_`, регистрация воркера).
      bot_.md §5.9.
- [x] BOT-08 Freemium boundary (тариф-гейты, таблица §4) #bot !med @blocked_by:BOT-03
      **Сверка 2026-09-19:** реализовано — `src/lib/bot/freemium.ts` (`checkFreemiumBoundary`, `PLAN_COMMANDS`, gate-сообщение), вызов из `taskHandler.ts`.
- [ ] BOT-09 Daily Standup (`/standup` ручной вызов + `escapeHtml` санитизация + блок 📥 inbox >24ч) #bot !med @blocked_by:BOT-05
      **Сверка 2026-09-19:** не реализовано — команды `/standup` нет (`src/lib/bot/commands.ts`).
      bot_.md §5.6. Блок 📥: `is_inbox=true AND created_at < NOW() - INTERVAL '24 hours'`, макс. 3 задачи с deep link.
- [x] BOT-10 Bot Notify Worker (Edge Function `bot-notify`, DB Webhook + hourly cron fallback, retry/backoff при 429) #bot !high @blocked_by:DB-16,DB-14
      **Сверка 2026-09-19:** реализовано — `supabase/functions/bot-notify` (auth через vault-secret RPC `get_bot_notify_cron_secret`, consumer `telegram_message_queue` с `retry_count`/`max_retries`, отправка sendMessage/sendDocument).
      bot_.md §6.5.
- [x] BOT-11 Сигналы светофора → TG-уведомления (миг. 090, cron `deadline-notify-tick` 09:00 МСК) #bot #db !med
      Дедуп `task_deadline_notifications` (amber once / red daily / overdue once);
      тик `deadline_notify_tick()` → `enrichment_queue alert_type=deadline_approaching`;
      bot-notify: DM постановщик + исполнитель (`resolveTaskRecipients` + alsoAssignee),
      контекст `deadline_overdue` для `hours_left < 0`.
      Фикс выключения светофора: `PUT/POST /api/workspaces` — пустой массив/undefined → NULL
      (раньше off не сохранялся, POST навязывал дефолт 3/1).
      Отложено → сделано: пороги светофора подключены к `UrgencyBadge` (пропс `thresholds`,
      дефолт 3/1) через `src/lib/urgency.ts` (`getUrgencyLevel`, `thresholdsFromSignals`,
      зоны = зонам `deadline_notify_tick`); StreamView лениво тянет настройки доски.
      В bot-notify `hours_left` ≥ 24ч рендерится в днях с плюрализацией
      («Просрочено на ~10 дней» вместо «~240ч»).
- [x] BOT-12 Persistent Reply-клавиатура для основных команд #bot !low
      Реализовано в `lib/bot.ts` + `src/app/api/bot/webhook/route.ts`: после `/start`
      в личном чате отправляется persistent keyboard `/task`, `/call`, `/backlog`, `/help`;
      кнопки используют существующий command pipeline, групповые чаты не затрагиваются.
      Валидация: type-check ✅; Vitest 166/166 ✅; targeted 1/1 ✅. Lint/Prettier
      остаются environment-broken до анализа исходников: `@rushstack/eslint-patch` × ESLint 9.39,
      отсутствующий локально `prettier-plugin-tailwindcss`.

---

- [x] WS-06 Invite flow: SDK timeout, cache bypass, transactional redemption, expired/exhausted UI
      Regression 2026-09-24: `/api/init` waits for afterInteractive Telegram SDK up to 5s; invite
      `start_param` bypasses sessionStorage; `accept_invite_link(code, source_id, display_name)`
      atomically creates/reactivates worker and increments `used_count`; expired/exhausted links
      are not presented as active. Validation: type-check ✅, Vitest 165/165 ✅, DB redemption smoke ✅.
      `docs/memory-bank/activeContext.md` § FIX: invite links (2026-09-24).

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

## Stage 13 · Calendar Integration

> Файлы реализованы: `app/api/calendar/connect/[provider]/route.ts`, `app/api/calendar/callback/[provider]/route.ts`,
> `supabase/functions/calendar-sync/index.ts` (OAuth token exchange, encrypt/decrypt, refresh),
> `app/calendar/page.tsx` (disconnect button).
> DoD: пользователь может подключить Yandex/Outlook календарь через OAuth flow, токены зашифрованы,
> sync работает, токен обновляется автоматически.

- [ ] CAL-01 Configure OAuth credentials in Supabase project settings + Vercel env vars #infra !critical @blocked_by:DB-01
        Необходимо создать приложения в консолях разработчиков и добавить 5 переменных окружения:
        (зависимость исправлена: `DB-01` вместо самозависимости `CAL-01`)

        **Yandex OAuth:**
        1. Перейти на https://oauth.yandex.ru/client/new
        2. Название: "onitask Calendar"
        3. Платформа: Web Service
        4. Redirect URI: `{NEXT_PUBLIC_SUPABASE_URL}/api/calendar/callback/yandex`
        5. Скопировать Client ID и Client Secret

        **Microsoft Graph API:**
        1. Перейти на https://entra.microsoft.com/ → App registrations → New registration
        2. Supported account types: "Accounts in any organizational directory"
        3. Redirect URI: `Web` → `{NEXT_PUBLIC_SUPABASE_URL}/api/calendar/callback/outlook`
        4. Grant admin consent для `Cal.Read`
        5. Generate client secret

        **Environment Variables (Supabase Functions + Vercel):**
        ```
        YANDEX_OAUTH_CLIENT_ID=...
        YANDEX_OAUTH_CLIENT_SECRET=...
        OUTLOOK_OAUTH_CLIENT_ID=...
        OUTLOOK_OAUTH_CLIENT_SECRET=...
        ENCRYPTION_KEY=<32-byte random string, AES-256-GCM key for INV-17>
        ```

        ENCRYPTION_KEY генерация: `openssl rand -base64 32` или `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
        Важно: ключ должен быть одинаковым для Edge Function и любого будущего серверного кода.
- [x] CAL-02 OAuth Flow: `connect/[provider]` + `callback/[provider]` Route Handlers (Yandex only) #infra !high @blocked_by:CAL-01
      calendar_.md §3. Исправлен callback handler: cookies() → cookies, исправлена обработка response. Connect handler верифицирован.
      **Removed:** Outlook provider removed from all files (types, route handlers, Edge Function, UI). Only Yandex CalDAV supported.
- [ ] CAL-03 Edge Function `calendar-sync` (OAuth token exchange, encrypt/decrypt, refresh, sync событий) #infra !high @blocked_by:CAL-01
      calendar_.md §4. Файл существует — требуется проверка/доработка до контракта.
- [x] CAL-04 Edge Function `calendar-reminder` (обработка pending job, резолюция `target_worker_id`, sendMessage) #infra !high @blocked_by:CAL-03
      calendar_.md §5, bot_.md §6.5.1. Файл существует — верифицирован. Добавлена миграция 025 для триггеров планирования напоминаний.
- [x] CAL-05 UI календаря (страница настроек + виджет, подключение/отключение аккаунтов) #ui !med @blocked_by:CAL-02
      calendar_.md §6. Исправлены stub'ы в `page.tsx`, `CalendarView.tsx`. Создан `CalendarSettingsCard.tsx`, интегрирован в settings page.
- [ ] CAL-06 INV-17: шифрование OAuth-токенов через pgcrypto AES-256-GCM (ENCRYPTION_KEY) #db !high @blocked_by:CAL-01
      Master §6.19, INV-17, calendar_.md §3.3. Токены никогда не передаются клиенту.
- [x] DUTY-01 Autonomy levels + duty playbook (миграция 049) #mcp #ui !high ✅
      Master §6.4 (`agent_duty_playbook`), §6.19 (`autonomy_level`), mcp_contract v0.8.2.
      Реализовано: миграция `049_duty_mode_autonomy.sql`; `lib/shared/dutyPlaybook.ts`
      (дефолты observer/tasks/full + resolveDutyPlaybook); `resolveAgentKey` прокидывает
      autonomyLevel; `get_workspace_settings` → `autonomy_level` + `duty_playbook`;
      POST /api/mcp-keys принимает autonomy_level (observer → read-only allowed_tools);
      UI: селектор уровня в AddMcpKeySheet + блок «Старт сессии» на settings/mcp.
- [x] DUTY-02 Реактивные пинки: деплой после апрува + возвраты на доработку
      (миграция 050) #mcp #db !high ✅
      Кейс ONIT-7: агент завершил сессию после review → апрув никто не заметил,
      деплой не случился. wait_for_tasks получил критерии пробуждения:
      deploy_requests (review→done, full-ключи; не-разработка → пропуск) и
      fix_requests (review→in_progress, любой домен). Детект по task_column_history
      (24ч), дедуп маркерами agent_events tool='deploy_notify'/'fix_notify'
      (metadata.history_id). Плейбук full: секция 6 переписана на реактивную —
      периодические сканы done/in_progress убраны. mcp_contract §4.10 обновлён.
- [x] DUTY-03 Причина возврата на доработку (миграция 051) #bot #db #mcp !high ✅
      Двухшаговый UX: «🔧 Вернуть на доработку» больше не двигает задачу сразу —
      бот запрашивает текст причины (pending в `bot_review_fix_pending`, TTL 1ч,
      кнопка «⬆️ Назад» восстанавливает карточку ревью), следующее сообщение =
      причина → `review_action(p_reason)` атомарно пишет `metadata.last_fix_reason`.
      Каналы доставки агенту: `fix_requests[].fix_reason` (пинок, мгновенно) +
      `metadata.last_fix_reason` (персистентно через get_task_context).
      Hotfix `review_fix_reason_fn_fix`: unqualified `metadata` в PL/pgSQL.
- [x] DUTY-04 Loop-guard fix + INV-04 app-level onboarding (миграция 052) #mcp #db !high ✅
      Кейс: дежурный цикл Cline убит клиентским loop-guard'ом («5 consecutive
      identical calls») — duty-loop шлёт идентичные payload'и. Fix:
      wait_for_tasks += poll_seq (счётчик prev+1, сервер игнорирует),
      плейбуки observer/tasks/full обновлены.
      INV-04: триггер auto_create_agent_worker удалён — он материализовал
      ЛЮБОЕ имя из agent_events, включая псевдо-агентов webhook
      (telegram_user_<id>) → люди становились агентами-воркерами на доске.
      Создание воркера перенесено в resolveAgentWorkerId (find-or-create,
      authenticated path only). Фантóмы невозможны архитектурно.
- [x] CTX-01 Server-side duty state — wait_for_tasks без known_task_ids
      (миграция 056 `agent_duty_state`) #mcp #db !high ✅
      Кейс: дежурный цикл раздувал контекст LLM-сессии — растущий список
      known_task_ids повторялся в каждом poll-вызове, каждый Auto Compact
      разрушал состояние (дорогая реконструкция через agent_active_tasks).
      Решение: сервер сам помнит доставленные задачи — таблица
      agent_duty_state(workspace_id, agent_name PK, seen jsonb), ключ =
      аутентифицированная идентичность (id сессии не передаётся вовсе).
      Persist ДО возврата ответа (at-least-once при сбое), visibility TTL 4ч,
      cap 500 id, GC стейтов >7д. Wall-clock guard в long-poll (итерация не
      стартует при остатке <3с — гарантия ответа до клиентского таймаута,
      кейс MCP timeout 60s). Плейбуки observer/tasks/full: payload константен,
      правило ретрая после ошибок (poll_seq+1, timeout_sec/2). mcp_contract
      §4.10 → v0.9.0.
- [x] CTX-02 Гигиена payload get_task_context #mcp !med ✅
      Opt-out флаги (дефолты = legacy): include_workspace_context /
      include_memory_summary (статичные секции — разово за сессию),
      events_limit (default/max 20). route.ts schema+dispatch, плейбуки:
      первый вызов без флагов, далее с флагами экономии. mcp_contract §4.7.
- [x] CTX-01a Hotfix: двухфазная доставка deliver→ack #mcp !high ✅
      Регрессия CTX-01: пометка «увидено» в момент доставки глушила
      недобработанные задачи до 4ч (кейс «назначил задачу — агент не берёт»).
      Теперь: delivered = мягкая пометка 10 мин (нет ack → повторная доставка),
      acked = жёсткая 24ч (клиент эхом вернул обработанные id через
      known_task_ids — параметр теперь ack-дельта, не вся история).
      Payload остаётся малым/константным. Без миграции (jsonb допускает
      флаг k в элементах массива). Плейбуки + contract §4.10 синхронизированы.
- [x] CTX-03 Playbook variants high/lite на ключе (миграция 059
      `mcp_agent_keys.playbook_variant`) #mcp #db #ui !high ✅
      Гипотеза подтверждена: full-плейбук (~45 правил / ~1.9k токенов)
      слишком сложен для моделей класса Qwen3-A3B — прод-аномалии
      (пропуск claim, speedrun → review) соответствуют типичным отказам
      малых моделей на длинных процедурах.
      Решение: ортогональный уровню вариант playbook_variant ('high'|'lite',
      default high; права не меняются). DUTY_PLAYBOOK_FULL_LITE: плоский
      чек-лист ~16 правил (~600 токенов) — ядро цикла + ack + деплой с
      guard'ом dirty-tree; редкие ветки → escalate_task (fail-loud).
      resolveDutyPlaybook(level, stored, variant), override ключ
      "<level>_lite". POST/PATCH /api/mcp-keys принимают playbook_variant;
      UI: опции «Полный (сильные модели)» / «Лёгкий полный (слабые модели)»
      в AddMcpKeySheet + McpKeyDetailSheet (combined value 'full_lite',
      split в page.tsx). types/supabase.ts дополнен вручную.
      Валидация: type-check ✅; миграция применена (2 ключа → 'high');
      CHECK отклоняет невалидный домен ✅.

### Agent Runtime (CLI Runner) — см. docs/onitask_agent_runtime_vision_.md

- [x] RUNNER-01 Vision & Decision Doc (Supervisor-архитектура) #cli !high ✅
      Решение: Runner = супервизор над headless-исполнителями; MCP — единственный
      транспорт; npm-only v0; AC-1…7 чеклисты приёмки; REST freeze + sunset план.
- [ ] RUNNER-02 Runtime skeleton: `@onitask/agent` — ENV-конфиг (ONITASK_BASE_URL,
      ONITASK_API_KEY, RUNTIME_ID auto), CLI `onitask agent start/once/whoami`,
      ops-цикл (lease → ctx → runner → heartbeat* → terminal → ack) по doc 03 /
      REST /api/agent/ops/*, reconcile-таймер (30–60с active / 2–5мин idle),
      exit-коды 0–6 #cli !high
      ✅ План готов и верифицирован по коду: `docs/WorkerPlan.md` (контракты 062/071,
      матрица ошибок, runner stdin/stdout, этапы W1–W5). Реализация через MCP
      (/api/mcp, JSON-RPC 2.0) как единая точка входа.
- [ ] RUNNER-03 Executor plugin interface + адаптер claude-code headless
      (`claude -p` в repo_path); также wake-listener на публичном канале
      `agent:<key_id>` (broadcast 'work.available' → lease) — best-effort,
      гарантия через reconcile/lease #cli !high @blocked_by:RUNNER-02
- [ ] RUNNER-04 Flow integration: claim → delegate → review;
      для full-уровня — деплой после апрува (git add/commit/push, guard на
      чужие изменения в рабочем дереве) #cli !med @blocked_by:RUNNER-03
- [ ] RUNNER-05 Fail-loud + санитизация логов: крах → send_message_to_chat;
      sk_* маскируется в логах; ключ не в argv #cli !high @blocked_by:RUNNER-02
- [ ] RUNNER-06 Heartbeat + статус «на смене / офлайн» в Flow Board #cli !med @blocked_by:RUNNER-02
- [ ] RUNNER-07 Onboarding telemetry: вариант первого успешного подключения
      (MCP vs CLI) #mcp !med @blocked_by:MCP-01
- [ ] RUNNER-08 REST `/api/agent/*` freeze + счётчик внешних вызовов;
      sunset через 30 дней наблюдения (см. vision §7) #mcp !low
- [ ] RUNNER-09 Провал исполнителя: retry ≤ N → escalate_task с контекстом;
      least-privilege профиль запуска исполнителя (AC-8/9) #cli !high @blocked_by:RUNNER-03
- [ ] RUNNER-10 Бюджетные стоп-краны: лимиты задач за смену / времени
      исполнения → корректное завершение смены + отчёт в чат (UC-10,
      развитие F-01 на агентную экономику) #cli #ai !med @blocked_by:RUNNER-02

### Hotfix

- [x] FIX-01 review_action 42725 «function is not unique» (миграция 053) #db !critical ✅
      Причина: миграция 051 добавила 5-арг перегрузку (p_reason DEFAULT) поверх
      4-арг сигнатуры → PostgREST не мог выбрать кандидата на любом вызове →
      кнопки «Согласовать/Вернуть» в боте всегда падали с generic-ошибкой.
### Legacy cleanup (зомби хвосты от старых подходов; аудит 2026-09-03)

- [x] CL-01 Вычистить мёртвые остатки long-poll/wake-вебхук эпохи #db #mcp !med ✅
      Аудит (2026-09-03) нашёл и вычищено (миграция 072 + правки кода/доков):
      - `mcp_agent_keys`: дропнуты `webhook_url`, `webhook_secret`
        (R5 wake-вебхук, не реализован), `key_plaintext` (‼ был НЕ в миграциях —
        дрейф для `supabase db push`), `agent_type` (никогда не использовался).
      - `agent_events_tool_check` ужесточён: убраны `deploy_notify`/`fix_notify`
        (мёртвые маркеры удалённого wait_for_tasks из миг. 050).
      - Удалена пустая папка `supabase/functions/agent-duty-runtime/`.
      - `lib/shared/autonomyLevels.ts`: убран мёртвый экспорт `READ_ONLY_ALLOWED_TOOLS`.
      - `types/supabase.ts`: убран `agent_type` (3 места).
      - Доки: LEGACY-баннеры в `docs/onitask_mcp_contract_.md` (шапка) и
        `docs/ARCHITECTURE-COMPACT.md` §7 (agent_duty_playbook).
      Верификация: колонок нет, CHECK обновлён, ни одна функция/вьюха БД
      не ссылается на дропнутые колонки, advisors без новых находок, type-check ✅

### Wake server-side (Arch 0.9, спеки 12–13)

- [x] WAKE-01 Outbox publisher + realtime-broadcast (миграция 071) #db !high ✅
      `wake_sent_at`, `ops_publisher_tick(p_batch)`, cron '10 seconds', public-канал
      `agent:<key_id>`, at-least-once. E2E-валидация на проде: cron→broadcast→слушатель;
      lease без realtime работает. Broadcast = best-effort, гарантия = outbox+lease+reconcile.
      Фикс: DROP 4-арг перегрузки, каноническая 5-арг сигнатура (DEFAULT NULL).
      Верифицировано: named-call тест возвращает типизированный version_conflict.
      Правило против рецидива — `.clinerules` validation_commands.rpc_overloads.

---

## Сводка по стадиям

| Stage | Тема | Задач |
|---|---|---|
| 1 | DB Migrations | 29 |
| 2 | Auth / Init | 5 |
| 3 | Workspace Wizard | 6 |
| 4 | Flow Board без AI | 11 |
| 5 | Voice / NL Input (F-04) | 12 |
| 6a | Document Upload (DOC) | 3 |
| 6b | Card Enrichment (F-03) | 15 |
| 7 | MCP Agent Router (F-06) | 12 |
| 8 | Team Tab → Risk Pulse | 9 |
| 9 | Agent Cards + Escalations | 9 |
| 10 | Telegram Bot | 10 |
| 11 | AI Flow Summary | 5 |
| 12 | LTM Pipeline | 4 |
| 13 | Calendar Integration | 6 |
| 14 | FILES (артефакты задач + TG) | 8 |
| 15 | Agent Connectors (внешние агенты) | 9 |
| **Итого** | | **153** |

---

## Stage 14 · FILES — артефакты задач + коммуникация агент↔человек через Telegram (2026-09-10)

> Решение владельца: вариант **B** (Storage bucket + манифест, base64 только как транспорт
> для JSON-каналов агента). Две изолированные сущности: `documents` (Knowledge Base, RAG)
> и `task-attachments` (артефакты задач). Каскад: строки БД — ON DELETE CASCADE,
> бинарники Storage — явная очистка в DELETE-роуте + GC-сирот (Phase 2).

- [x] FILE-01 Исходящие файлы агента: `opsTerminalCore` + attachments (#mcp #db #msg !high)
      Миг. 077: `task_attachments` (связка `execution_id` → идемпотентный retry, UNIQUE(execution_id, filename)),
      bucket `task-attachments`, расширение `telegram_message_queue` (attachments/metadata).
      `lib/shared/attachments.ts`: whitelist + magic-bytes + лимиты (≤5, ≤2MB/файл, ≤3MB суммарно).
      `bot-notify`: `sendTaskAttachments` после карточки (review + done),
      `drainTelegramMessageQueue` — консьюмер для send_message_to_chat (чинит MCP-15).
- [x] FILE-02 Reply-маппинг: `bot_task_messages` (UNIQUE(chat_id, message_id)) #bot #db !med
      webhook пишет маппинг при отправке карточки созданной задачи (`rememberBotTaskMessage`).
      bot-notify: task_review + task_done карточки — тоже пишут маппинг (локальный helper,
      ON CONFLICT DO NOTHING) — reply+файл работает на любых карточках задач.
- [x] FILE-03 `send_message_to_chat` + attachments + task_id + inline-кнопка «Обсудить задачу» #mcp #bot !high
      `SendMessageToChatParams` расширен (`attachments`, `task_id`); metadata.full_id →
      deep-link `task_<full_id>_comments`; доставка через очередь (consumer FILE-01).
      Deep-link: unified namespace → `/api/init` launch_context → `/flowboard?open_task_id=<UUID>&tab=comments` (NAV-01).
- [x] FILE-04 Входящие файлы в TG: `/attach`, reply+файл, файл+caption, pending full_id #bot !med
      `src/lib/bot/attachments.ts` + `bot_attach_pending` (TTL 15 мин, purge-cron).
      Сценарии: reply→attach; `/attach`+файл→спросить full_id; файл+caption→задача+attach;
      файл без caption→спросить назначение. full_id резолв через `find_task_by_full_id`.
- [x] FILE-05 TWA: блок «📎 Файлы» в TaskViewEdit (GET-подгрузка, upload) + `GET/POST /api/tasks/[id]/attachments` #ui #api !high
      Убран toggle «Зависимые задачи» (UI-only артефакт, не task_relations). Блок всегда активен,
      паттерн DocumentsCard, лимиты 5/2MB/3MB.
- [x] FILE-06 Входные файлы агенту: `get_task_context` + `include_attachments` (signed URL TTL 1ч) #mcp !med
      Opt-out флаг по паттерну CTX-02; default false (payload-hygiene).
- [x] FILE-07 Каскад и cleanup: строки CASCADE + Storage remove в `DELETE /api/tasks/[id]` #db #api !high
      GC-сирот бинарников — миг. 081: `gc_orphan_task_attachments()` (объект бакета без
      манифеста, старше 1ч → bulk delete через Storage API `net.http_post` + Vault
      service_role_key, паттерн 041; прямой DELETE из storage.objects заблокирован
      `storage.protect_delete`) + defensive-очистка манифест-строк без задачи.
      Cron `gc-orphan-task-attachments` 03:10 UTC daily.
- [x] FILE-08 Read-only MCP tool `get_task_comments` — фид «Комментарии» для duty poll #mcp !med
      Обёртка над RPC `get_task_feed` (076). Вариант A — poll; Realtime (B) — перспектива.
- [x] FILE-09 Files UX: React Query + manifest-only список + on-demand скачивание (2026-09-11) #ui #api !high
      Проблемы: гонка файлов между задачами (кэш-ключ), тяжёлый GET (N+1 подписей),
      сломанное скачивание в TWA (target="_blank" мёртв в webview).
      Решение: @tanstack/react-query v5 (возвращён осознанно, ADR-2026-09-11; zustand не возвращается);
      queryKey `['task-attachments', taskId]` — изоляция by design; кэш = единственный источник
      истины (setQueryData append/delete, invalidate после каскада; локальный список удалён);
      GET = чистый манифест БЕЗ подписей; POST `[attachmentId]` — on-demand подпись с
      `download: filename` (Content-Disposition attachment); клиент: Telegram.WebApp.openLink
      → fallback window.open. Дефолты QC: staleTime 60с, gcTime 30мин, refetchOnWindowFocus false
      (TWA), retry 1. Проверено: tsc EXIT 0; build compile+types OK (page-data fail /api/bot/webhook —
      локально нет env, на Vercel vars есть); vitest = baseline (4/4 cache, init.test — pre-existing).
- [x] FILE-10 Скачивание без выхода из TWA: прокси на нашем домене + HMAC-токен + каскад (2026-09-11) #ui #api !high
      Проблемы в проде: тарабарщина в имени (Storage не делает RFC 5987 для кириллицы),
      openLink уводил на *.supabase.co, на iOS WKWebView вообще ненадёжен для программных скачиваний.
      Решение: POST [attachmentId] чеканит capability-токен (HMAC-SHA256 от TELEGRAM_BOT_TOKEN,
      TTL 5 мин, scope taskId+attachmentId) и возвращает прокси-URL НАШЕГО домена;
      GET /file?t= проверяет токен (timing-safe) → storage.download() →
      Content-Disposition с filename* UTF-8 + ASCII fallback (имя файла корректно везде);
      клиентский каскад: Telegram.WebApp.downloadFile (нативно, Bot API 7.7+, без навигации)
      → fetch→blob→anchor (полностью в TWA) → openLink (роут отвечает attachment — сразу скачивание).
      supabase-домен исчез из пути человека. Тесты токена 6/6 (подделка/scope/экспирация/мусор).
      Хелпер: lib/shared/downloadToken.ts. Агентский путь (get_task_context) не тронут.
- [x] FILE-12 Комментарии → `useInfiniteQuery` (пагинация фида в шторке) #ui !med
      Гарантийный второй потребитель React Query (против «зомби-зависимости №2»).
- [x] FILE-13 Board view/edit — единая страница по паттерну TaskViewEdit #ui !med
      Объединены /board/[slug] и /board/[slug]/edit: локальный режим view/edit,
      мгновенное переключение без повторной загрузки; /edit — алиас → ?edit=1.
      BoardDetail.tsx/EditDeskForm.tsx → BoardViewEdit.tsx; не-овнер — read-only.
- [ ] FILE-11 Realtime-инвалидация `task_attachments` (Phase 2) #ui #db !low
      Живое обновление открытой шторки (агент приложил файл → появился у клиента).
      Требует security-review: publication/RLS канала, scoping по workspace.

## Stage · Performance (TWA boot) — PERF-01…PERF-14

> Источник: аудит boot-цепочки TWA (Vercel `iad1` vs Supabase `eu-west-1`, 5×
> `POST /api/init`, блокирующий `@import` Google Fonts, `beforeInteractive` SDK,
> искусственная задержка лоадера). Пакет P0 (PERF-01…PERF-08) выполнен 2026-09-18;
> P1 (PERF-09…PERF-14) — после снятия замеров «до/после».

- [x] PERF-01 Self-hosted Inter вместо блокирующего Google Fonts `@import` #perf !high
      `@fontsource-variable/inter/opsz.css` в layout; `--font-family-base/display` →
      'Inter Variable' (ось opsz даёт Display-пропорции как в Figma); Geist Sans убран
      (не использовался, а его woff2 preload'ились на критическом пути); 5 литералов
      'Inter'/'Inter Display' → CSS-переменные. Устранён тихий фолбэк 'Inter Display' →
      system-ui (семейство ниоткуда не загружалось).
- [x] PERF-02 Регион функций `iad1` → `dub1` (eu-west-1 = регион Supabase) #perf !high
      `vercel.json` → `regions`. Снимает ~6 последовательных RTT буст-цепочки
      (`/api/init` 3 + `/api/workspaces/my-data` 3) и ~40–60 ms с каждого вызова API
      для RU-аудитории. Плата: +30–40 ms к Groq (US) — приемлемо.
- [x] PERF-03 Telegram SDK: `beforeInteractive` → `afterInteractive` + preconnect #perf !high
      Плюс явное ожидание готовности SDK (`waitForTelegramWebApp`) вместо синхронного
      чтения `window.Telegram` на mount → убран ложный экран `not_in_twa` при задержке CDN.
- [x] PERF-04 Singleton server-side Supabase-клиента (module scope) #perf !med
      `createServerClient()` создавал клиент на каждый вызов, т.е. на каждый запрос.
- [x] PERF-05 Dedupe `/api/init`: 5 параллельных POST → 1 общий промис #perf !high
      `fetchInitOnce()` на уровне модуля (5 инстансов хука: page, AuthLoader,
      AiTaskCreator, DataProvider, TelegramProvider); `refresh()` форсирует запрос.
- [x] PERF-06 Временный замер boot-фаз `?perf=1` / `startapp=perf` #perf !low
      `src/lib/perf/timings.ts` + `/api/debug/timings` (только console.info в логах Vercel).
      ⚠️ Удалить после снятия метрик «до/после».
- [x] PERF-07 Минимальная задержка лоадера 400ms → 120ms #perf !med
      Вместе с fade 300ms в GlobalLoader давало до 0.7s «мёртвой» паузы после прихода данных.
- [x] PERF-08 Гигиена бандла и мёртвого кода #perf !low
      `optimizePackageImports` (+ @tabler/icons-react, date-fns, @tanstack/react-query);
      удалён мёртвый `supabase.auth.getUser()` в /settings (тянул GoTrue в бандл и держал
      экран под OrbitLoader); убран дублирующий `<meta viewport>`; удалён no-op
      `src/middleware.ts` (давал edge-инвокей на каждую навигацию).
- [ ] PERF-09 `get_boot_data` RPC: 3 последовательных RTT → 1 #perf !med
      Миграция 089: один `jsonb` (profile/workers/workspaces/tasks/sprints),
      `SECURITY DEFINER` + `REVOKE EXECUTE FROM PUBLIC` + `SET search_path=''` (как в 088).
      INV-16 не меняется: find-or-create остаётся только в `/api/init`.
- [ ] PERF-10 Подписанная HttpOnly-cookie `oni_sess` → fast-path без запроса `profiles` #perf !med
      Снимает 1 RTT с каждого вызова API; при отсутствии/истечении cookie — прежняя
      ветка проверки initData (нулевой риск для UX).
- [ ] PERF-11 Warm start: `localStorage` + TTL (SWR) вместо sessionStorage-only #perf !med
      Повторный запуск Mini App рисует борд мгновенно, лоадер — только на холодном старте.
      Ключ кэша — telegram user id (показываем лишь при наличии initData).
- [ ] PERF-12 Лоадер без `filter: blur(35px)` / `blur(25px)` #perf !low
      Дорогие композиты в WebView ровно в момент парсинга JS — заменить на статичный градиент.
- [ ] PERF-13 Cron `ops-publisher-tick` 10s → 30/60s #db !low
      129 235 вызовов × 4.28 ms = 553 s CPU за окно замера; на Free/Micro делит CPU с API.
- [ ] PERF-14 Включить Fluid compute в проекте Vercel (dashboard) #perf !med

---

## Stage 15 · Agent Connectors — внешние агенты по endpoint + key (2026-09-22)

> Кейс: добавить агента указанием endpoint + названия + API-ключа, чтобы Onitask сам
> прокинул задачу, проверил исполнение и забрал результат. Реализовано вариантом A —
> **Onitask-as-Runtime**: серверный цикл `ops_lease → контекст → вызов агента →
> ops_terminal → ops_ack` (ровно тот же контракт, что у внешнего MCP/CLI-рантайма,
> поэтому INV-04/INV-09 сохраняются). Топология: pg_net push (мгновенно) +
> cron-sweeper 30 с (полнота) + reaper `067` (инвариант). Первый коннектор — Drift
> (`https://drift.neuraldeep.ru/v1`, модель `drift`, sync-ответ ~8.6 с, базовый
> prompt ~13.5k токенов — учтено в дефолтах лимитов).

- [x] DS-01 `agent_connectors` + Vault-хелперы (set/get/delete секрета) + RLS service-only #db !high
      Миграция `089_agent_connectors.sql` (применена). Секрет живёт только в Vault
      (`secret_ref` + `secret_hint`), plaintext в таблице отсутствует (INV-19).
      Смоук: round-trip секрета, маска `dft_…7890`, удаление секрета вместе с коннектором.
- [x] DS-02 API `/api/agents` (GET/POST), `/api/agents/[id]` (PATCH/DELETE), `/api/agents/probe` #api !high
      SSRF-гейт: https-only, без credentials/query, блок приватных адресов (в т.ч. по
      всем адресам DNS-резолва) и редиректов. POST = probe (0 токенов) → INSERT →
      Vault → `ops_ensure_worker` (INV-04): «подключения без ключа» и «пустых воркеров» не бывает.
- [x] DS-03 UI: кнопка «Добавить агента» открывает `AgentConnectorSheet` (Name/URL/API Key) #ui !high
      Раньше кнопка вела на `/settings/mcp`; теперь это форма коннектора. После создания
      агент появляется в секции «Агенты» и выбирается исполнителем (проверено: `WorkerSelectSheet`
      рендерит AI-бейдж, назначение кладёт pending в `dispatch_outbox`).
- [x] DS-04 `agent_runs` + push-триггер `trg_agent_dispatch_push` + cron `agent-runtime-sweep` (30 с) #db !high
      Миграция `091_agent_runtime.sql`. Push срабатывает только для агентов с активным
      коннектором — pull-рантаймы (MCP/CLI) работают как раньше. Осиротевшие прогоны
      закрываются `handleDueRun` (fail-loud: nack → requeue/escalate).
- [x] DS-05 Edge Function `agent-runtime` (lease → контекст → вызов → terminal → ack) #ai !high
      `index.ts` + `provider.ts` (однофайловая конвенция проекта + `@ts-nocheck`).
      Провайдер: OpenAI-совместимый вызов, строгий JSON-контракт результата, обёртка
      untrusted-данных тегами с UUID, маппинг ошибок (401 → escalate, остальное → requeue).
- [x] DS-06 Выделенный секрет рантайма `get_agent_runtime_secret` (миграция `092_agent_runtime_secret.sql`) #db !high
      Найдено smoke-тестом: vault `service_role_key` ≠ env функции → 401 и на push, и на cron.
      Теперь push/cron подписываются своим 256-битным секретом, у функции `verify_jwt=false`
      (своя timing-safe авторизация; вызовы делает только БД). Проверено: valid → 200,
      мусорный токен → 401, cron → 200.
- [ ] DS-07 E2E реального прогона: реальный ключ Drift → задача уходит агенту → `review` + Telegram-апрув #test !high
      Инфраструктурное плечо проверено (push/sweep → 200, пустые выборки → `processed: 0`).
      Осталось: боевой прогон на реальном ключе (расход ~13.5k prompt-токенов) и проверка
      возврата `ra:fix` → повторный прогон агентом.
- [ ] DS-08 Статусы и стоимость в UI: бейдж «Hosted», `usage` из `agent_runs`, лимиты, stop-cran (UC-10) #ui !med
- [ ] DS-09 MCP-инъекция: read-only ключ коннектора + `mcp_servers` в запросе (INV-18) #ai !med
      Поле `mcp_allowlist` уже хранится и валидируется; осталось чеканить ключ и
      подставлять его в запрос к агенту.
      Даёт bytecode-оптимизацию и pre-warming на прод-деплоях → меньше cold start без Edge.
      На Hobby память фиксирована (2 GB / 1 vCPU) и не конфигурируется.

- [x] DS-10 Хардненинг hosted-рантайма: конверты провайдера + диагностика корня провала #ai !high
      Кейс: Drift отвечал своим конвертом (`{task_id, status, result}`) → `bad_response` +
      `response_digest=null` → 3 попытки → эскалация `max_attempts` без деталей.
      `provider.ts`: слой совместимости конвертов (`status/state/result_status` → outcome,
      вложенный `result/output/data` → summary, флаг `coerced`) + `rawPreview`/`observedKeys`
      в `ProviderFailure`. `index.ts`: `nack_detail` = класс + превью ответа,
      `response_digest` на провале ({error_code, status, raw_preview, observed_keys}),
      файлы агента → Storage `task-attachments` + `task_attachments` (`source='hosted_runtime'`,
      правила в `attachments.ts` — паритет `lib/shared/attachments.ts`).
      `bot-notify`: карточка эскалации печатает «Последняя попытка»/«Детали»
      (`nack_reason`/`nack_detail` из payload триггера).
      БД: `098`–`104` (ops_nack/trigger/reaper + CHECK `task_comments.source`,
      `task_attachments.source`, фильтрация stale `nack_*`, `summary/details` и агентские
      комментарии `source='agent'`).
      Валидация: type-check 0, lint 0 errors/20 existing warnings, vitest 215 passed / 21 files.
      `supabase/config.toml` фиксирует `verify_jwt=false` для `agent-runtime`
      и `bot-notify`; production-деплой выполняется через `--use-api
      --no-verify-jwt` (собственная авторизация функций).
      Контракт результата: `summary` → карточка, `details` → `task_comments`,
      `attachments[]` → Storage; XLSX/DOCX проходят существующий FILE-01 пайплайн.
      Задеплоено: agent-runtime v5 / bot-notify v44 (ACTIVE, `--use-api`, `verify_jwt` off,
      bot-notify обновлён после финальной формулировки подсказки). Осталось: боевой прогон DS-07
      (реальный ключ Drift).


---


---

*onitask · Декомпозиция по задачам · компакт-версия · 12 июля 2026 · обновлено 4 августа 2026 (аудит Stage 1-4 + Stage 5+)*
