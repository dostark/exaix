# Exaix Test Directory

This directory contains tests, test utilities, and testing infrastructure for the Exaix project.

> **Post-migration status (2026-05-24):** The `src/` directory has been fully removed. Package-level unit tests now live in `packages/<name>/tests/` and app-level tests in `apps/<name>/tests/`. Root `tests/` is being migrated from ~267 files to ~70 cross-package integration and infrastructure tests (see [`exaix-dev-docs/dev/Exaix_Packages.md §Test migration plan`](../exaix-dev-docs/dev/Exaix_Packages.md#test-migration-plan)). The directory structure below reflects the **target end state** after migration.

## Quick Start

```bash
# Run all tests
deno task test

# Run tests with coverage
deno task test --coverage

# Run specific test file
deno test --allow-all packages/execution/tests/agent_executor_test.ts

# Run tests matching a pattern
deno test --allow-all --filter "EventLogger"

# Type check tests
deno check tests/
```

---

## Directory Structure (Target)

```text
tests/                              # ~70 files — cross-package + infra tests
├── agents/                         # Agent documentation validation
├── blueprints/                     # Cross-cutting blueprint tests
├── config/                         # Multi-package config integration
├── docs/                           # Documentation validation tests
├── flows/                          # Integration-heavy flow tests (execution + flow-storage + tool-runtime)
├── integration/                    # Multi-package E2E scenarios
├── journal/                        # Activity journal (multi-service)
├── load/                           # Cross-cutting load test
├── migrations/                     # DB schema migration
├── regression/                     # Strategy parity regression
├── scenario_framework/             # Declarative E2E test framework with own runner
├── scripts/                        # CI/build script validation
└── security/                       # Cross-cutting security regression

packages/<name>/tests/              # Package-local unit tests (21 packages)
apps/<name>/tests/                  # App-local tests (6 apps: daemon, exactl, tui, mcp-server, agent-entrypoint, common)
```

---

## Folder Responsibilities

### Root `tests/` — Cross-package & Infrastructure (stays)

| Folder                | Purpose                        | Examples                                                      |
| --------------------- | ------------------------------ | ------------------------------------------------------------- |
| `integration/`        | Multi-package E2E scenarios    | `happy_path_test.ts`, `31_cli_flow_integration_test.ts`       |
| `flows/`              | Integration-heavy flow tests   | `parallel_flow_groups_test.ts`, `condition_evaluator_test.ts` |
| `scenario_framework/` | Declarative E2E framework      | Scenario definitions, runner, bin/                            |
| `scripts/`            | CI/build script validation     | `check_code_style_test.ts`, `validate_architecture_test.ts`   |
| `docs/`               | Documentation integrity        | `hallucination_benchmark_test.ts`, `user_guide_test.ts`       |
| `config/`             | Multi-package configuration    | Test configuration constants                                  |
| `security/`           | Cross-cutting security tests   | `mcp_security_test.ts`, `permission_test.ts`                  |
| `agents/`             | Agent documentation validation | Agent-related integration tests                               |
| `blueprints/`         | Blueprint loading/validation   | Cross-cutting blueprint tests                                 |
| `migrations/`         | DB schema migration            | `migrate_db_test.ts`                                          |
| `regression/`         | Strategy parity regression     | Cross-package regression                                      |
| `load/`               | Cross-cutting load test        | Load benchmarks                                               |
| `journal/`            | Activity journal integration   | Multi-service journal tests                                   |
| `repositories/`       | Data-access integration        | Repository integration tests                                  |

### Package-Local Tests — `packages/<name>/tests/`

Each package owns its unit tests. Key locations:

| Package                 | Test directory                   | Tests what                                          |
| ----------------------- | -------------------------------- | --------------------------------------------------- |
| `@exaix/core`           | `packages/core/tests/`           | Config, errors, status, skills, cost, notifications |
| `@exaix/ai`             | `packages/ai/tests/`             | Provider contracts, registry, mock providers        |
| `@exaix/ai-anthropic`   | `packages/ai-anthropic/tests/`   | Anthropic Claude provider                           |
| `@exaix/ai-openai`      | `packages/ai-openai/tests/`      | OpenAI provider + embedding                         |
| `@exaix/ai-google`      | `packages/ai-google/tests/`      | Google Gemini provider                              |
| `@exaix/ai-ollama`      | `packages/ai-ollama/tests/`      | Ollama/Llama provider + embedding                   |
| `@exaix/tui`            | `packages/tui/tests/`            | TUI base components (layout, helpers, dialogs)      |
| `@exaix/mcp`            | `packages/mcp/tests/`            | MCP server, tools, handlers (30+ tests)             |
| `@exaix/git`            | `packages/git/tests/`            | Git service, interfaces                             |
| `@exaix/cli`            | `packages/cli/tests/`            | CLI base: types, formatters, validation             |
| `@exaix/testing`        | `packages/testing/tests/`        | Shared testing helpers                              |
| `@exaix/memory`         | `packages/memory/tests/`         | Memory bank, extraction, embedding, search          |
| `@exaix/storage-sqlite` | `packages/storage-sqlite/tests/` | SQLite DB implementation                            |
| `@exaix/portal`         | `packages/portal/tests/`         | Portal analysis, permissions, persistence           |
| `@exaix/quality-gate`   | `packages/quality-gate/tests/`   | Quality gate evaluation, clarification              |
| `@exaix/request`        | `packages/request/tests/`        | Request lifecycle (162 tests)                       |
| `@exaix/routing`        | `packages/routing/tests/`        | Routing policy, capability matching                 |
| `@exaix/tool-runtime`   | `packages/tool-runtime/tests/`   | ToolRegistry, OutputValidator, ToolReflector        |
| `@exaix/execution`      | `packages/execution/tests/`      | AgentExecutor, ExecutionLoop, strategies            |
| `@exaix/flow-storage`   | `packages/flow-storage/tests/`   | Checkpoints, namespaces, validators, reporters      |

### App-Local Tests — `apps/<name>/tests/`

| App           | Test directory       | Tests what                                 |
| ------------- | -------------------- | ------------------------------------------ |
| `apps/daemon` | `apps/daemon/tests/` | Health, deploy, watcher, graceful shutdown |
| `apps/exactl` | `apps/exactl/tests/` | Concrete CLI command tests                 |
| `apps/tui`    | `apps/tui/tests/`    | Concrete TUI view tests                    |
| `apps/common` | `apps/common/tests/` | Shared app-level utility tests             |

---

## Migration Status

Test migration from root `tests/` to package directories is **in progress** (~267 files to move). See [`exaix-dev-docs/dev/Exaix_Packages.md §Test migration plan`](../exaix-dev-docs/dev/Exaix_Packages.md#test-migration-plan) for:

- **Per-folder migration map** — every `tests/services/` subfolder mapped to its target package
- **Sequencing** — helpers first → leaf packages → orchestration → apps → flows split → cleanup
- **Principles** — when to move vs. stay vs. consolidate into `@exaix/testing`

---

## Writing New Tests

### 1. Choose the Right Location

**Ask yourself:**

1. **Does the test exercise a single package in isolation?**
   - → Add to `packages/<name>/tests/`
   - Use `@exaix/testing` for shared helpers, `@exaix/<package>/testing` for package-specific helpers

2. **Does it test a CLI command?**
   - → Add to `apps/exactl/tests/`

3. **Does it test a concrete TUI view?**
   - → Add to `apps/tui/tests/`

4. **Does it exercise multiple packages with real wiring?**
   - → Add to `tests/integration/`

5. **Does it validate CI/build scripts?**
   - → Add to `tests/scripts/`

6. **Does it validate documentation integrity?**
   - → Add to `tests/docs/`

### Avoid hard-coded multiline fixture content

- Do not embed large YAML/Markdown/text blocks directly in test files.
- Use files under `tests/fixtures/` for request bodies, blueprint definitions, policy documents, and other multiline assets.
- Load fixture content in tests with `Deno.readTextFile()` and copy it into temporary workspaces with `Deno.writeTextFile()`.

## Enforcement

- Test placement is enforced by `deno task check:test-placement`.
- New files matching `*_test.ts` under root `tests/` are checked for valid placement.
- New service tests must live under `packages/<name>/tests/` or `apps/<name>/tests/`, not under root `tests/services/`.
- The authoritative agent-facing placement rules live in `.copilot/skills/test-development/SKILL.md`.

### Deterministic Source-To-Test Mapping

- `packages/<name>/src/...` → `packages/<name>/tests/...`
- `apps/<name>/src/...` → `apps/<name>/tests/...`
- `scripts/...` → `tests/scripts/...`
- Cross-package integration → `tests/integration/`
- Documentation validation → `tests/docs/`

### 2. Follow Naming Conventions

```typescript
// Unit tests
<module> _test.ts < // agent_executor_test.ts
                            module > _unit_test.ts < // plan_service_unit_test.ts
                    // Integration tests
                    feature > _integration_test.ts < // memory_integration_test.ts
            // Regression tests
            issue > _regression_test.ts < // git_security_regression_test.ts
    // Type tests (compile-time only)
    feature > _type_test.ts; // log_event_fields_type_test.ts
```

### 3. Use Standard Patterns

#### Package-Local Tests

```typescript
// packages/execution/tests/my_test.ts
import { createStubContext } from "@exaix/testing";
import { MyService } from "../src/my_service.ts";

Deno.test("MyService: does something", () => {
  const ctx = createStubContext();
  const svc = new MyService(ctx);
  assertEquals(svc.doSomething(), expected);
});
```

#### Database Tests

```typescript
import { initTestDbService } from "@exaix/testing";

Deno.test("MyService: does something with database", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const service = new MyService(db);
    await service.doSomething();
  } finally {
    await cleanup();
  }
});
```

#### CLI Tests

```typescript
import { createCliTestContext } from "@exaix/exactl/testing";

Deno.test("CLI command: handles input", async () => {
  const { context, cleanup } = await createCliTestContext();
  try {
    await runCommand(context, "arg1", "arg2");
  } finally {
    await cleanup();
  }
});
```

#### Service Tests with Mocks

```typescript
import { createStubConfig, createStubDb } from "@exaix/testing";

Deno.test("MyService: handles edge case", async () => {
  const mockConfig = createStubConfig();
  const mockDb = createStubDb();
  const service = new MyService(mockConfig, mockDb);
  const result = await service.doWork();
  assertEquals(result, expected);
});
```

#### Security Tests

Label security tests with `[security]` and test:

- Path traversal attempts
- Shell injection
- Network exfiltration
- Environment variable leakage

```typescript
Deno.test("[security] Service: prevents path traversal", async () => {
  // Test path like "../../../etc/passwd" is rejected
});
```

### Test Environment Variables

Use `EXA_TEST_*` prefixed variables:

```typescript
import { isCIMode, isTestMode } from "@exaix/core/config/env_schema.ts";

Deno.test("Feature: works in test mode", () => {
  if (isCIMode() && !Deno.env.get("EXA_TEST_ENABLE_PAID_LLM")) {
    return;
  }
});
```

---

## Running Tests

### Basic Commands

```bash
# All tests
deno task test

# With coverage
deno task test --coverage

# Specific file
deno test --allow-all packages/execution/tests/agent_executor_test.ts

# Filter by name
deno test --allow-all --filter "EventLogger"

# Type check only
deno check tests/
```

### Coverage

```bash
# Generate coverage report
deno task test --coverage

# View coverage HTML
deno task coverage-html
```

**Target:** Minimum 70% branch coverage on new features.

---

## Test Helpers

### Shared Helpers (`@exaix/testing`)

Import shared helpers from `@exaix/testing`:

| Helper              | Purpose        | Usage                                                |
| ------------------- | -------------- | ---------------------------------------------------- |
| `createStubContext` | Stub context   | `import { createStubContext } from "@exaix/testing"` |
| `createStubDb`      | Stub database  | `import { createStubDb } from "@exaix/testing"`      |
| `initTestDbService` | Database setup | `import { initTestDbService } from "@exaix/testing"` |
| Stub factories      | Mock factories | `import { ... } from "@exaix/testing"`               |

### Package-Specific Testing Subpaths

When a package exposes test helpers for external consumers, use the `@exaix/<package>/testing` pattern:

```typescript
import { createGitTestHelper } from "@exaix/git/testing";
import { createMcpTestSetup } from "@exaix/mcp/testing";
```

---

## Code Style

Follow [CODE_STYLE.md](../CODE_STYLE.md) for naming conventions, import organization, error handling patterns, and async/await usage.

### Test-Specific Style

```typescript
// ✅ DO: Use descriptive test names
Deno.test("AgentExecutor: logExecutionStart writes correct field separation", () => {});

// ✅ DO: Use try/finally for cleanup
const { db, cleanup } = await initTestDbService();
try {
  // test code
} finally {
  await cleanup();
}

// ❌ DON'T: Skip cleanup
// ❌ DON'T: Use real API keys in tests
// ❌ DON'T: Write to disk without cleanup
```

---

## CI/CD

### GitHub Actions

Tests run automatically on:

- Pull requests
- Push to `main`
- Scheduled runs (nightly)

### Common Pitfalls

1. **CI mode detection**: Use `isCIMode()` helper, not raw `CI` env var
2. **Paid LLM tests**: Disabled in CI unless `EXA_TEST_ENABLE_PAID_LLM=1`
3. **Binary dependencies**: Don't require compiled binaries in tests

### Running Locally Like CI

```bash
# Simulate CI environment
CI=true deno task test

# Enable paid LLM tests (requires valid API key)
EXA_TEST_ENABLE_PAID_LLM=1 deno task test
```

---

## Contributing

1. **Write tests first** (TDD)
2. **Use existing helpers** — import from `@exaix/testing` rather than deep-importing root `tests/helpers/`
3. **Name tests clearly** — describe behavior, not just "should work"
4. **Clean up resources** — always call `cleanup()` in finally blocks
5. **Run lint** — `deno task lint` before committing

### Adding New Test Files

1. Create file in appropriate location (`packages/<name>/tests/`, `apps/<name>/tests/`, or `tests/<category>/`)
2. Add module docblock at top:

```typescript
/**
 * @module MyTestModule
 * @path packages/mypackage/tests/my_test.ts
 * @description What this tests
 */
```

3. Run `deno fmt` and `deno lint`
4. Verify with `deno task test`

---

## See Also

- [CODE_STYLE.md](../CODE_STYLE.md) — General coding style
- [CONTRIBUTING.md](../CONTRIBUTING.md) — Contribution guidelines
- [ARCHITECTURE.md](../ARCHITECTURE.md) — System architecture
- [`exaix-dev-docs/dev/Exaix_Packages.md`](../exaix-dev-docs/dev/Exaix_Packages.md) — Package boundaries + test migration plan
- [`exaix-dev-docs/dev/Exaix_Testing_and_CI_Strategy.md`](../exaix-dev-docs/dev/Exaix_Testing_and_CI_Strategy.md) — Full testing strategy
