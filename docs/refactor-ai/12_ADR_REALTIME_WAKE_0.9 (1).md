# ADR · Realtime Wake for Agent Runtime

**Status:** Accepted  
**Date:** 2026-09-02  
**Depends on:** Ops API 0.9 · Canon v1.3 · ADR Resolutions 0.9  

---

## Decision

Agent wake transport = **Supabase Realtime Broadcast** (ephemeral).  
Work grant remains **only** `POST /api/agent/ops/lease`.  
Durable intent = **`dispatch_outbox`**.  
Publisher = **at-least-once** outbox worker.  
CLI Agent Runtime must work **without** Realtime (timer reconcile).

## Principles

```text
Realtime wakes the agent.
Lease grants the work.
MCP operates the work.
PostgreSQL defines the truth.
CLI owns the runtime.
```

```text
Assign  → domain + outbox (NO claim/execution)
Lease   → claim + execution + in_progress
Broadcast → best-effort notification only
```

## Non-goals

- Exactly-once broadcast  
- task_id in wake payload (v1)  
- postgres_changes / presence as dispatch  
- Long-lived Realtime JWT (30–90d)  
- Replacing ops_lease path name in v1  

---

## Event contract

**Channel:** `private:agent:{agent_key_id}`  

**Payload:**

```json
{
  "event_id": "evt_…",
  "type": "work.available",
  "workspace_id": "ws_…",
  "agent_key_id": "key_…",
  "ts": "2026-09-02T12:00:00.000Z"
}
```

Semantics: *potential work may exist; call ops/lease for authoritative result.*

## Failure model

| Failure | Outcome |
|---------|---------|
| Broadcast lost | Timer → ops_lease |
| Duplicate broadcast | ops_lease → often job null; safe |
| Publisher crash after send before mark | Retry → duplicate event; safe |
| Stale event | ops_lease / fencing decides |
| Realtime down | Runtime degrades to poll only |

## Auth

- Long-lived: `mcp_agent_key` for REST/MCP ops  
- Short-lived JWT (5–30 min) for Realtime subscribe, refresh via Onitask endpoint  
- Channel authorize: token agent_key_id must match channel  

## Reconcile

- Default timer: **30–60s** while duty active  
- Optional idle backoff: 2–5 min  
- On Realtime reconnect: immediate ops_lease  

---

*Accepted*
