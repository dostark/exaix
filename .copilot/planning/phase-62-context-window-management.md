---
agent: senior-coder
scope: dev
title: Phase 62: Global Prompt Budget Coordinator (W7 & W15 Remediation)
short_summary: Introduce a PromptBudgetAllocator service with dynamic reallocation and cost tracking to manage context windows and prevent silent truncation.
version: 1.1
topics:
  - context-window
  - budgeting
  - llm
  - tokens
  - cost-tracking
  - W7
  - W15
---

# Phase 62: Global Prompt Budget Coordinator

## Status: Planning
**Author**: Comet Assistant (via senior-coder Blueprint)
**Date**: 2026-04-02
**Impact Level**: H (Core Prompt Logic, Cost Control)
**Risk Level**: M (Affects core prompt assembly logic across multiple services)
**Phase Dependencies**: Phase 60, Phase 61
**Blocking Phases**: None

## Executive Summary - The Problem {#problem}

Root cause analysis of **W7** reveals that Exaix lacks a centralized context window manager. Currently, services like `SessionMemoryService` and `SkillsService` use hardcoded character limits that do not scale with different LLM providers. If the sum of these blocks exceeds the LLM's context window, the model silently truncates the prompt. This often leads to the loss of the **Execution Plan** (usually at the end of the prompt), causing the agent to hallucinate or fail entirely.

Additionally, **W15** highlights a lack of token and cost persistence, making optimization and budget enforcement impossible.

## Executive Summary - The Goal {#goal}

- **Centralized Allocation**: Proportional budgeting based on specific model limits.
- **Dynamic Reallocation**: Unused budget from low-priority sections (e.g., empty Memory) is "waterfalled" to high-priority sections (Plan, Portal Knowledge).
- **Cost Transparency**: Integrated token counting and USD cost estimation in the Activity Journal.
- **W15 Integration**: Persist cost/usage data per request for future optimization.

## Current State Analysis - Key Files & Gaps {#current-state}

| File | Current Role | Gap |
|------|--------------|-----|
| `src/shared/constants.ts` | Defines `MAX_PROMPT_LENGTH` | Hardcoded; model-agnostic. |
| `src/services/agent/agent_executor.ts` | Assembles final prompt. | Truncates blindly; no cost logging. |
| `src/services/memory/session_memory.ts` | Context generation. | Hardcoded `maxContextLength` (4000). |
| `src/services/skills/skills.ts` | Skill matching. | Hardcoded `skillContextBudget` (2000). |
| `src/services/mcp/tools.md` | Tool Definitions (Phase 60). | Consumes variable tokens; unbudgeted. |

## Technical Architecture & Detailed Design {#architecture}

### 1. IPromptBudgetAllocator Interface {#interface}

```typescript
export interface IPromptBudget {
  systemPrompt: number;
  portalKnowledge: number;
  memory: number;
  skills: number;
  toolSchemas: number; // Added for Phase 60
  plan: number;
  request: number;
  total: number;
  safetyMargin: number; // Heuristic buffer (e.g., 10%)
}

export interface IPromptBudgetAllocator {
  /**
   * Allocate budgets with "Waterfalling" reallocation logic.
   * Sections provide their 'desired' usage; unused tokens are reallocated to high-priority sections.
   */
  allocate(modelId: string, desiredUsage?: Partial<IPromptBudget>): IPromptBudget;
  calculateTokens(text: string, modelId: string): number;
  estimateCost(tokens: number, modelId: string): number;
}
```

### 2. Default Allocation Weights & Priority {#weights}

| Section | Base Weight | Priority | Reallocation Target? |
|---------|------------|----------|----------------------|
| Plan | 35% | Critical | **Yes (Primary)** |
| System Prompt | 15% | High | No |
| Portal Knowledge | 15% | Medium | **Yes (Secondary)** |
| Tool Schemas | 10% | High | No |
| User Request | 10% | High | No |
| Memory Context | 10% | Medium | No |
| Skills Context | 5% | Medium | No |

### 3. Logic Flow: The "Waterfall" Reallocation {#logic-flow}

1. **AgentExecutor** identifies the model (e.g., `gpt-4o`, `claude-3-5-sonnet`).
2. **BudgetAllocator** retrieves the raw context window and applies a **10% Safety Margin**.
3. Services (Memory, Skills) report their available content size.
4. If a service uses less than its allocated budget, the `PromptBudgetAllocator` reallocates the surplus to the **Plan** and **Portal Knowledge** sections.
5. Final budgets are passed to services to enforce truncation *before* assembly.

## Implementation Plan {#implementation}

### Step 1: Define Schemas & Constants {#step-1}
- **Actions**:
  - Create `src/shared/schemas/prompt_budget.ts`.
  - Update `src/shared/constants.ts` with `MODEL_CONTEXT_WINDOWS` and `MODEL_COST_PER_1K`.
- **Validation**:
  - Zod schema validates budget objects.

### Step 2: Implement PromptBudgetAllocator Service {#step-2}
- **Actions**:
  - Create `src/services/agent/prompt_budget_allocator.ts`.
  - Implement `allocateWithReallocation()` logic.
  - Implement heuristic token counter (4 chars/token safety) or model-specific BPE.
- **Validation**:
  - Unit tests for allocation with different model windows.
  - Verify reallocation logic gives surplus to the Plan section.

### Step 3: Refactor Context Services {#step-3}
- **Actions**:
  - Update `SessionMemoryService` and `SkillsService` to accept `IPromptBudget`.
  - Refactor `formatMemoryContext` to respect dynamic caps.
- **Validation**:
  - Services truncate correctly based on provided budget.

### Step 4: Integrate into AgentExecutor (W15) {#step-4}
- **Actions**:
  - Update `AgentExecutor.executeStep` to use the allocator.
  - Integrate `estimateCost` and log `usage.cost_usd_estimate` to Activity Journal.
- **Validation**:
  - Integration test: Verify small window models (4k) still produce valid (but truncated) prompts.

## Risks & Mitigations {#risks}

| Risk | Impact | Mitigation Strategy |
|------|--------|---------------------|
| R1: Over-truncation | Medium | Use 90% "Context Ceiling" and dynamic reallocation. |
| R2: Token Count Drift | Low | Use conservative 4:1 char ratio; allow per-model overrides. |
| R3: W15 Cost Lag | Low | Use static pricing map; update via Phase 26 provider flexibility. |

## Success Metrics {#success}

- **Correctness**: 0 occurrences of plan loss due to context overflow in standard 128k models.
- **W15 Compliance**: 100% of Activity Journal entries contain estimated USD cost.
- **Efficiency**: >15% increase in Plan context utilization via dynamic reallocation.

---
**Backward Compatibility**: Default budgets mirror existing hardcoded values (4000 memory) for unknown models.

**Last Updated**: 2026-04-02
