# Exaix Test Directory

This directory contains all tests, test utilities, and testing infrastructure for the Exaix project.

## Quick Start

```bash
# Run all tests
deno task test

# Run tests with coverage
deno task test --coverage

# Run specific test file
deno test --allow-all tests/services/agent_executor_test.ts

# Run tests matching a pattern
deno test --allow-all --filter "EventLogger"

# Type check tests
deno check tests/
```

---

## Directory Structure

```text
tests/
├── helpers/              # Test utilities (NO tests here)
├── fixtures/             # Test data builders and mock data
├── config/               # Test configuration constants
├── types/                # Compile-time type contract tests
│
├── agents/               # Agent-related tests
├── ai/                   # AI provider tests
├── blueprints/           # Blueprint loading and management
├── cli/                  # CLI command tests
├── docs/                 # Documentation validation tests
├── errors/               # Error handling tests
├── flows/                # Flow execution tests
├── infra/                # Infrastructure tests
├── integration/          # Multi-component integration tests
├── mcp/                  # MCP protocol tests
├── memory/               # Memory bank tests
├── repositories/         # Repository pattern tests
├── scenario_framework/   # E2E scenario testing framework
├── schemas/              # Zod schema validation tests
├── scripts/              # Script tests
├── security/             # Security boundary tests
├── services/             # Service layer unit tests
├── shared/               # Shared module tests (enums, constants)
├── tools/                # Tool registry tests
└── tui/                  # TUI component tests
```

---

## Folder Responsibilities

### Core Infrastructure

| Folder      | Purpose                            | Examples                                                             |
| ----------- | ---------------------------------- | -------------------------------------------------------------------- |
| `helpers/`  | **Utilities only** - NO test files | `test_helpers.ts`, `db.ts`, `config.ts`, `mock_provider.ts`          |
| `fixtures/` | **Test data builders**             | `memory_builder.ts`, `test_environment_factory.ts`, `llm_responses/` |
| `config/`   | **Test configuration constants**   | `constants.ts`, `ai_config_test.ts`                                  |
| `types/`    | **Compile-time type tests**        | `log_event_fields_type_test.ts`                                      |

### Domain-Specific Tests

| Folder          | Purpose                           | Examples                                               |
| --------------- | --------------------------------- | ------------------------------------------------------ |
| `agents/`       | Agent orchestration and execution | `agent_runner_test.ts`                                 |
| `ai/`           | AI provider implementations       | Provider authentication, model adapters                |
| `blueprints/`   | Blueprint loading and validation  | `blueprint_loader_test.ts`                             |
| `cli/`          | CLI command handlers              | `request_commands_test.ts`, `journal_commands_test.ts` |
| `docs/`         | Documentation validation          | Embedding tests, chunk validation                      |
| `errors/`       | Error handling and recovery       | `safe_error_test.ts`                                   |
| `flows/`        | Flow execution and gates          | `flow_runner_test.ts`, `gate_evaluator_test.ts`        |
| `mcp/`          | MCP protocol and tools            | `domain_tools_test.ts`, `http_security_test.ts`        |
| `memory/`       | Memory bank operations            | `memory_bank_test.ts`, `memory_extractor_test.ts`      |
| `repositories/` | Repository pattern tests          | `activity_repository_test.ts`                          |
| `schemas/`      | Zod schema validation             | `flow_schema_test.ts`, `request_schema_test.ts`        |
| `security/`     | Security boundary tests           | Git security, path traversal                           |
| `services/`     | Service layer unit tests          | `agent_executor_test.ts`, `event_logger_test.ts`       |
| `shared/`       | Shared utilities                  | `enums_test.ts`, `constants_test.ts`                   |
| `tools/`        | Tool registry and execution       | `tool_registry_test.ts`                                |
| `tui/`          | TUI components and views          | `monitor_view_test.ts`, `request_manager_test.ts`      |

### Integration & E2E

| Folder                | Purpose                   | Examples                                                     |
| --------------------- | ------------------------- | ------------------------------------------------------------ |
| `integration/`        | **Multi-component tests** | `memory_integration_test.ts`, `cli_flow_integration_test.ts` |
| `scenario_framework/` | **E2E scenario testing**  | Full workflow scenarios with fixtures                        |
| `infra/`              | **Infrastructure tests**  | Timeout tests, resource limits                               |

---

## Writing New Tests

### Avoid hard-coded multiline fixture content

- Do not embed large YAML/Markdown/text blocks directly in test files.
- Use files under `tests/fixtures/` for request bodies, blueprint definitions, policy documents, and other multiline assets.
- Load fixture content in tests with `Deno.readTextFile()` and copy it into temporary workspaces with `Deno.writeTextFile()`.
- This keeps tests readable, maintainable, and avoids anti-patterns where multiline strings are duplicated in code.

## Enforcement

- Test placement is enforced by `deno task check:test-placement`.
- New files matching `*_test.ts` must live under `tests/`.
- New service tests must live under `tests/services/<domain>/`, not directly under `tests/services/`.
- The authoritative agent-facing placement rules live in `.copilot/workflows/testing.md`.

### 1. Choose the Right Location

**Ask yourself:**

1. **What am I testing?**
   - Single function/class → Unit test → `services/`, `repositories/`, `schemas/`
   - CLI command → `cli/`
   - Multiple components → `integration/`
   - Full workflow → `scenario_framework/`

2. **Does a helper already exist?**
   - Check `helpers/` for existing utilities
   - Use `initTestDbService()` for database tests
   - Use `createCliTestContext()` for CLI tests

### Deterministic Source-To-Test Mapping

- `packages/*/src/services/<domain>/...` → `tests/services/<domain>/...`
- `packages/schemas/src/...` → `tests/schemas/...`
- `packages/core/src/shared/...` → `tests/shared/...`
- `packages/flow/src/...` → `tests/flows/...`
- `apps/exactl/src/...` → `apps/exactl/tests/...`
- `packages/ai/src/...` → `tests/ai/...`
- `packages/mcp/src/...` → `tests/mcp/...`
- `packages/core/src/errors/...` → `tests/errors/...`
- `scripts/...` → `tests/scripts/...`

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

#### Database Tests

```typescript
import { initTestDbService } from "../helpers/db.ts";

Deno.test("MyService: does something with database", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    // Your test code here
    const service = new MyService(db);
    await service.doSomething();
  } finally {
    await cleanup();
  }
});
```

#### CLI Tests

```typescript
import { createCliTestContext } from "../helpers/test_helpers.ts";

Deno.test("CLI command: handles input", async () => {
  const { context, cleanup } = await createCliTestContext();
  try {
    // Your test code here
    await runCommand(context, "arg1", "arg2");
  } finally {
    await cleanup();
  }
});
```

#### Service Tests with Mocks

```typescript
import { createStubConfig, createStubDb } from "../helpers/test_helpers.ts";

Deno.test("MyService: handles edge case", async () => {
  const mockConfig = createStubConfig();
  const mockDb = createStubDb();

  const service = new MyService(mockConfig, mockDb);
  const result = await service.doWork();

  assertEquals(result, expected);
});
```

#### Type Contract Tests

```typescript
// tests/types/my_feature_type_test.ts
// This file has NO runtime tests - it's for compile-time verification only

import type { MyInterface } from "@exaix/core";

// This must compile successfully
const _valid: MyInterface = {
  requiredField: "value",
  optionalField: 42,
};

// Uncomment to verify type errors:
// const _invalid: MyInterface = {
//   // missing requiredField - ERROR
// };
```

### 4. Security Tests

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

### 5. Test Environment Variables

Use `EXA_TEST_*` prefixed variables:

```typescript
import { isCIMode, isTestMode } from "@exaix/core/config/env_schema.ts";

Deno.test("Feature: works in test mode", () => {
  if (isCIMode() && !Deno.env.get("EXA_TEST_ENABLE_PAID_LLM")) {
    // Skip paid API tests in CI
    return;
  }
  // Test code...
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
deno test --allow-all tests/services/my_test.ts

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

### Core Helpers (`helpers/`)

| Helper             | Purpose            | Usage                                  |
| ------------------ | ------------------ | -------------------------------------- |
| `test_helpers.ts`  | Stub factories     | `createStubConfig()`, `createStubDb()` |
| `db.ts`            | Database setup     | `initTestDbService()`, `initTestDb()`  |
| `config.ts`        | Mock configs       | `createMockConfig()`                   |
| `mock_provider.ts` | Mock LLM providers | Deterministic AI testing               |
| `paths_helper.ts`  | Path utilities     | Memory directory helpers               |

### Using Helpers

```typescript
// Import from helpers
import { createStubConfig, createStubDb } from "../helpers/test_helpers.ts";
import { initTestDbService } from "../helpers/db.ts";

// Use in tests
const mockConfig = createStubConfig();
const { db, cleanup } = await initTestDbService();
```

---

## Code Style

Follow [CODE_STYLE.md](../CODE_STYLE.md) for:

- Naming conventions
- Import organization
- Error handling patterns
- Async/await usage

### Test-Specific Style

```typescript
// ✅ DO: Use descriptive test names
Deno.test("AgentExecutor: logExecutionStart writes correct field separation", async () => {
  // ...
});

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

## Phase 55: Actor/Agent/Identity Tests

New test coverage for journal field separation:

| Test File                                                  | Purpose                      |
| ---------------------------------------------------------- | ---------------------------- |
| `services/event_logger_identity_fields_test.ts`            | EventLogger field forwarding |
| `repositories/activity_repository_identity_fields_test.ts` | Repository persistence       |
| `services/agent_executor_journal_test.ts`                  | AgentExecutor journal calls  |
| `shared/enums_identity_separation_test.ts`                 | Enum value contracts         |
| `types/log_event_fields_type_test.ts`                      | Type contract verification   |
| `types/request_frontmatter_type_test.ts`                   | Frontmatter type contract    |

**23 runtime tests + 2 compile-time tests** verify Actor/Agent/Identity separation.

---

## Contributing

1. **Write tests first** (TDD)
2. **Use existing helpers** - don't duplicate setup code
3. **Name tests clearly** - describe behavior, not just "should work"
4. **Clean up resources** - always call `cleanup()` in finally blocks
5. **Run lint** - `deno task lint` before committing

### Adding New Test Files

1. Create file in appropriate subfolder
2. Add module docblock at top:

```typescript
/**
 * @module MyTestModule
 * @path tests/domain/my_test.ts
 * @description What this tests
 */
```

1. Run `deno fmt` and `deno lint`
1. Verify with `deno task test`

---

## See Also

- [CODE_STYLE.md](../CODE_STYLE.md) - General coding style
- [CONTRIBUTING.md](../CONTRIBUTING.md) - Contribution guidelines
- [ARCHITECTURE.md](../ARCHITECTURE.md) - System architecture
- [REFACTORING_PLAN.md](./REFACTORING_PLAN.md) - Test folder structure plan
