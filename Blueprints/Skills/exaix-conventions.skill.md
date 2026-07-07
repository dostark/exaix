---
id: "550e8400-e29b-41d4-a716-446655440008"
created_at: "2026-01-05T00:00:00.000Z"
source: "user"
scope: "project"
project: "Exaix"
status: "active"
skill_id: "exaix-conventions"
name: "Exaix Development Conventions"
version: "1.0.0"
description: "Exaix-specific patterns, conventions, and best practices"

triggers:
  keywords:
    - exaix
    - agent
    - flow
    - blueprint
    - portal
    - memory
    - activity
  task_types:
    - feature
    - bugfix
    - refactor
  file_patterns:
    - "packages/**/*.ts"
    - "apps/**/*.ts"
    - "tests/**/*.ts"
  tags:
    - exaix
    - conventions

constraints:
  - "Use existing patterns from the codebase"
  - "Follow the service-based architecture"
  - "Maintain schema-first approach with Zod"
  - "Write tests using Deno.test"

output_requirements:
  - "Follows Exaix architectural patterns"
  - "Uses initTestDbService() for test databases"
  - "Includes proper Activity Journal logging"

quality_criteria:
  - name: "Pattern Consistency"
    description: "Code follows established Exaix patterns"
    weight: 40
  - name: "Test Coverage"
    description: "New code has tests"
    weight: 35
  - name: "Schema Validation"
    description: "Uses Zod schemas for validation"
    weight: 25

compatible_with:
  agents:
    - "*"

usage_count: 0
---

# Exaix Development Conventions

Follow these Exaix-specific patterns and conventions:

## 1. Project Structure

````text
packages/
├── core/src/        # Config, parsing, shared utilities
├── schemas/src/     # Zod schemas for all data types
├── ai/src/          # LLM provider implementations
├── mcp/src/         # MCP protocol and tool handlers
├── tui/src/         # TUI base components
├── flow/src/        # Flow orchestration
└── cli/src/         # CLI base utilities

apps/
├── daemon/          # Main runtime entry point
├── exactl/src/      # exactl CLI commands
└── tui/src/         # Concrete TUI views

tests/               # Cross-cutting integration/scenario/security tests
packages/testing/    # Shared test helpers (initTestDbService, fixtures)

Blueprints/          # Agent and Flow definitions
├── Identities/      # Identity blueprints (YAML frontmatter + persona)
├── Skills/          # Skill definitions (*.skill.md → Memory/Skills JSON)
└── Flows/           # Flow definitions

Memory/              # Memory Banks
├── Projects/        # Project-specific memory
├── Execution/       # Execution history
├── Global/          # Cross-project learnings
└── Skills/          # Procedural memory (skills)
```text

## 2. Service Pattern

Services are the core building blocks:

```typescript
// packages/core/src/services/example.ts

import { z } from "zod";
import type { Config } from "../config/schema.ts";
import type { DatabaseService } from "./db.ts";

// Define schema for service data
export const ExampleSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  // ...
});

export type Example = z.infer<typeof ExampleSchema>;

/**
 * ExampleService - Description of what it does
 *
 * Handles:
 * - Thing 1
 * - Thing 2
 */
export class ExampleService {
  constructor(
    private config: Config,
    private db: DatabaseService,
  ) {}

  /**
   * Get example by ID
   */
  async getById(id: string): Promise<Example | null> {
    // Implementation
  }

  /**
   * Log activity for auditing
   */
  private logActivity(event: {
    event_type: string;
    target: string;
    metadata?: Record<string, unknown>;
  }): void {
    this.db.logActivity(
      "system",
      event.event_type,
      event.target,
      event.metadata || {},
    );
  }
}
```text

## 3. Test Patterns

Use Deno.test with initTestDbService():

```typescript
// tests/services/example_test.ts

import { assertEquals, assertExists } from "@std/assert";
import { initTestDbService } from "@exaix/testing";
import { ExampleService } from "@exaix/core";

Deno.test("ExampleService", async (t) => {
  // Setup test database
  const db = initTestDbService();
  const config = {/* test config */};
  const service = new ExampleService(config, db);

  await t.step("getById returns null for missing ID", async () => {
    const result = await service.getById("nonexistent");
    assertEquals(result, null);
  });

  await t.step("getById returns example when found", async () => {
    // Setup test data
    const created = await service.create({ name: "Test" });

    const result = await service.getById(created.id);
    assertExists(result);
    assertEquals(result.name, "Test");
  });
});
```text

## 4. Schema-First Design

Define schemas before implementation:

```typescript
// packages/schemas/src/example.ts

import { z } from "zod";

/**
 * Example input schema - used for creation
 */
export const ExampleInputSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
});

/**
 * Example schema - includes generated fields
 */
export const ExampleSchema = ExampleInputSchema.extend({
  id: z.string().uuid(),
  created_at: z.string().datetime(),
});

// Export types
export type ExampleInput = z.infer<typeof ExampleInputSchema>;
export type Example = z.infer<typeof ExampleSchema>;
```text

## 5. Activity Journal Integration

Log significant events:

```typescript
// Event types follow pattern: category.entity.action
const EVENT_TYPES = {
  // Memory events
  "memory.project.created": "Project memory created",
  "memory.learning.approved": "Learning approved",

  // Flow events
  "flow.started": "Flow execution started",
  "flow.completed": "Flow execution completed",

  // Agent events
  "agent.invoked": "Agent was invoked",
  "agent.completed": "Agent completed execution",
};
```text

## 6. Flow Definitions

Define flows in Blueprints/Flows/:

```typescript
// Blueprints/Flows/example.flow.yaml

import { defineFlow } from "@exaix/flow";

export default defineFlow({
  id: "example-flow",
  name: "Example Flow",
  description: "Does something useful",
  version: "1.0.0",

  steps: [
    {
      id: "step-1",
      agent: "analyzer",
      task: "Analyze the request",
    },
    {
      id: "step-2",
      agent: "implementer",
      task: "Implement the solution",
      dependsOn: ["step-1"],
    },
  ],
});
```text

## 7. Configuration

Settings are managed through the Config DB. Use `exactl config set`:

```bash
exactl config set skills.enabled true
exactl config set skills.auto_match true
exactl config set skills.max_per_request 5
```

Run `exactl config --help` for all subcommands.
The sample bootstrap config lives at `templates/exa.config.sample.toml` (only `system.root`).

## 8. Common Imports

```typescript
// Standard library
import { join } from "@std/path";
import { ensureDir, exists } from "@std/fs";

// Testing
import { assertEquals, assertExists, assertRejects } from "jsr:@std/assert@1";

// Validation
import { z } from "zod";

// Exaix internal
import type { Config } from "@exaix/core/config/schema.ts";
import type { DatabaseService } from "@exaix/core";
```text

## 9. Error Handling

Use typed errors:

```typescript
export class ExaixError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
    this.name = "ExaixError";
  }
}

export class FlowExecutionError extends ExaixError {
  constructor(flowId: string, stepId: string, cause: Error) {
    super(
      `Flow ${flowId} failed at step ${stepId}: ${cause.message}`,
      "FLOW_EXECUTION_ERROR",
    );
  }
}
```text
````
