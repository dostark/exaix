---
agent: senior-coder
scope: dev
title: "Phase 69: Token & Cost Persistence"
short_summary: "Extract token usage and cost metrics from LLM provider responses, persist them into the Activity Journal per-request, and expose cost auditing via the CLI."
version: "1.2"
topics: ["planning", "roadmap", "architecture", "tdd", "finops", "tokens", "cost", "metrics", "journal"]
---

> [!TIP]
> This document is a specialized extension of the [root .copilot/ guidelines](../README.md).

## Status & Context

**Status**: 🚧 Planning
**Phase Dependencies**: None
**Risk Level**: L — extends existing return types and logging schemas with no behavioral changes to orchestration.

## Executive Summary

- **The Problem**: Token and cost consumption is not persisted per request (Weakness 15). Developers cannot optimize prompt budgets, track project expenses, or measure the efficiency of ReflexiveAgent iterations.
- **The Solution**: Standardize the `IModelProvider` interface to return `usage` data. Update the Activity Journal schema to record these metrics. Introduce an `exactl log cost` command to aggregate and display spending.
- **The Goal**: Provide strict FinOps visibility and prepare the foundation for context-window budget management (Phase 62).

## Current State Analysis

### Key Files

| File | Current Role | Gap |
| ----------------------------------------- | ------------------------------------- | ---------------------------------------- |
| `src/ai/providers/base_provider.ts` | Defines provider generation contracts | Returns `content` only, dropping usage data |
| `src/services/core/event_logger.ts` | Records execution events | No schema fields for tokens/cost |
| `src/cli/main.ts` | CLI routing | Lacks cost reporting commands |

### Constraints

- Not all providers expose cost directly. The system must estimate cost using a known pricing table based on model name and token counts.
- Token usage must be accumulated across parallel flow steps accurately.

### Interfaces Affected

- `src/ai/providers/base_provider.ts:BaseProvider`
- `src/ai/types.ts:IModelProvider`
- `src/services/core/event_logger.ts:IEventLogger`

## Technical Architecture & Detailed Design

### Schemas

```ts
export const ZTokenUsage = z.object({
  promptTokens: z.number().int().min(0),
  completionTokens: z.number().int().min(0),
  totalTokens: z.number().int().min(0),
});

export type ITokenUsage = z.infer<typeof ZTokenUsage>;

// Amend existing IGenerateResult in src/ai/providers/common.ts — do NOT create a new type.
// Add the optional cost_usd field; keep the existing content/usage/model/provider fields.
// IGenerateResult (amended) =
//   content: string          ← already exists (was never "text")
//   usage: ITokenUsage       ← already exists
//   model: string            ← already exists
//   provider: string         ← already exists
//   cost_usd?: number        ← NEW: populated by CostTracker.estimateCost() after generation
```

### Interfaces

```ts
// ICostCalculatorService is NOT a new class — cost estimation is already
// implemented in src/ai/provider_common_utils.ts:calculateCost() and
// src/services/cost/cost_tracker.ts:CostTracker.
// Step 69.2 extends CostTracker with persistEntry() and queryByCriteria() rather
// than introducing a competing implementation.
export interface ICostFilter {
  traceId?: string;
  portal?: string;
  since?: Date;
  model?: string;
}
```

### Logic Flow

```mermaid
flowchart TD
    A[AgentExecutor calls Provider] --> B[Provider API (e.g. Anthropic/OpenAI)]
    B -->|Returns Text + Usage| C[Provider Adapter]
    C --> D[CostCalculatorService estimates USD]
    D --> E[AgentExecutor attaches usage to EventPayload]
    E --> F[EventLogger appends to Journal]
    G[CLI: exactl log cost] -->|Query| F
    G --> H[Render Aggregated Report]
```

### Design Decisions

- **Client-Side Pricing Calculation**: APIs often change pricing or only return tokens. `CostTracker` (at `src/services/cost/cost_tracker.ts`) maintains the pricing table already; `calculateCost()` in `src/ai/provider_common_utils.ts` implements the formula. No new calculator service is needed.
- **Journal Attachment**: Usage is attached to the `AGENT_GENERATION_COMPLETED` event (constant defined in Step 69.0 / `src/constants.ts`), ensuring we can aggregate by `trace_id`, `portal`, or `agent_id`. Cost is stored as `cost_usd` (snake_case, matching the SQL schema convention).

## Implementation Plan (Step-by-Step)

### Step 69.0: Define Cost & Event Constants

1. **Actions**

- Add the following constant to `src/constants.ts`:
  - `AGENT_GENERATION_COMPLETED = "agent.generation_completed"`

1. **Architecture Notes**

- All subsequent steps must use `AGENT_GENERATION_COMPLETED` rather than the inline string `"agent.generation_completed"` when emitting or handling generation events.
- Field convention for SQL persistence is `cost_usd` (snake_case); TypeScript domain objects may surface this as `costUsd` via a repository mapping layer, but the DB column name must remain `cost_usd`.

1. **Planned Tests**

- No dedicated test file; the constant is exercised by tests in Steps 69.3 and 69.4.

1. **Success Criteria**

- `src/constants.ts` exports `AGENT_GENERATION_COMPLETED` without compile errors.
- No inline string `"agent.generation_completed"` appears in Steps 69.1–69.4 implementation files.

### Step 69.1: Provider Return Type Updates

1. **Actions**

- Extend `IGenerateResult` in `src/ai/providers/common.ts` with an optional `cost_usd?: number` field.
- Update `ClaudeProvider`, `OpenAIProvider`, `OllamaProvider` to parse and map their respective usage objects into `IGenerateResult.usage`; call `calculateCost()` from `src/ai/provider_common_utils.ts` to populate `cost_usd`.

1. **Architecture Notes**

- **Full call-site audit required before merging.** Run `grep -rn '\.generate('` across the codebase. Known call sites that must be updated:
  - `src/ai/rate_limited_provider.ts:RateLimitedProvider.generate()` — delegate wrapper; must forward `cost_usd` from the inner result.
  - `src/ai/providers/lazy_provider.ts:LazyProvider.generate()` — delegate wrapper; same as above.
  - `src/services/agent/strategies/react_loop_strategy.ts:ReActLoopStrategy.execute()` — primary call site for agent LLM steps.
  - `src/services/plan/plan_executor.ts:PlanExecutor` — calls provider for plan steps.
  - `AgentExecutor` and `ReflexiveAgent` — must unpack `result.content` (not `result.text`) and preserve `result.usage` and `result.cost_usd`.
  - All test mock factories for `IModelProvider` — `generate()` return type must be updated.

1. **Planned Tests**

- `tests/ai/providers/provider_usage_mapping_test.ts`

1. **Success Criteria**

- All active providers successfully return token counts in `IGenerateResult.usage`.
- Orchestration layer correctly handles `result.content` (not `result.text`) from the updated return type.

### Step 69.2: Extend CostTracker for Persistence and Querying

1. **Actions**

- Extend `CostTracker` in `src/services/cost/cost_tracker.ts` with:
  - `persistEntry(record: IProviderCostRecord): Promise<void>` — writes a per-generation record to SQLite.
  - `queryByCriteria(filter: ICostFilter): Promise<IProviderCostRecord[]>` — filters by `traceId`, `portal`, `since`, and `model`.
- Do **not** create `src/services/finops/cost_calculator.ts` — this would duplicate the existing `calculateCost()` in `src/ai/provider_common_utils.ts` and the pricing table already in `CostTracker`.

1. **Architecture Notes**

- Missing models default to a $0.00 `cost_usd` estimate but preserve accurate token counts.
- All cost computation must use the single `calculateCost()` function from `src/ai/provider_common_utils.ts` to ensure consistent pricing across the codebase.

1. **Planned Tests**

- `tests/services/cost/cost_tracker_test.ts` (extend existing file with persistence and query-filter assertions)

1. **Success Criteria**

- Accurate USD calculations for prompt + completion combinations based on the pricing table.
- `queryByCriteria` correctly filters records by all supported filter dimensions.

### Step 69.3: Journal Schema & Logging

1. **Actions**

- Update `IEventLogger` schema and SQLite schema to include `prompt_tokens`, `completion_tokens`, and `cost_usd`.
- Ensure `EventLogger.log()` in `src/services/core/event_logger.ts` persists these fields when present in the payload.
- Emit cost data under the `AGENT_GENERATION_COMPLETED` event name (from Step 69.0).

1. **Architecture Notes**

- Ensure DB migrations (if applicable) use `DEFAULT 0` for existing records.

1. **Planned Tests**

- `tests/integration/services/event_logger_cost_persistence_test.ts`

1. **Success Criteria**

- Token and cost data are successfully written to and read from the persistence layer.

### Step 69.4: CLI Aggregation Command

1. **Actions**

- Create `src/cli/commands/log_cost.ts`.
- Implement `exactl log cost [--trace <id>] [--portal <name>] [--since <date>]`.
- Use SQL aggregations (`SUM(prompt_tokens)`, etc.) for fast reporting.
- **All filter values (`--trace`, `--portal`, `--since`) MUST be passed as parameterized SQLite bind parameters** (e.g., `db.query('... WHERE trace_id = ?', [traceId])`) — never string-interpolated into query statements (OWASP A03 — SQL Injection).

1. **Architecture Notes**

- Render a clean ASCII table with breakdown by model, agent, or trace depending on flags.

1. **Planned Tests**

- `tests/cli/log_cost_command_test.ts` — include a security test asserting that passing `'; DROP TABLE costs;--` as `--trace` produces an error or empty result, not a DB mutation (OWASP A03).

1. **Success Criteria**

- CLI accurately reports aggregated totals.
- Filters (`--trace`, `--since`) successfully narrow the dataset.

## Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation Strategy |
| ----------------------------- | ------ | ---------: | ---------------------------------------------------------------------------------------- |
| R1: Pricing table drift | Low | High | Treat USD as an "estimate". Add a note in CLI output. Tokens are the source of truth. |
| R2: Streaming usage omissions | Medium | Medium | Some APIs don't send usage in streams. Ensure the final chunk is parsed for usage stats. |

## Success Metrics (Quantitative)

- 100% of LLM calls log token counts in the Activity Journal.
- Cost reporting CLI executes over 10,000 records in < 50ms (SQLite aggregation).

## Backward Compatibility

- Old journal records without token data will aggregate as 0 tokens / $0.00 cost without breaking queries.
- Provider interface update requires updating all existing provider implementations simultaneously, but breaks no downstream logic once unpacked.

---

## Pre-Gap Analysis — 2026-04-08

### Assessment: ✅ All 8 gaps resolved — plan updated 2026-04-08; ready for implementation

> Initial gaps were identified by pre-gap analysis on 2026-04-08. All gaps have been
> resolved in the plan body above. This section is retained as a record.

### Gap Summary

| ID | Gap (short) | Severity | Plan Section | Blocks Coding? |
| --- | ----------- | -------- | ------------ | -------------- |
| G1 | File paths for `base_provider.ts` and `IModelProvider` are wrong | 🔴 Critical | Key Files / Interfaces Affected / Steps 69.1–69.2 | ✅ Resolved |
| G2 | `IActivityJournal` interface does not exist — real interface is `IEventLogger` at wrong path | 🔴 Critical | Key Files / Interfaces Affected / Step 69.4 | ✅ Resolved |
| G3 | `ZGenerationResult` duplicates `IGenerateResult` with conflicting field names | 🔴 Critical | Technical Architecture / Step 69.2 | ✅ Resolved |
| G4 | `src/services/finops/cost_calculator.ts` would duplicate `calculateCost()` and `CostTracker` already in codebase | 🔴 Critical | Key Files / Step 69.3 | ✅ Resolved |
| G5 | `provider.generate()` call-site audit is incomplete — plan lists 2 of ~5 affected sites | 🟡 Feasibility | Step 69.2 | ✅ Resolved |
| G6 | Test paths `tests/unit/services/providers/` and `tests/unit/services/finops/` don't exist | 🟠 Testing | Step 69.1 / Step 69.3 | ✅ Resolved |
| G7 | CLI `--trace`/`--portal`/`--since` values may feed SQL queries — parameterized query requirement not stated | 🔒 Security | Step 69.4 | ✅ Resolved |
| G8 | `agent.generation_completed` event name is an inline string; `costUsdEstimate` conflicts with existing `cost_usd` field convention in `TokenMap` | 🟡 Traceability | Step 69.3 / Technical Architecture | ✅ Resolved |

### Detailed Gap Entries

#### G1 — 🔴 Critical: Base provider and `IModelProvider` file paths are wrong

- **Location in plan:** Key Files table — "`src/services/providers/base*provider.ts`"; Interfaces Affected — "`src/services/providers/base*provider.ts:IModelProvider`"
- **Problem:** The actual paths are `src/ai/providers/base_provider.ts` (class `BaseProvider`) and `src/ai/types.ts:IModelProvider`. There is no `src/services/providers/` directory in the project.
- **Impact:** Steps 69.1 and 69.2 would create ghost files instead of modifying the real modules.
- **To fix:** Replace all plan references to `src/services/providers/base*provider.ts` with `src/ai/providers/base*provider.ts`; update `IModelProvider` reference to `src/ai/types.ts:IModelProvider`.

---

#### G2 — 🔴 Critical: `IActivityJournal` does not exist; `event_logger.ts` path is wrong

- **Location in plan:** Key Files table — "`src/services/event*logger.ts`"; Interfaces Affected — "`src/services/event*logger.ts:IActivityJournal`"
- **Problem:** The actual file is `src/services/core/event_logger.ts`. The interface name is `IEventLogger`, not `IActivityJournal`. Searching the entire codebase finds zero occurrences of `IActivityJournal`.
- **Impact:** Step 69.4 imports a non-existent interface, producing a compile error on the first line of the implementation.
- **To fix:** Replace all plan references to `src/services/event*logger.ts` with `src/services/core/event*logger.ts` and `IActivityJournal` with `IEventLogger`.

---

#### G3 — 🔴 Critical: `ZGenerationResult` duplicates `IGenerateResult` with conflicting field names

- **Location in plan:** Technical Architecture / Step 69.2 — introduces `ZGenerationResult` with fields `text: string`, `usage: ZTokenUsage`, `costUsdEstimate: number`, `model: string`, `provider: string`
- **Problem:** `IGenerateResult` already exists in `src/ai/providers/common.ts` with fields: `content: string`, `usage: { promptTokens, completionTokens, totalTokens }`, `model: string`, `provider: string`. The plan's `text` conflicts with the existing `content`; the plan's `costUsdEstimate` does not exist in `IGenerateResult` (cost is encapsulated in `CostTracker`, not returned inline in `IGenerateResult`). Adding a second interface with different field names for the same concept would require all call sites to branch on which interface they received.
- **Impact:** Either the existing `IGenerateResult` must be ignored (siloed duplication) or every existing consumer — `ReActLoopStrategy`, `RateLimitedProvider`, `LazyProvider`, `PlanExecutor`, all test stubs — must be updated to juggle two interfaces. Either path is a compile error until resolved.
- **To fix:** Remove `ZGenerationResult` from the plan. Instead, extend `IGenerateResult` in `src/ai/providers/common.ts` with an optional `cost?: ICostEntry` field (reusing the `ICostEntry` from `src/services/cost/cost_tracker.ts`). Rename `text` → `content` throughout. Update Step 69.2 to describe amending `IGenerateResult` rather than creating a new type.

---

#### G4 — 🔴 Critical: `src/services/finops/cost_calculator.ts` would duplicate existing cost infrastructure

- **Location in plan:** Key Files table — "`src/services/finops/cost_calculator.ts`"; Step 69.3 Actions — "Create `CostCalculatorService` with public `estimate()` method"
- **Problem:** `calculateCost(usage, modelRates)` already exists in `src/ai/provider*common*utils.ts`. `CostTracker` already exists in `src/services/cost/cost_tracker.ts` with `trackGeneration()`, `getTotalCost()`, and persistence to SQLite. Creating a new `CostCalculatorService` in a new `finops/` directory would produce a third independent cost implementation with no guarantee of consistent formulas.
- **Impact:** Cost estimates would diverge between `provider*common*utils`, `CostTracker`, and the new `CostCalculatorService`. A plan step saying "billing shows $5" while provider logs show "$4.80" is a data integrity failure.
- **To fix:** Remove the `src/services/finops/cost*calculator.ts` plan entry. Step 69.3 should extend `CostTracker` (at `src/services/cost/cost*tracker.ts`) with a `persistEntry(entry: ICostEntry)` method and a `queryByCriteria(filter: ICostFilter)` method. The CLI cost display step (69.4) should query `CostTracker` directly.

---

#### G5 — 🟡 Feasibility: `provider.generate()` call-site audit is incomplete

- **Location in plan:** Step 69.2 Actions — "Update `AgentExecutor` and `ReflexiveAgent` to await extended generate result"
- **Problem:** The `IModelProvider.generate()` method is also called in: `src/ai/rate*limited*provider.ts:RateLimitedProvider.generate()` (wraps delegate), `src/ai/providers/lazy*provider.ts:LazyProvider.generate()` (wraps delegate), `src/services/agent/strategies/react*loop*strategy.ts:ReActLoopStrategy.execute()` (primary call site for agent steps), `src/services/plan/plan*executor.ts:PlanExecutor` (if present). All test mock stubs for `IModelProvider` must also have `generate()` signatures updated. The plan's two-item list is incomplete.
- **Impact:** After Step 69.2, the return type of `generate()` changes. Any un-updated call site will fail to compile; `RateLimitedProvider` and `LazyProvider` will forward a stale `IGenerateResult` missing the cost field.
- **To fix:** Add a comprehensive call-site table to Step 69.2: `RateLimitedProvider`, `LazyProvider`, `ReActLoopStrategy`, `PlanExecutor`, and all test mock factories. Require a full-codebase `grep` for `.generate(` before merging Step 69.2.

---

#### G6 — 🟠 Testing: `tests/unit/services/providers/` and `tests/unit/services/finops/` do not exist

- **Location in plan:** Step 69.1 Planned Tests — "`tests/unit/services/providers/base*provider*test.ts`"; Step 69.3 Planned Tests — "`tests/unit/services/finops/cost*calculator*test.ts`"
- **Problem:** The project does not have a `tests/unit/` directory. The convention is flat path prefixed by `tests/` — e.g., `tests/ai/providers/base*provider*test.ts` and `tests/services/cost/cost*tracker*test.ts`. Also, since Step 69.3 should amend `CostTracker` (not create a new file), the test belongs in `tests/services/cost/cost*tracker*test.ts`.
- **Impact:** Test files created at the plan paths are not discovered by `deno task test`.
- **To fix:** Correct test paths to `tests/ai/providers/base*provider*test.ts` (new coverage for the `cost` field) and `tests/services/cost/cost*tracker*test.ts` (extended with persistence and query filter tests).

---

#### G7 — 🔒 Security: CLI filtering parameters may be interpolated into SQL queries

- **Location in plan:** Step 69.4 Actions — "Add `exactl costs` CLI subcommand with `--trace`, `--portal`, `--since` flags"
- **Problem:** The plan does not specify that `--trace`, `--portal`, and `--since` values must be passed as parameterized SQL bind parameters rather than string-interpolated into query statements. OWASP A03 (SQL Injection). The existing codebase uses Deno SQLite with parameterized queries, but the plan text does not mandate this — an implementer following the plan literally might use template-string SQL.
- **Impact:** Unsanitized `--portal` or `--trace` could inject arbitrary SQL conditions, exfiltrating or corrupting the cost database.
- **To fix:** Add an explicit Action to Step 69.4: "All filter values passed to SQLite MUST use prepared statement bind parameters (e.g., `db.query('... WHERE trace_id = ?', [traceId])`) — never string interpolation." Add a security test asserting that a `'; DROP TABLE costs;--` value for `--trace` produces either an error or an empty result, not a mutation.

---

#### G8 — 🟡 Traceability: `agent.generation*completed` is an inline string; `costUsdEstimate` conflicts with existing `cost*usd` convention

- **Location in plan:** Step 69.3 Architecture Notes — event name `agent.generation_completed`; Technical Architecture — field `costUsdEstimate`
- **Problem:** (1) `agent.generation*completed` is a new event type string with no corresponding constant in `src/constants.ts` or `src/shared/constants.ts`. Inline event name strings violate the project traceability convention (as noted in Phase-67 Gap G7). (2) The existing `TokenMap` type in `src/ai/providers/common.ts` and cost records in `CostTracker` use the field name `cost*usd` (snake_case, SQL convention). Introducing `costUsdEstimate` (camelCase) creates an inconsistency that must be resolved at every persistence boundary.
- **Impact:** `costUsdEstimate` values cannot be directly stored in a SQL column named `cost_usd` without a mapping shim; the mismatch will cause silent `undefined` writes unless explicitly handled.
- **To fix:** Add `AGENT*GENERATION*COMPLETED = "agent.generation*completed"` to `src/constants.ts`. Align the field name to `cost*usd` throughout the plan (or pick one convention and document it). If `costUsdEstimate` is needed in TypeScript, add a mapping step from SQL `cost_usd` to `costUsdEstimate` in the repository layer.

---

## Pre-Implementation Actions

> ✅ All actions completed — resolved in plan body above (2026-04-08).

1. **(G1 + G2)** ✅ Corrected all file paths — `src/ai/providers/base_provider.ts`, `src/ai/types.ts:IModelProvider`, `src/services/core/event_logger.ts:IEventLogger`.
1. **(G3)** ✅ Removed `ZGenerationResult`; plan now extends `IGenerateResult` with `cost_usd?: number`.
1. **(G4)** ✅ Removed `src/services/finops/cost_calculator.ts`; Step 69.2 redirected to extend `CostTracker`.
1. **(G5)** ✅ Added comprehensive call-site table to Step 69.1 Architecture Notes.
1. **(G7)** ✅ Parameterized SQL binding mandated in Step 69.4 Actions with OWASP A03 citation and security test requirement.
1. **(G6)** ✅ Test paths corrected to `tests/ai/providers/` and `tests/services/cost/`.
1. **(G8)** ✅ Step 69.0 added for `AGENT_GENERATION_COMPLETED` constant; `costUsdEstimate` replaced with `cost_usd` throughout.
