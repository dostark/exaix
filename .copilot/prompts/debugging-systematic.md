---
agent: claude
scope: dev
title: "Systematic Debugging Prompt"
short_summary: "Example prompt for systematic debugging using agents/ guidance."
version: "0.1"
topics: ["debugging", "troubleshooting", "prompts", "examples"]
---

## Prompt Template

```markdown
I have a bug: [description of issue]

Use systematic debugging approach:

1. CONTEXT INJECTION:
   deno run --allow-read scripts/inject_agent_context.ts claude "debugging [component] [error-type]" 6

1.
   - Write failing test that reproduces the bug
   - Run test to confirm failure
   - Show exact error message

1. <thinking>
   - What's the expected behavior?
   - What's the actual behavior?
   - Where's the gap?
   - What files are involved?
     </thinking>

1.
   - Implement minimal fix
   - Verify test passes
   - Check no regressions

1.
   - Add regression test
   - Update Implementation Plan if needed
   - Note in CHANGELOG if significant

Error type: [TypeScript error / runtime error / test failure / logic bug]
Component: [specific file or module]
```

## Example Usage (Test Failure)

**User:**

```markdown
I have a bug: tests/config_test.ts is failing with "Database connection not cleaned up"

Use systematic debugging approach:

1. CONTEXT INJECTION:
   deno run --allow-read scripts/inject_agent_context.ts claude "debugging database cleanup testing" 6

1. Run: deno test --allow-read --allow-write tests/config_test.ts
   Show the exact error message and stack trace

1. <thinking>
   - Expected: cleanup() called in finally block
   - Actual: cleanup() might be missing or called conditionally
   - Gap: Test setup doesn't guarantee cleanup
   - Files: tests/config_test.ts, possibly tests/helpers/db.ts
     </thinking>

1.
   - Check if cleanup is in try/finally
   - Verify all code paths call cleanup
   - Update test to use proper pattern from agents/tests/testing.md

1.
   - Add comment explaining cleanup requirement
   - Update Implementation Plan step if this was part of config work

Error type: Test failure (resource leak)
Component: tests/config_test.ts
```

## Example Usage (Runtime Error)

**User:**

```markdown
I have a bug: PathResolver crashes with "Permission denied" for valid Portal paths

Use systematic debugging approach:

1. CONTEXT INJECTION:
   deno run --allow-read scripts/inject_agent_context.ts claude "debugging PathResolver Portal permissions" 8

1.
   - Write test: new PathResolver(portalId).resolve("valid/path")
   - Run test to confirm "Permission denied" error
   - Show exact error message and path that fails

1. <thinking>
   - Expected: Valid paths within Portal should resolve
   - Actual: Permission denied even for valid paths
   - Gap: Permission check logic might be too restrictive
   - Files: src/services/PathResolver.ts, Portal config validation
     </thinking>

1.
   - Read PathResolver permission logic
   - Check Portal config parsing
   - Fix validation to allow valid paths
   - Verify test passes

1.
   - Add regression test for this case
   - Update security test suite if needed

Error type: Runtime error (permission validation)
Component: src/services/PathResolver.ts
```

## Example Usage (TypeScript Error)

**User:**

```markdown
I have a bug: TypeScript error in src/ai/model_adapter.ts - "Property 'temperature' does not exist"

Use systematic debugging approach:

1. CONTEXT INJECTION:
   deno run --allow-read scripts/inject_agent_context.ts claude "TypeScript types model adapter LLM" 4

1.
   - Show the exact TypeScript error
   - Show the line causing the issue
   - Show the type definition

1. <thinking>
   - Expected: temperature property should exist on config type
   - Actual: Type definition doesn't include temperature
   - Gap: Schema mismatch or wrong type imported
   - Files: src/ai/model_adapter.ts, src/schemas/
     </thinking>

1.
   - Check Zod schema definition for model config
   - Add temperature to schema if missing
   - Or fix import if using wrong type
   - Verify TypeScript errors clear

1.
   - Update schema version if changed
   - Note in Implementation Plan if significant

Error type: TypeScript type error
Component: src/ai/model_adapter.ts
```

## Expected Response Pattern

Agent should:

1. Inject context about the error domain

1.
1.
1.
1.
1.
