# onitask · Architecture Master Specification

**Версия:** 0.13.4 (Master)
**Дата:** июнь 2026
**Статус:** Утверждённый источник истины — заменяет Arch V4.3, Flow Concept V3.2 (Schema), Team Tab V1.0 (Schema), Bot V0.1 (Schema)

> **Правило для агентов:** Перед написанием любой миграции, Route Handler или Edge Function — прочитай раздел «Инварианты» и «Полная схема БД». Отклонение от этих определений — архитектурная ошибка.

---

## Содержание

1. [Инварианты (Machine-Checkable)](#1-инварианты)
2. [Три скорости (Three-Speed Architecture)](#2-три-скорости)
3. [Архитектурные аксиомы](#3-архитектурные-аксиомы)
4. [Единая модель Worker](#4-единая-модель-worker)
5. [Модель колонок и флаг is_inbox](#5-модель-колонок-и-флаг-is_inbox)
6. [Полная схема БД](#6-полная-схема-бд)
7. [Контракт конкурентности и идемпотентности](#7-контракт-конкурентности-и-идемпотентности)
8. [Настройки воркспейса](#8-настройки-воркспейса)
9. [Политика хранения данных](#9-политика-хранения-данных)
10. [Структура документации](#10-структура-документации)

---

## 1. Инварианты

Проверяемые аксиомы системы. Нарушение любого из них — блокер.

```
INV-01  tasks.assigned_to        → REFERENCES workers(id)
INV-02  tasks.reviewer_id        → REFERENCES workers(id)
INV-03  task_column_history.moved_by → REFERENCES workers(id)  -- NULL только для system/migration
INV-04  agent_events имеет триггер auto_create_agent_worker()
INV-05  Все AI-outputs содержат workspace_id (tenant isolation, A-7)
INV-06  Все секреты сравниваются через timingSafeEqual (A-2)
INV-07  Квота AI инкрементируется через atomic RPC, не через SELECT+UPDATE (A-3)
INV-08  workspace_settings — единственный источник настроек для F-01, F-03, F-04, Flow Board
        f04_config покрывает пороги Gatekeeper и Correction Sheet
INV-09  version на tasks инкрементируется атомарно в том же UPDATE через WHERE version = $expected
INV-10  workspace_telegram_chats.linked_by → REFERENCES profiles(id)  -- исключение: admin-only context
INV-11  workspaces.task_prefix иммутабелен после создания — триггер trg_prevent_task_prefix_update
        блокирует любой UPDATE изменяющий значение поля
INV-12  assignment_history.snapshot_attention_risk фиксируется исключительно триггером
        trg_record_assignment_snapshot (BEFORE UPDATE OF assigned_to ON tasks).
        Прямой INSERT в assignment_history из Route Handler без снапшота — архитектурная ошибка:
        нарушает консистентность датасета Контура 2 (A-11).
INV-13  task_relations.workspace_id передаётся явно при каждом INSERT.
        Автоматическая резолюция через tasks.workspace_id запрещена —
        аналогично enrichment_queue (v0.7.4, INV применён в v0.12.0).
INV-14  workspace_context (text, Admin-only) и workspace_context_cache (text, system-only)
        — строго разные поля с разными владельцами.
        workspace_context_cache НИКОГДА не записывается пользователем напрямую.
        workspace_context НИКОГДА не перезаписывается системой автоматически.
        Нарушение — архитектурная ошибка: пользователь теряет ручной контекст.
INV-15  data_sharing_level = 'full' устанавливается только Admin/Owner осознанно.
        Смысл: уровень 'full' снимает порог similarity для Doc RAG — весь контент всех
        workspace-документов потенциально попадает в промпт LLM-провайдера (NeuralDeep Hub)
        без фильтрации по релевантности. Риск: проприетарная документация (архитектура,
        контракты, спецификации) уходит третьей стороне без ограничений.
        Требует подписанного DPA с NeuralDeep Hub в части обработки IP-контента.
        Уровни 'minimal' и 'standard' не требуют DPA:
          — assignment_history передаётся в виде псевдонимизированных UUID (GDPR Recital 26:
            данные вне контура onitask не позволяют идентифицировать субъекта).
          — worker display_names передаются как usernames в функциональном контексте.
        Значение по умолчанию 'standard' = текущее поведение системы (backward compatible).
        Enforcement: поле data_sharing_level доступно на запись только Admin/Owner через RLS.
INV-16  /api/init — find-or-create ТОЛЬКО. display_name и avatar_url устанавливаются
        при создании из Telegram initData и обновляются ТОЛЬКО через явные настройки
        профиля в TWA. Автообновление при повторных вызовах /api/init запрещено.
        Обоснование: автосинхронизация с Telegram ломает ожидания тимлида — участник
        видит коллегу под именем «Иван», а имя меняется на «John» без его ведома.
```

---

## 2. Три скорости

| Контур | Латентность | Модель / Стек | Консистентность | Задача / Клиент |
|---|---|---|---|---|
| 🟡 Instant | < 300ms | Groq · llama-3.3-70b-versatile | Optimistic UI + version check | Ввод пользователя в TWA, Bot команды |
| 🔵 Async | 3–10s (фон) | NeuralDeep Hub · GPT-OSS-120B | Supabase Edge Functions, pgvector RAG | Фоновое обогащение задач (F-03), Workspace Context rebuild |
| 🟣 Agent | anytime | MCP Server / REST | Memento Diff snapshots, Realtime Buffering | Внешние агенты (Cursor, Claude Code) |

---

## 3. Архитектурные аксиомы

**A-1 · Vercel = только Hot Path**
API-маршруты на Vercel обрабатывают только запросы < 2 секунд. Все RAG-операции и вызовы LLM — в Supabase Edge Functions. Vercel Hobby: лимит 10 секунд.

**A-2 · Timing Safe & DB Isolation**
API-ключи MCP и HMAC-подписи сравниваются через `timingSafeEqual`. Оператор `===` допустим только для non-secret строк (column names, types, labels). Прямое чтение схем Moraleon запрещено — только через API/Webhook.

**A-3 · Atomic Quota**
Учёт AI-квот через `INSERT ... ON CONFLICT DO UPDATE`. Исключает race conditions при параллельных запросах агентов.

**A-4 · Векторное индексирование**
pgvector v0.5+ в Supabase. `tasks`: IVFFlat, `lists = 100`. `agent_memory`: IVFFlat с `lists = 50` на MVP (меньше RAM, достаточный recall при < 10k векторов). `workspace_doc_chunks`: IVFFlat с `lists = 10` на MVP (типичный объём ~800 векторов при лимите 20 файлов × ~40 чанков). Переключение на HNSW (`m = 16`, `ef_construction = 64`) — при COUNT(*) > 5 000 записей через `REINDEX`, не раньше: HNSW держит граф в RAM (~500 MB на 100k × 1024 dim), на Supabase Pro это конфликтует с shared_buffers и connection pool.

**A-5 · Гибридный двухконтурный учёт оценок**
`story_points` (макро, спринты) и `cognitive_weight` (микро, Когнитивный бюджет) независимы и конфигурируются через `workspace_settings`. Оба рассчитываются в F-03, даже если один отключён.

**`tasks.cognitive_weight` — единственный источник истины для F-01 (аксиома A-9).** `task_enrichments.cognitive_weight` хранит то же значение только для аудита — не участвует в расчёте бюджета.

**Синхронизация:**
- При `enrichment_strategy = 'skip'` — F-03 не запускается. Route Handler проставляет `tasks.cognitive_weight = 0` в момент INSERT задачи, всегда независимо от `enable_cognitive_budget`. `task_enrichments` получает `cognitive_weight = null` (не применимо), `story_points = null`, `model_used = 'deterministic'`. Шкала `cognitive_weight`: `0` = рутина/когнитивный ноль, `1` = лёгкая, `2` = средняя, `3` = сложная.
- При `light`/`standard` — Edge Function `enrich-task` обновляет `tasks.cognitive_weight` явным `UPDATE` перед записью в `task_enrichments`. Перед `UPDATE` проверяется `tasks.updated_at` vs `requestedAt` — при версионном конфликте enrichment помечается `stale`, задача не перезаписывается, retry не выполняется.

**A-6 · Один вызов модели (No Fallback Chain)**
Fallback-цепочка упразднена. Cold Path использует NeuralDeep Hub · GPT-OSS-120B (один вызов). При ошибке LLM: `enrichment_status = 'failed'`, тихое уведомление пользователю, UX не блокируется. Для embedding-провайдера (NeuralDeep bge-m3) отдельный fallback не задан на MVP — при недоступности NeuralDeep embed-шаг пропускается, `enrichment_status = 'failed'`.

**A-7 · Tenant Isolation**
Все AI-outputs привязаны к `workspace_id`. Проверка через централизованный Middleware до любого обращения к данным.

**A-8 · Flow Access Control**
Flow Board доступен всем Members. AI-функции (AI Flow Summary, AI Alerts) — только Admin/Owner.
Изменение `workspace_settings` — только Admin/Owner.

**A-9 · Cognitive Budget Formula**
Когнитивный бюджет = SUM(cognitive_weight) по задачам:
`column = 'in_progress'` (assigned_to = worker) + `column = 'review'` (reviewer_id = worker).
Ревью чужого кода считается полноценной когнитивной нагрузкой наравне с написанием своего.
Источник настройки: `workspace_settings.enable_cognitive_budget`.

**A-10 · Layered Metrics Cache**
Метрики Flow Board кэшируются послойно: Column Health — 5 сек,
Worker Load — 60 сек, AI Alerts — 60 сек.
Небольшая неточность допустима; near-realtime требуется только для Column Health.

**A-11 · Assignment Risk Score**
`attention_risk_score` — детерминированная метрика операционного риска назначения задачи
конкретному worker. Вычисляется VIEW `attention_risk_pulse` (sql_anomalies_.md §3.9) как
взвешенная сумма четырёх факторов из `tasks` и `task_column_history`:
активные обязательства (×15), переключения контекста за сегодня (×10),
когнитивное трение — блокировки + ревью (×12 / ×5), deadline-давление (×15).
Диапазон 0–100. Порог amber ≥ 60, порог red ≥ 80.

**Разграничение с A-9 (Cognitive Budget):**
- A-9 = метрика **состояния**: «сколько когнитивного ресурса занято прямо сейчас» →
  инструмент self-awareness разработчика. Шкала 0–3.
- A-11 = метрика **действия при назначении**: «какова вероятность проблемы если добавить
  эту задачу» → инструмент тимлида. Шкала 0–100.

Снапшот `attention_risk_score` фиксируется в `assignment_history` (§6.14) при каждом
назначении через `trg_record_assignment_snapshot` — это «золотой датасет» Контура 2
(прогностическая модель на исторических данных). LLM не используется.

**Весовой базис (нейробиологически обоснованный):**
- active_tasks × 15: параллельные задачи снижают эффективность ~25% каждая (Rubinstein 2001)
- context_switches × 10: 23 мин на восстановление фокуса после переключения (Gloria Mark, UCI 2004)
- blocked_tasks × 12: незавершённые задачи нагружают рабочую память (Zeigarnik effect)
- review_tasks × 5: attention cost ниже, чем у активной разработки
- critical_deadline_tasks × 15: deadline сужает cognitive bandwidth (Mullainathan & Shafir)

**Ограничение (caveat):** `context_switches_today` считается через `task_column_history.moved_by`,
которое nullable из-за known race condition (§6.3). Потеря точности ~5–10%. Обработана через
`COALESCE(..., 0)`. Принято как осознанный компромисс (INV-12).

**A-12 · Relational Context Layer**
`task_relations` (§6.16) — структурный слой знаний поверх семантического поиска (pgvector).
Не заменяет `match_tasks()` / `match_doc_chunks()` / `match_agent_memory()` — дополняет их.
При пустом `task_relations` для задачи все три RPC используются как fallback (поведение не деградирует).

**Три типа отношений (иммутабельная шкала весов):**
- `'blocks'`       → 1.0 — явная блокировка (создаётся пользователем через UI или агентом через MCP)
- `'spawned_from'` → 0.8 — задача порождена AI-декомпозицией родительской
- `'mentions'`     → 0.3 — упоминание ALPHA-N в description (Phase 1.1, триггер trg_mentions_parse)

Изменение весов = изменение аксиомы A-12, не просто UPDATE в БД.

**Traversal:** двухуровневый JOIN без recursive CTE (`get_task_subgraph` RPC, §6.16).
Глубина 2 достаточна для MVP. Recursive CTE — при доказанной необходимости (>5k рёбер/workspace).

**Workspace Context Cache:** `workspace_context_cache` (§6.4) — derived cache второго уровня.
Пересобирается асинхронно через `enrichment_queue` при 5 типах событий (§6.16).
Невидим для пользователя. Улучшает качество F-03 и F-04 без action со стороны пользователя.
Ручное поле `workspace_context` остаётся нетронутым (INV-14).

**Путь миграции к entity_registry:** при появлении cross-entity traversal (документы → задачи
как структурные рёбра, workers → задачи через граф) `task_relations` мигрирует в
`entity_registry` + `knowledge_graph` за 2–3 дня. Сигналы перехода: Doc KB как источник задач,
>100k рёбер/workspace. Примечание по миграции — см. §6.16.

---

## 4. Единая модель Worker

### Принцип

Flow — диспетчерская для смешанных команд. **Worker = любой исполнитель.** Flow не знает разницы между человеком и агентом. Все ссылки на исполнителя (`assigned_to`, `reviewer_id`, `moved_by`) идут на `workers(id)`.

**Исключение:** `workspace_telegram_chats.linked_by → REFERENCES profiles(id)` — семантически это «администратор, подключивший чат», всегда человек.

### Таблица workers

```sql
CREATE TABLE workers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type         text CHECK (type IN ('human', 'agent')) NOT NULL,
  role         text CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  -- role: обязателен для type='human'; NULL для type='agent'.
  -- Смена role — только через service role. RLS запрещает самостоятельную смену (002_rls.sql).
  display_name text NOT NULL,
  source_id    text NOT NULL, -- profiles.id для human, 'agent::<name>' для agent
  -- profiles — public.profiles (§6.17), связывает Supabase Auth с onitask.
  -- workers.source_id = profiles.id::text для людей. Прямая JOIN с profiles
  -- используется только в INV-10 (workspace_telegram_chats.linked_by) —
  -- везде остальное идёт через workers(id).
  is_active    boolean DEFAULT true,
  created_at   timestamptz DEFAULT NOW(),
  UNIQUE (workspace_id, source_id)
);

CREATE INDEX idx_workers_workspace_id ON workers (workspace_id);
```

- Человек создаётся при добавлении в workspace
- Агент создаётся автоматически триггером при первом появлении в `agent_events`
- `is_active = false` — неактивные агенты скрыты из Worker Load, история сохраняется
- `display_name` агента не обновляется автоматически при смене `agent_name` (чтобы не ломать историю)

### Триггер автосоздания агента

```sql
CREATE OR REPLACE FUNCTION auto_create_agent_worker()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO workers (workspace_id, type, display_name, source_id)
  VALUES (
    NEW.workspace_id,
    'agent',
    NEW.agent_name,
    'agent::' || NEW.agent_name
  )
  ON CONFLICT (workspace_id, source_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_auto_create_agent_worker
AFTER INSERT ON agent_events
FOR EACH ROW EXECUTE FUNCTION auto_create_agent_worker();
```

### Иконки и атрибуты

| Атрибут | Человек | AI-агент |
|---|---|---|
| Иконка | Аватар (инициалы) | Ромб (◆) |
| source_id | profiles.id | 'agent::name' |
| Нагрузка | cognitive_weight задач | то же |
| Активность | ручные действия в TWA | agent_events |

---

## 5. Модель колонок и флаг is_inbox

### Четыре рабочих колонки + флаг `is_blocked`

```
backlog  |  in_progress  |  review  |  done
```

`is_blocked` — флаг `tasks.is_blocked`, **не отдельная колонка**.
Заблокированная задача остаётся в своей колонке.

### Флаг is_inbox

`tasks.is_inbox` (boolean, default false) — «задача упала автоматически, не размещена осознанно».

| Сценарий | column | is_inbox |
|---|---|---|
| F-04 Voice FAB | backlog | true |
| F-06 агент без явного column | backlog | true |
| F-06 агент с явным column | указанная | false |
| Ручное создание | выбранная | false |
| Любой явный move | без изменений | false (сбрасывается) |

### Секции TWA Stream

| Секция | DB Filter |
|---|---|
| Inbox | column = 'backlog' AND is_inbox = true |
| Focus | column = 'in_progress' (assigned_to = me) |
| На проверке | column = 'review' AND reviewer_id = me |
| Backlog | column = 'backlog' AND is_inbox = false (assigned_to = me) |

В Flow Board (kanban) `is_inbox` игнорируется.

### Логика создания задачи (TypeScript)

```typescript
const newTask = {
  column:   params.column ?? 'backlog',
  is_inbox: !params.column  // true только если колонка не указана явно
};

// При любом явном move:
await supabase
  .from('tasks')
  .update({ column: targetColumn, is_inbox: false })
  .eq('id', taskId);
```

---

## 6. Полная схема БД

> Единственный источник DDL-истины. Все Schema Delta из Feature-документов заменяются этим разделом.

### 6.1 Изменения существующих таблиц

```sql
-- tasks: обновлённые FK + новые поля
ALTER TABLE tasks
  ADD COLUMN is_inbox           boolean DEFAULT false,
  ADD COLUMN is_blocked         boolean DEFAULT false,
  ADD COLUMN cognitive_weight   int DEFAULT 1
             CHECK (cognitive_weight IN (0, 1, 2, 3)),
  ADD COLUMN deadline_urgency   text
             CHECK (deadline_urgency IN ('critical', 'normal')),
  ADD COLUMN moved_to_column_at timestamptz,
  ADD COLUMN reviewer_id        uuid REFERENCES workers(id),
  ADD COLUMN assigned_to        uuid REFERENCES workers(id),
  ADD COLUMN sprint_id          uuid REFERENCES sprints(id),
  ADD COLUMN needs_human        boolean DEFAULT false,
  ADD COLUMN escalation_reason  text
             CHECK (escalation_reason IN (
               'insufficient_context','conflicting_requirements',
               'blocked_by','out_of_scope'
             )),
  ADD COLUMN version            int NOT NULL DEFAULT 0,
  ADD COLUMN metadata           jsonb DEFAULT '{}',
  ADD COLUMN embedding          vector(1024),
  ADD COLUMN handoff_to         uuid REFERENCES workers(id),
  ADD COLUMN handoff_notes      text
             CHECK (char_length(handoff_notes) <= 1000),
  ADD COLUMN task_number        int,
  ADD COLUMN raw_input          text,
  ADD COLUMN clarity_score      float
             CHECK (clarity_score BETWEEN 0.0 AND 1.0),
  ADD COLUMN complexity         smallint
             CHECK (complexity BETWEEN 1 AND 3),
  ADD COLUMN enrichment_strategy text
             CHECK (enrichment_strategy IN ('skip', 'light', 'standard')),
  -- Кэш эмбеддингов (v0.13.2): пересчитывается только при изменении title/description.
  -- embedding_updated_at НЕ обновляется при cache-hit — намеренно (ai_.md §2.2).
  ADD COLUMN embedding_hash      text,
  ADD COLUMN embedding_updated_at timestamptz;

-- Триггер инвалидации кэша эмбеддинга (v0.13.2)
-- Срабатывает до trg_record_task_column_move (i < r, алфавитный порядок BEFORE-триггеров).
CREATE OR REPLACE FUNCTION invalidate_task_embedding()
RETURNS TRIGGER AS $$
BEGIN
  IF (OLD.title IS DISTINCT FROM NEW.title)
     OR (OLD.description IS DISTINCT FROM NEW.description) THEN
    NEW.embedding             := NULL;
    NEW.embedding_hash        := NULL;
    NEW.embedding_updated_at  := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_invalidate_task_embedding
BEFORE UPDATE ON tasks
FOR EACH ROW EXECUTE FUNCTION invalidate_task_embedding();

-- tasks: IVFFlat-индекс для RAG (A-4)
CREATE INDEX idx_tasks_embedding ON tasks
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Уникальность task_number в рамках workspace
CREATE UNIQUE INDEX idx_tasks_task_number
  ON tasks (workspace_id, task_number);

-- RPC для pgvector cosine similarity (используется F-03 §2.2)
CREATE OR REPLACE FUNCTION match_tasks(
  query_embedding  vector(1024),
  match_count      int,
  min_similarity   float,
  exclude_task_id  uuid,
  p_workspace_id   uuid
) RETURNS TABLE(task_id uuid, similarity float) AS $$
  SELECT id,
         1 - (embedding <=> query_embedding) AS similarity
  FROM tasks
  WHERE embedding IS NOT NULL
    AND id != exclude_task_id
    AND workspace_id = p_workspace_id
    AND 1 - (embedding <=> query_embedding) >= min_similarity
  ORDER BY similarity DESC
  LIMIT match_count;
$$ LANGUAGE sql STABLE;

-- tracker.columns
-- v0.13.3: FK изменён project_id → workspace_id (tracker.projects упразднён).
-- workspace = project в новой архитектуре. Полный CREATE для нового проекта.
-- 4 дефолтные колонки создаются триггером trg_init_workspace_columns (см. ниже).
CREATE TABLE tracker.columns (
  id            uuid   PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid   NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name          text   NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  system_status text,
  wip_limit     int,
  position      float8 NOT NULL DEFAULT 65536.0,
  color         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_columns_workspace ON tracker.columns (workspace_id);
CREATE INDEX idx_columns_position  ON tracker.columns (workspace_id, position);

-- Автосид 4 дефолтных колонок при создании workspace.
-- WIP-лимиты: backlog=15, in_progress=5, review=4, done=без лимита.
CREATE OR REPLACE FUNCTION init_workspace_columns()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO tracker.columns (workspace_id, name, system_status, wip_limit, position)
  VALUES
    (NEW.id, 'backlog',     'backlog',     15,   1.0),
    (NEW.id, 'in_progress', 'in_progress', 5,    2.0),
    (NEW.id, 'review',      'review',      4,    3.0),
    (NEW.id, 'done',        'done',        NULL, 4.0);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_init_workspace_columns
AFTER INSERT ON workspaces
FOR EACH ROW EXECUTE FUNCTION init_workspace_columns();

-- agent_events: расширение CHECK + новые поля
ALTER TABLE agent_events
  DROP CONSTRAINT agent_events_tool_check,
  ADD CONSTRAINT agent_events_tool_check
    CHECK (tool IN (
      'create_task','get_tasks_by_column','move_task',
      'escalate_task','bot_command','send_message_to_chat','undo',
      'handoff_task'
    ));
```

### 6.2 Спринты

```sql
CREATE TABLE sprints (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         text,
  start_date   date NOT NULL,
  end_date     date NOT NULL,
  capacity     int,
  status       text CHECK (status IN ('planning','active','completed')) DEFAULT 'planning',
  created_at   timestamptz DEFAULT NOW()
);

CREATE INDEX idx_sprints_workspace_id ON sprints (workspace_id);
```

### 6.3 История перемещений задач

```sql
CREATE TABLE task_column_history (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id      uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  from_column  text,
  to_column    text NOT NULL,
  moved_by     uuid REFERENCES workers(id),
  task_version int,
  metadata     jsonb,
  moved_at     timestamptz DEFAULT NOW()
);

CREATE INDEX idx_task_column_history_task_id ON task_column_history (task_id);
CREATE INDEX idx_task_column_history_moved_at ON task_column_history (moved_at);
CREATE INDEX idx_task_column_history_rework
  ON task_column_history (task_id, moved_at, from_column, to_column);

CREATE OR REPLACE FUNCTION record_task_column_move()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.column IS DISTINCT FROM NEW.column THEN
    INSERT INTO task_column_history (task_id, from_column, to_column, task_version)
    VALUES (NEW.id, OLD.column, NEW.column, NEW.version);
    NEW.moved_to_column_at := NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_record_task_column_move
BEFORE UPDATE ON tasks
FOR EACH ROW EXECUTE FUNCTION record_task_column_move();
```

> `moved_by` заполняется Route Handler в `task_column_history` отдельным UPDATE после INSERT.
> Known narrow-window race condition (Medium, принятый осознанно). При race condition `moved_by`
> может быть NULL — аналитика слегка занижена, бизнес-логика не затронута.

### 6.4 Настройки воркспейса

```sql
CREATE TABLE workspace_settings (
  workspace_id                  uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  enable_cognitive_budget       boolean DEFAULT true,
  story_points_config           jsonb   DEFAULT '{"enabled": false}',
  velocity_window_days          int     DEFAULT 14,
  flow_config                   jsonb   DEFAULT '{}',
  realtime_subscription_level   text    DEFAULT 'own_tasks'
                                CHECK (realtime_subscription_level IN ('own_tasks','all')),
  workspace_context             text    CHECK (char_length(workspace_context) <= 800),
  -- Ручной текст Admin/Owner: команда, домен, стек, специфика задач.
  -- Редактируется ТОЛЬКО Admin/Owner. НЕ перезаписывается системой (INV-14).
  workspace_context_cache       text    CHECK (char_length(workspace_context_cache) <= 500),
  -- Derived cache второго уровня (A-12, INV-14).
  -- Auto-generated: текущий спринт, топ блокировки, перегруженные, эскалации, тренд velocity.
  -- Генерируется NeuralDeep GPT-OSS-120B через enrichment_queue (type='workspace_context_rebuild').
  -- NULL = кэш ещё не собран (новый workspace или первый rebuild ещё в очереди).
  -- НЕ редактируется пользователем. НЕ показывается в UI.
  -- F-03 и F-04 получают ОБА поля: workspace_context + workspace_context_cache.
  context_stale                 boolean DEFAULT false,
  -- true = произошло значимое событие, кэш устарел, rebuild в очереди (trg_context_invalidate).
  -- Сбрасывается в false после успешного rebuild Edge Function'ом.
  -- Возвращается в MCP get_workspace_settings (context_stale: boolean).
  standup_config                jsonb   DEFAULT '{
    "enabled":  false,
    "time_utc": "07:00",
    "chat_id":  null
  }',
  doc_kb_config                 jsonb   DEFAULT '{
    "enabled":         true,
    "max_file_bytes":  524288,
    "max_total_bytes": 5242880,
    "max_files":       20
  }',
  f04_config                    jsonb   DEFAULT '{
    "skip_min_clarity":                   0.85,
    "skip_max_complexity":                1,
    "correction_sheet_clarity_threshold": 0.70,
    "low_clarity_tag_threshold":          0.55
  }',
  quota_config                  jsonb   DEFAULT '{
    "agent_reserved_pct": 60,
    "human_min_pct":      40
  }',
  data_sharing_level            text    DEFAULT 'standard'
                                CHECK (data_sharing_level IN ('minimal', 'standard', 'full')),
  -- Уровень изоляции данных при передаче внешним LLM-провайдерам (INV-15).
  -- Три уровня (подробнее — onitask_security_.md §2.1):
  --
  -- 'minimal' — минимум данных для жизнеспособного результата:
  --   В промпт уходят: task.title/description, workspace_context, complexity/priority/tags,
  --   subgraph task_relations, top-3 related tasks (без avg_completion_days),
  --   workspace_context_cache только агрегаты без display_name (например: «2 эскалации, 1 перегружен»),
  --   worker display_names для F-04 assignee matching (функциональная необходимость).
  --   НЕ передаются: doc_chunks content, agent_memory summaries, assignment_history,
  --   avg_completion_days. Качество: хорошее (ai_hint доменный, SP без исторической калибровки).
  --
  -- 'standard' (DEFAULT) — максимум без ограничений, текущее поведение системы:
  --   Всё из 'minimal' плюс: workspace_context_cache полный (с display_names как usernames),
  --   top-5 related tasks + avg_completion_days, assignment_history (псевдонимизированные UUID,
  --   GDPR Recital 26), doc_chunks content (similarity >= 0.68), agent_memory summaries.
  --   DPA не требуется. Backward compatible — все существующие workspace на этом уровне.
  --
  -- 'full' — полный комплект, требует DPA (INV-15):
  --   Всё из 'standard' плюс: doc RAG без порога similarity (все чанки всех документов
  --   независимо от релевантности). Риск IP: проприетарная документация без фильтрации.
  --   Требует подписанного DPA с NeuralDeep Hub. Активируется только Admin/Owner осознанно.

  mcp_api_keys                  jsonb   DEFAULT '{}',
  -- Матрица полномочий API-ключей агентов.
  -- Структура: { "<key_hash_sha256>": { ...KeyConfig } }
  -- KeyConfig (все поля опциональны):
  --   allowed_tools:          string[] | "all"  — список разрешённых MCP tools.
  --                           "all" или отсутствие ключа = все инструменты разрешены.
  --   can_send_messages:      boolean            — доступ к send_message_to_chat (default true).
  --   max_tasks_per_minute:   number             — rate limit создания задач (default 50).
  --                           50/min = потолок против DoS; не режет легитимный onboarding.
  --                           Измеряется per agent per workspace (rolling window 60s).
  -- Пустой объект {} = legacy mode: все инструменты разрешены для всех ключей.
  -- Гарантирует backward compatibility: существующие интеграции Cursor/Claude Code
  -- продолжают работать без изменений до явной настройки Admin/Owner.
  -- Подробнее: onitask_security_.md §3.1.

  updated_at                    timestamptz DEFAULT NOW()
);

-- Миграция для существующей таблицы:
ALTER TABLE workspace_settings
  ADD COLUMN workspace_context text
    CHECK (char_length(workspace_context) <= 800),
  ADD COLUMN workspace_context_cache text
    CHECK (char_length(workspace_context_cache) <= 500),
  ADD COLUMN context_stale boolean DEFAULT false,
  ADD COLUMN standup_config jsonb DEFAULT '{
    "enabled":  false,
    "time_utc": "07:00",
    "chat_id":  null
  }',
  ADD COLUMN doc_kb_config jsonb DEFAULT '{
    "enabled":         true,
    "max_file_bytes":  524288,
    "max_total_bytes": 5242880,
    "max_files":       20
  }',
  ADD COLUMN f04_config jsonb DEFAULT '{
    "skip_min_clarity":                   0.85,
    "skip_max_complexity":                1,
    "correction_sheet_clarity_threshold": 0.70,
    "low_clarity_tag_threshold":          0.55
  }',
  ADD COLUMN quota_config jsonb DEFAULT '{
    "agent_reserved_pct": 60,
    "human_min_pct":      40
  }',
  ADD COLUMN data_sharing_level text DEFAULT 'standard'
    CHECK (data_sharing_level IN ('minimal', 'standard', 'full')),
  ADD COLUMN mcp_api_keys jsonb DEFAULT '{}';
```

### 6.5 Очередь Cold Path

```sql
CREATE TABLE enrichment_queue (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type         text CHECK (type IN (
                 'card',
                 'suggestion',
                 'flow_alert',
                 'bot_notify',
                 'duplicate_check',
                 'doc_process',
                 'workspace_context_rebuild'   -- добавлен в v0.12.0
               )),
  payload      jsonb,
  status       text DEFAULT 'pending'
               CHECK (status IN ('pending','processing','done','failed')),
  scheduled_at timestamptz DEFAULT NOW(),
  created_at   timestamptz DEFAULT NOW(),
  processed_at timestamptz,
  locked_at    timestamptz
);

-- Индексы
CREATE INDEX idx_enrichment_queue_scheduled
  ON enrichment_queue (scheduled_at)
  WHERE status = 'pending';

CREATE INDEX idx_enrichment_queue_workspace
  ON enrichment_queue (workspace_id, status, scheduled_at)
  WHERE status = 'pending';

-- UNIQUE-индекс дедупликации заданий duplicate_check:
CREATE UNIQUE INDEX idx_enrichment_queue_dedup_duplicate
  ON enrichment_queue (workspace_id, (payload->>'task_id'))
  WHERE type = 'duplicate_check' AND status = 'pending';

-- UNIQUE-индекс дедупликации workspace_context_rebuild (один pending на workspace):
-- Добавлен в v0.12.0
CREATE UNIQUE INDEX idx_enrichment_queue_dedup_context_rebuild
  ON enrichment_queue (workspace_id)
  WHERE type = 'workspace_context_rebuild' AND status = 'pending';
```

**Приоритет в воркере `enrichment_queue` (обновлён в v0.12.0):**

```sql
SELECT * FROM enrichment_queue
WHERE status = 'pending' AND scheduled_at <= NOW()
ORDER BY
  CASE
    WHEN type = 'card'                       THEN 1  -- обогащение задач: наивысший приоритет
    WHEN type = 'workspace_context_rebuild'  THEN 2  -- контекст команды: выше doc_process
    WHEN type = 'doc_process'                THEN 3  -- чанкование документов: фоновый
    ELSE 4
  END,
  created_at ASC
FOR UPDATE SKIP LOCKED
LIMIT 1;
```

### 6.6 Обогащение задач (F-03 output)

```sql
CREATE TABLE task_enrichments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id            uuid REFERENCES tasks(id) ON DELETE CASCADE UNIQUE,
  workspace_id       uuid NOT NULL,
  anomaly            jsonb,
  ai_hint            text,
  cognitive_weight   int CHECK (cognitive_weight IN (1, 2, 3)),
  story_points       int,
  sp_estimation_type text CHECK (sp_estimation_type IN ('hours','days','abstract')),
  suggested_tags     text[],
  enrichment_status  text DEFAULT 'pending'
                     CHECK (enrichment_status IN
                       ('pending','processing','done','failed','stale')),
  enrichment_notes   text,
  model_used         text,
  enriched_at        timestamptz,
  failed_at          timestamptz,
  attempts           int DEFAULT 0,
  last_attempt_at    timestamptz,
  requested_at       timestamptz
);
```

**Миграция для существующей таблицы:**

```sql
ALTER TABLE task_enrichments
  DROP COLUMN IF EXISTS enrichment,
  DROP COLUMN IF EXISTS progress_estimate,
  DROP COLUMN IF EXISTS sp_raw_estimate,
  DROP COLUMN IF EXISTS suggested_column;
```

### 6.7 Агентные события

```sql
CREATE TABLE agent_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  tool         text CHECK (tool IN (
                 'create_task','get_tasks_by_column','move_task',
                 'escalate_task','bot_command','send_message_to_chat','undo',
                 'handoff_task'
               )),
  agent_name   text,
  task_id      uuid REFERENCES tasks(id) ON DELETE SET NULL,
  summary      text,
  metadata     jsonb,
  state_before jsonb,
  created_at   timestamptz DEFAULT NOW()
);
-- Retention: 7 дней (GC job)
```

### 6.8 Долговременная память агента

```sql
CREATE TABLE agent_memory (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  task_id      uuid REFERENCES tasks(id) ON DELETE CASCADE,
  summary_text text,
  embedding    vector(1024),
  period_start timestamptz,
  period_end   timestamptz,
  created_at   timestamptz DEFAULT NOW()
);

CREATE INDEX ON agent_memory
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 50);

CREATE OR REPLACE FUNCTION match_agent_memory(
  query_embedding  vector(1024),
  match_count      int,
  min_similarity   float,
  p_workspace_id   uuid
) RETURNS TABLE(
  memory_id    uuid,
  task_id      uuid,
  summary_text text,
  similarity   float,
  period_start timestamptz
) AS $$
  SELECT
    id,
    task_id,
    summary_text,
    1 - (embedding <=> query_embedding) AS similarity,
    period_start
  FROM agent_memory
  WHERE workspace_id = p_workspace_id
    AND 1 - (embedding <=> query_embedding) >= min_similarity
  ORDER BY similarity DESC
  LIMIT match_count;
$$ LANGUAGE sql STABLE;
```

### 6.9 Telegram-чаты воркспейса

```sql
CREATE TABLE workspace_telegram_chats (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  chat_id               bigint NOT NULL,
  title                 text,
  is_active             boolean DEFAULT true,
  notification_settings jsonb DEFAULT '{
    "on_inbox_move": false,
    "on_overload":   false,
    "quiet_hours":   []
  }',
  linked_by             uuid REFERENCES profiles(id),  -- INV-10
  linked_at             timestamptz DEFAULT NOW(),
  UNIQUE (workspace_id, chat_id)
);
```

### 6.10 История задач (Memory Consolidation source)

```sql
CREATE TABLE task_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  task_id      uuid REFERENCES tasks(id) ON DELETE CASCADE,
  event_type   text,
  -- 'status_change' | 'comment' | 'assignment' | 'enrichment' | 'parse_rewrite'
  payload      jsonb,
  consolidated boolean DEFAULT false,
  created_at   timestamptz DEFAULT NOW()
);

CREATE INDEX idx_task_events_task_id      ON task_events (task_id);
CREATE INDEX idx_task_events_consolidated ON task_events (consolidated, created_at)
  WHERE consolidated = false;
```

### 6.11 Вспомогательные таблицы

```sql
CREATE TABLE consolidation_errors (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_event_id uuid,
  error_message text,
  created_at    timestamptz DEFAULT NOW()
);
```

### 6.12 Нумерация задач (Task ID)

```sql
ALTER TABLE workspaces
  ADD COLUMN task_prefix text
    CHECK (task_prefix ~ '^[A-Z]{2,6}$');

CREATE UNIQUE INDEX idx_workspaces_task_prefix
  ON workspaces (task_prefix);

CREATE OR REPLACE FUNCTION prevent_task_prefix_update()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.task_prefix IS NOT NULL AND NEW.task_prefix != OLD.task_prefix THEN
    RAISE EXCEPTION
      'task_prefix is immutable after creation. '
      'Changing it would invalidate all existing task references.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_task_prefix_update
BEFORE UPDATE ON workspaces
FOR EACH ROW EXECUTE FUNCTION prevent_task_prefix_update();

CREATE TABLE workspace_task_counters (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  last_number  int  NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION init_task_counter()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO workspace_task_counters (workspace_id, last_number)
  VALUES (NEW.id, 0)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_init_task_counter
AFTER INSERT ON workspaces
FOR EACH ROW EXECUTE FUNCTION init_task_counter();

CREATE OR REPLACE FUNCTION next_task_number(p_workspace_id uuid)
RETURNS int AS $$
DECLARE
  v_next int;
BEGIN
  UPDATE workspace_task_counters
  SET    last_number = last_number + 1
  WHERE  workspace_id = p_workspace_id
  RETURNING last_number INTO v_next;

  IF v_next IS NULL THEN
    RAISE EXCEPTION 'Task counter not found for workspace %', p_workspace_id;
  END IF;

  RETURN v_next;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION assign_task_number()
RETURNS TRIGGER AS $$
BEGIN
  NEW.task_number := next_task_number(NEW.workspace_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_assign_task_number
BEFORE INSERT ON tasks
FOR EACH ROW EXECUTE FUNCTION assign_task_number();

CREATE OR REPLACE FUNCTION task_full_id(p_task_id uuid)
RETURNS text AS $$
  SELECT w.task_prefix || '-' || t.task_number::text
  FROM tasks t
  JOIN workspaces w ON w.id = t.workspace_id
  WHERE t.id = p_task_id;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION find_task_by_full_id(p_full_id text)
RETURNS uuid AS $$
DECLARE
  v_prefix text;
  v_number int;
BEGIN
  v_prefix := split_part(p_full_id, '-', 1);
  v_number := split_part(p_full_id, '-', 2)::int;

  RETURN (
    SELECT t.id
    FROM tasks t
    JOIN workspaces w ON w.id = t.workspace_id
    WHERE w.task_prefix = v_prefix
      AND t.task_number = v_number
  );
END;
$$ LANGUAGE plpgsql STABLE;
```

### 6.13 Project Knowledge Base (Doc RAG)

```sql
CREATE TABLE workspace_documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  filename     text NOT NULL,
  file_type    text CHECK (file_type IN ('markdown', 'text')),
  size_bytes   int  NOT NULL,
  checksum     text NOT NULL,
  chunk_count  int  NOT NULL DEFAULT 0,
  status       text DEFAULT 'processing'
               CHECK (status IN ('processing', 'ready', 'failed')),
  uploaded_by  uuid REFERENCES workers(id),
  created_at   timestamptz DEFAULT NOW()
);

CREATE TABLE workspace_doc_chunks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id  uuid NOT NULL REFERENCES workspace_documents(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  chunk_index  int  NOT NULL,
  content      text NOT NULL,
  meta_headers jsonb,
  embedding    vector(1024),
  created_at   timestamptz DEFAULT NOW()
);

CREATE INDEX idx_doc_chunks_embedding ON workspace_doc_chunks
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 10);

CREATE INDEX idx_doc_chunks_workspace ON workspace_doc_chunks (workspace_id);

CREATE OR REPLACE FUNCTION match_doc_chunks(
  query_embedding  vector(1024),
  match_count      int,
  min_similarity   float,
  p_workspace_id   uuid
) RETURNS TABLE(
  chunk_id     uuid,
  content      text,
  similarity   float,
  filename     text,
  meta_headers jsonb
) AS $$
  SELECT
    c.id,
    c.content,
    1 - (c.embedding <=> query_embedding) AS similarity,
    d.filename,
    c.meta_headers
  FROM workspace_doc_chunks c
  JOIN workspace_documents d ON d.id = c.document_id
  WHERE c.workspace_id = p_workspace_id
    AND d.status = 'ready'
    AND 1 - (c.embedding <=> query_embedding) >= min_similarity
  ORDER BY similarity DESC
  LIMIT match_count;
$$ LANGUAGE sql STABLE;
```

### 6.14 История назначений (Assignment Risk — Контур 1 + Контур 2)

```sql
CREATE TABLE assignment_history (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id             uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- CASCADE: аналитический датасет конкретного workspace. Без workspace бессмысленен.
  task_id                  uuid REFERENCES tasks(id)   ON DELETE SET NULL,
  assignee_id              uuid REFERENCES workers(id) ON DELETE SET NULL,
  assigned_by              uuid REFERENCES workers(id) ON DELETE SET NULL,
  snapshot_attention_risk  int,
  snapshot_active_tasks    int,
  snapshot_context_switches int,
  snapshot_blocked_tasks   int,
  snapshot_review_tasks    int,
  snapshot_critical_tasks  int,
  outcome_status           text DEFAULT 'pending'
                           CHECK (outcome_status IN (
                             'pending',
                             'completed_on_time',
                             'deadline_missed',
                             'reassigned',
                             'returned_from_review',
                             'escalated'
                           )),
  assigned_at              timestamptz DEFAULT NOW(),
  resolved_at              timestamptz,
  created_at               timestamptz DEFAULT NOW()
);

CREATE INDEX idx_assignment_history_workspace
  ON assignment_history (workspace_id);
CREATE INDEX idx_assignment_history_assignee
  ON assignment_history (assignee_id, assigned_at DESC);
CREATE INDEX idx_assignment_history_task
  ON assignment_history (task_id);
CREATE INDEX idx_assignment_history_pending
  ON assignment_history (workspace_id, outcome_status)
  WHERE outcome_status = 'pending';

CREATE OR REPLACE FUNCTION record_assignment_snapshot()
RETURNS TRIGGER AS $$
DECLARE
  v_risk      int;
  v_active    int;
  v_switches  int;
  v_blocked   int;
  v_review    int;
  v_critical  int;
BEGIN
  IF NEW.assigned_to IS NOT NULL
     AND (OLD.assigned_to IS DISTINCT FROM NEW.assigned_to) THEN

    SELECT
      attention_risk_score,
      active_tasks,
      context_switches_today,
      blocked_tasks,
      review_tasks,
      critical_deadline_tasks
    INTO v_risk, v_active, v_switches, v_blocked, v_review, v_critical
    FROM attention_risk_pulse
    WHERE worker_id    = NEW.assigned_to
      AND workspace_id = NEW.workspace_id;

    INSERT INTO assignment_history (
      workspace_id, task_id, assignee_id,
      snapshot_attention_risk, snapshot_active_tasks,
      snapshot_context_switches, snapshot_blocked_tasks,
      snapshot_review_tasks, snapshot_critical_tasks
    ) VALUES (
      NEW.workspace_id, NEW.id, NEW.assigned_to,
      v_risk, v_active, v_switches, v_blocked, v_review, v_critical
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_record_assignment_snapshot
BEFORE UPDATE OF assigned_to ON tasks
FOR EACH ROW EXECUTE FUNCTION record_assignment_snapshot();
```

### 6.15 Внешние ссылки: VIEW attention_risk_pulse

VIEW `attention_risk_pulse` — полный DDL в `onitask_sql_anomalies_.md` §3.9.
Читается триггером `trg_record_assignment_snapshot` (§6.14) и Route Handler при pre-flight проверке.

### 6.16 Relational Context Layer

> Добавлен в v0.12.0. Реализует A-12.
> Операционное расширение (VIEW orphan_blockers, trg_handoff_chain_alert) — см. `onitask_sql_anomalies_.md` §3.10, §5.7.

```sql
-- ═══════════════════════════════════════════════════════
-- ТАБЛИЦА task_relations
-- ═══════════════════════════════════════════════════════

CREATE TABLE task_relations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- INV-13: передавать явно при каждом INSERT
  from_task_id   uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  to_task_id     uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  relation_type  text NOT NULL
                 CHECK (relation_type IN ('blocks', 'spawned_from', 'mentions')),
  weight         float NOT NULL
                 CHECK (weight BETWEEN 0.0 AND 1.0),
  -- Канонические веса (A-12, иммутабельны):
  --   blocks       = 1.0
  --   spawned_from = 0.8
  --   mentions     = 0.3 (Phase 1.1)
  -- Изменение весов = изменение аксиомы A-12, не просто UPDATE
  created_by     uuid REFERENCES workers(id) ON DELETE SET NULL,
  -- NULL = создано автоматически (Route Handler, триггер)
  created_at     timestamptz DEFAULT NOW(),
  UNIQUE (from_task_id, to_task_id, relation_type)
  -- Дубли по одному типу отношений недопустимы
);

-- Индексы
CREATE INDEX idx_task_relations_from
  ON task_relations (from_task_id);

CREATE INDEX idx_task_relations_to
  ON task_relations (to_task_id);

CREATE INDEX idx_task_relations_workspace
  ON task_relations (workspace_id);

CREATE INDEX idx_task_relations_blocks
  ON task_relations (relation_type, workspace_id)
  WHERE relation_type = 'blocks';
  -- Частичный индекс: 'blocks' — горячий путь для
  -- cascade_unblock, orphan_blocker, smart backlog


-- ═══════════════════════════════════════════════════════
-- RPC: get_task_subgraph
-- Двухуровневый JOIN — без recursive CTE (A-12).
-- Используется F-03 (ai_.md §2.2) и MCP get_task_context (mcp_contract_.md §4).
-- Fallback: если рёбер нет — F-03 использует match_tasks() как раньше.
-- ═══════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_task_subgraph(
  p_task_id      uuid,
  p_workspace_id uuid
) RETURNS TABLE(
  from_task_id   uuid,
  to_task_id     uuid,
  relation_type  text,
  weight         float,
  depth          int
) AS $$
  -- Глубина 1: все прямые связи задачи
  SELECT
    tr.from_task_id,
    tr.to_task_id,
    tr.relation_type,
    tr.weight,
    1 AS depth
  FROM task_relations tr
  WHERE (tr.from_task_id = p_task_id OR tr.to_task_id = p_task_id)
    AND tr.workspace_id = p_workspace_id

  UNION ALL

  -- Глубина 2: только 'blocks' от прямых соседей
  -- mentions и spawned_from на глубине 2 создают шум без ценности
  SELECT
    tr2.from_task_id,
    tr2.to_task_id,
    tr2.relation_type,
    tr2.weight,
    2 AS depth
  FROM task_relations tr
  JOIN task_relations tr2
    ON (tr2.from_task_id = tr.to_task_id OR tr2.to_task_id = tr.from_task_id)
  WHERE (tr.from_task_id = p_task_id OR tr.to_task_id = p_task_id)
    AND tr.workspace_id  = p_workspace_id
    AND tr2.workspace_id = p_workspace_id
    AND tr2.relation_type = 'blocks'
    AND tr2.from_task_id != p_task_id
    AND tr2.to_task_id   != p_task_id;
$$ LANGUAGE sql STABLE;

-- tenant isolation: p_workspace_id обязателен (A-7)


-- ═══════════════════════════════════════════════════════
-- ТРИГГЕР: trg_cascade_unblock
-- AFTER UPDATE OF column ON tasks.
-- При переходе задачи в done — снимает is_blocked с задач,
-- у которых эта задача была единственным блокером,
-- и ставит cascade_unblock уведомление в enrichment_queue.
-- ═══════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION cascade_unblock()
RETURNS TRIGGER AS $$
DECLARE
  v_unblocked_ids uuid[];
BEGIN
  IF NEW.column = 'done' AND OLD.column != 'done' THEN

    -- Найти задачи, которые ждали именно эту задачу
    -- и не имеют других незавершённых блокеров
    WITH newly_unblocked AS (
      SELECT tr.to_task_id
      FROM task_relations tr
      WHERE tr.from_task_id  = NEW.id
        AND tr.relation_type = 'blocks'
        AND tr.workspace_id  = NEW.workspace_id
        -- Проверяем: нет других активных блокеров для той же задачи
        AND NOT EXISTS (
          SELECT 1
          FROM task_relations tr2
          JOIN tasks t2 ON t2.id = tr2.from_task_id
          WHERE tr2.to_task_id    = tr.to_task_id
            AND tr2.relation_type = 'blocks'
            AND tr2.from_task_id != NEW.id
            AND t2.column        != 'done'
        )
    ),
    updated AS (
      UPDATE tasks
      SET is_blocked = false
      WHERE id = ANY(SELECT to_task_id FROM newly_unblocked)
        AND is_blocked = true
      RETURNING id
    )
    SELECT array_agg(id) INTO v_unblocked_ids FROM updated;

    -- Уведомление только если реально разблокировали хотя бы одну задачу
    IF v_unblocked_ids IS NOT NULL AND array_length(v_unblocked_ids, 1) > 0 THEN
      INSERT INTO enrichment_queue (
        workspace_id, type, payload, status, scheduled_at
      ) VALUES (
        NEW.workspace_id,
        'bot_notify',
        jsonb_build_object(
          'workspace_id',       NEW.workspace_id,
          'alert_type',         'cascade_unblock',
          'completed_task_id',  NEW.id,
          'unblocked_task_ids', to_jsonb(v_unblocked_ids)
        ),
        'pending',
        NOW()
      );
    END IF;

  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_cascade_unblock
AFTER UPDATE OF column ON tasks
FOR EACH ROW
EXECUTE FUNCTION cascade_unblock();


-- ═══════════════════════════════════════════════════════
-- ТРИГГЕР: trg_context_invalidate
-- 5 типов событий → context_stale = true + rebuild в enrichment_queue.
-- Использует ON CONFLICT DO NOTHING + UNIQUE-индекс §6.5
-- для дедупликации (один pending rebuild на workspace).
-- ═══════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION context_invalidate()
RETURNS TRIGGER AS $$
BEGIN
  -- Событие на tasks: эскалация, handoff, критичная задача
  IF TG_TABLE_NAME = 'tasks' THEN
    IF (NEW.needs_human IS DISTINCT FROM OLD.needs_human AND NEW.needs_human = true)
    OR (NEW.handoff_to  IS DISTINCT FROM OLD.handoff_to  AND NEW.handoff_to IS NOT NULL)
    OR (NEW.priority    IS DISTINCT FROM OLD.priority    AND NEW.priority = 'critical')
    THEN
      UPDATE workspace_settings
        SET context_stale = true
        WHERE workspace_id = NEW.workspace_id;

      INSERT INTO enrichment_queue (
        workspace_id, type, payload, status, scheduled_at
      ) VALUES (
        NEW.workspace_id,
        'workspace_context_rebuild',
        jsonb_build_object('workspace_id', NEW.workspace_id),
        'pending',
        NOW()
      )
      ON CONFLICT DO NOTHING;
      -- ON CONFLICT опирается на idx_enrichment_queue_dedup_context_rebuild (§6.5)
    END IF;
  END IF;

  -- Событие на sprints: переход в active или completed
  IF TG_TABLE_NAME = 'sprints' THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NEW.status IN ('active', 'completed')
    THEN
      UPDATE workspace_settings
        SET context_stale = true
        WHERE workspace_id = NEW.workspace_id;

      INSERT INTO enrichment_queue (
        workspace_id, type, payload, status, scheduled_at
      ) VALUES (
        NEW.workspace_id,
        'workspace_context_rebuild',
        jsonb_build_object('workspace_id', NEW.workspace_id),
        'pending',
        NOW()
      )
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_context_invalidate_tasks
AFTER UPDATE OF needs_human, handoff_to, priority ON tasks
FOR EACH ROW
EXECUTE FUNCTION context_invalidate();

CREATE TRIGGER trg_context_invalidate_sprints
AFTER UPDATE OF status ON sprints
FOR EACH ROW
EXECUTE FUNCTION context_invalidate();


-- ═══════════════════════════════════════════════════════
-- Phase 1.1 PLACEHOLDER: trg_mentions_parse
-- Парсинг ALPHA-N в tasks.description → ребро 'mentions' (weight=0.3).
-- НЕ активировать на MVP. DDL не депроектируется — только placeholder.
-- Условие активации: стабилизация task_relations + >30 done задач/workspace.
-- ═══════════════════════════════════════════════════════
-- (реализация в Phase 1.1)


-- ═══════════════════════════════════════════════════════
-- Примечание о пути миграции к entity_registry (A-12)
-- ═══════════════════════════════════════════════════════
-- Сигналы перехода:
--   1. Doc KB становится источником задач (структурные рёбра doc→task)
--   2. COUNT(task_relations) > 100k в любом workspace
--
-- При наступлении сигнала — выполнить последовательно:
--
-- Шаг 1: CREATE TABLE entity_registry (
--   id uuid PK, workspace_id uuid NOT NULL,
--   entity_type text CHECK (...), source_id uuid NOT NULL,
--   display_name text, metadata jsonb,
--   UNIQUE (workspace_id, entity_type, source_id)
-- )
--
-- Шаг 2: INSERT INTO entity_registry
-- SELECT gen_random_uuid(), workspace_id, 'task', id, title, '{}'
-- FROM tasks -- покрывает все from_task_id и to_task_id из task_relations
--
-- Шаг 3: CREATE TABLE knowledge_graph (
--   id uuid PK, workspace_id uuid NOT NULL,
--   from_entity uuid REFERENCES entity_registry(id) ON DELETE CASCADE,
--   to_entity   uuid REFERENCES entity_registry(id) ON DELETE CASCADE,
--   relation_type text, weight float, created_at timestamptz
-- )
--
-- Шаг 4: INSERT INTO knowledge_graph
-- SELECT gen_random_uuid(), tr.workspace_id,
--        e1.id, e2.id, tr.relation_type, tr.weight, tr.created_at
-- FROM task_relations tr
-- JOIN entity_registry e1 ON e1.source_id = tr.from_task_id AND e1.entity_type = 'task'
-- JOIN entity_registry e2 ON e2.source_id = tr.to_task_id   AND e2.entity_type = 'task'
--
-- Шаг 5: task_relations → deprecated (переключить триггеры и RPC на knowledge_graph)
--
-- Оценка: 2–3 дня при соблюдении INV-13 (workspace_id явно везде)
-- и неизменности relation_type шкалы весов (A-12 иммутабельна).
```

---

## 7. Контракт конкурентности и идемпотентности

### 7.1 Оптимистичная блокировка задач (version)

```sql
CREATE INDEX CONCURRENTLY idx_tasks_version ON tasks (id, version);
```

```typescript
const result = await supabase
  .from('tasks')
  .update({ ...changes, version: currentVersion + 1 })
  .eq('id', taskId)
  .eq('version', currentVersion)
  .select('id')
  .single();

if (!result.data) {
  return Response.json({ error: 'version_conflict' }, { status: 409 });
}
```

### 7.2 Идемпотентность обогащения (F-03)

```typescript
const requestedAt = new Date().toISOString();
await supabase.from('task_enrichments')
  .upsert({ task_id: taskId, requested_at: requestedAt, enrichment_status: 'processing' });

const { data: current } = await supabase
  .from('tasks').select('updated_at').eq('id', taskId).single();

if (current.updated_at > requestedAt) {
  await supabase.from('task_enrichments')
    .update({ enrichment_status: 'stale', enrichment_notes: 'conflict: task updated during enrichment' })
    .eq('task_id', taskId);
  await scheduleEnrichment(taskId, 0);
  return;
}

await upsertEnrichment(taskId, { ...result, enrichment_status: 'done' });
```

### 7.3 Retry (Exponential Backoff)

```typescript
const BACKOFF = [0, 5 * 60, 30 * 60]; // сразу, +5мин, +30мин

async function scheduleEnrichment(taskId: string, attempt: number, workspaceId: string) {
  const delaySeconds = BACKOFF[attempt] ?? 30 * 60;
  await supabase.from('enrichment_queue').insert({
    workspace_id: workspaceId,
    type: 'card',
    payload: { task_id: taskId },
    status: 'pending',
    scheduled_at: new Date(Date.now() + delaySeconds * 1000).toISOString()
  });
}
```

### 7.4 Защита от дублирования уведомлений

Rate limit: 1 алерт на событие / 2 часа / workspace. Реализуется через `enrichment_queue` с проверкой `scheduled_at` последней записи.

---

## 8. Настройки воркспейса

Единственный источник правды для всех модулей. Читается в:
- **F-01** — `enable_cognitive_budget`, `story_points_config`
- **F-03** — `story_points_config`, `workspace_context`, `workspace_context_cache`,
            `doc_kb_config`, `data_sharing_level`
- **F-04** — `workspace_context`, `workspace_context_cache`, `f04_config`,
            `enable_cognitive_budget`, `story_points_config`, `data_sharing_level`
- **Flow Board** — `flow_config`
- **Team Tab** — `velocity_window_days`
- **Realtime** — `realtime_subscription_level`
- **Bot** — `standup_config`
- **MCP** — `workspace_context`, `workspace_context_cache`, `context_stale`,
           `mcp_api_keys`, `data_sharing_level` (через `get_workspace_settings`)
- **Doc KB** — `doc_kb_config`
- **Atomic Quota RPC** — `quota_config`
- **Security Layer** — `mcp_api_keys` (allowed_tools enforcement, rate limiting),
                       `data_sharing_level` (LLM data isolation per уровень)

**Расширение настроек:** через ALTER TABLE или в существующие jsonb-блоки. Никогда не хардкодить пороги в коде.

Структура `flow_config`:
```json
{ "stuck_threshold_hours": 72, "overload_threshold": 6, "wip_alert_multiplier": 1.5 }
```

Структура `f04_config`:
```json
{
  "skip_min_clarity": 0.85,
  "skip_max_complexity": 1,
  "correction_sheet_clarity_threshold": 0.70,
  "low_clarity_tag_threshold": 0.55
}
```

Структура `quota_config`:
```json
{ "agent_reserved_pct": 60, "human_min_pct": 40 }
```

Структура `mcp_api_keys`:
```json
{
  "<key_hash_sha256>": {
    "allowed_tools":        ["get_tasks_by_column", "move_task", "escalate_task"],
    "can_send_messages":    false,
    "max_tasks_per_minute": 50
  }
}
```
Пустой объект `{}` = legacy mode (backward compatible): все инструменты разрешены.

**Workspace onboarding — два идентификатора:**
`slug` (для URL) + `task_prefix` (для нумерации задач, 2–6 заглавных букв, иммутабелен после создания).

```typescript
interface PrefixResult {
  prefix:            string;
  needsManualReview: boolean;
}

function generateTaskPrefix(slug: string): PrefixResult {
  const latinOnly = slug.replace(/[^a-zA-Z\-_\s]/g, '').trim();
  if (!latinOnly) return { prefix: 'WS', needsManualReview: true };

  const words = latinOnly.split(/[\-_\s]+/).filter(Boolean);
  let prefix: string;
  if (words.length === 1) {
    prefix = words[0].toUpperCase().slice(0, 6);
  } else {
    prefix = words.map(w => (w[0] ?? '').toUpperCase()).join('').slice(0, 6);
  }
  const isValid = /^[A-Z]{2,6}$/.test(prefix);
  return { prefix: isValid ? prefix : 'WS', needsManualReview: !isValid };
}
```

---

## 9. Политика хранения данных

| Таблица | Срок хранения | Действие |
|---|---|---|
| task_events | 30 дней | Memory Consolidation → удаление |
| agent_events | 7 дней | Полное удаление |
| enrichment_queue (done) | 3 дня | Удаление обработанных |
| task_column_history | бессрочно | — |
| workspace_documents | до явного удаления Admin/Owner | CASCADE удаляет чанки |
| workspace_doc_chunks | CASCADE от workspace_documents | — |
| assignment_history | бессрочно (в рамках workspace) | CASCADE при удалении workspace |
| task_relations | бессрочно (в рамках workspace) | CASCADE при удалении tasks/workspace |

### pg_cron jobs

```sql
-- Memory Consolidation: каждые 15 мин
SELECT cron.schedule('memory-consolidation', '*/15 * * * *', $$
  SELECT net.http_post(
    url     := current_setting('app.edge_fn_url') || '/consolidate',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_key'))
  )$$);

-- GC agent_events: ежедневно в 03:00 UTC
SELECT cron.schedule('gc-agent-events', '0 3 * * *',
  $$DELETE FROM agent_events WHERE created_at < NOW() - INTERVAL '7 days'$$);

-- GC enrichment_queue: ежедневно в 04:00 UTC
SELECT cron.schedule('gc-enrichment-queue', '0 4 * * *',
  $$DELETE FROM enrichment_queue
    WHERE status = 'done' AND processed_at < NOW() - INTERVAL '3 days'$$);

-- Мониторинг зависших pending: каждые 10 минут
SELECT cron.schedule('monitor-enrichment-queue', '*/10 * * * *', $$
  SELECT net.http_post(
    url     := current_setting('app.edge_fn_url') || '/queue-monitor',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_key')),
    body    := (
      SELECT jsonb_build_object('stuck_count', COUNT(*))
      FROM enrichment_queue
      WHERE status = 'pending'
        AND scheduled_at < NOW() - INTERVAL '10 minutes'
    )::text
  )$$);

-- Авто-фейл зависших воркеров: каждый час
SELECT cron.schedule('auto-fail-locked-queue', '0 * * * *',
  $$UPDATE enrichment_queue
    SET status = 'failed', processed_at = NOW()
    WHERE status = 'processing'
      AND locked_at < NOW() - INTERVAL '2 hours'$$);

-- Daily Standup dispatcher: каждую минуту
SELECT cron.schedule('standup-dispatcher', '* * * * *', $$
  SELECT net.http_post(
    url     := current_setting('app.edge_fn_url') || '/standup-dispatcher',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_key'))
  )$$);

-- Workspace Context fallback: каждый час (добавлен в v0.12.0)
-- Основной путь — триггеры trg_context_invalidate. Cron — страховка при пропущенных событиях.
SELECT cron.schedule('workspace-context-fallback', '0 * * * *', $$
  INSERT INTO enrichment_queue (
    workspace_id, type, payload, status, scheduled_at
  )
  SELECT
    workspace_id,
    'workspace_context_rebuild',
    jsonb_build_object('workspace_id', workspace_id),
    'pending',
    NOW()
  FROM workspace_settings
  WHERE context_stale = true
  ON CONFLICT DO NOTHING;
$$);

-- Мониторинг деградации NeuralDeep Cold Path: каждый час (добавлен в v0.13.0)
-- Реализует Path A аксиомы A-6: fallback-цепочка не вводится, деградация видима через алерт.
-- Семантика: единичные failed enrichments — норма (retry backoff §7.3).
-- ≥5 failures за час в одном workspace = признак недоступности NeuralDeep Hub.
-- Алерт: bot_notify → Admin/Owner в привязанный Telegram-чат workspace.
SELECT cron.schedule('enrichment-failure-alert', '0 * * * *', $$
  INSERT INTO enrichment_queue (workspace_id, type, payload, status, scheduled_at)
  SELECT
    te.workspace_id,
    'bot_notify',
    jsonb_build_object(
      'workspace_id', te.workspace_id,
      'alert_type',   'enrichment_degraded',
      'text',         format(
        '⚠️ Cold Path деградация: %s задач не обогащены за последний час. '
        'NeuralDeep Hub может быть недоступен. Проверь статус провайдера.',
        COUNT(*)
      )
    ),
    'pending',
    NOW()
  FROM task_enrichments te
  WHERE te.enrichment_status = 'failed'
    AND te.failed_at > NOW() - INTERVAL '1 hour'
  GROUP BY te.workspace_id
  HAVING COUNT(*) >= 5;
$$);

-- Bot Notify fallback: каждый час (добавлен в v0.13.4)
-- Основной путь — DB Webhook на INSERT enrichment_queue (type='bot_notify').
-- Cron — страховка при пропущенных webhook-событиях (outage, misconfig).
-- Идемпотентно: просто повторно инициирует скан pending-джобов, дублей не создаёт
-- (enrichment_queue.status переводится воркером атомарно через FOR UPDATE SKIP LOCKED).
-- Контракт воркера — onitask_bot_.md §6.5.
SELECT cron.schedule('bot-notify-fallback', '0 * * * *', $$
  SELECT net.http_post(
    url     := current_setting('app.edge_fn_url') || '/bot-notify',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_key')),
    body    := jsonb_build_object('trigger', 'fallback_cron')
  )
$$);

-- Weight Decay: PLACEHOLDER — НЕ активен на MVP (добавлен в v0.12.0)
-- Активировать при: COUNT(task_relations) > 100k в любом workspace.
-- Soft-cleanup: удаляет слабые устаревшие рёбра.
-- SELECT cron.schedule('weight-decay', '0 3 * * 0', $$
--   DELETE FROM task_relations
--   WHERE weight < 0.1
--     AND created_at < NOW() - INTERVAL '90 days'
--     AND relation_type = 'mentions';  -- только слабые рёбра, не 'blocks'
-- $$);
```

### 6.17 Профили пользователей

Связывает Supabase Auth (`auth.users`) с пользовательскими данными onitask.
Создаётся через `/api/init` (INV-16: find-or-create только, без автообновления).

```sql
CREATE TABLE public.profiles (
  id           uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  telegram_id  bigint      UNIQUE NOT NULL,
  display_name text        NOT NULL DEFAULT '',
  avatar_url   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_profiles_telegram ON public.profiles (telegram_id);
```

> **INV-10:** `workspace_telegram_chats.linked_by → REFERENCES profiles(id)` — единственное
> место прямого JOIN с profiles. Везде остальное — через `workers(id)`.

---

### 6.18 Инвайт-ссылки

Один активный инвайт на workspace одновременно (принудительно в Route Handler).
`expires_at`: Route Handler устанавливает `now() + interval '7 days'`.
`code`: base64url, 16 байт (SEC-02, `onitask_security_.md §3`).
`created_by → workers(id)` — инвайт создаёт участник workspace (не profiles напрямую).

```sql
CREATE TABLE public.invite_links (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  code         text        UNIQUE NOT NULL,
  created_by   uuid        NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  expires_at   timestamptz NOT NULL,
  max_uses     int         NOT NULL DEFAULT 10 CHECK (max_uses > 0),
  used_count   int         NOT NULL DEFAULT 0  CHECK (used_count >= 0),
  is_active    boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_invite_links_workspace
  ON public.invite_links (workspace_id)
  WHERE is_active = true;

CREATE INDEX idx_invite_links_code
  ON public.invite_links (code)
  WHERE is_active = true;
```

---

## 10. Структура документации

### Иерархия

```
onitask_Architecture_Master_.md       ← этот документ (единственный источник истины)
│
├── Feature Modules (UX + логика, без DDL):
│   ├── onitask_ai_.md                — F-01, F-03, F-04, F-06; Workspace Context rebuild pipeline
│   ├── onitask_flow_.md              — Flow Board UX; Blocker Chain UI; Cascade Unblock alert
│   ├── onitask_team_tab.md           — Deprecated v1.3.0 (SQL-справочник)
│   └── onitask_bot.md                — Telegram Bot: команды, сценарии, Freemium
│
├── Операционные приложения:
│   ├── onitask_mcp_contract_.md      — MCP tools; get_task_context + subgraph; blocked_by param
│   ├── onitask_sql_anomalies_.md     — SQL-вьюхи; orphan_blockers §3.10; trg_handoff_chain_alert §5.7
│   └── onitask_security_.md          — OWASP LLM Top 10; Prompt Injection; data_sharing_level;
│                                       mcp_api_keys scopes; sanitization; DFS cycle detection
│
├── Миграции (канонический SQL для Supabase):
│   ├── supabase/migrations/001_init.sql  — полная схема БД (новый проект, с нуля)
│   └── supabase/migrations/002_rls.sql   — RLS-политики; helper-функции get_my_workspace_ids()
│
└── onitask_INDEX_.md                 — навигатор: что читать для каждой задачи
```

### Правила обновления

- **DDL изменения** — только в Master Spec (раздел 6).
- **UX/логика** — в соответствующем Feature Module.
- **Новая аксиома** — добавить в раздел 3 и в раздел 1 (Инварианты) если проверяема.
- **Версия Master** инкрементируется при любом изменении схемы БД или аксиом.

---

## Changelog (кратко)

**v0.13.4 — июнь 2026**

*Bot Notify Worker — закрытие архитектурного пробела (найдено при сверке dev_setup.md):*

- §9: добавлен pg_cron job `bot-notify-fallback` (hourly) — страховка при пропущенных
  DB Webhook событиях для `enrichment_queue (type='bot_notify')`. Паттерн идентичен
  `workspace-context-fallback`. Основной путь доставки (DB Webhook → Edge Function
  `bot-notify`) и полный контракт воркера — см. `onitask_bot_.md §6.5`

**v0.13.3 — июнь 2026**

*New Supabase project init — закрытие блокеров документационного аудита:*

- §1: INV-16 — `/api/init` find-or-create только; автообновление `display_name`/`avatar_url`
  запрещено (автосинхронизация с Telegram ломает ожидания тимлида)
- §4: добавлено поле `role text CHECK('owner','admin','member','viewer')` в DDL `workers`;
  NULL для агентов; смена role только через service role
- §6.1: `tracker.columns` — ALTER заменён на полный `CREATE TABLE` с FK `workspace_id`
  (tracker.projects упразднён, workspace = project); добавлен `trg_init_workspace_columns`
  (авто-сид 4 дефолтных колонок: backlog/in_progress/review/done с WIP-лимитами)
- §6.1: tasks — добавлены `embedding_hash text` и `embedding_updated_at timestamptz`;
  триггер `trg_invalidate_task_embedding` (BEFORE UPDATE, сбрасывает кэш при изменении
  title/description; cache-hit не обновляет `embedding_updated_at` — намеренно)
- §6.17 (новый): таблица `public.profiles` — DDL, индекс по `telegram_id`, ссылка на INV-16
- §6.18 (новый): таблица `public.invite_links` — DDL, два partial-индекса,
  `created_by → workers(id)`, семантика: один активный инвайт на workspace
- §10: добавлен раздел «Миграции» в иерархию документации (`001_init.sql`, `002_rls.sql`)

---

**v0.13.2 — июнь 2026**

*Embedding Cache:*

- §6.1: tasks — `embedding_hash text`, `embedding_updated_at timestamptz`;
  `trg_invalidate_task_embedding` (BEFORE UPDATE). Детали реализации — `ai_.md §2.2`.

---

**v0.13.1 — июнь 2026**
- §6.4: `workspace_context` hard limit снижен с 2000 до **800 символов** (~200 токенов).
  Обоснование: четыре элемента качественного контекста (роли, домен, ритм, эскалация)
  укладываются в 460–690 символов. Превышение 800 снижает точность assignee-маппинга
  и ai_hint в F-03/F-04. UI-зоны: зелёная 0–600, amber 601–720, red 721–800, блокировка > 800.
  Миграция: `LEFT(workspace_context, 800)` до применения нового CHECK constraint.

---

**v0.13.0 — июнь 2026**

*Security Layer (OWASP LLM Top 10 2025):*
- §1: INV-15 — `data_sharing_level='full'` требует подписанного DPA с NeuralDeep Hub
  (IP-риск: doc RAG без порога similarity). Уровни 'minimal' и 'standard' DPA не требуют:
  `assignment_history` — псевдонимизированные UUID (GDPR Recital 26); `worker display_names` —
  usernames в функциональном контексте. Default 'standard' = текущее поведение (backward compatible)
- §6.4: `workspace_settings` — добавлены:
  `data_sharing_level text DEFAULT 'standard'` (три уровня изоляции данных для LLM-провайдеров;
  семантика уровней задокументирована в комментарии поля и onitask_security_.md §2.1);
  `mcp_api_keys jsonb DEFAULT '{}'` (матрица полномочий API-ключей агентов;
  `{}` = legacy mode, все инструменты разрешены — backward compatible для Cursor/Claude Code);
  миграция ADD COLUMN добавлена
- §8: список consumers расширен — F-03 и F-04 читают `data_sharing_level`; MCP читает
  `mcp_api_keys` и `data_sharing_level`; добавлен Security Layer как отдельный consumer;
  добавлен F-01 который ранее отсутствовал явно; добавлена структура `mcp_api_keys`
- §9: pg_cron job `enrichment-failure-alert` (hourly) — алерт при ≥5 failed enrichments
  за час на workspace через bot_notify; реализует Path A мониторинга без изменения A-6
- §10: `onitask_security_.md` добавлен в иерархию документации как операционное приложение

**v0.12.0 — июнь 2026**

*Relational Context Layer (A-12):*
- §1: INV-13 — `task_relations.workspace_id` передаётся явно при каждом INSERT (аналог enrichment_queue v0.7.4)
- §1: INV-14 — `workspace_context` (manual, Admin-only) и `workspace_context_cache` (derived, system-only) строго разделены; ни одно не перезаписывает другое автоматически
- §3: аксиома A-12 «Relational Context Layer» — `task_relations` как структурный слой знаний поверх pgvector; три типа отношений с иммутабельной шкалой весов (`blocks`=1.0, `spawned_from`=0.8, `mentions`=0.3); двухуровневый JOIN без recursive CTE; fallback на `match_tasks()` при пустом графе; путь миграции к `entity_registry` при cross-entity traversal; `workspace_context_cache` как невидимый derived cache второго уровня
- §6.4: `workspace_settings` — добавлены `workspace_context_cache text` (max 500 chars, system-only, INV-14) и `context_stale boolean DEFAULT false`; оба поля добавлены в список consumers §8; миграция ADD COLUMN
- §6.5: `enrichment_queue` — тип `'workspace_context_rebuild'` добавлен в CHECK; новый UNIQUE-индекс `idx_enrichment_queue_dedup_context_rebuild` (один pending rebuild на workspace); приоритет 2 в ORDER BY воркера (между `card` и `doc_process`)
- §6.16 (новый): таблица `task_relations` — DDL, 4 индекса (включая частичный для `blocks`), UNIQUE на `(from_task_id, to_task_id, relation_type)`; RPC `get_task_subgraph` (depth 1 все типы + depth 2 только `blocks`); триггер `trg_cascade_unblock` (AFTER UPDATE OF column — снимает `is_blocked` при единственном блокере, queue `cascade_unblock` bot_notify); триггер `trg_context_invalidate` (AFTER UPDATE tasks: needs_human/handoff_to/priority; AFTER UPDATE sprints: status); placeholder `trg_mentions_parse` (Phase 1.1); полное примечание о миграции к `entity_registry` с SQL-шагами
- §9: pg_cron — `workspace-context-fallback` (hourly страховка при пропущенных триггерах); `weight-decay` (placeholder, неактивен до 100k рёбер/workspace, soft-delete только `mentions`)
- §10: `§6.16` добавлен в иерархию документации; обновлены описания `onitask_ai_.md`, `onitask_flow_.md`, `onitask_mcp_contract_.md`, `onitask_sql_anomalies_.md`

**v0.11.0 — июнь 2026**
- §1: INV-12 — снапшот фиксируется только триггером `trg_record_assignment_snapshot`
- §3: аксиома A-11 «Assignment Risk Score» (0–100), разграничена с A-9
- §6.14 (новый): таблица `assignment_history` — DDL, 4 индекса, CASCADE по workspace_id, триггер `trg_record_assignment_snapshot`
- §6.15 (новый): cross-reference на VIEW `attention_risk_pulse`
- §9: `assignment_history` — бессрочное хранение, CASCADE при удалении workspace

---

*onitask · Architecture Master Specification · v0.13.4 · июнь 2026*
