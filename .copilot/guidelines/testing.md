---
agent: copilot
scope: dev
title: Exaix Test Development Guidelines
short_summary: "Testing patterns and unified test context for Exaix (initTestDbService, createCliTestContext, withEnv, etc.)."
version: "0.1"
topics: ["tests", "tdd", "helpers"]
---

Key points

- See [tests/README.md](../../tests/README.md) for the full test directory structure, package-local test mapping, and writing-new-tests guide
- See [packages/testing/README.md](../../packages/testing/README.md) for the shared testing surface (`@exaix/testing`) and its consolidation targets
- Use `initTestDbService()` and `createCliTestContext()` to centralize db+tempdir setup
- Use `withEnv()` for temporary env var changes in tests
- **Mocking**: Use `MockLLMProvider` for deterministic agent testing (avoid real API calls).
- **Integration**: Use `TestEnvironment.create()` to scaffold full workspace/DB structures.
- **Leases**: File locking integration tests live in `tests/execution_loop_test.ts`.
- See [CODE_STYLE.md](../../CODE_STYLE.md) for the full coding style rules applicable to tests and source code.

- Prefer `createCliTestContext()` for CLI tests and call returned `cleanup()` in `afterEach`

Canonical prompt (short):
"You are a test-writing assistant for Exaix. List failing test names and assertions first, using `initTestDbService()` or `createCliTestContext()` where appropriate."

Examples

- Example prompt: "Write tests that verify PlanWriter handles missing files and empty JSON. Use `initTestDbService()` and ensure cleanup is called."

Example snippet

```typescript
const { db, tempDir, cleanup } = await initTestDbService();
try {
  // test actions
} finally {
  await cleanup();
}
```

Examples section

- Example prompt: "Provide 3 failing unit tests showing how PlanWriter handles malformed plan.json and missing permissions."

## Full migration: Test guidelines (extended)

### Coverage-Driven TDD

Target: Minimum 70% branch coverage on new features. Request an implementation with a coverage target and add tests to cover uncovered branches using `deno test --coverage`.

### Advanced Testing Patterns

- **Refactoring & Duplication**: Use `npx jscpd packages apps tests` to find duplicated test setup code. Extract helpers (e.g., `GitTestHelper`, `ToolRegistryTestHelper`) to keep tests DRY.
- **Paranoid Security Testing**: Ask agents to write "paranoid" tests: path traversal, command injection, symlink escapes. Whitelists beat blacklists.
- **Performance Testing**: Don't guess—measure. Ask agents to write benchmarks or load tests to verify async behavior (e.g., batched logging).

### Test Organization and Deduplication

- `tests/cli/` - CLI command tests
- `tests/services/` - Service unit tests
- `tests/integration/` - End-to-end workflows
- `tests/helpers/` - Shared test utilities

### Mandatory Test Placement Rules

- All new runtime test files matching `*_test.ts` must live under `tests/`.
- Never add new `*_test.ts` files under `scripts/`, `docs/`, or other non-`tests/` and non-`packages/` roots.
- Service tests must live under `tests/services/<domain>/`, not directly under `tests/services/`.
- Before creating a new test, search for an existing domain folder and place the file there.
- If no suitable service domain folder exists yet, create `tests/services/<domain>/` first.
- Enforcement is automatic via `deno task check:test-placement`; treat violations as blocking.

### Deterministic Source-To-Test Mapping

Package-owned tests live under `packages/<package>/tests/`. Integration and scenario tests live under `tests/`.

- `packages/<package>/src/...` → `packages/<package>/tests/...`
- `apps/<app>/src/...` → `apps/<app>/tests/...` or `tests/integration/...`
- `packages/schemas/...` → `packages/schemas/tests/...`
- `packages/flow/...` → `packages/flow/tests/...`
- `packages/mcp/...` → `packages/mcp/tests/...`
- `scripts/...` → `tests/scripts/...`

Deduplication checklist:

1. Search for similar test file names

1.
1.

### Security Tests as First-Class Citizens

Every security boundary needs explicit tests. Label security tests with `[security]` and include tests for path traversal, shell injection, network exfiltration, and env leakage.

### Database Initialization

✅ DO: Use `initTestDbService()` for DatabaseService tests. Prefer `initActivityTableSchema()` for reconnection tests and avoid raw SQL table creation in test files.

### CLI Test Context — Recommended Pattern

Use `createCliTestContext()` to centralize DB + tempdir setup for CLI tests. Always call returned `cleanup()` in `afterEach` to avoid leaking resources.

### Integration TestEnvironment — Recommended Pattern

Use `TestEnvironment.create()` for full integration tests that require workspace layout, DB, and optional git initialization. Prefer small, focused integration tests that exercise end-to-end behavior with deterministic teardown.

### Test Environment Variables (Phase 28)

All test-related environment variables use the `EXA_TEST_*` prefix for clarity and separation from production env vars:

**Standard Test Variables:**

- `EXA_TEST_MODE` — Indicates test environment (replaces legacy `DENO_TEST`)
- `EXA_TEST_CLI_MODE` — Indicates CLI test mode (replaces legacy `EXACTL_TEST_MODE`)
- `EXA_TEST_ENABLE_PAID_LLM` — Opt-in for paid API tests in CI (0 or 1)
- `EXA_TEST_ENABLE_OLLAMA` — Enable Ollama integration tests (0 or 1)
- `EXA_TEST_ENABLE_LLAMA` — Enable Llama provider tests (true or false)
- `EXA_TEST_LLM_MODEL` — Override model for tests
- `EXA_TEST_OPENAI_API_KEY` — OpenAI API key for integration tests

**Helper Functions:**

Use the helper functions from `@exaix/core/config/env_schema.ts` instead of direct env var access:

```typescript
import { isCIMode, isTestMode } from "@exaix/core/config/env_schema.ts";

// Check if in test environment
if (isTestMode()) {
  // Skip timer-based operations in tests
  console.log("Running in test mode, skipping delays");
}

// Check if in CI environment
if (isCIMode() && !Deno.env.get("EXA_TEST_ENABLE_PAID_LLM")) {
  // Skip paid API tests in CI
  test.ignore = true;
}
```

**Best Practices:**

- ✅ Always use `isTestMode()` instead of checking `DENO_TEST` or `EXA_TEST_MODE` directly
- ✅ Always use `isCIMode()` instead of checking `CI` or `EXA_CI_MODE` directly
- ✅ Use `EXA_TEST_*` prefix for any new test-related env vars
- ❌ Never use legacy env vars (`DENO_TEST`, `EXACTL_TEST_MODE`) in new code

### CI (GitHub Actions) — Common Pitfalls

- Treat `CI` as a truthy flag (`CI=true` on GitHub Actions), not strictly `"1"`.
  - **Prefer** the shared helpers in `@exaix/core/config/env_schema.ts` (`isCIMode()`, `isTestMode()`).
- When CI guard is active, paid LLM providers are intentionally disabled unless explicitly opted in.
  - Expect mock behavior unless `EXA_TEST_ENABLE_PAID_LLM=1` is set.
  - Tests that assert provider selection should include a CI-guard branch (e.g., accept `mock-provider` or `CI-protected ...`).
- Avoid requiring compiled binaries in tests.
  - If you need to run the CLI from a temp workspace, prefer:
    - `new Deno.Command(Deno.execPath(), { args: ["run", "--allow-all", "--config", <repo>/deno.json, <repo>/apps/exactl/main.ts, ...] })`
  - This keeps behavior consistent between local runs and CI without extra build steps.

---
