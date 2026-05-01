---
identity: claude
agent: general
scope: dev
title: Claude provider adaptation notes
short_summary: "Comprehensive Claude usage guide with task-specific prompts, thinking protocols, and tool-use patterns."
version: "0.2"
topics: ["provider-adaptations", "prompts", "tdd", "refactoring", "debugging", "tool-use"]
---

## Overview

Claude Sonnet 4.6 provides a 200k context window and excellent reasoning capabilities. This guide provides task-specific prompt templates (including TDD test patterns), thinking protocols, and tool-use patterns optimized for Exaix development.

## Self-improvement loop

When Claude lacks enough Exaix-specific guidance to proceed safely, patch `.copilot/` during the task (minimal + test-backed), then continue.

- Process: `.copilot/guidelines/self-improvement.md`
- Claude-specific tip: use the thinking protocol to (1) list concrete instruction gaps, (2) propose the smallest doc patch, (3) rebuild/validate `.copilot/` artifacts, then (4) resume the primary task.

## Task-Specific System Prompts

### TDD Workflow

Use `initTestDbService()` or `createCliTestContext()` for test setup. Propose 2-3 failing tests first, then implement the minimal code to pass them.

**System prompt:**

> "You are a TDD assistant for Exaix. Before implementing, propose 2-3 failing unit tests with explicit assertions. After tests fail, implement the minimum code to pass them. Clean up resources in `finally` blocks."

### Refactoring

Before changing code: read existing implementation and related tests. Never refactor without tests proving equivalence.

**System prompt:**

> "You are a refactoring assistant for Exaix. Before changing code: (1) read the implementation and tests, (2) propose equivalence tests, (3) refactor incrementally, (4) verify tests still pass."

### Debugging

Process: read error → reproduce → diagnose root cause → implement minimal fix → add regression test.

**System prompt:**

> "You are a debugging assistant for Exaix. Process: (1) read error messages and Implementation Plan step, (2) reproduce the bug in a test, (3) diagnose root cause, (4) implement minimal fix, (5) add regression test."

### Documentation

**System prompt:**

> "You are a documentation assistant for Exaix. Workflow: (1) check the Implementation Plan for the related step, (2) update docs to match implementation, (3) keep docs concise and synchronized with the Plan."

## Thinking Protocol for Complex Tasks

Claude excels when given space to plan before acting. For multi-step work:

1. **Analyze** dependencies and risks in `<thinking>` tags

1.
1.
1.

## Example: Multi-file refactoring

```text
<thinking>
User wants to extract database initialization logic into a shared helper.

Dependencies:

- All files that call initTestDbService()
- Check if a shared helper already exists
- Verify test coverage won't drop

Risks:

- Breaking existing tests if import paths change
- Circular dependencies if helper is in wrong location

Plan:

1. Parallel reads: grep for "initTestDbService", read test helpers

1.
1.
   </thinking>

[Execute tool calls for reading files, then provide implementation]
```

## Tool-Use Patterns for Claude

### Parallel Reads (Context Gathering)

✅ **Good: Read multiple files in parallel**

```xml
<antml_function_calls>
<antml_invoke name="read_file">
<antml_parameter name="filePath">src/services/plan_writer.ts</antml_parameter>
</antml_invoke>
<antml_invoke name="read_file">
<antml_parameter name="filePath">tests/plan_writer_test.ts</antml_parameter>
</antml_invoke>
<antml_invoke name="grep_search">
<antml_parameter name="query">PlanWriter</antml_parameter>
<antml_parameter name="isRegexp">false</antml_parameter>
</antml_invoke>
</antml_function_calls>
```

❌ **Avoid: Sequential reads**

```text
Read file 1 → wait for result → read file 2 → wait for result → read file 3
```

### Incremental Updates for Multi-Step Tasks

Use `manage_todo_list` to track progress:

- Mark tasks `in-progress` before starting
- Mark `completed` immediately after finishing each step
- Provide status updates between major operations

### Efficient Context Gathering

1. **Parallelize** independent searches (grep_search + file_search + semantic_search)

1.
1.

## Token Budget Strategies

- **Claude Sonnet 4.6**: 200k context window
- **Recommended**: Include `short_summary` + 4-6 chunks (~2-3k tokens) for high-confidence tasks
- **Maximum**: 10-12 chunks (~5-6k tokens) for complex multi-file refactoring
- **Prefer explicit instruction**: "Consult `.copilot/manifest.json` and include `short_summary` and up to 4 chunks relevant to the task"

## Common Pitfalls with Exaix

### 1. Forgetting cleanup in tests

❌ **Bad:**

```typescript
const { db, tempDir, cleanup } = await initTestDbService();
// test code without cleanup
```

✅ **Good:**

```typescript
const { db, tempDir, cleanup } = await initTestDbService();
try {
  // test code
} finally {
  await cleanup();
}
```

### 2. Not checking Implementation Plan

❌ **Bad:** Implement features without corresponding Plan step

✅ **Good:** Read Plan first, create step if missing, then implement

### 3. Skipping TDD workflow

❌ **Bad:** Write implementation first, add tests later (or never)

✅ **Good:** Write failing tests FIRST, then implement minimal code to pass

### 4. Ignoring security patterns

❌ **Bad:**

```typescript
const filePath = userInput;
await Deno.readTextFile(filePath);
```

✅ **Good:**

```typescript
const filePath = pathResolver.resolve(userInput); // validates against Portal permissions
await Deno.readTextFile(filePath);
```

### 5. Hardcoding paths

❌ **Bad:**

```typescript
"/home/user/Exaix/Workspace/Active";
```

✅ **Good:**

```typescript
join(workspaceRoot, "Workspace", "Active"); // use PathResolver
```

### 6. Missing activity logging

❌ **Bad:** Side effects (file writes, executions) without EventLogger calls

✅ **Good:**

```typescript
await eventLogger.log({ type: "file_write", path, result: "success" });
```

### 7. Using deprecated Deno APIs

❌ **Bad:**

```typescript
Deno.run({ cmd: ["deno", "test"] });
```

✅ **Good:**

```typescript
new Deno.Command("deno", { args: ["test"] }).output();
```

### 8. Not validating frontmatter

❌ **Bad:** Manually parse YAML without schema validation

✅ **Good:** Use Zod schemas from `src/schemas/` for all YAML frontmatter

## Agent Communication Standards

- **Transparency**: Always explain the "why" behind a tool call.
- **Verification**: After every write, verify the output using `read_file` or `grep_search`.
- **Error Handling**: If a tool fails, analyze the error, update the plan, and retry once before asking for help.

## Canonical Prompt (Short)

"You are an agent working on Exaix. Check `.copilot/manifest.json` and include `short_summary` and up to 4 chunks relevant to the task before responding. Follow TDD workflow: propose failing tests first, then implement minimal code to pass them."

## Examples

- Example prompt: "Inspect test patterns and suggest TDD tests for module X using `initTestDbService()` and provide failing assertions."
- Example prompt: "Refactor PlanWriter to extract validation logic. Show tests proving behavior is unchanged."
- Example prompt: "Debug why async test is flaking. Propose a test that reproduces the race condition."

## Resources

- [Cross-Reference Map](./../cross-reference.md) — task → doc quick reference
- [Testing Guidelines](./../guidelines/testing.md) — test helpers and patterns
- [Development Guidelines](./../guidelines/exaix-development.md) — service architecture
- [Security Guidelines](./../guidelines/security-review.md) — security review process

---

## Cross-Reference Navigation

When starting a task, use the cross-reference map to find relevant docs before acting.

**Pattern:**

```text
I want to [task type].
First, consult `.copilot/cross-reference.md` for the workflow. Find my task type and read the relevant docs. Then proceed.
```

**Examples by task type:**

- `add feature` → `.copilot/guidelines/exaix-development.md`, `.copilot/skills/plan/SKILL.md`
- `write tests` → `.copilot/guidelines/testing.md`
- `fix TypeScript errors` → `.copilot/guidelines/exaix-development.md`
- `security audit` → `.copilot/guidelines/security-review.md`
- `embeddings/RAG` → `.copilot/providers/claude.md` (this file)

After finding the task type, read the listed docs, then act on the primary task.

---

## Refactoring with Extended Thinking

For complex refactoring, use explicit `<thinking>` blocks before each major step.

**Prompt template:**

```text
I need to refactor [component] to [goal].

Use your thinking protocol:
<thinking>
1. ANALYZE: Read relevant files, check dependencies, identify risks
2. PLAN: List tool calls needed (parallel reads where possible)
3. EXECUTE: Make changes incrementally
4. SYNTHESIZE: Verify tests pass, coverage maintained
5. VERIFY: Check planning document requirements met
</thinking>

Requirements from .copilot/:
- Follow Service Pattern from .copilot/guidelines/exaix-development.md
- Maintain test coverage per .copilot/guidelines/testing.md
- Update docs per .copilot/guidelines/documentation.md
- Use PathResolver for all file operations
- Log changes with EventLogger
```

**Expected response shape:** Claude shows `<thinking>` for each ANALYZE/PLAN/EXECUTE/SYNTHESIZE/VERIFY phase before executing tool calls.

---

## Systematic Debugging Protocol

For bugs, use a structured 5-phase approach: Inject → Reproduce → Diagnose → Fix → Verify.

**Prompt template:**

```text
I have a bug: [description]

1. CONTEXT: Inject .copilot/ context relevant to the failing area (4-6 chunks).
2. REPRODUCE: Write a failing test. Run it. Show exact error message.
3. DIAGNOSE: <thinking> Expected vs Actual vs Gap vs Files involved </thinking>
4. FIX: Implement minimal fix. Verify test passes. Check no regressions.
5. VERIFY: Add regression test. Update planning doc if needed.

Error type: [TypeScript error / runtime error / test failure / logic bug]
Component: [specific file or module]
```

**Example (test failure):**

```text
I have a bug: tests/config_test.ts fails with "Database connection not cleaned up"

1. Run: deno test --allow-all tests/config_test.ts — show exact error
2. <thinking>
   - Expected: cleanup() in finally block
   - Actual: cleanup() called conditionally
   - Gap: test setup doesn't guarantee cleanup
   - Files: tests/config_test.ts, tests/helpers/db.ts
   </thinking>
3. Check if cleanup is in try/finally; fix if not
4. Add regression test with proper cleanup pattern
```
