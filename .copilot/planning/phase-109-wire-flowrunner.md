---
agent: senior-coder
scope: dev
title: "Phase 109: Wire FlowRunner into production execution pipeline"
short_summary: "Connect the existing FlowRunner orchestrator to the daemon's request processing path, replacing the current stub-plan dead end with real multi-agent flow execution."
version: "1.0"
topics: ["planning", "architecture", "tdd"]
---

# Phase 109: Wire FlowRunner into Production

## 1. Executive Summary

**Problem**: The `FlowRunner` (`packages/flow/src/flow_runner.ts`, 3359 lines) is a fully implemented multi-agent flow orchestrator with dependency resolution, parallel waves, dynamic ReAct steps, quality gates, and wait states. It is exported from `@exaix/flow` and tested extensively — but **never instantiated or used in production** (`apps/daemon/main.ts`). Flow requests (requests with `flow: <id>` in frontmatter) produce a stub plan in `RequestProcessor.processFlowRequest()` that `ExecutionLoop` cannot meaningfully execute.

**Solution**: Wire `FlowRunner` into the daemon's execution pipeline. Create an `AgentExecutorAdapter` that bridges `AgentRunner` into `FlowRunner`'s `IAgentExecutor` interface. Replace the stub-plan dead end in `processFlowRequest()` with a direct `FlowRunner.execute()` call. This makes flow requests execute real multi-agent orchestration.

**Goal**: Flow requests end-to-end: user submits `flow: web-dev` → `RequestProcessor` → `FlowRunner` → `DynamicStepExecutor`/`AgentRunner` → real execution.

## 2. Current State Analysis

| File | Role | Status |
|------|------|--------|
| `packages/flow/src/flow_runner.ts` | Multi-agent flow orchestrator | Complete, UNWIRED |
| `packages/request/src/processor.ts:569-625` | Flow request handler (stub plan) | BROKEN — writes dead stub |
| `packages/request/src/router.ts` | Request routing hub | UNWIRED |
| `apps/daemon/main.ts:278-286` | Production execution loop | Uses ExecutionLoop only |
| `packages/flow/src/dynamic_step_executor.ts` | ReAct engine for dynamic steps | Uses LlmClient → ProviderFactory ✅ |
| `packages/ai/src/llm_client.ts` | Provider resolution for dynamic steps | Now uses ProviderFactory ✅ |

**Key constraint**: `FlowRunner` requires an `IAgentExecutor` — an interface that `AgentRunner` does not currently implement. An adapter is needed.

## 3. Implementation Plan

### Step 1: Create AgentExecutorAdapter

Create `packages/flow/src/agent_executor_adapter.ts` — wraps `AgentRunner` into `IAgentExecutor`.

```
class AgentExecutorAdapter implements IAgentExecutor
  constructor(runner: AgentRunner)
  async run(identityId, request) → runner.run(blueprint, request)
```

**Planned tests**:
- `AgentExecutorAdapter delegates run() to AgentRunner`
- `AgentExecutorAdapter passes identityId correctly`

### Step 2: Wire FlowRunner in daemon

In `apps/daemon/main.ts`, after `RequestProcessor` creation, instantiate `FlowRunner` with `AgentExecutorAdapter` and the existing `AgentRunner`.

**Planned tests**:
- Daemon creates FlowRunner with correct dependencies
- FlowRunner is accessible for flow execution

### Step 3: Replace stub plan with FlowRunner call

In `packages/request/src/processor.ts:processFlowRequest()`, when a `flowRunner` is configured, call `flowRunner.execute()` instead of writing a stub plan.

**Planned tests**:
- Flow request with `flowRunner` configured delegates to FlowRunner
- Flow request without `flowRunner` falls back to stub plan (backward compat)

### Step 4 (§3D): Update documentation

Update `ARCHITECTURE.md` execution pipeline section, `docs/Exaix_Evaluation.md` if needed.

## 4. Success Metrics

- Flow requests execute real multi-agent orchestration (not stub plans)
- Dynamic steps within flows use `LlmClient` → `ProviderFactory` (canonical resolution)
- All existing agent-only requests continue to work unchanged
- Scenario framework tests pass

## 5. Risk Level

Medium — the changes are additive (not modifying existing working paths) except for the stub-plan replacement, which has no existing production consumers (flows don't work today).
