# onitask · Team Tab — Product Spec

**Версия:** 1.3.0
**Дата:** июнь 2026
**Статус:** ⚠️ Deprecated — содержимое перенесено в `onitask_flow_.md` §19–22

> **Этот документ сохраняется как справочник** для SQL-запросов (§4), MCP tool escalate_task (§3) и Operator Queue SQL (§2.7) до завершения полной миграции в `onitask_flow_.md`.
> Актуальная UX-спека — см. [Flow Board §19–23](onitask_flow_.md#19-risk-pulse--пульс-команды-перенесено-из-team-tab).
>
> **Схема БД** — см. [Master Spec](onitask_Architecture_Master_.md), раздел 6.
> Поля `tasks.needs_human`, `tasks.escalation_reason`, `agent_events.from_column / to_column` — [Master Spec 6.1](onitask_Architecture_Master_.md#61-изменения-существующих-таблиц).
> Поля `tasks.handoff_to`, `tasks.handoff_notes` — [Master Spec 6.1](onitask_Architecture_Master_.md#61-изменения-существующих-таблиц).
> Поле `tasks.task_number` и нумерация задач (ALPHA-123) — [Master Spec 6.12](onitask_Architecture_Master_.md#612-нумерация-задач-task-id).
> Поле `workspace_settings.velocity_window_days` — [Master Spec 6.4](onitask_Architecture_Master_.md#64-настройки-воркспейса).
> История перемещений `task_column_history` — [Master Spec 6.3](onitask_Architecture_Master_.md#63-история-перемещений-задач).

---

## 1. Контекст и цель

Вкладка Team — игровой дашборд команды. Не список настроек, не дублирование Flow Board, а ответ на один вопрос лида: **«с каждым участником и агентом всё в порядке прямо сейчас?»**

Целевые пользователи:
- **Тимлид / ПМ** — сканирует состояние команды, выявляет блоки и риски спринта
- **Оператор агентного флоу** — мониторит автономных агентов, разблокирует эскалации

Принципиальные ограничения дизайна:
- Дублирование Flow Board запрещено — sprint progress bar, WIP counts по колонкам убраны
- Все метрики должны быть actionable — метрика ради метрики не включается
- Telegram SDK: invite flow только через реферальные ссылки, online-статус недоступен

---

## 2. Архитектура экрана

### 2.1 Risk Pulse — верхняя панель

> ⚠️ **Deprecated UX-раздел.** Актуальная спека — [flow_.md §19](onitask_flow_.md#19-risk-pulse--пульс-команды-перенесено-из-team-tab). Ниже — исходная спека для справки.

Три агрегированных сигнала. Instant tier, без LLM. **Все три сигнала — tappable.**

**Скоуп:** только текущий workspace. Глобальные алерты по всем workspace — в Workspace Manager.

| Сигнал | Прежнее название | Источник данных | Порог | Tap-действие |
|---|---|---|---|---|
| **Люди** | Перегружены | `COUNT(workers WHERE F-01.used = 3)` — когнитивный бюджет на пределе (шкала 0–3) | > 0 → red | Drill-down: карточки участников с `F-01.used = 3` |
| **Процессы** | Ревью-блок | `COUNT(review_backlog) + COUNT(stuck_tasks)` — суммарно блокировок флоу | > 0 → amber | Drill-down: ревью-блок (reviewer COUNT > 2) + stuck задачи |
| **Эскалации** | Эскалации | `COUNT(tasks WHERE needs_human = true AND workspace_id = $ws)` | > 0 → amber | Открывает **Operator Queue** §2.7 |

**Важно по «Люди»:** источник — F-01 cognitive_budget (`ai_.md §1`), шкала 0–3, `used = MAX_SLOTS = 3`. Это **не** `overloaded_workers` view (которая использует `flow_config.overload_threshold = 6`). В Risk Pulse показывается COUNT людей на пределе, детали нагрузки — в drill-down карточке.

**Важно по «Процессы»:** один суммарный счётчик объединяет два сигнала:
- `review_backlog` — reviewer с COUNT задач в review > 2
- `stuck_tasks` — задачи > `flow_config.stuck_threshold_hours` без движения

Оба — блокировки флоу, не нарушения когнитивного бюджета и не эскалации агентов.

**Предупреждение при отсутствии Telegram-чата (P1-10):**

Если сигнал «Эскалации» > 0 И в `workspace_telegram_chats` нет активных записей для данного workspace — сигнал отображается с суффиксом:

```
⚠️ Эскалации 3 · уведомления выключены
```

Суффикс «· уведомления выключены» — это tappable ссылка, которая открывает настройки workspace на разделе «Telegram-чаты».

### 2.2 Карточки участников — collapsed

Одна строка на участника. Цель — сканирование 15–20 человек без скролла внутри карточки.

Анатомия строки:
- **Слева:** аватар (инициалы) + имя + pill если есть флаг (Перегружен / Ревью ×N)
- **По центру:** мини-строка активной задачи с суффиксом дней на задаче (`5д↑` красным если > ETA). Для ревью-блока без активной задачи: «Ждут её ревью · очередь» с ◆ иконкой
- **Справа:** когнитивные точки (●●○) + SP/день

Когнитивные точки:
- 1/3 или 2/3 → amber fill
- 3/3 → red fill + pill «Перегружен»
- 0/3 + нет задачи → серые точки, строка задачи с italic «Нет активных задач · уточни статус»

### 2.3 Карточки участников — expanded (bottom sheet)

Три смысловых блока.

**Блок «Прямо сейчас»:**
- Активная задача: название + SP + количество дней на задаче + ETA (`task.story_points / sp_per_day`)
- ETA drift: если `days_on_task > ETA_days` — суффикс ↑, красный цвет
- Queue depth: COUNT задач assigned + `column IN ('backlog', 'todo')`
- Review load: COUNT задач WHERE `reviewer_id = member AND column = 'review'`

**Блок «Velocity · 14 дней»:**
- SP закрыто за rolling window 14 дней из `tasks + task_enrichments`
- SP / день = `sp_closed / velocity_window_days`
- Прогноз спринта = `sp_per_day × sprint_days_total`
- Назначено в спринте = SUM(story_points) assigned задач в current sprint
- Gap = назначено − прогноз → красный если > 0 (риск недовыполнения)
- Точность прогноза — суффикс на значении SP/день:
  - `3.5 SP/д` — задач ≥ 3 за window (достаточно данных)
  - `1.3 SP/д~` — задач 1–2 (мало данных)
  - `—` — задач 0
- Rework: COUNT переходов `review → in_progress` за 14д из `task_column_history`. Показывается только если > 0

**Блок «По статусам»:**
Chips: В работе / Ревью / Заблокировано — только ненулевые.

**Actions (Admin/Owner only):**
- Сменить роль → inline select внутри sheet
- Удалить → confirm dialog

### 2.4 Карточки агентов — collapsed

| Элемент | Описание |
|---|---|
| Слева | ◆ иконка + имя агента + pill «Эскал. ×N» если есть pending эскалации |
| Слева | pill «Передано →» amber если `handoff_to = agent.worker_id` (входящий handoff ждёт принятия) |
| По центру | мини-строка активной задачи или «Ждёт решения оператора» amber italic |
| Справа | throughput (задач/день) с цветовым кодированием + queue depth |

Цветовая шкала throughput:

| Throughput | Цвет | Значение |
|---|---|---|
| ≥ 1.5 /д | green | Агент работает нормально |
| 0.5–1.4 /д | amber | Замедлился, возможно есть блоки |
| < 0.5 /д | red | Практически остановился |

### 2.5 Карточки агентов — expanded (bottom sheet)

**Interpretation hint** — автоматическая строка интерпретации:
- `throughput ≥ 1.5` AND `escalation_rate ≤ 20%` AND `rework_rate ≤ 15%` → «Агент работает стабильно»
- `throughput < 0.5` AND `escalation_n > 0` → «Агент остановился. Разблокируй задачи — агент возобновит флоу»
- иначе → «Агент работает, но есть вопросы. Проверь эскалации»

**Блок «Входящий handoff»** (отображается если `handoff_to = agent.worker_id`):

Карточка передачи:
- Full ID задачи (ALPHA-123) + название
- Имя передавшего агента (из `agent_events WHERE tool = 'handoff_task'`)
- `handoff_notes` — контекст от передавшего агента
- Время с момента передачи
- Кнопка «Взять в работу» → `move_task` → `in_progress` (сбрасывает `handoff_to` и `handoff_notes`)

**Блок «Флоу · 7 дней»:**

| Метрика | Отображение в UI | Формула | Хорошо | Плохо |
|---|---|---|---|---|
| Задач / день | «Задач/день» | done tasks за 7д / 7 | ≥ 1.5 | < 0.5 |
| В очереди | «В очереди» | COUNT tasks WHERE `column IN ('backlog', 'todo')` | контекст | очень много |
| % эскалаций | «% эскалаций» | `escalate_task` events / DISTINCT tasks × 100% | ≤ 20% | > 40% при низком throughput |
| % возвратов | «% возвратов» | задачи done → вернули назад / total done × 100% | ≤ 15% | > 30% |

> Термины в коде и SQL остаются английскими (`throughput`, `escalation_rate`, `rework_rate`). В UI используются русские: «Задач/день», «% эскалаций», «% возвратов». Техническое слово «Handoff» сохраняется в UI — перевод «Передача» не передаёт смысл (плановая передача эстафеты между агентами, не эскалация).

**Блок «Ждут решения оператора»:**

Список задач с `needs_human = true`. Каждая карточка:
- Название задачи
- Причина эскалации (readable label из enum)
- Заметка агента (`suggested_action` из `escalate_task`)
- Время с момента эскалации

**Блок «Последние события»:**

Task name как первичный элемент. Для `move_task`: `from_column → to_column` (красный если backward). Для `escalate_task`: «↑ эскалация» amber.

### 2.6 Invite FAB

Кнопка внизу экрана. Генерирует реферальную ссылку `t.me/onitask_bot?start=ws_INVITE_CODE`. Открывает Telegram Share Sheet через `openTelegramLink`. При использовании ссылки — бот ассоциирует пользователя с workspace.

Pending invites (Admin only) — список выданных кодов без активации в expanded view настроек workspace.

---

### 2.7 Operator Queue — единая очередь эскалаций (P1-08)

Открывается тапом на сигнал «Эскалации N» в Risk Pulse §2.1, а также через deep link из Telegram-уведомления (bot.md §5.8). Показывает **все** задачи с `needs_human = true` по всему workspace в одном flat-списке — независимо от того, какой агент их эскалировал.

**Источник данных:** вьюха `pending_escalations` из `onitask_sql_anomalies_.md` §3.7.

**Сортировка:** oldest-first (`moved_to_column_at ASC`) — самые давние ждут дольше всех.

**Анатомия карточки в очереди:**

```
┌─────────────────────────────────────────────────────┐
│ ALPHA-45 · «Реализовать переключение темы»          │
│ ◆ Cursor · conflicting_requirements · 2ч 14м назад  │
│                                                     │
│ «Клиент хочет и dark mode и light mode              │
│  одновременно — нужно уточнение приоритетов»        │
│                                                     │
│ [Разрешить]   [Открыть задачу →]                    │
└─────────────────────────────────────────────────────┘
```

Поля карточки:
- **Full ID** (ALPHA-N) + **название задачи** — primary элемент
- **Иконка агента** (◆) + **имя агента** + **readable label причины** + **время с момента эскалации**
- **`suggested_action`** — заметка агента (только если заполнена; макс. 2 строки, expand по тапу)
- **[Разрешить]** — primary action: `UPDATE tasks SET needs_human = false`. После — карточка исчезает из очереди, `trg_resolution_notify` отправляет уведомление агенту
- **[Открыть задачу →]** — secondary action: deep link в bottom sheet задачи с полным контекстом

**Readable labels для `escalation_reason`:**

| enum value | Отображаемый текст |
|---|---|
| `insufficient_context` | Недостаточно контекста |
| `conflicting_requirements` | Конфликт требований |
| `blocked_by` | Заблокирована |
| `out_of_scope` | Вне области задачи |

**Пустое состояние:** «Все задачи в работе — эскалаций нет ✓»

**Входящий deep link из Telegram** (bot.md §5.8): если очередь открылась по deep link с `?task=ALPHA-45`, карточка ALPHA-45 подсвечивается и прокручивается в начало списка.

**Связанный SQL:**

```sql
-- Данные для Operator Queue
-- Источник: pending_escalations (onitask_sql_anomalies_.md §3.7)
-- Расширяем: добавляем display_name агента и full_id задачи
SELECT
  t.id,
  w.task_prefix || '-' || t.task_number::text  AS full_id,
  t.title,
  t.escalation_reason,
  t.workspace_id,
  wr.display_name                              AS assigned_agent,
  t.moved_to_column_at,
  EXTRACT(EPOCH FROM (NOW() - t.moved_to_column_at)) / 3600 AS hours_pending,
  ae.metadata->>'suggested_action'             AS suggested_action
FROM tasks t
LEFT JOIN workers wr ON t.assigned_to = wr.id AND t.workspace_id = wr.workspace_id
JOIN workspaces w    ON w.id = t.workspace_id
LEFT JOIN LATERAL (
  SELECT metadata FROM agent_events
  WHERE task_id = t.id AND tool = 'escalate_task'
  ORDER BY created_at DESC LIMIT 1
) ae ON TRUE
WHERE t.needs_human = true
  AND t.column != 'done'
  AND t.workspace_id = $ws
ORDER BY t.moved_to_column_at ASC;
```

---

## 3. MCP Tool: escalate_task

Критически важен для автономного агентного флоу. Без него агент при затруднении молча зависает или делает неверный ход.

### 3.1 Сигнатура

```typescript
escalate_task({
  task_id:          string,
  reason:           'insufficient_context'
                  | 'conflicting_requirements'
                  | 'blocked_by'
                  | 'out_of_scope',
  suggested_action?: string  // заметка агента оператору
})
```

### 3.2 Эффекты

- `tasks.needs_human = true`
- `tasks.escalation_reason = reason`
- Запись в `agent_events` с `tool = 'escalate_task'`
- Уведомление в `workspace_telegram_chats` если подключён

### 3.3 Семантика

Высокий `escalation_rate` — не плохо сам по себе. Честный агент, который эскалирует проблемы, лучше агента с 0% эскалаций и низким throughput — второй молча буксует.

**Плохая комбинация:** `escalation_rate > 40%` AND `throughput < 0.5` — агент не справляется с типом задач или системный промпт требует доработки.

---

## 4. Ключевые запросы

### 4.1 Velocity участника

```sql
SELECT
  w.id,
  w.display_name,
  COUNT(t.id) FILTER (WHERE t.column = 'in_progress')  AS in_progress,
  COUNT(t.id) FILTER (WHERE t.column = 'review')       AS in_review,
  COUNT(t.id) FILTER (WHERE t.is_blocked)              AS blocked,
  COALESCE(SUM(te.story_points) FILTER (
    WHERE t.column = 'done'
    AND t.moved_to_column_at > NOW() - make_interval(
      days => ws.velocity_window_days)
  ), 0)::float / ws.velocity_window_days  AS sp_per_day
FROM workers w
LEFT JOIN tasks t
  ON t.assigned_to = w.id AND t.workspace_id = $ws
LEFT JOIN task_enrichments te ON te.task_id = t.id
JOIN workspace_settings ws ON ws.workspace_id = $ws
WHERE w.id = ANY($member_ids)
  AND w.type = 'human'
GROUP BY w.id, w.display_name, ws.velocity_window_days

> **Примечание:** `story_points` берётся из `task_enrichments`. Задачи без завершённого enrichment молча выпадают через `COALESCE(..., 0)` — velocity при этом занижена, но не ломается. При аномально низкой velocity стоит проверить `enrichment_queue` на `status = 'failed'` или `'stuck'` записи.
```

> `moved_to_column_at` обновляется автоматически BEFORE-триггером `trg_record_task_column_move`.
> См. [Master Spec 6.3](onitask_Architecture_Master_.md#63-история-перемещений-задач).

### 4.2 Метрики агента

```sql
-- Throughput
SELECT COUNT(*)::float / 7 AS tasks_per_day
FROM tasks
WHERE assigned_to = $agent_worker_id
  AND column = 'done'
  AND moved_to_column_at > NOW() - INTERVAL '7 days';

-- Escalation Rate
SELECT
  COUNT(*) FILTER (WHERE tool = 'escalate_task')::float /
  NULLIF(COUNT(DISTINCT task_id), 0) * 100  AS escalation_rate
FROM agent_events
WHERE agent_name = (
  SELECT source_id FROM workers WHERE id = $agent_worker_id
)
  AND created_at > NOW() - INTERVAL '7 days';

-- Rework Rate (через task_column_history)
-- Примечание: self-join тяжёлый при большом объёме. На MVP достаточно с составным индексом
-- idx_task_column_history_rework (task_id, moved_at, from_column, to_column).
-- Порог миграции: EXPLAIN ANALYZE показывает seq scan > 50ms на task_column_history
-- при типичном запросе (мониторить в Supabase Dashboard → Query Performance).
-- Post-MVP при достижении порога: заменить на денормализованное поле
-- tasks.rework_count (инкрементируется триггером при переходе done → любая другая колонка).
SELECT COUNT(*) FILTER (WHERE moved_back)::float /
  NULLIF(COUNT(*), 0) * 100  AS rework_rate
FROM (
  SELECT ch.task_id,
    EXISTS(
      SELECT 1 FROM task_column_history ch2
      WHERE ch2.task_id = ch.task_id
        AND ch2.from_column = 'done'
        AND ch2.moved_at BETWEEN ch.moved_at
          AND ch.moved_at + INTERVAL '7 days'
    ) AS moved_back
  FROM task_column_history ch
  WHERE ch.moved_by = $agent_worker_id
    AND ch.to_column = 'done'
) sub;

-- Queue Depth
SELECT COUNT(*) FROM tasks
WHERE assigned_to = $agent_worker_id
  AND column IN ('backlog', 'todo');
```

---

## 5. Тиры реализации

| Фича | Tier | Зависимости |
|---|---|---|
| Risk Pulse (3 сигнала) | MVP | Существующие таблицы |
| Risk Pulse — tappable drill-down | MVP | Highlight логика в UI |
| Risk Pulse — предупреждение «уведомления выключены» | MVP | `workspace_telegram_chats` lookup |
| Карточки участников collapsed | MVP | sp_per_day query |
| Bottom sheet участника — Прямо сейчас | MVP | `task_column_history.moved_by` |
| Bottom sheet участника — Velocity | MVP | `velocity_window_days` в workspace_settings |
| Invite FAB + реферальная ссылка | MVP | Bot handler |
| **Operator Queue §2.7** | **MVP** | `pending_escalations` view + `workspaces.task_prefix` |
| Карточки агентов collapsed | Phase 1.1 | `agent_events.from_column / to_column` |
| Bottom sheet агента — Флоу метрики | Phase 1.1 | `escalate_task` MCP tool |
| Блок эскалаций в expanded sheet агента | Phase 1.1 | `needs_human + escalation_reason` |
| Workspace Settings (Admin) | Phase 1.1 | `velocity_window_days` |
| Role change inline в sheet | Phase 1.2 | — |

---

## 6. Открытые вопросы

- Role change — inline select в bottom sheet или отдельный экран?
- Если `story_points_config.enabled = false` — velocity блок скрыт целиком. Чем заменить третий chip в collapsed (SP/д)?
- Queue depth агента — алерт при очереди > N при низком throughput: **решение отложено (P2)**. На MVP Operator Queue §2.7 покрывает ситуацию через эскалации. Threshold-алерт рассмотреть в Phase 2 после накопления данных о типичном queue depth по workspace.

---

## Changelog

**v1.3.0 — июнь 2026**
- Статус изменён на Deprecated. Содержимое перенесено в `onitask_flow_.md` §19–23
- §2.1: Risk Pulse — переименованы сигналы: «Перегружены» → «Люди», «Ревью-блок» → «Процессы». Уточнён источник «Люди»: `F-01.used = 3` (шкала 0–3), не `overloaded_workers` view (порог 6). «Процессы» объединяет `review_backlog` + `stuck_tasks` в один суммарный счётчик. Добавлена колонка «Прежнее название» для трассируемости
- §2.5: таблица «Флоу · 7 дней» — добавлена колонка «Отображение в UI». Терминология зафиксирована: «% эскалаций» (не «Escalation rate»), «% возвратов» (не «Rework rate»), «Задач/день» (не «Throughput»). «Handoff» сохранён как технический термин без перевода
- §2.1, §2.4: скоуп Risk Pulse зафиксирован — только текущий workspace. Глобальные алерты → Workspace Manager (flow_.md §23)

**v1.2.0 — май 2026**
- §2.1: Risk Pulse — все три сигнала стали tappable с drill-down навигацией. Таблица расширена колонкой «Tap-действие». Закрывает P1-07
- §2.1: добавлено предупреждение «· уведомления выключены» на сигнале «Эскалации» при отсутствии активного `workspace_telegram_chats`. Суффикс — tappable ссылка в настройки. Закрывает P1-10
- §2.7 (новый): Operator Queue — flat-список всех `needs_human=true` задач по workspace. Oldest-first. Карточка: full_id, title, агент, readable reason label, suggested_action, [Разрешить] + [Открыть задачу →]. Deep link из Telegram-уведомления подсвечивает конкретную задачу. SQL-запрос с join на `workspaces.task_prefix`. Закрывает P1-08
- §5: Risk Pulse drill-down и Operator Queue добавлены в тиры как MVP. Блок эскалаций в expanded sheet агента переименован и отделён от Operator Queue
- §6: queue depth threshold alert задокументирован как P2 отложенное решение

---

*onitask · Team Tab Spec · v1.3.0 · июнь 2026 · Deprecated*
