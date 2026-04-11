---
title: "Technical Writer Agent Plan Validation Failure - No Plan Saved for Review"
status: closed
priority: high
created: 2026-02-11
resolved: 2026-02-17
github_issue:
labels: [bug, request-processor, validation, technical-writer, self-correction]
assignee: antigravity
related_issues: [plan-validation-failure-senior-coder.md]
---

## Problem

When a request (e.g., to the `technical-writer` or `code-analyst` agent) produces a plan that fails JSON validation, the raw LLM output was occasionally not saved in the `Rejected/` folder, showing "No raw content available" instead. This occurred primarily when the agent's output was so malformed that XML tag extraction (e.g., missing `<content>` tags) failed, resulting in empty content being passed to the validator.

## Resolution

The issue was resolved through a two-stage approach: a immediate bug fix for log preservation and a long-term fix for universal format enforcement.

### 1. Robust Error Preservation (Bug Fix)

Ensured the full raw LLM response is preserved even if structured parsing fails:

- **Error Enrichment**: Updated `PlanWriter.formatPlan` to catch `PlanValidationError` and enrich its `details` with `fullRawResponse` containing the original `result.raw` from the agent.
- **Fallback Logic**: Updated `RequestProcessor.handleError` to use `fullRawResponse` as a fallback when `rawContent` (extracted from `<content>` tags) is empty or missing.

### 2. Universal Format Enforcement (Proactive Fix)

Implemented more robust enforcement to reduce the occurrence of validation failures:

- **Self-Correction Loop**: Implemented a 2-retry mechanism in `RequestProcessor` that catches `PlanValidationError` and provides specific feedback to the agent for immediate repair.
- **Dynamic Schema Injection**: `AgentRunner` now dynamically injects machine-readable JSON schema instructions (generated via `SchemaDescriber`) into all agent prompts.
- **Automated JSON Repair**: Integrated `json-repair` into `PlanAdapter` to automatically fix common LLM syntax errors (trailing commas, unquoted keys).
- **Blueprint Standardization**: Fixed malformed XML tags (`</content>`) in `technical-writer.md` and `software-architect.md`.

### Files Modified:

- [plan_writer.ts](file://$HOME/git/Exaix/src/services/plan_writer.ts)
- [request_processor.ts](file://$HOME/git/Exaix/src/services/request_processor.ts)
- [plan_adapter.ts](file://$HOME/git/Exaix/src/services/plan_adapter.ts)
- [agent_runner.ts](file://$HOME/git/Exaix/src/services/agent_runner.ts)
- [schema_describer.ts](file://$HOME/git/Exaix/src/schemas/schema_describer.ts)
- [technical-writer.md](file://$HOME/git/Exaix/Blueprints/Agents/technical-writer.md)
- [software-architect.md](file://$HOME/git/Exaix/Blueprints/Agents/software-architect.md)

## Verification

### Automated Tests

Successfull verification with a dedicated reproduction test and existing regression tests:

- `tests/plan_validation_repro_issue_003_test.ts` (manually run and then removed) verified that malformed XML output still results in a rejected plan file containing the full raw response.
- `tests/request_processor_plan_validation_error_test.ts` passed 4/4 tests.

```bash
ok | 4 passed | 0 failed (119ms)
```

## Related Files

- `src/services/request_processor.ts` - Plan validation and saving logic
- `src/schemas/plan_schema.ts` - Plan validation schema
- `Blueprints/Agents/technical-writer.md` - Agent blueprint
- `src/services/plan_validator.ts` - Plan validation implementation
