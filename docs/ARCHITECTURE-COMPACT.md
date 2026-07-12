# Architecture Compact Summary (generated)

This file aggregates the **critical architectural decisions** from the full
`onitask_Architecture_Master_.md` specification.  It is intentionally short so
that agents can load it without exhausting the context window.

---

## 1. Инварианты (Machine‑Checkable)  
* **INV‑01 – INV‑15** – refer to the original spec for the exact SQL
  constraints.  The most important ones for implementation are:
  - `tasks.assigned_to` → `workers(id)`
  - `tasks.reviewer_id` → `workers(id)`
  - `task_column_history.moved_by` → `workers(id)` (NULL only for system/migration)
  - All AI‑outputs must contain `workspace_id` (tenant isolation – **A‑7**)
  - Secrets are compared with `timingSafeEqual` (**A‑2**)
  - AI quota updates are atomic (**A‑3**)
  - `workspace_settings` is the single source of truth for Flow Board config (**INV‑08**)

## 2. Три скорости (Three‑Speed Architecture)
| Speed | Latency | Stack | Typical Use |
|------|----------|-------|-------------|
| 🟡 **Instant** | <300 ms | Vercel (Edge) | UI actions, `/api/init` |
| 🔵 **Async**   | 3‑10 s  | Supabase Edge Functions + Groq/NeuralDeep | Background enrichment, RAG |
| 🟣 **Agent**   | any    | MCP Server (REST) | External agents (Cursor, Claude) |

## 3. Архитектурные аксиомы (selected)
* **A‑1** – Vercel only for hot‑path (<2 s). Heavy AI runs in Supabase.
* **A‑4** – Vector indexing via `pgvector` (tasks, agent_memory, workspace_doc_chunks).
* **A‑7** – Tenant isolation for all AI outputs.
* **A‑8** – Flow Board visible to all members; AI features limited to Admin/Owner.
* **A‑9** – Cognitive Budget = Σ `cognitive_weight` of in‑progress & review tasks.
* **A‑11** – Assignment Risk Score (0‑100) derived from `attention_risk_score` view.

## 4. Единая модель Worker
All participants (human or AI) are **workers**.  Core foreign‑keys:
```
tasks.assigned_to   → workers.id
tasks.reviewer_id   → workers.id
task_column_history.moved_by → workers.id
```
`workers` table (simplified):
```
id           uuid PK
workspace_id uuid NOT NULL → workspaces.id
type         enum('human','agent')
display_name text
```

## 5. Полная схема БД (high‑level)
* `workspaces`, `workers`, `profiles`
* `tasks`, `task_relations`, `task_column_history`
* `workspace_settings`, `workspace_context`, `workspace_context_cache`
* `assignment_history`, `attention_risk_score` (view)
* `task_enrichments`, `workspace_doc_chunks`
* `agent_events`, `mcp_messages`

## 6. API Contract (key routes)
| Route | Method | Purpose |
|-------|--------|---------|
| `/api/init` | POST | Find‑or‑create user (Telegram initData) |
| `/api/tasks` | GET/POST | List or create tasks |
| `/api/tasks/[id]` | GET/PATCH/DELETE | CRUD for a task |
| `/api/tasks/[id]/decompose` | POST | AI‑driven sub‑task generation |
| `/api/tasks/[id]/relations` | GET | Fetch task graph |
| `/api/flow/metrics` | GET | Flow board health metrics |
| `/api/ai/*` | POST/GET | AI services (transcribe, parse‑task, quota) |
| `/api/mcp/*` | POST/GET | MCP protocol (create_task, move_task, escalate, etc.) |
| `/api/bot/*` | POST/GET | Bot webhook & task handling |

## 7. Настройки воркспейса (excerpt)
* `enable_cognitive_budget` – toggles AI‑Native mode.
* `f04_config` – thresholds for Gatekeeper & Correction Sheet.
* `data_sharing_level` – `minimal`, `standard`, `full` (requires DPA for `full`).

## 8. Политика безопасности (excerpt)
* All secret comparisons use `timingSafeEqual` (**A‑2**).
* AI‑outputs are tenant‑isolated (**A‑7**).
* RLS policies enforce per‑workspace access.
* Data‑sharing levels control what is sent to external LLM providers.

---

*Generated on $(date)*
