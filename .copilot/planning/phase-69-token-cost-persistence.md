---
agent: senior-coder
scope: dev
title: "Phase 69: Token & Cost Persistence"
short_summary: "Extract token usage and cost metrics from LLM provider responses, persist them into the Activity Journal per-request, and expose cost auditing via the CLI."
version: "1.0"
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

| File                                      | Current Role                          | Gap                                      |
| ----------------------------------------- | ------------------------------------- | ---------------------------------------- |
| `src/services/providers/base_provider.ts` | Defines provider generation contracts | Returns `text` only, dropping usage data |
| `src/services/event_logger.ts`            | Records execution events              | No schema fields for tokens/cost         |
| `src/cli/main.ts`                         | CLI routing                           | Lacks cost reporting commands            |

### Constraints

- Not all providers expose cost directly. The system must estimate cost using a known pricing table based on model name and token counts.
- Token usage must be accumulated across parallel flow steps accurately.

### Interfaces Affected

- `src/services/providers/base_provider.ts:IModelProvider`
- `src/services/event_logger.ts:IActivityJournal`

## Technical Architecture & Detailed Design

### Schemas

```ts
export const ZTokenUsage = z.object({
  promptTokens: z.number().int().min(0),
  completionTokens: z.number().int().min(0),
  totalTokens: z.number().int().min(0),
  costUsdEstimate: z.number().min(0).optional(),
});

export type ITokenUsage = z.infer<typeof ZTokenUsage>;

// Update to existing generation result
export const ZGenerationResult = z.object({
  text: z.string(),
  usage: ZTokenUsage.optional(),
  model: z.string(), // Exact model used, for pricing lookups
});
```

### Interfaces

```ts
export interface IPricingTable {
  [modelName: string]: {
    promptPer1k: number;
    completionPer1k: number;
  };
}

export interface ICostCalculatorService {
  calculate(model: string, usage: ITokenUsage): number;
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

- **Client-Side Pricing Calculation**: APIs often change pricing or only return tokens. We maintain a local `pricing_table.json` (or constant map) updated periodically to estimate USD cost.
- **Journal Attachment**: Usage is attached to the `agent.generation_completed` or `tool.end` events, ensuring we can aggregate by `trace_id`, `portal`, or `agent_id`.

## Implementation Plan (Step-by-Step)

### Step 69.1: Provider Return Type Updates

1. **Actions**

- Update `IModelProvider.generate()` to return `IGenerationResult` instead of a plain string.
- Update `ClaudeProvider`, `OpenAIProvider`, `OllamaProvider` (returns tokens, cost 0) to parse and map their respective usage objects.

1. **Architecture Notes**

- Refactor `AgentExecutor` and `ReflexiveAgent` to unpack `result.text` while preserving `result.usage`.

1. **Planned Tests**

- `tests/unit/services/providers/provider_usage_mapping_test.ts`

1. **Success Criteria**

- All active providers successfully return token counts.
- Orchestration layer correctly handles the new return object.

### Step 69.2: Cost Calculator Service

1. **Actions**

- Create `src/services/finops/cost_calculator.ts`.
- Implement a lookup table for current major models (GPT-4o, Claude 3.5 Sonnet, etc.).
- Inject cost estimates into the `ZTokenUsage` object before it hits the logger.

1. **Architecture Notes**

- Missing models default to a $0.00 estimate but preserve accurate token counts.

1. **Planned Tests**

- `tests/unit/services/finops/cost_calculator_test.ts`

1. **Success Criteria**

- Accurate USD calculations for prompt + completion combinations based on the table.

### Step 69.3: Journal Schema & Logging

1. **Actions**

- Update `IActivityJournal` schema and SQLite/Postgres schemas to include `prompt_tokens`, `completion_tokens`, and `cost_usd`.
- Ensure `EventLogger.log()` persists these fields when present in the payload.

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

1. **Architecture Notes**

- Render a clean ASCII table with breakdown by model, agent, or trace depending on flags.

1. **Planned Tests**

- `tests/cli/log_cost_command_test.ts`

1. **Success Criteria**

- CLI accurately reports aggregated totals.
- Filters (`--trace`, `--since`) successfully narrow the dataset.

## Risks & Mitigations

| Risk                          | Impact | Likelihood | Mitigation Strategy                                                                      |
| ----------------------------- | ------ | ---------: | ---------------------------------------------------------------------------------------- |
| R1: Pricing table drift       | Low    |       High | Treat USD as an "estimate". Add a note in CLI output. Tokens are the source of truth.    |
| R2: Streaming usage omissions | Medium |     Medium | Some APIs don't send usage in streams. Ensure the final chunk is parsed for usage stats. |

## Success Metrics (Quantitative)

- 100% of LLM calls log token counts in the Activity Journal.
- Cost reporting CLI executes over 10,000 records in < 50ms (SQLite aggregation).

## Backward Compatibility

- Old journal records without token data will aggregate as 0 tokens / $0.00 cost without breaking queries.
- Provider interface update requires updating all existing provider implementations simultaneously, but breaks no downstream logic once unpacked.
