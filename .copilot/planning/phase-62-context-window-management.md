---
agent: senior-coder
scope: dev
title: "Phase 62: Global Prompt Budget Coordinator (W7 & W15 Remediation)"
short_summary: Introduce a policy-aware PromptBudgetAllocator service with distinct cloud (strict, on) and local LLM (relaxed, off) budget modes, dynamic reallocation, and cost tracking to manage context windows and prevent silent truncation.
version: "1.7"
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

## Status: 🚧 Gap Remediation In Progress

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
- **Architecture Notes**: Establishes the source of truth for all allocation logic, including cloud/local policy defaults.

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
- **Architecture Notes**: The core engine for dynamic context management with cloud/local policy separation.

**Success Criteria:**

- [x] `PromptBudgetAllocator.allocate()` correctly calculates base shares, enforcing `SECTION_FLOORS`.
- [x] `Waterfall` logic successfully shifts surplus from empty Memory/Skills/History to the **Plan** and **System** sections.
- [x] Token counting uses the 4:1 heuristic (`TOKEN_ESTIMATION_CHARS_PER_TOKEN = 4`); BPE tokenization is deferred to a future phase.
- [x] Allocator accepts a `BudgetPolicy` (`{ cloud: boolean, local: boolean }`) as a constructor or call-site option.
- [x] Allocator detects provider type from `modelId` prefix using `LOCAL_PROVIDER_PREFIXES` to determine which policy applies.
- [x] When local model + enforcement disabled (default): `allocate()` returns a **pass-through budget** — sections set to `totalTokens` (= `LOCAL_MODEL_CONTEXT_WINDOW_FALLBACK = 32_768` for unknown local models), waterfall skipped, `safetyBufferTokens = 0`.
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
- **Architecture Notes**: Enforces the allocated limits at the source of context generation.

**Success Criteria:**

- [x] `SessionMemoryService.lookupMemories` accepts a token cap.
- [x] `SkillsService.matchSkills` respects the provided budget.
- [x] Zero occurrences of hardcoded "4000" or "2000" character strings in service code.

**Planned Tests:**

- ✅ **Integration**: `tests/integration/services/memory_budget_enforcement_test.ts`.

**✅ IMPLEMENTED** — `src/services/memory/session_memory.ts`, `src/services/skills/skills.ts`, 2/2 tests passing

### Step 62.4: Executor Integration & W15 Cost Logging

- **Action**: Wire the allocator into `AgentExecutor` and log costs to the Activity Journal.
- **Architecture Notes**: Completes the loop and provides user-facing cost transparency.

**Success Criteria:**

- [x] `AgentExecutor` requests budget before assembling the final prompt.
- [x] Activity Journal entries include `usage.tokens` and `usage.cost_usd_estimate`.
- [x] `exactl journal` CLI command displays estimated cost per request.

**Planned Tests:**

- ✅ **Integration**: `tests/integration/agent/cost_logging_test.ts`.
- ✅ **Integration**: `tests/integration/agent/context_overflow_recovery_test.ts`.

**✅ IMPLEMENTED** — `src/services/agent/agent_executor.ts`, `src/cli/formatters/journal_formatter.ts`, 4/4 targeted files passing

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

- [x] **0% Plan Loss** — Plan section receives allocated budget via waterfall; `applyTokenBudget()` enforces limits before prompt assembly (`context_overflow_recovery_test.ts`).
- [x] **100% W15 Compliance** — All requests log `usage.tokens` and `usage.cost_usd_estimate` to the SQLite journal; local/no-pricing models emit `cost_usd_estimate: 0` (`cost_logging_test.ts`).
- [x] **>90% Utilization** — Waterfall reallocation redistributes unused section budget to Plan and PortalKnowledge (`prompt_budget_allocator_test.ts` — surplus reallocation test).
- [x] **Local Workflow Unblocked** — Local model (e.g. `ollama:*`) returns pass-through budget (sections uncapped) by default; no enforcement errors (`prompt_budget_allocator_test.ts` — local relaxed test).
- [x] **Policy Toggle Verified** — Tests confirm cloud policy can be disabled and local policy can be enabled independently, changing allocator behavior at runtime (`prompt_budget_allocator_test.ts` — 4 policy-aware tests).

**Agent Instructions**: Follow the implementation steps in sequence. Do not proceed to the next step until all "Planned Tests" for the current step pass with `deno task test`.

---

## Deep Review — 2026-04-07

**Reviewer**: GitHub Copilot (via `#post-gap-analysis`)
**Phase verified against**: v1.5

All source files referenced by the implementation plan were read and inspected against the plan's success criteria. Security Phase 3b was applied to every step.

---

### Gap Summary

| ID | Gap (short)                                                                                                                   | Severity       | Plan Section               | Verified in Code? |
| -- | ----------------------------------------------------------------------------------------------------------------------------- | -------------- | -------------------------- | ----------------- |
| G1 | Steps 62.1–62.4 use `Justification` label — §F requires `Architecture Notes`                                                  | 🔵 Conceptual  | All steps                  | ✅                |
| G2 | Pass-through success criterion says "sections = `Infinity`" but `_buildRelaxedBudget` uses `totalTokens` (32768)              | 🔵 Conceptual  | Step 62.2 success criteria | ✅                |
| G3 | `ZBudgetPolicy` not wired into `ConfigSchema` — `exa.config.toml` override claimed but absent                                 | 🟡 Feasibility | Step 62.2 success criteria | ✅                |
| G4 | Plan claims BPE tokenization supported; `TokenCounter` implements heuristic only                                              | 🔵 Conceptual  | Step 62.2 success criteria | ✅                |
| G5 | `sections.skills` and `sections.loopHistory` allocated by `PromptBudgetAllocator` but never applied in `buildExecutionPrompt` | 🟠 Testing     | Step 62.4 success criteria | ✅                |

### Security Phase 3b

- **Step 62.4** (`estimateExecutionUsage`): uses string `.length` values only — no payload content is exposed. Cost journal entry `{ tokens: N, cost_usd_estimate: N }` contains no secrets or API keys. ✅ No security gap.
- **Step 62.1** (`ZBudgetPolicy`): boolean fields with safe Zod defaults; no injection surface. ✅ No security gap.
- No OWASP Top 10 issues found across the Phase 62 implementation.

---

### Detailed Gap Entries

#### G1 — §F sub-section label non-compliance (all 4 steps)

**Where**: Steps 62.1, 62.2, 62.3, 62.4 — each uses `- **Justification**: ...` instead of the `- **Architecture Notes**: ...` label required by `.copilot/planning/README.md §F`.

**Impact**: Agent traceability tooling (and peer reviewers) that relies on the §F structure to locate DI/pattern rationale will miss these blocks. Low operational risk but blocks §F conformance checks.

---

#### G2: Pass-through budget documented as "Infinity" but implementation caps at the local fallback window

**Where**: Step 62.2 success criterion — `"sections set to Infinity (or the local fallback window uncapped)"`.

**Reality**: `_buildRelaxedBudget` sets every section to `totalTokens`, which resolves to `LOCAL_MODEL_CONTEXT_WINDOW_FALLBACK` (32768) for an unknown local model. Tests in `prompt_budget_allocator_test.ts` and `prompt_budget_schema_test.ts` already assert `sections.system === LOCAL_MODEL_CONTEXT_WINDOW_FALLBACK`, not `Infinity`. The actual behaviour is correct but the plan text misrepresents it.

**Impact**: No runtime risk; however, "uncapped" wording in the plan is misleading and may cause a future implementor to skip the `LOCAL_MODEL_CONTEXT_WINDOW_FALLBACK` floor guard.

---

#### G3 — `ZBudgetPolicy` not wired into `ConfigSchema` / `exa.config.toml`

**Where**: Step 62.2 success criterion — `"Both policies are independently toggleable via config; runtime value can be passed from exa.config.toml"`.

**Reality**: `src/shared/schemas/config.ts` (`ConfigSchema`) has no `budget_enforcement` section. `AgentExecutor` instantiates `new PromptBudgetAllocator()` with no policy argument, meaning the allocator always uses the hardcoded defaults (`cloud: true`, `local: false`). The `ZBudgetPolicy` schema exists but is unreachable from the config system.

**Impact**: The **"Configurable Overrides"** design principle stated in § "Design Principles" is unimplemented. Risk R4's mitigation ("users can override per model in `exa.config.toml`") is also unaddressed. Users who want to enable local-model enforcement must recompile.

---

#### G4 — BPE tokenization described as supported; `TokenCounter` implements heuristic only

**Where**: Step 62.2 success criterion — `"Token counting logic supports both heuristic and (optional) fast local BPE tokenization (e.g. via transformers.js or tiktoken port)"`.

**Reality**: `src/services/context/token_counter.ts` exports `class TokenCounter { countTokens(text): number }` — a single `Math.ceil(text.length / TOKEN_ESTIMATION_CHARS_PER_TOKEN)` call. There is no BPE path, no optional import, and no interface extension point.

**Impact**: Low operational risk (4:1 heuristic is adequate for Phase 62 goals). The claim is false and may mislead future reviewers into believing a BPE path exists.

---

#### G5 — `sections.skills` and `sections.loopHistory` allocated but not applied in prompt assembly

**Where**: `src/services/agent/agent_executor.ts` — `buildExecutionPrompt`.

**Reality**: `buildExecutionPrompt` calls `applyTokenBudget` for exactly four sections: `sections.memory` (→ request), `sections.plan`, `sections.portalKnowledge`, `sections.system`. The `sections.skills` value and `sections.loopHistory` value are computed by the allocator and returned in `IPromptBudget`, but no code ever passes them to `applyTokenBudget` or to the skills/loop-history assembly paths. The waterfall sets these to zero when content is empty (correct), but if skills or loop-history content is present it can silently exceed its allocated budget.

`context_overflow_recovery_test.ts` provides `sections: { skills: 10, loopHistory: 10 }` via a mock allocator but does not assert that oversized skills or loop-history content is truncated — so the test does not catch this gap.

**Impact**: 15% of the total token budget (skills 10% + loopHistory 5%) is allocated but provides no enforcement. On a 128k-token model this is ~19k tokens of unguarded prompt real estate.

---

## Gap Remediation Plan

Steps 62.5–62.8 below address the gaps. Ordered by severity then dependency.
All steps follow the TDD-First policy per .copilot/planning/README.md §F.

### Step 62.5 (G3): Wire `ZBudgetPolicy` into `ConfigSchema` and `AgentExecutor`

- **Actions**:
  - [x] `src/shared/schemas/config.ts`: Add `budget_enforcement: ZBudgetPolicy.optional()` as a top-level field on `ConfigSchema` (mirrors other feature-flag sections like `quality_gate`).
  - [x] `src/services/agent/agent_executor.ts`: In the constructor default parameter, replace `new PromptBudgetAllocator()` with `new PromptBudgetAllocator(config.budget_enforcement ?? {})`.
  - [x] `templates/exa.config.sample.toml`: Add a commented `[budget_enforcement]` block with `cloud = true` and `local = false` and explanatory comments.
- **Architecture Notes**: `ZBudgetPolicy.optional()` with no `.default()` preserves backward compatibility — existing configs that omit the section will continue using constant defaults inside `PromptBudgetAllocator`. No database migration is required. DI is already satisfied: `AgentExecutor` constructor accepts an injected allocator for tests.
- **Planned Tests**:
  - ✅ `tests/config/config_test.ts`: `"ConfigSchema accepts budget_enforcement with cloud = false"` — assert parse succeeds and `config.budget_enforcement.cloud === false`.
  - ✅ `tests/services/agent/agent_executor_test.ts`: `"AgentExecutor: passes budget_enforcement policy to allocator from config"` — provide config with `budget_enforcement: { cloud: false }`, mock allocator, assert it receives `cloud: false`.

**✅ IMPLEMENTED** — `src/shared/schemas/config.ts`, `src/services/agent/agent_executor.ts`, `templates/exa.config.sample.toml`, `tests/config/config_test.ts`, `tests/services/agent/agent_executor_test.ts`; focused tests passed (`deno test --allow-all tests/config/config_test.ts tests/services/agent/agent_executor_test.ts`), plus `deno check`, `deno lint --rules-exclude=no-explicit-any`, `deno task check:style`, and `deno task check:arch`.

- **Success Criteria**:
  - [x] `deno check src/shared/schemas/config.ts` passes.
  - [x] An `exa.config.toml` containing `[budget_enforcement]\ncloud = false` disables cloud enforcement at runtime.
  - [x] All existing config tests pass without modification.

---

### Step 62.6 (G5): Apply `sections.skills` and `sections.loopHistory` budgets in prompt assembly

- **Actions**:
  - [x] `src/shared/schemas/agent_executor.ts` and `src/shared/schemas/input_validation.ts`: Accept optional `skills_context` so prompt assembly can receive a pre-built skills block through the validated execution context.
  - [x] `src/services/agent/agent_executor.ts`: In `buildExecutionPrompt`, apply `applyTokenBudget(skills_context, this.currentPromptBudget?.sections.skills)` before inserting the skills block into the prompt.
  - [x] `src/services/agent/strategies/react_loop_strategy.ts`: Apply the `sections.loopHistory` cap inside `buildPrompt`, trimming oldest history entries first and clipping the newest remaining entry only when needed.
- **Architecture Notes**: The original plan text assumed `AgentRunner` was still the active skills-injection seam for this flow, but the current executor path assembles legacy prompts directly from `IExecutionContext`. The minimal architecture-consistent fix was therefore to admit an optional `skills_context` field into validated execution context and enforce the budget at `AgentExecutor.buildExecutionPrompt()`. `loopHistory` enforcement remains in `ReActLoopStrategy.buildPrompt`, using `sections.loopHistory × TOKEN_ESTIMATION_CHARS_PER_TOKEN` and dropping oldest entries first.
- **Planned Tests**:
  - [x] `tests/integration/agent/context_overflow_recovery_test.ts`: Add assertion that skills content in the assembled prompt is ≤ `sections.skills × TOKEN_ESTIMATION_CHARS_PER_TOKEN` chars when the mock allocator provides `sections.skills = 10`.
  - [x] `tests/services/agent/agent_executor_test.ts`: `"AgentExecutor: skills block in prompt respects sections.skills budget"`.
  - [x] `tests/agents/react_loop_strategy_test.ts`: `"ReActLoopStrategy - caps loop history to configured budget"`.
- **Success Criteria**:
  - [x] Skills content in the assembled prompt never exceeds `sections.skills × TOKEN_ESTIMATION_CHARS_PER_TOKEN` chars.
  - [x] Loop-history block in ReAct prompts never exceeds `sections.loopHistory × TOKEN_ESTIMATION_CHARS_PER_TOKEN` chars.
  - [x] `context_overflow_recovery_test.ts` passes with the new assertions.

**✅ IMPLEMENTED**: Added validated `skills_context` prompt injection with `sections.skills` enforcement, capped ReAct loop history against `sections.loopHistory`, and verified with `deno test --allow-all tests/services/agent/agent_executor_test.ts tests/integration/agent/context_overflow_recovery_test.ts tests/agents/react_loop_strategy_test.ts`, `deno check`, `deno lint --rules-exclude=no-explicit-any ...`, `deno task check:style`, and `deno task check:arch`.

---

### Step 62.7 (G1, G2, G4): Correct plan documentation inaccuracies

- **Actions**:
  - [x] `.copilot/planning/phase-62-context-window-management.md` Steps 62.1–62.4: Rename `- **Justification**:` → `- **Architecture Notes**:` in all four step headers.
  - [x] Step 62.2 success criterion: Replace `"sections set to Infinity (or the local fallback window uncapped)"` with `"sections set to totalTokens (= LOCAL_MODEL_CONTEXT_WINDOW_FALLBACK = 32_768 for unknown local models), safetyBufferTokens = 0"`.
  - [x] Step 62.2 success criterion: Replace `"Token counting logic supports both heuristic and (optional) fast local BPE tokenization (e.g. via transformers.js or tiktoken port)"` with `"Token counting uses the 4:1 heuristic (TOKEN_ESTIMATION_CHARS_PER_TOKEN = 4); BPE tokenization is deferred to a future phase"`.
- **Architecture Notes**: Documentation-only edits. No source code or test changes required.
- **Planned Tests**:

  - ✅ `deno run --allow-read --allow-write scripts/markdown_lint.ts .copilot/planning/phase-62-context-window-management.md` — validates the corrected plan text and structure.

**✅ IMPLEMENTED** — `.copilot/planning/phase-62-context-window-management.md`, markdown lint passing

**Success Criteria**:

- [x] `deno run --allow-read --allow-write scripts/markdown_lint.ts .copilot/planning/phase-62-context-window-management.md` reports zero errors.
- [x] All §F sub-section labels in Steps 62.1–62.4 read "Architecture Notes".

---

### Step 62.8 (§3D Documentation): Update `ARCHITECTURE.md`, cross-reference, and sample config

- **Actions**:
  - [x] `ARCHITECTURE.md`: Add `PromptBudgetAllocator` to the architecture diagram and key-service table, noting the `budget_enforcement` TOML config key and the six prompt sections.
  - [x] `.copilot/cross-reference.md`: Add keyword entries: `budget_enforcement` → `phase-62-context-window-management.md`; `skills_budget` → `phase-62-context-window-management.md`; `loopHistory_budget` → `phase-62-context-window-management.md`.
  - [x] `docs/Exaix_User_Guide.md` §11 (Cost Tracking): Update §11.2 to reference the `[budget_enforcement]` TOML section once Step 62.5 lands.
- **Architecture Notes**: §3D documentation update is mandatory when new TOML config keys are introduced. This step is sequenced after Step 62.5; it may be executed concurrently with Steps 62.6 and 62.7.
- **Planned Tests**:
  - ✅ `deno task docs-agent-validate` — verify no broken links introduced.
  - ✅ `deno task check:arch` — architecture validation passes.

**✅ IMPLEMENTED** — `ARCHITECTURE.md`, `.copilot/cross-reference.md`, `docs/Exaix_User_Guide.md`, and refreshed `.copilot/manifest.json`; `deno task docs-agent-validate` and `deno task check:arch` passing

- **Success Criteria**:

  - [x] `deno task docs-agent-validate` reports zero errors.
  - [x] `.copilot/cross-reference.md` contains a `budget_enforcement` entry pointing to Phase 62.
  - [x] `deno task check:arch` passes.

---

## Phase 3c Review — Traceability & Configurability

> **Performed by:** GitHub Copilot
> **Workflow:** `#post-gap-analysis` Phase 3c
> **Scope:** Event naming constants, payload typing, config-driven values, config validation tests

### Phase 3c Gap Summary

| ID | Gap (short)                                                                   | Severity           | Checklist Item          | In Tests? |
| -- | ----------------------------------------------------------------------------- | ------------------ | ----------------------- | --------- |
| G6 | No config validation test rejecting invalid `budget_enforcement` field values | 🟡 Configurability | Config validation tests | ❌        |

### Phase 3c Detailed Gap Entry

#### G6 — 🟡 Configurability: No config validation test for invalid `budget_enforcement` values

**Evidence:** Step 62.5 (planned) adds `budget_enforcement: ZBudgetPolicy.optional()` to `ConfigSchema` and adds tests for valid values (`cloud: false`). However, no planned or existing test asserts that `ConfigSchema` rejects malformed `budget_enforcement` objects such as:

- `{ cloud: "yes" }` (string instead of boolean)
- `{ cloud: 1 }` (number instead of boolean)
- `{ unknown_field: true }` (extra field — Zod default `strict` vs `passthrough` behavior)

`ZBudgetPolicy` is defined as `z.object({ cloud: z.boolean(), local: z.boolean() })` with `.default()` values. Zod will reject type mismatches at parse time, but this is only safe if callers use `.safeParse()` / `.parse()` (which `ConfigSchema` does via `ZConfig.parse()`). Without an explicit test, a future change to `ZBudgetPolicy` stripping the boolean coercion or switching to `z.coerce.boolean()` could silently allow invalid values.

**Impact:** The `budget_enforcement` config path (added in Step 62.5) has no boundary validation test — violates the Phase 3c configurability requirement: _"at least one test rejecting invalid config values"_ (Checklist item 4).

---

### Phase 3c Gap Remediation

#### Step 62.9 (G6): Config Validation Test for Invalid `budget_enforcement` Values

- **Action**: In `tests/config/config_test.ts` (or the dedicated budget schema test file), add test cases that assert `ConfigSchema.safeParse()` returns `success: false` when `budget_enforcement` contains invalid types.

- **Architecture Notes**: These tests are purely at the schema/parse boundary — no source code changes required. They validate that `ZBudgetPolicy` rejects non-boolean values before they reach `PromptBudgetAllocator`. Tests should be grouped under `"ConfigSchema: budget_enforcement validation"`.

- **Planned Tests**:
  - **Unit**: `tests/config/config_test.ts` — add three cases:
    1. `"ConfigSchema: rejects budget_enforcement.cloud as string"` — parse `{ budget_enforcement: { cloud: "yes", local: false } }` → assert `success === false`.
    1. `"ConfigSchema: rejects budget_enforcement.local as number"` — parse `{ budget_enforcement: { cloud: true, local: 1 } }` → assert `success === false`.
    1. `"ConfigSchema: accepts omitted budget_enforcement (backward compat)"` — parse a config without `budget_enforcement` → assert `success === true` and `config.budget_enforcement === undefined`.

- **Success Criteria**:
  - [ ] All three new test cases exist and pass `deno task test`.
  - [ ] No source code changes are required for this step — purely additive test coverage.
  - [ ] `tests/config/config_test.ts` uses `ConfigSchema.safeParse()` (not `.parse()`) to avoid thrown exceptions in the invalid-type cases.
