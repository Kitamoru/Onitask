# onitask · Техническое решение: MCP Agent Keys, нативный MCP-транспорт, Add-Agent UX

**Версия документа:** 1.0 FINAL  
**Дата:** август 2026  
**Статус:** Согласовано · готово к реализации  
**Тип:** Архитектурное решение — Dev_Flow §2.2, критерии (а) и (б): меняется DDL и публичный контракт MCP tool.

**Затрагивает:**

| Документ | Было → Стало |
|----------|--------------|
| Master Spec | 0.13.4 → **0.13.5** |
| mcp_contract | 0.7.1 → **0.8.0** |
| security | 0.1.1 → **0.2.0** |
| dev_setup | 0.2.2 → **0.2.3** |
| flow | 3.6.0 → **3.7.0** |
| INDEX | 2.7.4 → **2.8.0** |
| MOC | версионные теги |

**Канонические артефакты реализации:**

- Contract: `onitask_mcp_contract_v0.8.0.md`
- Этот документ: обоснование + декомпозиция задач

**UI:** готов (flow §24). В scope реализации — backend + wire UI к `mcp_agent_keys`.

---

## 1. Контекст

Разбор внешнего пакета «Onitask Agentic Contract v1.0.0» выявил пробел: документированный «MCP Contract» — кастомный REST под MCP-именами, а не нативный MCP, который Cursor / Claude Code / Codex автодискаверят через `tools/list`.

Параллельно решён вопрос auth: **`workspace_id` резолвится из API-ключа** (модель «Б»), а не из client-supplied поля. Для этого нужен unique lookup по `key_hash` — jsonb `workspace_settings.mcp_api_keys` этого не даёт → новая таблица `mcp_agent_keys`.

UX подключения агента упрощён до 2 шагов.

---

## 2. Что решили

| # | Решение | Заменяет |
|---|---------|----------|
| 1 | Таблица `mcp_agent_keys` (Master §6.19) | `workspace_settings.mcp_api_keys` (jsonb) |
| 2 | `workspace_id` из ключа (`key_hash` → unique lookup) | Client-supplied `workspace_id` + сверка с jsonb |
| 3 | Два транспорта, один domain: `POST /mcp` (MCP 2026-07-28) + `POST /api/agent/*` | Только REST `/api/mcp/*` |
| 4 | `move_task.version` — обязательное поле | Было рекомендацией §7 п.3 |
| 5 | DFS cycle check в `create_task` — **до** INSERT | Create-then-rollback |
| 6 | `handoff_task` — сигнатура v0.6.0 без обогащения | enriched fields из внешнего пакета |
| 7 | UX: 2 шага, без выбора `allowed_tools` в UI | — (поле в DDL есть, UI профилей = Phase 1.1) |

### Канонические пути (зафиксировано)

| Что | Канон |
|-----|--------|
| MCP URL | `https://onitask.app/mcp` |
| MCP route file | `app/mcp/route.ts` |
| REST base | `https://onitask.app/api/agent` |
| REST routes | `app/api/agent/<tool>/route.ts` |
| Auth helper | `lib/shared/mcpAuth.ts` |
| Domain services | `lib/domain/agent/*.ts` (9 файлов) |

Alias `/api/mcp/*` **не** вводится (pre-launch, 0 external clients).

### Rate limit (без Redis)

```sql
SELECT count(*) FROM agent_events
WHERE workspace_id = $1
  AND agent_name = $2
  AND tool = 'create_task'
  AND created_at > now() - interval '60 seconds';
```

Порог: `mcp_agent_keys.max_tasks_per_minute` (default 50). Превышение → `429 task_creation_rate_limit`.

### `allowed_tools` — нормализация

В DDL: `jsonb NOT NULL DEFAULT '"all"'::jsonb`.

В runtime (`resolveAgentKey` / `isToolAllowed`) нормализовать один раз:

```typescript
function normalizeAllowedTools(raw: unknown): 'all' | string[] {
  if (raw === 'all' || raw === '"all"' ) return 'all';
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed === 'all') return 'all';
      if (Array.isArray(parsed)) return parsed as string[];
    } catch { /* fallthrough */ }
    return 'all';
  }
  if (Array.isArray(raw)) return raw as string[];
  return 'all';
}
```

Контракт типов наружу: `'all' | string[]`.

### `agent_type`

- DDL: `text CHECK (IN ('cursor','claude_code','other'))`, **nullable**
- До выбора формата на шаге 2 UI → `NULL`
- После выбора → всегда одно из enum (`other` если «Другое»)

Не влияет на права — только UI (иконка, шаблон конфига).

---

## 3. Почему (кратко)

1. **Нативный MCP** — единственный пункт внешнего пакета, который закрывает реальный пробел (автодискавери Cursor/Claude Code/Codex).
2. **`version` обязателен** — формализация уже рекомендованного поведения, без новой семантики.
3. **DFS до INSERT** — убирает create-then-rollback; для `create_task` цикл структурно невозможен, проверка сохраняется ради единого контракта с `POST /api/tasks/:id/relations`.
4. **Убран grandfather** («неизвестный ключ = all») — на pre-launch нет legacy-клиентов; риск без пользы.
5. **Без профилей `allowed_tools` в UI** — default `'all'` уже был; UI не показывает то, что 0 пользователей не просили (Phase 1.1).

---

## 4. Что отклонено

| Отклонено | Почему |
|-----------|--------|
| A2A / Agent Card | Нет пользователей; тот же класс, что припаркованные MCP Apps |
| `agent_registry` | Дублирует `workers` (`type='agent'`, auto-create trigger) |
| Enriched `handoff_task` | Нет DDL; круговые handoff закрыты `handoff_chain` + alert |
| Redis rate limit | Масштаба нет; SQL count достаточен |
| `delegation_loop` error | Никто не кидает, нигде не задокументирован |
| Deprecation `/api/mcp/*` | Внешних клиентов не было |

---

## 5. Инварианты

Не меняются и не добавляются `INV-XX` / `A-XX`.  
`mcp_agent_keys` — новый backing store для **A-2** (timingSafeEqual) и **A-7** (tenant isolation).

---

## 6. Дельты по документам (порядок применения)

### 6.1 Master 0.13.4 → 0.13.5 — **первым**

1. Удалить из `workspace_settings` поле `mcp_api_keys` (CREATE + ALTER).
2. После ALTER block:

```sql
-- v0.13.5
ALTER TABLE workspace_settings DROP COLUMN IF EXISTS mcp_api_keys;
```

3. Новый §6.19 (после §6.18, перед §7):

```sql
CREATE TABLE mcp_agent_keys (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key_hash              text NOT NULL,
  -- sha256(raw_key); compare only via timingSafeEqual (A-2)
  label                 text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 100),
  agent_type            text CHECK (agent_type IN ('cursor', 'claude_code', 'other')),
  -- nullable until UI step 2 selects format
  allowed_tools         jsonb NOT NULL DEFAULT '"all"'::jsonb,
  -- 'all' | string[]; normalize in resolveAgentKey
  can_send_messages     boolean NOT NULL DEFAULT true,
  max_tasks_per_minute  int NOT NULL DEFAULT 50,
  created_by            uuid REFERENCES workers(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  last_used_at          timestamptz,
  revoked_at            timestamptz
  -- soft revoke; keep row for agent_events history
);

CREATE UNIQUE INDEX idx_mcp_agent_keys_hash_active
  ON mcp_agent_keys (key_hash)
  WHERE revoked_at IS NULL;

CREATE INDEX idx_mcp_agent_keys_workspace_active
  ON mcp_agent_keys (workspace_id)
  WHERE revoked_at IS NULL;
```

4. §8 consumers: MCP → права/rate limit через `mcp_agent_keys`, не jsonb.  
5. Версия/футер → 0.13.5.

### 6.2 mcp_contract → полная замена на v0.8.0

Файл: `onitask_mcp_contract_v0.8.0.md` (уже собран).  
Ключевые отличи относительно 0.7.1:

- `POST /mcp` + `POST /api/agent/*`
- `workspace_id?` optional, из ключа
- 4 security checks, `agent_name` required
- `move_task.version` required
- DFS before INSERT
- handoff без enrichment

### 6.3 security 0.1.1 → 0.2.0

- §3.1 → `mcp_agent_keys`, без legacy unknown-key=all
- §3.3 → `max_tasks_per_minute` из `mcp_agent_keys`
- §5.1 → cycle check до INSERT, без DELETE rollback

### 6.4 dev_setup 0.2.2 → 0.2.3

- §2.2: `app/mcp/route.ts`, `app/api/agent/*`
- §2.5: `lib/domain/agent/*`, `lib/shared/mcpAuth.ts`
- §3 п.7: этапы под новую структуру

### 6.5 flow 3.6.0 → 3.7.0

Новый §24 «AI-агенты воркспейса»:

- 24.1 Шаг 1: label (1–100) + workspace
- 24.2 Шаг 2: URL `https://onitask.app/mcp` + raw key (один раз) + формат (Cursor / Claude Code / Other)
- 24.3 Список + revoke
- 24.4 MVP vs Phase 1.1 (профили allowed_tools)

### 6.6 INDEX 2.7.4 → 2.8.0 · 6.7 MOC

Версии, ссылки 6.4→6.19, строки задач, теги. Попутно выровнять старый дрейф MOC↔INDEX.

---

## 7. Декомпозиция на задачи для агента

**Конвенции**

- Стек: Vercel (Next.js App Router) + Supabase
- UI §24 уже есть → задачи на API создания/отзыва ключа и backend agent surface
- Каждая задача: цель, файлы, acceptance criteria, зависимости
- Порядок = рекомендуемый порядок PR / агентных прогонов

---

### EPIC A — Database

#### A1. Migration: `mcp_agent_keys` + drop `mcp_api_keys`

**Цель:** DDL Master §6.19 в Supabase.

**Файлы:**

- `supabase/migrations/YYYYMMDDHHMMSS_mcp_agent_keys.sql`

**Содержание миграции:**

```sql
CREATE TABLE mcp_agent_keys ( /* как §6.1 */ );

CREATE UNIQUE INDEX idx_mcp_agent_keys_hash_active
  ON mcp_agent_keys (key_hash) WHERE revoked_at IS NULL;

CREATE INDEX idx_mcp_agent_keys_workspace_active
  ON mcp_agent_keys (workspace_id) WHERE revoked_at IS NULL;

ALTER TABLE workspace_settings DROP COLUMN IF EXISTS mcp_api_keys;
```

**Acceptance:**

- [ ] Таблица и оба partial index существуют
- [ ] `workspace_settings.mcp_api_keys` отсутствует
- [ ] INSERT с дублирующим `key_hash` и `revoked_at IS NULL` → unique violation
- [ ] После soft-revoke (`revoked_at = now()`) можно вставить новый ключ с тем же hash (если понадобится rotate-семантика) **или** rotate всегда генерирует новый raw key — зафиксировать в A2

**Depends:** —  
**Blocks:** B1, C1, D*

---

### EPIC B — Auth foundation

#### B1. `lib/shared/mcpAuth.ts` — resolveAgentKey + isToolAllowed

**Цель:** единая резолюция ключа для REST и MCP.

**Файлы:**

- `lib/shared/mcpAuth.ts`
- `lib/shared/errors.ts` (если ещё нет: `unauthorized`, `forbidden`, `tool_not_permitted`, `invalid_params`)

**API:**

```typescript
type AgentKeyContext = {
  workspaceId: string;
  allowedTools: 'all' | string[];
  canSendMessages: boolean;
  maxTasksPerMinute: number;
  keyHash: string;
};

function sha256(raw: string): string;
function normalizeAllowedTools(raw: unknown): 'all' | string[];
function isToolAllowed(tool: string, allowed: 'all' | string[]): boolean;
async function resolveAgentKey(rawKey: string): Promise<AgentKeyContext>;
// throws DomainError 401 if missing/revoked
// fire-and-forget last_used_at update
```

**Acceptance:**

- [ ] Валидный ключ → context с `workspaceId`
- [ ] Отозванный / неизвестный → 401 `unauthorized`
- [ ] `allowed_tools` jsonb `"all"` и `["a","b"]` нормализуются корректно
- [ ] `timingSafeEqual` на сравнении hash (не `===` строк в hot path после select — select по hash, equal при необходимости на raw)
- [ ] Unit-тесты на normalize + isToolAllowed

**Depends:** A1  
**Blocks:** C*, D*

---

#### B2. Request guard helper

**Цель:** 4 checks из contract §2.4 в одном месте.

```typescript
async function assertAgentRequest(opts: {
  rawKey: string | null;
  body: { workspace_id?: string; agent_name?: string };
  toolName: string;
}): Promise<AgentKeyContext & { agentName: string }>
```

**Поведение:**

1. no/invalid key → 401  
2. optional `workspace_id` mismatch → 403 `forbidden`  
3. missing `agent_name` → 400 `invalid_params`  
4. tool not allowed → 403 `tool_not_permitted`

**Acceptance:** таблица ошибок contract §6 покрыта тестами на guard.

**Depends:** B1

---

### EPIC C — Domain layer

Один файл на tool. Сигнатуры — contract v0.8.0 §4.  
`workspace_id` всегда из `AgentKeyContext`, не из доверия к body.

#### C1. Shared domain types + error envelope

**Файлы:** `lib/shared/types.ts`, `lib/shared/errors.ts`

- `DomainResult<T> = { success: true } & T | { success: false; error: { code, type, message } }`
- Типы request/response для 9 tools (можно постепенно)

**Depends:** —  
**Blocks:** C2–C10

---

#### C2. `createTask`

**Файл:** `lib/domain/agent/createTask.ts`

**Поток:**

1. rate limit count (SQL 60s) vs `maxTasksPerMinute`  
2. if `blocked_by`: exists? → else 404 `blocker_not_found`  
3. if `blocked_by`: DFS cycle → 409 `circular_dependency` (**до** INSERT)  
4. INSERT task (+ optional relation) atomically (RPC или transaction)  
5. agent_events + enrichment queue  
6. return task preview + `relation_created`

**Acceptance:**

- [ ] >50 create/min → 429 `task_creation_rate_limit`
- [ ] cycle → 409, **ноль** строк в `tasks` / `task_relations`
- [ ] unknown blocker → 404
- [ ] default column/backlog + is_inbox rules

**Depends:** B1, C1, A1

---

#### C3. `moveTask`

**Файл:** `lib/domain/agent/moveTask.ts`

- `version` required (caller/guard уже 400 если нет)
- optimistic: `UPDATE … WHERE id AND version` → 0 rows = 409 `version_conflict`
- `claim=true` → 409 `already_claimed` если чужой assignee
- `done` → cascade unblock, вернуть `unblocked_ids`

**Depends:** B1, C1

---

#### C4. `getTasksByColumn` · C5. `getWorkspaceSettings` · C6. `getTaskContext`

Read-only.  
Smart backlog: `sort_by_blocking_value` только для `backlog`.  
`get_task_context` включает subgraph, history, events, memory, docs.

**Depends:** B1, C1

---

#### C7. `handoffTask` · C8. `escalateTask`

Семантика contract §4.8 / §4.5.  
Без enriched fields.  
`target_agent` неизвестен → 404 `worker_not_found`.

**Depends:** B1, C1

---

#### C9. `sendMessageToChat`

- chat в workspace  
- `can_send_messages`  
- `sanitizeOutput(text, 'tg')`  
- Telegram Bot API

**Depends:** B1, C1

---

#### C10. `undo`

Окно 5 минут, только events текущего `agent_name`.  
Post-MVP: version CAS — не блокирует MVP.

**Depends:** B1, C1

---

### EPIC D — Transports

#### D1. REST routes `app/api/agent/*`

**Файлы:** по одному `route.ts` на tool + `undo/[event_id]/route.ts`.

**Паттерн:**

```typescript
// app/api/agent/create_task/route.ts
export async function POST(req: Request) {
  const body = await req.json();
  const auth = await assertAgentRequest({
    rawKey: bearer(req),
    body,
    toolName: 'create_task',
  });
  const result = await createTask({ ...body, workspaceId: auth.workspaceId, agentName: auth.agentName, key: auth });
  return Response.json(result, { status: result.success ? 200 : result.error.code });
}
```

**Acceptance:**

- [ ] Все 9 endpoints отвечают по contract
- [ ] Ошибки — envelope §6
- [ ] Нет чтения `workspace_id` из body как source of truth

**Depends:** B2, C2–C10

---

#### D2. Native MCP `app/mcp/route.ts`

**Цель:** MCP 2026-07-28 Streamable HTTP, stateless.

**Headers:** `MCP-Protocol-Version`, `Mcp-Method`, optional `Mcp-Name`, `Authorization`.

**Methods:**

| Mcp-Method | Behavior |
|------------|----------|
| `server/discover` | protocolVersions, capabilities, serverInfo |
| `tools/list` | 9 tools + JSON Schema inputSchema; `ttlMs: 60000`, `cacheScope: "private"` |
| `tools/call` | name + arguments → тот же domain, что REST |

**Acceptance:**

- [ ] `tools/list` возвращает все 9 имён
- [ ] `tools/call` create_task даёт **ту же** строку в БД, что REST create_task
- [ ] Auth/errors идентичны REST (те же DomainError → JSON-RPC error + data)

**Depends:** B2, C2–C10

---

#### D3. Parity test REST ↔ MCP

**Цель:** один integration test:

1. create_task via REST  
2. create_task via MCP с теми же arguments  
3. сравнить persisted rows (tasks + agent_events tool/agent_name)

**Depends:** D1, D2

---

### EPIC E — UI wire (UI экраны готовы)

#### E1. API: create agent key

**Endpoint (internal, session auth, не agent key):**  
`POST /api/workspace/agent-keys` (или существующий admin route)

**Body:** `{ label, workspace_id, agent_type? }`  
**Server:**

1. generate raw key (`otk_…`)  
2. `key_hash = sha256(raw)`  
3. INSERT `mcp_agent_keys` (`allowed_tools='all'`, defaults)  
4. return `{ raw_key, mcp_url, rest_base_url, label, id }` — **raw только в этом ответе**

**Acceptance:** raw не логируется; повторный GET не возвращает raw.

**Depends:** A1

---

#### E2. API: list + revoke

- `GET …/agent-keys?workspace_id=` → active rows (`revoked_at IS NULL`)  
- `POST …/agent-keys/:id/revoke` → `revoked_at = now()`

**Depends:** A1

---

#### E3. Wire flow §24

Подключить готовый UI:

- Шаг 1 → label + workspace  
- Шаг 2 → показать raw + `https://onitask.app/mcp` + REST base + copy snippets  
- Список + confirm revoke → E2  

**Depends:** E1, E2

---

### EPIC F — Docs apply (можно параллельно с кодом)

| ID | Задача |
|----|--------|
| F1 | Master patch 0.13.5 |
| F2 | Заменить mcp_contract на v0.8.0 |
| F3 | security patch 0.2.0 |
| F4 | dev_setup 0.2.3 |
| F5 | flow §24 (3.7.0) |
| F6 | INDEX + MOC |

**Depends:** — (документы); код опирается на A1 + contract v0.8.0

---

## 8. Порядок выполнения (рекомендуемый)

```text
Phase 0  F1–F6 (docs)          ─┐ optional parallel
Phase 1  A1 (migration)         │
Phase 2  B1 → B2 (auth)         │
Phase 3  C1 → C10 (domain)      │
Phase 4  D1 + D2 (transports)   │
Phase 5  D3 (parity)            │
Phase 6  E1 → E3 (UI wire)      │
Phase 7  Smoke: Cursor/Claude Code подключаются по MCP URL + key
```

**MVP done when:**

1. Миграция накатена  
2. REST `/api/agent/*` и `POST /mcp` работают на одном domain  
3. Ключ создаётся из UI, показывается один раз, revoke работает  
4. Агент (Cursor или тестовый script) делает:  
   `get_workspace_settings` → `get_tasks_by_column` → `move_task(claim)` → `move_task(done)`

---

## 9. Чеклист применения (docs + code)

**Документы**

- [ ] Master §6.4 drop + §6.19 + §8
- [ ] mcp_contract = v0.8.0
- [ ] security §3.1, §3.3, §5.1
- [ ] dev_setup §2.2, §2.5, §3.7
- [ ] flow §24
- [ ] INDEX + MOC

**Код**

- [ ] A1 migration
- [ ] B1 mcpAuth + B2 guard
- [ ] C1–C10 domain
- [ ] D1 REST + D2 MCP + D3 parity
- [ ] E1–E3 UI wire
- [ ] Smoke с реальным MCP-клиентом

---

## 10. Вне scope (не брать в эти задачи)

- A2A, agent_registry, Redis
- Enriched handoff fields
- UI выбора `allowed_tools` (Phase 1.1)
- Alias `/api/mcp/*`
- Undo with version CAS (post-MVP)
- Granular agent_type install docs (Phase 1.1)

---

*onitask · TECH_SOLUTION MCP Agent Keys · FINAL 1.0 · август 2026*  
*Companion to onitask_mcp_contract_v0.8.0.md · Implementation-ready for coding agents*
