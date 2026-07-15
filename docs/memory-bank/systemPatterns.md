# Onitask — System Patterns

**Version:** 1.0.0
**Date:** 2026-07-12
**Status:** Active

> Source: [Architecture Master](onitask_Architecture_Master_.md), [AI Contract](onitask_ai_.md)

---

## Three-Speed Architecture

| Contour | Latency | Model / Stack | Task / Client |
|---|---|---|---|
| 🟡 Instant | < 300ms | Groq · llama-3.3-70b-versatile | TWA, Bot commands |
| 🔵 Async | 3-10s (background) | NeuralDeep Hub · GPT-OSS-120B | F-03 Enrichment, Workspace Context |
| 🟣 Agent | anytime | MCP Server / REST | External agents (Cursor, Claude Code) |

---

## Architectural Axioms (A-01..A-12)

### A-01: Vercel = Only Hot Path
API routes on Vercel handle only requests < 2 seconds. All RAG operations and LLM calls go to Supabase Edge Functions.

### A-02: Timing Safe & DB Isolation
API keys and HMAC signatures compared via `timingSafeEqual`. Direct Moraleon schema reads are forbidden.

### A-03: Atomic Quota
AI quota tracking via `INSERT ... ON CONFLICT DO UPDATE`. Eliminates race conditions.

### A-04: Vector Indexing
pgvector v0.5+ in Supabase. IVFFlat for MVP, switch to HNSW at > 5k records.

### A-05: Hybrid Two-Contour Estimation
`story_points` (macro, sprints) and `cognitive_weight` (micro, Cognitive Budget) are independent and configurable via `workspace_settings`.

### A-06: One Model Call (No Fallback Chain)
No fallback chain. Cold Path uses NeuralDeep Hub · GPT-OSS-120B (one call).

### A-07: Tenant Isolation
All AI-outputs bound to `workspace_id`. Check via centralized Middleware.

### A-08: Flow Access Control
Flow Board accessible to all Members. AI functions — only Admin/Owner.

### A-09: Cognitive Budget Formula
Cognitive Budget = SUM(cognitive_weight) for tasks in `in_progress` (assigned_to) + `review` (reviewer_id).

### A-10: Layered Metrics Cache
Flow Board metrics cached: Column Health — 5s, Worker Load — 60s, AI Alerts — 60s.

### A-11: Assignment Risk Score
Deterministic metric (0-100). Amber ≥ 60, Red ≥ 80. Snapshot in `assignment_history`.

### A-12: Relational Context Layer
`task_relations` — structural layer above semantic search. Three relation types with immutable weights:
- `blocks` → 1.0
- `spawned_from` → 0.8
- `mentions` → 0.3

---

## Invariants (INV-01..INV-16)

See [Architecture Master §1](onitask_Architecture_Master_.md#1-инварианты) for complete list.

**Key invariants for development:**
- INV-13: `task_relations.workspace_id` must be passed explicitly on every INSERT
- INV-14: `workspace_context` (manual) and `workspace_context_cache` (system) strictly separated
- INV-15: `data_sharing_level = 'full'` requires Admin/Owner consent + DPA
- INV-16: `/api/init` — find-or-create only (no auto-update of display_name/avatar_url)

---

## Worker Model

### Principle
Flow is a dispatch center for mixed teams. **Worker = any executor.** Flow doesn't know the difference between human and agent. All references go through `workers(id)`.

### Table Structure

```sql
CREATE TABLE workers (
  id           uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  type         text CHECK (type IN ('human', 'agent')),
  role         text CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  display_name text NOT NULL,
  source_id    text NOT NULL, -- profiles.id for human, 'agent::name' for agent
  is_active    boolean DEFAULT true,
  created_at   timestamptz DEFAULT NOW()
);
Icons and Attributes
Attribute	Human	AI Agent
Icon	Avatar (initials)	Diamond (◆)
source_id	profiles.id	'agent::name'
Load	cognitive_weight of tasks	Same
Activity	Manual actions in TWA	agent_events
Data Flow Patterns
Task Creation Flow
text
User Input (TWA/Bot)
  → F-04 Instant Parse (Groq)
  → Determine enrichment_strategy (skip/light/standard)
  → INSERT tasks (cognitive_weight = 0/1)
  → IF standard/light: INSERT enrichment_queue
  → F-03 Enrichment (NeuralDeep) updates cognitive_weight, story_points, ai_hint
MCP Agent Flow
text
Agent → MCP Route → Middleware (timingSafeEqual + tenant + allowed_tools)
  → Atomic quota RPC
  → Save state_before (Memento)
  → Execute tool → Postgres
  → INSERT agent_events (summary, state_before, metadata)
  → Supabase Realtime → clients
AI Enrichment Flow
text
Task created (standard/light)
  → INSERT enrichment_queue (type='card')
  → Edge Function picks job (FOR UPDATE SKIP LOCKED)
  → Read workspace_settings (workspace_context, data_sharing_level)
  → RAG Pipeline:
     1. get_task_subgraph (structural context)
     2. Semantic search (tasks, docs, LTM)
     3. Implicit calibration (assignment_history)
  → Call NeuralDeep GPT-OSS-120B (JSON mode)
  → Validate output (Zod schema)
  → UPDATE tasks (cognitive_weight) and task_enrichments (all fields)
  → Realtime broadcast
Security Patterns
MCP API Key Scopes
json
{
  "sha256_hash_of_key": {
    "allowed_tools": ["get_tasks_by_column", "move_task", "escalate_task"],
    "can_send_messages": false,
    "max_tasks_per_minute": 50
  }
}
Data Sharing Levels
Level	What's sent	DPA required
minimal	task content, workspace_context, subgraph, worker names (functional)	No
standard	minimal + cache, related tasks, assignment_history (pseudonymized), doc chunks	No
full	standard + doc RAG without threshold	Yes (IP)
Links
Architecture Master

Security Architecture

AI Contract