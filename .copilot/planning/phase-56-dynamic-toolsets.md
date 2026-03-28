---
agent: claude
scope: dev
title: "Phase 56: Hybrid Dynamic Tool Selection for Flow Steps"
short_summary: "Introduce execution_mode: 'dynamic' as an opt-in per flow step, allowing the model to select tools from a pre-defined toolset at runtime (ReAct-style) while keeping declared-tool behavior as the default and preserving full Activity Journal auditability."
version: "1.0"
topics: ["flows", "tools", "dynamic-execution", "react", "blueprints", "schema", "auditability", "mcp"]
---

> [!NOTE]
> **Status: ⏳ Pending**
> This phase adds hybrid dynamic tool execution to Exaix flows. The current plan-and-execute model
> (ReWOO-style, tools committed during planning) is preserved as the default. A new `execution_mode: "dynamic"`
> opt-in at the step level allows the model to select tools from a step-scoped `permitted_tools` list at
> runtime, with read-only tools pre-approved and write tools continuing to require declared plan steps.
>
> **No breaking changes** — all existing flow YAML files continue to work unchanged.
>
> **Prerequisite:** Phase 53 (Identity rename) should be applied before this phase.

## Executive Summary

Exaix currently uses a Plan-and-Execute (ReWOO) model: tools are declared in the plan before human approval,
before the model has seen any tool output. This is maximally auditable but inflexible — exploratory tasks like
codebase analysis or dependency mapping are unnecessarily constrained by pre-committing to exact tool call
sequences.

This phase introduces **Option C (Hybrid)**: a per-step `execution_mode` field that unlocks ReAct-style
dynamic tool selection within a declared permission boundary (`permitted_tools`). Destructive write operations
remain fully declared and human-approved. Exploratory read operations gain genuine model-driven flexibility.

### **Design Principles**

- **No behavioral regression** — `execution_mode: "declared"` (default) is unchanged
- **Human approves boundaries, not sequences** — for dynamic steps, the plan shows the permitted toolset + step intent; the model decides the call sequence at runtime
- **Auditability preserved** — every actual tool call is still logged in the Activity Journal with `trace_id`, regardless of execution mode
- **Read/write distinction** — read-only tools (`read_file`, `list_directory`, `search_files`) are permitted in dynamic steps; write tools (`write_file`, `run_command`, `create_directory`) are disallowed in dynamic steps and require declared mode
- **Toolset authority lives in the blueprint** — the identity's `permitted_tools` frontmatter field defines the maximum set available for dynamic selection

---

## Goals

- [ ] Add `StepExecutionMode` enum: `declared` | `dynamic`
- [ ] Add `permitted_tools` and `execution_mode` fields to `FlowStepSchema`
- [ ] Add `permitted_tools` field to `BlueprintFrontmatterSchema`
- [ ] Add `READ_ONLY_TOOLS` and `WRITE_TOOLS` classification sets to `src/shared/constants.ts`
- [ ] Implement `DynamicStepExecutor` in `src/flows/dynamic_step_executor.ts`
- [ ] Update `FlowRunner` to dispatch dynamic vs. declared steps correctly
- [ ] Update `FlowLoader` to validate that dynamic steps do not list write tools in `permitted_tools`
- [ ] Add `exactl flow validate` warnings for dynamic steps referencing write tools
- [ ] Write unit tests for `DynamicStepExecutor` and schema validation
- [ ] Update `Blueprints/Flows/` examples with at least one dynamic step demo flow
- [ ] Update blueprint documentation (`Blueprints/README.md`)

---

## Current State Analysis

### Existing Tool Execution Model

**Current `FlowStepSchema` (relevant portion):**

```typescript
// src/shared/schemas/flow.ts
export const FlowStepSchema = z.object({
  id: z.string().min(1, "Step ID cannot be empty"),
  name: z.string().min(1, "Step name cannot be empty"),
  type: z.nativeEnum(FlowStepType).optional().default(FlowStepType.AGENT),
  identity: z.string().min(1, "Identity reference cannot be empty"),
  // ... no execution_mode, no permitted_tools
  skills: z.array(z.string()).optional(),
});
```text

**Current blueprint frontmatter (`BlueprintFrontmatterSchema`):**

```typescript
export const BlueprintFrontmatterSchema = z.object({
  agent_id: z.string()...,
  name: z.string()...,
  model: z.string()...,
  capabilities: z.array(z.string()).optional().default([]),
  default_skills: z.array(z.string()).optional(),
  // ... no permitted_tools
});
```text

**Existing `McpToolName` enum (already in `src/shared/enums.ts`):**

```typescript
export enum McpToolName {
  READ_FILE = "read_file",
  WRITE_FILE = "write_file",
  RUN_COMMAND = "run_command",
  LIST_DIRECTORY = "list_directory",
  SEARCH_FILES = "search_files",
  CREATE_DIRECTORY = "create_directory",
}
```text

This enum is the foundation for tool permission classification — no new tool names need to be invented.

### Execution Flow Today

```text
Plan generation → Human approval (reviews exact tools per step) → Flow execution (tools called as declared)
```text

### Target Execution Flow (Hybrid)

```text
Plan generation → Human approval (reviews toolset boundary for dynamic steps) → Flow execution:
  ├── declared steps: tools called exactly as planned (unchanged)
  └── dynamic steps: model selects from permitted_tools via ReAct loop until step objective met
```text

---

## Design: Option C Hybrid

### Step-Level `execution_mode`

```yaml

# Flow YAML — mixing declared and dynamic steps

  - id: write-output
    name: Write implementation file
    identity: senior-coder
    execution_mode: declared          # default — explicit tool commitment
    tools: [write_file]

  - id: explore-codebase
    name: Explore and analyze codebase structure
    identity: senior-coder
    execution_mode: dynamic           # opt-in — model selects at runtime
    permitted_tools:
      - read_file
      - list_directory
      - search_files
```text

### Read/Write Boundary

The distinction maps directly to the existing `PermissionAction` and `PortalOperation` enums already in the codebase:

| Tool | Category | Allowed in `dynamic` mode |
| ------------------ | --------- | ------------------------- |
| `read_file` | Read | ✅ Yes |
| `list_directory` | Read | ✅ Yes |
| `search_files` | Read | ✅ Yes |
| `write_file` | Write | ❌ No — declared only |
| `create_directory` | Write | ❌ No — declared only |
| `run_command` | Write | ❌ No — declared only |

### Blueprint `permitted_tools` (Identity-Level Default)

A blueprint can declare its default toolset, which becomes the fallback if a dynamic step omits `permitted_tools`:

```yaml

# Blueprints/Identities/senior-coder.md frontmatter

agent_id: senior-coder
name: Senior Coder
model: anthropic:claude-opus-4-5
capabilities: [code-generation, refactoring]
permitted_tools:
  - read_file
  - list_directory
  - search_files
  - write_file
default_skills: [typescript, deno]
***
```text

A dynamic step can **narrow** the blueprint's `permitted_tools` but not **expand** beyond it.

---

## Implementation Plan

### Task 1: Schema and Enum Updates

#### 1.1 — Add `StepExecutionMode` enum

**File:** `src/shared/enums.ts`

```typescript
/**
 * Execution mode for a flow step.
 * - DECLARED: tools are committed in the plan before execution (default, current behavior)
 * - DYNAMIC: model selects tools from permitted_tools at runtime (ReAct-style)
 */
export enum StepExecutionMode {
  DECLARED = "declared",
  DYNAMIC = "dynamic",
}
```

#### 1.2 — Update `FlowStepSchema`

**File:** `src/shared/schemas/flow.ts`

**✅ IMPLEMENTED** — `src/shared/schemas/flow.ts`, 8/8 tests passing

```typescript
import { StepExecutionMode, ... } from "../enums.ts";

export const FlowStepSchema = z.object({
  id: z.string().min(1, "Step ID cannot be empty"),
  name: z.string().min(1, "Step name cannot be empty"),
  type: z.nativeEnum(FlowStepType).optional().default(FlowStepType.AGENT),
  identity: z.string().min(1, "Identity reference cannot be empty"),
  /** Execution mode: declared (default) or dynamic (ReAct-style tool selection) */
  execution_mode: z.nativeEnum(StepExecutionMode)
    .optional()
    .default(StepExecutionMode.DECLARED),
  /**
   * For execution_mode: "dynamic" — the set of tools the model may select from at runtime.
   * Must be a subset of the identity's permitted_tools.
   * Only read-only tools are allowed (write tools require declared mode).
   */
  permitted_tools: z.array(z.nativeEnum(McpToolName)).optional(),
  // existing fields unchanged:
  dependsOn: z.array(z.string()).default([]),
  input: z.object({ ... }).default({}),
  condition: z.string().optional(),
  timeout: z.number().positive().optional(),
  retry: z.object({ ... }).default({}),
  evaluate: GateEvaluateSchema.optional(),
  loop: FeedbackLoopSchema.optional(),
  branches: z.array(BranchConditionSchema).optional(),
  default: z.string().optional(),
  consensus: ConsensusConfigSchema.optional(),
  skills: z.array(z.string()).optional(),
});
```text

#### 1.3 — Update `BlueprintFrontmatterSchema`

**File:** `src/shared/schemas/blueprint.ts`

```typescript
export const BlueprintFrontmatterSchema = z.object({
  agent_id: z.string()...,
  name: z.string()...,
  model: z.string()...,
  capabilities: z.array(z.string()).optional().default([]),
  created: z.string().datetime(),
  created_by: z.string(),
  version: z.string()...,
  description: z.string().optional(),
  default_skills: z.array(z.string()).optional(),
  /**
   * Tools this identity is permitted to use in dynamic execution steps.
   * Flow steps may narrow but not expand this set.
   * Omitting this field means the identity has no dynamic tool permissions.
   */
  permitted_tools: z.array(z.nativeEnum(McpToolName)).optional(),
});
```

#### 1.4 — Add Tool Classification Constants

**File:** `src/shared/constants.ts`

```typescript
import { McpToolName } from "./enums.ts";

/**
 * Read-only MCP tools — safe for dynamic step execution.
 * Model can call these freely within a dynamic step.
 */
export const READ_ONLY_TOOLS: ReadonlySet<McpToolName> = new Set([
  McpToolName.READ_FILE,
  McpToolName.LIST_DIRECTORY,
  McpToolName.SEARCH_FILES,
]);

/**
 * Write MCP tools — require declared execution_mode and human plan approval.
 * These tools CANNOT be listed in permitted_tools for a dynamic step.
 */
export const WRITE_TOOLS: ReadonlySet<McpToolName> = new Set([
  McpToolName.WRITE_FILE,
  McpToolName.RUN_COMMAND,
  McpToolName.CREATE_DIRECTORY,
]);
```

**Success Criteria:**

- [x] `StepExecutionMode` enum added to `src/shared/enums.ts`
- [x] `FlowStepSchema` includes `execution_mode` and `permitted_tools`
- [x] `BlueprintFrontmatterSchema` includes `permitted_tools`
- [x] `READ_ONLY_TOOLS` and `WRITE_TOOLS` constants added
- [x] TypeScript compilation succeeds

**Planned Tests:**

- ✅ Type-level tests: ensure all new schema fields are required/optional as intended.
- ✅ Unit test: verify that `StepExecutionMode` enum and constants are exported and used in schema.
- ✅ Unit test: parse valid/invalid `FlowStepSchema` objects (8/8 tests passing).
- ✅ Unit test: parse valid/invalid `BlueprintFrontmatterSchema` objects (5/5 tests passing).

**✅ IMPLEMENTED** — `src/shared/enums.ts`, `src/shared/constants.ts`, `src/shared/schemas/flow.ts`, `src/shared/schemas/blueprint.ts`, 18/18 tests passing (Task 1.1-1.4 complete)

---

### Task 2: Validation Layer

**File:** `src/flows/flow_loader.ts`

Add a post-parse validation step that enforces the read/write boundary:

```typescript
import { READ_ONLY_TOOLS, WRITE_TOOLS } from "../shared/constants.ts";
import { StepExecutionMode } from "../shared/enums.ts";

function validateDynamicStepTools(flow: IFlow): string[] {
  const errors: string[] = [];

  for (const step of flow.steps) {
    if (step.execution_mode !== StepExecutionMode.DYNAMIC) continue;
    if (!step.permitted_tools || step.permitted_tools.length === 0) continue;

    for (const tool of step.permitted_tools) {
      if (WRITE_TOOLS.has(tool)) {
        errors.push(
          `Step "${step.id}": tool "${tool}" is a write tool and cannot be ` +
          `used in execution_mode: "dynamic". Move to a declared step.`
        );
      }
    }
  }

  return errors;
}
```

Also validate that a dynamic step's `permitted_tools` is a subset of its referenced identity's `permitted_tools`:

```typescript
function validateToolsAgainstIdentity(
  step: IFlowStep,
  identityPermittedTools: McpToolName[]
): string[] {
  const errors: string[] = [];
  const identitySet = new Set(identityPermittedTools);

  for (const tool of step.permitted_tools ?? []) {
    if (!identitySet.has(tool)) {
      errors.push(
        `Step "${step.id}": tool "${tool}" is not in identity "${step.identity}" ` +
        `permitted_tools. Either add it to the identity blueprint or remove it from the step.`
      );
    }
  }

  return errors;
}
```

**Success Criteria:**

- [x] Flow YAML with write tool in dynamic step `permitted_tools` fails validation with a clear error message
- [ ] Flow YAML with tool not in identity's `permitted_tools` fails validation (deferred to Task 4 - requires BlueprintLoader)
- [x] Valid declared and dynamic steps both pass `exactl flow validate`

**Planned Tests:**

- ✅ Unit test: dynamic step with write tool in `permitted_tools` is rejected.
- ⏸️ Unit test: dynamic step with tool not in identity's `permitted_tools` is rejected (deferred).
- ✅ Unit test: valid declared and dynamic steps pass validation.

**✅ IMPLEMENTED** — `src/flows/flow_loader.ts`, `tests/flows/flow_loader_validation_test.ts`, 5/5 tests passing

---

### Task 3: Dynamic Step Executor

**File:** `src/flows/dynamic_step_executor.ts` (new file)

**✅ IMPLEMENTED** — `src/flows/dynamic_step_executor.ts`, `tests/flows/dynamic_step_executor_test.ts`, 5/5 tests passing

```typescript
/**
 * @module DynamicStepExecutor
 * @path src/flows/dynamic_step_executor.ts
 * @description Executes a flow step in dynamic mode: the model receives the step
 * objective and iteratively selects tools from permitted_tools via a ReAct loop
 * until the objective is satisfied or max_iterations is reached.
 * @architectural-layer Flows
 * @dependencies [mcp, activity_journal, shared/schemas/flow, shared/constants]
 * @related-files [src/flows/flow_runner.ts, src/shared/schemas/flow.ts]
 */

import type { IFlowStep } from "../shared/schemas/flow.ts";
import type { IBlueprintFrontmatter } from "../shared/schemas/blueprint.ts";
import { McpToolName, StepExecutionMode } from "../shared/enums.ts";
import { READ_ONLY_TOOLS } from "../shared/constants.ts";

export interface IDynamicStepResult {
  stepId: string;
  output: string;
  toolCallsLog: IDynamicToolCall[];
  iterations: number;
  completed: boolean;
}

export interface IDynamicToolCall {
  tool: McpToolName;
  args: Record<string, unknown>;
  result: string;
  timestamp: string;
}

export interface IDynamicStepExecutorOptions {
  /** Maximum ReAct iterations before the step is considered complete regardless */
  maxIterations?: number;
  /** Trace ID for Activity Journal correlation */
  traceId: string;
}

const DEFAULT_MAX_ITERATIONS = 10;

/**
 * Executes a single flow step in dynamic (ReAct) mode.
 * The model iteratively selects tools from step.permitted_tools,
 * observes results, and continues until the objective is met.
 *
 * Invariant: only tools in READ_ONLY_TOOLS may appear in permitted_tools.
 * This is enforced at load time by FlowLoader and validated here defensively.
 */
export class DynamicStepExecutor {
  constructor(
    private readonly mcpClient: IMcpClient,
    private readonly llmClient: ILlmClient,
    private readonly activityJournal: IActivityJournal,
  ) {}

  async execute(
    step: IFlowStep,
    identity: IBlueprintFrontmatter,
    input: string,
    opts: IDynamicStepExecutorOptions,
  ): Promise<IDynamicStepResult> {
    if (step.execution_mode !== StepExecutionMode.DYNAMIC) {
      throw new Error(
        `DynamicStepExecutor called on step "${step.id}" which is not in dynamic mode`,
      );
    }

    // Defensive: enforce read-only boundary at runtime even if loader validation passed
    const effectiveTools = this.resolvePermittedTools(step, identity);
    const toolCallsLog: IDynamicToolCall[] = [];

    let context = input;
    let iterations = 0;
    const maxIterations = step.timeout
      ? Math.min(DEFAULT_MAX_ITERATIONS, Math.floor(step.timeout / 1000))
      : DEFAULT_MAX_ITERATIONS;

    while (iterations < maxIterations) {
      iterations++;

      // ReAct: model reasons about what tool to call next (or declares done)
      const decision = await this.llmClient.reasonNextAction({
        identity,
        stepObjective: step.name,
        accumulatedContext: context,
        availableTools: effectiveTools,
        iteration: iterations,
        maxIterations,
      });

      if (decision.done) {
        // Model has declared the step objective is met
        await this.activityJournal.log({
          traceId: opts.traceId,
          stepId: step.id,
          event: "dynamic_step_completed",
          iterations,
          toolCallCount: toolCallsLog.length,
        });
        return {
          stepId: step.id,
          output: decision.output,
          toolCallsLog,
          iterations,
          completed: true,
        };
      }

      // Validate tool choice against permitted list (runtime guard)
      if (!effectiveTools.includes(decision.tool)) {
        throw new Error(
          `Dynamic step "${step.id}": model selected tool "${decision.tool}" ` +
          `which is not in permitted_tools. Permitted: [${effectiveTools.join(", ")}]`,
        );
      }

      // Execute the tool call
      const toolResult = await this.mcpClient.callTool(
        decision.tool,
        decision.args,
      );

      const call: IDynamicToolCall = {
        tool: decision.tool,
        args: decision.args,
        result: toolResult,
        timestamp: new Date().toISOString(),
      };
      toolCallsLog.push(call);

      // Journal every tool call for auditability (identical to declared mode)
      await this.activityJournal.log({
        traceId: opts.traceId,
        stepId: step.id,
        event: "dynamic_tool_call",
        tool: decision.tool,
        args: decision.args,
        resultSummary: toolResult.substring(0, 200),
        iteration: iterations,
      });

      // Feed observation back into context for next iteration
      context = this.appendObservation(context, decision.tool, toolResult);
    }

    // Max iterations reached — return with what we have
    await this.activityJournal.log({
      traceId: opts.traceId,
      stepId: step.id,
      event: "dynamic_step_max_iterations_reached",
      iterations,
      toolCallCount: toolCallsLog.length,
    });

    return {
      stepId: step.id,
      output: context,
      toolCallsLog,
      iterations,
      completed: false,
    };
  }

  /**
   * Resolves the effective permitted_tools for a step:
   * 1. Start with identity blueprint's permitted_tools
   * 2. Narrow to step's permitted_tools if specified
   * 3. Filter to READ_ONLY_TOOLS only (defensive runtime enforcement)
   */
  private resolvePermittedTools(
    step: IFlowStep,
    identity: IBlueprintFrontmatter,
  ): McpToolName[] {
    const identityTools = new Set(identity.permitted_tools ?? []);

    const stepTools = step.permitted_tools?.length
      ? step.permitted_tools
      : [...identityTools];

    return stepTools.filter((tool) => {
      const isAllowed = READ_ONLY_TOOLS.has(tool) && identityTools.has(tool);
      if (!isAllowed) {
        console.warn(
          `Dynamic step "${step.id}": tool "${tool}" filtered out at runtime ` +
          `(must be read-only and in identity permitted_tools)`,
        );
      }
      return isAllowed;
    });
  }

  private appendObservation(
    context: string,
    tool: McpToolName,
    result: string,
  ): string {
    return `${context}\n\n[Tool: ${tool}]\n${result}`;
  }
}
```

**Success Criteria:**

- [ ] `DynamicStepExecutor` class implements the ReAct loop with configurable `maxIterations`
- [ ] Every tool call is journaled via `activityJournal` with `traceId`, identical to declared mode
- [ ] Runtime write-tool guard throws before any disallowed tool call is made
- [ ] `resolvePermittedTools` correctly narrows step tools against identity's declaration
- [ ] `completed: false` is returned (not thrown) when `maxIterations` is reached

**Planned Tests:**

- Unit test: executor iterates until model declares done (see Task 7.3).
- Unit test: executor returns `completed: false` when max iterations reached.
- Unit test: executor throws if model selects tool outside permitted_tools.
- Unit test: all tool calls are journaled with correct traceId.
- Unit test: write tools in identity are filtered at runtime.

### Task 4: Update `FlowRunner` to Dispatch by Execution Mode

**File:** `src/flows/flow_runner.ts`

The `FlowRunner` currently processes all steps uniformly. Add execution mode dispatch:

```typescript
import { DynamicStepExecutor } from "./dynamic_step_executor.ts";
import { StepExecutionMode } from "../shared/enums.ts";

// In FlowRunner.executeStep():
private async executeStep(
  step: IFlowStep,
  input: string,
  traceId: string,
): Promise<string> {
  if (step.execution_mode === StepExecutionMode.DYNAMIC) {
    const identity = await this.blueprintLoader.load(step.identity);
    const result = await this.dynamicStepExecutor.execute(
      step,
      identity,
      input,
      { traceId },
    );
    return result.output;
  }

  // Existing declared-mode path — unchanged
  return this.executeDeclaredStep(step, input, traceId);
}
```

The `dynamicStepExecutor` is injected via the constructor, keeping `FlowRunner` testable.

**Success Criteria:**

- [ ] `FlowRunner` routes `execution_mode: "dynamic"` steps to `DynamicStepExecutor`
- [ ] `FlowRunner` routes `execution_mode: "declared"` (and default) steps through existing path unchanged
- [ ] No behavior change for any existing flow YAML without `execution_mode`

**Planned Tests:**

- Integration test: dynamic and declared steps are dispatched to correct executor.
- Regression test: legacy flows (no `execution_mode`) run unchanged.

***

### Task 5: Update `exactl flow validate` CLI Command

**File:** `src/cli/flow_commands.ts` (or equivalent)

Add validation warnings for common dynamic step mistakes:

```typescript
function validateFlowForCli(flow: IFlow): ICliValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const step of flow.steps) {
    if (step.execution_mode !== StepExecutionMode.DYNAMIC) continue;

    // Error: write tool in permitted_tools
    for (const tool of step.permitted_tools ?? []) {
      if (WRITE_TOOLS.has(tool)) {
        errors.push(
          `Step "${step.id}": "${tool}" is a write tool. ` +
          `Dynamic steps may only use read-only tools: [${[...READ_ONLY_TOOLS].join(", ")}]`,
        );
      }
    }

    // Warning: dynamic step with no permitted_tools (will fall back to identity toolset)
    if (!step.permitted_tools || step.permitted_tools.length === 0) {
      warnings.push(
        `Step "${step.id}": no permitted_tools specified. ` +
        `Will use identity "${step.identity}" permitted_tools at runtime. ` +
        `Consider declaring permitted_tools explicitly for clarity.`,
      );
    }

    // Warning: dynamic step with timeout not set (may iterate indefinitely)
    if (!step.timeout) {
      warnings.push(
        `Step "${step.id}": no timeout set for dynamic step. ` +
        `Default max_iterations (10) applies. Consider setting timeout_ms.`,
      );
    }
  }

  return { errors, warnings, valid: errors.length === 0 };
}
```

**CLI output example:**

```bash
$ exactl flow validate Blueprints/Flows/analyze-codebase.yaml

✅ Flow structure valid
⚠️  Warnings (1):
   Step "explore": no timeout set for dynamic step. Default max_iterations (10) applies.

$ exactl flow validate Blueprints/Flows/bad-dynamic.yaml

❌ Validation failed (1 error):
   Step "write-docs": "write_file" is a write tool. Dynamic steps may only use
   read-only tools: [read_file, list_directory, search_files]
```

**Success Criteria:**

- [ ] `exactl flow validate` outputs errors for write tools in dynamic `permitted_tools`
- [ ] `exactl flow validate` outputs warnings for missing `permitted_tools` and missing `timeout`
- [ ] Exit code 1 on errors, 0 on warnings-only

**Planned Tests:**

- CLI test: validation errors for write tools in dynamic steps.
- CLI test: warnings for missing permitted_tools and timeout.
- CLI test: exit code is correct for errors vs. warnings.

### Task 6: Example Flow YAML and Blueprint Updates

#### 6.1 — New example flow demonstrating hybrid mode

**File:** `Blueprints/Flows/analyze-codebase.yaml` (new)

```yaml
id: analyze-codebase
name: Analyze Codebase and Write Report
description: >
  Explores the codebase structure dynamically, then writes a structured
  analysis report. Exploration is dynamic (model-driven); writing is declared.
version: "1.0"
steps:
  - id: explore
    name: Explore codebase structure and gather context
    identity: senior-coder
    execution_mode: dynamic
    permitted_tools:
      - read_file
      - list_directory
      - search_files
    timeout: 120000  # 2 minutes max for exploration
    skills: [typescript, architecture-review]

  - id: write-report
    name: Write analysis report
    identity: senior-coder
    execution_mode: declared
    tools: [write_file]
    dependsOn: [explore]
    input:
      source: step
      stepId: explore

output:
  from: write-report
  format: markdown
settings:
  maxParallelism: 1
  failFast: true
```

#### 6.2 — Updated identity blueprint with `permitted_tools`

**File:** `Blueprints/Identities/senior-coder.md` (update frontmatter)

```yaml
---
agent_id: senior-coder
name: Senior Coder
model: anthropic:claude-opus-4-5
capabilities: [code-generation, refactoring, architecture-review]
permitted_tools:
  - read_file
  - list_directory
  - search_files
default_skills: [typescript, deno]
---
```

**Success Criteria:**

- [ ] `analyze-codebase.yaml` passes `exactl flow validate` with no errors
- [ ] Example clearly demonstrates the declared/dynamic hybrid pattern
- [ ] `senior-coder` blueprint has `permitted_tools` in frontmatter

**Planned Tests:**

- Example flow is validated in CI and passes with no errors.
- Example blueprint is parsed and used in a test flow.

### Task 7: Tests

#### 7.1 — Schema validation tests

**File:** `tests/shared/schemas/flow_dynamic_test.ts` (new)

```typescript
// Dynamic step with valid read-only tools — should pass
it("accepts dynamic step with read-only permitted_tools", () => {
  const result = FlowStepSchema.safeParse({
    id: "s1",
    name: "Explore",
    identity: "senior-coder",
    execution_mode: "dynamic",
    permitted_tools: ["read_file", "list_directory"],
  });
  expect(result.success).toBe(true);
});

// Dynamic step schema does NOT enforce read/write boundary — that is FlowLoader's job
// (Zod only validates types, not business rules)
it("defaults execution_mode to declared when omitted", () => {
  const result = FlowStepSchema.safeParse({
    id: "s1",
    name: "Write file",
    identity: "senior-coder",
  });
  expect(result.success).toBe(true);
  expect(result.data?.execution_mode).toBe("declared");
});

// Negative: invalid execution_mode value
it("rejects unknown execution_mode value", () => {
  const result = FlowStepSchema.safeParse({
    id: "s1",
    name: "Step",
    identity: "senior-coder",
    execution_mode: "reactive", // not a valid enum value
  });
  expect(result.success).toBe(false);
});
```

#### 7.2 — FlowLoader validation tests

**File:** `tests/flows/flow_loader_dynamic_test.ts` (new)

```typescript
it("rejects dynamic step with write tool in permitted_tools", async () => {
  const flow = buildTestFlow({
    steps: [{
      id: "s1",
      name: "Bad step",
      identity: "test-identity",
      execution_mode: "dynamic",
      permitted_tools: ["write_file"],  // ❌ write tool in dynamic step
    }],
  });
  const errors = validateDynamicStepTools(flow);
  expect(errors).toHaveLength(1);
  expect(errors).toContain('"write_file" is a write tool');
});

it("rejects dynamic step with run_command in permitted_tools", async () => {
  const flow = buildTestFlow({
    steps: [{
      id: "s1",
      name: "Bad step",
      identity: "test-identity",
      execution_mode: "dynamic",
      permitted_tools: ["read_file", "run_command"],  // ❌ mixed
    }],
  });
  const errors = validateDynamicStepTools(flow);
  expect(errors).toHaveLength(1);
  expect(errors).toContain('"run_command" is a write tool');
});

it("accepts dynamic step with read-only permitted_tools", async () => {
  const flow = buildTestFlow({
    steps: [{
      id: "s1",
      name: "Explore",
      identity: "test-identity",
      execution_mode: "dynamic",
      permitted_tools: ["read_file", "list_directory", "search_files"],
    }],
  });
  const errors = validateDynamicStepTools(flow);
  expect(errors).toHaveLength(0);
});

it("accepts declared step with write tools — no restriction", async () => {
  const flow = buildTestFlow({
    steps: [{
      id: "s1",
      name: "Write output",
      identity: "test-identity",
      execution_mode: "declared",
      permitted_tools: ["write_file", "run_command"],
    }],
  });
  const errors = validateDynamicStepTools(flow);
  expect(errors).toHaveLength(0);  // declared steps are unrestricted
});

it("rejects tool not in identity permitted_tools", async () => {
  const identityTools: McpToolName[] = [McpToolName.READ_FILE];
  const step = buildTestStep({
    execution_mode: "dynamic",
    permitted_tools: ["read_file", "search_files"],  // search_files not in identity
  });
  const errors = validateToolsAgainstIdentity(step, identityTools);
  expect(errors).toHaveLength(1);
  expect(errors).toContain('"search_files" is not in identity');
});

it("accepts step permitted_tools that is a strict subset of identity tools", async () => {
  const identityTools: McpToolName[] = [
    McpToolName.READ_FILE,
    McpToolName.LIST_DIRECTORY,
    McpToolName.SEARCH_FILES,
  ];
  const step = buildTestStep({
    execution_mode: "dynamic",
    permitted_tools: ["read_file"],  // subset of identity tools
  });
  const errors = validateToolsAgainstIdentity(step, identityTools);
  expect(errors).toHaveLength(0);
});
```

#### 7.3 — DynamicStepExecutor unit tests

**File:** `tests/flows/dynamic_step_executor_test.ts` (new)

```typescript
it("iterates until model declares done", async () => {
  const mockLlm = buildMockLlm([
    { done: false, tool: "read_file", args: { path: "src/main.ts" } },
    { done: false, tool: "list_directory", args: { path: "src/" } },
    { done: true, output: "Analysis complete." },
  ]);
  const mockMcp = buildMockMcp({ read_file: "file content", list_directory: "src/\n  main.ts" });
  const mockJournal = buildMockJournal();

  const executor = new DynamicStepExecutor(mockMcp, mockLlm, mockJournal);
  const result = await executor.execute(
    buildTestDynamicStep({ permitted_tools: ["read_file", "list_directory"] }),
    buildTestIdentity({ permitted_tools: ["read_file", "list_directory", "search_files"] }),
    "Analyze the project structure",
    { traceId: "trace-001" },
  );

  expect(result.completed).toBe(true);
  expect(result.iterations).toBe(3);
  expect(result.toolCallsLog).toHaveLength(2);
  expect(result.output).toBe("Analysis complete.");
});

it("returns completed: false when max_iterations reached", async () => {
  // Model never declares done — always returns another tool call
  const mockLlm = buildMockLlmAlwaysContinues("read_file");
  const mockMcp = buildMockMcp({ read_file: "content" });
  const mockJournal = buildMockJournal();

  const executor = new DynamicStepExecutor(mockMcp, mockLlm, mockJournal);
  const result = await executor.execute(
    buildTestDynamicStep({ permitted_tools: ["read_file"] }),
    buildTestIdentity({ permitted_tools: ["read_file"] }),
    "input",
    { traceId: "trace-002" },
  );

  expect(result.completed).toBe(false);
  expect(result.iterations).toBe(10);  // DEFAULT_MAX_ITERATIONS
});

it("throws when model selects tool outside permitted_tools", async () => {
  const mockLlm = buildMockLlm([
    { done: false, tool: "write_file", args: { path: "out.txt", content: "x" } },
  ]);
  const mockMcp = buildMockMcp({});
  const mockJournal = buildMockJournal();

  const executor = new DynamicStepExecutor(mockMcp, mockLlm, mockJournal);
  await expect(
    executor.execute(
      buildTestDynamicStep({ permitted_tools: ["read_file"] }),
      buildTestIdentity({ permitted_tools: ["read_file"] }),
      "input",
      { traceId: "trace-003" },
    ),
  ).rejects.toThrow('tool "write_file" which is not in permitted_tools');
});

it("journals every tool call with traceId", async () => {
  const mockLlm = buildMockLlm([
    { done: false, tool: "read_file", args: { path: "README.md" } },
    { done: true, output: "Done." },
  ]);
  const mockMcp = buildMockMcp({ read_file: "readme content" });
  const mockJournal = buildMockJournal();

  const executor = new DynamicStepExecutor(mockMcp, mockLlm, mockJournal);
  await executor.execute(
    buildTestDynamicStep({ permitted_tools: ["read_file"] }),
    buildTestIdentity({ permitted_tools: ["read_file"] }),
    "input",
    { traceId: "trace-audit-test" },
  );

  const journalEntries = mockJournal.getEntries();
  const toolCallEntries = journalEntries.filter((e) => e.event === "dynamic_tool_call");
  expect(toolCallEntries).toHaveLength(1);
  expect(toolCallEntries.traceId).toBe("trace-audit-test");
  expect(toolCallEntries.tool).toBe("read_file");
});

it("filters write tools from resolvePermittedTools even if identity declares them", async () => {
  // Identity declares write_file — but dynamic executor should filter it out defensively
  const mockLlm = buildMockLlm([{ done: true, output: "Done." }]);
  const mockMcp = buildMockMcp({});
  const mockJournal = buildMockJournal();

  const executor = new DynamicStepExecutor(mockMcp, mockLlm, mockJournal);
  // No step permitted_tools — falls back to identity tools
  const result = await executor.execute(
    buildTestDynamicStep({ permitted_tools: [] }),
    buildTestIdentity({ permitted_tools: ["read_file", "write_file"] }),  // write_file present
    "input",
    { traceId: "trace-004" },
  );

  // write_file must be stripped from effective tools silently
  expect(result.completed).toBe(true);
  const availableTools = mockLlm.getLastAvailableTools();
  expect(availableTools).toContain("read_file");
  expect(availableTools).not.toContain("write_file");
});
```

**Success Criteria:**

- [ ] All 5 `DynamicStepExecutor` tests pass
- [ ] All 6 `FlowLoader` validation tests pass
- [ ] All 3 `FlowStepSchema` schema tests pass (from Task 7.1)
- [ ] Total new tests: 14 minimum

---

## Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
| ---------------------------------------------- | -------- | ---------- | ------------------------------------------------------------------ |
| **R1:** Model selects write tool at runtime | Critical | Low | Runtime guard in `DynamicStepExecutor.resolvePermittedTools` + load-time validation |
| **R2:** Runaway ReAct loop (no termination) | High | Medium | `maxIterations` cap (default 10) + `timeout` field in step schema |
| **R3:** Identity blueprint missing `permitted_tools` | Medium | Medium | `exactl flow validate` warning; falls back to empty set (no dynamic tools) |
| **R4:** Tool call count inflates LLM costs | Medium | Medium | `maxIterations` cap + `timeout` enforce natural ceiling |
| **R5:** `traceId` correlation broken for dynamic calls | High | Low | `activityJournal.log` called for every iteration with same `traceId` |
| **R6:** Existing flow YAMLs affected by schema change | Low | Low | `execution_mode` defaults to `"declared"` — fully backward compatible |

---

## Auditability Model: Before and After

```text
### Before (Declared Only)

Plan step:    tools: [read_file, grep_search]   ← human approves exact call list
Execution:    read_file("src/main.ts")           ← journal entry
              grep_search("pattern")             ← journal entry

### After (Hybrid)

Plan step (declared):
  tools: [write_file]                            ← human approves exact tool, unchanged

Plan step (dynamic):
  permitted_tools: [read_file, list_directory]   ← human approves boundary
  execution_mode: dynamic

Execution (dynamic step):
  Iteration 1: read_file("src/main.ts")          ← journal entry, traceId: abc123
  Iteration 2: list_directory("src/")            ← journal entry, traceId: abc123
  Iteration 3: read_file("src/flows/")           ← journal entry, traceId: abc123
  → Model declares done
```

The audit trail is *richer* in dynamic mode — the journal captures what the model actually did, not just what was planned. Human pre-approval shifts from "exact call sequence" to "permission boundary + step intent", which is more meaningful for exploratory tasks.

---

## Success Criteria

### Functional Requirements

- [ ] `execution_mode: "dynamic"` steps execute via `DynamicStepExecutor` ReAct loop
- [ ] `execution_mode: "declared"` steps (and steps with no `execution_mode`) execute via existing path — zero behavioral change
- [ ] Write tools cannot appear in `permitted_tools` for dynamic steps — blocked at load time and runtime
- [ ] Step `permitted_tools` must be a subset of identity blueprint `permitted_tools`
- [ ] Every tool call in a dynamic step is journaled with `traceId`
- [ ] `maxIterations` cap prevents runaway loops

### Quality Requirements

- [ ] TypeScript compilation: zero errors
- [ ] All 14+ new tests pass
- [ ] All existing flow tests continue to pass (no regressions)
- [ ] `exactl flow validate` outputs actionable errors and warnings for dynamic step issues
- [ ] Example flow `analyze-codebase.yaml` passes validation and demonstrates hybrid pattern

### Backward Compatibility

- [ ] All existing flow YAML files with no `execution_mode` field continue to work unchanged
- [ ] All existing blueprint frontmatter without `permitted_tools` continues to parse correctly
- [ ] No changes to declared-mode execution path behavior

---

## Implementation Timeline

---

## Security Test Planning for Dynamic Toolsets

### Goals

- Ensure all new tool selection and execution logic is robust against privilege escalation, injection, and audit bypass.
- Validate that dynamic tool boundaries cannot be circumvented by blueprint or flow YAML manipulation.
- Guarantee that all tool calls (including dynamic) are fully journaled and traceable.

### Planned Steps

1. **Threat Modeling**

  - Enumerate possible attack vectors for dynamic tool selection (e.g., model requesting undeclared tools, blueprint/flow YAML tampering, tool argument injection).
  - Review audit trail completeness for dynamic vs. declared steps.

1.

  - Write tests for attempts to use write tools in dynamic steps (should be blocked at load and runtime).
  - Test that step `permitted_tools` cannot exceed identity's `permitted_tools` (YAML and runtime).
  - Attempt to inject tool names or arguments via LLM output and verify runtime guards.
  - Simulate blueprint/flow YAML tampering (e.g., removing `permitted_tools` or adding write tools) and validate loader/runtime rejection.
  - Confirm that all tool calls in dynamic steps are journaled with correct `traceId` and step context.
  - Fuzz test tool argument handling for injection or privilege escalation attempts.

1.

  - Add security regression tests to CI pipeline (e.g., `tests/flows/flow_loader_dynamic_security_test.ts`).
  - Require all new tools and step execution modes to have corresponding negative and positive security tests before merge.

1.

  - Document security boundaries and audit guarantees for dynamic toolsets in developer docs and blueprint authoring guides.

### Success Criteria

- [ ] All security test cases pass (blocked on violation, allowed on valid use)
- [ ] No privilege escalation or audit bypass possible via dynamic tool selection
- [ ] Security regression tests run in CI and block on failure
- [ ] Security boundaries and audit model are clearly documented

| Task | Description | Duration | Dependencies |
| ------------ | ------------------------------------------ | -------- | ------------ |
| **Task 1** | Schema + enum + constants updates | 1 day | — |
| **Task 2** | FlowLoader validation layer | 0.5 days | Task 1 |
| **Task 3** | `DynamicStepExecutor` implementation | 1.5 days | Task 1 |
| **Task 4** | `FlowRunner` dispatch update | 0.5 days | Tasks 2, 3 |
| **Task 5** | `exactl flow validate` CLI warnings | 0.5 days | Task 2 |
| **Task 6** | Example flow YAML + blueprint update | 0.5 days | Tasks 1, 2 |
| **Task 7** | Tests | 1.5 days | Tasks 1–5 |

**Estimated Total:** 6 days

---

## Related Work

- **Phase 53:** Identity rename (`Blueprints/Agents → Blueprints/Identities`) — establishes blueprint frontmatter field `permitted_tools` lives on an `identity`, not an `agent`
- **Phase 17:** Skills system (`default_skills` in blueprint frontmatter) — same pattern of declaring per-identity defaults that steps can reference
- **Phase 48:** Dynamic criteria merging in gate steps — established precedent for runtime-determined behavior within a pre-approved boundary

---

## References

- [`src/shared/enums.ts`](../../src/shared/enums.ts) — `McpToolName`, `FlowStepType`, `PermissionAction`
- [`src/shared/schemas/flow.ts`](../../src/shared/schemas/flow.ts) — `FlowStepSchema`, `GateEvaluateSchema`
- [`src/shared/schemas/blueprint.ts`](../../src/shared/schemas/blueprint.ts) — `BlueprintFrontmatterSchema`
- [`src/flows/flow_runner.ts`](../../src/flows/flow_runner.ts) — step execution dispatch
- [`src/flows/flow_loader.ts`](../../src/flows/flow_loader.ts) — flow YAML parsing and validation
