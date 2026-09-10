# onitask · MCP Contract (MVP для агентов)

**Версия:** 0.8.0  
**Дата:** август 2026  
**Статус:** Production-Ready · Implementation Target

> **Тип документа:** Операционное приложение к Master Spec. Канонический контракт для AI-агентов — REST и нативный MCP.  
> **Главные ссылки:**  
> [Architecture Master](onitask_Architecture_Master_.md) ≥ v0.13.5 · [AI Contract](onitask_ai_.md) · [Security](onitask_security_.md) ≥ v0.2.0  
> **Схема task_relations** — Master Spec §6.16 (A-12).  
> **Схема mcp_agent_keys** — Master Spec §6.19.

**Supersedes:** `onitask · MCP Contract v0.7.1` (июнь 2026)

> **Δ 2026-09-10 (FILE-01..08):**
> - `send_message_to_chat` — добавлены `attachments[]` (`{filename, content_base64, caption?}`,
>   ≤5 файлов, ≤2MB base64 на файл, ≤3MB суммарно, MIME-whitelist + magic-bytes)
>   и `task_id` (inline-кнопка «Обсудить задачу» → deep-link `task_<full_id>_comments`).
> - `ops_terminal` — добавлены `attachments[]` (файлы → Storage `task-attachments` + манифест
>   в metadata; идемпотентность retry по `execution_id`). bot-notify отправляет файлы после карточки (review+done).
> - `get_task_context` — добавлен `include_attachments` (default false): возвращает манифест + signed URL (TTL 1ч).
> - **Новый** read-only tool `get_task_comments` (фид «Комментарии» для duty poll, keyset-пагинация, обёртка над RPC `get_task_feed`).

---

## 0. Scope MVP (что в Scope / что нет)

### In scope (реализовать сейчас)

| # | Решение |
|---|---------|
| 1 | Нативный MCP 2026-07-28 (`POST /mcp`) + REST (`POST /api/agent/*`) |
| 2 | Один domain-слой (`lib/domain/agent/*`) под обоими транспортами |
| 3 | Auth: `mcp_agent_keys` — `workspace_id` резолвится из ключа |
| 4 | `agent_name` обязателен явно в каждом вызове |
| 5 | `move_task.version` обязателен |
| 6 | DFS cycle check **до** INSERT задачи |
| 7 | Rate limit create_task через Postgres (без Redis) |
| 8 | UI подключения агента: 2 шага, `allowed_tools: 'all'` |

### Out of scope (не делать в этом MVP)

| # | Решение | Причина |
|---|---------|---------|
| 1 | A2A / Agent Card | Отложено |
| 2 | `agent_registry` | Отложено |
| 3 | Redis rate limit | Postgres count достаточен |
| 4 | Обогащённый `handoff_task` (source_agent, context, expected_output…) | Нет DDL; проблему закрывает `handoff_chain` + alert |
| 5 | `delegation_loop` error type | Закрыто sql_anomalies / trigger |
| 6 | Alias `/api/mcp/*` | Pre-launch, внешних клиентов нет |
| 7 | Гранулярные профили `allowed_tools` в UI | Phase 1.1; поле DDL уже есть |

---

## 1. Цель

Дать AI-агентам полноценный интерфейс для автономной работы: читать, создавать, перемещать задачи, эскалировать проблемы и взаимодействовать с командой через Telegram.

---

## 2. Транспорт

**Два равноправных входа, один domain-слой** (`lib/domain/agent/*`).

### 2.1 Нативный MCP (основной для Cursor / Claude Code / Codex)

```
POST /mcp
```

MCP **2026-07-28**, Streamable HTTP, **stateless**. Тело — JSON-RPC 2.0.

| Header | Required | Values |
|--------|----------|--------|
| `Authorization` | yes | `Bearer <api_key>` |
| `MCP-Protocol-Version` | yes | `2026-07-28` |
| `Mcp-Method` | yes | `server/discover` \| `tools/list` \| `tools/call` |
| `Mcp-Name` | no | tool name (routing hint for `tools/call`) |

Методы:

| Method | Поведение |
|--------|-----------|
| `server/discover` | protocolVersions, capabilities, serverInfo |
| `tools/list` | каталог 9 tools + `ttlMs` / `cacheScope` |
| `tools/call` | `{ name, arguments }` → domain service |

### 2.2 REST-эквивалент

```
POST /api/agent/create_task
POST /api/agent/move_task
POST /api/agent/escalate_task
POST /api/agent/get_tasks_by_column
POST /api/agent/get_workspace_settings
POST /api/agent/send_message_to_chat
POST /api/agent/get_task_context
POST /api/agent/handoff_task
POST /api/agent/undo/:event_id
```

Тело — **плоский JSON**, без `jsonrpc`/`method` обёртки.  
Тот же domain-сервис → **идентичный результат в БД** при идентичном входе.

> **v0.8.0:** маршруты переехали с `/api/mcp/*` на `/api/agent/*`. Alias и deprecation **не вводятся** (pre-launch, 0 external clients).

### 2.3 Аутентификация и резолюция workspace

```
Authorization: Bearer <api_key>
```

```text
key_hash = sha256(api_key)
  → SELECT FROM mcp_agent_keys
      WHERE key_hash = $1 AND revoked_at IS NULL
  → workspace_id, allowed_tools, can_send_messages, max_tasks_per_minute
```

Сравнение — `timingSafeEqual` (A-2).

**v0.8.0:** `workspace_id` резолвится **из ключа**. Клиент **не обязан** передавать `workspace_id`.  
Если передал — сервер сверяет с резолвленным; несовпадение → `403 forbidden`.

### 2.4 Security Layer (4 проверки)

Каждый запрос до выполнения tool:

1. **timingSafeEqual** — ключ → строка `mcp_agent_keys` (A-2)  
2. **Tenant Isolation** — явный `workspace_id` (если есть) == резолвленный (A-7)  
3. **Agent Identity** — `agent_name` **обязателен** в каждом вызове; отсутствие → `400 invalid_params`  
   (сервер **не** подставляет дефолт — иначе разные агенты на одном ключе схлопнутся в одного worker)  
4. **Allowed Tools** — tool ∈ `mcp_agent_keys.allowed_tools` (default `'all'`)

```typescript
// lib/shared/mcpAuth.ts
async function resolveAgentKey(rawKey: string) {
  const keyHash = sha256(rawKey);

  const { data: key } = await supabase
    .from('mcp_agent_keys')
    .select('workspace_id, allowed_tools, can_send_messages, max_tasks_per_minute')
    .eq('key_hash', keyHash)
    .is('revoked_at', null)
    .single();

  if (!key) throw unauthorized(); // 401

  // fire-and-forget
  void supabase
    .from('mcp_agent_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('key_hash', keyHash);

  return key;
}

function isToolAllowed(
  toolName: string,
  allowedTools: 'all' | string[]
): boolean {
  if (allowedTools === 'all') return true;
  return allowedTools.includes(toolName);
}
// запрет → 403 tool_not_permitted
```

**Нет legacy-режима:** неизвестный ключ → `401`, не «все tools разрешены».

---

## 3. Доступные инструменты

| Tool | Описание | Квота | agent_events |
|------|----------|-------|--------------|
| `get_tasks_by_column` | Задачи по колонке | Нет | ✅ |
| `get_workspace_settings` | Настройки workspace | Нет | ❌ pure read |
| `get_task_context` | Полный контекст задачи | Нет | ❌ pure read |
| `create_task` | Создать задачу | Да | ✅ |
| `move_task` | Переместить задачу | Да | ✅ |
| `escalate_task` | Эскалировать человеку | Да | ✅ |
| `handoff_task` | Передать другому агенту | Да | ✅ |
| `send_message_to_chat` | Сообщение в Telegram | Да (лёгкая) | ✅ |
| `undo` | Отменить своё действие | Нет | ✅ |

Набор, права и лимиты **одинаковы** для MCP и REST — отличается только envelope.

`send_message_to_chat` при `quota_exceeded` на мутациях задач **остаётся доступным** (отдельный лёгкий лимит).

---

## 4. Сигнатуры и ответы

> Во всех запросах `workspace_id?: string` — **опционален** (резолвится из ключа).  
> `agent_name: string` — **обязателен** везде.

### 4.1 `get_tasks_by_column`

**Запрос:**

```typescript
{
  workspace_id?:           string;
  agent_name:              string;
  column:                  "backlog" | "in_progress" | "review" | "done";
  limit?:                  number;   // default 20, max 50
  assigned_to_me?:         boolean;
  sort_by_blocking_value?: boolean;  // только column='backlog'
}
```

**Ответ:**

```typescript
{
  success: true;
  tasks: TaskPreview[];
  // TaskPreview: id, title, column, assigned_to, reviewer_id,
  //              version, is_inbox, is_blocked, full_id, task_number
  // + blocking_value?: number  при sort_by_blocking_value=true
}
```

**Smart Backlog:** `blocking_value` = число downstream задач, которые разблокирует completion (depth-1 `blocks`).

---

### 4.2 `get_workspace_settings`

**Запрос:** `{ workspace_id?, agent_name }`

**Ответ:**

```typescript
{
  success: true;
  settings: {
    enable_cognitive_budget:     boolean;
    story_points_config:         object;
    velocity_window_days:        number;
    flow_config:                 object;
    realtime_subscription_level: "own_tasks" | "all";
    workspace_context:           string | null;
    workspace_context_cache:     string | null;
    context_stale:               boolean;
    doc_kb_config:               object | null;
    agent_active_tasks:          TaskPreview[] | null;
    // in_progress/review, needs_human=false
  }
}
```

---

### 4.3 `create_task`

**Запрос:**

```typescript
{
  workspace_id?: string;
  agent_name:    string;
  title:         string;
  description?:  string;
  column?:       "backlog" | "in_progress" | "review";
  assignee?:     string;
  tags?:         string[];
  deadline?:     string;       // ISO 8601
  priority?:     "low" | "medium" | "high" | "critical";
  complexity?:   1 | 2 | 3;
  blocked_by?:   string;       // UUID блокера
}
```

**Правила:**

| Условие | Эффект |
|---------|--------|
| нет `column` | `column=backlog`, `is_inbox=true` |
| есть `column` | `is_inbox=false` |
| есть `blocked_by` | edge `blocks`, `is_blocked=true` на новой задаче |

**Rate limit:** max **50/min** per agent × workspace (rolling 60s).  
Источник: `mcp_agent_keys.max_tasks_per_minute` (default 50).  
Превышение → `429 task_creation_rate_limit`.

**DFS cycle check:** **до** INSERT задачи и ребра.  
Цикл → `409 circular_dependency`, ничего не создаётся (не create-then-rollback).

**Серверное заполнение (F-04):**

```text
raw_input            = title + '\n' + description
clarity_score        = null
complexity           = params.complexity ?? inferComplexity(description)
enrichment_strategy  = 'standard'
cognitive_weight     = 1   // обновится F-03
```

**Ответ:**

```typescript
{
  success: true;
  task: {
    task_id:          string;
    task_number:      number;
    full_id:          string;     // e.g. ALPHA-48
    title:            string;
    column:           string;
    created_at:       string;
    version:          number;
    relation_created: boolean;
  }
}
```

---

### 4.4 `move_task`

**Запрос:**

```typescript
{
  workspace_id?: string;
  agent_name:    string;
  task_id:       string;
  target_column: "backlog" | "in_progress" | "review" | "done";
  version:       number;    // ОБЯЗАТЕЛЕН (v0.8.0 breaking)
  reason?:       string;
  claim?:        boolean;   // atomic assigned_to = agent
}
```

> **Breaking v0.8.0:** `version` обязателен. Нет поля → `400 invalid_params`.

**Эффекты:**

- атомарно: `column`, `is_inbox=false`, bump `version`
- `claim=true` + уже чужой assignee → `409 already_claimed`
- `target_column=done` → `trg_cascade_unblock` → `unblocked_ids[]`

**Ответ:**

```typescript
{
  success:       true;
  task_id:       string;
  new_column:    string;
  claimed:       boolean;
  version:       number;
  moved_at:      string;
  unblocked_ids: string[];
}
```

---

### 4.5 `escalate_task`

**Запрос:**

```typescript
{
  workspace_id?:     string;
  agent_name:        string;
  task_id:           string;
  reason:            "insufficient_context"
                   | "conflicting_requirements"
                   | "blocked_by"
                   | "out_of_scope";
  suggested_action?: string;
}
```

**Ответ:** `{ success: true, task_id }`  
Ставит `needs_human=true`. Агент MUST прекратить мутации задачи до разрешения.

---

### 4.6 `send_message_to_chat`

**Запрос:**

```typescript
{
  workspace_id?: string;
  agent_name:    string;
  chat_id:       number;
  text:          string;   // max 4096
  parse_mode?:   "HTML" | "MarkdownV2";
}
```

**Безопасность:**

- `chat_id` ∉ workspace → 403  
- `can_send_messages=false` → 403 `tool_not_permitted`  
- `sanitizeOutput(text, 'tg')`: whitelist `<b><i><u><s><code><pre>`; без `<a href>` и атрибутов  

**Ответ:** `{ success: true, message_id: number }`

---

### 4.7 `get_task_context`

**Запрос:** `{ workspace_id?, agent_name, task_id }`

**Ответ:**

```typescript
{
  success: true;
  task: {
    id, full_id, task_number, title, description,
    column, priority, assigned_to, reviewer_id,
    is_blocked, is_inbox, needs_human, escalation_reason,
    deadline, version, metadata, moved_to_column_at
  };
  column_history: Array<{
    from_column, to_column, moved_by, moved_at, metadata
  }>;
  agent_events: Array<{
    tool, agent_name, summary, metadata, created_at
  }>;  // last 20, DESC
  memory_summary:    string | null;
  workspace_context: string | null;
  relevant_docs: Array<{
    filename, section, content, similarity
  }> | null;
  subgraph: Array<{
    from_task_id, to_task_id,
    relation_type: "blocks" | "spawned_from" | "mentions",
    weight: number,   // 1.0 | 0.8 | 0.3
    depth: 1 | 2
  }> | null;
}
```

**Интерпретация subgraph:**

```text
from_task_id === task.id  →  эта задача блокирует to_task_id
to_task_id   === task.id  →  from_task_id блокирует эту задачу
```

Перед работой:

- orphan block (блокер в `done`, но `is_blocked`) → `escalate_task(reason='blocked_by')`
- при `move → done` downstream разблокируются автоматически

---

### 4.8 `handoff_task`

**Запрос:**

```typescript
{
  workspace_id?:   string;
  agent_name:      string;
  task_id:         string;
  target_agent:    string;
  handoff_notes:   string;   // required, max 1000
  move_to_column?: string;
}
```

> Обогащённые поля из внешнего Agentic Contract (**source_agent, context, expected_output…**) — **не приняты**.  
> Целевая проблема (круговые handoff) закрыта `handoff_chain` + `trg_handoff_chain_alert`.

**Ответ:**

```typescript
{
  success:       true;
  task_id:       string;
  handed_off_to: string;
  new_column:    string | null;
  version:       number;
}
```

**Семантика:**

| Operation | Meaning |
|-----------|---------|
| `handoff_task` | Плановая передача эстафеты |
| `escalate_task` | Агент застрял → human |

При `move_task → in_progress` target'ом — `handoff_to` / `handoff_notes` сбрасываются.

---

### 4.9 `undo`

**REST:** `POST /api/agent/undo/:event_id`  
**MCP:** `tools/call` name=`undo`, arguments включают `event_id`

**Запрос body:** `{ workspace_id?, agent_name }`

**Ответ:** `{ success: true, restored: boolean }`

**Ограничения:** окно **5 минут**; только события текущего `agent_name`.  
Post-MVP: compare-and-swap по version.

---

## 5. Архитектурные гарантии

| Гарантия | Статус |
|----------|--------|
| Hot Path &lt; 2s (A-1) | ✅ |
| Optimistic locking + version (INV-09) | ✅ `move_task.version` required |
| Memento (`state_before` в agent_events) | ✅ |
| Auto-create agent worker (INV-04) | ✅ |
| Realtime после commit | ✅ |
| Atomic quota (A-3) | ✅ |
| Relational Context (A-12): blocked_by, cascade | ✅ |
| Allowed tools из `mcp_agent_keys` | ✅ |
| Rate limit create_task | ✅ Postgres count |
| DFS cycle **до** INSERT | ✅ |
| HTML sanitization Telegram | ✅ |
| Tenant isolation из ключа | ✅ |

---

## 6. Ошибки

| HTTP | `error.type` | Когда | Действие агента |
|------|--------------|-------|-----------------|
| 400 | `invalid_params` | Нет `agent_name` / `version` (move) / др. обязательных | Fix, no retry |
| 401 | `unauthorized` | Нет/неверный/отозванный ключ | Stop |
| 403 | `forbidden` | `workspace_id` ≠ key scope; чужой `chat_id` | Stop |
| 403 | `tool_not_permitted` | Tool ∉ allowed_tools | Stop; просить Admin |
| 404 | `task_not_found` | Нет task | Refresh list |
| 404 | `worker_not_found` | target_agent неизвестен | Refresh |
| 404 | `blocker_not_found` | `blocked_by` не найден | Убрать / исправить UUID |
| 409 | `version_conflict` | Параллельное изменение | Refetch + retry |
| 409 | `already_claimed` | claim, уже чужой | Другая задача |
| 409 | `circular_dependency` | cycle в blocks | Replan |
| 422 | `quota_exceeded` | AI quota | §7.4 fallback |
| 429 | `rate_limited` | Инфра (Supabase/TG) | Backoff + Retry-After |
| 429 | `task_creation_rate_limit` | >50 create/min | Wait 60s |
| 500 | `internal_error` | Сервер | 1 retry / 2s, stop |

**Envelope:**

```json
{
  "error": {
    "code": 409,
    "type": "circular_dependency",
    "message": "blocked_by creates a dependency cycle. Task cannot block itself transitively."
  }
}
```

MCP: тот же `error` объект в JSON-RPC `error.data`; application codes маппятся в диапазон -32000…-32099 по необходимости.

---

## 7. Рекомендации для агентов

### 7.1 Старт сессии

```text
get_workspace_settings
  → agent_active_tasks не пуст?
       да  → get_task_context(each)
       нет → get_tasks_by_column(backlog, sort_by_blocking_value=true)
  → выбрать unblocked → move_task(in_progress, claim=true, version)
  → get_task_context → work
```

### 7.2 Version

Перед мутацией — актуальный `version` из list/context/предыдущего ответа.  
Для `move_task` это **требование сервера**, не совет.

### 7.3 Retry при version_conflict

```typescript
const BACKOFF_MS = [0, 1000, 3000];

async function moveWithRetry(params: MoveParams, maxAttempts = 3) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await sleep(BACKOFF_MS[attempt]);
    const { tasks } = await get_tasks_by_column({ column: /* current */ });
    const current = tasks.find((t) => t.id === params.task_id);
    if (!current) return;
    const result = await move_task({ ...params, version: current.version });
    if (result.success) return result;
    if (result.error?.type !== "version_conflict") throw result.error;
  }
  await escalate_task({
    agent_name: params.agent_name,
    task_id: params.task_id,
    reason: "conflicting_requirements",
    suggested_action: "Не удалось переместить задачу после 3 попыток",
  });
}
```

### 7.4 quota_exceeded

1. `send_message_to_chat` (отдельный лимит)  
2. иначе `move_task` своих in_progress → backlog (`reason: quota_exhausted`)  
3. stop  

### 7.5 Прочее

- `workspace_id` можно не слать (резолв из ключа).  
- В `move_task` передавать `reason`.  
- Плановая передача → `handoff_task`; застревание → `escalate_task`.  
- Resume → всегда `get_task_context` (history, events, subgraph, memory).  
- `full_id` в summary/notes.  
- `complexity` и `blocked_by` — явно, когда известны.  
- После escalate — poll `agent_active_tasks` до `needs_human=false`, затем context.  
- Smart Backlog: `sort_by_blocking_value=true`, первая unblocked.  
- После `done` с `unblocked_ids.length > 0` — опционально notify chat.  
- `403 tool_not_permitted` — не retry; escalate с именем tool.  
- `429 task_creation_rate_limit` — sleep 60s, retry.

---

## 8. Примеры

### create_task с blocked_by

**Request:**

```json
{
  "agent_name": "cursor",
  "title": "Написать unit-тесты для OAuth",
  "column": "backlog",
  "priority": "medium",
  "complexity": 2,
  "blocked_by": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"
}
```

**Response:**

```json
{
  "success": true,
  "task": {
    "task_id": "b1ffcd00-1d2c-5fg9-cc7e-7ccace491b22",
    "task_number": 48,
    "full_id": "ALPHA-48",
    "title": "Написать unit-тесты для OAuth",
    "column": "backlog",
    "created_at": "2026-08-20T11:00:00Z",
    "version": 1,
    "relation_created": true
  }
}
```

### move_task (claim)

**Request:**

```json
{
  "agent_name": "cursor",
  "task_id": "b1ffcd00-1d2c-5fg9-cc7e-7ccace491b22",
  "target_column": "in_progress",
  "version": 1,
  "claim": true,
  "reason": "начинаю работу"
}
```

**Response:**

```json
{
  "success": true,
  "task_id": "b1ffcd00-1d2c-5fg9-cc7e-7ccace491b22",
  "new_column": "in_progress",
  "claimed": true,
  "version": 2,
  "moved_at": "2026-08-20T11:05:00Z",
  "unblocked_ids": []
}
```

### Ошибки

**нет version:**

```json
{
  "error": {
    "code": 400,
    "type": "invalid_params",
    "message": "version is required for move_task."
  }
}
```

**circular_dependency:**

```json
{
  "error": {
    "code": 409,
    "type": "circular_dependency",
    "message": "blocked_by creates a dependency cycle. Task cannot block itself transitively."
  }
}
```

**tool_not_permitted:**

```json
{
  "error": {
    "code": 403,
    "type": "tool_not_permitted",
    "message": "Tool 'send_message_to_chat' is not in allowed_tools for this API key."
  }
}
```

**task_creation_rate_limit:**

```json
{
  "error": {
    "code": 429,
    "type": "task_creation_rate_limit",
    "message": "Rate limit exceeded: max 50 tasks/min per agent. Retry after 60s."
  }
}
```

**version_conflict:**

```json
{
  "error": {
    "code": 409,
    "type": "version_conflict",
    "message": "Task was modified by another client. Refetch and retry."
  }
}
```

---

## 9. MCP tools/list (каталог для адаптера)

Сервер MUST отдавать tools с JSON Schema 2020-12 inputSchema. Минимальный набор имён:

```text
get_workspace_settings
get_tasks_by_column
get_task_context
create_task
move_task
handoff_task
escalate_task
send_message_to_chat
undo
```

`tools/list` response SHOULD включать:

```json
{
  "resultType": "complete",
  "tools": [ /* ... */ ],
  "ttlMs": 60000,
  "cacheScope": "private"
}
```

`tools/call` → domain → structured result; ошибки — через JSON-RPC error + `data` = domain error envelope.

---

## 10. Implementation map (Vercel + Supabase)

```text
app/
  api/
    agent/
      create_task/route.ts
      move_task/route.ts
      ...
    mcp/route.ts                 # POST /mcp
lib/
  domain/agent/
    createTask.ts
    moveTask.ts
    ...
  shared/
    mcpAuth.ts                   # resolveAgentKey, isToolAllowed
    errors.ts
supabase/
  migrations/
    ..._mcp_agent_keys.sql       # Master §6.19
```

**Auth path (оба транспорта):**

```text
Bearer key
  → sha256 → mcp_agent_keys (revoked_at IS NULL)
  → workspace_id + permissions
  → assert agent_name present
  → assert tool allowed
  → domain service
```

**Rate limit (без Redis):**

```sql
SELECT count(*) FROM agent_events
WHERE workspace_id = $1
  AND agent_name = $2
  AND tool = 'create_task'
  AND created_at > now() - interval '60 seconds';
```

---

## 11. Зависимости деплоя

| Зависимость | Минимум |
|-------------|---------|
| Master Spec | ≥ **0.13.5** (`mcp_agent_keys` §6.19) |
| Security | ≥ **0.2.0** |
| Миграция | `CREATE TABLE mcp_agent_keys` + `DROP COLUMN workspace_settings.mcp_api_keys` |

Не деплоить contract v0.8.0 раньше миграции Master 0.13.5.

---

## Changelog

**v0.8.0 — август 2026**

*Нативный MCP + auth-модель mcp_agent_keys:*

- §2: MCP 2026-07-28 Streamable HTTP (`POST /mcp`) + REST `/api/agent/*` (без alias `/api/mcp/*`)
- §2.3–2.4: `workspace_id` из ключа; 4-й check — обязательный `agent_name`; backing store = `mcp_agent_keys`
- §4: `workspace_id?` опционален; `move_task.version` **required** (breaking, pre-launch OK)
- §4 create_task: DFS **до** INSERT
- §4 handoff: enriched fields из внешнего Agentic Contract **отклонены**
- §5–7: sync под новую auth-модель и обязательный version
- §8: примеры move_task + invalid_params(version)
- §9–11: MCP catalog, implementation map, deploy deps

**v0.7.1 / v0.7.0 / v0.6.0 / v0.5.0** — см. историю; семантика tools сохранена, изменились transport и auth store.

---

*onitask · MCP Contract · v0.8.0 · август 2026*  
*Implementation target for coding agents · Vercel + Supabase*
