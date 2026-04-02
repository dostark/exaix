---
title: "Phase 61: AgentExecutor MCP Integration & Real-World Execution"
status: "🚧 In Progress"
author: "Comet Assistant"
date: "2026-04-02"
estimated_effort: "12-16 hours"
impact_level: "H (Core Execution, Security, Correctness)"
risk_level: "M (Complex refactoring of core execution paths)"
phase_dependencies: "Phase 60 (Agent-Optimized Documentation)"
blocking_phases: "None"
---

# Phase 61: AgentExecutor MCP Integration & Real-World Execution

## Executive Summary
This phase addresses the critical architectural weakness **W2** identified in `Exaix_Weaknesses.md`. Currently, `AgentExecutor` contains a significant stub where it merely asks an LLM to describe changes rather than executing them. This phase replaces the mock result and LLM-only flow with a robust integration of the Model Context Protocol (MCP), enabling real-world file system operations, git-audited changesets, and unified execution strategies.

## Problem Statement (Detailed)
The current `AgentExecutor.executeStep` implementation returns a hardcoded commit SHA (`"abc1234567890abcdef"`) and a mock changeset. While the `ExecutionLoop` handles ReAct loops with TOML actions, the `AgentExecutor` path intended for plan-based agent spawning is disconnected from the actual execution engine. This creates a "shadow" execution path that lacks grounding in the physical file system.

## Goals & Success Criteria

### Goal 1: Replace Hardcoded Stubs with Real MCP Execution
- Replace `provider.generate()` description-only flow with `SafeSubprocess` spawning.
- Connect spawned agent processes to the Exaix MCP server.
- Ensure `tool_calls` and `execution_time_ms` are accurately reported from the real process.

### Goal 2: Unified Execution Interface
- Define `IExecutionStrategy` to abstract different execution methods.
- Implement `McpAgentStrategy` for subprocess-based MCP execution.
- Implement `ReActLoopStrategy` (migrating logic from `ExecutionLoop`).

### Goal 3: Security & Auditability (W2/W7/W13)
- Integrate `auditGitChanges` and `revertUnauthorizedChanges` into the primary execution loop.
- Ensure all MCP-driven changes are captured in the Activity Journal with correct trace IDs.
- Implement confidence-based early exit (supporting W12).

## Detailed Architecture Changes

### 1. The IExecutionStrategy Interface
```typescript
interface IExecutionStrategy {
  execute(context: IExecutionContext, options: IAgentExecutionOptions): Promise<IChangesetResult>;
}
```

### 2. McpAgentStrategy Implementation
This strategy will:
1. Load the Identity Blueprint.
2. Initialize a `SafeSubprocess` with appropriate `--allow-*` flags.
3. Establish a JSON-RPC connection over stdio to the MCP server.
4. Pass the execution plan and context as the initial message.
5. Monitor for completion and capture the generated changeset.

## Step-by-Step Implementation Plan

### Phase 61.1: Interface Definition & Strategy Refactoring (4hr)
1. Create `src/services/agent/strategies/mod.ts`.
2. Define `IExecutionStrategy` and the result schema.
3. Refactor `AgentExecutor` to accept a strategy instead of hardcoded logic.

### Phase 61.2: MCP Subprocess Integration (6hr)
1. Implement `McpAgentStrategy`.
2. Update `SafeSubprocess` to handle long-running MCP sessions with heartbeat (W8).
3. Wire the real `git log` and `git diff` outputs into the final `IChangesetResult`.

### Phase 61.3: Verification & Scenario Testing (4hr)
1. Add new scenarios to the `dynamic_execution` pack (extending Phase 59).
2. Validate that file system changes match the agent's reported changeset.
3. Verify that unauthorized file access is blocked by the security layer.

## Rollback & Validation
```bash
# Revert to description-only mock
git checkout HEAD~1 src/services/agent/agent_executor.ts
deno task test # Ensure no regressions in existing flows
```

## Success Metrics
| Metric | Baseline | Target |
|--------|----------|--------|
| Real SHA Generation | 0% (Hardcoded) | 100% |
| Tool Call Accuracy | Estimated | 1:1 with Journal |
| Security Rejection | Manual | Automated via Audit |

## 📉 Residual Risks & The "Non-Ultimate" Nature of Phase 61

### 1. The Subprocess Lifecycle Risk
While `SafeSubprocess` provides basic timeouts, a complex agent task might involve multiple recursive tool calls that exceed the top-level timeout. Detecting "stuck" but active processes remains a challenge.

### 2. Git Audit Complexity
`auditGitChanges` relies on porcelain output. While robust for simple file additions/modifications, complex git states (unmerged paths, submodules) may require more sophisticated parsing to prevent false negatives in security checks.

### 3. Strategy Fragmentation
As we introduce more `IExecutionStrategy` implementations, maintaining consistency in how they log to the Activity Journal is vital. Divergence in logging formats would break downstream TUI and analytics tools.

**Conclusion**: Phase 61 moves Exaix from "descriptive" to "executive" agency. It is the bridge to a fully autonomous developer agent while maintaining strict human-in-the-loop auditability.

---
**Agent Instructions**: Refer to `.copilot/planning/phase-60-agent-docs.md` for the document structure. Prioritize the P0 correction of the `AgentExecutor` stub.
