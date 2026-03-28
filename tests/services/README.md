# Services Tests

This directory contains unit and integration tests for the Exaix service layer.

## Structure

Tests are organized by **domain** to improve discoverability and maintainability. Each subfolder contains tests for a specific service or related group of services.

```
tests/services/
├── request/          # Request processing and routing
├── memory/           # Memory bank and extraction
├── agent/            # Agent executor and capabilities
├── plan/             # Plan execution and adapters
├── portal/           # Portal services and knowledge
├── tool/             # Tool registry and execution
├── health/           # Health check services
├── notification/     # Notification services
├── git/              # Git service operations
├── execution/        # Execution loop and context
├── context/          # Context loading and cards
├── reflexive/        # Reflexive agent (self-critique)
├── structured/       # Structured logging
├── status/           # Status management
├── review/           # Review registry
├── event/            # Event logging
├── deploy/           # Deployment services
├── skills/           # Skills service
├── database/         # Database connection and journal
├── ai/               # AI utilities (circuit breaker, cost tracker, etc.)
├── archive/          # Archive service
├── artifact/         # Artifact registry
├── blueprint/        # Blueprint loader
├── code/             # Code parser
├── parser/           # General parsing utilities
├── confidence/       # Confidence scoring
├── criteria/         # Criteria generation
├── flow/             # Flow reporter
├── graceful/         # Graceful shutdown
├── mission/          # Mission reporter
├── mock/             # Mock execution patterns
├── path/             # Path resolver
├── rebuild/          # Index rebuilding
├── subject/          # Subject propagation
├── token/            # Token usage tracking
├── watcher/          # File watcher
├── workspace/        # Workspace execution context
├── audit/            # Audit logging
├── repro/            # Reproduction scripts
├── helpers/          # Shared test helpers (NO tests here)
└── helpers.ts        # Shared test utilities
```

---

## Folder Responsibilities

### Core Services

| Folder     | Tests For                             | Example Files                                                  |
| ---------- | ------------------------------------- | -------------------------------------------------------------- |
| `request/` | Request processing, routing, analysis | `request_processor_test.ts`, `request_router_test.ts`          |
| `memory/`  | Memory bank, extraction, embedding    | `memory_bank_test.ts`, `memory_extractor_test.ts`              |
| `agent/`   | Agent executor, capabilities          | `agent_executor_test.ts`, `agent_capability_test.ts`           |
| `plan/`    | Plan execution, adapters, writers     | `plan_executor_test.ts`, `plan_writer_test.ts`                 |
| `portal/`  | Portal services, knowledge management | `portal_service_test.ts`, `portal_context_grounding_test.ts`   |
| `tool/`    | Tool registry, MCP tools              | `tool_registry_test.ts`, `tool_registry_portal_access_test.ts` |

### Infrastructure Services

| Folder          | Tests For                              | Example Files                                                   |
| --------------- | -------------------------------------- | --------------------------------------------------------------- |
| `health/`       | Health check service                   | `health_check_service_test.ts`, `health_check_timeouts_test.ts` |
| `notification/` | Notification delivery                  | `notification_test.ts`, `notification_sqlite_test.ts`           |
| `git/`          | Git operations                         | `git_service_test.ts`, `git_service_worktree_prune_test.ts`     |
| `database/`     | Database connections, activity journal | `database_connection_pool_test.ts`, `db_journal_test.ts`        |
| `event/`        | Event logging                          | `event_logger_test.ts`, `event_logger_identity_fields_test.ts`  |
| `structured/`   | Structured logging                     | `structured_logger_test.ts`                                     |
| `audit/`        | Audit logging                          | `audit_logger_test.ts`                                          |

### Execution & Context

| Folder       | Tests For                   | Example Files                                                        |
| ------------ | --------------------------- | -------------------------------------------------------------------- |
| `execution/` | Execution loop              | `execution_loop_test.ts`, `execution_loop_portal_regression_test.ts` |
| `context/`   | Context loading, cards      | `context_loader_test.ts`, `context_card_test.ts`                     |
| `workspace/` | Workspace execution context | `workspace_execution_context_test.ts`                                |
| `skills/`    | Skills service              | `skills_test.ts`, `session_memory_test.ts`                           |
| `status/`    | Status management           | `status_manager_test.ts`                                             |

### Advanced Features

| Folder        | Tests For                       | Example Files                                                 |
| ------------- | ------------------------------- | ------------------------------------------------------------- |
| `reflexive/`  | Reflexive agent (self-critique) | `reflexive_agent_test.ts`, `reflexive_agent_criteria_test.ts` |
| `review/`     | Review registry                 | `review_registry_test.ts`, `review_registry_portal_test.ts`   |
| `confidence/` | Confidence scoring              | `confidence_scorer_test.ts`                                   |
| `criteria/`   | Criteria generation             | `criteria_generator_test.ts`                                  |
| `flow/`       | Flow reporter                   | `flow_reporter_test.ts`                                       |

### Utilities & Helpers

| Folder      | Tests For         | Example Files                                                             |
| ----------- | ----------------- | ------------------------------------------------------------------------- |
| `ai/`       | AI utilities      | `circuit_breaker_test.ts`, `cost_tracker_test.ts`, `retry_policy_test.ts` |
| `parser/`   | Parsing utilities | `complexity_fallback_test.ts`                                             |
| `code/`     | Code parsing      | `code_parser_test.ts`                                                     |
| `path/`     | Path resolution   | `path_resolver_test.ts`                                                   |
| `deploy/`   | Deployment        | `deploy_test.ts`, `deploy_workspace_test.ts`                              |
| `graceful/` | Graceful shutdown | `graceful_shutdown_test.ts`                                               |
| `mock/`     | Mock patterns     | `mock_execution_pattern_regression_test.ts`                               |
| `token/`    | Token tracking    | `token_usage_tracking_regression_test.ts`                                 |
| `watcher/`  | File watching     | `watcher_test.ts`                                                         |

### Registry & Archive

| Folder       | Tests For         | Example Files               |
| ------------ | ----------------- | --------------------------- |
| `archive/`   | Archive service   | `archive_service_test.ts`   |
| `artifact/`  | Artifact registry | `artifact_registry_test.ts` |
| `blueprint/` | Blueprint loader  | `blueprint_loader_test.ts`  |
| `mission/`   | Mission reporter  | `mission_reporter_test.ts`  |
| `rebuild/`   | Index rebuilding  | `rebuild_index_test.ts`     |

### Other

| Folder     | Tests For                             | Example Files                                           |
| ---------- | ------------------------------------- | ------------------------------------------------------- |
| `subject/` | Subject propagation                   | `subject_propagation_test.ts`                           |
| `repro/`   | Reproduction scripts                  | `repro_zombie_plan_lifecycle.ts`                        |
| `helpers/` | **Test helpers only** - NO test files | `memory_test_helpers.ts`, `memory_bank_test_helpers.ts` |

---

## Where to Put New Tests

### Decision Tree

```
What are you testing?
│
├─→ Request processing/routing?
│   └─→ tests/services/request/
│
├─→ Memory bank or extraction?
│   └─→ tests/services/memory/
│
├─→ Agent executor or capabilities?
│   └─→ tests/services/agent/
│
├─→ Plan execution or writing?
│   └─→ tests/services/plan/
│
├─→ Portal or knowledge management?
│   └─→ tests/services/portal/
│
├─→ Tool registry or MCP tools?
│   └─→ tests/services/tool/
│
├─→ Health checks?
│   └─→ tests/services/health/
│
├─→ Notifications?
│   └─→ tests/services/notification/
│
├─→ Git operations?
│   └─→ tests/services/git/
│
├─→ Database or activity journal?
│   └─→ tests/services/database/
│
├─→ Logging (event, structured, audit)?
│   ├── Event logging → tests/services/event/
│   ├── Structured logging → tests/services/structured/
│   └─→ Audit logging → tests/services/audit/
│
├─→ Execution loop or context?
│   ├── Execution loop → tests/services/execution/
│   ├── Context loading → tests/services/context/
│   └─→ Workspace context → tests/services/workspace/
│
├─→ Reflexive agent (self-critique)?
│   └─→ tests/services/reflexive/
│
├─→ Review registry?
│   └─→ tests/services/review/
│
├─→ Skills or sessions?
│   └─→ tests/services/skills/
│
├─→ Status management?
│   └─→ tests/services/status/
│
├─→ AI utilities (circuit breaker, retry, cost)?
│   └─→ tests/services/ai/
│
├─→ Archive, artifact, blueprint, mission?
│   ├── Archive → tests/services/archive/
│   ├── Artifact → tests/services/artifact/
│   ├── Blueprint → tests/services/blueprint/
│   └─→ Mission → tests/services/mission/
│
├─→ Parser or code analysis?
│   ├── Code parsing → tests/services/code/
│   └─→ General parsing → tests/services/parser/
│
├─→ Deployment or path resolution?
│   ├── Deployment → tests/services/deploy/
│   └─→ Path resolution → tests/services/path/
│
├─→ File watching?
│   └─→ tests/services/watcher/
│
└─→ Something else?
    ├── Check if similar tests exist in another folder
    └─→ Create new subfolder if domain is distinct
```

### Examples

**Example 1: New Request Validator**

```
Testing: Request validation logic
Decision: Related to request processing
Location: tests/services/request/request_validator_test.ts
```

**Example 2: New Memory Embedding Service**

```
Testing: Memory embedding generation
Decision: Related to memory bank
Location: tests/services/memory/memory_embedding_service_test.ts
```

**Example 3: New Health Check Provider**

```
Testing: Custom health check provider
Decision: Related to health checks
Location: tests/services/health/health_check_custom_provider_test.ts
```

**Example 4: New Tool Registry Feature**

```
Testing: Tool discovery mechanism
Decision: Related to tool registry
Location: tests/services/tool/tool_discovery_test.ts
```

---

## Writing Tests

### Standard Patterns

#### Database Tests

```typescript
import { initTestDbService } from "../../helpers/db.ts";

Deno.test("MyService: does something with database", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const service = new MyService(db);
    // Your test code here
  } finally {
    await cleanup();
  }
});
```

#### Service Tests with Mocks

```typescript
import { createStubConfig, createStubDb } from "../../helpers/test_helpers.ts";

Deno.test("MyService: handles edge case", async () => {
  const mockConfig = createStubConfig();
  const mockDb = createStubDb();

  const service = new MyService(mockConfig, mockDb);
  const result = await service.doWork();

  assertEquals(result, expected);
});
```

#### Using Shared Helpers

```typescript
import { createTestMemoryBank } from "../helpers/memory_bank_test_helpers.ts";

Deno.test("MyService: works with memory", async () => {
  const { db, memoryBank, cleanup } = await createTestMemoryBank();
  try {
    // Your test code using pre-configured memoryBank
  } finally {
    await cleanup();
  }
});
```

### Import Paths

When writing tests in subfolders, use these relative import patterns:

```typescript
// Import from tests/helpers/
import { initTestDbService } from "../../helpers/db.ts";
import { createStubConfig } from "../../helpers/config.ts";

// Import from tests/services/helpers/
import { createTestMemoryBank } from "../helpers/memory_bank_test_helpers.ts";

// Import from src/
import { MyService } from "../../../src/services/my_service.ts";
import { Config } from "../../../src/shared/schemas/config.ts";
```

---

## Running Tests

```bash
# All services tests
deno test --allow-all tests/services/

# Specific subfolder
deno test --allow-all tests/services/request/

# Specific file
deno test --allow-all tests/services/agent/agent_executor_test.ts

# Filter by name
deno test --allow-all tests/services/ --filter "AgentExecutor"
```

---

## See Also

- [tests/README.md](../README.md) - Overall test directory structure
- [tests/REFACTORING_PLAN.md](../REFACTORING_PLAN.md) - Test folder refactoring plan
- [tests/helpers/](../helpers/) - Shared test utilities
