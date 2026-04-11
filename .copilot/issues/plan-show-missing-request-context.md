---
title: "exactl plan show/list Missing Request and Agent Context"
status: resolved
priority: medium
created: 2026-01-25
updated: 2026-01-25
labels: [bug, cli, ux, plans]
assignee:
related_issues: []
---

## Problem

The `exactl plan show` and `exactl plan list` commands provide minimal information about plans, missing crucial context about the original request and the agent/flow that created the plan. Users cannot easily trace plans back to their source or understand which agent generated them.

## Reproduction Steps

```bash
# Create a request
exactl request "Test request"

# Check plan list - missing request and agent info
exactl plan list

# Check plan show - missing request and agent info
exactl plan show <plan-id>
```text

## Observed Behavior

**Current `exactl plan list` output:**

```text
✅ plan.list: plans
   count: 1
✅ 🔍 request-f493fe2a_plan: request-f493fe2a_plan
   status: review
   trace: f493fe2a...
```text

**Current `exactl plan show` output:**

```text
✅ plan.show: request-f493fe2a_plan
   status: review
   trace: f493fe2a-2a2e-46e3-af2a-b5e56a162597
✅ plan.content: request-f493fe2a_plan
   content: [plan content...]
```text

## Expected Behavior

**Enhanced `exactl plan list` should show:**

- Original request ID/title
- Agent that created the plan
- Portal context (if applicable)
- Creation timestamp
- Request priority

**Enhanced `exactl plan show` should show:**

- Link to original request (`request_id`)
- Agent information
- Portal context
- Request metadata (priority, created_by, etc.)
- Flow information (if applicable)

## Example Enhanced Output

```text
✅ plan.list: plans
   count: 1
✅ 🔍 request-f493fe2a_plan: "Comprehensive Review of Exaix Test Suite"
   status: review
   agent: default
   portal: original-repo
   request: request-f493fe2a
   created: 2026-01-25T16:46:24Z
   priority: normal
```text

```text
✅ plan.show: request-f493fe2a_plan
   status: review
   trace: f493fe2a-2a2e-46e3-af2a-b5e56a162597
   request: request-f493fe2a ("Comprehensive Review of Exaix Test Suite")
   agent: default
   portal: original-repo
   created: 2026-01-25T16:46:24Z
   priority: normal
✅ plan.content: request-f493fe2a_plan
   content: [plan content...]
```text

## Technical Details

**Available Data:**

- Plan files contain `request_id` and `trace_id`
- Request files contain `agent`, `portal`, `priority`, `created_by`, etc.
- Agent information is available in `Blueprints/Agents/`
- Portal information is available in config

**Implementation:**

- Modify plan commands to read associated request data
- Add request metadata to plan display
- Include agent and portal context
- Maintain backward compatibility

## Impact

- **User Experience**: Users can better understand plan context and trace requests
- **Debugging**: Easier to identify which agent/portal generated problematic plans
- **Workflow**: Better visibility into the request → plan → execution pipeline

## Priority Justification

Medium priority - this is a UX improvement that would significantly help users navigate and understand the Exaix workflow, but doesn't break existing functionality.

## Resolution

**Root Cause:** Plan commands only displayed basic plan metadata (id, status, trace_id) without loading associated request information, making it difficult for users to understand plan context and trace requests back to their source.

**Fix Applied:**

1. **Enhanced PlanMetadata Interface:** Added request context fields (`request_id`, `request_title`, `request_agent`, `request_portal`, `request_priority`, `request_created_by`)

1.
1.
1.

**Files Modified:**

- `src/cli/plan_commands.ts`: Enhanced metadata extraction and request loading
- `src/cli/exactl.ts`: Updated CLI display formatting
- `exa.config.toml`: Fixed workspace path configuration
- `tests/plan_commands_regression_test.ts`: Added regression test

**Testing:** Added comprehensive regression test that verifies plan list and show commands include complete request context information.

```
