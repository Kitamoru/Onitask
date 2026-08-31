<!-- 0.9 FINAL: emitters from lease/terminal; reason from ops_terminal events -->
# onitask · bot_notify emit specification 0.9

**Queue table:** `enrichment_queue`  
**type:** `bot_notify`  
**Consumer:** `supabase/functions/bot-notify`  
**Producer:** domain layer (lease, terminal, review_action, assign) — **not** the agent client

---

## Row shape

```ts
{
  type: 'bot_notify',
  status: 'pending',
  workspace_id: uuid,
  payload: BotNotifyPayload,
  created_at: timestamptz
}
```

## Payload common fields

```ts
type BotNotifyPayload = {
  alert_type: AlertType
  task_id?: string
  full_id?: string
  title?: string
  column?: string
  priority?: string
  deadline?: string | null
  created_by?: string          // worker id
  reviewer_id?: string         // worker id
  claimed_by?: string          // agent worker id (task_started)
  worker_id?: string           // human assignee (task_assignment)
  assignee_id?: string         // alias
  reason?: string              // summary / escalate / fix reason
  escalation_reason?: string
  suggested_action?: string
  hours_left?: number
  // ...existing fields kept for backward compat
}

type AlertType =
  | 'task_started'
  | 'task_review'
  | 'task_done'
  | 'task_assignment'
  | 'member_added'
  | 'escalation_alert'
  | 'escalation_resolved'
  | 'deadline_approaching'
  | 'resolution_notify'
  | 'cascade_unblock'
  | 'handoff_chain_alert'
```

---

## Emit matrix (required for 0.9 synergy)

| Domain event | alert_type | Required payload |
|--------------|------------|------------------|
| `ops.lease` success | `task_started` | `task_id`, `full_id`, `claimed_by` |
| `ops.terminal` outcome=`review` | `task_review` | `task_id`, `full_id`, `reason`←summary |
| `ops.terminal` outcome=`escalate` | `escalation_alert` | `task_id`, `full_id`, `escalation_reason` |
| `ops.terminal` outcome=`handoff` | `handoff_chain_alert` | `task_id`, `full_id`, next owner fields |
| `review_action` approve | `task_done` | `task_id`, `full_id`, `created_by` |
| assign to **human** worker | `task_assignment` | `task_id`, `worker_id` (human) |
| assign to **agent** | — | **no** personal assignment DM |

Insert into `enrichment_queue` in the **same transaction** as domain change when possible; else immediately after commit (at-least-once ok; notify is idempotent enough via status).

---

## agent_events for reason (bot-notify read path)

On terminal, write event:

```ts
{
  tool: 'ops_terminal',  // or 'terminal_execution'
  task_id,
  workspace_id,
  agent_name,
  summary: outcome, // or human text
  metadata: {
    outcome,
    summary,
    execution_id,
    reason: summary
  }
}
```

**bot-notify `fetchLastMoveReason`:** prefer latest of:

1. `tool IN ('ops_terminal','terminal_execution')` → metadata.summary / reason  
2. else `tool = 'move_task'` → metadata.reason  

---

## Pseudocode emitters

```ts
// after successful lease TX
await enqueueBotNotify({
  workspace_id,
  payload: {
    alert_type: 'task_started',
    task_id,
    full_id,
    claimed_by: agentWorkerId,
    column: 'in_progress',
  },
})

// after successful terminal TX
if (outcome === 'review') {
  await enqueueBotNotify({
    workspace_id,
    payload: {
      alert_type: 'task_review',
      task_id,
      full_id,
      reason: summary ?? '',
      reviewer_id,
    },
  })
}
```

---

## Non-goals

- Emitting from Telegram webhook for agent lifecycle  
- Using `enrichment_queue` as agent_dispatch  

---

*Emit spec 0.9*
