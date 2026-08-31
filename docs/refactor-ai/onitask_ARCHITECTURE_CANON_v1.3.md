# onitask · Architecture Canon

**Версия:** 1.3 CANON (FINAL for 0.9 implementation)  
**Дата:** 29 августа 2026  
**Статус:** Утверждён · см. `11_ADR_RESOLUTIONS_0.9.md`  
**Предыдущая:** v1.2  

---

## 0. Executive summary

Onitask — **AI-native Work OS** (control plane): задачи, права, dispatch, audit и human review для команды и **внешних** AI-агентов.

Не агент, не host LLM, не playbook/guidance «как думать».

```text
HUMAN (UI · Telegram)
  → Onitask Work OS
  → Dispatch (outbox → queue)
  → External Agent Runtime (ops contract)
  → Agent HOW / Model
  → Human acceptance (done | fix)
```

**Principle:** Onitask does not tell agents how to think. It defines how work enters, moves through, and exits the operational system.

**Promise:** Reliable operational contour for external agents — not “we configured your model.”

---

## 1. Responsibility boundaries

| Layer | Owns |
|-------|------|
| Onitask | What / Who / When / State / Policy / Dispatch / Lease / Fencing / Audit / Review / Human notify |
| Runtime | lease→work→terminal→ack, 1 task/cycle, session isolation |
| Agent/IDE | How, quality, local rules |
| Human | Acceptance, work-item text |

**Explicitly out of scope:** playbook high/lite, Agent Guidance UI, system prompt product, multi-identity per API key.

---

## 2. Principles

1. `tasks` = sole SoT for work state.  
2. Outbox/queue = dispatch only.  
3. **REST `/api/agent/ops/*`** = canonical operational HTTP.  
4. **MCP** = domain + ops tools (same capabilities).  
5. Agent terminal = `review` | `escalate` | `handoff` via **ops terminal**, not `move_task`.  
6. `done` = human.  
7. Version = domain CAS; execution_id = execution fencing.  
8. **1 mcp_agent_key = 1 agent identity** (from key row only).  
9. No playbook resolve in protocol.  
10. Lease qty=1; runtime resets LLM context between tasks.  
11. Agent ops mutations **fail-closed** on quota/infra errors; legacy domain may retain fail-open.  
12. Global platform throttle = future track (not this pack).

---

## 3. Channels

| Channel | Role |
|---------|------|
| `POST /api/agent/ops/*` | Operational contract |
| `POST /api/agent/*` | Domain REST mirror |
| `POST /mcp` | MCP domain + ops |
| `onitask-duty` | Reference runtime client |
| Web UI | Human board |
| Telegram webhook | Human commands + `ra:*` review |
| bot-notify | Human push (`enrichment_queue`) |
| Optional agent webhook | Wake only (`work.available`) → must lease |

---

## 4. Execution model

- Tables: `task_executions`, `tasks.active_claim_id`, `dispatch_outbox`, `dispatch_receipts`  
- Lease TX: create execution + task → `in_progress` + claim pointer  
- Terminal: fenced; idempotent same outcome  
- ACK: delivery receipt after terminal  
- Reaper: expire open VT; requeue by policy / escalate at max_attempts  
- Human column change with open claim: **DB trigger** force-closes execution (`human_override`)

Details: Ops API 0.9 · DDL 05 · Reaper 09 · ADR R8.

---

## 5. Auth model (0.9)

```text
Bearer key → mcp_agent_keys
  → workspace_id, agent identity, allowed_tools, autonomy
  → optional webhook_url / webhook_secret on same row
```

- No runtime override of agent identity via header/body.  
- `observer` → no ops mutations.  
- Dropped: `agent_duty_state`, long-poll duty as supported path.

---

## 6. Human Telegram

- Webhook: create/lookup/backlog/review actions — not agent executor.  
- Notify: `task_started` (lease), `task_review` (terminal), `task_done` (human approve), etc.  
- Visibility JTBD for “agent picked up work” = notify path in 0.9.

---

## 7. Formula

```text
ONITASK = WHAT / WHO / WHEN / STATE / POLICY / REVIEW / NOTIFY
RUNTIME = EXECUTION LIFECYCLE
AGENT   = HOW
MODEL   = INTELLIGENCE
HUMAN   = ACCEPTANCE
KEY     = ONE AGENT PRINCIPAL
```

---

*Canon v1.3 · pair with 11_ADR_RESOLUTIONS_0.9.md*
