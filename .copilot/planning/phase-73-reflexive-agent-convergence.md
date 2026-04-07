---
agent: senior-coder
scope: dev
title: "Phase 73: ReflexiveAgent Convergence Detection & Adaptive Iteration Budget"
short_summary: "Add inline ConfidenceScorer feedback inside the ReflexiveAgent loop
  for early exit on quality convergence, oscillation detection, and complexity-
  proportional iteration budgets derived from IRequestAnalysis."
version: "1.0"
topics:
  - planning
  - roadmap
  - architecture
  - tdd
  - reflexive-agent
  - confidence
  - iteration
  - convergence
  - quality
  - complexity
---

> [!TIP]
> This document is a specialized extension of the [root .copilot/ guidelines](../README.md).

## Status & Context

**Status**: 🚧 Planning
**Phase Dependencies**: Phase 45 (IRequestAnalysis), Phase 62
**Risk Level**: M — modifies loop exit conditions in a critical execution path.
Incorrect thresholds could cause premature exits or infinite loops; thresholds
must therefore be rigorously tested and config-guarded.

## Executive Summary

- **The Problem**: `ReflexiveAgent` runs up to a fixed `maxIterations` regardless of
  whether output quality has plateaued or is oscillating (Weakness 12). A one-line
  fix gets the same number of refinement passes as a full authentication system
  refactor, wasting tokens and time.
- **The Solution**: Wire `ConfidenceScorer` inline after each iteration to detect
  convergence (quality threshold met), plateau (insufficient delta between consecutive
  scores), and oscillation (alternating scores). Compute `effectiveMaxIterations`
  from `IRequestAnalysis.complexity` so complex tasks get proportionally more budget.
- **The Goal**: Make `ReflexiveAgent` both faster for simple tasks and more persistent
  for genuinely complex ones, while preventing indefinite loops on non-converging tasks.

## Current State Analysis

### Key Files

| File                                   | Current Role                             | Gap                                                       |
| -------------------------------------- | ---------------------------------------- | --------------------------------------------------------- |
| `src/services/reflexive_agent.ts`      | Self-critique loop up to `maxIterations` | No inline quality feedback; exits only on iteration count |
| `src/services/confidence_scorer.ts`    | Post-execution quality scoring           | Not called during the refinement loop                     |
| `src/services/agent_runner.ts`         | Passes `IRequestAnalysis` to execution   | Does not pass `complexity` to `ReflexiveAgent`            |
| `src/shared/types/request_analysis.ts` | Defines `IRequestAnalysis.complexity`    | Unused as an iteration budget signal                      |

### Constraints

- `ConfidenceScorer` may invoke LLM sub-calls; inline use must be bounded by a
  configurable frequency (e.g., score every N iterations, not every iteration) to
  avoid doubling token cost on long loops.
- Oscillation detection requires at least a 2-iteration history window.
- `effectiveMaxIterations` must be capped absolutely at `ABSOLUTE_MAX_ITERATIONS`
  (proposed: 12) to prevent unbounded resource consumption regardless of complexity.

### Interfaces Affected

- `src/services/reflexive_agent.ts:ReflexiveAgent`
- `src/services/confidence_scorer.ts:ConfidenceScorer`
- `src/shared/types/reflexive_agent.ts`
- `src/config/exa.config.toml`

## Technical Architecture & Detailed Design

### Schemas

```ts
export const ZReflexiveConvergenceConfig = z.object({
  // Thresholds
  quality_exit_threshold: z.number().min(0).max(100).default(85),
  min_improvement_delta: z.number().min(0).max(20).default(3),
  oscillation_window: z.number().int().min(2).max(4).default(2),

  // Iteration budget
  base_max_iterations: z.number().int().min(1).max(10).default(3),
  complexity_scale_factor: z.number().min(0).max(3).default(1.0),
  absolute_max_iterations: z.number().int().min(1).max(12).default(12),

  // Scoring frequency
  score_every_n_iterations: z.number().int().min(1).max(5).default(1),
});

export const ZIterationScore = z.object({
  iteration: z.number().int().min(0),
  score: z.number().min(0).max(100),
  scoredAt: z.string().datetime(),
});

export const ZConvergenceDecision = z.object({
  shouldExit: z.boolean(),
  reason: z.enum([
    "quality_threshold_met",
    "plateau_detected",
    "oscillation_detected",
    "max_iterations_reached",
    "absolute_max_reached",
  ]),
  scores: z.array(ZIterationScore),
});
```

### Interfaces

```ts
export interface IConvergenceDetector {
  evaluate(
    scores: IIterationScore[],
    config: IReflexiveConvergenceConfig,
  ): IConvergenceDecision;
}

export interface IReflexiveAgentOpts {
  request: IEnhancedRequest;
  requestAnalysis: IRequestAnalysis; // NEW — provides complexity signal
  convergenceConfig: IReflexiveConvergenceConfig;
}
```

### Effective Max Iterations Formula

```text
effectiveMaxIterations =
  MIN(
    base_max_iterations + FLOOR(complexity * complexity_scale_factor),
    absolute_max_iterations
  )
```

Where `complexity` is a normalized 0–10 score from `IRequestAnalysis.complexity`.
With defaults (`base=3, scale=1.0, absolute=12`):

| Complexity        | effectiveMax |
| ----------------- | ------------ |
| 0 (trivial)       | 3            |
| 3 (moderate)      | 6            |
| 6 (complex)       | 9            |
| 10 (very complex) | 12           |

### Convergence Detector Logic

```mermaid
flowchart TD
    A[Iteration N produces output] --> B{N % score_every_n == 0?}
    B -- No --> G[Continue]
    B -- Yes --> C[ConfidenceScorer.score current output]
    C --> D{score >= quality_exit_threshold?}
    D -- Yes --> E[Exit: quality_threshold_met]
    D -- No --> F{len >= oscillation_window?}
    F -- No --> G
    F -- Yes --> H{Abs delta last 2 scores <= min_improvement_delta?}
    H -- Yes --> I{Alternating sign on deltas?}
    I -- Yes --> J[Exit: oscillation_detected]
    I -- No --> K[Exit: plateau_detected]
    H -- No --> G[Continue]
    G --> L{N >= effectiveMaxIterations?}
    L -- Yes --> M[Exit: max_iterations_reached]
    L -- No --> N[Next iteration]
```

### Design Decisions

- **Score frequency gate (`score_every_n_iterations`)**: calling `ConfidenceScorer`
  every iteration can double token cost on long loops. Default `1` keeps the
  current token cost parity; operators can set `2` or `3` to halve scoring cost.
- **Oscillation detection**: two consecutive score deltas of opposite sign and both
  within `min_improvement_delta` indicate the loop is bouncing between two local
  maxima. Exit is warranted.
- **Plateau vs oscillation distinction**: plateau means deltas are consistently small
  and positive (converging too slowly). Oscillation means the direction alternates.
  Both warrant exit; the reason is logged separately for analysis.
- **`absolute_max_iterations` as hard ceiling**: regardless of complexity, no loop
  runs more than 12 iterations to prevent runaway cost in edge cases.

## Implementation Plan (Step-by-Step)

### Step 73.1: Schema & Config Foundation

1. **Actions**

   - Add `ZReflexiveConvergenceConfig` to the shared schema module.
   - Add `[agents.convergence]` section to `exa.config.toml`.
   - Parse and inject config into `ReflexiveAgent` constructor.

1. **Architecture Notes**

   - Keep `base_max_iterations` aligned with the existing `maxIterations` default to
     avoid behavioral change before complexity wiring.

1. **Planned Tests**

   - `tests/unit/shared/schemas/reflexive_convergence_config_test.ts`
   - `tests/unit/config/convergence_config_defaults_test.ts`

1. **Success Criteria**

   - Config parses with all defaults.
   - Boundary values (complexity 0 and 10) produce correct `effectiveMax` values.

---

### Step 73.2: ConvergenceDetector Service

1. **Actions**

   - Create `src/services/agents/convergence_detector.ts` implementing
     `IConvergenceDetector`.
   - Implement `evaluate()` covering all four exit reasons.
   - Export as a pure function with no side effects.

1. **Architecture Notes**

   - Keep the detector stateless — all state (score history) is passed in.
   - Use integer arithmetic for delta comparison to avoid floating-point edge cases.

1. **Planned Tests**

   - `tests/unit/services/agents/convergence_detector_quality_exit_test.ts`
   - `tests/unit/services/agents/convergence_detector_plateau_test.ts`
   - `tests/unit/services/agents/convergence_detector_oscillation_test.ts`
   - `tests/unit/services/agents/convergence_detector_max_iterations_test.ts`

1. **Success Criteria**

   - All four exit conditions are triggered correctly on crafted score sequences.
   - No exit fires below the configured thresholds.
   - Exactly correct iteration is identified as exit point in each scenario.

---

### Step 73.3: EffectiveMaxIterations Computation

1. **Actions**

   - Create `src/services/agents/iteration_budget.ts` with a pure `computeBudget()`
     function.
   - Wire into `ReflexiveAgent.run()` using `IRequestAnalysis.complexity` passed via
     `IReflexiveAgentOpts`.

1. **Architecture Notes**

   - `complexity` from `IRequestAnalysis` is a raw signal; normalize to 0–10 before
     applying the formula.

1. **Planned Tests**

   - `tests/unit/services/agents/iteration_budget_test.ts`

1. **Success Criteria**

   - `computeBudget(complexity=0)` returns `base_max_iterations`.
   - `computeBudget(complexity=10)` returns `absolute_max_iterations`.
   - Intermediate values match the formula without floating-point drift.

---

### Step 73.4: ReflexiveAgent Integration

1. **Actions**

   - Update `src/services/reflexive_agent.ts`:
     - Accept `IReflexiveAgentOpts` (adds `requestAnalysis` and `convergenceConfig`).
     - Compute `effectiveMaxIterations` at start of `run()`.
     - Call `ConfidenceScorer.score()` on the output every `score_every_n_iterations`
       iterations.
     - Call `ConvergenceDetector.evaluate()` after each scoring event.
     - Exit loop on `shouldExit: true`; log exit reason to journal.

1. **Architecture Notes**

   - Accumulate `IIterationScore[]` in local state; pass full history to the detector.
   - Ensure `ConfidenceScorer` timeout from Phase 62 applies here too.

1. **Planned Tests**

   - `tests/unit/services/reflexive_agent_early_exit_test.ts`
   - `tests/unit/services/reflexive_agent_complexity_budget_test.ts`
   - `tests/integration/services/reflexive_agent_convergence_integration_test.ts`

1. **Success Criteria**

   - Loop exits before `effectiveMax` when quality threshold is met.
   - Loop exits exactly at `effectiveMax` when quality never reaches threshold.
   - Loop exits on oscillation after minimum 2 scored iterations.
   - High-complexity requests run more iterations than low-complexity ones.

---

### Step 73.5: Journal Events & Observability

1. **Actions**

   - Emit `agent.iteration_scored` event per scoring call with `iteration`, `score`,
     and `delta`.
   - Emit `agent.converged` event on early exit with `reason` and full `scores[]` array.
   - Emit `agent.iteration_budget_computed` at loop start with `complexity`,
     `effectiveMax`, and `configuredBase`.

1. **Architecture Notes**

   - `agent.iteration_scored` should only be emitted on iterations where scoring
     actually occurs (`iteration % score_every_n_iterations === 0`).
   - `agent.converged` must include `exitReason`, `iterationCount`, and the final
     output quality score so later analytics can compare early-exit quality against
     max-iteration completions.
   - Journal payloads should remain compact; store score history as
     `Array<{ iteration: number; score: number }>` and not the full intermediate agent
     outputs.

1. **Planned Tests**

   - `tests/unit/services/event_logger_convergence_events_test.ts`
   - `tests/integration/services/reflexive_agent_journal_events_test.ts`

1. **Success Criteria**

   - All scoring iterations emit exactly one `agent.iteration_scored` event.
   - Early exits emit exactly one `agent.converged` event with the correct reason.
   - Budget computation emits exactly one `agent.iteration_budget_computed` event at
     the start of every `ReflexiveAgent.run()` call.

## Risks & Mitigations

| Risk                                                              | Impact | Likelihood | Mitigation Strategy                                                                                |
| ----------------------------------------------------------------- | ------ | ---------: | -------------------------------------------------------------------------------------------------- |
| R1: Premature exit due to noisy score fluctuation                 | High   |     Medium | Require `min_improvement_delta` and at least two scored iterations before plateau/oscillation exit |
| R2: Inline scoring increases token cost too much                  | Medium |     Medium | Make `score_every_n_iterations` configurable; default to 1 but allow 2–3 for cost-sensitive modes  |
| R3: Complexity score is inaccurate and over-allocates iterations  | Medium |        Low | Hard-cap with `absolute_max_iterations`                                                            |
| R4: Oscillation detector mistakes legitimate refinement for churn | Medium |        Low | Require alternating sign and low delta across the configured oscillation window                    |
| R5: Additional exit paths complicate debugging                    | Low    |     Medium | Emit explicit convergence journal events and keep exit reasons strongly typed                      |

## Success Metrics (Quantitative)

- Average iteration count decreases by at least 30% for low-complexity requests
  (`complexity <= 2`) without lowering final confidence score.
- High-complexity requests (`complexity >= 7`) receive at least 2 additional
  refinement iterations compared to the fixed-budget baseline when needed.
- 100% of early exits produce a correctly typed `agent.converged` journal event.
- Zero infinite-loop scenarios across the convergence detector test suite.
- P95 additional overhead from convergence logic remains under 150ms per scored
  iteration, excluding any external provider latency inside `ConfidenceScorer`.

## Backward Compatibility

- If `requestAnalysis` is absent, `ReflexiveAgent` falls back to
  `base_max_iterations` only.
- If `[agents.convergence]` is absent from config, defaults are applied silently.
- Existing callers of `ReflexiveAgent` remain valid as long as the new options object
  provides defaulting at the constructor or factory layer.
- Existing journal consumers remain compatible because new event types are additive.

If the cut happened earlier than this, the next safest continuation block is the **full ending package for Sprint 3**: the Phase 73 tail above completes the last required section order from the planning guideline. If you want, I can now continue with **Sprint 3-B / Phase 74-R** in the same document quality level. [github](https://github.com/dostark/exaix/blob/main/.copilot/planning/README.md)
