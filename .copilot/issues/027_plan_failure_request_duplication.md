cd---
title: "Plan failure handling moves file to Requests causing duplication"
status: fixed
priority: high
fixed_at: 2026-02-26
---

## Status: Fixed

### Verification Results

The following fixes have been verified with integration tests:

1.  **Failure Handling**: Verified that failed plans move to `Workspace/Rejected/` and the primary request status is updated to `failed`. (See `tests/integration/28_plan_failure_handling_regression_test.ts`)

1.

## Issue: Plan Failure Pollutes Request Inbox and Duplicates Trace States

### Description

When an AI plan execution fails, the `ExecutionLoop` incorrectly moves the plan file from `Workspace/Active/` back to `Workspace/Requests/`. This directory is strictly reserved for primary user requests. Moving a plan file (e.g., `request-974718fb_plan.md`) into the requests folder triggers several side effects:

1. **Request Duplication**: The `RequestProcessor` detects the "new" file in `Requests` and attempts to process it as a fresh request. This results in duplicate trace ID entries in `exactl request list`.

1.
1.

### Observed Behavior (from Logs)

1. User creates request `974718fb`.

1.
1.
1.
1.
   - `974718fb` (status: failed) - coming from the misplaced plan file.
   - `974718fb` (status: planned) - coming from the original request file.
1.

### Root Cause Analysis

1. **`src/services/execution_loop.ts`**:

   ```typescript
   private async handleFailure(planPath: string, ...) {
     const requestsDir = join(this.config.system.root, this.config.paths.workspace, "Requests");
     // ...
     await Deno.writeTextFile(requestPath, updatedContent); // Correctly sets status to ERROR but in WRONG dir
     await Deno.remove(planPath);
   }
   ```

   The failure handler should move the file to `Workspace/Rejected` or keep it in a terminal state within `Workspace/Active` or `Workspace/Archive`.

1.

1.
   The `getPortalFileSummary` method uses a very shallow depth limit (max 100 files, limited subdirectory traversal). For mature codebases, this misses most interior files, forcing agents to rely on prompt-suggested paths which may be hallucinations or outdated.

1.
   Execution logs show `plan.md` being used in the project root (`$HOME/git/Exaix/plan.md`). This indicates a path resolution fallback that bypasses the isolated worktree/workspace structure.

1.

### Proposed Fix Plan

1. **Immediate**: Modify `ExecutionLoop.handleFailure` to move failed plans to `Workspace/Rejected/` (with a suffix) instead of `Workspace/Requests/`.

1.
1.

### Related Files

- `src/services/execution_loop.ts` (Failure handling logic)
- `src/services/request_processor.ts` (Portal grounding logic)
- `src/cli/handlers/request_list_handler.ts` (Request listing logic)
- `src/services/plan_executor.ts` (Execution path management)
