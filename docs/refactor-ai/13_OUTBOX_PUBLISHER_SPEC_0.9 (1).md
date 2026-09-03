# Spec · Outbox Publisher (Realtime Broadcast)

**Version:** 0.9  
**Role:** Drain `dispatch_outbox` → Supabase Realtime Broadcast  
**Delivery:** **at-least-once** (duplicates OK)

---

## Responsibilities

| Does | Does not |
|------|----------|
| Read unpublished outbox rows | Create claims/executions |
| Broadcast `work.available` | Guarantee agent received event |
| Mark outbox published / retry | Call ops_lease |
| Correlate `event_id` | Send task body / secrets |

---

## Outbox row (logical)

```text
id
workspace_id
agent_key_id      -- or resolve from agent_name → key
task_id           -- internal only; NOT in broadcast payload
attempt
status            -- pending | published | failed
event_id          -- stable id for this outbox row (or generated once)
created_at
published_at
publish_attempts
last_error
```

Assign path:

```text
BEGIN
  update task assignment (domain)
  INSERT dispatch_outbox (status=pending, event_id=…)
COMMIT
-- no broadcast in request path
```

---

## Publisher loop

```text
loop:
  rows = SELECT … FROM dispatch_outbox
         WHERE status = 'pending'
         ORDER BY created_at
         LIMIT batch
         FOR UPDATE SKIP LOCKED

  for row in rows:
    payload = {
      event_id: row.event_id,
      type: "work.available",
      workspace_id: row.workspace_id,
      agent_key_id: row.agent_key_id,
      ts: now_iso
    }
    channel = "agent:" + row.agent_key_id   # private channel name per Supabase convention

    try:
      realtime.broadcast(channel, payload)   # at-least-once
      UPDATE outbox SET status='published', published_at=now()
    catch err:
      publish_attempts++
      last_error = err
      if attempts > max: status='failed' (alert); else leave pending for retry

  sleep(short) or listen NOTIFY
```

### Crash window

```text
broadcast OK → crash before mark published
  → row still pending → retry → duplicate event_id
  → CLI dedupe optional; lease ensures correctness
```

Do **not** mark published before successful broadcast API call.  
Accept duplicate broadcasts.

---

## Trigger points that insert outbox

- Assign task to agent  
- Requeue after expire (reaper policy)  
- Handoff to another **agent** (new outbox for target key)  
- Human fix → agent requeue (if product does)

Not on: heartbeat, terminal, human approve done.

---

## Config

| Param | Default |
|-------|---------|
| batch size | 50–100 |
| poll interval | 1–5s (or LISTEN/NOTIFY) |
| max publish attempts | 10 |
| failed → alert | yes |

---

## Observability

- pending depth  
- published/min  
- failed count  
- age of oldest pending  
- log event_id, agent_key_id, workspace_id  

---

## Implementation notes (Supabase)

- Use service role on publisher only (server-side worker: Edge cron, or long worker, or queue consumer).  
- Broadcast to private channel; clients need realtime authorization.  
- Never run publisher with user JWT.  

---

## Acceptance

- [ ] Assign creates outbox pending, no claim  
- [ ] Publisher sends payload without task_id  
- [ ] Mark published only after broadcast attempt success  
- [ ] Kill publisher mid-flight → retry → duplicate OK  
- [ ] Failed rows visible / alertable  
- [ ] CLI offline still gets work via timer lease  

---

*Outbox Publisher 0.9*
