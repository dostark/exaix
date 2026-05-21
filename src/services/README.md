# Exaix Services Directory

This directory contains all service layer components for the Exaix project. Services encapsulate business logic and coordinate between repositories, tools, and external systems.

## Quick Start

```bash
# Type check services
deno check src/services/

# Run service tests
deno test --allow-all tests/services/

# Find service usage
grep -r "from.*services/" src/
```

---

## Directory Structure

```text
src/services/
├── core/                   # Core infrastructure services
│   ├── db.ts                         # Database service with SQLite
│   ├── database_connection_pool.ts   # Connection pooling for SQLite
│   ├── event_logger.ts               # Event logging for audit trail
│   ├── audit_logger.ts               # Security audit logging
│   ├── health_check_service.ts       # Health monitoring
│   ├── graceful_shutdown.ts          # Graceful shutdown handling
│   ├── retry_policy.ts               # Retry policies for operations
│   ├── git_service.ts                # Git operations service
│   └── mod.ts                        # Barrel export
│
├── agent/                  # Agent execution and orchestration
│   ├── agent_executor.ts             # Agent execution with context
│   ├── agent_runner.ts               # Agent lifecycle management
│   ├── reflexive_agent.ts            # Self-improving agent
│   ├── execution_loop.ts             # Main execution loop
│   └── mod.ts                        # Barrel export
│
├── plan/                   # Planning services
│   ├── plan.ts                       # Plan service CRUD
│   ├── plan_executor.ts              # Execute plan steps via MCP
│   ├── plan_writer.ts                # Generate plans from requests
│   ├── plan_adapter.ts               # Plan service adapter
│   ├── structured_plan_parser.ts     # Parse structured plans
│   └── mod.ts                        # Barrel export
│
├── tool/                   # Tool execution
│   ├── tool_registry.ts              # Tool registration and execution
│   ├── tool_reflector.ts             # Reflective tool execution
│   ├── output_validator.ts           # Validate tool output
│   └── mod.ts                        # Barrel export
│
├── blueprint/              # Blueprint and identity management
│   ├── blueprint_loader.ts           # Load blueprint YAML files
│   └── mod.ts                        # Barrel export
│
├── context/                # Context and knowledge generation
│   ├── context_card_generator.ts     # Generate context cards
│   ├── context_loader.ts             # Load context for requests
│   ├── prompt_budget_allocator.ts    # Budget-aware prompt allocation
│   └── mod.ts                        # Barrel export
│
├── skills/                 # Skills and capabilities
│   ├── skills.ts                     # Skills service
│   ├── criteria_generator.ts         # Generate evaluation criteria
│   └── mod.ts                        # Barrel export
│
├── cost/                   # Cost tracking
│   ├── cost_tracker.ts               # Track LLM token costs
│   └── mod.ts                        # Barrel export
│
├── notification/           # Notifications
│   ├── notification.ts               # User notification service
│   └── mod.ts                        # Barrel export
│
├── artifact/               # Artifacts and reviews
│   ├── artifact_registry.ts          # Code artifact tracking
│   ├── review_registry.ts            # Code review tracking
│   ├── mission_reporter.ts           # Mission completion reports
│   ├── archive_service.ts            # Archive management
│   └── mod.ts                        # Barrel export
│
├── flow/                   # Flow execution services
│   ├── flow_reporter.ts              # Flow execution reporting
│   ├── flow_validator.ts             # Flow validation
│   └── mod.ts                        # Barrel export
│
├── utils/                  # Utility services
│   ├── json_repair.ts                # Repair malformed JSON
│   ├── confidence_scorer.ts          # Score confidence levels
│   ├── watcher.ts                    # File system watcher
│   ├── tui_service_factory.ts        # TUI service factory
│   └── mod.ts                        # Barrel export
│
├── adapters/               # Service adapters for DI
├── middleware/             # Middleware pipeline
├── decorators/             # TypeScript decorators
└── quality_gate/           # Quality gate service
```

> **Note:** Several directories have been extracted into dedicated packages.
> Import from the package instead of `src/services/`. See [Migrated to packages](#migrated-to-packages) below.

---

## Folder Responsibilities

### Core Infrastructure

| Folder   | Purpose                 | Examples                                    |
| -------- | ----------------------- | ------------------------------------------- |
| `core/`  | **Core infrastructure** | Database, event logging, health checks, Git |
| `utils/` | **Utility services**    | JSON repair, file watching, TUI factory     |
| `flow/`  | **Flow services**       | Flow reporting, validation                  |

### Domain Services

| Folder          | Purpose                  | Examples                                          |
| --------------- | ------------------------ | ------------------------------------------------- |
| `agent/`        | **Agent orchestration**  | Agent execution, reflexive improvement            |
| `request/`      | **Request processing**   | Request CRUD, routing, processing                 |
| `plan/`         | **Planning services**    | Plan generation, execution, parsing               |
| `tool/`         | **Tool execution**       | Tool registry, reflection, validation             |
| `blueprint/`    | **Blueprint management** | Blueprint loading and validation                  |
| `context/`      | **Context generation**   | Context cards, context loading, budget allocation |
| `skills/`       | **Skills and criteria**  | Skills service, evaluation criteria               |
| `cost/`         | **Cost tracking**        | LLM token cost tracking                           |
| `notification/` | **Notifications**        | User notifications                                |
| `artifact/`     | **Artifact tracking**    | Code artifacts, reviews, mission reports          |

### Cross-Cutting Concerns

| Folder        | Purpose                     | Examples                    |
| ------------- | --------------------------- | --------------------------- |
| `adapters/`   | **Service adapters for DI** | Mock adapters for testing   |
| `middleware/` | **Middleware pipeline**     | Request/response middleware |
| `decorators/` | **TypeScript decorators**   | Logging decorators          |

### Specialized Submodules

| Folder                | Purpose                        |
| --------------------- | ------------------------------ |
| `portal_knowledge/`   | Portal knowledge analysis      |
| `quality_gate/`       | Quality gate and clarification |
| `request_analysis/`   | Request analysis engine        |
| `request_processing/` | Request processing types       |

---

## Migrated to packages

The following directories have been extracted into standalone packages and **no longer exist** under `src/services/`. Import from `@exaix/<package>` instead.

| Old path                                   | Package          | Import from          |
| ------------------------------------------ | ---------------- | -------------------- |
| `src/services/memory/`                     | `@exaix/memory`  | `@exaix/memory`      |
| `src/services/memory_bank/`                | `@exaix/memory`  | `@exaix/memory`      |
| `src/services/portal/`                     | `@exaix/portal`  | `@exaix/portal`      |
| `src/services/logger/`                     | `@exaix/core`    | `@exaix/core/logger` |
| `src/services/routing/`                    | `@exaix/routing` | `@exaix/routing`     |
| `src/services/context/token_counter.ts`    | `@exaix/core`    | `@exaix/core/func`   |
| `src/services/context/code_parser.ts`      | `@exaix/core`    | `@exaix/core/func`   |
| `src/services/context/prompt_context.ts`   | `@exaix/core`    | `@exaix/core/func`   |
| `src/services/agent/agent_capabilities.ts` | `@exaix/core`    | `@exaix/core/func`   |
| `src/services/agent/prompt_formatter.ts`   | `@exaix/core`    | `@exaix/core/func`   |
| `src/services/request/`                    | `@exaix/request` | `@exaix/request`     |
| `src/services/request_analysis/`           | `@exaix/request` | `@exaix/request`     |
| `src/services/request_processing/`         | `@exaix/request` | `@exaix/request`     |

---

## Packages vs. Services

Before adding code anywhere, decide which layer it belongs in. The distinction is architectural, not cosmetic.

### The core difference

| Dimension              | `packages/<name>/`                               | `src/services/<domain>/`                                      |
| ---------------------- | ------------------------------------------------ | ------------------------------------------------------------- |
| **What it owns**       | A self-contained domain capability               | Application-layer orchestration inside the Exaix process      |
| **Dependency profile** | No `src/` imports; only other packages or stdlib | Consumes packages, `Config`, `DatabaseService`, `EventLogger` |
| **Runtime coupling**   | None — could run in any Deno process             | Tightly coupled to daemon bootstrap and lifecycle             |
| **Test isolation**     | Tested with in-memory stubs and temp dirs only   | Tested with `initTestDbService()` and full service wiring     |
| **Import alias**       | `@exaix/<name>` — canonical, stable              | Relative or `src/` path — internal to the root app            |
| **Reusability**        | Usable by any consumer; publishable in principle | Only meaningful inside the Exaix daemon                       |
| **Role**               | Defines _how_ a domain concept works             | Decides _what_ happens and _when_ at runtime                  |

### The placement test

Ask one question: **Can an external consumer use this module without knowing the Exaix daemon exists?**

- **Yes** → it belongs in `packages/`.
- **No** → it belongs in `src/services/`.

### Signals that point to a package

- No `Config`, `DatabaseService`, or `EventLogger` in the constructor.
- Tests use only in-memory inputs — no database, no temp filesystem state wired through `initTestDbService`.
- The logic describes _what_ a domain object is or does (schema validation, embedding computation, parsing rules, Git operation, AI provider protocol) rather than _coordinating_ the application.
- Another package already imports it, or would need to for type correctness.
- The same code would be equally valid in a different application that has nothing to do with Exaix.

### Signals that point to `src/services/`

- The constructor receives a `DatabaseService` to persist state.
- Emitting events via `EventLogger` is part of the contract — the module produces audit trail entries as a side-effect.
- Runtime `Config` drives behaviour (paths, thresholds, feature flags).
- The module is _glue_: it wires two or more packages together into a coherent flow (receive a request, route it, persist the result, notify the user).
- It is registered in `src/main.ts` or `src/cli/init.ts` and would break daemon startup if removed.

### Practical examples

| Module                                 | Correct location       | Reason                                                            |
| -------------------------------------- | ---------------------- | ----------------------------------------------------------------- |
| Memory schema types and Zod validators | `@exaix/schemas`       | Pure domain contracts; no runtime coupling                        |
| Cosine similarity, embedding storage   | `@exaix/memory`        | Domain algorithm; only needs a temp dir to test                   |
| AI provider protocol (`ILLMProvider`)  | `@exaix/ai`            | Abstract contract; no Exaix-specific wiring                       |
| Request processing pipeline            | `src/services/request` | Wires `RequestAnalyzer`, `MemoryBankService`, `EventLogger`, etc. |
| `EventLogger` (writes to SQLite)       | `src/services/core`    | Owns the audit trail side-effect; depends on `DatabaseService`    |
| Cost tracker (per-request counters)    | `src/services/cost`    | Persists token counts to `DatabaseService` per daemon lifecycle   |

---

## Creating New Services

### 1. Choose the Right Location

**Ask yourself:**

1. **Does it belong in a package or a service?** (See [Packages vs. Services](#packages-vs-services) above.)

2. **What domain does this service belong to?**
   - Agent execution → `agent/`
   - Memory operations → `@exaix/memory` package (not `src/services/`)
   - Portal management → `@exaix/portal` package (not `src/services/`)
   - Request handling → `request/`
   - Infrastructure → `core/` or `utils/`
   - Flow execution → `flow/`

3. **Does it need to be a service?**
   - Coordinates multiple components? → Service
   - Simple utility function? → `utils/` or `helpers/`
   - Data access only? → Repository pattern (in `repositories/`)

4. **Does a similar service exist?**
   - Check existing folders for related services
   - Follow established patterns

### 2. Follow Service Patterns

#### Basic Service Structure

```typescript
/**
 * @module MyService
 * @path src/services/domain/my_service.ts
 * @description What this service does
 * @architectural-layer Services
 * @dependencies [Config, DatabaseService]
 * @related-files [src/domain/i_my_service.ts]
 */

import type { Config } from "../shared/schemas/config.ts";
import type { IDatabaseService } from "../core/db.ts";
import type { IMyService } from "../shared/interfaces/i_my_service.ts";

export class MyService implements IMyService {
  constructor(
    private readonly config: Config,
    private readonly db: IDatabaseService,
  ) {}

  async doWork(): Promise<void> {
    // Implementation
  }
}
```

#### Service with Dependencies

```typescript
import { EventLogger } from "../core/event_logger.ts";
import { ToolRegistry } from "../tool/tool_registry.ts";

export class MyService {
  constructor(
    private readonly eventLogger: EventLogger,
    private readonly toolRegistry: ToolRegistry,
  ) {}

  async execute(): Promise<void> {
    await this.eventLogger.log("my_service.started");
    await this.toolRegistry.execute("my_tool", {});
    await this.eventLogger.log("my_service.completed");
  }
}
```

### 3. Service Interfaces

For services used across modules, define interfaces in `src/shared/interfaces/`:

```typescript
// src/shared/interfaces/i_my_service.ts
export interface IMyService {
  doWork(): Promise<void>;
  getStatus(): Promise<string>;
}
```

### 4. Service Adapters

For testing, create adapters in `src/services/adapters/`:

```typescript
// src/services/adapters/my_service_adapter.ts
import type { IMyService } from "../../shared/interfaces/i_my_service.ts";

export class MyServiceAdapter implements IMyService {
  constructor(private readonly service: MyService) {}

  async doWork(): Promise<void> {
    return this.service.doWork();
  }

  async getStatus(): Promise<string> {
    return this.service.getStatus();
  }
}
```

### 5. Barrel Exports

Each domain folder has a `mod.ts` file for clean imports:

```typescript
// src/services/agent/mod.ts
export * from "./agent_executor.ts";
export * from "./agent_runner.ts";
export * from "./reflexive_agent.ts";
export * from "./execution_loop.ts";
```

---

## Import Conventions

### Within Services

```typescript
// ✅ DO: Use relative paths within same folder
import { EventLogger } from "./event_logger.ts";

// ✅ DO: Use folder prefix for cross-folder imports
import { ToolRegistry } from "../tool/tool_registry.ts";
import { EventLogger } from "../core/event_logger.ts";

// ✅ DO: Import memory-domain services from the package
import { MemoryBankService } from "@exaix/memory";

// ❌ DON'T: Omit .ts extension
import { EventLogger } from "./event_logger"; // Missing .ts

// ❌ DON'T: Use absolute paths
import { EventLogger } from "src/services/event_logger.ts";
```

### From Outside Services

```typescript
// ✅ DO: Import from specific service path
import { EventLogger } from "./services/core/event_logger.ts";
import { ToolRegistry } from "./services/tool/tool_registry.ts";

// ✅ DO: Use barrel exports for cleaner imports
import { DatabaseService, EventLogger } from "./services/core/mod.ts";
import { AgentExecutor, AgentRunner } from "./services/agent/mod.ts";

// ✅ DO: Import package-owned modules from their package
import { MemoryBankService, MemoryEmbeddingService } from "@exaix/memory";

// ✅ DO: Import interfaces from shared
import type { IMyService } from "./shared/interfaces/i_my_service.ts";

// ❌ DON'T: Import internal modules directly
import { InternalHelper } from "./services/memory/internal_helper.ts";
```

---

## Service Dependencies

### Dependency Injection

Services receive dependencies via constructor:

```typescript
export class RequestProcessor {
  constructor(
    private readonly config: Config,
    private readonly db: IDatabaseService,
    private readonly eventLogger: EventLogger,
    private readonly toolRegistry: ToolRegistry,
  ) {}
}
```

### Circular Dependencies

Avoid circular dependencies between services. If needed:

1. Extract shared logic to a third service
2. Use interfaces in `src/shared/interfaces/`
3. Use dependency injection at a higher level

---

## Testing Services

### Unit Tests

```typescript
// tests/services/my_service_test.ts
import { assertEquals } from "@std/assert";
import { MyService } from "../../src/services/domain/my_service.ts";
import { createStubConfig, createStubDb } from "../helpers/test_helpers.ts";

Deno.test("MyService: does work correctly", async () => {
  const mockConfig = createStubConfig();
  const mockDb = createStubDb();

  const service = new MyService(mockConfig, mockDb);
  await service.doWork();

  // Assert expectations
});
```

### Integration Tests

```typescript
// tests/services/my_service_integration_test.ts
import { initTestDbService } from "../helpers/db.ts";

Deno.test("MyService: integrates with database", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const { config } = await createTestConfig();
    const service = new MyService(config, db);

    const result = await service.doWork();
    assertEquals(result, expected);
  } finally {
    await cleanup();
  }
});
```

---

## Service Registration

Services are registered in `src/cli/init.ts`:

```typescript
import { EventLogger } from "../services/core/event_logger.ts";
import { ToolRegistry } from "../services/tool/tool_registry.ts";

export async function initializeServices(): Promise<ICliApplicationContext> {
  const eventLogger = new EventLogger(db);
  const toolRegistry = new ToolRegistry({ config, db });

  return {
    db,
    config,
    eventLogger,
    toolRegistry,
    // ... other services
  };
}
```

---

## Phase 60: Service Refactoring

This folder structure was established in Phase 60 to improve:

1. **Discoverability** - Services organized by domain
2. **Maintainability** - Clear separation of concerns
3. **Testability** - Consistent patterns for mocking
4. **Scalability** - Easy to add new domains

### Migration Guide

If you have imports that broke after refactoring:

```typescript
// Old import
import { EventLogger } from "./services/event_logger.ts";

// New import
import { EventLogger } from "./services/core/event_logger.ts";

// Or use barrel export
import { EventLogger } from "./services/core/mod.ts";
```

Use your IDE's "Find References" to update all imports.

### Common Import Migrations

| Old Path                           | New Path                                   |
| ---------------------------------- | ------------------------------------------ |
| `./services/db.ts`                 | `./services/core/db.ts`                    |
| `./services/event_logger.ts`       | `./services/core/event_logger.ts`          |
| `./services/agent_executor.ts`     | `./services/agent/agent_executor.ts`       |
| `./services/memory_bank.ts`        | `@exaix/memory` (package)                  |
| `./services/memory/memory_bank.ts` | `@exaix/memory` (package)                  |
| `./services/request.ts`            | `@exaix/request` (package)                 |
| `./services/plan.ts`               | `./services/plan/plan.ts`                  |
| `./services/portal.ts`             | `./services/portal/portal.ts`              |
| `./services/tool_registry.ts`      | `./services/tool/tool_registry.ts`         |
| `./services/blueprint_loader.ts`   | `./services/blueprint/blueprint_loader.ts` |
| `./services/skills.ts`             | `./services/skills/skills.ts`              |
| `./services/cost_tracker.ts`       | `./services/cost/cost_tracker.ts`          |
| `./services/notification.ts`       | `./services/notification/notification.ts`  |
| `./services/artifact_registry.ts`  | `./services/artifact/artifact_registry.ts` |
| `./services/structured_logger.ts`  | `@exaix/core/logger` (package)             |
| `./services/flow_reporter.ts`      | `./services/flow/flow_reporter.ts`         |
| `./services/json_repair.ts`        | `./services/utils/json_repair.ts`          |

---

## See Also

- [CODE_STYLE.md](../CODE_STYLE.md) - General coding style
- [ARCHITECTURE.md](../ARCHITECTURE.md) - System architecture
- [tests/README.md](../tests/README.md) - Test organization
- [CONTRIBUTING.md](../CONTRIBUTING.md) - Contribution guidelines
