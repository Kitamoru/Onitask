# onitask — AI-Native Control Plane for Hybrid Teams

> **onitask is the first AI-Native Control Plane for hybrid teams (people + AI agents) — a single dashboard where both work as equal workers.**

[![Next.js](https://img.shields.io/badge/Next.js-15-black?style=flat-square&logo=next.js)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?style=flat-square&logo=typescript)](https://typescriptlang.org)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-green?style=flat-square&logo=supabase)](https://supabase.com)
[![Telegram](https://img.shields.io/badge/Telegram-Bot-2AABEE?style=flat-square&logo=telegram)](https://t.me/onitask_bot)
[![MCP](https://img.shields.io/badge/MCP-Agent%20Ready-534AB7?style=flat-square)](#-mcp-agent-integration)
[![License](https://img.shields.io/badge/License-MIT-lightgrey?style=flat-square)](LICENSE)

---

## 🎯 One-Liner

onitask coordinates humans and autonomous AI agents as **equal workers** in a unified, adaptive, and overload-protected workspace.

## ✨ Key Features

| Feature | Description |
|---|---|
| **🤖 Worker Agnosticism** | Humans and AI agents are treated equally. Flow Board orchestrates them identically via MCP protocol. |
| **🎙️ Instant Parse (F-04)** | Create tasks from Telegram voice or text in < 2 seconds. Groq Whisper + Llama parse intent automatically. |
| **🧠 Cognitive Budget (F-01)** | "Shield" against agent overload. Real-time cognitive load meter per worker (0–3 scale). |
| **📊 Risk Pulse** | Three aggregated signals: Overloaded / Review Block / Escalations. See team state in 5 seconds. |
| **🔀 Smart Escalation** | Agents ask for human help when stuck. `escalate_task` MCP tool guarantees no silent failures. |
| **📅 Calendar Integration** | Yandex CalDAV & Outlook sync via OAuth. Reminders delivered through Telegram bot. |
| **🔄 Relational Context Layer (A-12)** | Structural dependency graph (`task_relations`) over semantic RAG. Blockers, handoffs, cascade unblock. |
| **📄 Document RAG** | Upload project docs → embeddings → contextual enrichment for AI decisions. |
| **🏃 Three-Speed Architecture** | Instant (< 300ms), Async (3–10s), Agent (out-of-band). Each task routed to optimal circuit. |
| **🛡️ Security Layer** | OWASP LLM Top 10 protection: JSON mode, UUID data isolation, LTM injection linter, timing-safe secrets. |

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     onitask Architecture                    │
│                                                             │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐    │
│  │  TWA Frontend │   │ Telegram Bot │   │  MCP Agents  │    │
│  │  (Next.js 15) │   │  (Bot API)   │   │ (Cursor etc.)│    │
│  └──────┬───────┘   └──────┬───────┘   └──────┬───────┘    │
│         │                   │                   │            │
│         ▼                   ▼                   ▼            │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              Next.js API Routes (Vercel)             │    │
│  │  Hot Path (< 2s): F-04 Parse, Task CRUD, Auth       │    │
│  └──────────────────────┬──────────────────────────────┘    │
│                         │                                    │
│              ┌──────────▼──────────┐                         │
│              │   Supabase PostgreSQL│                         │
│              │   • RLS policies     │                         │
│              │   • Realtime subs    │                         │
│              │   • pgvector         │                         │
│              │   • pg_cron jobs     │                         │
│              └─────────────────────┘                         │
│                         ▲                                    │
│              ┌──────────▼──────────┐                         │
│              │  Edge Functions      │                         │
│              │  (Deno runtime)      │                         │
│              │  Cold Path: F-03     │                         │
│              │  Enrichment, LTM,    │                         │
│              │  Flow Metrics        │                         │
│              └─────────────────────┘                         │
└─────────────────────────────────────────────────────────────┘
```

### Three-Speed Circuits

| Circuit | Latency | Use Case | Provider |
|---|---|---|---|
| **Instant** | < 300ms | Task CRUD, DnD, Risk Pulse, Urgency Badge | Supabase Direct |
| **Async** | 3–10s | Card Enrichment (F-03), Flow Summary, LTM | NeuralDeep GPT-OSS-120B |
| **Agent** | Out-of-band | MCP tools, Cursor/Claude Code workflows | Model Context Protocol |

### Core Invariants

| ID | Invariant |
|---|---|
| INV-01 | `tasks.assigned_to` → REFERENCES `workers(id)` |
| INV-05 | All AI outputs contain `workspace_id` (tenant isolation) |
| INV-06 | All secrets compared via `timingSafeEqual` |
| INV-07 | AI quota incremented via atomic RPC (not SELECT+UPDATE) |
| INV-09 | Task version incremented atomically with WHERE clause |
| INV-13 | `task_relations.workspace_id` passed explicitly on every INSERT |
| INV-15 | `data_sharing_level='full'` requires DPA with NeuralDeep Hub |
| INV-16 | `/api/init` is find-or-create only (no auto-update of display_name) |

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | Next.js 15 · TypeScript · React 19 · App Router |
| **UI** | Tailwind CSS · shadcn/ui · Telegram WebApp SDK |
| **Database** | Supabase (PostgreSQL) · pgvector · pg_cron |
| **Auth** | Telegram initData + HMAC verification |
| **Realtime** | Supabase Realtime subscriptions |
| **AI · Hot Path** | Groq · llama-3.3-70b-versatile + whisper-large-v3-turbo |
| **AI · Cold Path** | NeuralDeep Hub · GPT-OSS-120B |
| **Embeddings** | bge-m3 (vector(1024)) |
| **Deploy** | Vercel (TWA + API Routes) + Supabase Edge Functions |
| **Bot** | Telegram Bot API |

## 🚀 Quick Start

### Prerequisites

- Node.js 20+
- Supabase account (or local Docker setup)
- Telegram bot token (for bot features)

### Installation

```bash
# Clone repository
git clone https://github.com/Kitamoru/Onitask.git
cd Onitask

# Install dependencies
npm install

# Copy environment variables
cp .env.example .env.local
# Edit .env.local with your credentials (see below)

# Start local Supabase
npx supabase start

# Apply database migrations
npx supabase db push

# Generate TypeScript types from schema
npx supabase gen types typescript --local > types/database.ts

# Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the app.

## 🔑 Environment Variables

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Telegram
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_BOT_SECRET=webhook_hmac_secret

# AI — Hot Path
GROQ_API_KEY=your_groq_key

# AI — Cold Path
NEURALDEEP_API_KEY=your_neuraldeep_key

# MCP Agent Authentication
MCP_SIGNING_SECRET=hmac_signing_secret_for_agents
```

> All secrets are compared via `timingSafeEqual` (axiom A-2). `===` is only safe for non-secret strings.

## 🤖 MCP Agent Integration

Connect AI agents (Cursor, Claude Code, custom scripts) to onitask:

### 1. Generate API Key

In TWA: Settings → MCP Keys → Generate new key. Store the raw key securely.

### 2. Available Tools

| Tool | Description | Endpoint |
|---|---|---|
| `create_task` | Create a task | `POST /api/mcp/create_task` |
| `move_task` | Move task between columns | `POST /api/mcp/move_task` |
| `escalate_task` | Escalate to human | `POST /api/mcp/escalate_task` |
| `handoff_task` | Hand off to another worker | `POST /api/mcp/handoff_task` |
| `get_tasks_by_column` | List tasks in column | `POST /api/mcp/get_tasks_by_column` |
| `get_workspace_settings` | Read workspace config | `POST /api/mcp/get_workspace_settings` |
| `get_task_context` | Full task context + subgraph | `POST /api/mcp/get_task_context` |
| `send_message_to_chat` | Send message to Telegram | `POST /api/mcp/send_message_to_chat` |
| `undo/:event_id` | Undo last action | `POST /api/mcp/undo/:event_id` |

### 3. Authentication

```bash
curl -X POST http://localhost:3000/api/mcp/create_task \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"workspace_id":"...","title":"Fix auth bug"}'
```

### 4. Security Features

- **Allowed Tools**: Per-key tool scoping (e.g., read-only vs full access)
- **Rate Limiting**: 50 requests/min per key (aligned with NeuralDeep 60 RPM)
- **Tenant Isolation**: Keys bound to specific workspaces
- **DFS Cycle Detection**: Prevents circular `blocked_by` dependencies
- **State Memento**: Every action logged with `state_before` for undo

## 📁 Project Structure

```
onitask/
├── app/                    # Next.js App Router
│   ├── api/                # Route Handlers (REST API)
│   │   ├── ai/             # F-04 STT, Parse, Quota
│   │   ├── mcp/            # MCP Agent endpoints
│   │   ├── tasks/          # Task CRUD
│   │   ├── flow/           # Flow metrics
│   │   ├── workspaces/     # Workspace management
│   │   └── bot/            # Telegram Bot webhook
│   └── flowboard/          # Flow Board page
├── components/             # React components
│   ├── flowboard/          # Kanban, Task cards, Stream
│   ├── ai/                 # Voice recorder, AiInput, Correction
│   ├── calendar/           # Calendar views
│   ├── sprint/             # Sprint UI
│   └── shared/             # Auth loader, Telegram provider
├── lib/                    # Business logic
│   ├── ai/                 # Groq client, prompts, types
│   ├── supabase/           # DB client
│   ├── telegram/           # Telegram validation
│   └── realtime/           # Realtime subscriptions
├── supabase/
│   ├── functions/          # Edge Functions (Deno)
│   │   ├── enrich-task/    # F-03 Card Enrichment
│   │   ├── bot-notify/     # Bot Notify Worker
│   │   └── doc-process/    # Document RAG processing
│   └── migrations/         # SQL migrations (001–041+)
├── docs/                   # Documentation
│   ├── onitask_Architecture_Master_.md  # Schema, invariants, axioms
│   ├── onitask_ai_.md      # AI modules (F-01, F-03, F-04, F-06)
│   ├── onitask_flow_.md    # Flow Board UX
│   ├── onitask_mcp_contract_.md  # MCP tools specification
│   ├── onitask_bot.md      # Telegram bot specification
│   ├── onitask_calendar_.md    # Calendar module spec
│   ├── onitask_security_.md    # Security layer (OWASP LLM)
│   ├── onitask_sql_anomalies_.md # SQL anomaly views
│   ├── onitask_product_vision.md   # Product vision & JTBD
│   ├── onitask_dev_setup.md    # Dev setup reference
│   ├── onitask_INDEX_.md     # Documentation index
│   ├── TASKS.md            # Task decomposition (136 tasks)
│   └── design/             # Figma design data
└── types/                  # Generated + manual TypeScript types
```

## 📚 Documentation

| Document | Purpose |
|---|---|
| [Architecture Master](docs/onitask_Architecture_Master_.md) | Schema, invariants (INV-01…INV-17), axioms (A-01…A-12) |
| [AI Contract](docs/onitask_ai_.md) | F-01 Cognitive Budget, F-03 Enrichment, F-04 Instant Parse, F-06 MCP Router |
| [Flow Board](docs/onitask_flow_.md) | Kanban UX, Risk Pulse, Worker Sheet, Operator Queue |
| [MCP Contract](docs/onitask_mcp_contract_.md) | Tool signatures, error matrix, agent recommendations |
| [Security Layer](docs/onitask_security_.md) | OWASP LLM Top 10, prompt injection, data isolation |
| [Product Vision](docs/onitask_product_vision.md) | JTBD analysis, ODI metrics, brand identity |
| [Dev Setup](docs/onitask_dev_setup.md) | Tech stack, build sequence, API contracts |
| [INDEX](docs/onitask_INDEX_.md) | Navigation guide for all documentation |

## 🎨 Design System

**Figma:** [figma.com/file/EhjoAgxmDSPu7jsuUEXl46](https://www.figma.com/design/EhjoAgxmDSPu7jsuUEXl46/-dev--ONITASK)

### Brand Colors

| Role | HEX | Usage |
|---|---|---|
| Primary brand | `#0F6E56` | Logo, primary buttons, accents |
| Brand mid | `#1D9E75` | "oni" in wordmark, green status |
| Brand light | `#E1F5EE` | Card backgrounds, hover states |
| Dark brand | `#085041` | "task" in wordmark, dark text |
| AI accent | `#534AB7` | All AI elements (purple) |
| Warning | `#EF9F27` | Yellow traffic light, Risk Pulse |
| Danger | `#E24B4A` | Red traffic light, critical actions |

### Brand Voice

| Principle | Correct | Incorrect |
|---|---|---|
| Short & direct | "Антон перегружен. Перенести 2 задачи?" | "Уважаемый пользователь, система обнаружила..." |
| Guardian, not bureaucrat | "Задача захвачена. Мы на ней." | "Задача успешно добавлена в систему" |
| AI is transparent | "AI предлагает 5 подзадач — вот они" | "Система автоматически оптимизировала..." |
| Human first | "Агент эскалировал. Проверь задачу." | "escalation_rate: 47%. Threshold exceeded." |

## 📝 License

MIT