# onitask · SQL-паттерны для аномалий и алертов (без LLM)

**Версия:** 1.6
**Дата:** июнь 2026
**Статус:** Production-Ready

> **Тип документа:** Операционное приложение к Master Spec.
> Содержит DDL вьюх, функций и триггеров системы алертов, а также TypeScript-логику воркера.
> Core DDL таблиц — только в [Master Spec §6](onitask_Architecture_Master_.md#6-полная-схема-бд).

> **Связанные документы:**
> - [Master Spec](onitask_Architecture_Master_.md): таблицы `tasks`, `workers`, `workspace_settings`, `task_column_history`, `tracker.columns`, `sprints`, `task_enrichments`, `task_relations` (§6.16), `assignment_history` (§6.14)
> - [Flow Board](onitask_flow_.md): интерпретация аномалий в UI
> - [Team Tab](onitask_team_tab.md): метрики участников (Deprecated v1.3.0 — справочник)
> - [Bot Contract](onitask_bot.md): доставка алертов через `enrichment_queue (type='bot_notify')`
> - [AI Contract](onitask_ai_.md): поле `ai_hint` (LLM) для карточки задачи — не заменяется, а дополняется

---

## 1. Цель

Перевести операционные аномалии на детерминированный SQL, оставив за AI исключительно семантическую, творческую и контекстную работу (F-03). Это снижает TCO и гарантирует 100% точность там, где LLM даёт галлюцинации. Все аномалии вычисляются автоматически (по расписанию или через триггеры) и доставляются в Telegram или подсвечиваются в Flow Board.

**Что остаётся за AI:**
- `ai_hint` — короткая подсказка на карточке задачи, генерируется F-03
- `cognitive_weight` и `story_points` — F-03
- `suggested_tags` — F-03
- AI Flow Summary — F-03 расширение
- Семантическая детекция дубликатов (дополнительно к SQL)

**Что заменяется SQL:**
- Аномалии `stuck`, `overloaded`, `bottleneck`, `duplicate` (очевидные текстовые), `stale_blocked`, `velocity_drop`
- Алерты на эскалации (`needs_human`) и ревью-очередь
- Графовые аномалии (v1.6): `orphan_blocker`, `handoff_chain`

---

## 2. Предварительные требования

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

- `workspace_settings.flow_config` содержит кастомные пороги. Значения `overload_threshold` и `wip_alert_multiplier` — числовые строки (`"6"`, `"1.5"`). Во вьюхах применена regex-защита от нечисловых значений.
- Алерты отправляются через `enrichment_queue` с `type = 'bot_notify'` и дедупликацией: 1 алерт на `(alert_type, task_id или worker_id)` / 2 часа / workspace.
- `enrichment_queue` содержит колонку `workspace_id` (добавлена в Master Spec v0.7.4). Все вставки в очередь обязаны передавать `workspace_id` явно (INV-13 аналогично для `task_relations`).
- `task_relations` (Master Spec §6.16) — структурный слой знаний (A-12). Вьюхи §3.10, §3.11 зависят от него.

---

## 3. SQL-представления (вьюхи) для аномалий

Все вьюхи — схема `public`. На MVP достаточно обычных вьюх при наличии индексов из §8.

### 3.1 Stuck tasks — зависшие в колонке (>72 часов)

```sql
CREATE OR REPLACE VIEW stuck_tasks AS
SELECT
  t.id,
  t.title,
  t.column,
  t.assigned_to,
  w.display_name AS assignee_name,
  t.moved_to_column_at,
  EXTRACT(EPOCH FROM (NOW() - t.moved_to_column_at)) / 3600 AS hours_stuck,
  t.workspace_id
FROM tasks t
JOIN workers w ON t.assigned_to = w.id AND t.workspace_id = w.workspace_id
WHERE t.column IN ('in_progress', 'review')
  AND t.moved_to_column_at < NOW() - INTERVAL '72 hours'
  AND t.is_blocked = false;
-- Примечание: дублирующий WHERE t.column != 'done' убран — уже покрыт IN ('in_progress','review')
```

### 3.2 Overloaded workers — перегрузка по когнитивному бюджету

Порог из `flow_config->>'overload_threshold'` (default 6).
Учитывает `in_progress` (assigned) + `review` (reviewer) — в соответствии с A-9 (Master Spec §3).
`cognitive_weight` берётся из `tasks.cognitive_weight` (единственный источник истины, A-5).
Задачи с `is_inbox = true` исключаются — они «не размещены осознанно» и не должны нагружать бюджет.

```sql
-- ИСПРАВЛЕНИЕ v1.1: условие t.workspace_id = w.workspace_id перенесено
-- внутрь блока ON LEFT JOIN, чтобы не превращать его в INNER JOIN при NULL-tasks.
-- ИСПРАВЛЕНИЕ v1.3: добавлено AND t.is_inbox = false.

CREATE OR REPLACE VIEW overloaded_workers AS
WITH worker_load AS (
  SELECT
    w.id,
    w.display_name,
    w.workspace_id,
    COALESCE(SUM(
      COALESCE(t.cognitive_weight, 1)  -- tasks.cognitive_weight — источник истины (A-5)
    ), 0) AS total_load,
    COALESCE(
      CASE
        WHEN ws.flow_config->>'overload_threshold' ~ '^[0-9]+$'
        THEN (ws.flow_config->>'overload_threshold')::int
        ELSE NULL
      END,
      6
    ) AS threshold
  FROM workers w
  INNER JOIN workspace_settings ws ON w.workspace_id = ws.workspace_id
  LEFT JOIN tasks t ON (
    (t.assigned_to = w.id AND t.column = 'in_progress')
    OR
    (t.reviewer_id = w.id AND t.column = 'review')
  )
  AND t.is_blocked = false
  AND t.is_inbox = false
  AND t.workspace_id = w.workspace_id  -- внутри ON, не в WHERE
  WHERE w.type = 'human'
  GROUP BY w.id, w.display_name, w.workspace_id, ws.flow_config
)
SELECT id, display_name, workspace_id, total_load, threshold
FROM worker_load
WHERE total_load > threshold;
```

### 3.3 Bottleneck columns — превышение WIP лимита

`wip_alert_multiplier` читается из `flow_config` (default 1.5).

```sql
CREATE OR REPLACE VIEW bottleneck_columns AS
SELECT
  c.workspace_id,
  c.name AS column_name,
  c.wip_limit,
  m.val AS multiplier,
  COUNT(t.id) AS task_count,
  CASE
    WHEN COUNT(t.id) > c.wip_limit * m.val THEN 'critical'
    WHEN COUNT(t.id) > c.wip_limit         THEN 'warning'
    ELSE 'ok'
  END AS severity
FROM tracker.columns c
INNER JOIN workspace_settings ws ON c.workspace_id = ws.workspace_id
LEFT JOIN tasks t ON t.column = c.name
  AND t.workspace_id = c.workspace_id
  AND t.column != 'done'
LEFT JOIN LATERAL (
  SELECT COALESCE(
    CASE
      WHEN ws.flow_config->>'wip_alert_multiplier' ~ '^[0-9]+(\.[0-9]+)?$'
      THEN (ws.flow_config->>'wip_alert_multiplier')::float
      ELSE NULL
    END,
    1.5
  ) AS val
) m ON TRUE
WHERE c.wip_limit IS NOT NULL
GROUP BY c.id, c.name, c.wip_limit, c.workspace_id, m.val
HAVING COUNT(t.id) > c.wip_limit;
```

### 3.4 Duplicate tasks — очевидные дубликаты заголовков (сходство > 0.7)

Оператор `%` задействует GIN-индекс; `similarity() > 0.7` — финальный фильтр.
Ограничение 30 днями снижает объём cross join.

```sql
CREATE OR REPLACE VIEW duplicate_tasks AS
SELECT
  t1.id    AS task1_id,
  t1.title AS title1,
  t2.id    AS task2_id,
  t2.title AS title2,
  similarity(t1.title, t2.title) AS similarity,
  t1.workspace_id
FROM tasks t1
JOIN tasks t2 ON t1.workspace_id = t2.workspace_id
  AND t1.id < t2.id
  AND t1.title % t2.title            -- задействует gin_trgm_ops индекс
WHERE t1.column != 'done'
  AND t2.column != 'done'
  AND t1.created_at > NOW() - INTERVAL '30 days'
  AND t2.created_at > NOW() - INTERVAL '30 days'
  AND similarity(t1.title, t2.title) > 0.7;
```

> SQL-вьюха ловит текстовые дубликаты (сходство >70%). AI — семантические (разные формулировки, один смысл). Каналы параллельны.

### 3.5 Stale blocked — заблокированные без движения (>48 часов)

```sql
CREATE OR REPLACE VIEW stale_blocked AS
SELECT id, title, column, assigned_to, workspace_id, moved_to_column_at
FROM tasks
WHERE is_blocked = true
  AND moved_to_column_at < NOW() - INTERVAL '48 hours'
  AND column != 'done';
```

### 3.6 Velocity drop — снижение скорости спринта

`story_points` берётся из `task_enrichments` (на `tasks` этого поля нет).
Guard: алерт не срабатывает, пока данных меньше 14 дней.

```sql
-- ИСПРАВЛЕНИЕ v1.1: убран t.story_points — поля нет в таблице tasks.

CREATE OR REPLACE VIEW velocity_drop AS
WITH daily_velocity AS (
  SELECT
    t.workspace_id,
    DATE(h.moved_at) AS day,
    SUM(COALESCE(te.story_points, 0)) AS points
  FROM task_column_history h
  JOIN tasks t ON t.id = h.task_id
  LEFT JOIN task_enrichments te ON te.task_id = h.task_id
  WHERE h.to_column = 'done'
    AND h.moved_at > NOW() - INTERVAL '28 days'
  GROUP BY t.workspace_id, DATE(h.moved_at)
),
recent_avg AS (
  SELECT
    workspace_id,
    AVG(points)          AS avg_points,
    COUNT(DISTINCT day)  AS days_count
  FROM daily_velocity
  WHERE day > NOW() - INTERVAL '14 days'
  GROUP BY workspace_id
),
previous_avg AS (
  SELECT workspace_id, AVG(points) AS avg_points
  FROM daily_velocity
  WHERE day BETWEEN NOW() - INTERVAL '28 days' AND NOW() - INTERVAL '15 days'
  GROUP BY workspace_id
)
SELECT
  r.workspace_id,
  r.avg_points       AS current_velocity,
  p.avg_points       AS previous_velocity,
  r.avg_points / NULLIF(p.avg_points, 0) AS ratio
FROM recent_avg r
JOIN previous_avg p ON r.workspace_id = p.workspace_id
WHERE r.avg_points / NULLIF(p.avg_points, 0) < 0.7
  AND r.days_count >= 14;  -- guard: не срабатывает на свежих воркспейсах
```

### 3.7 Pending escalations — задачи, требующие вмешательства человека

```sql
CREATE OR REPLACE VIEW pending_escalations AS
SELECT
  t.id,
  t.title,
  t.escalation_reason,
  t.workspace_id,
  w.display_name AS assigned_agent,
  t.moved_to_column_at,
  EXTRACT(EPOCH FROM (NOW() - t.moved_to_column_at)) / 3600 AS hours_pending
FROM tasks t
LEFT JOIN workers w ON t.assigned_to = w.id AND t.workspace_id = w.workspace_id
WHERE t.needs_human = true
  AND t.column != 'done';
```

### 3.8 Review backlog — перегрузка ревьювера (>2 задач на review)

```sql
-- ИСПРАВЛЕНИЕ v1.1: убран лишний AND t.reviewer_id IS NOT NULL в WHERE.
-- INNER JOIN уже гарантирует NOT NULL.

CREATE OR REPLACE VIEW review_backlog AS
SELECT
  t.reviewer_id,
  w.display_name AS reviewer_name,
  COUNT(t.id)    AS review_count,
  t.workspace_id
FROM tasks t
INNER JOIN workers w ON t.reviewer_id = w.id AND t.workspace_id = w.workspace_id
WHERE t.column = 'review'
GROUP BY t.reviewer_id, w.display_name, t.workspace_id
HAVING COUNT(t.id) > 2;
```

### 3.9 Attention Risk Pulse — скоринг риска назначения (A-11)

Детерминированная метрика операционного риска назначения задачи конкретному worker (0–100).
Отвечает на вопрос тимлида: «Выполнит ли этот человек задачу в срок, если назначить её сейчас?»

Отличие от `overloaded_workers` (§3.2): `overloaded_workers` фиксирует факт перегрузки по
`flow_config.overload_threshold`. `attention_risk_pulse` измеряет **риск конкретного назначения**
через взвешенные факторы, обоснованные нейробиологически (см. аксиому A-11, Master §3).

**Ограничение (caveat A-11):** `context_switches_today` считается через
`task_column_history.moved_by`, которое nullable из-за known race condition (Master §6.3).
Потеря точности ~5–10%. Обрабатывается через `COALESCE(..., 0)`.

> **Phase 1.1:** после стабилизации `task_relations` (Master §6.16) добавить фактор
> `blocking_depth` — количество задач, заблокированных через рёбра `blocks` для данного worker.
> Вес планируется ×8. Это повысит точность скоринга на 15–20% для агентных команд.
> До Phase 1.1 блокировки частично учтены через `blocked_tasks` (is_blocked флаг, вес ×12).

```sql
CREATE OR REPLACE VIEW attention_risk_pulse AS
WITH worker_task_metrics AS (
  SELECT
    w.id            AS worker_id,
    w.display_name,
    w.workspace_id,
    -- Фактор 1: Активные обязательства (вес ×15)
    -- Rubinstein 2001: каждая параллельная задача снижает эффективность ~25%
    COUNT(DISTINCT t.id) FILTER (
      WHERE t.column      = 'in_progress'
        AND t.assigned_to = w.id
        AND t.is_inbox    = false
    ) AS active_tasks,
    -- Фактор 3а: Когнитивное трение — блокировки (вес ×12)
    -- Zeigarnik effect: незавершённые задачи нагружают рабочую память как «открытые петли»
    COUNT(DISTINCT t.id) FILTER (
      WHERE t.is_blocked   = true
        AND t.assigned_to  = w.id
        AND t.column      != 'done'
    ) AS blocked_tasks,
    -- Фактор 3б: Когнитивное трение — ревью-очередь (вес ×5)
    COUNT(DISTINCT t.id) FILTER (
      WHERE t.column      = 'review'
        AND t.reviewer_id = w.id
    ) AS review_tasks,
    -- Фактор 4: Deadline-давление (вес ×15)
    -- Mullainathan & Shafir «Scarcity»: deadline сужает cognitive bandwidth
    COUNT(DISTINCT t.id) FILTER (
      WHERE t.deadline_urgency = 'critical'
        AND t.assigned_to      = w.id
        AND t.column          != 'done'
        AND t.is_inbox         = false
    ) AS critical_deadline_tasks
  FROM workers w
  LEFT JOIN tasks t ON t.workspace_id = w.workspace_id
  WHERE w.type      = 'human'
    AND w.is_active = true
  GROUP BY w.id, w.display_name, w.workspace_id
),
worker_switch_metrics AS (
  -- Фактор 2: Переключения контекста за сегодня (вес ×10)
  -- Gloria Mark, UCI 2004: 23 мин на восстановление фокуса после переключения
  -- CAVEAT: moved_by nullable (race condition, Master §6.3) → ~5-10% потеря точности.
  SELECT
    tch.moved_by               AS worker_id,
    COUNT(DISTINCT tch.task_id) AS context_switches_today
  FROM task_column_history tch
  WHERE tch.moved_by IS NOT NULL
    AND tch.moved_at >= CURRENT_DATE
  GROUP BY tch.moved_by
),
scored AS (
  SELECT
    wtm.worker_id,
    wtm.display_name,
    wtm.workspace_id,
    wtm.active_tasks,
    COALESCE(wsm.context_switches_today, 0) AS context_switches_today,
    wtm.blocked_tasks,
    wtm.review_tasks,
    wtm.critical_deadline_tasks,
    LEAST(100, ROUND(
      wtm.active_tasks                         * 15.0 +
      COALESCE(wsm.context_switches_today, 0) * 10.0 +
      wtm.blocked_tasks                        * 12.0 +
      wtm.review_tasks                         *  5.0 +
      wtm.critical_deadline_tasks              * 15.0
    )) AS attention_risk_score
  FROM worker_task_metrics wtm
  LEFT JOIN worker_switch_metrics wsm ON wsm.worker_id = wtm.worker_id
)
SELECT
  *,
  CASE
    WHEN attention_risk_score >= 80 THEN 'critical'
    WHEN attention_risk_score >= 60 THEN 'warning'
    ELSE                                 'ok'
  END AS risk_level
FROM scored;
```

**Пороги интерпретации (интуитивная проверка):**

| Состояние worker | Расчёт | Score | risk_level |
|---|---|---|---|
| 1 лёгкая задача | 1×15 | 15 | ok |
| 4 активные задачи | 4×15 | 60 | warning ← порог amber |
| 4 активные + 2 срочных | 4×15 + 2×15 | 90 | critical |
| 2 активные + 3 переключения + 1 блок | 2×15+3×10+1×12 | 72 | warning |
| 3 активные + 3 ревью | 3×15+3×5 | 60 | warning |

**Использование VIEW:**
- Триггер `trg_record_assignment_snapshot` (Master §6.14) — снапшот при каждом назначении
- Route Handler (pre-flight) — inline warning в UI при назначении задачи (flow_.md §21)
- Не используется в Risk Pulse «Люди» (там F-01.used=3, шкала 0–3, другой вопрос)

---

### 3.10 Orphan blockers — задачи с недействительным флагом блокировки (v1.6)

**Сценарий:** задача имеет `is_blocked = true`, но все её блокеры в `task_relations` уже
в состоянии `done`. Триггер `trg_cascade_unblock` (Master §6.16) должен был снять флаг,
но мог не сработать при edge cases (задача удалена без перехода в done, ручное назначение
`is_blocked` без ребра в `task_relations`, миграция данных до v0.12.0).

Эта VIEW — детектор таких «висячих» блокировок для ежедневного cron-алерта.

```sql
CREATE OR REPLACE VIEW orphan_blockers AS
SELECT
  t.id,
  t.title,
  t.column,
  t.workspace_id,
  t.assigned_to,
  w.display_name  AS assignee_name,
  t.moved_to_column_at,
  EXTRACT(EPOCH FROM (NOW() - t.moved_to_column_at)) / 3600 AS hours_blocked
FROM tasks t
LEFT JOIN workers w ON t.assigned_to = w.id AND t.workspace_id = w.workspace_id
WHERE t.is_blocked = true
  AND t.column    != 'done'
  -- Нет ни одного активного (non-done) блокера в task_relations
  AND NOT EXISTS (
    SELECT 1
    FROM task_relations tr
    JOIN tasks blocker ON blocker.id = tr.from_task_id
    WHERE tr.to_task_id    = t.id
      AND tr.relation_type = 'blocks'
      AND tr.workspace_id  = t.workspace_id
      AND blocker.column  != 'done'
  );
-- Примечание: задачи без рёбер в task_relations (созданы до v0.12.0 или заблокированы
-- вручную без task_relations) тоже попадут в эту VIEW. Это ожидаемое поведение:
-- оператор должен проверить их вручную или снять флаг.
```

**Действие при обнаружении:** cron-алерт `orphan_blocker` в Telegram оператору.
Текст: «🔗 Задача "X" заблокирована, но все блокеры завершены — проверь вручную».
Дедупликация: 2 часа на `(alert_type, task_id)`.

---

### 3.11 Handoff chain — аномальные цепочки передач агентов (v1.6)

**Сценарий:** задача передаётся между агентами 3 и более раз за 7 дней без перехода в `done`.
Это тихое зависание — ни один агент не вызвал `escalate_task`, но прогресса нет.
Отличие от эскалации: `needs_human = false`, флаг не выставлен, оператор не видит проблему.

```sql
CREATE OR REPLACE VIEW handoff_chain AS
SELECT
  ae.task_id,
  t.title,
  t.workspace_id,
  t.column,
  COUNT(*)                    AS handoff_count,
  MIN(ae.created_at)          AS first_handoff_at,
  MAX(ae.created_at)          AS last_handoff_at,
  EXTRACT(EPOCH FROM (NOW() - MIN(ae.created_at))) / 3600 AS hours_in_chain
FROM agent_events ae
JOIN tasks t ON t.id = ae.task_id
WHERE ae.tool        = 'handoff_task'
  AND ae.created_at > NOW() - INTERVAL '7 days'
  AND t.column      != 'done'
  AND t.needs_human  = false  -- не дублируем pending_escalations (§3.7)
GROUP BY ae.task_id, t.title, t.workspace_id, t.column
HAVING COUNT(*) >= 3;
-- Порог 3: один handoff = норма (Cursor → Claude Code).
-- Два = допустимо (Claude Code вернул Cursor'у уточнение).
-- Три+ = признак того, что агенты не справляются с задачей без эскалации.
```

**Действие при обнаружении:** триггер `trg_handoff_chain_alert` (§5.7) + cron резервный канал.
Текст алерта: «🔄 ALPHA-N передавалась агентами N раз за 7 дней без завершения — проверь задачу».

---

## 4. Edge Function — ежедневный cron (6:00 UTC)

Покрывает аномалии, не требующие мгновенного реагирования: `stuck`, `bottleneck`, `stale_blocked`,
`velocity_drop`, `review_backlog`, дубликаты (резервный канал), `orphan_blocker`, `handoff_chain`.

Дедупликация: task-level по `(alert_type, task_id, workspace_id)`, worker/column-level по `(alert_type, workspace_id, worker_id/column_name)`.

> **Bot-воркер:** для `bot_notify`-записей с `task_id` workspace резолвится через `tasks.workspace_id`. Для записей без `task_id` (bottleneck, review_backlog, velocity_drop) — из `payload->>'workspace_id'` напрямую.

> **Допустимые `alert_type` значения для Bot-воркера:**
> `'stuck'`, `'bottleneck'`, `'duplicate'`, `'stale_blocked'`, `'review_backlog'`,
> `'escalation'`, `'escalation_resolved'`, `'cascade_unblock'`,
> `'orphan_blocker'`, `'handoff_chain'` *(добавлены в v1.6)*

```typescript
// Supabase Edge Function: POST /api/check-anomalies-daily
import { createClient } from '@supabase/supabase-js';

type AlertKey = {
  type: string;
  workspace_id: string;
  task_id?: string;
  worker_id?: string;
  column_name?: string;
};

async function shouldSendAlert(supabase: any, key: AlertKey): Promise<boolean> {
  let query = supabase
    .from('enrichment_queue')
    .select('created_at')
    .eq('type', 'bot_notify')
    .eq('payload->>alert_type', key.type)
    .eq('payload->>workspace_id', key.workspace_id);
  if (key.task_id)     query = query.eq('payload->>task_id', key.task_id);
  if (key.worker_id)   query = query.eq('payload->>worker_id', key.worker_id);
  if (key.column_name) query = query.eq('payload->>column_name', key.column_name);
  const { data: last } = await query.order('created_at', { ascending: false }).limit(1);
  if (!last?.[0]) return true;
  return new Date(last[0].created_at) < new Date(Date.now() - 2 * 60 * 60 * 1000);
}

async function sendAlert(
  supabase: any,
  workspaceId: string,
  alert: {
    alert_type:   string;
    text:         string;
    task_id?:     string;
    worker_id?:   string;
    column_name?: string;
  }
) {
  await supabase.from('enrichment_queue').insert({
    workspace_id: workspaceId,
    type:         'bot_notify',
    payload:      { workspace_id: workspaceId, ...alert },
    status:       'pending',
    scheduled_at: new Date().toISOString()
  });
}

export default async function handler(req: Request) {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  );

  // 1. Stuck tasks
  const { data: stuck } = await supabase.from('stuck_tasks').select('*');
  for (const task of stuck || []) {
    if (await shouldSendAlert(supabase, {
      type: 'stuck', workspace_id: task.workspace_id, task_id: task.id
    })) {
      await sendAlert(supabase, task.workspace_id, {
        alert_type: 'stuck',
        text:       `⏳ Задача «${task.title}» зависла в колонке ${task.column} уже ${Math.round(task.hours_stuck)} ч.`,
        task_id:    task.id
      });
    }
  }

  // 2. Bottleneck columns
  const { data: bottleneck } = await supabase.from('bottleneck_columns').select('*');
  for (const col of bottleneck || []) {
    if (col.severity === 'critical') {
      if (await shouldSendAlert(supabase, {
        type: 'bottleneck', workspace_id: col.workspace_id, column_name: col.column_name
      })) {
        await sendAlert(supabase, col.workspace_id, {
          alert_type:  'bottleneck',
          text:        `🚨 Узкое место в «${col.column_name}»: ${col.task_count} задач при лимите ${col.wip_limit}.`,
          column_name: col.column_name
        });
      }
    }
  }

  // 3. Duplicate tasks (резервный канал, основной — триггер §5.3)
  const { data: duplicates } = await supabase.from('duplicate_tasks').select('*');
  for (const dup of duplicates || []) {
    if (await shouldSendAlert(supabase, {
      type: 'duplicate', workspace_id: dup.workspace_id, task_id: dup.task1_id
    })) {
      await sendAlert(supabase, dup.workspace_id, {
        alert_type: 'duplicate',
        text:       `📋 Возможный дубликат: «${dup.title1}» и «${dup.title2}» (${Math.round(dup.similarity * 100)}%).`,
        task_id:    dup.task1_id
      });
    }
  }

  // 4. Stale blocked
  const { data: staleBlocked } = await supabase.from('stale_blocked').select('*');
  for (const task of staleBlocked || []) {
    if (await shouldSendAlert(supabase, {
      type: 'stale_blocked', workspace_id: task.workspace_id, task_id: task.id
    })) {
      await sendAlert(supabase, task.workspace_id, {
        alert_type: 'stale_blocked',
        text:       `🔒 Задача «${task.title}» заблокирована и не двигается более 48 ч.`,
        task_id:    task.id
      });
    }
  }

  // 5. Review backlog
  const { data: reviewBacklog } = await supabase.from('review_backlog').select('*');
  for (const rev of reviewBacklog || []) {
    if (await shouldSendAlert(supabase, {
      type: 'review_backlog', workspace_id: rev.workspace_id, worker_id: rev.reviewer_id
    })) {
      await sendAlert(supabase, rev.workspace_id, {
        alert_type: 'review_backlog',
        text:       `📝 ${rev.reviewer_name}: ${rev.review_count} задач на ревью (норма ≤2).`,
        worker_id:  rev.reviewer_id
      });
    }
  }

  // 6. Orphan blockers (добавлен в v1.6)
  // Резервный канал: основной — trg_cascade_unblock (Master §6.16).
  // Cron ловит edge cases: ручное is_blocked, данные до v0.12.0, удалённые задачи.
  const { data: orphans } = await supabase.from('orphan_blockers').select('*');
  for (const task of orphans || []) {
    if (await shouldSendAlert(supabase, {
      type: 'orphan_blocker', workspace_id: task.workspace_id, task_id: task.id
    })) {
      await sendAlert(supabase, task.workspace_id, {
        alert_type: 'orphan_blocker',
        text:       `🔗 Задача «${task.title}» заблокирована, но все блокеры завершены — проверь вручную.`,
        task_id:    task.id
      });
    }
  }

  // 7. Handoff chain (добавлен в v1.6)
  // Резервный канал: основной — trg_handoff_chain_alert (§5.7).
  const { data: chains } = await supabase.from('handoff_chain').select('*');
  for (const chain of chains || []) {
    if (await shouldSendAlert(supabase, {
      type: 'handoff_chain', workspace_id: chain.workspace_id, task_id: chain.task_id
    })) {
      await sendAlert(supabase, chain.workspace_id, {
        alert_type: 'handoff_chain',
        text:       `🔄 Задача «${chain.title}» передавалась агентами ${chain.handoff_count} раз за 7 дней без завершения.`,
        task_id:    chain.task_id
      });
    }
  }

  return new Response('OK', { status: 200 });
}
```

---

## 5. Гибридное планирование: триггеры для критических событий

### 5.1 Вспомогательная функция отправки алерта

```sql
CREATE OR REPLACE FUNCTION send_alert_immediate(
  p_workspace_id uuid,
  p_alert_type   text,
  p_task_id      uuid,
  p_text         text
) RETURNS void AS $$
DECLARE
  last_sent timestamptz;
BEGIN
  SELECT created_at INTO last_sent
  FROM enrichment_queue
  WHERE type                          = 'bot_notify'
    AND payload->>'workspace_id'      = p_workspace_id::text
    AND payload->>'alert_type'        = p_alert_type
    AND payload->>'task_id'           = p_task_id::text
  ORDER BY created_at DESC
  LIMIT 1;

  IF last_sent IS NULL OR last_sent < NOW() - INTERVAL '2 hours' THEN
    INSERT INTO enrichment_queue (workspace_id, type, payload, status, scheduled_at)
    VALUES (
      p_workspace_id,
      'bot_notify',
      jsonb_build_object(
        'workspace_id', p_workspace_id,
        'alert_type',   p_alert_type,
        'text',         p_text,
        'task_id',      p_task_id
      ),
      'pending',
      NOW()
    );
  END IF;
END;
$$ LANGUAGE plpgsql;
```

### 5.2 Мгновенные алерты для `needs_human` (эскалации)

```sql
-- ИСПРАВЛЕНИЕ v1.1: сессионная защита от циклов переведена на app.skip_alert_triggers (boolean).
-- Контракт: Route Handler и Edge Functions устанавливают
-- SET LOCAL app.skip_alert_triggers = 'true' перед мутацией.

CREATE OR REPLACE FUNCTION trigger_escalation_alert()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('app.skip_alert_triggers', true) = 'true' THEN
    RETURN NEW;
  END IF;

  IF NEW.needs_human = true AND (OLD.needs_human IS DISTINCT FROM NEW.needs_human) THEN
    PERFORM send_alert_immediate(
      NEW.workspace_id,
      'escalation',
      NEW.id,
      format(
        '🆘 Задача «%s» требует вмешательства (причина: %s)',
        NEW.title,
        COALESCE(NEW.escalation_reason, 'не указана')
      )
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_escalation_alert
AFTER UPDATE OF needs_human ON tasks
FOR EACH ROW
EXECUTE FUNCTION trigger_escalation_alert();
```

> **Контракт для Route Handler / Edge Function:** перед любым UPDATE tasks, который может изменить `needs_human`, выполнять `SET LOCAL app.skip_alert_triggers = 'true'` в той же транзакции.

> **Парный сигнал:** `trg_escalation_alert` (этот триггер) и `trg_resolution_notify` (§5.5) образуют замкнутый цикл уведомлений: первый сигнализирует о блокировке, второй — о её снятии. Оба используют `send_alert_immediate` §5.1 и одинаковый контракт `app.skip_alert_triggers`.

### 5.3 Дебаунс-проверка дубликатов через `enrichment_queue` (Вариант Б)

Триггер не делает similarity-скан внутри транзакции INSERT — только ставит задание
в `enrichment_queue` с типом `duplicate_check` и дебаунсом 5 секунд.
Воркер подхватывает задание вне транзакции и при обнаружении дубликата вставляет `bot_notify`.

**Требование к схеме:** `'duplicate_check'` добавлен в CHECK constraint `enrichment_queue.type`
и UNIQUE-индекс дедупликации — см. Master Spec §6.5.

```sql
CREATE OR REPLACE FUNCTION enqueue_duplicate_check()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('app.skip_alert_triggers', true) = 'true' THEN
    RETURN NEW;
  END IF;

  INSERT INTO enrichment_queue (workspace_id, type, payload, status, scheduled_at)
  VALUES (
    NEW.workspace_id,
    'duplicate_check',
    jsonb_build_object(
      'task_id',      NEW.id,
      'title',        NEW.title,
      'workspace_id', NEW.workspace_id
    ),
    'pending',
    NOW() + INTERVAL '5 seconds'
  )
  ON CONFLICT DO NOTHING;
  -- ON CONFLICT опирается на idx_enrichment_queue_dedup_duplicate (Master §6.5)

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enqueue_duplicate_check
AFTER INSERT ON tasks
FOR EACH ROW
EXECUTE FUNCTION enqueue_duplicate_check();
```

```typescript
// Воркер enrichment_queue — обработчик типа 'duplicate_check'
async function processDuplicateCheck(job: EnrichmentQueueRow, supabase: any) {
  const { task_id, title, workspace_id } = job.payload;

  const { data: duplicates } = await supabase.rpc('find_duplicate_tasks', {
    p_task_id:      task_id,
    p_title:        title,
    p_workspace_id: workspace_id,
    p_threshold:    0.7
  });

  if (!duplicates?.length) return;

  const dup = duplicates[0];

  const alreadySent = await shouldSendAlert(supabase, {
    type:         'duplicate',
    workspace_id: workspace_id,
    task_id:      task_id
  });
  if (!alreadySent) return;

  await supabase.from('enrichment_queue').insert({
    workspace_id,
    type:    'bot_notify',
    payload: {
      workspace_id,
      alert_type:           'duplicate',
      text:                 `📋 Возможный дубликат: «${title}» похожа на «${dup.title}» (${Math.round(dup.similarity * 100)}%).`,
      task_id:              task_id,
      duplicate_of_task_id: dup.id
    },
    status:       'pending',
    scheduled_at: new Date().toISOString()
  });
}
```

```sql
-- RPC для similarity-поиска, вызывается воркером
CREATE OR REPLACE FUNCTION find_duplicate_tasks(
  p_task_id      uuid,
  p_title        text,
  p_workspace_id uuid,
  p_threshold    float DEFAULT 0.7
)
RETURNS TABLE (id uuid, title text, similarity float) AS $$
  SELECT
    t2.id,
    t2.title,
    similarity(p_title, t2.title) AS similarity
  FROM tasks t2
  WHERE t2.workspace_id = p_workspace_id
    AND t2.id          != p_task_id
    AND t2.column      != 'done'
    AND t2.created_at  > NOW() - INTERVAL '30 days'
    AND p_title % t2.title
    AND similarity(p_title, t2.title) > p_threshold
  ORDER BY similarity DESC
  LIMIT 5;
$$ LANGUAGE sql;
```

### 5.4 Ежедневный cron для остальных аномалий

```sql
SELECT cron.schedule('check-anomalies-daily', '0 6 * * *', $$
  SELECT net.http_post(
    url     := current_setting('app.edge_fn_url') || '/check-anomalies-daily',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_key'))
  );
$$);
```

### 5.5 Уведомление об устранении эскалации (P0-02)

Зеркало `trg_escalation_alert` §5.2. Срабатывает при переходе `needs_human: true → false`.
Использует `send_alert_immediate` §5.1 и механизм дедупликации (2 часа на `(alert_type, task_id)`).

**Назначение в e2e флоу:**
Бот доставляет сигнал `escalation_resolved` агенту. Агент, реализующий polling
`get_task_context` каждые 60с (MCP Contract §7 п.11), видит `needs_human=false`
и возобновляет работу. Telegram-уведомление — независимый второй канал подтверждения.

```sql
CREATE OR REPLACE FUNCTION trigger_resolution_notify()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('app.skip_alert_triggers', true) = 'true' THEN
    RETURN NEW;
  END IF;

  IF OLD.needs_human = true AND NEW.needs_human = false THEN
    PERFORM send_alert_immediate(
      NEW.workspace_id,
      'escalation_resolved',
      NEW.id,
      format(
        '✅ Задача «%s» (%s) разблокирована. Агент может продолжить работу.',
        NEW.title,
        COALESCE(
          (SELECT w.task_prefix || '-' || t.task_number::text
           FROM tasks t JOIN workspaces w ON w.id = t.workspace_id
           WHERE t.id = NEW.id),
          NEW.id::text
        )
      )
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_resolution_notify
AFTER UPDATE OF needs_human ON tasks
FOR EACH ROW
EXECUTE FUNCTION trigger_resolution_notify();
```

> **Контракт для Route Handler:** `SET LOCAL app.skip_alert_triggers = 'true'` при автоматическом изменении `needs_human`. Для ручного снятия флага оператором — триггер срабатывает намеренно.

> **Парный цикл:** `trg_escalation_alert` (§5.2) ↔ `trg_resolution_notify` (этот триггер). Оба — AFTER-триггеры на `needs_human`. Конфликта нет.

### 5.6 Исход назначения (Assignment Risk — Контур 1, датасет Контура 2)

Триггер обновляет `outcome_status` в `assignment_history` (Master §6.14) при наступлении
значимых событий по задаче. DDL таблицы — только в Master §6.14.

```sql
CREATE OR REPLACE FUNCTION update_assignment_outcome()
RETURNS TRIGGER AS $$
BEGIN
  -- Задача завершена (перемещена в done)
  IF NEW.column = 'done' AND OLD.column != 'done' THEN
    UPDATE assignment_history
    SET
      outcome_status = CASE
        WHEN OLD.deadline IS NOT NULL
             AND OLD.deadline::date < CURRENT_DATE
        THEN 'deadline_missed'
        ELSE 'completed_on_time'
      END,
      resolved_at = NOW()
    WHERE task_id        = NEW.id
      AND outcome_status = 'pending';

  -- Задача вернулась из review в in_progress
  ELSIF OLD.column = 'review' AND NEW.column = 'in_progress' THEN
    UPDATE assignment_history
    SET outcome_status = 'returned_from_review', resolved_at = NOW()
    WHERE task_id        = NEW.id
      AND assignee_id    = NEW.assigned_to
      AND outcome_status = 'pending';

  -- Задача переназначена другому worker
  ELSIF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
        AND OLD.assigned_to IS NOT NULL
        AND NEW.assigned_to IS NOT NULL THEN
    UPDATE assignment_history
    SET outcome_status = 'reassigned', resolved_at = NOW()
    WHERE task_id        = NEW.id
      AND assignee_id    = OLD.assigned_to
      AND outcome_status = 'pending';

  -- Задача эскалирована (needs_human = true)
  ELSIF NEW.needs_human = true
        AND (OLD.needs_human IS DISTINCT FROM NEW.needs_human) THEN
    UPDATE assignment_history
    SET outcome_status = 'escalated', resolved_at = NOW()
    WHERE task_id        = NEW.id
      AND outcome_status = 'pending';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_assignment_outcome
AFTER UPDATE OF column, assigned_to, needs_human ON tasks
FOR EACH ROW EXECUTE FUNCTION update_assignment_outcome();
```

> **Связь с §5.2:** `trg_escalation_alert` (§5.2) и `trg_update_assignment_outcome` (этот триггер)
> срабатывают на одном событии `needs_human = true`, но делают разные вещи:
> §5.2 — отправляет Telegram-алерт; §5.6 — обновляет датасет для Контура 2.
> Конфликта нет: оба AFTER-триггера выполняются независимо в одной транзакции.

### 5.7 Алерт аномальной цепочки handoff (v1.6)

Срабатывает при каждом `handoff_task` событии в `agent_events`. Если общее число handoff
по этой задаче за последние 7 дней достигает 3 — немедленно отправляет алерт оператору.
Дополняет cron §5.4 как мгновенный канал.

```sql
CREATE OR REPLACE FUNCTION notify_handoff_chain()
RETURNS TRIGGER AS $$
DECLARE
  v_handoff_count int;
  v_task_title    text;
  v_workspace_id  uuid;
  v_full_id       text;
BEGIN
  -- Срабатывает только на handoff_task событиях
  IF NEW.tool != 'handoff_task' THEN
    RETURN NEW;
  END IF;

  -- Считаем handoff за последние 7 дней по этой задаче
  SELECT COUNT(*) INTO v_handoff_count
  FROM agent_events
  WHERE task_id    = NEW.task_id
    AND tool       = 'handoff_task'
    AND created_at > NOW() - INTERVAL '7 days';

  -- Алерт при достижении порога 3+ (и далее при каждом кратном 3)
  -- Кратность 3 предотвращает спам при длинных цепочках (3, 6, 9, ...)
  IF v_handoff_count >= 3 AND v_handoff_count % 3 = 0 THEN

    -- Получаем контекст задачи
    SELECT t.title, t.workspace_id,
           w.task_prefix || '-' || t.task_number::text
    INTO v_task_title, v_workspace_id, v_full_id
    FROM tasks t
    JOIN workspaces w ON w.id = t.workspace_id
    WHERE t.id = NEW.task_id;

    -- Отправляем алерт через send_alert_immediate (§5.1, дедупликация 2ч)
    PERFORM send_alert_immediate(
      v_workspace_id,
      'handoff_chain',
      NEW.task_id,
      format(
        '🔄 %s передавалась агентами %s раз за 7 дней без завершения. Проверь задачу.',
        COALESCE(v_full_id, NEW.task_id::text),
        v_handoff_count
      )
    );

  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_handoff_chain_alert
AFTER INSERT ON agent_events
FOR EACH ROW
EXECUTE FUNCTION notify_handoff_chain();
```

> **Порог кратности:** алерт при 3, 6, 9... handoff. При 3 — первое предупреждение.
> При 6 — повторное если проблема не решена. Не спамит при каждом новом handoff.
> Дедупликация `send_alert_immediate` (2 часа) дополнительно защищает от burst.

> **Связь с cron §5.4:** `trg_handoff_chain_alert` — горячий путь (срабатывает немедленно).
> `handoff_chain` VIEW в cron — резервный канал для catch-up если триггер не сработал
> (например, задача была создана до v0.12.0).

> **Совместимость с `app.skip_alert_triggers`:** этот триггер не использует сессионную
> переменную — `handoff_task` всегда вызывается агентом через MCP, никогда из автоматики.
> Пропускать алерт не нужно.

---

## 6. Интеграция с Flow Board (UI)

Flow Board читает вьюхи при загрузке и подписывается на Supabase Realtime на изменения в `tasks`.
Telegram-алерты доставляются через `enrichment_queue` ботом.

**Резолюция workspace:** `enrichment_queue.workspace_id` — единственный источник истины для Bot-воркера.

**Новые аномалии в UI (v1.6):**
- `orphan_blocker` → Risk Pulse «Процессы» (счётчик увеличивается, drill-down в Task Sheet)
- `handoff_chain` → Risk Pulse «Эскалации» нет; отдельный Telegram-алерт оператору.
  В Worker Sheet агента — pill «Цепочка ×N» при `handoff_count ≥ 3` (flow_.md §20, Phase 1.1)

---

## 7. Отношение к AI-полям

`ai_hint` (LLM) не удаляется. SQL-паттерны генерируют **системные алерты** уровня потока
(Flow Board, Telegram). `ai_hint` — микро-уровень карточки задачи. Разные слои, не пересекаются.

---

## 8. Индексы

```sql
-- Stuck / stale_blocked
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_column_moved_at
  ON tasks (column, moved_to_column_at) WHERE column != 'done';

-- Overloaded workers
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_assigned_to_column
  ON tasks (assigned_to, column) WHERE is_blocked = false;

-- Velocity drop
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_task_column_history_moved_at_done
  ON task_column_history (task_id, moved_at) WHERE to_column = 'done';

-- flow_config lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workspace_settings_flow_config
  ON workspace_settings ((flow_config->>'overload_threshold'));

-- Дубликаты (GIN trgm)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_title_trgm
  ON tasks USING gin(title gin_trgm_ops) WHERE column != 'done';

-- Эскалации
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_needs_human
  ON tasks (needs_human, column) WHERE needs_human = true AND column != 'done';

-- Review backlog
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_reviewer_column
  ON tasks (reviewer_id, column) WHERE column = 'review';

-- attention_risk_pulse (§3.9): context_switches_today sub-query
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_task_column_history_moved_by_date
  ON task_column_history (moved_by, moved_at)
  WHERE moved_by IS NOT NULL;
  -- Ускоряет worker_switch_metrics CTE
  -- Без индекса: seq scan при > 10k строк

-- assignment_history (Master §6.14) — сводная копия; канонические определения в Master §6.14
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_assignment_history_workspace
  ON assignment_history (workspace_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_assignment_history_assignee
  ON assignment_history (assignee_id, assigned_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_assignment_history_task
  ON assignment_history (task_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_assignment_history_pending
  ON assignment_history (workspace_id, outcome_status)
  WHERE outcome_status = 'pending';

-- ── task_relations (Master §6.16) — сводная копия; канонические определения в Master §6.16 ──

-- orphan_blockers (§3.10): поиск активных блокеров по to_task_id
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_task_relations_to_blocks
  ON task_relations (to_task_id, relation_type, workspace_id)
  WHERE relation_type = 'blocks';
  -- Ускоряет EXISTS sub-query в orphan_blockers VIEW:
  -- WHERE tr.to_task_id = t.id AND tr.relation_type = 'blocks'
  -- Без индекса: seq scan task_relations при каждом запросе VIEW

-- handoff_chain (§3.11): поиск handoff событий по task_id и времени
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_events_handoff_task
  ON agent_events (task_id, tool, created_at)
  WHERE tool = 'handoff_task';
  -- Ускоряет COUNT(*) в handoff_chain VIEW и notify_handoff_chain() триггере
  -- Без индекса: full scan agent_events при каждом INSERT handoff_task

-- trg_cascade_unblock (Master §6.16): проверка блокеров при done-переходе
-- Канонический индекс idx_task_relations_blocks уже определён в Master §6.16.
-- Дополнительный индекс для JOIN на blocker column:
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_id_column
  ON tasks (id, column);
  -- Ускоряет: JOIN tasks blocker ON blocker.id = tr.from_task_id WHERE blocker.column != 'done'
  -- в cascade_unblock() и orphan_blockers VIEW
```

---

## Changelog

**v1.6 — июнь 2026**
- §1: добавлены `orphan_blocker` и `handoff_chain` в список SQL-аномалий
- §2: добавлена ссылка на `task_relations` (Master §6.16) и INV-13 в предварительные требования
- §3.9: добавлена заметка Phase 1.1 — `blocking_depth` из `task_relations` (вес ×8) повысит точность `attention_risk_pulse` на 15–20%; текущий `blocked_tasks` (is_blocked флаг, вес ×12) остаётся как частичная замена до Phase 1.1
- §3.10 (новый): VIEW `orphan_blockers` — задачи с `is_blocked=true` без активных блокеров в `task_relations`; сценарий Phantom Block; примечание о задачах без рёбер (данные до v0.12.0)
- §3.11 (новый): VIEW `handoff_chain` — задачи с ≥3 handoff за 7 дней без перехода в done; порог и семантика задокументированы; исключены задачи с `needs_human=true` (не дублируем pending_escalations)
- §4: Edge Function расширена обработчиками `orphan_blocker` (блок 6) и `handoff_chain` (блок 7); добавлена таблица допустимых `alert_type` значений для Bot-воркера
- §5.5: удалён дублирующийся код `trigger_resolution_notify` и `trg_resolution_notify` который артефактом появился в конце §5.6 в предыдущей версии (баг редактирования v1.5)
- §5.7 (новый): триггер `trg_handoff_chain_alert` — AFTER INSERT ON agent_events WHERE tool='handoff_task'; порог ≥3 с кратностью 3 (алерт при 3, 6, 9...); использует `send_alert_immediate` §5.1; не использует `app.skip_alert_triggers` (handoff всегда от агента); совместимость с cron-каналом задокументирована
- §6: добавлены UI-примечания для `orphan_blocker` и `handoff_chain` (Risk Pulse, Worker Sheet pill Phase 1.1)
- §8: добавлены индексы `idx_task_relations_to_blocks` (orphan_blockers EXISTS sub-query), `idx_agent_events_handoff_task` (handoff_chain COUNT + триггер), `idx_tasks_id_column` (cascade_unblock JOIN); сводная копия индексов task_relations с пометкой о канонических определениях в Master §6.16

**v1.5 — июнь 2026**
- §3.9 (новый): VIEW `attention_risk_pulse`
- §5.5: исправлен дублирующийся вводный абзац
- §5.6 (новый): триггер `trg_update_assignment_outcome`
- §8: добавлен `idx_task_column_history_moved_by_date`; индексы assignment_history

**v1.4 — май 2026**
- §5.5: `trigger_resolution_notify()` + `trg_resolution_notify`; закрывает P0-02
- §5.2: заметка о парном цикле escalation ↔ resolution

**v1.3 — май 2026**
- §3.2: `AND t.is_inbox = false` в overloaded_workers
- §3.2: источник `cognitive_weight` → `tasks.cognitive_weight` (A-5)

**v1.2 — май 2026**
- `enrichment_queue.workspace_id NOT NULL`; `'duplicate_check'` в CHECK
- §5.3: Вариант Б — триггер только ставит задание в очередь; воркер сканирует вне транзакции
- UNIQUE индекс дедупликации duplicate_check → Master §6.5

**v1.1 — май 2026**
- §3.1: убран дублирующий WHERE
- §3.2: workspace_id в ON-блоке LEFT JOIN
- §3.6: убран несуществующий t.story_points
- §3.8: убран лишний IS NOT NULL
- §5.2, §5.3: сессионная защита → `app.skip_alert_triggers`

---

*onitask · SQL-паттерны для аномалий и алертов · v1.6 · июнь 2026*
