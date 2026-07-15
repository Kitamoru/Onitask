

# Memory Bank Overview

This file describes the **Memory Bank** used by Cline agents. It is a lightweight cache of
project‑specific context that is read at the start of **every** task (Plan Mode).

The Memory Bank is located in the `docs/memory-bank/` directory and contains the following
files, which are maintained and updated as the project evolves.

| Memory‑Bank file | Purpose | Source / Content |
|------------------|---------|------------------|
| `projectbrief.md` | High‑level project overview (what, why, core problem) | Derived from `onitask_product_vision.md` – one‑page summary |
| `productContext.md` | Product vision, JTBD, key scenarios, brand identity | Comprehensive extract from `onitask_product_vision.md` |
| `systemPatterns.md` | Core architectural patterns (axioms, invariants, data flow) | Structured summary of `onitask_Architecture_Master_.md` and `onitask_ai_.md` |
| `techContext.md` | Technology stack, project structure, environment setup | Extracted from `onitask_dev_setup.md` |
| `activeContext.md` | Current task, recent decisions, open questions, blockers | Updated during development – tracks the active session context |

---

## How to use the Memory Bank

1. **At the start of each Plan Mode session**, Cline reads all files in `docs/memory-bank/`
   to restore context.

2. **When working on a task**, update `activeContext.md` with the current focus and any
   new decisions.

3. **When a task is completed**, update `progress.md` to mark it done and record any
   notable outcomes.

4. **For detailed technical references**, always consult the primary documentation in
   `docs/`:
   - `onitask_Architecture_Master_.md` – definitive source for schema, invariants, axioms
   - `onitask_ai_.md`, `onitask_flow_.md`, `onitask_mcp_contract_.md`, etc. – feature‑specific
     contracts and implementation details
   - `onitask_INDEX_.md` – navigation guide to all documentation

---

## File location

All Memory Bank files are stored in:
docs/memory-bank/
├── projectbrief.md
├── productContext.md
├── systemPatterns.md
├── techContext.md
├── activeContext.md
