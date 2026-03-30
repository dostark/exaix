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

```
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
│   ├── agent_capabilities.ts         # Agent capability definitions
│   └── mod.ts                        # Barrel export
│
├── memory/                 # Memory services
│   ├── memory_bank.ts                # Project and global memory
│   ├── memory_extractor.ts           # Extract learnings from executions
│   ├── learning_extractor.ts         # Learning extraction utilities
│   ├── memory_embedding.ts           # Vector embeddings for memory
│   ├── memory_search.ts              # Search memory by content/embedding
│   ├── session_memory.ts             # Request session memory
│   └── mod.ts                        # Barrel export
│
├── request/                # Request processing
│   ├── request.ts                    # Request service CRUD
│   ├── request_processor.ts          # Main request processing pipeline
│   ├── request_router.ts             # Route requests to agents/flows
│   ├── request_common.ts             # Shared request types/utilities
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
├── portal/                 # Portal and workspace management
│   ├── portal.ts                     # Portal service CRUD
│   ├── portal_permissions.ts         # Portal access control
│   ├── path_resolver.ts              # Resolve portal/workspace paths
│   ├── workspace_execution_context.ts # Workspace execution context
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
│   ├── prompt_context.ts             # Build prompt context blocks
│   ├── code_parser.ts                # Parse code for context
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
├── logger/                 # Logging utilities
│   ├── structured_logger.ts          # Structured logging to files
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
├── memory_bank/            # Memory bank submodules
├── portal_knowledge/       # Portal knowledge service
├── quality_gate/           # Quality gate service
├── request_analysis/       # Request analysis service
└── request_processing/     # Request processing types
```

---

## Folder Responsibilities

### Core Infrastructure

| Folder    | Purpose                 | Examples                                    |
| --------- | ----------------------- | ------------------------------------------- |
| `core/`   | **Core infrastructure** | Database, event logging, health checks, Git |
| `logger/` | **Logging utilities**   | Structured file logging                     |
| `utils/`  | **Utility services**    | JSON repair, file watching, TUI factory     |
| `flow/`   | **Flow services**       | Flow reporting, validation                  |

### Domain Services

| Folder          | Purpose                  | Examples                                     |
| --------------- | ------------------------ | -------------------------------------------- |
| `agent/`        | **Agent orchestration**  | Agent execution, reflexive improvement       |
| `memory/`       | **Memory operations**    | Memory bank, embeddings, extraction, search  |
| `request/`      | **Request processing**   | Request CRUD, routing, processing            |
| `plan/`         | **Planning services**    | Plan generation, execution, parsing          |
| `portal/`       | **Portal management**    | Portal CRUD, permissions, path resolution    |
| `tool/`         | **Tool execution**       | Tool registry, reflection, validation        |
| `blueprint/`    | **Blueprint management** | Blueprint loading and validation             |
| `context/`      | **Context generation**   | Context cards, prompt building, code parsing |
| `skills/`       | **Skills and criteria**  | Skills service, evaluation criteria          |
| `cost/`         | **Cost tracking**        | LLM token cost tracking                      |
| `notification/` | **Notifications**        | User notifications                           |
| `artifact/`     | **Artifact tracking**    | Code artifacts, reviews, mission reports     |

### Cross-Cutting Concerns

| Folder        | Purpose                     | Examples                    |
| ------------- | --------------------------- | --------------------------- |
| `adapters/`   | **Service adapters for DI** | Mock adapters for testing   |
| `middleware/` | **Middleware pipeline**     | Request/response middleware |
| `decorators/` | **TypeScript decorators**   | Logging decorators          |

### Specialized Submodules

| Folder                | Purpose                        |
| --------------------- | ------------------------------ |
| `memory_bank/`        | Memory bank internal modules   |
| `portal_knowledge/`   | Portal knowledge analysis      |
| `quality_gate/`       | Quality gate and clarification |
| `request_analysis/`   | Request analysis engine        |
| `request_processing/` | Request processing types       |

---

## Creating New Services

### 1. Choose the Right Location

**Ask yourself:**

1. **What domain does this service belong to?**
   - Agent execution → `agent/`
   - Memory operations → `memory/`
   - Request handling → `request/`
   - Infrastructure → `core/` or `utils/`
   - Flow execution → `flow/`

2. **Does it need to be a service?**
   - Coordinates multiple components? → Service
   - Simple utility function? → `utils/` or `helpers/`
   - Data access only? → Repository pattern (in `repositories/`)

3. **Does a similar service exist?**
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
export * from "./agent_capabilities.ts";
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

| Old Path                          | New Path                                   |
| --------------------------------- | ------------------------------------------ |
| `./services/db.ts`                | `./services/core/db.ts`                    |
| `./services/event_logger.ts`      | `./services/core/event_logger.ts`          |
| `./services/agent_executor.ts`    | `./services/agent/agent_executor.ts`       |
| `./services/memory_bank.ts`       | `./services/memory/memory_bank.ts`         |
| `./services/request.ts`           | `./services/request/request.ts`            |
| `./services/plan.ts`              | `./services/plan/plan.ts`                  |
| `./services/portal.ts`            | `./services/portal/portal.ts`              |
| `./services/tool_registry.ts`     | `./services/tool/tool_registry.ts`         |
| `./services/blueprint_loader.ts`  | `./services/blueprint/blueprint_loader.ts` |
| `./services/skills.ts`            | `./services/skills/skills.ts`              |
| `./services/cost_tracker.ts`      | `./services/cost/cost_tracker.ts`          |
| `./services/notification.ts`      | `./services/notification/notification.ts`  |
| `./services/artifact_registry.ts` | `./services/artifact/artifact_registry.ts` |
| `./services/structured_logger.ts` | `./services/logger/structured_logger.ts`   |
| `./services/flow_reporter.ts`     | `./services/flow/flow_reporter.ts`         |
| `./services/json_repair.ts`       | `./services/utils/json_repair.ts`          |

---

## See Also

- [CODE_STYLE.md](../CODE_STYLE.md) - General coding style
- [ARCHITECTURE.md](../ARCHITECTURE.md) - System architecture
- [tests/README.md](../tests/README.md) - Test organization
- [CONTRIBUTING.md](../CONTRIBUTING.md) - Contribution guidelines
