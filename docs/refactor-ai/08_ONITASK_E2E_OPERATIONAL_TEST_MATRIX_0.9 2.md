# onitask · E2E Operational Test Matrix 0.9 FINAL

## Cases

| ID | Scenario | Expected |
|----|----------|----------|
| E01 | Empty lease | `{ job: null }` |
| E02 | Lease success | in_progress, execution open, task_started notify |
| E03 | Heartbeat | VT extended |
| E04 | Terminal review | review column, execution closed, task_review notify |
| E05 | Ack after terminal | acked; idempotent |
| E06 | Ack before terminal | 409 terminal_required |
| E07 | Terminal idempotent same outcome | 200 |
| E08 | Terminal different outcome | 409 claim_closed |
| E09 | Stale claim after reaper | 409 stale_claim |
| E10 | Version conflict | 409 version_conflict |
| E11 | Human ra:approve | done + task_done notify |
| E12 | Human ra:fix + reason | requeue path |
| E13 | Terminal escalate | needs_human + escalation fields + notify |
| E14 | Handoff to agent | outbox for B |
| E14b | Handoff to human | assign human, no agent outbox, assignment notify |
| E15 | Max attempts | escalate / no silent infinite requeue |
| E16 | Observer key lease | 403 |
| E17 | MCP parity E02–E05 | same state |
| E18 | Two sequential tasks | second lease only after first terminal |
| E19 | Human moves column while claim open | execution force-closed, active_claim_id null |
| E20 | agent_name body ≠ key | 403 |
| E21 | wait_for_tasks | omitted or hard error |
| E22 | Quota infra fail on lease | 503 fail-closed |

---

*E2E 0.9 FINAL*
