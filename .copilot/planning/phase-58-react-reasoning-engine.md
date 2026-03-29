---
agent: qwen
scope: dev
title: "Phase 58: ReAct Reasoning Engine for Dynamic Flow Steps"
short_summary: "Implement the ReAct reasoning engine and client interfaces required for dynamic tool selection in flow steps, enabling FlowRunner integration (Phase 56 Task 4) with full auditability and supervision."
version: "1.0"
topics: ["flows", "react", "reasoning", "llm-client", "mcp-client", "dynamic-execution", "auditability"]
---

> [!NOTE]
> **Status: ⏳ Pending**
> This phase implements the missing infrastructure for Phase 56 Task 4 (FlowRunner integration).
> The ReAct reasoning engine enables LLM-driven tool selection within declared permission boundaries.
> All tool calls are journaled with trace IDs for full auditability.
>
> **No breaking changes** — existing flows continue to work unchanged.
>
> **Prerequisites:**
> - Phase 56 (Dynamic Tool Selection Schema) — provides `DynamicStepExecutor`, `execution_mode` field
> - Phase 57 (New MCP Tool Handlers) — provides additional tools for dynamic selection

## Executive Summary

Phase 56 introduced `execution_mode: "dynamic"` for flow steps and implemented `DynamicStepExecutor`,
but left Task 4 (FlowRunner integration) deferred due to missing client interfaces:

| Missing Component | Status | Blocker For |
|------------------|--------|-------------|
| `IMcpClient` implementation | ❌ Not implemented | Phase 56 Task 4 |
| `ILlmClient` implementation | ❌ Not implemented | Phase 56 Task 4 |
| `IActivityJournal` implementation | ❌ Not implemented | Phase 56 Task 4 |
| ReAct reasoning loop | ❌ Not implemented | Phase 56 Task 4 |

This phase implements all four components, enabling full dynamic tool selection in flow steps.

### **Design Principles**

- **Supervised execution** — LLM proposes tool calls, system validates against permitted_tools before execution
- **Auditability first** — every reasoning step and tool call is journaled with trace ID
- **Portal-scoped tools** — dynamic steps operate within portal bounds, respecting existing security
- **Graceful degradation** — if LLM reasoning fails, step returns context accumulated so far
- **Token-efficient** — reasoning prompts include only necessary context, not full conversation history

---

## Goals

- [ ] Implement `McpClient` wrapper around existing MCP tool execution
- [ ] Implement `LlmClient` with ReAct reasoning loop
- [ ] Implement `ActivityJournal` for audit logging
- [ ] Integrate `DynamicStepExecutor` into `FlowRunner.executeStep()`
- [ ] Write unit tests for all client implementations
- [ ] Add integration test for end-to-end dynamic step execution
- [ ] Update Phase 56 planning document to mark Task 4 complete

---

## Current State Analysis

### Phase 56 Deferred Task 4

**From `phase-56-dynamic-toolsets.md`:**

> **Task 4: Update `FlowRunner` to Dispatch by Execution Mode**
>
> **Status:** ⏸️ Deferred - Requires MCP/LLM client integration
>
> **File:** `src/flows/flow_runner.ts`
>
> The `FlowRunner` currently processes all steps uniformly. Add execution mode dispatch:
>
> ```typescript
> // In FlowRunner.executeStep() or equivalent dispatch method:
>
> if (step.execution_mode === StepExecutionMode.DYNAMIC) {
>   // Route to DynamicStepExecutor
>   const executor = new DynamicStepExecutor(mcpClient, llmClient, activityJournal);
>   return await executor.execute(step, identity, input, {
>     traceId: request.traceId,
>     maxIterations: step.timeout ? Math.floor(step.timeout / 1000) : 10,
>   });
> } else {
>   // Route to existing declared-mode execution path (unchanged)
>   return await this.executeDeclaredStep(step, identity, input);
> }
> ```
>
> **Note:** Full FlowRunner integration requires:
> 1. MCP client implementation for tool execution
> 2. LLM client implementation for ReAct reasoning
> 3. BlueprintLoader integration for identity loading

### Existing Infrastructure

**`DynamicStepExecutor` (Phase 56, implemented):**
- Located: `src/flows/dynamic_step_executor.ts`
- 251 lines, 5/5 tests passing
- Interfaces defined: `IMcpClient`, `ILlmClient`, `IActivityJournal`
- Methods: `execute()`, `resolvePermittedTools()`, `appendObservation()`

**`FlowRunner` (existing):**
- Located: `src/flows/flow_runner.ts`
- 1,124 lines
- Uses `agentExecutor` (`AgentRunner`) for declared steps
- Uses `gateEvaluator` (`GateEvaluator`) for gate steps
- Has `eventLogger` for activity logging

**MCP Tool Handlers (existing + Phase 57):**
- `ReadFileTool`, `WriteFileTool`, `PatchFileTool`, `DeleteFileTool`, `MoveFileTool`
- `ListDirectoryTool`, `SearchFilesTool`
- `GitCreateBranchTool`, `GitCommitTool`, `GitStatusTool`
- `CreateDirectoryTool`

**LLM Provider Infrastructure (existing):**
- `src/ai/providers.ts` — provider selection
- `src/ai/provider_selector.ts` — provider routing
- `BlueprintFrontmatter` has `model` field for identity-specific model selection

---

## Design: ReAct Reasoning Loop

### Overview

ReAct (Reasoning + Acting) is an iterative pattern where the LLM:
1. **Reasons** about what action to take next
2. **Acts** by selecting a tool and arguments
3. **Observes** the tool result
4. **Repeats** until the objective is met

```text
┌─────────────────────────────────────────────────────────────┐
│                     ReAct Loop                              │
│                                                             │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────┐ │
│  │ Reason   │───▶│ Act      │───▶│ Observe  │───▶│ Done │ │
│  │ (LLM)    │    │ (MCP)    │    │ (Result) │    │ ?    │ │
│  └──────────┘    └──────────┘    └──────────┘    └──┬───┘ │
│       ▲                                              │     │
│       │              No                              │     │
│       └──────────────────────────────────────────────┘     │
│                           Yes                               │
└─────────────────────────────────────────────────────────────┘
```

### Reasoning Prompt Structure

The LLM receives a structured prompt with:

1. **Identity context** — role, capabilities, model
2. **Step objective** — what the step aims to achieve
3. **Accumulated context** — all previous tool results
4. **Available tools** — permitted_tools for this step
5. **Iteration info** — current iteration, max iterations

**Example prompt:**

```text
You are senior-coder, an expert software engineer.

Step Objective: Explore codebase structure and gather context

Available Tools:
- read_file: Read content of a file
- list_directory: List files in a directory
- search_files: Search for files by pattern

Current Context:
[No previous tool calls yet]

Iteration: 1 of 10

Reason about what tool to call next. Either:
1. Select a tool and provide arguments, OR
2. Declare the step complete with your findings

Respond in JSON format:
{
  "reasoning": "Why I'm taking this action",
  "action": {
    "type": "tool_call" | "complete",
    "tool": "tool_name",  // if tool_call
    "args": {...},        // if tool_call
    "output": "..."       // if complete
  }
}
```

### Tool Call Validation

Before executing any tool call proposed by the LLM:

1. **Schema validation** — args match Zod schema for the tool
2. **Permission check** — tool is in permitted_tools
3. **Read-only check** — for dynamic steps, tool must be read-only
4. **Portal bounds** — paths must stay within portal

### Observation Accumulation

Tool results are appended to context in a structured format:

```text
[Tool: read_file]
Path: src/main.ts
Result: (file content, truncated to 500 chars)
```

This accumulated context is fed back into the next reasoning iteration.

---

## Implementation Plan

### Task 1: `McpClient` Implementation

**File:** `src/mcp/mcp_client.ts` (new file)

**Purpose:** Wrapper around existing MCP tool execution, providing the `IMcpClient` interface.

**Dependencies:**
- Existing MCP tool handlers (`createToolHandlers()`)
- `PortalPermissionsService` for permission checks
- `ICliApplicationContext` for context

**Interface:**

```typescript
export interface IMcpClient {
  /**
   * Call a tool by name with the given arguments.
   * @param tool - Tool name (e.g., "read_file", "list_directory")
   * @param args - Tool arguments as JSON-compatible key-value pairs
   * @returns Tool result as string
   * @throws Error if tool not found, permission denied, or tool execution fails
   */
  callTool(tool: McpToolName, args: ToolArgs): Promise<string>;
}
```

**Implementation approach:**

1. Create `McpClient` class that wraps the existing tool handler infrastructure
2. Map `McpToolName` enum values to tool handler instances
3. Execute tool handlers' `execute()` method
4. Extract result text from `MCPToolResponse`
5. Log tool execution to event logger

**Security:**
- Permission checks delegated to `PortalPermissionsService`
- Portal bounds enforced by `ToolHandler.validatePortalPath()`
- Tool arguments validated by Zod schemas

**Success Criteria:**

- [ ] `McpClient` implements `IMcpClient` interface
- [ ] All existing MCP tools are callable
- [ ] Tool execution errors are propagated correctly
- [ ] Permission denied errors include tool and portal info

---

### Task 2: `LlmClient` Implementation

**File:** `src/ai/llm_client.ts` (new file)

**Purpose:** ReAct reasoning engine that prompts LLM for next action selection.

**Dependencies:**
- Existing LLM provider infrastructure (`src/ai/providers.ts`)
- `BlueprintFrontmatter` for identity/model selection
- Zod schemas for response validation

**Interface:**

```typescript
export interface ILlmClient {
  /**
   * Prompt LLM to reason about the next action in a ReAct loop.
   * @param params - Reasoning parameters
   * @returns Decision: either {done: true, output} or {done: false, tool, args}
   */
  reasonNextAction(params: {
    identity: IBlueprintFrontmatter;
    stepObjective: string;
    accumulatedContext: string;
    availableTools: McpToolName[];
    iteration: number;
    maxIterations: number;
  }): Promise<{
    done: boolean;
    tool?: McpToolName;
    args?: ToolArgs;
    output?: string;
  }>;
}
```

**Implementation approach:**

1. Build reasoning prompt from parameters
2. Select LLM provider based on identity's `model` field
3. Call LLM with structured output format (JSON mode)
4. Parse and validate response against expected schema
5. Return structured decision

**Prompt Template:**

```typescript
const REACT_PROMPT_TEMPLATE = `
You are {identity_name}, {identity_description}.

Step Objective: {step_objective}

Available Tools:
{tools_description}

Current Context:
{accumulated_context}

Iteration: {iteration} of {max_iterations}

Reason about what action to take next. Either:
1. Select a tool and provide arguments, OR
2. Declare the step complete with your findings

Respond in JSON format:
{
  "reasoning": "Why I'm taking this action",
  "action": {
    "type": "tool_call" | "complete",
    "tool": "tool_name",
    "args": {...},
    "output": "final output when complete"
  }
}
`;
```

**Response Schema:**

```typescript
const ReActResponseSchema = z.object({
  reasoning: z.string(),
  action: z.object({
    type: z.enum(["tool_call", "complete"]),
    tool: z.nativeEnum(McpToolName).optional(),
    args: z.record(z.unknown()).optional(),
    output: z.string().optional(),
  }),
});
```

**Error Handling:**

- Invalid JSON response → retry with error message
- Invalid tool selection → throw error (caller handles)
- LLM API error → throw error with provider info

**Success Criteria:**

- [ ] `LlmClient` implements `ILlmClient` interface
- [ ] Response parsing handles valid JSON responses
- [ ] Invalid responses trigger retry or error
- [ ] Tool descriptions are accurate and helpful

---

### Task 3: `ActivityJournal` Implementation

**File:** `src/journal/activity_journal.ts` (new file)

**Purpose:** Audit logging for dynamic step execution, integrating with existing event logger.

**Dependencies:**
- Existing `eventLogger` from `ICliApplicationContext`
- `IDatabaseService` for persistence (optional)

**Interface:**

```typescript
export interface IActivityJournal {
  /**
   * Log an activity entry.
   * @param entry - Activity entry with trace ID and event details
   */
  log(entry: JournalEntry): Promise<void>;
}
```

**Implementation approach:**

1. Create `ActivityJournal` class wrapping `eventLogger`
2. Ensure all entries include `traceId` for correlation
3. Log entry types:
   - `dynamic_step_started` — step execution began
   - `dynamic_tool_call` — tool was called
   - `dynamic_step_completed` — step completed successfully
   - `dynamic_step_max_iterations` — max iterations reached
   - `dynamic_step_error` — step failed with error

**Entry Schema:**

```typescript
export interface JournalEntry {
  traceId: string;
  stepId: string;
  event: string;
  timestamp?: string;  // ISO 8601, defaults to now
  [key: string]: JSONValue;  // Additional event-specific fields
}
```

**Success Criteria:**

- [ ] `ActivityJournal` implements `IActivityJournal` interface
- [ ] All entries include traceId
- [ ] Entries are logged to event logger
- [ ] Optional persistence to database

---

### Task 4: FlowRunner Integration

**File:** `src/flows/flow_runner.ts`

**Changes:**

1. **Add dependencies to constructor:**

```typescript
export class FlowRunner implements IFlowRunner {
  constructor(
    // ... existing fields
    private readonly mcpClient: IMcpClient,
    private readonly llmClient: ILlmClient,
    private readonly activityJournal: IActivityJournal,
  ) {
    // ... existing initialization
  }
```

2. **Add execution mode dispatch in `executeStep()`:**

```typescript
private async executeStep(
  flowRunId: string,
  stepId: string,
  flow: IFlow,
  request: { userPrompt: string; traceId?: string; requestId?: string; requestAnalysis?: IRequestAnalysis },
  stepResults: Map<string, IStepResult>,
): Promise<IStepResult> {
  const step = flow.steps.find((s) => s.id === stepId)!;
  const startedAt = new Date();

  // ... existing condition evaluation ...

  // NEW: Execution mode dispatch
  if (step.execution_mode === StepExecutionMode.DYNAMIC) {
    return await this.executeDynamicStep(flowRunId, step, flow, request, startedAt);
  }

  // ... existing declared-mode execution ...
}
```

3. **Add `executeDynamicStep()` method:**

```typescript
private async executeDynamicStep(
  flowRunId: string,
  step: IFlowStep,
  flow: IFlow,
  request: { userPrompt: string; traceId?: string; requestId?: string; requestAnalysis?: IRequestAnalysis },
  startedAt: Date,
): Promise<IStepResult> {
  // Load identity blueprint
  const identity = await this.blueprintLoader.load(step.identity);

  // Create executor with dependencies
  const executor = new DynamicStepExecutor(
    this.mcpClient,
    this.llmClient,
    this.activityJournal,
  );

  // Prepare step input
  const input = await this.prepareStepInput(step, flow, request, stepResults);

  // Execute dynamic step
  const result = await executor.execute(step, identity, input, {
    traceId: request.traceId ?? flowRunId,
    maxIterations: step.timeout ? Math.floor(step.timeout / 1000) : 10,
  });

  const completedAt = new Date();
  const duration = completedAt.getTime() - startedAt.getTime();

  // Log completion
  await this.eventLogger.log("flow.step.completed", {
    flowRunId,
    stepId: step.id,
    identityId: step.identity,
    executionMode: "dynamic",
    success: result.completed,
    iterations: result.iterations,
    toolCallCount: result.toolCallsLog.length,
    duration,
    traceId: request.traceId,
    requestId: request.requestId,
  });

  return {
    stepId: step.id,
    success: result.completed,
    result: {
      thought: "",
      content: result.output,
      raw: JSON.stringify(result.toolCallsLog),
    },
    duration,
    startedAt,
    completedAt,
  };
}
```

**Success Criteria:**

- [ ] Dynamic steps route to `DynamicStepExecutor`
- [ ] Declared steps continue through existing path unchanged
- [ ] Legacy flows (no `execution_mode`) work unchanged
- [ ] All event logging includes traceId

---

### Task 5: Tests

**File:** `src/mcp/mcp_client_test.ts` (new)

**Test scenarios:**
- ✅ Calls existing MCP tools correctly
- ✅ Permission denied errors are propagated
- ✅ Tool not found errors are propagated
- ✅ Tool execution errors include tool name and args

**File:** `src/ai/llm_client_test.ts` (new)

**Test scenarios:**
- ✅ Builds correct reasoning prompt
- ✅ Parses valid JSON responses
- ✅ Handles invalid JSON with retry or error
- ✅ Rejects invalid tool selections
- ✅ Respects max iterations in prompt

**File:** `src/journal/activity_journal_test.ts` (new)

**Test scenarios:**
- ✅ Logs entries with traceId
- ✅ Includes timestamp if not provided
- ✅ Additional fields are preserved

**File:** `tests/flows/flow_runner_dynamic_integration_test.ts` (new)

**Test scenarios:**
- ✅ Dynamic step executes via `DynamicStepExecutor`
- ✅ Declared step executes via existing path
- ✅ Legacy flow (no execution_mode) works unchanged
- ✅ Event logging includes correct traceId

**Success Criteria:**

- [ ] All unit tests pass
- [ ] Integration test demonstrates end-to-end flow
- [ ] Test coverage > 80% for new files

---

### Task 6: Security and Auditability

**Security Review Checklist:**

- [ ] Tool calls are validated against permitted_tools before execution
- [ ] Read-only enforcement for dynamic steps
- [ ] Portal bounds checked for all file operations
- [ ] Permission checks delegated to `PortalPermissionsService`
- [ ] LLM responses are validated against schema
- [ ] Max iterations prevents runaway loops
- [ ] Timeout enforcement at FlowRunner level

**Auditability Requirements:**

- [ ] Every tool call logged with traceId
- [ ] Reasoning steps logged (optional: include LLM reasoning)
- [ ] Step start/completion logged
- [ ] Errors logged with full context
- [ ] Logs queryable by traceId

---

## Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| **R1:** LLM selects invalid tool | High | Medium | Schema validation before execution; error returned to LLM for retry |
| **R2:** LLM enters infinite loop | High | Low | Max iterations cap (default 10); timeout enforcement |
| **R3:** Token costs exceed budget | Medium | Medium | Iteration cap; context truncation; step timeout |
| **R4:** Portal security bypassed | Critical | Low | All tool calls go through existing `ToolHandler` security |
| **R5:** Trace ID correlation broken | High | Low | `ActivityJournal` ensures all entries include traceId |
| **R6:** LLM API unavailable | Medium | Low | Error propagated to step result; step marked failed |

---

## Success Criteria

### Functional Requirements

- [ ] `McpClient` wraps existing MCP tool execution
- [ ] `LlmClient` implements ReAct reasoning loop
- [ ] `ActivityJournal` logs all dynamic step activity
- [ ] `FlowRunner` dispatches dynamic steps to `DynamicStepExecutor`
- [ ] Declared steps continue through existing path unchanged
- [ ] Legacy flows work without modification

### Quality Requirements

- [ ] TypeScript compilation: zero errors
- [ ] All new tests pass (unit + integration)
- [ ] No regressions in existing flow tests
- [ ] Security review completed
- [ ] Audit logging verified with trace queries

### Performance Requirements

- [ ] Dynamic step overhead < 100ms per iteration (excluding LLM call time)
- [ ] Token usage per iteration < 2000 tokens (prompt + response)
- [ ] Max iterations respected (default 10)

---

## Implementation Timeline

| Task | Description | Duration | Dependencies |
|------|-------------|----------|--------------|
| **Task 1** | `McpClient` implementation | 0.5 days | Phase 57 MCP tools |
| **Task 2** | `LlmClient` implementation | 1 day | Existing LLM providers |
| **Task 3** | `ActivityJournal` implementation | 0.5 days | Existing event logger |
| **Task 4** | FlowRunner integration | 1 day | Tasks 1-3 |
| **Task 5** | Tests | 1 day | Tasks 1-4 |
| **Task 6** | Security review | 0.5 days | Tasks 1-4 |

**Estimated Total:** 4.5 days

---

## Related Work

- **Phase 56:** Dynamic Tool Selection — provides `DynamicStepExecutor`, schema, validation
- **Phase 57:** New MCP Tool Handlers — provides additional tools for dynamic selection
- **Phase 48:** Dynamic criteria merging — established precedent for runtime-determined behavior
- **Phase 17:** Skills system — same pattern of per-identity configuration

---

## References

- [`src/flows/dynamic_step_executor.ts`](../../src/flows/dynamic_step_executor.ts) — `DynamicStepExecutor` class
- [`src/flows/flow_runner.ts`](../../src/flows/flow_runner.ts) — FlowRunner implementation
- [`src/mcp/tool_handler.ts`](../../src/mcp/tool_handler.ts) — Base class for tool handlers
- [`src/ai/providers.ts`](../../src/ai/providers.ts) — LLM provider infrastructure
- [Phase 56 Planning Doc](./phase-56-dynamic-toolsets.md) — Original dynamic tool selection design
