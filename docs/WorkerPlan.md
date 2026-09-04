# Onitask Agent Worker — План реализации (WorkerPlan)

**Версия:** 1.1
**Дата:** 2026-09-04
**Статус:** Согласован к реализации (все решения верифицированы по коду/миграциям)
**Связанные доки:** refactor-ai 01 (Ops API), 03 (Duty Runtime), 04 (Bot synergy),
07 (Bot notify emit), 09 (Reaper), 12–14 (Wake/CLI), `docs/TASKS.md` RUNNER-02…06

> **v1.1 (2026-09-04):** добавлены §3.9 (Review Flow — полный цикл: бот-кнопки,
> approve/fix, requeue) и §10 (Quick Launch: one-liner, авто-резолв `agent_key_id`
> и supabase-конфига wake из api_key; Realtime wake — базовый «будильник», без JWT).

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
| `agent_key_id` (UUID) | Сервер | Постоянный | Не секрет. Канал wake `agent:<agent_key_id>`. **Резолвится сервером из api_key** (`resolveAgentKey` возвращает `id`) — отдельный ключ и ручной ввод не нужны, приходит в `whoami` |
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

### 3.8. Wake (071) — базовый «будильник»

Broadcast `work.available` на public-канал `agent:<agent_key_id>`, payload
`{event_id, type, workspace_id, agent_key_id, ts}` (без task_id). Best-effort:
потеря не критична — гарантия = poll + outbox + reaper.

Подписка воркера — **публичная, без JWT** (spec 15 с JWT-обменом отклонена как
переусложнение): воркер подключается с publishable anon key, а конфиг
(`supabase_url`, `supabase_anon_key`, `agent_key_id`) получает с сервера через
`GET /api/agent/whoami` (Bearer api_key; identity + wake-config одним вызовом —
✅ реализовано, см. §10.6). Wake — механизм мгновенного пробуждения,
но не доставки: после wake воркер обязан сделать `ops_lease`.

### 3.9. Review Flow — полный цикл после `ops_terminal(review)`

Сдача работы — только половина цикла. Воркеру важна и обратная связь: как
человек принимает/возвращает задачу и как она возвращается к агенту.

```text
ops_terminal(review, summary)          # воркер сдаёт работу
  → server (одна TX): column='review' + agent_events(tool='ops_terminal')
    + enrichment_queue(bot_notify / task_review, reason=summary)   # миграции 062+064 (G6)
  → bot-notify EF → Telegram DM ревьюеру (fallback: автору):
      карточка «Что сделано: <summary>» + кнопки
      [Согласовать → ra:approve:<task_id>] [Вернуть → ra:fix:<task_id>]   # doc 04/07
  ├─ ra:approve → review_action(approve) → column='done' → task_done notify
  └─ ra:fix → pending «напишите причину» → текст → review_action(fix, p_reason)
        → metadata.last_fix_reason + INSERT dispatch_outbox(attempt=1)  # requeue, 064 R7
        → wake → воркер забирает задачу следующим ops_lease
        → get_task_context отдаёт last_fix_reason в task.metadata
```

Правила воркера в этом цикле:

- `summary` в terminal — человекочитаемый отчёт «что сделано»: он попадает в
  Telegram-карточку (G6). ≤1000 символов, без секретов.
- После `ra:fix` задача приходит с тем же `task_id` и новым `attempt` в lease
  (fencing обычный). Контекст задачи перечитываем; workspace_context /
  memory_summary остаются в кэше воркера (CTX-02 не ломается).
- Воркер НЕ опрашивает результат ревью — его будит только новый outbox/wake
  или poll. По кнопкам никаких действий — это серверный контур (bot webhook →
  `review_action` RPC; бот никогда не зовёт ops, doc 04).
- E2E-покрытие (матрица 08): E04 (terminal review → notify), E11 (approve →
  done), E12 (fix → requeue).

---

## 4. Жизненный цикл воркера

```
START      runtime_id = uuidv4(); конфиг; whoami (resolveAgentKey → workspace_id,
           agent_name, allowed_tools, agent_key_id) — fail → exit 3, без цикла
WAKE       whoami (Bearer key → identity + agent_key_id + supabase_url/anon_key;
           нет wake-config → warn + poll-only) → RealtimeListener
           (public-канал agent:<key_id>, anon key, БЕЗ JWT) + PollManager
           (fallback, всегда жив)
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

Режимы CLI: `start` (daemon), `once` (одна задача — CI/отладка), `whoami`
(verify identity + agent_key_id; auth-ошибка → exit 3), `ping` (JSON-RPC ping).

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
| Auth / whoami | 401 (`unauthorized` из whoami / `invalid_credentials` из ops), 403 `forbidden_workspace`/`agent_not_allowed` | Fatal: конфиг неверен — exit 3 (exit-коды doc 03). `whoami` прогоняет проверку до цикла; отсутствие wake-config → warn + poll-only (не fatal) |
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
├── bin/cli.ts                  # start | once | whoami | ping; Node ≥24 (type stripping, без сборки)
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

Запуск — см. §10 Quick Launch (one-liner + `.env.example`). Полный конфиг:

```bash
# ── Обязательные: этого достаточно для полного запуска с Realtime wake ─────
ONITASK_BASE_URL=https://onitask.vercel.app
ONITASK_API_KEY=sk_<hex64>          # 1 ключ = 1 агент; UI: Настройки → MCP-ключи

# ── Резолвятся сервером из api_key — НЕ вводятся вручную ───────────────────
#   workspace_id, agent_name   ← resolveAgentKey (INV 9)
#   agent_key_id               ← resolveAgentKey (добавить id в select) → whoami
#   supabase_url + anon_key    ← GET /api/agent/whoami (для wake)

# ── Опциональные ────────────────────────────────────────────────────────────
ONITASK_AGENT_NAME=Drift            # только assert-match ключу (INV 9); обычно не нужен
ONITASK_AGENT_KEY_ID=               # оверрайд (иначе из whoami)
ONITASK_SUPABASE_ANON_KEY=          # оверрайд, если realtime-config недоступен
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
| W1 | Каркас: config + mcpClient + whoami + poll-only lease-цикл (`once`) | `whoami` ✅ (identity + agent_key_id; auth fail → exit 3); `once` на проде: lease → лог job / job:null; `ping` ✅ |
| W2 | Runner: spawn, stdin/stdout-контракт, terminal/ack/nack | E2E с echo-раннером: задача → review → ack; runner exit 1 → nack → requeue |
| W3 | HeartbeatTimer + матрица ошибок + graceful shutdown | `kill -9` воркера → задача возвращается reaper'ом ~21,5 мин; SIGTERM → nack requeue сразу |
| W4 | Realtime wake + adaptive poll | wake-событие → немедленный lease (wake-sniff подтверждён, WAKE-01) |
| W5 | Smoke-матрица 09: retry, escalate на max_attempts, handoff, CTX-02 экономия | по чеклисту Stage 7 |

`npm run type-check` зелёный на каждом этапе. Реализация — под задачей **RUNNER-02**
(`docs/TASKS.md`), runner-адаптеры — RUNNER-03.

## 10. Quick Launch — запуск за 30 секунд

Минимум для полноценного воркера с Realtime wake — **два значения**: base URL
и api_key. Всё остальное (identity, `agent_key_id`, supabase-конфиг wake-канала)
сервер резолвит из ключа — никаких отдельных ключей и ручных UUID.

### 10.1. One-liner

```bash
# Linux / macOS / WSL
ONITASK_API_KEY=sk_<hex64> \
ONITASK_BASE_URL=https://onitask.vercel.app \
  node worker/bin/cli.ts start
```

```powershell
# Windows PowerShell
$env:ONITASK_API_KEY='sk_<hex64>'; $env:ONITASK_BASE_URL='https://onitask.vercel.app'
node worker/bin/cli.ts start
```

`npm-install -g` / `npx onitask-agent start` — отдельная упаковка после
стабилизации (TASKS.md RUNNER-02, npm-only v0).

### 10.2. Что происходит при старте

```text
GET /api/agent/whoami (Bearer api_key) — один вызов:
  → workspace_id, agent_name, allowed_tools, agent_key_id,
    supabase_url, supabase_anon_key (public, не секрет)
  └ 401/403                      → exit 3 (конфиг неверен, fail-loud)
  └ supabase_url/anon_key = null → warn, poll-only (доставка = lease + reaper)
Realtime.subscribe               → канал agent:<agent_key_id> (public, anon key, без JWT)
  └ broadcast work.available     → немедленный ops_lease
```

Realtime — базовый «будильник» (ADR 12), но не механизм доставки: потеря wake
не страшна, poll-цикл (30с active / 5мин idle) подхватит работу.

### 10.3. Где взять api_key

UI onitask → Настройки → MCP-ключи → «Создать ключ» (`POST /api/mcp-keys`,
формат `sk_<hex64>`, показывается один раз). Это **единственный секрет воркера** —
тот же ключ используется для MCP-подключения IDE (Cursor/Cline):
1 ключ = 1 агент (ADR R2).

### 10.4. .env.example

```bash
# worker/.env.example
ONITASK_BASE_URL=https://onitask.vercel.app
ONITASK_API_KEY=sk_replace_me           # единственный секрет
# ONITASK_AGENT_NAME=                   # опц.: assert-match имени ключа
ONITASK_ENABLE_REALTIME=true
ONITASK_POLL_ACTIVE_MS=30000
ONITASK_POLL_IDLE_MS=300000
ONITASK_RUNNER_CMD=claude -p
ONITASK_RUNNER_TIMEOUT_MS=3600000
# оверрайды авто-резолва (обычно не нужны):
# ONITASK_AGENT_KEY_ID=
# ONITASK_SUPABASE_ANON_KEY=
```

### 10.5. Проверка перед запуском

```bash
node worker/bin/cli.ts whoami   # → workspace_id, agent_name, allowed_tools, agent_key_id; auth fail → exit 3
node worker/bin/cli.ts ping     # → JSON-RPC ping
node worker/bin/cli.ts once     # одна задача (CI/отладка)
```

### 10.6. Зависимости на сервере (code, вне воркера — RUNNER-02)

| Изменение | Файл | Статус |
|---|---|---|
| `id` в select `resolveAgentKey` + поле `agentKeyId` в `AgentKeyContext` | `lib/shared/mcpAuth.ts` | ✅ реализовано |
| `GET /api/agent/whoami` — identity + `agent_key_id` + `supabase_url`/`supabase_anon_key` одним вызовом по Bearer api_key (public-канал; spec 15 с JWT отклонена) | `src/app/api/agent/whoami/route.ts` | ✅ реализовано |



