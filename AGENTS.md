# AGENTS.md Behavioral guidelines to reduce common LLM coding mistakes.

Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.
- Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

## 5. Tests That Prove Execution, Not Text

**A test that greps source code must require that the code RUNS, not that it is MENTIONED.**

This is not hypothetical. It happened three times in three consecutive phases
(2026-09-27), each time producing a green test with the feature switched off:

```ts
// working — test green
await backfillLegacyChecksum(supabase, documentId, fileData);

// commented out — test STILL green, feature dead
// await backfillLegacyChecksum(supabase, documentId, fileData);
```

The substring survived in the comment, so `toContain('backfillLegacyChecksum(')`
kept passing. The same shape produced a false negative when a 40-line regex
window picked up a neighbouring call's argument instead of the one under test.

**Ranked by whether they can detect a disabled feature:**

| Approach | Detects? | Example |
|---|---|---|
| Parse the AST (real calls, real arguments) | Yes | `tests/supabase/upsertConflictTarget.test.ts` |
| Invoke the real code path in the test | Yes | `tests/api/workspaces/documents/duplicateRejection.test.ts` |
| Enforce in the database | Yes | unique index, `assert_vector_index_health()` |
| Regex over the file text | **No** | `tests/supabase/docKbContracts.test.ts` |

**Rules:**

- When asserting that a call exists, anchor to the call site so a comment
  cannot satisfy it. `/^\s*await myFunc\(/m` matches a live call; a bare
  `/myFunc\(/` matches the comment too.
- Normalize line endings before matching (`\r\n` → `\n`), or the assertion
  passes on Linux and fails on Windows.
- Text assertions are still useful as a cheap detector for renames and constant
  changes. They are not evidence that behaviour is intact.
- When a text-based test cannot be upgraded, say so in the file header. A
  reader must not mistake a mention check for a behavioural guarantee.

**Corollary for production code:** the same error exists outside tests. A bare
`await supabase.from(x).insert(...)` with no `error` check reports success while
writing nothing. Check the result of every write, and never let a check that
exists only in memory decide the outcome.
