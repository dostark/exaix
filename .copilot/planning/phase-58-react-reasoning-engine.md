---
agent: qwen
scope: dev
title: "Phase 58: ReAct Reasoning Engine for Dynamic Flow Steps"
short_summary: "Implement the ReAct reasoning engine and client interfaces required for dynamic tool selection in flow steps, enabling FlowRunner integration with full auditability and supervision."
version: "1.1"
topics: ["flows", "react", "reasoning", "llm-client", "mcp-client", "dynamic-execution", "auditability"]
---

> [!NOTE]
> **Status: ✅ Complete**
> This phase implemented the missing infrastructure for and completed the FlowRunner integration (formerly Phase 56 Task 4).
> The ReAct reasoning engine enables LLM-driven tool selection within declared permission boundaries.
> All tool calls are journaled with trace IDs for full auditability.

## Executive Summary

Phase 58 completed the hybrid dynamic execution model by implementing the core client interfaces and integrating them into `FlowRunner`. This allows flow steps to opt-into model-driven tool selection (ReAct) while maintaining strict permission boundaries and full activity logging.

### **Achieved Goals**

- [x] Implement `McpClient` wrapper around existing MCP tool execution
- [x] Implement `LlmClient` with ReAct reasoning loop and JSON schema support
- [x] Implement `ActivityJournal` for audit logging via `EventLogger`
- [x] Integrate `DynamicStepExecutor` into `FlowRunner.executeStep()`
- [x] Update `BlueprintLoader` and `RuntimeBlueprintFrontmatterSchema` for `permitted_tools`
- [x] Write unit tests for all client implementations
- [x] Add integration test for end-to-end dynamic step execution
- [x] Update Phase 56 planning document to mark Task 4 complete

---

## Technical Architecture

### Core Interfaces

The system relies on three primary interfaces injected into the `DynamicStepExecutor`:

```typescript
/**
 * MCP client interface for tool execution
 */
export interface IMcpClient {
  callTool(tool: McpToolName, args: ToolArgs): Promise<string>;
  getToolDefinitions(tools: McpToolName[]): Array<{
    name: string;
    description: string;
    inputSchema: Record<string, JSONValue>;
  }>;
}

/**
 * LLM client interface for reasoning about next action
 */
export interface ILlmClient {
  reasonNextAction(params: {
    identity: IBlueprintFrontmatter;
    stepObjective: string;
    accumulatedContext: string;
    availableTools: Array<{
      name: string;
      description: string;
      inputSchema: Record<string, JSONValue>;
    }>;
    iteration: number;
    maxIterations: number;
  }): Promise<{
    done: boolean;
    tool?: McpToolName;
    args?: ToolArgs;
    output?: string;
  }>;
}

/**
 * Activity journal interface for audit logging
 */
export interface IActivityJournal {
  log(entry: JournalEntry): Promise<void>;
}
```

### Data Structures

#### Dynamic Step Result
The result returned by `DynamicStepExecutor.execute()`:
```typescript
export interface IDynamicStepResult {
  stepId: string;
  output: string;
  toolCallsLog: IDynamicToolCall[];
  iterations: number;
  completed: boolean;
}
```

#### Journal Entry
Auditable events logged during execution:
```typescript
export interface JournalEntry {
  traceId: string;
  stepId: string;
  event: string;
  timestamp?: string;
  [key: string]: JSONValue;
}
```

---

## Implementation Summary

### McpClient (`src/mcp/mcp_client.ts`)
A wrapper that bridges the `IMcpClient` interface to the existing MCP `ToolHandler` infrastructure. It provides both tool execution and metadata retrieval (name, description, input schema).

### LlmClient (`src/ai/llm_client.ts`)
Implements the ReAct reasoning prompt and JSON response parsing. It uses the `ModelFactory` to select the appropriate provider based on the identity's configuration. The prompt is dynamically built to include full tool schemas for better model accuracy.

### ActivityJournal (`src/journal/activity_journal.ts`)
A service that logs dynamic execution events (tool calls, reasoning steps, termination) to the `EventLogger`. This ensures all dynamic behavior is visible in the Activity Journal and queryable by `traceId`.

### FlowRunner Integration (`src/flows/flow_runner.ts`)
The `FlowRunner` now dispatches steps based on `execution_mode`.
1. If `DYNAMIC`, it loads the identity blueprint via `BlueprintLoader`.
2. It instantiates a `DynamicStepExecutor` with the required clients.
3. It filters `permitted_tools` against `READ_ONLY_TOOLS` at runtime for safety.
4. It executes the ReAct loop and converts the result into a standard `IStepResult`.

---

## Security and Auditability

- **Runtime Supervision**: `DynamicStepExecutor` enforces that only `READ_ONLY_TOOLS` can be called in dynamic mode.
- **Permission Boundaries**: Tools are further restricted to the `permitted_tools` list defined in the blueprint or step.
- **Full Traceability**: Every iteration of the ReAct loop is logged with the same `traceId` as the parent flow run.
- **Cost Control**: `maxIterations` (default: 10) prevents infinite loops and excessive token expenditure.

---

## Success Verification

### Unit Tests
- `tests/ai/llm_client_test.ts`: 4 tests passing (prompt construction, JSON parsing, error handling).
- `tests/mcp/mcp_client_test.ts`: 3 tests passing (tool routing, error propagation).
- `tests/journal/activity_journal_test.ts`: 1 test passing (trace correlation).
- `tests/flows/dynamic_step_executor_test.ts`: 5 tests passing (ReAct loop logic, tool filtering).

### Integration Test
- `tests/flows/dynamic_flow_integration_test.ts`: Successfully executed a multi-iteration ReAct loop where a mock researcher used `read_file` to satisfy a step objective.

---

## Related Documents

- [Phase 56: Hybrid Dynamic Tool Selection](./phase-56-dynamic-toolsets.md)
- [Phase 57: New MCP Tool Handlers](./phase-57-new-mcp-tools-handlers.md)
