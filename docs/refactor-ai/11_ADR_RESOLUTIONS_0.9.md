# ADR · Resolutions for Architecture Pack 0.9

**Date:** 2026-08-29  
**Status:** Accepted  
**Applies to:** Canon v1.3 · Ops API 0.9 · MCP 0.9 · DDL · Bot emit

---

## R1. Playbook / Agent Guidance

**Decision:** Out of product and protocol scope for 0.9.

- Do not resolve `playbook_variant` / `agent_duty_playbook` in ops, MCP, or duty runtime.
- Residual DB columns may remain nullable and **inert**.
- UI: feature off; **explicitly revert any uncommitted playbook UI diff** (do not leave in working tree).
- Not deferred “optional guidance” — no platform recommendations on how agents think.

---

## R2. Agent identity: 1 key = 1 agent

**Decision:** Principal identity comes **only** from `mcp_agent_keys`.

- No multi-`agent_name` per key via body or `X-Agent-Name`.
- `X-Agent-Name`: ignore or reject if present and ≠ key identity (prefer **reject 403** if sent and mismatches; safe to ignore if equal).
- Request `agent_name` optional; if provided must match key’s agent identity → else `403 agent_not_allowed`.
- `webhook_url` / `webhook_secret` stored on **`mcp_agent_keys`** row.
- Worker resolution binds to key identity, not arbitrary body name.

**Rationale:** Removes dual SoT on “who is calling”; simplifies notify routing and audit.

---

## R3. `agent_duty_state` / `wait_for_tasks`

**Decision:** Hard cut. No live production clients (testers only).

- Migration: **`DROP`** `agent_duty_state` (and writers/readers).
- `wait_for_tasks`: remove from tools/list or return explicit error directing to `ops_lease`.
- No dual long-poll + lease state machine.

---

## R4. URL paths

**Canonical:**

```text
POST /api/agent/ops/lease
POST /api/agent/ops/executions/{execution_id}/heartbeat
POST /api/agent/ops/executions/{execution_id}/terminal
POST /api/agent/ops/executions/{execution_id}/ack
POST /api/agent/ops/executions/{execution_id}/nack
```

Legacy `/api/agent/jobs/*` drafts are obsolete.

---

## R5. Wake webhook payload

**Decision:** Wake only — does not grant work.

```json
{
  "event_id": "…",
  "type": "work.available",
  "workspace_id": "…",
  "agent_name": "…"
}
```

No required `task_id`. Runtime must `ops_lease`. Optional `task_id` hint only — never skip lease.

---

## R6. Terminal escalate

**Decision:** Preserve product fields used by Operator Queue / Risk Pulse:

- `needs_human`, `escalation_reason` (and related events) set on `outcome=escalate`.
- Plus close execution + clear `active_claim_id`.

---

## R7. Handoff to human vs agent

| next_owner | Path |
|------------|------|
| Agent B | domain transition + `dispatch_outbox` (`agent_name` NOT NULL) |
| Human | domain assign to human worker; **no** agent outbox; `bot_notify` `task_assignment` |

---

## R8. Human moves task while claim open

**Decision:** Force-close execution via **DB trigger** (preferred over route-only checks).

On human (non-ops) update that changes work column/status while `active_claim_id IS NOT NULL`:

- close execution (`human_override` / equivalent)
- `active_claim_id = NULL`
- `version++`

Ops lease/terminal paths must not be classified as human_override.

---

## R9. Quota / infra errors

| Surface | Policy |
|---------|--------|
| Agent **ops** (lease, heartbeat, terminal, ack, nack) | **fail-closed** (503/429) |
| Legacy domain mutations (e.g. `create_task`) | keep current prod **fail-open** until later policy pass |

Explicit split — not a silent global change.

---

## R10. Execution visibility (JTBD)

**Decision:** Sufficient for 0.9 via existing notify:

- `task_started` on lease
- `task_review` on terminal review

TWA execution panel = optional later, not open risk.

---

## R11. Global throttle (platform RPM)

Out of 0.9 scope. Track separately. One line in Canon: future work.

---

## R12. Reaper defaults

100 rows / 30–60s = **starting** defaults, not capacity proof for 500 workspaces. Tune with metrics.

---

*Accepted 2026-08-29*
