# @exaix/quality-gate

Quality gate evaluation, acceptance criteria propagation, and confidence scoring for Exaix.

## Role

`@exaix/quality-gate` owns the **pre-execution and post-execution quality evaluation pipeline**. It encompasses request quality assessment (heuristic/LLM/hybrid), acceptance criteria propagation through evaluation layers, and confidence scoring for agent outputs.

## Request Quality Assessment

### Assessment Pipeline

```
Request body text
  → HeuristicAssessor.assess()   (fast, zero-cost signal analysis)
  → [LLMAssessor.assess() if score is borderline and mode is hybrid|llm]
  → Score → Recommendation
```

### Recommendations

| Recommendation      | Score Range | Action                                      |
| ------------------- | ----------- | ------------------------------------------- |
| PROCEED             | ≥ 70        | Pipeline continues unchanged                |
| AUTO_ENRICH         | ≥ 50, < 70  | LLM rewrites body, pipeline continues       |
| NEEDS_CLARIFICATION | ≥ 20, < 50  | Q&A loop started, request paused (REFINING) |
| REJECT              | < 20        | Request failed (FAILED)                     |

### Assessment Modes

| Mode        | Strategies                                 | LLM Needed |
| ----------- | ------------------------------------------ | ---------- |
| `heuristic` | Text signal analysis only                  | No         |
| `llm`       | Full LLM assessment                        | Yes        |
| `hybrid`    | Heuristic first; LLM for borderline scores | Optional   |

### Configuration

```toml
[quality_gate]
enabled                  = true
mode                     = "hybrid"
auto_enrich              = true
block_unactionable       = false
max_clarification_rounds = 5

[quality_gate.thresholds]
minimum    = 20
enrichment = 50
proceed    = 70
```

## Acceptance Criteria Propagation

### Pipeline Flow

```
IRequestAnalysis (from analysis pipeline)
  → CriteriaGenerator.fromAnalysis()
  → Dynamic EvaluationCriterion[] (goal_*, ac_* named criteria)
  → Merge with static CRITERIA (from gate config)
  → GateEvaluator.evaluate()
  → ReflexiveAgent.run()
  → ConfidenceScorer.assess()
```

### Criteria Generation Rules

| Source            | Name Prefix | Weight | Required | Condition        |
| ----------------- | ----------- | ------ | -------- | ---------------- |
| Explicit goal P1  | `goal_`     | 2.0    | true     | `priority === 1` |
| Explicit goal P2+ | `goal_`     | 1.0    | true     | `priority >= 2`  |
| Acceptance crit.  | `ac_`       | 1.5    | true     | Always           |
| Max generated     | —           | —      | —        | Capped at 10     |

### Three Verification Layers

1. **Quality Gate** (blocking, post-step) — `GateEvaluator` invoked by `FlowRunner`; blocks flow if score falls below threshold
2. **Reflexive Critique** (iterative, in-flight) — `ReflexiveAgent.run()` embeds structured requirements in critique prompt
3. **Confidence Scoring** (non-blocking, post-execution) — `ConfidenceScorer.assess()` blends requirement-fulfilment evidence

### Built-in Criteria

| Criterion               | Weight | Required | Description                             |
| ----------------------- | ------ | -------- | --------------------------------------- |
| `GOAL_ALIGNMENT`        | 2.5    | Yes      | Every primary goal addressed            |
| `TASK_FULFILLMENT`      | 2.0    | Yes      | All stated requirements fulfilled       |
| `REQUEST_UNDERSTANDING` | 1.5    | No       | Correct task understanding demonstrated |

## Schemas

| Schema                           | Source                                                    |
| -------------------------------- | --------------------------------------------------------- |
| `RequestQualityAssessmentSchema` | `@exaix/schemas/src/request_quality_assessment.ts`        |
| `ClarificationSessionSchema`     | `@exaix/schemas/src/clarification_session.ts`             |
| `RequestSpecificationSchema`     | `@exaix/schemas/src/request_specification.ts`             |
| `IRequestQualityGateConfig`      | `@exaix/core/src/types/i_request_quality_gate_service.ts` |

## CLI Commands

```text
exactl request clarify <id>
exactl request clarify <id> --answers <json>
exactl request clarify <id> --proceed
exactl request clarify <id> --cancel
```

## See Also

- [@exaix/flow](../../packages/flow/) — Flow orchestration that invokes quality gates
- [@exaix/request](../../packages/request/) — Request processing that feeds evaluation pipeline
- [@exaix/schemas](../../packages/schemas/) — Validation schemas for gate data types
