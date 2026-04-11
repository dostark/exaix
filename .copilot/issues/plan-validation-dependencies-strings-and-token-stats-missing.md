---
title: "Plan validation rejects string dependencies and plan show lacks token stats"
status: open
priority: high
created: 2026-02-10
labels: [bug, plans, cli, schema, token-usage]
---

## Problem

Read-only and write agents (including flows) generate plan steps with string dependencies, but plan validation requires numeric dependencies and rejects the plan. In addition, `exactl plan show` does not display LLM token usage statistics for plan generation, making it impossible to audit input/output token consumption from the plan view.

## Reproduction Steps

```bash
# Create a read-only request (example)
exactl request show b9d04499

# Check activity log for plan rejection
exactl journal

# Show rejected plan details
exactl plan show request-b9d04499
```

## Observed Behavior

- Plan validation fails with errors like:
  - `steps.0.dependencies.0: Expected number, received string`
  - `steps.1.dependencies.0: Expected number, received string`
  - `steps.2.dependencies.0: Expected number, received string`
- `exactl plan show` does not include any token usage statistics (prompt/completion/total) for plan generation.

Example `exactl plan show` output (excerpt):

```text
✅ plan.show: request-b9d04499
   status: rejected
   trace: b9d04499-2f8d-4c34-bf15-01e57c216571
   request: request-b9d04499
   title: Request
   agent: product-manager
   portal: portal-exaix
   priority: normal
✅ plan.content: request-b9d04499
   content:
# Rejected Plan Output

## Error
Plan JSON does not match required schema

## Validation Details

- steps.0.dependencies.0: Expected number, received string
- steps.1.dependencies.0: Expected number, received string
- steps.2.dependencies.0: Expected number, received string

## Expected Behavior

- Plan step `dependencies` should accept strings (e.g., "Step 1" or a short label) rather than forcing numeric identifiers for all agents and flows.
- `exactl plan show` should display token usage statistics for plan generation (input, output, total, provider, model) across read-only agents, write agents, and flows.
- `exactl request show` should also display the same token stats when a plan is available, regardless of agent or flow type.

## Environment

- Exaix Version: current development version
- OS: Linux
- Deno Version: as configured in deno.json
- Relevant Config: exa.config.toml (LLM provider settings)

## Proposed Plan

1. Update plan schema so `steps[].dependencies` accepts strings (and update any related types).

1.
1.
1.
1.

## Investigation Needed

1. **Schema and validation**
   - Check `PlanStepSchema` and `PlanSchema` to confirm `dependencies` type.
   - Confirm validation gate in `PlanAdapter.parse()`.

1.
   - Update agent schema references so read-only agents, write agents, and flows emit string dependencies.

1.
   - Identify where plan frontmatter is written and extend it to include token stats for all agent and flow executions.
   - Confirm providers emit token usage data for plan generation across all flows.

1.
   - Add token stats to `plan show` metadata output.
   - Add token stats to `request show` metadata output when a plan exists.

## Related Files

- `src/schemas/plan_schema.ts` - Plan schema and `dependencies` field
- `src/services/plan_adapter.ts` - Plan validation gate
- `src/services/output_validator.ts` - Schema usage for structured outputs
- `.agents/source/agent-content-schema.md` - Agent schema guidance
- `Blueprints/Agents/default.md` - Agent JSON schema example
- `src/cli/command_builders/plan_actions.ts` - Plan show output formatting
- `src/cli/plan_commands.ts` - Plan metadata and content loading
- `src/cli/exactl.ts` - Request show output formatting
- `src/ai/provider_common_utils.ts` - Token usage event mapping

## Root Cause Analysis

- **Dependency validation mismatch**: `PlanStepSchema` enforces numeric dependencies only, so any string dependency emitted by agents or flows fails schema validation. See [src/schemas/plan_schema.ts](src/schemas/plan_schema.ts#L37-L61).
- **Strict validation path**: `PlanAdapter.parse()` performs a hard `PlanSchema` parse with no coercion or fallback, so invalid dependencies always reject plans. See [src/services/plan_adapter.ts](src/services/plan_adapter.ts#L45-L76).
- **Token stats not persisted**: token usage is only logged as `llm.usage` events and never embedded into plan frontmatter. Plan frontmatter is built without any token fields in [src/services/plan_writer.ts](src/services/plan_writer.ts#L253-L284).
- **CLI display lacks token fields**: `plan show` and `request show` only render frontmatter/request metadata and do not include token usage fields. See [src/cli/command_builders/plan_actions.ts](src/cli/command_builders/plan_actions.ts#L65-L100) and [src/cli/command_builders/request_actions.ts](src/cli/command_builders/request_actions.ts#L113-L130).
- **Flow reports omit tokens**: flow report frontmatter does not include token usage, so flow outputs also lack token stats. See [src/services/flow_reporter.ts](src/services/flow_reporter.ts#L123-L161).

## Success Criteria

- Plans from read-only agents, write agents, and flows validate successfully when `steps[].dependencies` are strings.
- `exactl plan show` displays token usage statistics (prompt, completion, total, provider, model) when a plan exists.
- `exactl request show` displays the same token stats for requests with plans.
- No regression in plan validation for existing numeric dependency plans (if still encountered).

## Plan Regression Test

Add a regression test that:

1. Generates a plan with string dependencies (e.g., "Step 1") and verifies schema validation passes.

1.

## Workaround

None currently known.

## Priority Justification

High priority because plan generation is rejected for read-only agents (blocking workflow), and token usage visibility is required for auditability and cost tracking.

```
