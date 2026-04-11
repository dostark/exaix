---
agent: claude
scope: dev
title: "Refactoring with Thinking Protocol Prompt"
short_summary: "Example prompt for complex refactoring using Claude's thinking protocol."
version: "0.1"
topics: ["refactoring", "thinking-protocol", "prompts", "examples"]
---

## Prompt Template

```markdown
I need to refactor [component/pattern] to [goal].

Use your thinking protocol:

<thinking>
1. ANALYZE: Read relevant files, check dependencies, identify risks
1. PLAN: List tool calls needed (parallel reads where possible)
1. EXECUTE: Make changes incrementally
1. SYNTHESIZE: Verify tests pass, coverage maintained
1. VERIFY: Check Implementation Plan requirements met
</thinking>

Context injection:
deno run --allow-read scripts/inject_agent_context.ts claude "refactoring [pattern] [component]" 6

Requirements from agents/:

- Follow Service Pattern from agents/source/exaix.md
- Maintain test coverage per agents/tests/testing.md
- Update docs per agents/docs/documentation.md
- Use PathResolver for all file operations
- Log changes with EventLogger

Show your thinking explicitly in <thinking> tags before each major step.
```

## Example Usage

**User:**

```markdown
I need to refactor database initialization code to extract a reusable helper.

Use your thinking protocol:

<thinking>
1. ANALYZE: Read all files using initTestDbService(), check if helper exists, identify import dependencies
1. PLAN: grep for "initTestDbService", read test helpers, propose new location (tests/helpers/db.ts)
1. EXECUTE: Create helper, update imports in 2-3 files as example
1. SYNTHESIZE: Run affected tests, verify coverage
1. VERIFY: Check Implementation Plan has db helper extraction step
</thinking>

Context injection:
deno run --allow-read scripts/inject_agent_context.ts claude "refactoring database testing helpers" 6

Requirements from agents/:

- Follow Service Pattern from agents/source/exaix.md
- Maintain test coverage per agents/tests/testing.md
- Update docs per agents/docs/documentation.md
- Use proper cleanup patterns
- Log changes with EventLogger

Show your thinking explicitly in <thinking> tags before each major step.
```

## Expected Response Pattern

Claude should show thinking for each phase:

```markdown
<thinking>
ANALYZE phase:
- Found 12 files calling initTestDbService()
- No existing db.ts helper in tests/helpers/
- Risk: Circular dependencies if placed in wrong location
- Dependencies: All test files import from tests/helpers/

PLAN phase:
Tool calls needed:

1. grep_search for "initTestDbService" (get usage count)
1. Parallel read: tests/helpers/test_utils.ts, tests/db_test.ts (patterns)
1. Create tests/helpers/db.ts with exported helper
1. Update 2 representative files as examples
1. Run tests to verify
   </thinking>

[then execute the plan with actual tool calls]
```
