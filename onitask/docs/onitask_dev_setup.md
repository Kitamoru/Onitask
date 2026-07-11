# onitask · Dev Setup & Architecture Reference

**Версия:** 0.2.2
**Дата:** июнь 2026
**Статус:** актуализировано с dev_setup v0.2.0 (май 2026)

> **Схема БД, аксиомы и инварианты** — см. [Master Spec](onitask_Architecture_Master_.md), разделы 4–9.
> **AI-модули (F-01, F-03, F-04, F-06)** — см. [AI Contract](onitask_ai_.md).
> **MCP tools (сигнатуры, ошибки)** — см. [MCP Contract](onitask_mcp_contract_.md).

---

## Содержание

1. [Технологический стек](#1-технологический-стек)
2. [Структура проекта](#2-структура-проекта)
3. [Последовательность разработки](#3-последовательность-разработки)
4. [Типизация Supabase (CI)](#4-типизация-supabase-ci)
5. [Переменные окружения](#5-переменные-окружения)
6. [Локальная разработка](#6-локальная-разработка)
7. [API-контракты — решения MVP](#7-api-контракты--решения-mvp)

---

## 1. Технологический стек

| Слой | Технология | Примечание |
|---|---|---|
| Frontend | Next.js 15 · TypeScript · React 19 | App Router, Server Components |
| UI | Tailwind CSS · shadcn/ui | TWA-совместимые компоненты |
| База данных | Supabase (PostgreSQL) | Единственный источник истины по схеме — Master Spec §6 |
| Auth | Telegram initData + HMAC верификация | Supabase Auth используется для `profiles` (Supabase-нативные записи). Прямой JWT на initData — только для TWA-сессий. |
| ORM / DB client | Supabase JS client v2 | Prisma не используется — несовместим с Deno Edge Functions и pgvector RPC |
| AI · Hot Path | Groq · llama-3.3-70b-versatile + whisper-large-v3-turbo | F-04 Parse, F-06 summary, LTM суммаризация |
| AI · Cold Path | NeuralDeep Hub · GPT-OSS-120B | F-03 Enrichment, AI Flow Summary |
| Embeddings | NeuralDeep Hub · bge-m3 | vector(1024), Cold Path |
| Realtime | Supabase Realtime | Subscriptions на `tasks`, `agent_events` |
| Scheduled jobs | pg_cron (Supabase) | Memory Consolidation, GC jobs — Master Spec §9 |
| Deploy | Vercel (TWA frontend + API Routes) | Только Hot Path < 2s (аксиома A-1) |
| Edge Functions | Supabase Edge Functions (Deno) | Cold Path: F-03 enrichment, flow metrics, LTM pipeline |
| Bot | Telegram Bot API | Уведомления, команды, deep links |

**Почему не Prisma:**
Prisma не работает в Deno-рантайме (Supabase Edge Functions). Значительная часть логики onitask живёт в БД — триггеры, RPC, `FOR UPDATE SKIP LOCKED`, pgvector. С Prisma всё это требует `$queryRaw` без типизации, а миграции через Prisma Migrate затирают ручные триггеры. Supabase-клиент с генерацией типов (`supabase gen types`) закрывает потребность в типизации без этих ограничений.

---

## 2. Структура проекта

### 2.1 Корень

```
onitask/
├── app/                    # Next.js App Router
├── components/             # React-компоненты
├── lib/                    # Бизнес-логика, утилиты
├── hooks/                  # Custom React hooks
├── types/                  # TypeScript types & interfaces
├── supabase/
│   ├── functions/          # Supabase Edge Functions (Deno)
│   └── migrations/         # SQL-миграции (ручные, не Prisma)
├── public/                 # Статика
├── .env.local
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── vercel.json             # Headers (CSP)
```

> **pg_cron вместо cron в vercel.json** — scheduled jobs (Memory Consolidation, GC agent_events) объявлены в БД через pg_cron. Детали — Master Spec §9. Vercel cron не используется.

### 2.2 app/ — App Router

```
app/
├── layout.tsx              # Root layout: TelegramProvider, QueryClient
├── page.tsx                # Entry: init + redirect
│
├── (twa)/
│   ├── onboarding/         # Первый вход, workspace wizard
│   ├── workspace/
│   │   └── [slug]/
│   │       ├── page.tsx    # Flow Board (канбан)
│   │       ├── team/       # Team Tab
│   │       ├── stream/     # Персональная лента (Stream)
│   │       ├── settings/   # Настройки workspace
│   │       └── members/    # Участники, инвайты
│   └── invite/[slug]/      # Принятие инвайта
│
└── api/
    ├── init/route.ts               # POST /api/init
    ├── tasks/
    │   ├── route.ts                # GET / POST
    │   └── [id]/
    │       ├── route.ts            # GET / PATCH / DELETE
    │       ├── decompose/route.ts
    │       └── relations/route.ts  # POST — task_relations (flow_.md §22)
    ├── flow/
    │   └── metrics/route.ts        # GET — делегирует в Edge Function
    ├── ai/
    │   ├── transcribe/route.ts     # F-04 STT (Groq Whisper)
    │   ├── parse-task/route.ts     # F-04 NL Parse (Groq llama)
    │   └── quota/route.ts
    ├── mcp/
    │   ├── create_task/route.ts
    │   ├── move_task/route.ts
    │   ├── escalate_task/route.ts
    │   ├── get_tasks_by_column/route.ts
    │   ├── get_workspace_settings/route.ts
    │   ├── get_task_context/route.ts    # mcp_contract_.md §4
    │   ├── handoff_task/route.ts        # mcp_contract_.md §4
    │   ├── send_message_to_chat/route.ts
    │   └── undo/[event_id]/route.ts
    ├── workspaces/
    │   ├── route.ts
    │   ├── summary/route.ts        # GET — Workspace Manager (flow_.md §23)
    │   └── [id]/
    │       ├── members/route.ts
    │       ├── invite/route.ts
    │       └── settings/route.ts
    ├── invite/[slug]/accept/route.ts
    └── bot/
        ├── webhook/route.ts
        ├── task/route.ts
        ├── task/[fullId]/route.ts           # GET — bot_.md §5.7
        ├── task/[fullId]/resolve/route.ts   # POST — bot_.md §5.8
        ├── flow/[workspaceId]/route.ts
        ├── standup/[workspaceId]/route.ts   # GET — bot_.md §6.1
        └── notify/route.ts                  # bot_.md §6.5 — внутренний хелпер
```

### 2.3 supabase/functions/ — Edge Functions

```
supabase/functions/
├── enrich-task/            # F-03: Card Enrichment (NeuralDeep + pgvector)
├── flow-metrics/           # /api/flow/metrics Cold Path (кэш 5/60 сек)
├── consolidate/            # LTM Memory Consolidation Pipeline
├── queue-monitor/          # Мониторинг зависших pending в enrichment_queue
├── bot-notify/             # Bot Notify Worker (bot_.md §6.5) — доставка
│                           # enrichment_queue (type='bot_notify') в Telegram
└── _shared/
    ├── supabase.ts         # createClient для Deno
    ├── neuraldeep.ts       # NeuralDeep Hub client
    └── groq.ts             # Groq client для LTM суммаризации
```

### 2.4 components/

```
components/
├── ui/                     # shadcn/ui переопределения
├── kanban/
│   ├── KanbanBoard.tsx     # Flow Board: контейнер с DnD
│   ├── KanbanColumn.tsx
│   ├── KanbanCard.tsx      # Карточка + ETA drift + enrichment hint
│   └── DragOverlay.tsx
├── team/
│   ├── RiskPulse.tsx       # Team Tab: верхняя панель (3 сигнала)
│   ├── MemberCard.tsx      # Collapsed + expanded (bottom sheet)
│   └── AgentCard.tsx       # Collapsed + expanded (bottom sheet)
├── task/
│   ├── TaskSheet.tsx       # Bottom sheet: детали задачи
│   ├── TaskForm.tsx        # Форма создания/редактирования
│   └── SubtaskList.tsx
├── ai/
│   ├── AiInput.tsx         # Единая строка ввода (NL + голос)
│   ├── VoiceRecorder.tsx   # MediaRecorder + waveform (F-04)
│   ├── DecomposePanel.tsx  # Предпросмотр подзадач
│   ├── EnrichmentBadge.tsx # Статус F-03: pending / done / failed
│   └── QuotaBadge.tsx      # Остаток AI-лимита
├── workspace/
│   ├── WorkspaceWizard.tsx # Онбординг: создание workspace
│   ├── MemberList.tsx
│   └── InviteModal.tsx     # Invite FAB + реферальная ссылка
├── sprint/
│   ├── SprintBar.tsx       # Sprint progress bar (Flow Board)
│   └── SprintCloseWizard.tsx
└── shared/
    ├── TelegramProvider.tsx # useTelegram hook
    ├── Toast.tsx
    ├── OfflineBanner.tsx
    └── UrgencyBadge.tsx     # Дедлайн светофор
```

### 2.5 lib/

```
lib/
├── supabase.ts             # createServerClient / createBrowserClient
├── telegramAuth.ts         # validateTelegramInitData + timingSafeEqual (A-2)
├── groq.ts                 # Groq client (Hot Path: F-04, LTM)
├── aiQuota.ts              # Atomic quota RPC (A-3)
├── aiPrompts.ts            # System prompts (шаблоны)
├── urgency.ts              # getUrgency(dueDate, settings) — клиент
├── bot.ts                  # Telegram Bot API helpers
└── mcpAuth.ts              # API key validation + timingSafeEqual (A-2)
```

### 2.6 hooks/ и types/

```
hooks/
├── useTelegram.ts          # tg.ready(), tg.expand(), MainButton, BackButton
├── useKanban.ts            # Локальный стейт + optimistic updates
├── useVoiceRecorder.ts     # MediaRecorder lifecycle
├── useAiQuota.ts           # GET /api/ai/quota
└── useTeamMetrics.ts       # Team Tab: velocity, escalations

types/
├── database.ts             # Генерируется: supabase gen types typescript
├── api.ts                  # Request / Response типы для Route Handlers
└── telegram.ts             # TelegramWebApp, InitData типы
```

---

## 3. Последовательность разработки

Строгий порядок — каждый этап является фундаментом следующего.

| # | Модуль | Что входит | Критерий готовности |
|---|---|---|---|
| 1 | **DB Migrations** | SQL-миграции: все таблицы из Master Spec §6. RLS-политики. Seed: тестовый workspace + worker. pg_cron jobs (Master §9). | Supabase Dashboard показывает все таблицы. RLS блокирует анонимный SELECT. pg_cron jobs видны в `cron.job`. |
| 2 | **Auth / Init** | `validateTelegramInitData` + `timingSafeEqual`. `POST /api/init`: upsert через Supabase Auth → workers. `useTelegram` hook. | Валидный initData → 200 + worker profile. Невалидный → 401. |
| 3 | **Workspace Wizard** | GET/POST `/api/workspaces`. `WorkspaceWizard.tsx`. `workspace_settings` seed при создании. | Новый пользователь видит wizard. После заполнения — попадает в Flow Board. |
| 4 | **Flow Board (без AI)** | GET/PATCH `/api/tasks`. `KanbanBoard` + DnD (`@dnd-kit`). Fractional indexing. Realtime подписка на `tasks`. `SprintBar`. Ручное создание задачи. `UrgencyBadge` (светофор). | DnD работает. Realtime: изменение у одного клиента видно второму. `trg_record_task_column_move` пишет в `task_column_history`. |
| 5 | **Voice / NL Input (F-04)** | `POST /api/ai/transcribe` (Whisper). `POST /api/ai/parse-task` (llama). `VoiceRecorder.tsx` + waveform. `AiInput.tsx`. Confidence handling. | Голосовой ввод → транскрипт ≤ 400ms. NL парсинг → корректные поля. Fallback при ошибке Groq. |
| 6 | **Card Enrichment (F-03)** | Edge Function `enrich-task`. `enrichment_queue` polling. `task_enrichments` upsert. Idempotency (`requested_at`). Retry backoff (Master §7.3). `EnrichmentBadge.tsx`. | Задача после создания обогащается в фоне. `enrichment_status: done` → UI обновляется через Realtime. При ошибке — тихий toast. |
| 7 | **MCP Agent Router (F-06)** | `/api/mcp/*` endpoints. `mcpAuth.ts`: `timingSafeEqual` (A-2). Atomic quota RPC (A-3). `state_before` Memento. `auto_create_agent_worker` триггер. Undo endpoint. | Cursor / Claude Code могут создавать и перемещать задачи. `agent_events` пишутся корректно. `undo` работает в окне 5 минут. |
| 8 | **Team Tab** | Risk Pulse (3 сигнала). Member cards (collapsed + expanded). Velocity SQL (team_tab §4.1). `InviteModal.tsx` + реферальная ссылка. | Risk Pulse показывает актуальные данные. SP/день считается корректно. Invite FAB генерирует ссылку `t.me/onitask_bot?start=ws_...`. |
| 9 | **Agent Cards + Escalations** | Agent cards (collapsed + expanded). Escalation queue (Team Tab §2.5). `escalate_task` MCP tool. Метрики агента: throughput, escalation rate, rework rate (team_tab §4.2). | Оператор видит очередь эскалаций. `needs_human = true` карточки отображаются корректно. Interpretation hint работает. |
| 10 | **Telegram Bot** | `/api/bot/*` endpoints. Webhook handler. F-04 адаптер для голоса в боте. Workspace resolution. `/task`, `/flow`, `/inbox` команды. Deep links. | Голосовое сообщение → задача в workspace. `/flow` возвращает актуальный статус. Deep link открывает TWA на нужной задаче. |
| 11 | **AI Flow Summary** | Edge Function `flow-metrics` (Cold Path). `POST /api/flow/metrics` с кэшом 5/60 сек. AI инсайты + кнопка «Применить» → `move_task`. | AI Flow Summary появляется для Admin/Owner. При ошибке LLM — показываются последние успешные инсайты из кэша. |
| 12 | **LTM Pipeline** | Edge Function `consolidate`. `task_events` → суммаризация → `agent_memory`. `consolidation_errors`. pg_cron каждые 15 мин. | `task_events` старше 30 дней консолидируются в `agent_memory`. RAG через `match_tasks()` возвращает релевантные задачи. |

---

## 4. Типизация Supabase (CI)

После каждой миграции БД типы должны быть регенерированы. Без этого TypeScript не знает о новых полях и таблицах.

### Генерация вручную

```bash
npx supabase gen types typescript \
  --project-id <your-project-id> \
  > types/database.ts
```

### GitHub Actions (добавить в основной workflow)

```yaml
- name: Generate Supabase types
  run: npx supabase gen types typescript --project-id ${{ secrets.SUPABASE_PROJECT_ID }} > types/database.ts

- name: Check for type drift
  run: git diff --exit-code types/database.ts
```

Второй шаг падает если разработчик забыл закоммитить обновлённые типы после миграции.

### Использование в коде

```typescript
import { Database } from '@/types/database'

const supabase = createClient<Database>(url, key)
// supabase.from('tasks') — полностью типизировано
```

### Ограничение: pgvector RPC

`match_tasks()` использует `vector(1024)` — нестандартный тип pgvector. Автогенерация для этой функции некорректна. Типизировать вручную в `types/database.ts`:

```typescript
// Добавить вручную после gen types:
export type MatchTasksArgs = {
  query_embedding: number[]
  match_count: number
  min_similarity: number
  exclude_task_id: string
  p_workspace_id: string
}

export type MatchTasksResult = {
  task_id: string
  similarity: number
}
```

---

## 5. Переменные окружения

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=       # только серверная сторона
SUPABASE_PROJECT_ID=             # для gen types в CI

# Telegram
TELEGRAM_BOT_TOKEN=
TELEGRAM_BOT_SECRET=             # для HMAC верификации webhook

# AI — Hot Path
GROQ_API_KEY=

# AI — Cold Path
NEURALDEEP_API_KEY=

# MCP
MCP_SIGNING_SECRET=              # HMAC для MCP webhook подписи
```

> Все секреты сравниваются через `timingSafeEqual` (аксиома A-2). `===` допустим только для non-secret строк.

---

## 6. Локальная разработка

```bash
# Установка зависимостей
npm install

# Запуск локального Supabase (Docker)
npx supabase start

# Применить миграции
npx supabase db push

# Регенерировать типы после миграции
npx supabase gen types typescript --local > types/database.ts

# Запуск Next.js
npm run dev

# Запуск Edge Functions локально
npx supabase functions serve enrich-task --env-file .env.local
```

### Тестирование MCP локально

```bash
# Создать задачу через MCP (пример)
curl -X POST http://localhost:3000/api/mcp/create_task \
  -H "Authorization: Bearer <test-api-key>" \
  -H "Content-Type: application/json" \
  -d '{"workspace_id":"...","agent_name":"test","title":"Test task"}'
```

### Supabase Dashboard — что мониторить

| Раздел | Что проверять |
|---|---|
| Table Editor → `enrichment_queue` | `status = 'stuck'` или `failed` записи |
| Table Editor → `agent_events` | Корректность `state_before` для undo |
| Query Performance | rework rate SQL (team_tab §4.2) — EXPLAIN ANALYZE > 50ms сигнализирует о seq scan |
| Logs → Edge Functions | Ошибки Cold Path enrichment |

---

## 7. API-контракты — решения MVP

Зафиксированные решения по поведению Route Handlers. Агент реализует их без дополнительных уточнений.

> **Схема БД и инварианты** — см. [Master Spec §6, INV-16](onitask_Architecture_Master_.md).

### 7.1 POST /api/init

**Find-or-create только** (INV-16). При повторном вызове — вернуть существующий профиль без изменений. `display_name` и `avatar_url` не обновляются автоматически при повторных открытиях TWA.

```typescript
// Ответ
{
  worker:      { id: string, display_name: string, workspace_id: string, role: string },
  workspaces:  WorkspacePreview[],
  is_new_user: boolean  // true → показать WorkspaceWizard
}
```

**Логика:**
```typescript
// 1. Верифицировать Telegram initData (timingSafeEqual, A-2)
// 2. Найти profiles WHERE telegram_id = user.id
// 3. Если не найден → создать profiles + workers (owner если первый workspace)
// 4. Если найден → вернуть как есть (НЕ обновлять display_name/avatar_url)
// 5. Вернуть профиль + список workspace + is_new_user
```

---

### 7.2 GET /api/tasks

**Без пагинации на MVP.** Возвращает все задачи workspace одним запросом.

Обоснование: типичный MVP workspace — до 100 задач. Пагинация усложняет Realtime-подписки и DnD-состояние на канбане. Порог пересмотра: 300+ задач в workspace.

```typescript
// Запрос
GET /api/tasks?workspace_id=<uuid>

// Ответ — все задачи workspace без limit/offset
{
  tasks: Task[]  // полный список
}
```

---

### 7.3 PATCH /api/tasks/[id]

**Last-write-wins из TWA** — проверка `version` не выполняется.

Обоснование: задачи в TWA редактируют один-два пользователя одновременно, конфликты редки. Version-check добавляет сложность на фронте без ощутимой пользы на MVP.

**Исключение:** `version` обязателен в MCP Route Handlers (INV-09) — агенты работают параллельно.

```typescript
// TWA path — simple update
await supabase
  .from('tasks')
  .update({ ...changes, updated_at: new Date().toISOString() })
  .eq('id', taskId)
  .eq('workspace_id', workspaceId)  // tenant isolation (A-7)

// MCP path — version check обязателен (INV-09)
await supabase
  .from('tasks')
  .update({ ...changes, version: currentVersion + 1 })
  .eq('id', taskId)
  .eq('version', currentVersion)  // 409 если не совпало
```

---

### 7.4 POST /api/workspaces

**Атомарная транзакция** (всё или ничего):

```typescript
// Порядок операций внутри одной транзакции:
// 1. INSERT workspaces (name, slug, task_prefix, plan)
//    → автоматически: trg_init_task_counter (workspace_task_counters)
//    → автоматически: trg_init_workspace_columns (4 колонки в tracker.columns)
// 2. INSERT workspace_settings (все дефолты явно, Master §6.4)
// 3. INSERT workers (type='human', role='owner', source_id=profiles.id::text)
// 4. ЕСЛИ story_points_config.enabled=true
//      → INSERT sprints (status='planning', name='Sprint 1')
//    ИНАЧЕ → пропустить
```

**Важно:** `workspace_settings` создаётся в Route Handler (не триггером) — дефолты могут меняться без миграции. `workspace_task_counters` и `tracker.columns` — через триггеры БД (Master §6.12, §6.1).

---

## Changelog

**v0.2.2 — июнь 2026**

*Синхронизация дерева проекта с фактическими контрактами (найдено при аудите /check):*

- §2.2: добавлены 7 ранее отсутствовавших в дереве маршрутов, уже специфицированных
  в других документах: `tasks/[id]/relations/route.ts` (flow_.md §22),
  `mcp/get_task_context/route.ts` и `mcp/handoff_task/route.ts` (mcp_contract_.md §4),
  `workspaces/summary/route.ts` (flow_.md §23), `bot/task/[fullId]/route.ts` (bot_.md §5.7),
  `bot/task/[fullId]/resolve/route.ts` (bot_.md §5.8), `bot/standup/[workspaceId]/route.ts`
  (bot_.md §6.1). Уточнено назначение `bot/notify/route.ts` — внутренний хелпер (bot_.md §6.5)
- §2.3: добавлена Edge Function `bot-notify/` — Bot Notify Worker, контракт в bot_.md §6.5
- Новой бизнес-логики не вводит — только приводит дерево в соответствие с уже
  утверждёнными контрактами (mcp_contract_.md v0.7.1, bot_.md v0.6.0, flow_.md v3.6.0)

---

*onitask · Dev Setup & Architecture Reference · v0.2.2 · июнь 2026*
