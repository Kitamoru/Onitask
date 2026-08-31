# onitask · MCP Contract 0.9 FINAL

**Transport:** `POST /mcp`  
**Auth:** Bearer mcp_agent_key · **1 key = 1 agent**  
**Depends:** Ops API 0.9 · ADR 11 · Canon v1.3  

---

## Invariants

```text
REST = canonical operational HTTP
MCP  = domain + ops tools (parity B)
Identity = from key only
Agent completion = ops_terminal only
No playbook tools
```

---

## Domain tools (from 0.8 — see merge guide 10)

`get_workspace_settings`, `get_tasks_by_column`, `get_task_context`, `create_task`,  
`move_task` (human/compat; not agent terminal when claim open),  
`handoff_task` / `escalate_task` (prefer ops_terminal if execution open),  
`send_message_to_chat`, `undo` if product has them.

**Removed / rejected:** `wait_for_tasks` (error or omit). Playbook tools — none.

---

## Operational tools

| Tool | REST |
|------|------|
| `ops_lease` | POST /api/agent/ops/lease |
| `ops_heartbeat` | POST …/executions/{id}/heartbeat |
| `ops_terminal` | POST …/executions/{id}/terminal |
| `ops_ack` | POST …/executions/{id}/ack |
| `ops_nack` | POST …/executions/{id}/nack |

### ops_lease input

```json
{
  "runtime_id": "uuid",
  "agent_name": "optional assert == key",
  "limit": 1
}
```

Output: `{ "job": { … envelope … } | null }`

### ops_terminal input

```json
{
  "execution_id": "…",
  "runtime_id": "…",
  "task_id": "…",
  "task_version": 18,
  "outcome": "review|escalate|handoff",
  "summary": "optional",
  "metadata": {},
  "next_owner": null
}
```

Errors: same codes as Ops API (`stale_claim`, `version_conflict`, …).

---

## AuthZ

- `allowed_tools` includes ops tool names or `all`  
- `observer` → no ops mutation tools  

---

## Duty loop via MCP

```text
ops_lease → get_task_context → work → ops_heartbeat* → ops_terminal → ops_ack
```

---

*MCP 0.9 FINAL*
