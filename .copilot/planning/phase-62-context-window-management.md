---
agent: senior-coder
scope: dev
title: "Phase 62: Global Prompt Budget Coordinator (W7 & W15 Remediation)"
short_summary: Introduce a policy-aware PromptBudgetAllocator service with distinct cloud (strict, on) and local LLM (relaxed, off) budget modes, dynamic reallocation, and cost tracking to manage context windows and prevent silent truncation.
version: 1.5
topics:
  - context-window
  - budgeting
  - llm
  - tokens
  - cost-tracking
  - loop-history
  - local-llm
  - provider-strategy
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

Furthermore, the lack of a centralized tracking mechanism (**W15**) prevents Exaix from providing cost transparency or enforcing daily budgets. This phase introduces a **policy-aware** `PromptBudgetAllocator` that replaces static limits with a dynamic "waterfall" reallocation strategy, ensuring critical sections like the Plan and Portal Knowledge always receive maximum possible context.

### Cloud vs Local LLM Policy Split

Budget enforcement is **not a one-size-fits-all** concern. Cloud LLMs (OpenAI, Anthropic, Google) have hard, metered context windows where overflows incur real cost and silent truncation risk. Local LLMs (Ollama, LM Studio, local llama.cpp) are cost-free, typically self-hosted, and users often configure unusually large or small context sizes. Enforcing strict budgets by default on local models would be unnecessarily restrictive and would break privacy-first offline workflows.

**Default Policy:**

| Provider type | Budget enforcement    | Context window fallback           |
| :------------ | :-------------------- | :-------------------------------- |
| Cloud         | ✅ Enforced (strict)  | Exact model window                |
| Local         | ⬜ Disabled (relaxed) | Conservative local fallback (32k) |

### **Design Principles**

- **Model-Awareness over Hardcoding** — Budgets are derived from the actual `max_tokens` of the selected provider.
- **Zero Silent Truncation** — The system must calculate and enforce limits _before_ the prompt reaches the LLM.
- **Waterfall Reallocation** — Unused budget from low-priority sections (e.g., empty Memory) is automatically gifted to high-priority sections (Plan, Portal Knowledge).
- **Cost Transparency** — Every request is logged with an estimated USD cost based on token usage.
- **Policy Separation** — Cloud and local providers have different default enforcement postures that can each be independently configured.
- **Local First, Never Block** — Local LLM workflows must never be gated by budget enforcement unless the user explicitly enables it. The default is always relaxed for local providers.
- **Configurable Overrides** — Both cloud and local enforcement defaults are overridable per user config (`budget_enforcement.cloud` and `budget_enforcement.local`).

### **Current (W7 Hardcoded)**

├── Memory (Hardcoded 4000 chars)
├── Skills (Hardcoded 2000 chars)
├── ...
└── Final Prompt (May overflow -> Silent Truncation of Plan at the end)"

### **Target (Phase 62) — Cloud LLM (Strict Mode)**

├── BudgetAllocator.allocate(modelId, policy="cloud")
│ ├── 10% Safety Buffer (from exact model window)
│ ├── Base Weights (Plan=35%, Memory=10%, etc.)
│ └── Waterfall Surplus -> Plan & Portal Knowledge
├── Services truncate content to provided budgets
└── Final Prompt (Guaranteed within window + Plan preserved)"

### **Target (Phase 62) — Local LLM (Relaxed Mode, default OFF)**

├── BudgetAllocator.allocate(modelId, policy="local")
│ ├── Enforcement disabled → pass-through budget (sections uncapped)
│ ├── Window = Local fallback (32k) or config-provided override
│ └── No waterfall: sections are advisory only
└── Final Prompt (Unrestricted; user trusts their local context size)"

## Weakness Remediation Mapping Matrix {#matrix}

Each weakness and its remediation is mapped across the three Exaix editions (Solo 🟢 / Team 🔵 / Enterprise 🟣).

| #       | Weakness                            | Solo 🟢     | Team 🔵     | Enterprise 🟣 | Fix Delivery Tier   | Notes                                          |
| :------ | :---------------------------------- | :---------- | :---------- | :------------ | :------------------ | :--------------------------------------------- |
| **W7**  | No global prompt budget coordinator | ❌ Affected | ❌ Affected | ❌ Affected   | 🟢 All (Core)       | Critical for basic reliability.                |
| **W15** | Missing token/cost persistence      | ❌ Affected | ⚠️ Partial  | 🟣 Upgrade    | 🟢 All (Estimation) | Enterprise adds real-time billing integration. |

## Implementation Plan

### Step 62.1: Schema & Constants Foundation

- **Action**: Define `IPromptBudget`, model-specific context limits, and budget policy config schema.
- **Justification**: Establishes the source of truth for all allocation logic, including cloud/local policy defaults.

**Success Criteria:**

- [x] `src/shared/schemas/prompt_budget.ts` defines `ZPromptBudget` with a specific `loopHistory` category.
- [x] `src/shared/constants.ts` includes `MODEL_CONTEXT_WINDOWS`, `MODEL_PRICING_MAP`, and `SECTION_FLOORS` (minimum reserved tokens for System/Plan).
- [x] Heuristic 4:1 character-to-token ratio established as safe default.
- [x] `src/shared/constants.ts` adds `LOCAL_PROVIDER_PREFIXES` — array of provider ID prefixes considered "local" (e.g., `["ollama:", "lmstudio:", "local:"]`).
- [x] `src/shared/constants.ts` adds `LOCAL_MODEL_CONTEXT_WINDOW_FALLBACK` — conservative local fallback window (32,768 tokens).
- [x] `src/shared/constants.ts` adds `DEFAULT_CLOUD_BUDGET_ENFORCEMENT_ENABLED = true` and `DEFAULT_LOCAL_BUDGET_ENFORCEMENT_ENABLED = false`.
- [x] `src/shared/schemas/prompt_budget.ts` adds `ZBudgetPolicy` schema: `{ cloud: boolean, local: boolean }` with defaults above.

**Planned Tests:**

- ✅ **Unit**: `tests/schemas/prompt_budget_schema_test.ts` — verify Zod validation.
- ✅ **Unit**: `tests/schemas/prompt_budget_schema_test.ts` — verify `ZBudgetPolicy` defaults, local prefix matching, and fallback constant value.

**✅ IMPLEMENTED** — `src/shared/schemas/prompt_budget.ts`, `src/shared/constants.ts`, 10/10 tests passing

### Step 62.2: PromptBudgetAllocator Implementation

- **Action**: Create the centralized, policy-aware service to calculate and reallocate budgets.
- **Justification**: The core engine for dynamic context management with cloud/local policy separation.

**Success Criteria:**

- [x] `PromptBudgetAllocator.allocate()` correctly calculates base shares, enforcing `SECTION_FLOORS`.
- [x] `Waterfall` logic successfully shifts surplus from empty Memory/Skills/History to the **Plan** and **System** sections.
- [x] Token counting logic supports both heuristic and (optional) fast local BPE tokenization (e.g. via `transformers.js` or `tiktoken` port).
- [x] Allocator accepts a `BudgetPolicy` (`{ cloud: boolean, local: boolean }`) as a constructor or call-site option.
- [x] Allocator detects provider type from `modelId` prefix using `LOCAL_PROVIDER_PREFIXES` to determine which policy applies.
- [x] When local model + enforcement disabled (default): `allocate()` returns a **pass-through budget** — sections set to `Infinity` (or the local fallback window uncapped), waterfall skipped, `safetyBufferTokens = 0`.
- [x] When local model + enforcement enabled (opt-in): allocator uses `LOCAL_MODEL_CONTEXT_WINDOW_FALLBACK` (32k) instead of the cloud fallback (128k), applies same waterfall logic.
- [x] When unknown model ID that is not local: allocator applies cloud strict mode with the cloud fallback window.
- [x] Both policies are independently toggleable via config (Step 62.1 `ZBudgetPolicy`); runtime value can be passed from `exa.config.toml`.

**Implemented Tests:**

- ✅ **Unit**: `tests/unit/services/prompt_budget_allocator_test.ts` — 5/5 tests passing (allocation with waterfall, base weights, floor enforcement, default fallback).
- ✅ **Unit**: `tests/unit/services/token_counter_test.ts` — 5/5 tests passing (heuristic accuracy, edge cases, constant verification).
- ✅ **Unit**: `tests/unit/services/prompt_budget_allocator_test.ts` extended with policy-aware cases:
  - Local model with enforcement disabled → pass-through budget (sections uncapped).
  - Local model with enforcement enabled → uses 32k fallback, waterfall applies.
  - Cloud model (unknown ID) → uses cloud fallback (128k), strict mode.
  - Policy override (cloud enforcement disabled) → relaxed for cloud model.

**✅ IMPLEMENTED** — `src/services/context/prompt_budget_allocator.ts`, `src/services/context/token_counter.ts`, 14/14 tests passing

### Step 62.3: Context Service Refactoring

- **Action**: Update `SessionMemoryService` and `SkillsService` to respect dynamic budgets.
- **Justification**: Enforces the allocated limits at the source of context generation.

**Success Criteria:**

- [x] `SessionMemoryService.lookupMemories` accepts a token cap.
- [x] `SkillsService.matchSkills` respects the provided budget.
- [x] Zero occurrences of hardcoded "4000" or "2000" character strings in service code.

**Planned Tests:**

- ✅ **Integration**: `tests/integration/services/memory_budget_enforcement_test.ts`.

**✅ IMPLEMENTED** — `src/services/memory/session_memory.ts`, `src/services/skills/skills.ts`, 2/2 tests passing

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

| Risk                                   | Impact | Likelihood | Mitigation                                                                                            |
| :------------------------------------- | :----- | :--------- | :---------------------------------------------------------------------------------------------------- |
| **R1: Token Underestimation**          | Medium | Medium     | Use a conservative 10% "Safety Margin" buffer (cloud only; local skips this when enforcement is off). |
| **R2: Performance Overhead**           | Low    | Low        | Use fast heuristic counting; cache pricing maps.                                                      |
| **R3: Plan Truncation**                | High   | Low        | Set Plan priority to "Critical" in the waterfall logic.                                               |
| **R4: Local Model Window Mismatch**    | Medium | High       | Use conservative 32k fallback; document that users can override per model in `exa.config.toml`.       |
| **R5: Policy Bypass for Cloud Models** | High   | Low        | Enforce strict cloud policy by default; require explicit config opt-out with warning logged.          |
| **R6: Local Prefix Detection Gap**     | Low    | Medium     | Maintain `LOCAL_PROVIDER_PREFIXES` constant; log a warning for unrecognised models, treat as cloud.   |

## Success Metrics

- [ ] **0% Plan Loss** — Zero occurrences of execution plan truncation in supported cloud models.
- [ ] **100% W15 Compliance** — All cloud requests log estimated USD cost to the SQLite journal; local requests log `$0.00`.
- [ ] **>90% Utilization** — High-priority sections use >90% of available tokens when cloud enforcement is active.
- [ ] **Local Workflow Unblocked** — Local LLM requests complete without budget enforcement errors by default.
- [ ] **Policy Toggle Verified** — Integration test confirms enabling/disabling enforcement per policy type changes allocator behavior at runtime.

**Agent Instructions**: Follow the implementation steps in sequence. Do not proceed to the next step until all "Planned Tests" for the current step pass with `deno task test`.
