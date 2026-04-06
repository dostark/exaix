---
agent: senior-coder
scope: dev
title: "Phase 62: Global Prompt Budget Coordinator (W7 & W15 Remediation)"
short_summary: Introduce a PromptBudgetAllocator service with dynamic reallocation and cost tracking to manage context windows and prevent silent truncation.
version: 1.4
topics:
  - context-window
  - budgeting
  - llm
  - tokens
  - cost-tracking
  - loop-history
  - W7
  - W15
---

## Phase 62: Global Prompt Budget Coordinator

## Status: 📋 Planning

**Author**: Comet Assistant (via senior-coder Blueprint)
**Date**: 2026-04-02
**Impact Level**: H (Core Prompt Logic, Cost Control)
**Risk Level**: M (Affects core prompt assembly logic across multiple services)
**Phase Dependencies**: Phase 60, Phase 61
**Blocking Phases**: None

## Executive Summary

Exaix currently suffers from a critical architectural gap (**W7**) where prompt construction relies on hardcoded character limits (e.g., 4000 for Memory, 2000 for Skills). These limits are model-agnostic and frequently cause the **Execution Plan**—which is typically appended at the end of the prompt—to be silently truncated when the combined context exceeds a provider's window. This leads to agent "hallucinations" or complete failures in complex tasks.

Furthermore, the lack of a centralized tracking mechanism (**W15**) prevents Exaix from providing cost transparency or enforcing daily budgets. This phase introduces a model-aware `PromptBudgetAllocator` that replaces static limits with a dynamic "waterfall" reallocation strategy, ensuring critical sections like the Plan and Portal Knowledge always receive maximum possible context.

### **Design Principles**

- **Model-Awareness over Hardcoding** — Budgets are derived from the actual `max_tokens` of the selected provider.
- **Zero Silent Truncation** — The system must calculate and enforce limits _before_ the prompt reaches the LLM.
- **Waterfall Reallocation** — Unused budget from low-priority sections (e.g., empty Memory) is automatically gifted to high-priority sections (Plan, Portal Knowledge).
- **Cost Transparency** — Every request is logged with an estimated USD cost based on token usage.

### **Current (W7 Hardcoded)**

├── Memory (Hardcoded 4000 chars)
├── Skills (Hardcoded 2000 chars)
├── ...
└── Final Prompt (May overflow -> Silent Truncation of Plan at the end)"

### **Target (Phase 62)**

├── BudgetAllocator.allocate(model_id)
│ ├── 10% Safety Buffer
│ ├── Base Weights (Plan=35%, Memory=10%, etc.)
│ └── Waterfall Surplus -> Plan & Portal Knowledge
├── Services truncate content to provided budgets
└── Final Prompt (Guaranteed within window + Plan preserved)"

## Weakness Remediation Mapping Matrix {#matrix}

Each weakness and its remediation is mapped across the three Exaix editions (Solo 🟢 / Team 🔵 / Enterprise 🟣).

| #       | Weakness                            | Solo 🟢     | Team 🔵     | Enterprise 🟣 | Fix Delivery Tier   | Notes                                          |
| :------ | :---------------------------------- | :---------- | :---------- | :------------ | :------------------ | :--------------------------------------------- |
| **W7**  | No global prompt budget coordinator | ❌ Affected | ❌ Affected | ❌ Affected   | 🟢 All (Core)       | Critical for basic reliability.                |
| **W15** | Missing token/cost persistence      | ❌ Affected | ⚠️ Partial  | 🟣 Upgrade    | 🟢 All (Estimation) | Enterprise adds real-time billing integration. |

## Implementation Plan

### Step 62.1: Schema & Constants Foundation

- **Action**: Define `IPromptBudget` and model-specific context limits.
- **Justification**: Establishes the source of truth for all allocation logic.

**Success Criteria:**

- [x] `src/shared/schemas/prompt_budget.ts` defines `ZPromptBudget` with a specific `loopHistory` category.
- [x] `src/shared/constants.ts` includes `MODEL_CONTEXT_WINDOWS`, `MODEL_PRICING_MAP`, and `SECTION_FLOORS` (minimum reserved tokens for System/Plan).
- [x] Heuristic 4:1 character-to-token ratio established as safe default.

**Planned Tests:**

- ✅ **Unit**: `tests/schemas/prompt_budget_schema_test.ts` — verify Zod validation.

**✅ IMPLEMENTED** — `src/shared/schemas/prompt_budget.ts`, 5/5 tests passing

### Step 62.2: PromptBudgetAllocator Implementation

- **Action**: Create the centralized service to calculate and reallocate budgets.
- **Justification**: The core engine for dynamic context management.

**Success Criteria:**

- [x] `PromptBudgetAllocator.allocate()` correctly calculates base shares, enforcing `SECTION_FLOORS`.
- [x] `Waterfall` logic successfully shifts surplus from empty Memory/Skills/History to the **Plan** and **System** sections.
- [x] Token counting logic supports both heuristic and (optional) fast local BPE tokenization (e.g. via `transformers.js` or `tiktoken` port).

**Implemented Tests:**

- ✅ **Unit**: `tests/unit/services/prompt_budget_allocator_test.ts` — 5/5 tests passing (allocation with waterfall, base weights, floor enforcement, default fallback).
- ✅ **Unit**: `tests/unit/services/token_counter_test.ts` — 5/5 tests passing (heuristic accuracy, edge cases, constant verification).

**✅ IMPLEMENTED** — `src/services/context/prompt_budget_allocator.ts`, `src/services/context/token_counter.ts`, 10/10 tests passing

### Step 62.3: Context Service Refactoring

- **Action**: Update `SessionMemoryService` and `SkillsService` to respect dynamic budgets.
- **Justification**: Enforces the allocated limits at the source of context generation.

**Success Criteria:**

- [ ] `SessionMemoryService.lookupMemories` accepts a token cap.
- [ ] `SkillsService.matchSkills` respects the provided budget.
- [ ] Zero occurrences of hardcoded "4000" or "2000" character strings in service code.

**Planned Tests:**

- **Integration**: `tests/integration/services/memory_budget_enforcement_test.ts`.

### Step 62.4: Executor Integration & W15 Cost Logging

- **Action**: Wire the allocator into `AgentExecutor` and log costs to the Activity Journal.
- **Justification**: Completes the loop and provides user-facing cost transparency.

**Success Criteria:**

- [ ] `AgentExecutor` requests budget before assembling the final prompt.
- [ ] Activity Journal entries include `usage.tokens` and `usage.cost_usd_estimate`.
- [ ] `exactl journal` CLI command displays estimated cost per request.

**Planned Tests:**

- **Functional**: `tests/functional/agent/cost_logging_test.ts`.
- **End-to-End**: `tests/e2e/context_overflow_recovery_test.ts`.

## Risks & Mitigations

| Risk                          | Impact | Likelihood | Mitigation                                              |
| :---------------------------- | :----- | :--------- | :------------------------------------------------------ |
| **R1: Token Underestimation** | Medium | Medium     | Use a conservative 10% "Safety Margin" buffer.          |
| **R2: Performance Overhead**  | Low    | Low        | Use fast heuristic counting; cache pricing maps.        |
| **R3: Plan Truncation**       | High   | Low        | Set Plan priority to "Critical" in the waterfall logic. |

## Success Metrics

- [ ] **0% Plan Loss** — Zero occurrences of execution plan truncation in supported models.
- [ ] **100% W15 Compliance** — All requests log estimated USD cost to the SQLite journal.
- [ ] **>90% Utilization** — High-priority sections use >90% of available tokens when needed.

**Agent Instructions**: Follow the implementation steps in sequence. Do not proceed to the next step until all "Planned Tests" for the current step pass with `deno task test`.
