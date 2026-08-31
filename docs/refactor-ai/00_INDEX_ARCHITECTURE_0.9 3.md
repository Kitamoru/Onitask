# onitask · Document index 0.9 FINAL

**Date:** 2026-08-29  
**Status:** Accepted for implementation  

## Pack

| # | File |
|---|------|
| 0 | `00_INDEX_ARCHITECTURE_0.9.md` |
| 1 | `11_ADR_RESOLUTIONS_0.9.md` |
| 2 | `onitask_ARCHITECTURE_CANON_v1.3.md` |
| 3 | `01_ONITASK_OPS_API_0.9.md` |
| 4 | `06_ONITASK_OPS_API_0.9.openapi.yaml` |
| 5 | `05_ONITASK_DDL_EXECUTIONS_OUTBOX_0.9.sql` |
| 6 | `09_ONITASK_REAPER_RETRY_POLICY_0.9.md` |
| 7 | `02_ONITASK_MCP_CONTRACT_0.9.md` |
| 8 | `10_MCP_DOMAIN_TOOLS_0.8_to_0.9_MERGE.md` |
| 9 | `03_ONITASK_DUTY_RUNTIME_0.9.md` |
| 10 | `04_BOT_HUMAN_CHANNEL_SYNERGY_0.9.md` |
| 11 | `07_BOT_NOTIFY_EMIT_SPEC_0.9.md` |
| 12 | `08_ONITASK_E2E_OPERATIONAL_TEST_MATRIX_0.9.md` |

## Companion

- `onitask_mcp_contract_v0.8.0.md` — domain field schemas  
- `onitask_TECH_SOLUTION_mcp_agent_keys_FINAL.md` — keys DDL (identity tightened by ADR R2)

## Implement order

```text
ADR checklist → DDL+DROP duty_state+trigger → keys 1:1 + webhook cols
→ Ops API → Reaper → bot_notify emits → MCP → duty CLI → E2E
→ Revert uncommitted playbook UI (explicit task)
```

## Closed forks

Playbook inert · 1 key = 1 agent · DROP agent_duty_state · paths /ops/* ·  
wake webhook · escalate fields · handoff human · human_override trigger ·  
ops fail-closed quota · visibility via notify  

---

*FINAL*
