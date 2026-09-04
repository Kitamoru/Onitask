# Onitask Agent Worker — План реализации (WorkerPlan)

**Версия:** 1.0
**Дата:** 2026-09-04
**Статус:** Согласован к реализации (все решения верифицированы по коду/миграциям)
**Связанные доки:** refactor-ai 01 (Ops API), 03 (Duty Runtime), 09 (Reaper), 12–14 (Wake/CLI), `docs/TASKS.md` RUNNER-02…06

---

## 0. Верификация консистентности (2026-09-04, по факту кода)

Все решения плана сверены с миграциями 060/062/064/067/071, `lib/shared/opsTools.ts`,
`lib/shared/opsTransport.ts`, `lib/shared/types.ts`, `src/app/api/mcp/route.ts`.
Найденные расхождения **исправлены в этой версии плана**:

| # | В обсуждении было | Факт в коде | Итоговое решение |
|---|-------------------|-------------|------------------|
| 1 | `ops_heartbeat` не продлевает lease (или нужен `ops_renew_lease`) | **062:182–186 — heartbeat продлевает:** `expires_at = now() + 20 min`, `heartbeat_at = now()`. `ops_renew_lease` не существует | Один инструмент: `ops_heartbeat` = полный renewal. Ничего добавлять не нужно |
| 2 | `lease_expired (409)` на terminal/ack | `lease_expired` существует, но **только у `ops_heartbeat`** (lease просрочен за grace, 062:178–180). Terminal/ack/nack: `404 execution_not_found`, `409 stale_claim`, `409 claim_closed` | ErrorHandler различает: heartbeat-`lease_expired` → стоп раннера, IDLE; 404/409 на terminal → «lease утерян», IDLE |
| 3 | `send_message_to_chat` недоступен воркеру → писать в `bot_notify_queue` | Таблицы `bot_notify_queue` **нет** (очередь ботов = `enrichment_queue type='bot_notify'`, service-only). НО `send_message_to_chat` — **MCP-инструмент, доступный агенту**: bot-токен используется серверно внутри доменной функции, свой лёгкий лимит, доступен и при исчерпании квоты задач | Решение playbook валидно: воркер зовёт `send_message_to_chat` через MCP. Фикс «INSERT в очередь напрямую» **отменён** (воркер не имеет service-доступа) |
| 4 | Квота: `quota_exceeded` | В ops-контуре код = **`rate_limited` (HTTP 429)** (`opsTransport.ts:146`); `503 quota_unavailable` — fail-closed. `quota_exceeded` — из доменного контура 0.8 | Матрица ошибок использует `rate_limited` |
| 5 | `OpsJob` интерфейс в `lib/shared/types.ts` | **Не существует.** Job payload — JSONB прямо из RPC `ops_lease` (062:142+) | Контракт воркера = форма RPC-ответа (раздел 3.2) |
| 6 | Heartbeat каждые 10с | Сервер отдаёт `heartbeat_interval_seconds` в lease-ответе = **60** (062:555; спека 01 default 60) | Воркер берёт интервал **из lease-ответа**, fallback 60с. Не хардкодим |
| 7 | Reaper каждые 30с | `ops_reaper_tick` — cron **каждую минуту** (`'* * * * *'`, 067:87); grace 30с; retry attempt+1<3 через re-INSERT в outbox; ≥3 → escalate (068: `max_attempts`) | Худший случай возврата задачи: ~20 мин VT + 30с grace + ≤60с cron ≈ **21,5 мин** |
| 8 | «Восстановление незавершённых executions» при старте (из playbook) | `task_executions` — service-only RLS, у воркера нет инструмента чтения чужих executions. Восстановление = **серверный reaper** | Воркер на старте ничего не восстанавливает: свежий `runtime_id` → цикл lease. Это и есть recovery |
| 9 | SIGTERM → `ops_terminal(escalate,'worker_shutdown')` | `escalate` ставит `needs_human=true` — эскалация на человека при каждом рестарте = спам Operator Queue | SIGTERM → **`ops_nack('runtime_busy','worker_shutdown')`**: execution закрыт, задача requeue (attempt+1<3). `escalate` — только runner-эскалации / `max_attempts` / `unsupported_task` |
| 10 | Wake-канал `agent:<key_id>` | Подтверждено (071:60): `agent:<mcp_agent_keys.id>`, public, payload `{event_id, type:'work.available', workspace_id, agent_key_id, ts}` — **без task_id**; publisher cron 10с, guard `wake_sent_at` | В конфиг добавлен `ONITASK_AGENT_KEY_ID` (не секрет) для подписки |
| 11 | Exit-code «failure» → `ops_terminal(outcome:'failure')` | `ops_terminal` принимает только **`review \| escalate \| handoff`** (062 CHECK, `opsTools.ts:65`) | Провал раннера = **`ops_nack`** (`transient_error` → requeue; `unsupported_task` → escalate). Outcome «failure» не существует |

Всё остальное подтверждено кодом: lease ставит `column='in_progress'` +
`active_claim_id` (062:125–131); identity только из ключа (INV 9, `opsTransport.ts:116–125`);
`runtime_id` генерирует воркер, `execution_id` приходит с сервера; `executor_id` не нужен;
события в `agent_events` пишет **сервер** (062:347–353), воркер не дублирует.

---

## 1. Роль и формула

```
Supabase будит (broadcast, best-effort) · ops_lease выдаёт работу (единственный путь)
· MCP — единый транспорт · Postgres хранит правду · Reaper чинит зомби · Worker владеет рантаймом
```

**Worker (daemon)** — самостоятельный процесс (VPS / Render / локально): оркестратор.
Никакой бизнес-логики: цикл lease → context → runner → heartbeat → terminal → ack.
**Runner (LLM)** — отдельный процесс через `ONITASK_RUNNER_CMD`, общается с воркером
через stdin/stdout, в сеть не ходит.

## 2. Идентификация и аутентификация

| Идентификатор | Кто создаёт | Жизнь | Назначение |
|---|---|---|---|
| `api_key` | Сервер (`mcp_agent_keys`, 1 ключ = 1 агент) | Постоянный | `Authorization: Bearer <key>`. Identity (workspace_id, agent_name) резолвится **сервером** из ключа (INV 9) |
| `agent_key_id` (UUID) | Сервер | Постоянный | Не секрет. Канал wake `agent:<agent_key_id>`. Из UI настроек → конфиг |
| `runtime_id` (UUID) | **Воркер**, при старте процесса | Жизнь процесса | Fencing всех ops-вызовов. Не восстанавливается между рестартами |
| `execution_id` (UUID) | **Сервер**, при `ops_lease` | Один lease | Домен выполнения; воркер держит в памяти, runner'у не нужен |
| `receipt` | **Сервер**, при lease | Один lease | Для `ops_ack` |

Двойной запуск процесса безопасен (fencing в БД: `SKIP LOCKED` + один pending на
задачу + один open execution на задачу). Опциональный PID-file — для удобства
оператора, не для корректности.

## 3. Контракты сервера (верифицированы)

### 3.1. Транспорт — MCP (JSON-RPC 2.0), единая точка входа

`POST {ONITASK_BASE_URL}/api/mcp`

```jsonc
// Request
{ "jsonrpc": "2.0", "id": 1, "method": "tools/call",
  "params": { "name": "ops_lease", "arguments": { "runtime_id": "<uuid>" } } }
// Headers: Authorization: Bearer <api_key>; X-Agent-Name: <agent_name> (рекоменд.)

// Success → result.structuredContent = доменный результат
// Ops error → error.code = -32000, error.data = { type: "<код>", http_status: <n> }
```

### 3.2. `ops_lease` — аргументы `{ runtime_id }` (limit = 1)

`structuredContent.job` (или `{job: null}`):
```jsonc
{ "execution_id": "<uuid>", "task_id": "<uuid>", "task_version": 18,
  "lease_expires_at": "…ISO…", "heartbeat_interval_seconds": 60, "receipt": "rcpt_<hex>" }
```
Сервер в одной TX: execution open (`expires_at = now()+20min`) → task `in_progress` +
`active_claim_id` → outbox `published` → receipt. Пустой ответ: `{job:null}`.

### 3.3. `ops_heartbeat` — `{ execution_id, runtime_id }`

Fencing: `execution_not_found` (404), `stale_claim` (409), `lease_expired` (409 —
просрочен за grace 30с). Успех: `expires_at = now()+20min`, ответ
`{status:'open', lease_expires_at, heartbeat_at}`.

### 3.4. `ops_terminal` — `{ execution_id, runtime_id, task_id, task_version, outcome, summary?, metadata?, next_owner? }`

`outcome ∈ review | escalate | handoff` (CAS по `task_version`).
`review` → задача в review (кнопки бота); `escalate` → `needs_human=true` +
`escalation_reason` (задача остаётся в своей колонке); `handoff` →
`next_owner='agent:<name>'` (новый pending в outbox) или `'human'`.
Ответ: `{task_version (новая), task_status, execution_status:'closed'}`.
Идемпотентность: тот же outcome повторно → 200; другой → `409 claim_closed`;
CAS-miss → `409 version_conflict`. Пишет `agent_events(tool='ops_terminal')`.

### 3.5. `ops_ack` — `{ execution_id, runtime_id, receipt }`

Строгий: без предварительного terminal → `409 terminal_required`. Финализирует delivery.

### 3.6. `ops_nack` — `{ execution_id, runtime_id, receipt, reason, detail? }`

`reason ∈ unsupported_task | runtime_busy | dependency_unavailable | transient_error | other`.
Закрывает execution, снимает claim: `unsupported_task` → escalate (без ретраев),
остальные → requeue attempt+1 < 3 (policy 09), ≥3 → escalate.

### 3.7. `get_task_context` — `{ task_id, include_workspace_context?, include_memory_summary?, events_limit? }`

```jsonc
{ task: { full_id, title, description, column, priority, deadline, version,
          needs_human, escalation_reason, metadata, … },
  column_history: […], agent_events: [≤20],
  memory_summary, workspace_context, relevant_docs, subgraph /* blocks|spawned_from|mentions */ }
```
CTX-02: `workspace_context` и `memory_summary` статичны в рамках сессии — первый
вызов полный, далее `include_*: false` (экономия контекста из playbook → код воркера).

### 3.8. Wake (071)

Broadcast `work.available` на public-канал `agent:<agent_key_id>`, payload
`{event_id, type, workspace_id, agent_key_id, ts}` (без task_id). Best-effort:
потеря не критична — гарантия = poll + outbox + reaper.

---

## 4. Жизненный цикл воркера

```
START      runtime_id = uuidv4(); конфиг; (опц.) PID-file для удобства, не для корректности
WAKE       RealtimeListener (канал agent:<key_id>) + PollManager (fallback, всегда жив)
LEASE      ops_lease {runtime_id}
             ├─ job:null → sleep(active 30с | idle 5мин, адаптивно) → LEASE
             └─ job → CONTEXT
CONTEXT    get_task_context: 1-й вызов за сессию — полный; далее include_*:false.
           workspace_context/memory_summary кэшируются в памяти воркера
HEARTBEAT  таймер: интервал из job.heartbeat_interval_seconds (60с) + jitter
RUN        spawn ONITASK_RUNNER_CMD ← stdin JSON (раздел 5); env-мост
TERMINAL   exit 0 + stdout JSON → ops_terminal(outcome, summary, task_version)
ACK        ops_ack(receipt) — финализация
CLEANUP    activeTask=null; heartbeat-таймер стоп; сессия чиста
           (раннер — новый процесс на каждую задачу → clearSession() бесплатно)
SHUTDOWN   SIGTERM/SIGINT → kill runner (SIGINT, 5с grace, SIGKILL)
           → если execution открыт: ops_nack('runtime_busy','worker_shutdown')
           → close realtime → exit 0
```

Режимы CLI: `start` (daemon), `once` (одна задача — CI/отладка), `ping` (JSON-RPC ping).

## 5. Протокол Runner (stdin/stdout)

**stdin** (единый JSON):
```jsonc
{
  "execution_id": "<uuid>",
  "task": { "full_id": "ONI-42", "title": "…", "description": "…",
             "column": "in_progress", "priority": "high", "deadline": null,
             "version": 18 },
  "column_history": [/* … */],
  "agent_events":   [/* последние ≤20 */],
  "relevant_docs":  [/* … */],
  "subgraph":       [/* blocks/spawned_from/mentions */],
  "workspace_context": "…",   // из кэша воркера
  "memory_summary":    "…"    // из кэша воркера
}
```
**env:** `ONITASK_TASK_FULL_ID`, `ONITASK_EXECUTION_ID`, `ONITASK_WORKDIR`.

**stdout** (при exit 0) — маппится в `ops_terminal`:
```jsonc
{ "outcome": "review" | "escalate" | "handoff",
  "summary": "≤1000 симв., источник reason для бота (G6)",
  "next_owner": "agent:<name>" | "human",   // только для handoff
  "metadata": { /* escalation_reason, suggested_action, … */ } }
```

**Exit-коды:**

| Код | Смысл | Действие воркера |
|---|---|---|
| 0 | Готово | Парс stdout → `ops_terminal`. Невалидный JSON/outcome → `ops_nack('unsupported_task')` (сервер эскалирует, без ретраев) |
| ≠0 | Падение раннера | `ops_nack('transient_error', tail(stderr))` → requeue |
| таймаут/сигнал | Завис | SIGINT → 5с → SIGKILL → `ops_nack('transient_error','runner_timeout')` |

---

## 6. Матрица ошибок

| Источник | Код (HTTP) | Действие воркера |
|---|---|---|
| `ops_lease` | `rate_limited` (429) | Опц. `send_message_to_chat` (свой лёгкий лимит, доступен при исчерпанной квоте) → удлинённый sleep → retry |
| `ops_lease` | `quota_unavailable`/`dispatch_unavailable` (503) | Backoff 1→2→4…60с (сеть/сервер), retry |
| `ops_lease` | `task_already_claimed` (409) | Не наш attempt — sleep(active), retry |
| `ops_heartbeat` | `lease_expired` (409) | Lease просрочен за grace → убить runner, лог, IDLE |
| `ops_heartbeat` | `stale_claim` (409) | Runtime не владеет (не должен случиться) → стоп задачи, IDLE |
| `ops_terminal` | `version_conflict` (409) | Перечитать `task.version` → retry terminal ×1 → иначе `ops_nack('other')` |
| `ops_terminal/ack` | `execution_not_found` (404) / `claim_closed` (409) | Lease утерян (reaper) → лог, IDLE, задача вернётся сама |
| `ops_ack` | `terminal_required` (409) | Не должен случиться (terminal идёт перед ack) — лог fail-loud |
| Auth | `invalid_credentials` (401), `agent_not_allowed`/`forbidden_workspace` (403) | Fatal: конфиг неверен — exit ≠ 0 |
| Realtime | disconnect | Reconnect 1→2→4…30с; после reconnect — немедленный lease; poll работает всегда |

Логирование: stdout/stderr воркера (структурно: ts, level, event, execution_id).
`agent_events`/`audit_log` пишет **сервер** (ops_terminal/nack), воркер не дублирует.

## 7. Тайминги

| Параметр | Значение | Источник |
|---|---|---|
| Heartbeat | `job.heartbeat_interval_seconds` = **60с** (+jitter ±10%) | Сервер, lease-ответ |
| Lease VT | 20 мин (продлевается каждым heartbeat) | 062:114,182 |
| Grace | 30с | 062:178 |
| Reaper cron | 1 мин → возврат задачи ≤ ~21,5 мин | 067 |
| Publisher (wake) cron | 10с | 071 |
| Poll active / idle | 30с / 5 мин (адаптивно: idle после N пустых lease) | спека 12/14 |
| Realtime reconnect | 1→2→4…30с | спека 14 |
| Runner grace при shutdown | 5с (SIGINT→SIGKILL) | — |

## 8. Структура и конфигурация

```
worker/
├── bin/cli.ts                  # start | once | ping; Node ≥24 (type stripping, без сборки)
├── config.ts                   # env → Config (валидация при старте, fail-loud)
├── mcpClient.ts                # JSON-RPC 2.0 tools/call, парс error.data.{type,http_status}
├── wake/realtimeListener.ts    # @supabase/supabase-js (уже в root deps), канал agent:<key_id>
├── wake/pollManager.ts         # adaptive 30с/5мин
├── orchestrator/dutyLoop.ts    # START→LEASE→CONTEXT→RUN→TERMINAL→ACK→CLEANUP
├── orchestrator/heartbeatTimer.ts
├── orchestrator/errorHandler.ts
├── runner/taskRunner.ts        # spawn ONITASK_RUNNER_CMD, stdin/stdout, таймаут/сигналы
└── types.ts
```

Запуск из репо (npm-install -g — отдельная упаковка после стабилизации):

```bash
node worker/bin/cli.ts start
```

Конфиг (.env / окружение):

```bash
ONITASK_BASE_URL=https://onitask.vercel.app
ONITASK_API_KEY=<секрет>            # 1 ключ = 1 агент
ONITASK_AGENT_KEY_ID=<uuid>         # НЕ секрет; канал wake agent:<key_id>
ONITASK_AGENT_NAME=Drift            # для X-Agent-Name (проверка INV 9)
ONITASK_RUNNER_CMD="claude -p"      # команда раннера
ONITASK_ENABLE_REALTIME=true        # false → чистый poll-only
ONITASK_POLL_ACTIVE_MS=30000
ONITASK_POLL_IDLE_MS=300000
ONITASK_RUNNER_TIMEOUT_MS=3600000   # жёсткий потолок задачи
```

**Воркер НЕ делает:** reaper (сервер), запись в `agent_events` (сервер), прямую
доставку в Telegram (`send_message_to_chat` — только как клиент MCP-инструмента),
шардирование/аллокацию (fencing в БД), восстановление executions (reaper).

## 9. Этапы реализации (Definition of Done)

| Этап | Содержание | Проверка |
|---|---|---|
| W1 | Каркас: config + mcpClient + poll-only lease-цикл (`once`) | `node worker/bin/cli.ts once` на проде: lease → лог job / job:null; `ping` ✅ |
| W2 | Runner: spawn, stdin/stdout-контракт, terminal/ack/nack | E2E с echo-раннером: задача → review → ack; runner exit 1 → nack → requeue |
| W3 | HeartbeatTimer + матрица ошибок + graceful shutdown | `kill -9` воркера → задача возвращается reaper'ом ~21,5 мин; SIGTERM → nack requeue сразу |
| W4 | Realtime wake + adaptive poll | wake-событие → немедленный lease (wake-sniff подтверждён, WAKE-01) |
| W5 | Smoke-матрица 09: retry, escalate на max_attempts, handoff, CTX-02 экономия | по чеклисту Stage 7 |

`npm run type-check` зелёный на каждом этапе. Реализация — под задачей **RUNNER-02**
(`docs/TASKS.md`), runner-адаптеры — RUNNER-03.



