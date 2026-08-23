# Onitask Agent API — Implementation Kit (v0.8.0)

Companion to:

- `../onitask_mcp_contract_v0.8.0.md`
- `../onitask_TECH_SOLUTION_mcp_agent_keys_FINAL.md`

## Layout

```text
implementation/
├── README.md
├── openapi/
│   └── agent-domain.yaml          # REST OpenAPI 3.1 (all 9 tools)
└── src/
    ├── shared/
    │   ├── errors.ts              # DomainError + factories (§6)
    │   └── mcpAuth.ts             # resolveAgentKey, assertAgentRequest
    ├── domain/
    │   └── agent/
    │       ├── createTask.ts      # full flow: rate limit, DFS, insert
    │       └── moveTask.ts        # version required, claim, cascade hook
    └── adapters/
        ├── mcp/
        │   └── route.ts           # → app/mcp/route.ts
        └── rest/
            └── createTaskRoute.ts # → app/api/agent/create_task/route.ts
```

## Wire into Next.js

| Kit file | App path |
|----------|----------|
| `adapters/mcp/route.ts` | `app/mcp/route.ts` |
| `adapters/rest/createTaskRoute.ts` | `app/api/agent/create_task/route.ts` |
| `shared/*` | `lib/shared/*` |
| `domain/agent/*` | `lib/domain/agent/*` |

Replace `declare function getSupabase()` with your real client.

## What is fully coded

| Component | Status |
|-----------|--------|
| DomainError + error factories | ✅ |
| resolveAgentKey / assertAgentRequest / normalizeAllowedTools | ✅ |
| createTask domain (rate limit, cycle, insert) | ✅ |
| moveTask domain (version, claim, history) | ✅ |
| MCP route discover / list / call | ✅ (create + move wired) |
| REST create_task route | ✅ |
| OpenAPI all 9 paths | ✅ |

## Still to implement (same pattern)

```text
lib/domain/agent/
  getTasksByColumn.ts
  getWorkspaceSettings.ts
  getTaskContext.ts
  handoffTask.ts
  escalateTask.ts
  sendMessageToChat.ts
  undo.ts
```

Then register each in `adapters/mcp/route.ts` → `dispatchTool` and add `app/api/agent/<tool>/route.ts`.

## Auth rules (do not diverge)

1. Bearer raw key → sha256 → `mcp_agent_keys` (`revoked_at IS NULL`)
2. `workspace_id` from key only
3. `agent_name` required every call
4. `move_task.version` required
5. Rate limit = count `agent_events` 60s (no Redis)

## Parity

Same arguments via REST `POST /api/agent/create_task` and MCP `tools/call` name=`create_task` must produce identical `tasks` + `agent_events` rows.
