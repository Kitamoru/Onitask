# onitask · Duty Runtime 0.9 FINAL

**Role:** Reference operational client — not a hosted agent  
**Transport:** REST `/api/agent/ops/*` (preferred)  
**Identity:** API key implies agent; no multi-name  

---

## Config

```text
ONITASK_BASE_URL
ONITASK_API_KEY
ONITASK_RUNTIME_ID   # optional; UUID on start
```

Agent name from server/key — not user-selected per request.

---

## Loop

```text
lease → get_task_context → AgentRunner.run → heartbeat* → terminal → ack
→ clear session → next lease
```

Invariants: 1 open execution; no lease while open; terminal before ack; context boundary per task.

---

## AgentRunner

```text
run(ctx) → { outcome, summary?, metadata?, next_owner? }
```

No embedded playbook. No model policy from Onitask.

---

## Errors

| Code | Action |
|------|--------|
| job null | backoff, retry lease |
| stale_claim / lease_expired | discard, no terminal/ack, loop |
| version_conflict | do not blind overwrite; fail cycle |
| 503 quota_unavailable | backoff fail-closed |

---

## Exit codes (CLI only)

0 clean · 1 generic · 2 config · 3 auth · 4 protocol · 5 stale · 6 runner  

---

*Duty 0.9 FINAL*
