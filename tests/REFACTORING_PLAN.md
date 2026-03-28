# Test Folder Structure Refactoring Plan

## Current State

The `tests/` directory has evolved organically with 20+ subfolders and 40+ root-level test files. While most subfolders have clear domain-specific roles, there are some organizational issues:

### Issues

1. **`utils/` vs `helpers/`** - Unclear distinction
   - `utils/` has only 2 test files (`secure_random_test.ts`, `subprocess_test.ts`)
   - `helpers/` has 17 utility modules used across tests
   - These should be consolidated

2. **`infra/`** - Underutilized folder
   - Only 1 file: `timeout_test.ts`
   - Should be merged into a more appropriate location

3. **Root-level test files** - 40+ files create clutter
   - Many belong in domain-specific folders
   - Makes discovery difficult

4. **`test_helpers.ts` in root** - Inconsistent location
   - Should be `helpers/test_helpers.ts` for consistency

---

## Recommended Structure

### Core Test Infrastructure

```
tests/
├── helpers/              # Test utilities (NO tests here)
│   ├── test_helpers.ts          # Main stub factories (createStubConfig, etc.)
│   ├── db.ts                    # Database test helpers
│   ├── config.ts                # Mock config factories
│   ├── mock_provider.ts         # Mock LLM provider
│   ├── paths_helper.ts          # Path utilities
│   └── ... (other helpers)
│
├── fixtures/             # Test data and builders
│   ├── test_environment_factory.ts
│   ├── memory_builder.ts
│   └── llm_responses/
│
├── config/               # Configuration constants for tests
│   └── constants.ts
│
└── types/                # Compile-time type tests only
    ├── log_event_fields_type_test.ts
    └── request_frontmatter_type_test.ts
```

### Domain-Specific Tests

```
tests/
├── agents/               # Agent-related tests
├── ai/                   # AI provider tests
├── blueprints/           # Blueprint loading/management
├── cli/                  # CLI command tests
├── errors/               # Error handling tests
├── flows/                # Flow execution tests
├── mcp/                  # MCP protocol tests
├── memory/               # Memory bank tests
├── repositories/         # Repository pattern tests
├── schemas/              # Zod schema tests
├── security/             # Security tests
├── services/             # Service layer tests
├── shared/               # Shared module tests (enums, constants)
├── tools/                # Tool registry tests
└── tui/                  # TUI component tests
```

### Integration & E2E Tests

```
tests/
├── integration/          # Multi-component integration tests
├── scenario_framework/   # E2E scenario testing framework
└── infra/                # Infrastructure tests (merge from current infra/)
```

---

## Migration Plan

### Phase 1: Consolidate Helpers (High Priority)

1. **Merge `utils/` into `helpers/`**
   ```bash
   mv tests/utils/secure_random_test.ts tests/helpers/secure_random_test.ts
   mv tests/utils/subprocess_test.ts tests/helpers/subprocess_test.ts
   rmdir tests/utils
   ```

2. **Move `test_helpers.ts` to `helpers/`**
   ```bash
   mv tests/test_helpers.ts tests/helpers/test_helpers.ts
   # Update all imports: ./test_helpers.ts -> ./helpers/test_helpers.ts
   ```

3. **Merge `infra/` into appropriate locations**
   - `timeout_test.ts` → `services/` (if testing service timeouts)
   - Or create `tests/infra/` with more infrastructure tests

### Phase 2: Organize Root-Level Tests (Medium Priority)

Move root-level test files to appropriate subfolders:

| File                            | Move To                       |
| ------------------------------- | ----------------------------- |
| `agent_retrieval_smoke_test.ts` | `agents/`                     |
| `agent_runner_test.ts`          | `agents/`                     |
| `audit_logger_test.ts`          | `services/`                   |
| `code_parser_test.ts`           | `parsers/` (new)              |
| `db_test.ts`                    | `helpers/` or `repositories/` |
| `event_logger_test.ts`          | `services/`                   |
| `git_service_test.ts`           | `services/`                   |
| `health_check_timeouts_test.ts` | `services/`                   |
| `path_resolver_test.ts`         | `services/`                   |
| `portal_permissions_test.ts`    | `security/`                   |
| `tool_registry_test.ts`         | `tools/`                      |
| ...                             | ...                           |

### Phase 3: Documentation (Low Priority)

1. Add `tests/README.md` explaining:
   - Folder structure and responsibilities
   - How to write tests
   - Common patterns
   - Helper usage guide

2. Add module docblocks to helper files clarifying their purpose

---

## Guidelines for Test Organization

### What Goes Where

| Location              | Purpose                       | Examples                                           |
| --------------------- | ----------------------------- | -------------------------------------------------- |
| `helpers/`            | **Utilities only** - NO tests | `db.ts`, `config.ts`, `test_helpers.ts`            |
| `fixtures/`           | **Test data builders**        | `memory_builder.ts`, `test_environment_factory.ts` |
| `config/`             | **Test configuration**        | `constants.ts`                                     |
| `types/`              | **Type-level tests only**     | Compile-time contract verification                 |
| `services/`           | **Service layer unit tests**  | `agent_executor_test.ts`, `memory_bank_test.ts`    |
| `repositories/`       | **Repository pattern tests**  | `activity_repository_test.ts`                      |
| `integration/`        | **Multi-component tests**     | `memory_integration_test.ts`                       |
| `scenario_framework/` | **E2E scenarios**             | Full workflow scenarios                            |

### Naming Conventions

- **Unit tests**: `<module>_test.ts`
- **Integration tests**: `<feature>_integration_test.ts`
- **Regression tests**: `<issue>_regression_test.ts`
- **Type tests**: `<feature>_type_test.ts`
- **Helpers**: `<purpose>_helper.ts` or `<purpose>.ts`

---

## Benefits

1. **Clearer separation of concerns** - Helpers vs tests
2. **Easier discovery** - Tests organized by domain
3. **Reduced clutter** - Fewer root-level files
4. **Better documentation** - Structure explains itself
5. **Consistent patterns** - Clear guidelines for new tests

---

## Implementation Priority

| Priority  | Task                                 | Effort | Impact |
| --------- | ------------------------------------ | ------ | ------ |
| 🔴 High   | Merge `utils/` into `helpers/`       | Low    | Medium |
| 🔴 High   | Move `test_helpers.ts` to `helpers/` | Medium | High   |
| 🟡 Medium | Organize root-level tests            | High   | High   |
| 🟢 Low    | Add `tests/README.md`                | Low    | Medium |
| 🟢 Low    | Merge `infra/`                       | Low    | Low    |
