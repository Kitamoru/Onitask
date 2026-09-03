# Spec · Realtime auth via existing agent API key

**Version:** 0.9  
**Principle:** One identity system — `mcp_agent_keys`. Short JWT is only a Realtime ticket.

---

## Why not raw key on WebSocket

Supabase Realtime expects a **JWT** on connect.  
Ops/MCP continue to use `Authorization: Bearer <agent_key>`.

## Flow

```text
CLI stores ONITASK_API_KEY (long-lived)

POST /api/agent/realtime-token
  Authorization: Bearer <agent_key>

→ 200 {
  "access_token": "<jwt>",
  "expires_in": 900,
  "agent_key_id": "…",
  "workspace_id": "…"
}

CLI → Supabase Realtime.connect(access_token)
     subscribe private:agent:{agent_key_id}

Before expiry → refresh same endpoint
```

## JWT claims (illustrative)

```text
role: authenticated | suitable Supabase role
sub / agent_key_id
workspace_id
exp (5–30 min)
iss: onitask
```

Realtime Authorization: allow channel `agent:{agent_key_id}` only if claim matches.

## Rules

- Invalid/revoked key → 401  
- Observer-only keys may still get token if they may wake (product choice; default: same as ops access)  
- JWT **cannot** call ops without key; ops always Bearer key  
- Do not issue 30–90 day Realtime JWT  

## Acceptance

- [ ] Valid key → token → subscribe own channel only  
- [ ] Other agent channel → deny  
- [ ] Expired JWT → refresh with key works  
- [ ] Ops lease still works with key alone (no JWT required)  

---

*Realtime auth 0.9*
