# onitask · Flow Board — Концептуальный документ

**Версия:** 3.6.0
**Дата:** июнь 2026
**Статус:** Концепт → готов к F-07

> **Схема БД** (workers, sprints, task_column_history, task_relations) — см. [Master Spec](onitask_Architecture_Master_.md), разделы 4, 6.2, 6.3, **6.16**.
> **Настройки воркспейса** (`flow_config`, `overload_threshold`) — см. [Master Spec](onitask_Architecture_Master_.md), раздел 8.
> **Risk Pulse, Worker Sheet, Operator Queue** — перенесены из `onitask_team_tab.md` (v3.4.0).
> **Аксиома A-12 (Relational Context Layer)** — см. Master Spec §3.

---

## 1. Ключевой тезис

Flow — **диспетчерская для смешанных команд**, где исполнитель — любой worker: человек или AI-агент. Flow не знает разницы между ними. Он видит задачи, нагрузку и активность.

Три утренних вопроса менеджера:

1. **Что стоит?** — блокеры, зависшие задачи, аномалии
2. **Идём по плану?** — прогресс спринта, WIP по колонкам
3. **Кому помочь?** — нагрузка workers, предложение от AI

### Навигация TWA (две вкладки)

| Вкладка | Содержимое | Скоуп |
|---|---|---|
| **Задачи** (Flow Board) | Канбан, Sprint Bar, Risk Pulse, Worker Load, AI Flow Summary, Operator Queue | Один workspace |
| **Доски** (Workspace Manager) | Список workspace пользователя, глобальные алерты, переключение | Все workspace пользователя |

**Team Tab упразднён** — содержимое перенесено в Flow Board (§19–22) и Workspace Manager (§23). `onitask_team_tab.md` переведён в статус Deprecated.

---

## 2. Колонки (сквозные для всей системы)

| Логическое название | column в БД | Назначение |
|---|---|---|
| Надо сделать | backlog | Готовые к выполнению задачи |
| В работе | in_progress | Активные задачи, участвуют в когнитивном бюджете |
| На проверке | review | Задачи, ожидающие ревью |
| Готово | done | Завершённые задачи |

**Заблокировано — флаг `tasks.is_blocked`, не отдельная колонка.** Заблокированная задача остаётся в своей колонке, флаг влияет на аномалию `stuck_in_column`.

---

## 3. Роли и доступ

| Роль | Flow (доска) | AI-функции в Flow | Перемещение чужих задач | Назначить себя из backlog |
|---|---|---|---|---|
| Admin / Owner | ✅ полная | ✅ | ✅ | ✅ |
| Member | ✅ только колонки | ❌ | ❌ | ✅ |

Member видит доску — нужен контекст команды. AI-инсайты только для Admin/Owner.
Изменение `workspace_settings` — только Admin/Owner.

---

## 4. Stream — персональная лента

Показывает только задачи, где пользователь участвует.

| Секция | Условие |
|---|---|
| Фокус | `assigned_to = me`, `column = 'in_progress'` |
| В работе | `assigned_to = me`, `column = 'in_progress'` |
| На проверке | `reviewer_id = me`, `column = 'review'` |
| Надо сделать | `assigned_to = me`, `column = 'backlog'`, `is_inbox = false` |
| Черновики | `assigned_to = me`, `is_inbox = true` |

Секции отображаются только если есть задачи. Блоки «В работе» и «На проверке» независимы.

---

## 5. Когнитивный бюджет (F-01)

```sql
cognitive_budget = SUM(cognitive_weight)
  WHERE (assigned_to = me AND column = 'in_progress')
     OR (reviewer_id = me AND column = 'review')
```

Ревью чужого кода — реальная когнитивная нагрузка. AI Flow Summary не предлагает задачи перегруженному reviewer.

---

## 6. Модель Worker в Flow

Полное определение — см. [Master Spec раздел 4](onitask_Architecture_Master_.md#4-единая-модель-worker).

| Атрибут | Человек | AI-агент |
|---|---|---|
| Иконка | Аватар (инициалы) | Ромб (◆) |
| source_id | profiles.id | 'agent::name' |
| Нагрузка | cognitive_weight задач | то же |
| Активность | ручные действия | agent_events |

Неактивные агенты (`is_active = false`) не отображаются в Worker Load, история сохраняется.

---

## 7. Спринты

Полное DDL — см. [Master Spec раздел 6.2](onitask_Architecture_Master_.md#62-спринты).

Поведение:
- В статусе `planning` задачи добавляются, метрики в UI не отображаются
- `is_inbox` и `sprint_id` ортогональны
- `capacity` из `workspace_settings.story_points_config.sprint_max_capacity`

**Enrichment race с sprint capacity:**

```typescript
supabase.channel('enrichment')
  .on('broadcast', { event: 'enrichment_done' }, ({ payload }) => {
    if (payload.sprint_id === currentSprintId && payload.story_points_changed) {
      showToast({
        type:    'info',
        message: `Оценка ${payload.full_id} обновлена · проверь capacity спринта`,
        action:  { label: 'Посмотреть', onClick: () => scrollToTask(payload.task_id) }
      });
      refetchSprintMetrics();
    }
  })
  .subscribe();
```

---

## 8. История перемещений

Полное DDL и триггер — см. [Master Spec раздел 6.3](onitask_Architecture_Master_.md#63-история-перемещений-задач).

`moved_to_column_at` обновляется BEFORE-триггером. Cycle time per stage через `task_column_history` — post-MVP.

---

## 9. Пример ответа `/api/flow/metrics`

```json
{
  "sprint": {
    "id": "uuid",
    "name": "Sprint 3 — Auth & MCP",
    "start_date": "2026-05-19",
    "end_date": "2026-06-01",
    "status": "active",
    "capacity": 34,
    "completed_points": 21,
    "days_left": 10
  },
  "columns": [
    { "name": "backlog",     "wip_current": 8,  "wip_limit": 15, "health": "green", "avg_cycle_time_hours": null },
    { "name": "in_progress", "wip_current": 5,  "wip_limit": 5,  "health": "yellow","avg_cycle_time_hours": 18.4 },
    { "name": "review",      "wip_current": 6,  "wip_limit": 4,  "health": "red",   "avg_cycle_time_hours": 9.1 },
    { "name": "done",        "wip_current": 14, "wip_limit": null,"health": "green", "avg_cycle_time_hours": null }
  ],
  "workers": [
    { "display_name": "Vadim",       "type": "human", "cognitive_load": 7, "overload_threshold": 6, "status": "overloaded" },
    { "display_name": "Cursor",      "type": "agent", "cognitive_load": 3, "overload_threshold": 6, "status": "ok" },
    { "display_name": "Claude Code", "type": "agent", "cognitive_load": 5, "overload_threshold": 6, "status": "ok" }
  ],
  "alerts": [
    { "type": "overloaded_member", "severity": "high",   "message": "Vadim перегружен: 7 / 6" },
    { "type": "bottleneck",        "severity": "high",   "column": "review", "message": "6 задач при лимите 4" },
    { "type": "stuck_in_column",   "severity": "medium", "task_id": "uuid", "stuck_since_hours": 76 }
  ],
  "cached_at": "2026-05-22T11:34:00Z",
  "cache_ttl": { "columns": 5, "workers": 60, "alerts": 60 }
}
```

---

## 10. Edge Function `/api/flow/metrics`

| Данные | TTL |
|---|---|
| Column Health (WIP) | 5 сек |
| Worker Load | 60 сек |
| AI Alerts / аномалии | 60 сек |

---

## 11. Аномалии (расширение F-03)

| Тип | Условие | Источник |
|---|---|---|
| `stuck_in_column` | `NOW() - moved_to_column_at` > порог | `stuck_tasks` VIEW |
| `overloaded_member` | `cognitive_budget` > `overload_threshold` | `overloaded_workers` VIEW |
| `bottleneck` | колонка > 80% `wip_limit` | `bottleneck_columns` VIEW |
| `orphan_blocker` | `is_blocked=true`, но все блокеры в done (v3.6.0) | `orphan_blockers` VIEW (sql_anomalies_.md §3.10) |
| `handoff_chain` | ≥3 handoff по задаче за 7 дней без перехода в done (v3.6.0) | `handoff_chain` VIEW (sql_anomalies_.md §3.11) |

Пороги в `workspace_settings.flow_config`:

```json
{ "stuck_threshold_hours": 72, "overload_threshold": 6, "wip_alert_multiplier": 1.5 }
```

SQL-реализация — см. [onitask_sql_anomalies_.md §3](onitask_sql_anomalies_.md).

> **Новые аномалии v3.6.0 (A-12):**
> `orphan_blocker` — задача заблокирована чем-то что уже завершено. Phantom lock.
> `handoff_chain` — агенты передают задачу по кругу не эскалируя. Тихое зависание.
> Оба требуют действия оператора. В UI отображаются в Risk Pulse «Процессы» (§19).

---

## 12. AI Flow Summary (расширение F-03)

**Speed Tier:** Async Cold Path — NeuralDeep Hub · GPT-OSS-120B.

Снапшот для модели:
- до 100 активных задач, сортировка по `updated_at DESC`
- до 20 последних `agent_events` за час
- `workspace_context_cache` (v3.6.0) — оперативный снапшот workspace (спринт, перегрузка, блокировки)

Примеры инсайтов:
- «Два агента взяли смежные задачи — возможен конфликт»
- «Review перегружен, In Progress почти пуст»
- «Vadim перегружен (in_progress + review), не предлагать новые задачи»
- «ALPHA-45 блокирует 3 задачи, стоит с приоритетом» (v3.6.0, из `task_relations`)

Кнопка **«Применить»** → `move_task` через MCP.
При ошибке LLM — показывать последние успешные инсайты из кэша.

---

## 13. UI гайдлайны

**Column Health Grid — layout 2×2:**

```
[ Надо сделать ]  [ В работе    ]
[ На проверке  ]  [ Готово      ]
```

**Тап по колонке → bottom sheet со списком задач:**
- Заголовок: «{Название колонки} · N задач»
- Сортировка: `moved_to_column_at ASC` для `in_progress`/`review`, приоритет для `backlog`, дата для `done`
- Каждая задача: urgency полоска + ALPHA-N + title + assignee + deadline + SP
- `is_blocked = true` → иконка 🔒 перед title + teal-border слабый (не red: блокировка ≠ критичность)
- Тап на задачу → Task Sheet (§22)
- «Ещё N задач → загрузить»

**Cascade Unblock toast (v3.6.0):**
При Realtime-событии `cascade_unblock` (enrichment_queue type='bot_notify') → toast в Flow Board:

```typescript
// Realtime subscription на cascade_unblock через enrichment_queue channel
supabase.channel('flow-alerts')
  .on('broadcast', { event: 'cascade_unblock' }, ({ payload }) => {
    showToast({
      type:    'success',
      icon:    '🔓',
      message: `${payload.completed_full_id} завершена — ` +
               `${payload.unblocked_count} задач(и) разблокированы`,
      action:  {
        label:   'Посмотреть',
        onClick: () => highlightTasks(payload.unblocked_task_ids)
      },
      duration: 5000
    });
  })
  .subscribe();
```

Toast не требует действия — сигнал что цепочка разблокирована. Подсветка задач (teal flash) опциональна.

**Обновление данных:** Realtime subscription на `tasks` + нативный refresh TG WebView.

---

## 14. Инварианты Flow

Аксиомы **A-8** (Flow Access Control), **A-9** (Cognitive Budget), **A-10** (Layered Metrics Cache),
**A-12** (Relational Context Layer) — см. [Master Spec §3](onitask_Architecture_Master_.md#3-архитектурные-аксиомы).

---

## 15. Что не входит в MVP

| Фича | Причина |
|---|---|
| Sprint burndown chart | Нет исторических данных |
| Ревью-протокол | Целевая аудитория использует GitHub |
| Sprint forecast | Требует накопленной velocity |
| Постмортем спринта | `task_column_history` содержит все данные, DDL не нужен |
| Фильтрация и поиск | По запросу пользователей |
| Экспорт метрик в CSV | По запросу пользователей |
| Уведомления при аномалиях | Bot Phase 2 |

---

## 16. Сценарии использования

**Соло-разработчик + 5 агентов:** Worker Load + AI Flow Summary + Blocker Chain в Task Sheet.

**Команда 5 человек без агентов:** WIP, нагрузка, AI-инсайты о блокерах. Flow как облегчённый Linear.

**Гибридная команда:** Менеджер видит людей, агентов и затыки в одном интерфейсе.

**Техлид с двойной нагрузкой:** Когнитивный бюджет считает in_progress + review. AI Flow Summary: «перегружен».

---

## 17. Связь с архитектурой

| Flow-фича | Speed Tier | Модуль |
|---|---|---|
| Sprint Bar | Instant (клиент) | F-01 |
| Column Health Grid | Instant + Edge (5с кэш) | `/api/flow/metrics` |
| Risk Pulse | Instant (SQL, без LLM) | `overloaded_workers`, `review_backlog`, `stuck_tasks`, `orphan_blockers`, `handoff_chain` |
| Worker Load + Worker Sheet | Edge (60с кэш) | `workers` + `task_column_history` |
| Attention Risk Score (pre-flight) | Instant (SQL VIEW, без LLM) | `attention_risk_pulse` (sql_anomalies_.md §3.9) |
| Operator Queue | Instant (SQL) | `pending_escalations` VIEW |
| Blocker Chain (Task Sheet) | Instant (SQL JOIN) | `get_task_subgraph` RPC (Master §6.16) |
| Cascade Unblock toast | Realtime (event-driven) | `trg_cascade_unblock` (Master §6.16) |
| AI Flow Summary | Async (Cold Path) · NeuralDeep | F-03 + `workspace_context_cache` |
| AI Alerts | Edge (60с кэш) | F-03 |
| Workspace Manager | Edge (60–300с кэш) | `/api/workspaces/summary` |

---

## 18. Empty State

При `COUNT(tasks) = 0` — три action tile:

```
┌─────────────────────────────────────────────────────────────┐
│  ✦  Добавь первую задачу                  [Создать задачу]  │
│  👤  Пригласи команду                  [Пригласить участн.] │
│  ◆  Подключи AI-агента                    [Настроить MCP →] │
└─────────────────────────────────────────────────────────────┘
```

При первой задаче tile исчезают. Sprint Bar скрыт при 0 задачах.

---

## 19. Risk Pulse — пульс команды

Три агрегированных сигнала. Instant tier, без LLM. Все tappable. Скоуп — только текущий workspace.

| Сигнал | Источник данных | Порог | Tap-действие |
|---|---|---|---|
| **Люди** | `COUNT(workers WHERE F-01.used = 3)` | > 0 → red | Карточки перегруженных |
| **Процессы** | `review_backlog + stuck_tasks + orphan_blockers` (v3.6.0) | > 0 → amber | Drill-down: ревью-блок + stuck + orphan |
| **Эскалации** | `COUNT(tasks WHERE needs_human=true)` | > 0 → amber | Operator Queue (§21) |

**Уточнение «Люди»:** `F-01.used = 3` — когнитивный бюджет на максимуме (шкала 0–3). Не `overloaded_workers` view.

**Уточнение «Процессы» (v3.6.0):**

```sql
-- Процессы = ревью-блок + stuck + orphan_blockers
SELECT (
  SELECT COUNT(DISTINCT reviewer_id) FROM review_backlog WHERE workspace_id = $ws
) + (
  SELECT COUNT(*) FROM stuck_tasks WHERE workspace_id = $ws
) + (
  SELECT COUNT(*) FROM orphan_blockers WHERE workspace_id = $ws  -- добавлено v3.6.0
) AS process_issues
```

> `orphan_blockers` (sql_anomalies_.md §3.10) — задачи с `is_blocked=true` у которых все блокеры
> в `done`. Тихий phantom lock: пользователь не понимает почему задача стоит.
> Тап на «Процессы» → drill-down показывает три группы: ревью-блок / stuck / orphan.

**Предупреждение при отсутствии Telegram-чата:**
```
⚠️ Эскалации 3 · уведомления выключены
```
Tappable → настройки workspace → «Telegram-чаты».

---

## 20. Worker Load — нагрузка команды

**Человек (collapsed):**
- Аватар + имя + тег HMN
- Прогресс-бар нагрузки
- Подпись: `N/M · in_progress(X) + review(Y)`
- Pill «Перегружен» если `F-01.used = 3`
- Badge «⚠ Риск N» при `attention_risk_score ≥ 60`

**AI-агент (collapsed):**
- ◆ + имя + тег AI
- Прогресс-бар throughput + подпись `N.N зад/д`
- Pill «Эскал. ×N» если pending эскалации
- Pill «← Входящая передача» если `handoff_to = agent.worker_id`
- Pill «🔄 Цепочка ×N» (amber) если задача в `handoff_chain` VIEW (v3.6.0, Phase 1.1)
  — агент участвует в аномальной цепочке передач

> **Про handoff_chain:** тихое зависание без эскалации. 3+ handoff за 7 дней — агент передаёт
> то что не может выполнить. Pill появляется у **каждого агента** из цепочки. Phase 1.1:
> добавить после стабилизации `handoff_chain` VIEW данных.

---

## 21. Worker Sheet и Operator Queue

### Worker Sheet — участник

Вкладки: **Сейчас** / **Метрики**.

**Сейчас:**
- Нагрузка (stat) + очередь задач (stat)
- Hint-строка зелёный/amber/красный
- Активная задача + ETA drift

**Pre-flight scoring при назначении:**

```
Назначить на Vadim?

Нагрузка сейчас:     ████████░░  (F-01: 2/3)
Риск назначения:     🟡 72 / 100

Активные задачи:        4
Переключений сегодня:   3
Срочных дедлайнов:      2

[✅ Назначить]   [👥 Выбрать другого]
```

- `risk_level = 'ok'` → без pre-flight
- `risk_level = 'warning'` → amber, 2 кнопки
- `risk_level = 'critical'` → red, не блокирует

Данные из кэша Flow Metrics (60 сек). Снапшот → `trg_record_assignment_snapshot` (Master §6.14).

**Метрики:** SP/день за 14д + % возвратов, прогноз спринта vs Gap.

---

### Worker Sheet — AI-агент

Вкладки: **Сейчас** / **Метрики** / **Эскалации** (или **Handoff** при входящей передаче).

**Interpretation hint:**
- `throughput ≥ 1.5` AND `% эскалаций ≤ 20%` AND `% возвратов ≤ 15%` → «Агент работает стабильно»
- `throughput < 0.5` AND эскалации > 0 → «Агент остановился. Разблокируй задачи»
- иначе → «Агент работает, но есть вопросы. Проверь эскалации»

**Эскалации:** список карточек с причиной + `suggested_action` + [Разрешить] + [Открыть →].

**Handoff:** карточка входящей передачи + `handoff_notes` + «Взять в работу» → `move_task → in_progress`.

---

### Operator Queue

Tappable из «Эскалации» в Risk Pulse. Flat-список `needs_human=true` workspace. Oldest-first.

```
ALPHA-45 · «Настроить pgvector индексы»          3ч 14м
◆ Claude Code · Конфликт требований

«IVFFlat vs HNSW — нужно решение по аксиоме A-4»

[Разрешить]   [Открыть задачу →]
```

Пустое состояние: «Все задачи в работе — эскалаций нет ✓»

SQL — см. [onitask_team_tab.md §2.7](onitask_team_tab.md#27-operator-queue) (справочник).

---

## 22. Task Sheet (bottom sheet задачи)

Открывается из: column list, Worker Sheet, Operator Queue, Stream.

**Три вкладки (v3.6.0: добавлена «Блокировки»):**

---

### Вкладка «Детали»

- `ai_hint` (фиолетовый блок ✦)
- Описание задачи
- Метаданные: исполнитель, дедлайн, story points
- Кнопка «→ {следующая колонка}» (нет для `done`)

---

### Вкладка «Блокировки» (v3.6.0, A-12)

Отображается всегда (пустое состояние если нет рёбер). Источник данных — `get_task_subgraph` RPC
(Master §6.16). Instant tier, без LLM.

**Структура вкладки:**

```
┌─────────────────────────────────────────────────────────────────┐
│  🔗 Блокировки                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ← Заблокирована задачей:                                       │
│  ┌─────────────────────────────────────────────────────┐       │
│  │ ALPHA-34 · «Реализовать OAuth»         ✅ Готово   │       │
│  │ Блокер завершён — снять флаг?          [Снять 🔓]  │       │
│  └─────────────────────────────────────────────────────┘       │
│                                                                 │
│  → Блокирует задачи:                                            │
│  ┌─────────────────────────────────────────────────────┐       │
│  │ ALPHA-48 · «Написать тесты для OAuth» ⏳ Бэклог    │       │
│  │ ALPHA-51 · «Задокументировать API»    ⏳ Бэклог    │       │
│  └─────────────────────────────────────────────────────┘       │
│                                                                 │
│  ─────────────────────────────────────────────────────         │
│  ✦ Создать связь:                                               │
│  [＋ Добавить блокер]    [＋ Эта задача блокирует...]           │
└─────────────────────────────────────────────────────────────────┘
```

**UX-правила вкладки «Блокировки»:**

Блок «← Заблокирована задачей»:
- Показывается только при `subgraph` рёбрах где `to_task_id = task.id` и `relation_type = 'blocks'`
- Каждая карточка: `full_id` + title + статус блокера (колонка)
- Если блокер в `done` → **Orphan block**: карточка подсвечена amber + кнопка «Снять 🔓»
  → `UPDATE tasks SET is_blocked = false` для текущей задачи
- Тап на карточку → открыть Task Sheet блокера (nested bottom sheet)

Блок «→ Блокирует задачи»:
- Показывается при рёбрах `from_task_id = task.id` и `relation_type = 'blocks'`
- Карточки downstream задач: `full_id` + title + статус
- Тап → открыть Task Sheet downstream задачи
- При завершении текущей задачи (`move → done`) все downstream разблокируются автоматически
  через `trg_cascade_unblock` (Master §6.16) — подсказка «При завершении разблокирует N задач»

Блок «✦ Создать связь» (Admin/Owner + Member):
- «＋ Добавить блокер» → input full_id или search → `INSERT task_relations (blocks)`
- «＋ Эта задача блокирует...» → аналогично в обратном направлении
- Ошибка при самоссылке: «Задача не может блокировать сама себя»
- Ошибка при дубле: «Связь уже существует»

**Пустое состояние:**

```
Нет зависимостей
Задача независима от других.
[＋ Добавить связь]
```

**DDL:** `task_relations` — Master Spec §6.16. RPC `get_task_subgraph` — Master §6.16.
Создание связи → Route Handler `POST /api/tasks/:id/relations` (не MCP — это UI-операция).

---

### Вкладка «Комментарии»

- Хронологический список: комментарии людей + `agent_events.summary` + `task_events`
- Разделение: обычный фон (люди), фиолетовый (AI-агенты), teal (системные)
- Поле ввода → `task_events INSERT { event_type: 'comment' }`

> **DDL:** `task_events` с `event_type = 'comment'` (Master §6.10). Отдельная таблица не нужна.

---

## 23. Workspace Manager (вкладка «Доски»)

Скоуп — все workspace пользователя.

**Глобальные алерты:** Суммарные Эскалации / Перегружен / Активных задач.
Источник: `/api/workspaces/summary` (Edge Function, cache 60–300с).

**Карточки workspace:**
- Логотип (буквы prefix) + название + slug + состав команды
- Метрики: В работе / Эскалации / Перегружен / Готово
- Активный workspace — teal border

**Переключение:** → обновляет client state + Realtime subscriptions + header.

### Поле «Контекст команды» (WorkspaceWizard + Settings)

Редактируется только Admin/Owner. Лимит 2000 символов (Master §8).

**Placeholder:**
```
Пример: «Команда 5 человек: менеджер (переговоры с клиентами),
2 координатора (логистика и подрядчики), дизайнер, финансист.
Организуем корпоративы и конференции.
Задачи: площадка, кейтеринг, AV-оборудование, бюджет, договоры.
Работаем за 1–3 месяца до события — перенос дедлайнов невозможен.»
```

| Элемент | Потребитель | Эффект |
|---|---|---|
| Роли с зонами ответственности | F-04 | Точный `assigned_to` и `rewritten_title` |
| Домен + типичные задачи | F-03, F-04 | Доменная терминология в `ai_hint` |
| Ритм работы | F-03 | Точный `cognitive_weight`, `story_points` |
| Ограничения | MCP-агенты | Граница для `escalate_task` |

Поле необязательно (Skip). Ambient reminder через 3 дня при пропуске.

**Эндпоинт:**

```typescript
{
  workspaces: [{
    id: string, name: string, slug: string, task_prefix: string,
    is_current: boolean, last_activity: string,
    metrics: { in_progress: number, escalations: number, overloaded: number, done_sprint: number }
  }],
  global_alerts: { total_escalations: number, total_overloaded: number, total_active: number }
}
```

---

## Changelog (кратко)

**v3.6.0 — июнь 2026**

*Relational Context Layer (A-12):*

- §1: добавлена ссылка на Master Spec §6.16 (task_relations) в header
- §11: добавлены `orphan_blocker` и `handoff_chain` в таблицу аномалий с источниками (sql_anomalies_.md §3.10, §3.11); примечание о семантике обоих типов
- §12: AI Flow Summary получает `workspace_context_cache` (оперативный снапшот); добавлен пример инсайта с блокировками из `task_relations`
- §13: добавлен индикатор `is_blocked` на карточках задач в column list (иконка 🔒, не красный бордер); добавлен Cascade Unblock toast (TypeScript) — Realtime-событие `cascade_unblock` с подсветкой разблокированных задач
- §17: таблица Speed Tiers расширена — добавлены «Blocker Chain (Task Sheet)» (Instant SQL JOIN, `get_task_subgraph`) и «Cascade Unblock toast» (Realtime, event-driven); Risk Pulse расширен `orphan_blockers` и `handoff_chain`
- §19: «Процессы» расширен `orphan_blockers` в формуле (view sql_anomalies_.md §3.10); SQL-формула обновлена третьим слагаемым; примечание о drill-down по трём группам
- §20: добавлен pill «🔄 Цепочка ×N» (amber) для агентов в `handoff_chain` VIEW; помечен Phase 1.1
- §22: добавлена вкладка «Блокировки» (третья вкладка Task Sheet). Источник: `get_task_subgraph` RPC (Master §6.16). Два блока: «← Заблокирована» (orphan block detection + кнопка «Снять») и «→ Блокирует» (downstream + подсказка о cascade). Создание связей через UI (+блокер / +эта блокирует). Пустое состояние. Ссылки на DDL и RPC в Master §6.16. Route Handler `POST /api/tasks/:id/relations`

**v3.5.0 — июнь 2026**
- §17: Attention Risk Score (pre-flight)
- §20: badge «⚠ Риск N»
- §21: Pre-flight scoring Worker Sheet

**v3.4.1 — июнь 2026**
- §23: Поле «Контекст команды»

**v3.4.0 — июнь 2026**
- §1: навигация TWA (две вкладки)
- §19–23: новые разделы (перенос из Team Tab)

**v3.3.0 — май 2026**
- §18: Empty State

---

*onitask · Flow Board Concept · v3.6.0 · июнь 2026*
