# onitask · Reaper & retry policy 0.9

**Component:** scheduled job (cron / Edge with secret)  
**Does not:** run agent work or long poll  

---

## On VT expiry

When `task_executions.status = 'open'` AND `now() > expires_at + grace` (grace default 30s):

```text
BEGIN
  UPDATE task_executions
    SET status = 'expired', closed_at = now()
    WHERE id = E AND status = 'open'

  UPDATE tasks
    SET active_claim_id = NULL,
        version = version + 1
    WHERE id = E.task_id AND active_claim_id = E.id

  -- task column stays non-terminal (e.g. in_progress or policy column)
COMMIT
```

**Not** automatic: immediately create new execution.

---

## Retry policy (after expire)

```text
attempt = expired.attempt

if attempt < max_attempts (default 3):
  INSERT dispatch_outbox (
    task_id, workspace_id, agent_name,
    attempt = attempt + 1,
    status = 'pending'
  )
else:
  system escalate task (domain)
  optional: DLQ record / admin notify (escalation_alert)
  no further auto-outbox
```

`max_attempts` — workspace or platform setting; not agent “personality”.

---

## Nack policy (runtime)

| reason | Suggested |
|--------|-----------|
| `transient_error` | expire-equivalent; allow requeue under max_attempts |
| `runtime_busy` | delay requeue (optional) or same as transient |
| `unsupported_task` | escalate; no silent infinite retry |
| `dependency_unavailable` | requeue or escalate per product |

Close execution as failed/expired path; clear `active_claim_id`.

---

## Schedule

- Reaper every **30–60s**  
- Batch limit open expired rows (e.g. 100)  
- Idempotent: only `status = open` rows  

---

## Metrics (recommended)

- open executions count  
- expired last hour  
- outbox pending depth  
- tasks in_progress with null claim older than VT  

---

*Reaper 0.9*
