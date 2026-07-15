# Onitask — Product Context

**Version:** 1.0.0
**Date:** 2026-07-12
**Status:** Active

> Source: [Product Vision](onitask_product_vision.md)

---

## Production Vision

> **onitask is the first AI-Native Control Plane for hybrid (mixed) teams where humans and autonomous AI agents coordinate as equal workers in a unified, adaptive, and overload-protected space.**

---

## Three Foundational Pillars

### 1. Worker Agnosticism (Equivalent Executors)
The flow board and sprint don't distinguish between human and AI agent. Architecture orchestrates them equally, collecting robot actions via MCP protocol alongside human actions.

### 2. Eliminating Context-Switch Hell
Most operational tasks are born in chat and die there, never reaching the tracker. Onitask intercepts tasks at their point of origin — in Telegram — via instant AI parsing of text or voice.

### 3. Methodological Flexibility (Adaptive Transformer)
The product doesn't force innovation. One toggle in `workspace_settings` transforms the board to match team culture:

- **Classic Mode**: Clean Linear analog inside Telegram without AI load
- **Scrum Mode**: Story Point planning, supplemented by MCP agents
- **AI-Native Mode**: Cognitive Budget Engine (F-01) — a "shield" for humans

---

## Jobs to Be Done (JTBD)

### Job 1: Developer (Job Executor)
> "When I get a task or think of something to do — I want to capture it and understand what to do right now, so I don't lose context or waste time clarifying."

**Functional Result:** Task captured and decomposed in < 60 seconds

### Job 2: Tech Lead (Job Beneficiary)
> "When my team starts using AI coders and agents — I want a single dashboard that automatically aggregates and distributes tasks between robots and people, so I can control sprint focus, spot anomalies, and prevent agents from burning out engineers."

**Functional Result:** Understand team state in < 2 minutes/day

### Job 3: AI Agent (System Interaction)
> "When I find a bug in the repo or generate subtasks — I want to instantly log them in the tracker via a standard protocol (MCP), understand current workspace priorities and cognitive load, so I can act autonomously and coordinate effectively with the team."

### Job 4: Change Management Manager (Latent Job)
> "When I move a team from Jira/Linear to a new tracker — I want to temporarily disable new cognitive metrics and keep only Story Points, so the team doesn't sabotage the transition and adopts AI features smoothly."

---

## Key Scenarios

### UC-01: Voice Task in Telegram Chat
1. User forwards voice to bot or writes `@onitask` + audio
2. Bot downloads voice → Whisper → transcription
3. F-04 Parse → title, description, assignee, deadline, target_workspace
4. Task created with `column = 'backlog'`, `is_inbox = true`

### UC-02: AI Agent Takes Task and Escalates
1. Cursor calls `get_tasks_by_column { column: 'backlog' }`
2. Takes task: `move_task { task_id, target_column: 'in_progress' }`
3. Works autonomously
4. Hits `conflicting_requirements` → calls `escalate_task`
5. `needs_human = true` → appears in Operator Queue
6. Operator reads reason, acts, removes flag
7. Agent continues

### UC-03: Drag-and-Drop in Kanban (Optimistic UI)
1. pointerdown → Haptic
2. Optimistic update — card moved visually
3. `PATCH /api/tasks/:id { column: new_column, version: current_version }`
4. Supabase Realtime → other clients update
5. On 409 conflict → refetch → show actual state

### UC-04: Tech Lead Sees Stalled Agent
1. Team Tab shows agent throughput < 0.5/day (red)
2. Interpretation hint: "Agent stopped. Unblock tasks — agent will resume flow."
3. Tech Lead opens expanded sheet → "Awaiting operator decisions"
4. Sees list of escalated tasks with reasons
5. Makes decisions, removes flags → agent resumes

---

## Brand Identity

### Name Meaning
**onitask** — two layers:
- **Surface**: "on it" — task is taken, someone is already on it
- **Deep**: oni (鬼) — Japanese guardian-protector, protecting the team from lost tasks and cognitive overload

### Colors

| Role | HEX | Application |
|---|---|---|
| Primary brand | #0F6E56 | Logo, icon, primary buttons |
| AI accent | #534AB7 | AI elements: enrichment hints, agent events |
| Warning | #EF9F27 | Risk Pulse signals, escalations |
| Danger | #E24B4A | Red light, critical actions |

### Brand Voice
| Principle | Correct | Incorrect |
|---|---|---|
| Short and direct | "Anton is overloaded. Move 2 tasks?" | "Dear user, the system has detected..." |
| Guardian, not bureaucrat | "Task captured. We're on it." | "Task successfully added to the system" |
| AI is transparent | "AI suggests 5 subtasks — here they are" | "System automatically optimized..." |
| Human first | "Agent escalated. Check the task." | "escalation_rate: 47%." |

---

## Links

- [Product Vision](onitask_product_vision.md)
- [Architecture Master](onitask_Architecture_Master_.md)