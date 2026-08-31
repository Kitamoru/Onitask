<!-- 0.9 FINAL: identity from key; visibility via task_started/task_review; no agent ops in bot -->
# onitask · Human Telegram channel — synergy with Architecture 0.9

**Version:** 0.9.0-draft  
**Status:** Change list for existing bot stack (not a rewrite of agent protocol)  
**Components:** `lib/bot.ts` · `/api/bot/webhook` · `supabase/functions/bot-notify`  

---

## Role (unchanged)

```text
Telegram = human surface (create, lookup, review, notify)
Agent execution = REST ops / MCP / onitask-duty
```

Do **not** implement lease/terminal inside bot webhook or bot-notify.

---

## What stays (no rewrite required for protocol)

### `bot.ts`

- Telegram API client, webhook secret verify  
- `buildTaskCard` / `renderTaskCardBody` for created/lookup  
- Workspace keyboard helpers  
- Mini App deep links  

### Webhook

- `/task`, `/call`, `/backlog`, `/help`, `/start`  
- `ra:approve` / `ra:fix` / `ra:back` → `review_action` RPC  
- Draft create flow, freemium gates  

### bot-notify

- Poll `enrichment_queue` type `bot_notify`  
- Cards: assignment, started, review, done, escalation, …  
- Personal DM only for `workers.type === 'human'`  

---

## Required changes for synergy with Ops 0.9

### A. Domain emitters (primary work — not bot files)

After these domain transitions, enqueue `enrichment_queue` row `type=bot_notify`:

| Trigger | alert_type | Payload must include |
|---------|------------|----------------------|
| **ops lease** success | `task_started` | `task_id`, `full_id`, `claimed_by` (agent worker id) or agent label |
| **ops terminal** `review` | `task_review` | `task_id`, `full_id`, `summary`/`reason`, `reviewer_id` if any |
| **ops terminal** `escalate` | `escalation_alert` | `task_id`, reason, optional suggested_action |
| **ops terminal** `handoff` | `handoff_chain_alert` | `task_id`, next owner |
| Human `review_action` approve | `task_done` | as today |
| Human assign to **human** | `task_assignment` | worker_id human only |

If emitters still listen only to legacy `move_task`, agent path via **terminal** will not notify — **must fix emitters**.

### B. bot-notify — reason source

**Today:** `fetchLastMoveReason` filters `agent_events.tool = 'move_task'`.

**Change:** resolve display reason from latest of:

1. `ops_terminal` / terminal event `summary` or `metadata.summary`  
2. else `move_task` metadata.reason  
3. else escalate reason  

So review/done cards show agent summary after duty runtime.

### C. task_started payload

Ensure lease path sets `claimed_by` (or `agent_name`) consistently with `task_executions` / agent worker, so «взята агентом X» is correct.

### D. Optional DRY (bot.ts ↔ notify)

Not blocking 0.9, recommended:

1. Extract shared `TaskCardData` + `renderTaskCardBody` to one module used by webhook **and** bot-notify.  
2. Add `buildReviewActionKeyboard(taskId)` in shared module (ra:approve / ra:fix / open).  
3. Fix legacy `buildTaskConfirmationKeyboard` if it still uses relative `/board?task=` — use `taskUrl(fullId)`.

### E. Do not change

- bot-notify auth (cron secret)  
- webhook secret header  
- `review_action` RPC as human acceptance API  
- Filtering out non-human workers on assignment DM  

---

## Target e2e

```text
Human /task or UI
  → assign agent
  → outbox agent_dispatch
Duty lease
  → bot_notify task_started
Duty terminal review + summary
  → bot_notify task_review (+ ra buttons)
Human ra:approve
  → done → bot_notify task_done
Human ra:fix + reason
  → domain fix + events → requeue agent
```

---

## File touch list

| File | Action |
|------|--------|
| Domain / ops lease handler | **Add** bot_notify emit `task_started` |
| Domain / ops terminal handler | **Add** emit review/escalate/handoff |
| `bot-notify/index.ts` | **Patch** reason resolver; verify payloads |
| `lib/bot.ts` | Optional shared card; fix dead URL helper |
| `/api/bot/webhook` | No protocol change |

---

## Acceptance

- [ ] Agent terminal review produces Telegram review card with buttons  
- [ ] Card shows terminal summary when present  
- [ ] task_started fires on lease, not only on old move_task  
- [ ] Agent workers never get human assignment DM  
- [ ] Bot never calls `/api/agent/ops/*`  

---

*Human channel synergy 0.9 · companion to Canon + Ops API*
