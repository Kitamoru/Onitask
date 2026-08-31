# Domain tools 0.8 → 0.9 MERGE FINAL

**Copy unchanged field schemas from** `onitask_mcp_contract_v0.8.0.md` **for:**

get_workspace_settings, get_tasks_by_column, get_task_context, create_task,
send_message_to_chat, undo (if any).

## Semantic changes

| Tool | 0.9 rule |
|------|----------|
| move_task | Human/compat. With open active_claim from another path, human moves force-close via trigger; agents must use ops_terminal for completion |
| handoff_task / escalate_task | Prefer ops_terminal when execution open |
| wait_for_tasks | **Remove** or hard error → ops_lease |
| Playbook | **None** |

## Identity

Agent name from **key only** (TECH_SOLUTION keys + ADR R2). Update any docs that allowed X-Agent-Name multi-identity.

## New

ops_lease, ops_heartbeat, ops_terminal, ops_ack, ops_nack — see MCP Contract 0.9.

---

*Merge FINAL*
