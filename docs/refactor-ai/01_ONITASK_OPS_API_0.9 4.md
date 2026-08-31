# onitask · Operational API 0.9

**Version:** 0.9.0-FINAL  
**Status:** Ready for implementation  
**Base path:** `/api/agent/ops`  
**Auth:** `Authorization: Bearer <mcp_agent_key>`  
**Identity:** 1 key = 1 agent (from key row only) — see ADR R2  
**Content-Type:** `application/json`

---

## Invariants

1. REST is the **canonical** operational HTTP API.  
2. `execution_id` = domain; `receipt` = delivery — never conflate.  
3. `lease` creates execution and sets task → `in_progress` in **one TX**.  
4. Agent completion **only** via `terminal`, never `move_task`.  
5. Same execution + same outcome terminal → **200** idempotent.  
6. Stale/foreign claim → **409** `stale_claim`.  
7. Empty lease → **200** `{ "job": null }`.  
8. Requeue after VT = **policy**, not blind side-effect.  
9. Agent identity from **key only**; body `agent_name` if present must match.  
10. Ops mutations **fail-closed** on quota/infra RPC failure (503/429).

---

## Endpoints

| Method | Path |
|--------|------|
| POST | `/api/agent/ops/lease` |
| POST | `/api/agent/ops/executions/{execution_id}/heartbeat` |
| POST | `/api/agent/ops/executions/{execution_id}/terminal` |
| POST | `/api/agent/ops/executions/{execution_id}/ack` |
| POST | `/api/agent/ops/executions/{execution_id}/nack` |

---

## 1. Lease

### `POST /api/agent/ops/lease`

**Request**

```json
{
  "runtime_id": "550e8400-e29b-41d4-a716-446655440000",
  "agent_name": "coding-agent",
  "limit": 1
}
```

| Field | Required | Notes |
|-------|----------|--------|
| `runtime_id` | yes | Client UUID for process |
| `agent_name` | no* | If set, must equal key identity; else 403 |
| `limit` | no | Default 1, max 1 |

\*Server always uses agent identity from key; `agent_name` is optional assert.

**Response 200 — job**

```json
{
  "job": {
    "execution_id": "exec_…",
    "task_id": "task_…",
    "workspace_id": "ws_…",
    "agent_name": "coding-agent",
    "runtime_id": "550e8400-e29b-41d4-a716-446655440000",
    "attempt": 1,
    "task_version": 18,
    "lease_expires_at": "2026-08-27T14:30:00.000Z",
    "heartbeat_interval_seconds": 60,
    "receipt": "rcpt_…"
  }
}
```

**Response 200 — empty:** `{ "job": null }`

**TX:** pick dispatch → insert `task_executions` → update task `in_progress` + `active_claim_id` + version++ → bind receipt.

Then client: domain `get_task_context` (not in lease body).

Emit (async/same policy): `bot_notify` `task_started`.

---

## 2. Heartbeat

### `POST /api/agent/ops/executions/{execution_id}/heartbeat`

```json
{ "runtime_id": "…" }
```

**200:** `{ "execution_id", "status", "lease_expires_at", "heartbeat_at" }`

Rules: owner runtime; status open; now ≤ expires_at + **grace 30s**; else 409 `lease_expired` / `stale_claim`.

Defaults: VT **20 min**; heartbeat ≤ **60s**; grace **30s**.

---

## 3. Terminal

### `POST /api/agent/ops/executions/{execution_id}/terminal`

```json
{
  "runtime_id": "…",
  "task_id": "…",
  "task_version": 18,
  "outcome": "review",
  "summary": "optional",
  "metadata": {},
  "next_owner": null
}
```

`outcome`: `review` | `escalate` | `handoff`

**Escalate:** set `needs_human`, `escalation_reason` (from summary/metadata) for Operator Queue / Risk Pulse.

**Handoff:**  
- agent next → domain + `dispatch_outbox`  
- human next → domain assign human; **no** agent outbox; notify assignment  

**Idempotency:** same outcome on closed → 200; different → 409 `claim_closed`; stale → 409 `stale_claim`; version mismatch → 409 `version_conflict`.

Emit: `task_review` / escalation / handoff alerts per emit spec.

---

## 4. ACK / NACK

**ACK** after terminal:

```json
{ "runtime_id": "…", "receipt": "rcpt_…" }
```

Strict 0.9: ack without terminal → 409 `terminal_required`. Idempotent ack → 200.

**NACK:** delivery/accept failure (`unsupported_task` | `runtime_busy` | `dependency_unavailable` | `transient_error` | `other`) — not business terminal.

---

## Errors

Envelope: `{ "error": { "code", "message", "details" } }`

| HTTP | code |
|------|------|
| 400 | invalid_request |
| 401 | invalid_credentials |
| 403 | forbidden_workspace, agent_not_allowed |
| 404 | task_not_found, execution_not_found |
| 409 | version_conflict, stale_claim, claim_closed, lease_expired, terminal_required, task_already_claimed |
| 422 | invalid_terminal_transition |
| 429 | rate_limited |
| 500 | internal_error |
| 503 | dispatch_unavailable, quota_unavailable |

`stale_claim` ≠ `version_conflict`.

---

## Wake webhook (optional, outbound)

```json
{
  "event_id": "…",
  "type": "work.available",
  "workspace_id": "…",
  "agent_name": "…"
}
```

HMAC from key’s `webhook_secret`. Does not replace lease.

---

## Defaults

| Param | Value |
|-------|--------|
| Prefix | `/api/agent/ops` |
| Lease limit | 1 |
| VT | 20 min |
| Heartbeat | 60s |
| Grace | 30s |
| max_attempts | 3 |

---

## Related

OpenAPI: `06_ONITASK_OPS_API_0.9.openapi.yaml`  
DDL: `05_…sql` · Reaper: `09_…` · ADR: `11_…`

---

*Ops API 0.9 FINAL*
