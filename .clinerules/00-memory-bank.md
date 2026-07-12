# Memory Bank Overview

This file describes the **Memory Bank** used by Cline agents. It is a lightweight cache of
project‑specific context that is read at the start of **every** task (Plan Mode).

The original specification listed a set of files that do not exist in the repository.
Instead, the relevant information is stored in the `docs/` directory.  Below is a mapping
from the expected memory‑bank files to the actual documentation files that contain the
corresponding content.

| Expected Memory‑Bank file | Actual source file (in `docs/`) |
|---------------------------|---------------------------------|
| `projectbrief.md`         | `docs/onitask_product_vision.md` – high‑level goals and scope |
| `productContext.md`       | `docs/onitask_product_vision.md` – why the product exists, key JTBD |
| `systemPatterns.md`       | `docs/onitask_Architecture_Master_.md` – core architectural patterns and critical implementation paths |
| `techContext.md`          | `docs/onitask_dev_setup.md` – tech stack, dependencies, environment constraints |
 | `activeContext.md`        | `docs/TASKS.md` – current focus, recent changes, retry count |
| `progress.md`             | `docs/TASKS.md` – list of tasks with status |
| `decisions.md`            | `docs/onitask_mcp_contract_.md` – ADR drafts and decisions made during the session |

Agents should **read the listed documentation files** in `docs/` before proceeding with any task.
