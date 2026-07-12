# onitask · MCP Contract (MVP для агентов)

**Версия:** 0.7.1
**Дата:** июнь 2026
**Статус:** Production-Ready

> **Тип документа:** Операционное приложение к Master Spec. Канонический HTTP-контракт для AI-агентов.
> **Главные ссылки:**
> [Architecture Master](onitask_Architecture_Master_.md) · [AI Contract](onitask_ai_.md)
> **Схема task_relations** — Master Spec §6.16 (A-12).

---

## 1. Цель

Дать AI-агентам полноценный интерфейс для автономной работы: читать, создавать, перемещать задачи, эскалировать проблемы и взаимодействовать с командой через Telegram.

---

## 2. Транспорт

Per‑tool REST маршруты:

```
POST /api/mcp/create_task
POST /api/mcp/move_task
POST /api/mcp/escalate_task
POST /api/mcp/get_tasks_by_column
POST /api/mcp/get_workspace_settings
POST /api/mcp/send_message_to_chat
POST /api/mcp/get_task_context
POST /api/mcp/handoff_task
POST /api/mcp/undo/:event_id
```

**Аутентификация:** `Authorization: Bearer <api_key>`
Сравнение ключей через `timingSafeEqual` (аксиома A‑2).

**Security Layer (v0.7.0):** каждый запрос проходит три проверки в Middleware до выполнения:

1. **timingSafeEqual** — верификация API-ключа (A-2)
2. **Tenant Isolation** — `workspace_id` из запроса совпадает с workspace_id, привязанным
   к API-ключу в `workspace_settings.mcp_api_keys` (A-7). Проверка выполняется на уровне
   Middleware, не RLS — агенты аутентифицируются через Bearer token, не JWT.
3. **Allowed Tools** — инструмент входит в `allowed_tools` конфига ключа (Master §6.4).
   Пустой `mcp_api_keys = {}` → legacy mode, все инструменты разрешены (backward compatible).

```typescript
// MCP Middleware (lib/mcpAuth.ts)
function getKeyPermissions(keyHash: string, settings: WorkspaceSettings) {
  const keyConfig = settings.mcp_api_keys?.[keyHash];

  // legacy mode: ключ не найден в mcp_api_keys → все инструменты разрешены
  // Существующие интеграции Cursor/Claude Code не затронуты до явной настройки Admin
  if (!keyConfig) return { allowed_tools: 'all', can_send_messages: true };

  return keyConfig;
}

function isToolAllowed(toolName: string, permissions: KeyConfig): boolean {
  if (permissions.allowed_tools === 'all') return true;
  return permissions.allowed_tools.includes(toolName);
}
// При запрете: 403 tool_not_permitted (см. §6)
```

Тело запроса — плоский JSON, без `jsonrpc`/`method` обёртки.

---

## 3. Доступные инструменты

| Tool                      | Описание                          | Расходует квоту | Логируется в `agent_events` |
|---------------------------|-----------------------------------|----------------|-----------------------------|
| `get_tasks_by_column`     | Получить задачи по колонке        | Нет            | ✅ да                       |
| `get_workspace_settings`  | Получить настройки workspace      | Нет            | ❌ pure read                |
| `get_task_context`        | Полный контекст задачи для агента | Нет            | ❌ pure read                |
| `create_task`             | Создать задачу                    | Да             | ✅ да                       |
| `move_task`               | Переместить задачу                | Да             | ✅ да                       |
| `escalate_task`           | Эскалировать человеку             | Да             | ✅ да                       |
| `handoff_task`            | Передать задачу другому агенту    | Да             | ✅ да                       |
| `send_message_to_chat`    | Отправить сообщение в Telegram    | Да (лёгкая)    | ✅ да                       |
| `undo`                    | Отменить последнее действие       | Нет            | ✅ да                       |

> `send_message_to_chat` расходует отдельный лёгкий лимит. При `quota_exceeded` на мутациях задач остаётся доступным.

---

## 4. Детальные сигнатуры + Ответы

### `get_tasks_by_column`

**Endpoint:** `POST /api/mcp/get_tasks_by_column`
**Запрос:**

```typescript
{
  workspace_id:           string,
  agent_name:             string,
  column:                 "backlog" | "in_progress" | "review" | "done",
  limit?:                 number,   // default 20, max 50
  assigned_to_me?:        boolean,  // фильтр по source_id = agent_name
  sort_by_blocking_value?: boolean  // v0.6.0: сортировать backlog по разблокирующей ценности
                                    // Только для column='backlog'.
                                    // true → задачи с наибольшим числом downstream зависимостей первыми
                                    // false/отсутствие → стандартная сортировка по created_at
}
```

**Ответ:**

```typescript
{
  success: true,
  tasks: TaskPreview[]
  // TaskPreview: id, title, column, assigned_to, reviewer_id,
  //              version, is_inbox, is_blocked, full_id, task_number
  // v0.6.0: при sort_by_blocking_value=true добавляется:
  //   blocking_value: number — кол-во downstream задач которые разблокирует эта задача
  //                            (task_relations WHERE relation_type='blocks', глубина 1)
  //                            0 если задача ничего не блокирует
}
```

> **Smart Backlog:** задача с `blocking_value=3` разблокирует трёх downstream исполнителей
> при завершении. Агент начинает с задач максимального leverage (§7 п.12).

---

### `get_workspace_settings`

**Endpoint:** `POST /api/mcp/get_workspace_settings`
**Запрос:** `{ workspace_id, agent_name }`
**Ответ:**

```typescript
{
  success: true,
  settings: {
    enable_cognitive_budget:     boolean,
    story_points_config:         object,
    velocity_window_days:        number,
    flow_config:                 object,
    realtime_subscription_level: 'own_tasks' | 'all',
    workspace_context:           string | null,  // ручной контекст Admin (домен, стек, команда)
    workspace_context_cache:     string | null,  // v0.6.0: derived cache оперативного состояния
                                                 // (текущий спринт, блокировки, перегруженные)
                                                 // null = кэш не собран или context_stale=true и rebuild в очереди
                                                 // Использование: учитывать при formulation reason/suggested_action
    context_stale:               boolean,        // v0.6.0: кэш устарел, rebuild в очереди
                                                 // true → продолжать работу, stale лучше отсутствия
    doc_kb_config:               object | null,
    agent_active_tasks:          TaskPreview[] | null
    // Задачи агента в in_progress/review с needs_human=false.
    // При старте: если не пуст → get_task_context для каждой задачи (§7 п.1, обязательно)
    // При polling после escalation: needs_human=false → оператор разблокировал
  }
}
```

**Tenant‑check:** только для `workspace_id` связанного с API ключом. Чужой workspace → 403 (A‑7).

---

### `create_task`

**Endpoint:** `POST /api/mcp/create_task`
**Запрос:**

```typescript
{
  workspace_id: string,
  agent_name:   string,
  title:        string,
  description?: string,
  column?:      "backlog" | "in_progress" | "review",
  assignee?:    string,
  tags?:        string[],
  deadline?:    string,       // ISO 8601
  priority?:    "low" | "medium" | "high" | "critical",
  complexity?:  1 | 2 | 3,   // рекомендуется явно (§7 п.10)
  blocked_by?:  string        // v0.6.0: UUID задачи-блокера (INV-13)
                              // Создаёт ребро task_relations:
                              //   from_task_id = blocked_by, to_task_id = новая задача
                              //   relation_type = 'blocks', weight = 1.0 (A-12)
                              // Новая задача получает is_blocked=true автоматически.
                              // Если blocked_by не существует → 404 blocker_not_found
                              // v0.7.0: перед INSERT выполняется DFS-проверка на цикл.
                              // Если blocked_by → ... → новая задача → цикл → 409 circular_dependency
}
```

Правила:
- Без явного `column` → `column = 'backlog'`, `is_inbox = true`.
- С явным `column` → `is_inbox = false`.
- `blocked_by` + явный `column` — допустимо.

**Rate Limit (v0.7.0):** максимум **50 задач/минуту** per agent per workspace (rolling window 60s).
Порог настраивается через `workspace_settings.mcp_api_keys[key].max_tasks_per_minute` (default 50).
Выбор 50/min обусловлен лимитом NeuralDeep Hub 60 RPM (каждый create → enrichment job).
При превышении: `429 task_creation_rate_limit` (см. §6).

**DFS Cycle Check (v0.7.0):** перед созданием ребра `blocks` Route Handler выполняет
поиск в глубину от `blocked_by` до новой задачи через существующие рёбра `task_relations`.
При обнаружении цикла: `409 circular_dependency` (см. §6). INSERT не выполняется.

**Серверное заполнение (F-04 Intelligent Ingress):**
- `raw_input = title + '\n' + description`
- `clarity_score = null`
- `complexity = params.complexity ?? inferComplexity(params.description)`
- `enrichment_strategy = 'standard'`
- `cognitive_weight = 1` (обновится F-03)

**Ответ:**

```typescript
{
  success: true,
  task: {
    task_id:          string,
    task_number:      number,
    full_id:          string,     // 'ALPHA-123'
    title:            string,
    column:           string,
    created_at:       string,     // timestamptz
    version:          number,
    relation_created: boolean     // v0.6.0: true если blocked_by передан и ребро создано
  }
}
```

---

### `move_task`

**Endpoint:** `POST /api/mcp/move_task`
**Запрос:**

```typescript
{
  workspace_id:  string,
  agent_name:    string,
  task_id:       string,
  target_column: "backlog" | "in_progress" | "review" | "done",
  reason?:       string,   // → task_column_history.metadata и agent_events.metadata
  claim?:        boolean   // атомарный захват: assigned_to = agent_worker_id
                           // 409 already_claimed если уже назначена другому
}
```

Эффекты:
- Атомарно обновляет `tasks.column`, сбрасывает `is_inbox = false`.
- `moved_to_column_at` обновляется BEFORE‑триггером.
- При `target_column = 'done'`: `trg_cascade_unblock` (Master §6.16) снимает `is_blocked`
  с downstream задач у которых эта была единственным блокером; ставит `cascade_unblock` в очередь.

**Ответ:**

```typescript
{
  success:       true,
  task_id:       string,
  new_column:    string,
  claimed:       boolean,
  version:       number,
  moved_at:      string,       // timestamptz
  unblocked_ids: string[]      // v0.6.0: UUID задач разблокированных cascade_unblock
                               // [] если задача не была блокером или move не в done
}
```

---

### `escalate_task`

**Endpoint:** `POST /api/mcp/escalate_task`
**Запрос:**

```typescript
{
  workspace_id:      string,
  agent_name:        string,
  task_id:           string,
  reason:            "insufficient_context" | "conflicting_requirements" | "blocked_by" | "out_of_scope",
  suggested_action?: string
}
```

**Ответ:** `{ success: true, task_id }`

---

### `send_message_to_chat`

**Endpoint:** `POST /api/mcp/send_message_to_chat`
**Запрос:**

```typescript
{
  workspace_id: string,
  agent_name:   string,
  chat_id:      number,
  text:         string,   // макс. 4096 символов (лимит Telegram)
  parse_mode?:  "HTML" | "MarkdownV2"
}
```

**Безопасность (v0.7.0):**
- `chat_id` не в workspace → 403.
- `can_send_messages: false` в `mcp_api_keys` → 403 `tool_not_permitted`.
- **HTML sanitization** (LLM-5): Route Handler применяет `sanitizeOutput(text, 'tg')` до отправки
  в Telegram Bot API. Whitelist тегов: `<b>`, `<i>`, `<u>`, `<s>`, `<code>`, `<pre>`.
  Тег `<a href>` и все атрибуты удаляются — предотвращает фишинговые ссылки от агентов.
  URL в тексте остаются как plain text без автоссылки.
  Реализация: `sanitize-html` с `allowedAttributes: {}`, `disallowedTagsMode: 'discard'`.

**Ответ:** `{ success: true, message_id: number }`

---

### `get_task_context`

**Endpoint:** `POST /api/mcp/get_task_context`
**Запрос:**

```typescript
{
  workspace_id: string,
  agent_name:   string,
  task_id:      string
}
```

**Ответ:**

```typescript
{
  success: true,
  task: {
    id:                 string,
    full_id:            string,
    task_number:        number,
    title:              string,
    description:        string | null,
    column:             string,
    priority:           string | null,
    assigned_to:        string | null,
    reviewer_id:        string | null,
    is_blocked:         boolean,
    is_inbox:           boolean,
    needs_human:        boolean,
    escalation_reason:  string | null,
    deadline:           string | null,
    version:            number,
    metadata:           object,
    moved_to_column_at: string | null
  },
  column_history: [
    {
      from_column: string | null,
      to_column:   string,
      moved_by:    string | null,
      moved_at:    string,
      metadata:    object | null
    }
  ],
  agent_events: [
    {
      tool:       string,
      agent_name: string,
      summary:    string | null,
      metadata:   object | null,
      created_at: string
    }
    // последние 20, ORDER BY created_at DESC
  ],
  memory_summary:    string | null,
  workspace_context: string | null,
  relevant_docs: [
    {
      filename:   string,
      section:    string,
      content:    string,
      similarity: number
    }
  ] | null,
  subgraph: [                        // v0.6.0: рёбра task_relations (A-12, Master §6.16)
    {
      from_task_id:  string,         // UUID задачи-источника
      to_task_id:    string,         // UUID задачи-цели
      relation_type: "blocks" | "spawned_from" | "mentions",
      weight:        number,         // 1.0 / 0.8 / 0.3 (иммутабельная шкала A-12)
      depth:         1 | 2           // 1 = прямая связь, 2 = через соседа (только blocks)
    }
  ] | null   // null = нет рёбер (новый workspace или задача до v0.12.0)
             // Не ошибка — допустимое состояние day 0. Не retry.
}
```

**Назначение:** восстановить полный контекст после перезапуска сессии.

> **Интерпретация `subgraph`:**
>
> ```
> from_task_id === task.id  →  ЭТА задача блокирует to_task_id
> to_task_id   === task.id  →  from_task_id блокирует ЭТУ задачу
> ```
>
> Обязательные проверки до начала работы:
> - `to_task_id = task.id` + блокер в `done` → orphan block → `escalate_task (reason='blocked_by')`
> - `from_task_id = task.id` → при `move → done` downstream задачи разблокируются автоматически

---

### `handoff_task`

**Endpoint:** `POST /api/mcp/handoff_task`
**Запрос:**

```typescript
{
  workspace_id:    string,
  agent_name:      string,
  task_id:         string,
  target_agent:    string,
  handoff_notes:   string,   // обязательно, макс. 1000 символов
  move_to_column?: string
}
```

**Ответ:**

```typescript
{
  success:       true,
  task_id:       string,
  handed_off_to: string,
  new_column:    string | null,
  version:       number
}
```

**Семантика:**
- `handoff_task` = плановая передача эстафеты (агент завершил свою часть)
- `escalate_task` = агент застрял, нужна помощь оператора

**Эффекты:** `assigned_to`, `handoff_to`, `handoff_notes` обновляются атомарно.
`handoff_to` и `handoff_notes` сбрасываются когда target вызывает `move_task → in_progress`.

> **v0.6.0:** `trg_handoff_chain_alert` (sql_anomalies_.md §5.7) срабатывает при каждом
> `handoff_task` событии. При ≥3 handoff по задаче за 7 дней — алерт оператору.

---

### `undo`

**Endpoint:** `POST /api/mcp/undo/:event_id`
**Запрос:**

```typescript
{
  workspace_id: string,
  agent_name:   string
}
```

**Ответ:** `{ success: true, restored: boolean }`

**Ограничения:**
- Окно: **5 минут**. Только события текущего `agent_name`.
- ⚠️ **Post‑MVP:** `state_before` без version‑check — undo перезапишет изменения если задача изменилась после event.

> `agent_events` хранятся 7 дней. GC в 03:00 UTC.

---

## 5. Архитектурные гарантии

- **Hot Path** (A‑1) — все операции < 2s.
- **Optimistic Locking** + `version` (INV‑09).
- **Memento** (`state_before` в `agent_events`) для каждой мутации.
- **Автосоздание worker** (INV‑04) через `trg_auto_create_agent_worker`.
- **task_column_history.moved_by** в Route Handler в одной транзакции.
- **Realtime** broadcast после успешной мутации.
- **Atomic Quota** (A‑3) для всех мутирующих инструментов.
- **Relational Context Layer** (A‑12, v0.6.0): `blocked_by` в `create_task` создаёт ребро
  `task_relations` (INV-13: `workspace_id` явно). `move_task → done` запускает
  `trg_cascade_unblock` — автоматическое снятие блокировок downstream задач.
- **Security Layer** (v0.7.0, onitask_security_.md):
  - **Allowed Tools** — каждый вызов проверяется против `mcp_api_keys[key].allowed_tools`
    (Master §6.4). Пустой `{}` = legacy mode, backward compatible.
  - **Rate Limit** — `create_task`: 50 задач/мин per agent per workspace (rolling window 60s).
    Настраивается через `max_tasks_per_minute` в `mcp_api_keys`. Защита от DoS и agent loops.
  - **DFS Cycle Check** — `blocked_by` в `create_task` проверяется на циклические зависимости
    до INSERT в `task_relations`. 409 `circular_dependency` при обнаружении цикла.
  - **HTML Sanitization** — `send_message_to_chat`: whitelist тегов `<b><i><u><s><code><pre>`,
    запрет `<a href>`. Предотвращает фишинговые ссылки через агентов.

---

## 6. Обработка ошибок

| HTTP код | `error.type`               | Когда                                                                    | Действие агента                                               |
|----------|----------------------------|--------------------------------------------------------------------------|---------------------------------------------------------------|
| 400      | `invalid_params`           | Отсутствует обязательное поле, неверный тип                              | Исправить запрос, не retry                                    |
| 401      | `unauthorized`             | API key отсутствует или неверный                                         | Остановиться, уведомить оператора                             |
| 403      | `forbidden`                | `workspace_id` чужой; `chat_id` не в workspace                           | Не retry, логировать                                          |
| 403      | `tool_not_permitted`       | Инструмент не входит в `allowed_tools` ключа (v0.7.0)                   | Не retry; уточнить scope у Admin                              |
| 404      | `task_not_found`           | `task_id` не существует в workspace                                      | `get_tasks_by_column`, уточнить                               |
| 404      | `worker_not_found`         | `target_agent` не найден или неактивен                                   | Проверить через `get_workspace_settings`                      |
| 404      | `blocker_not_found`        | `blocked_by` UUID не существует в workspace (v0.6.0)                     | Проверить UUID; создать без `blocked_by` или уточнить         |
| 409      | `version_conflict`         | Параллельное изменение задачи                                            | Перечитать, retry с новым `version`                           |
| 409      | `already_claimed`          | `move_task` с `claim:true`, задача занята другим worker                   | Не retry; выбрать другую задачу                               |
| 409      | `circular_dependency`      | `blocked_by` создаёт цикл в `task_relations` (v0.7.0)                   | Не retry; создать без `blocked_by` или пересмотреть граф     |
| 422      | `quota_exceeded`           | Исчерпан AI-лимит на мутации                                             | §7 п.4                                                        |
| 429      | `rate_limited`             | Превышен системный rate limit (Supabase, Telegram)                       | Exponential backoff + `Retry-After`                           |
| 429      | `task_creation_rate_limit` | `create_task`: > 50 задач/мин per agent per workspace (v0.7.0)           | Подождать 60s; снизить темп создания                          |
| 500      | `internal_error`           | Внутренняя ошибка                                                        | 1 retry через 2 сек, затем стоп                               |

**Формат:**

```json
{
  "error": {
    "code":    409,
    "type":    "circular_dependency",
    "message": "blocked_by creates a dependency cycle. Task cannot block itself transitively."
  }
}
```

---

## 7. Рекомендации для агентов

1. **Старт сессии — обязательный порядок:**

   ```
   get_workspace_settings
     → если agent_active_tasks не пуст:
         для каждой задачи → get_task_context   ← обязательно
     → иначе: get_tasks_by_column { column: 'backlog', sort_by_blocking_value: true }
   ```

   - `workspace_context` не null → учитывать домен в `reason` и `suggested_action`.
   - `workspace_context_cache` не null → оперативное состояние (спринт, перегрузка, блокировки).
   - `context_stale = true` → продолжать работу, stale кэш лучше отсутствия.

2. Перед мутациями получать актуальный `version` (из `get_tasks_by_column` или из ответа мутации).

3. **При 409 `version_conflict` — retry с backoff:**

   ```typescript
   const BACKOFF_MS = [0, 1000, 3000];

   async function moveWithRetry(params: MoveTaskParams, maxAttempts = 3) {
     for (let attempt = 0; attempt < maxAttempts; attempt++) {
       if (attempt > 0) await sleep(BACKOFF_MS[attempt]);
       const { data: tasks } = await mcp.get_tasks_by_column({
         column: params.target_column, workspace_id: params.workspace_id
       });
       const current = tasks.find(t => t.id === params.task_id);
       if (!current) return;
       const result = await mcp.move_task({ ...params, version: current.version });
       if (result.success) return result;
       if (result.error?.type !== 'version_conflict') throw result.error;
     }
     await mcp.escalate_task({
       workspace_id:     params.workspace_id,
       agent_name:       params.agent_name,
       task_id:          params.task_id,
       reason:           'conflicting_requirements',
       suggested_action: 'Не удалось переместить задачу после 3 попыток'
     });
   }
   ```

4. **При `quota_exceeded`:**

   a. `send_message_to_chat` (отдельный лимит, работает при 422 на мутациях).
   b. Если недоступен → `move_task` всех in_progress в `backlog` с `reason: 'quota_exhausted'`.
   c. Остановиться.

5. `chat_id` только из привязанных чатов workspace.

6. В `move_task` передавать `reason` — улучшает AI Flow Summary.

7. При плановой передаче — `handoff_task`, не `escalate_task`.
   `handoff_notes` обязательны. Использовать `get_task_context` для качественных заметок.

8. **Перед продолжением прерванной работы — `get_task_context`:**

   - `column_history` — что сделано
   - `agent_events` — какие инструменты вызывались
   - `memory_summary` — итог по долгим задачам
   - `subgraph` (v0.6.0) — структурные зависимости

   При непустом `subgraph` — проверить до начала работы:
   - `to_task_id = task.id` + блокер в `done` → orphan block → `escalate_task (reason='blocked_by')`
   - `from_task_id = task.id` → при `move → done` downstream разблокируются автоматически

9. Использовать `full_id` в `summary` и `handoff_notes`:
   `'Переместил ALPHA-45 в review: реализация завершена'`

10. `complexity` передавать явно. `complexity: 3` → `standard` enrichment с `ai_hint` и Doc RAG.

    **v0.6.0:** При известной зависимости — `blocked_by` (UUID блокера).
    Флаги блокировки агент не обновляет вручную — только `blocked_by` в `create_task`.

11. **При `escalation` — polling:**

    ```typescript
    async function waitForResolution(taskId: string, wsId: string, agentName: string) {
      while (true) {
        await sleep(60_000);
        const settings = await mcp.get_workspace_settings({
          workspace_id: wsId, agent_name: agentName
        });
        const active = settings.agent_active_tasks?.find(t => t.id === taskId);
        if (active && active.needs_human === false) {
          return await mcp.get_task_context({
            workspace_id: wsId, agent_name: agentName, task_id: taskId
          });
        }
      }
    }
    ```

12. **Smart Backlog — выбор задач с максимальным leverage (v0.6.0):**

    ```typescript
    const { data: backlog } = await mcp.get_tasks_by_column({
      workspace_id:           params.workspace_id,
      agent_name:             params.agent_name,
      column:                 'backlog',
      sort_by_blocking_value: true,
      limit:                  10
    });

    // Первая незаблокированная задача = максимальный leverage
    const nextTask = backlog.find(t => !t.is_blocked);
    if (nextTask) {
      await mcp.move_task({
        workspace_id:  params.workspace_id,
        agent_name:    params.agent_name,
        task_id:       nextTask.id,
        target_column: 'in_progress',
        claim:         true,
        reason:        `blocking_value=${nextTask.blocking_value} — максимальный leverage`
      });
    }
    ```

    > `blocking_value = 0` у всех → обычная сортировка по дате. Smart backlog деградирует изящно.

13. **Cascade Unblock — действия после завершения блокирующей задачи (v0.6.0):**

    ```typescript
    const result = await mcp.move_task({
      task_id: taskId, target_column: 'done', ...
    });

    if (result.unblocked_ids?.length > 0) {
      await mcp.send_message_to_chat({
        workspace_id: params.workspace_id,
        agent_name:   params.agent_name,
        chat_id:      chatId,
        text: `✅ ${fullId} завершена. ` +
              `Разблокированы: ${result.unblocked_ids.length} задач(и).`,
        parse_mode: 'HTML'
      });
    }
    ```

14. **Работа в условиях ограниченного allowed_tools scope (v0.7.0):**

    Агент не знает свой `allowed_tools` заранее — конфигурация прозрачна.
    При получении `403 tool_not_permitted`:

    ```typescript
    // Не retry — scope не изменится в рамках сессии
    // Стратегия 1: использовать альтернативный инструмент если возможно
    // Стратегия 2: эскалировать с пояснением
    if (error.type === 'tool_not_permitted') {
      await mcp.escalate_task({
        workspace_id:     params.workspace_id,
        agent_name:       params.agent_name,
        task_id:          params.task_id,
        reason:           'insufficient_context',
        suggested_action: `Требуется инструмент ${toolName}, но он не разрешён для этого ключа. `
                        + `Admin должен добавить '${toolName}' в allowed_tools.`
      });
    }
    ```

    При `429 task_creation_rate_limit` — подождать 60 секунд и продолжить:
    ```typescript
    if (error.type === 'task_creation_rate_limit') {
      await sleep(60_000);
      // retry create_task
    }
    ```

---

## 8. Примеры запросов + ответов

### `create_task` с `blocked_by`

```json
{
  "workspace_id": "550e8400-e29b-41d4-a716-446655440000",
  "agent_name":   "cursor",
  "title":        "Написать unit-тесты для OAuth",
  "column":       "backlog",
  "priority":     "medium",
  "complexity":   2,
  "blocked_by":   "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"
}
```

```json
{
  "success": true,
  "task": {
    "task_id":          "b1ffcd00-1d2c-5fg9-cc7e-7ccace491b22",
    "task_number":      48,
    "full_id":          "ALPHA-48",
    "title":            "Написать unit-тесты для OAuth",
    "column":           "backlog",
    "created_at":       "2026-06-20T11:00:00Z",
    "version":          1,
    "relation_created": true
  }
}
```

---

### `create_task` базовый

```json
{
  "workspace_id": "550e8400-e29b-41d4-a716-446655440000",
  "agent_name":   "cursor",
  "title":        "Настроить CI для frontend",
  "column":       "backlog",
  "priority":     "high"
}
```

```json
{
  "success": true,
  "task": {
    "task_id":          "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    "task_number":      47,
    "full_id":          "ALPHA-47",
    "title":            "Настроить CI для frontend",
    "column":           "backlog",
    "created_at":       "2026-05-26T10:15:00Z",
    "version":          1,
    "relation_created": false
  }
}
```

---

### Ошибка (blocker_not_found)

```json
{
  "error": {
    "code":    404,
    "type":    "blocker_not_found",
    "message": "Task specified in blocked_by does not exist in this workspace."
  }
}
```

### Ошибка (circular_dependency)

```json
{
  "error": {
    "code":    409,
    "type":    "circular_dependency",
    "message": "blocked_by creates a dependency cycle. Task cannot block itself transitively."
  }
}
```

### Ошибка (tool_not_permitted)

```json
{
  "error": {
    "code":    403,
    "type":    "tool_not_permitted",
    "message": "Tool 'send_message_to_chat' is not in allowed_tools for this API key."
  }
}
```

### Ошибка (task_creation_rate_limit)

```json
{
  "error": {
    "code":    429,
    "type":    "task_creation_rate_limit",
    "message": "Rate limit exceeded: max 50 tasks/min per agent. Retry after 60s."
  }
}
```

### Ошибка (version_conflict)

```json
{
  "error": {
    "code":    409,
    "type":    "version_conflict",
    "message": "Task was modified by another client. Refetch and retry."
  }
}
```

---

## Changelog

**v0.7.1 — июнь 2026**

*Priority sync:*

- §4 `create_task`: исправлено значение `priority`: `'normal'` → `'medium'`.
  Приводит в соответствие с `tasks.priority CHECK` constraint (Master §6.1)
  и `product_vision §6` (AC-02-1: `priority=medium`).
  Затронуто: сигнатура TypeScript + пример запроса.

---

**v0.7.0 — июнь 2026**

*Security Layer (OWASP LLM Top 10 2025 — LLM-6 Excessive Agency, LLM-5 Improper Output Handling, LLM-9 Plugin Design):*

- §2: расширен раздел «Транспорт» — добавлена документация трёхуровневой проверки в Middleware:
  timingSafeEqual (A-2) + Tenant Isolation через `mcp_api_keys` (исправлена некорректная ссылка
  на «JWT-сессию агента» — агенты аутентифицируются через Bearer token, не JWT) + Allowed Tools
  enforcement; TypeScript реализация `getKeyPermissions` и `isToolAllowed` с legacy mode (`{}` = all)
- §4 `create_task`: добавлена документация Rate Limit (50 tasks/min per agent per workspace,
  rolling window 60s, настраивается через `max_tasks_per_minute`; выбор 50 обусловлен NeuralDeep
  60 RPM); добавлена документация DFS Cycle Check перед INSERT task_relations; новые ошибки
  `429 task_creation_rate_limit` и `409 circular_dependency`
- §4 `send_message_to_chat`: расширена секция «Безопасность» — добавлен `can_send_messages` check;
  HTML sanitization через `sanitizeOutput(text, 'tg')`: whitelist `<b><i><u><s><code><pre>`,
  запрет `<a href>` и всех атрибутов; текст 4096 символов max
- §5: добавлена гарантия «Security Layer» — Allowed Tools, Rate Limit, DFS Cycle Check,
  HTML Sanitization; ссылка на onitask_security_.md
- §6: добавлены три новых типа ошибок: `403 tool_not_permitted`, `409 circular_dependency`,
  `429 task_creation_rate_limit`; разделены `429 rate_limited` (системный) и
  `429 task_creation_rate_limit` (агентный)
- §7 п.14 (новый): работа в условиях ограниченного allowed_tools scope — стратегия при
  `403 tool_not_permitted` (escalate_task с пояснением) и `429 task_creation_rate_limit` (60s wait)
- §8: добавлены примеры ошибок `circular_dependency`, `tool_not_permitted`, `task_creation_rate_limit`

**v0.6.0 — июнь 2026**

*Relational Context Layer (A-12):*

- §4 `get_tasks_by_column`: параметр `sort_by_blocking_value?: boolean` — Smart Backlog. Поле `blocking_value: number` в TaskPreview при `sort_by_blocking_value=true`
- §4 `get_workspace_settings`: поля `workspace_context_cache: string | null` и `context_stale: boolean` в response. Семантика `context_stale=true` задокументирована
- §4 `create_task`: параметр `blocked_by?: string (UUID)` — ребро `task_relations (blocks, 1.0)` + `is_blocked=true` на новой задаче (INV-13). Поле `relation_created: boolean` в response. Новая ошибка `404 blocker_not_found`
- §4 `move_task`: поле `unblocked_ids: string[]` в response — UUID задач разблокированных `trg_cascade_unblock`. Задокументирован cascade-эффект триггера (Master §6.16)
- §4 `handoff_task`: примечание о `trg_handoff_chain_alert` (sql_anomalies_.md §5.7)
- §4 `get_task_context`: поле `subgraph: [...] | null` — рёбра `get_task_subgraph` RPC (Master §6.16). Блок-схема интерпретации direction агентом
- §5: гарантия Relational Context Layer — `blocked_by` + `trg_cascade_unblock`
- §6: строка `404 blocker_not_found`
- §7 п.1: smart backlog на старте; инструкция `workspace_context_cache` / `context_stale`
- §7 п.8: `subgraph` в `get_task_context`; проверки orphan block и cascade
- §7 п.10: инструкция `blocked_by`
- §7 п.12 (новый): Smart Backlog — TypeScript паттерн
- §7 п.13 (новый): Cascade Unblock — проверка `unblocked_ids`, `send_message_to_chat`
- §8: пример `create_task` с `blocked_by`; `blocker_not_found` ошибка

**v0.5.0 — май 2026**
- `agent_active_tasks`; `claim`; `409 already_claimed`; session resume; retry backoff; quota fallback; polling loop

---

*onitask · MCP Contract · v0.7.1 · июнь 2026*
