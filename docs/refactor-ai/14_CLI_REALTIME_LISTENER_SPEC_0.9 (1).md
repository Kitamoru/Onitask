# Spec · Agent CLI Runtime — Realtime Listener + Lease Loop

**Version:** 0.9  
**Binary concept:** `onitask agent start`  
**Role:** Reference Agent Runtime (not an API surface)

---

## Config

```text
ONITASK_BASE_URL
ONITASK_API_KEY          # long-lived ops identity
ONITASK_AGENT_KEY_ID     # for channel + soft checks (or derived from /me)
RUNTIME_ID               # UUID per process start
RECONCILE_INTERVAL_SEC    # default 45
Realtime JWT from POST /api/agent/realtime-token (Bearer API key) — see 15_REALTIME_AUTH_KEY_EXCHANGE_0.9.md
```

---

## Components

```text
Realtime Listener
      ↓
Wake Dispatcher (dedupe event_id LRU)
      ↓
Lease Manager  ←── timer reconcile
      ↓
Execution Manager (heartbeat, terminal, ack)
      ↓
AgentRunner (content work)
      ↓
MCP or REST client to Onitask
```

---

## Main loop (logical)

```text
start:
  runtime_id = UUID()
  connect Realtime (optional; if fail → poll-only mode)
  subscribe private:agent:{agent_key_id}
  start reconcile timer (30–60s)

on work.available OR timer OR reconnect:
  if event: soft-check workspace_id / agent_key_id match config
  if event_id seen recently: still OK to lease (or skip lease to save load — optional)
  job = POST /api/agent/ops/lease { runtime_id }

  if job == null: return to idle

  // one execution at a time
  ctx = get_task_context(job.task_id)
  start heartbeat loop
  result = AgentRunner.run(ctx)
  stop heartbeat
  POST terminal (outcome, summary, task_version, …)
  POST ack (receipt)
  clear runner session
  // ready for next wake/timer
```

### Hard rules

1. **Never** start work from event payload alone.  
2. **Never** trust task_id from Realtime (v1 has none).  
3. Lifecycle (lease/heartbeat/terminal/ack) in **code**, not LLM.  
4. Runner only does task **content**.  
5. Realtime down ≠ stop; timer continues.

---

## Realtime

**Subscribe:** `private:agent:{agent_key_id}`  

**On message:**

```text
type == work.available
  → enqueue wake (coalesce: multiple events → one lease attempt)
```

**Auth:** short-lived JWT; refresh before expiry.  
On auth failure: log, fall back to poll-only, retry refresh.

**Reconnect:**

```text
on reconnect → immediate ops_lease
if had in-flight execution: heartbeat; on 409 stale → abort local work
```

---

## Dedupe

- LRU of last N `event_id` (e.g. 200) for metrics / optional skip  
- Correctness always via lease  

---

## AgentRunner interface

```text
run(task_context) → {
  outcome: "review" | "escalate" | "handoff",
  summary: string,
  metadata?: object,
  next_owner?: string
}
```

Implementation: shell, local model CLI, HTTP hook — out of this spec.

---

## Error handling

| Case | Action |
|------|--------|
| lease null | idle |
| lease 503 | backoff |
| terminal 409 stale_claim | drop work, idle |
| terminal 409 version_conflict | fail cycle, no blind overwrite |
| runner throw | nack or expire via VT; no fake review |
| process crash | server reaper + outbox requeue policy |

---

## Modes

| Mode | Behavior |
|------|----------|
| Autonomous | `onitask agent start` full loop |
| Poll-only | REALTIME disabled; timer only |
| Interactive | no CLI; IDE + MCP (human-driven) |

---

## Acceptance

- [ ] Without Realtime, timer still leases work  
- [ ] With Realtime, assign → event → lease latency low  
- [ ] Duplicate events safe  
- [ ] One open execution per process  
- [ ] Content work only after get_task_context  
- [ ] terminal + ack after work  

---

*CLI Realtime Listener 0.9*
