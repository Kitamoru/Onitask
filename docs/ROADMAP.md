# Project Roadmap (generated)

The roadmap is derived from the **Architecture Master**, **Product Vision**, and
the **AI Contract**.  It is split into six phases with clear milestones and
links to the source sections.

---

## Phase 0 – Foundations (P0)  
**Goal:** Provide a stable, secure base that satisfies all invariants.
| Milestone | Description | Source |
|-----------|-------------|--------|
| ✅ DB schema & migrations | Apply `001_init.sql` & `002_rls.sql`; enforce all `INV‑*` constraints. | `Architecture §1` |
| ✅ Auth & init endpoint | `/api/init` with timing‑safe secret checks. | `Architecture §7` |
| ✅ Worker model | `workers` table, RLS policies, `workspace_settings`. | `Architecture §4‑5` |
| ✅ CI/CD pipeline | Vercel preview + Supabase Edge deployment. | `dev_setup.md §2` |
| ✅ RLS policies enforcement | Apply `002_rls.sql` to enforce per‑workspace RLS as defined in Architecture §7 | `Architecture §7` |

## Phase 1 – Core Platform (P0)  
**Goal:** Implement the core task flow and basic AI‑native features.
| Milestone | Description | Source |
|-----------|-------------|--------|
| ✅ Task CRUD API | `/api/tasks*` routes with validation against invariants. | `Architecture §6` |
| ✅ Flow Board UI | Kanban board in TWA, respects `workspace_settings`. | `Product Vision §3` |
| ✅ AI Quota & Budget | Atomic quota updates (**A‑3**) and cognitive budget calculation (**A‑9**). | `Architecture §3‑9` |
| ✅ Basic Enrichment | `enrich-task` Edge Function (async tier). | `AI Contract §1` |
| ✅ Implement all invariants (INV‑01 … INV‑16) | Ensure DB schema, triggers, RLS and middleware respect every invariant. | `Architecture §1` |

## Phase 2 – AI‑Native Enhancements (P1)  
**Goal:** Add AI‑driven automation while keeping safety.
| Milestone | Description | Source |
|-----------|-------------|--------|
| ✅ Instant Parse | `/api/ai/transcribe` – voice → text (<300 ms). | `AI Contract §2` |
| ✅ Task Decomposition | `/api/tasks/[id]/decompose` – generate sub‑tasks. | `Architecture §12` |
| ✅ Risk Scoring UI | Show `attention_risk_score` on cards. | `Security §5` |
| ✅ Data‑Sharing Levels | Implement `minimal/standard/full` controls. | `Product Vision §8` |

## Phase 3 – Scaling & Observability (P1)  
**Goal:** Prepare for large teams and high load.
| Milestone | Description | Source |
|-----------|-------------|--------|
| ✅ HNSW vector index switch | Move from IVF‑Flat to HNSW when >5 k vectors. | `Architecture §4‑5` |
| ✅ Metrics cache layers | Implement `Layered Metrics Cache` (**A‑10**). | `Architecture §10` |
| ✅ MCP contract v2 | Add new RPCs for bulk task moves. | `MCP Contract md` |
| ✅ Load testing & autoscaling | Vercel & Supabase autoscale configs. | `dev_setup.md §4` |

## Phase 4 – Enterprise Hardened (P2)  
**Goal:** Meet compliance and advanced security.
| Milestone | Description | Source |
|-----------|-------------|--------|
| ✅ DPA for `full` data sharing | Legal agreement & audit logs. | `Product Vision §8` |
| ✅ End‑to‑end encryption for AI payloads | Encrypt `workspace_context` before sending to LLM. | `Security §2` |
| ✅ Role‑based access control expansion | Granular permissions for bot actions. | `Architecture §8` |
| ✅ Auditable migration plan | Versioned DB schema with rollback scripts. | `dev_setup.md §5` |

---

*Generated on $(date)*
