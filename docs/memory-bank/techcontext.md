---

### 5. `docs/memory-bank/techContext.md`

```markdown
# Onitask — Technology Context

**Version:** 1.0.0
**Date:** 2026-07-12
**Status:** Active

> Source: [Dev Setup](onitask_dev_setup.md)

---

## Technology Stack

| Layer | Technology | Note |
|---|---|---|
| Frontend | Next.js 15 · TypeScript · React 19 | App Router, Server Components |
| UI | Tailwind CSS · shadcn/ui | TWA-compatible components |
| Database | Supabase (PostgreSQL) | Single source of truth |
| Auth | Telegram initData + HMAC verification | Supabase Auth for profiles |
| ORM / DB client | Supabase JS client v2 | No Prisma (incompatible with Deno + pgvector) |
| AI · Hot Path | Groq · llama-3.3-70b-versatile + whisper-large-v3-turbo | F-04 Parse, F-06 summary |
| AI · Cold Path | NeuralDeep Hub · GPT-OSS-120B | F-03 Enrichment, AI Flow Summary |
| Embeddings | NeuralDeep Hub · bge-m3 | vector(1024) |
| Realtime | Supabase Realtime | Subscriptions on tasks, agent_events |
| Scheduled jobs | pg_cron (Supabase) | Memory Consolidation, GC jobs |
| Deploy | Vercel (TWA frontend + API Routes) | Only Hot Path < 2s |
| Edge Functions | Supabase Edge Functions (Deno) | Cold Path |
| Bot | Telegram Bot API | Notifications, commands, deep links |

---

## Project Structure
onitask/
├── app/ # Next.js App Router
├── components/ # React components
├── lib/ # Business logic, utilities
├── hooks/ # Custom React hooks
├── types/ # TypeScript types & interfaces
├── supabase/
│ ├── functions/ # Supabase Edge Functions (Deno)
│ └── migrations/ # SQL migrations (manual, not Prisma)
├── docs/
│ └── memory-bank/ # Cline Memory Bank
├── public/ # Static assets
├── .clinerules # Cline configuration
└── ...

text

---

## Key Directories

### app/ — App Router
app/
├── layout.tsx # Root layout
├── page.tsx # Entry: init + redirect
├── (twa)/
│ ├── onboarding/ # First login, workspace wizard
│ ├── workspace/[slug]/
│ │ ├── page.tsx # Flow Board (kanban)
│ │ ├── team/ # Team Tab
│ │ ├── stream/ # Personal stream
│ │ ├── settings/ # Workspace settings
│ │ └── members/ # Members, invites
│ └── invite/[slug]/ # Accept invite
└── api/
├── init/route.ts
├── tasks/
├── flow/metrics/route.ts
├── ai/
│ ├── transcribe/route.ts
│ ├── parse-task/route.ts
│ └── quota/route.ts
├── mcp/
│ ├── create_task/route.ts
│ ├── move_task/route.ts
│ ├── escalate_task/route.ts
│ ├── get_tasks_by_column/route.ts
│ ├── get_workspace_settings/route.ts
│ ├── send_message_to_chat/route.ts
│ ├── get_task_context/route.ts
│ ├── handoff_task/route.ts
│ └── undo/[event_id]/route.ts
├── workspaces/
├── invite/[slug]/accept/route.ts
└── bot/
├── webhook/route.ts
├── task/route.ts
├── flow/[workspaceId]/route.ts
└── notify/route.ts

text

### supabase/functions/ — Edge Functions
supabase/functions/
├── enrich-task/ # F-03: Card Enrichment
├── flow-metrics/ # /api/flow/metrics Cold Path
├── consolidate/ # LTM Memory Consolidation
├── queue-monitor/ # Monitor stuck pending in enrichment_queue
├── rebuild-workspace-context/ # Workspace Context Rebuild
└── _shared/
├── supabase.ts # createClient for Deno
├── neuraldeep.ts # NeuralDeep Hub client
└── groq.ts # Groq client

text

---

## Environment Variables

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_PROJECT_ID=

# Telegram
TELEGRAM_BOT_TOKEN=
TELEGRAM_BOT_SECRET=

# AI — Hot Path
GROQ_API_KEY=

# AI — Cold Path
NEURALDEEP_API_KEY=

# MCP
MCP_SIGNING_SECRET=
Development Commands
bash
# Install dependencies
npm install

# Start local Supabase (Docker)
npx supabase start

# Apply migrations
npx supabase db push

# Regenerate types
npx supabase gen types typescript --local > types/database.ts

# Run Next.js
npm run dev

# Run Edge Functions locally
npx supabase functions serve enrich-task --env-file .env.local

# Test MCP locally
curl -X POST http://localhost:3000/api/mcp/create_task \
  -H "Authorization: Bearer <test-api-key>" \
  -d '{"workspace_id":"...","agent_name":"test","title":"Test task"}'
AI Models
Contour	Model	Provider	Limit
Hot Path · F-04 Parse, F-06 summary	llama-3.3-70b-versatile	Groq	free tier
Hot Path · F-04 STT	whisper-large-v3-turbo	Groq	free tier
Cold Path · F-03 Enrichment, AI Flow Summary	GPT-OSS-120B	NeuralDeep Hub	60 RPM
Cold Path · Workspace Context Rebuild	GPT-OSS-120B	NeuralDeep Hub	60 RPM
Embeddings	bge-m3	NeuralDeep Hub	60 RPM
