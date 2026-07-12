# onitask · Architecture Compact Reference

**Источник:** сжатая выжимка из `onitask_Architecture_Master_.md` v0.13.4 + связанных операционных приложений.
**Собрано:** 12 июля 2026.

**Статус:** вспомогательный документ для быстрой загрузки в контекст Cline (экономия токенов при Шаге 1 Dev Flow). Он **не заменяет** Master Spec. При любом расхождении Master побеждает безусловно — см. `.clinerules/00-system-flow.md [v7.3]`, «Разрешение конфликта Master ↔ Memory Bank». Этот файл сам может устареть при обновлении Master — сверяй номер версии перед использованием.

**Версии связанных документов на момент сборки:**
Master 0.13.4 · ai 0.10.1 · flow 3.6.0 · mcp_contract 0.7.1 · security 0.1.1 · bot 0.6.0 · sql_anomalies 1.6 · dev_setup 0.2.2

---

## 1. Инварианты (INV-01…INV-16)

Все 16 живут в Master Spec **§1** единым блоком — подразделов §11…§16 в Master не существует, не ссылаться на них.

| ID | Суть | Где реализован | Домен |
|---|---|---|---|
| INV-01 | `tasks.assigned_to → workers(id)` | §6.1 | `#db` |
| INV-02 | `tasks.reviewer_id → workers(id)` | §6.1 | `#db` |
| INV-03 | `task_column_history.moved_by → workers(id)`, NULL допустим (известный race condition) | §6.3 | `#db` |
| INV-04 | `agent_events` → триггер `auto_create_agent_worker()` | §4 | `#db` |
| INV-05 | Все AI-outputs содержат `workspace_id` (tenant isolation, A-7) | code convention; все RAG RPC требуют `p_workspace_id` | `#ai` `#mcp` |
| INV-06 | Секреты сравниваются `timingSafeEqual` (A-2) | `lib/telegramAuth.ts`, `lib/mcpAuth.ts` | `#auth` `#mcp` |
| INV-07 | AI-квота — atomic RPC (`INSERT...ON CONFLICT DO UPDATE`), не SELECT+UPDATE (A-3) | `check_and_decrement_quota` | `#mcp` |
| INV-08 | `workspace_settings` — единственный источник настроек F-01/F-03/F-04/Flow Board | §6.4, §8 | все |
| INV-09 | `version` на `tasks` — атомарный UPDATE...WHERE version=$expected | §7.1. **Важно:** в TWA (`PATCH /api/tasks/[id]`) version-check **не выполняется** — last-write-wins (dev_setup §7.3). Обязателен только в MCP `move_task`. | `#mcp` |
| INV-10 | `workspace_telegram_chats.linked_by → profiles(id)` — единственное исключение из workers-модели | §6.9 | `#db` |
| INV-11 | `workspaces.task_prefix` иммутабелен — `trg_prevent_task_prefix_update` | §6.12 | `#db` |
| INV-12 | `assignment_history.snapshot_attention_risk` — только через `trg_record_assignment_snapshot` | §6.14 | `#db` |
| INV-13 | `task_relations.workspace_id` — явно при каждом INSERT, авторезолюция запрещена | §6.16 | `#db` `#mcp` |
| INV-14 | `workspace_context` (Admin-only, ручной) ≠ `workspace_context_cache` (system-only, derived) — никогда не пересекаются | §6.4 comment, A-12 | `#ai` |
| INV-15 | `data_sharing_level='full'` — только Admin/Owner, RLS-enforced | §6.4 CHECK + RLS | `#db` |
| INV-16 | `/api/init` — find-or-create только, без автообновления `display_name`/`avatar_url` | §6.17, dev_setup §7.1 | `#auth` |

### Stage-gating верификации (из Dev Flow v7.3, таблица привязки инвариантов)

| INV | Karpathy (Шаг 5) | Антагонист (Шаг 6) | Реально проверяемо с этапа |
|---|---|---|---|
| INV-04 | ✅ обязателен | — | Stage 1 (`agent_events` уже существует) |
| INV-07 | ✅ обязателен | ✅ + вторая модель | Stage 7 (MCP quota RPC реально вызывается) |
| INV-09 | ✅ обязателен | ✅ + вторая модель | Stage 7 (`move_task` с `version`) |
| INV-11 | ✅ (параллельные UPDATE) | ✅ | Stage 1 |
| INV-12 | — | ✅ обязателен | Схема — Stage 1. Реальные данные — Stage 8/9 (pre-flight scoring) |
| INV-13 | — | ✅ обязателен | Схема — Stage 1. Реальные данные — Stage 7 (MCP `blocked_by`) |

Остальные (01, 02, 03, 05, 06, 08, 10, 14, 15, 16) — FK/RLS/структурные, покрываются unit/integration тестами (`npm test`, Шаг 4), не Karpathy Loop и не Антагонистом.

> **Практический вывод:** ДДЛ для INV-07/09/12/13 создаётся на Stage 1, но прогонять по ним Karpathy Loop / Антагониста на Stage 1 бессмысленно — таблицы пустые, конкурентной нагрузки ещё нет. Повторная проверка нужна, когда эти инварианты реально нагружаются (Stage 7 для 07/09, Stage 7-9 для 12/13).

---

## 2. Три скорости

| Контур | Латентность | Стек | Задача / клиент |
|---|---|---|---|
| 🟡 Instant | < 300 мс | Groq (llama-3.3-70b + whisper-large-v3-turbo) в Vercel API Route | F-04, TWA-действия, Bot-команды |
| 🔵 Async | 3–10 с, фон | Supabase Edge Functions + NeuralDeep GPT-OSS-120B + pgvector RAG | F-03, Workspace Context Rebuild, LTM Consolidation |
| 🟣 Agent | anytime | MCP Server / REST, Memento diff, Realtime buffering | Cursor, Claude Code, кастомные агенты |

---

## 3. Аксиомы (A-1…A-12)

Компакт — полные формулировки в Master §3.

- **A-1** Vercel = только Hot Path (< 2 с). Всё RAG/LLM — только в Supabase Edge Functions.
- **A-2** `timingSafeEqual` для секретов и HMAC-подписей. `===` допустим только для non-secret строк.
- **A-3** Atomic Quota через `INSERT ... ON CONFLICT DO UPDATE`.
- **A-4** pgvector: `tasks` IVFFlat `lists=100`, `agent_memory` `lists=50`, `workspace_doc_chunks` `lists=10`. Переход на HNSW — при > 5000 записей в таблице.
- **A-5** Двухконтурный учёт: `story_points` (макро, спринты) + `cognitive_weight` (микро, Cognitive Budget) — независимы, оба считаются в F-03 даже если один отключён. `tasks.cognitive_weight` — единственный источник истины для F-01.
- **A-6** Один вызов модели, без fallback-цепочки. При ошибке LLM — `enrichment_status='failed'`, тихий toast, UX не блокируется.
- **A-7** Tenant Isolation — все AI-outputs привязаны к `workspace_id`, проверка централизованным Middleware.
- **A-8** Flow Board доступен всем Members. AI-функции и запись `workspace_settings` — только Admin/Owner.
- **A-9** Cognitive Budget = SUM(`cognitive_weight`) по (`in_progress`, assigned_to=worker) + (`review`, reviewer_id=worker). Шкала 0–3.
- **A-10** Layered Metrics Cache: Column Health 5 с, Worker Load 60 с, AI Alerts 60 с.
- **A-11** Assignment Risk Score (0–100) — VIEW `attention_risk_pulse` (sql_anomalies §3.9). Поле `attention_risk_score` — внутри неё, это не отдельная сущность. 4 фактора: active_tasks×15, context_switches×10, blocked_tasks×12, review_tasks×5, critical_deadline×15. **Отличие от A-9:** A-9 = состояние worker'а сейчас (0–3), A-11 = риск конкретного назначения (0–100).
- **A-12** Relational Context Layer — `task_relations`, три типа рёбер с иммутабельной шкалой весов (`blocks`=1.0, `spawned_from`=0.8, `mentions`=0.3), `get_task_subgraph` RPC (двухуровневый JOIN, без recursive CTE), fallback на `match_tasks()` при пустом графе (поведение не деградирует).

---

## 4. Модель Worker

Единая для человека и агента — все ссылки на исполнителя идут на `workers(id)`.

```
tasks.assigned_to, tasks.reviewer_id, tasks.handoff_to,
task_column_history.moved_by  →  workers(id)
```

```sql
workers (
  id, workspace_id,
  type          CHECK IN ('human','agent'),
  role          CHECK IN ('owner','admin','member','viewer')  -- NULL для agent
  display_name, source_id,   -- profiles.id для human / 'agent::<name>' для agent
  is_active, created_at
)
```

**Единственное исключение:** `workspace_telegram_chats.linked_by → profiles(id)` напрямую (INV-10) — семантически «администратор, подключивший чат», всегда человек.

---

## 5. Полная схема БД (высокоуровнево)

**Идентичность / tenancy:** `workspaces`, `workspace_settings` (jsonb-конфиги — `workspace_context` и `workspace_context_cache` это **поля** этой таблицы, не отдельные сущности), `workspace_task_counters`, `profiles`, `workers`, `invite_links`

**Задачи:** `tasks`, `tracker.columns`, `sprints`, `task_column_history`, `task_relations` (+ RPC `get_task_subgraph`)

**AI-пайплайн:** `enrichment_queue`, `task_enrichments`, `agent_events`, `agent_memory` (+ RPC `match_agent_memory`), `task_events`, `consolidation_errors`

**Knowledge Base:** `workspace_documents`, `workspace_doc_chunks` (+ RPC `match_doc_chunks`)

**Риск / назначения:** `assignment_history` (таблица) + VIEW `attention_risk_pulse` (sql_anomalies §3.9 — это VIEW, не таблица)

**Telegram:** `workspace_telegram_chats`

**Аномалии — всё VIEW, не таблицы** (sql_anomalies §3): `stuck_tasks`, `overloaded_workers`, `bottleneck_columns`, `duplicate_tasks`, `stale_blocked`, `velocity_drop`, `pending_escalations`, `review_backlog`, `orphan_blockers`, `handoff_chain`

---

## 6. API-контракт (ключевые маршруты, dev_setup §2.2)

| Route | Method | Назначение |
|---|---|---|
| `/api/init` | POST | find-or-create (INV-16) |
| `/api/tasks` | GET, POST | список без пагинации / создание |
| `/api/tasks/[id]` | GET, PATCH, DELETE | CRUD, PATCH без version-check в TWA |
| `/api/tasks/[id]/decompose` | POST | AI-декомпозиция |
| `/api/tasks/[id]/relations` | **POST** | создание `task_relations` (не GET) |
| `/api/flow/metrics` | GET | делегирует в Edge Function `flow-metrics` |
| `/api/ai/transcribe`, `/api/ai/parse-task`, `/api/ai/quota` | POST / POST / GET | F-04 |
| `/api/mcp/*` (9 tools + `undo/:event_id`) | **POST only** | агентский интерфейс, GET нет вообще |
| `/api/workspaces`, `/summary`, `/[id]/{members,invite,settings}` | GET/POST | Workspace Manager |
| `/api/invite/[slug]/accept` | POST | |
| `/api/bot/webhook`, `/task`, `/task/[fullId]`, `/task/[fullId]/resolve`, `/flow/[workspaceId]`, `/standup/[workspaceId]`, `/notify` (внутр.) | POST/POST/GET/POST/GET/GET/POST | Bot-слой |

---

## 7. workspace_settings — ключевые поля

`enable_cognitive_budget` · `story_points_config` · `velocity_window_days` · `flow_config` (`stuck_threshold_hours`, `overload_threshold`, `wip_alert_multiplier`) · `realtime_subscription_level` · `workspace_context` (Admin, ≤800 симв) · `workspace_context_cache` (system, ≤500 симв) · `context_stale` · `standup_config` · `doc_kb_config` · `f04_config` · `quota_config` · `data_sharing_level` (`minimal`/`standard`/`full`) · `mcp_api_keys` (allowed_tools per key, `{}` = legacy all)

---

## 8. Security Layer (OWASP LLM Top 10 2025)

- **Prompt Injection (LLM-1):** JSON mode обязателен в F-03/F-04 + UUID-теги `wrapData()` per-request + LTM Injection Linter (5 regex-паттернов перед INSERT в `agent_memory`).
- **Sensitive Info Disclosure (LLM-2):** `data_sharing_level` — 3 уровня; `full` требует DPA (doc RAG без порога similarity).
- **Excessive Agency (LLM-6):** `mcp_api_keys.allowed_tools`, rate limit 50 tasks/min/agent, DFS cycle check перед `blocked_by`-INSERT.
- **Improper Output Handling (LLM-5):** `sanitizeOutput()` (whitelist `<b><i><u><s><code><pre>`, `<a href>` запрещён) для Telegram; `escapeHtml()` для шаблонов бота.
- **Plugin Design (LLM-9):** DFS Cycle Detection в `create_task` (`blocked_by`) → `409 circular_dependency`.

---

*Компакт-версия для контекста Cline. Полный источник истины — `onitask_Architecture_Master_.md` v0.13.4. При конфликте — Master побеждает безусловно.*
