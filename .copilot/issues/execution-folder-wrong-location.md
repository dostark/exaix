---
agent: general
scope: dev
title: "Execution folder placed in workspace root instead of Memory/"
short_summary: "Memory bank service creates Execution folders in workspace root instead of Memory/Execution/ directory."
version: "0.1"
topics: ["memory-bank", "execution", "filesystem", "path"]
status: resolved
priority: medium
created: 2026-01-26
resolved: 2026-01-26
labels: [bug, memory-bank, execution, filesystem]
---

## Problem

The memory bank service is creating Execution folders in the workspace root instead of the designated Memory/Execution/ directory. This violates the memory bank architecture and scatters execution data across the filesystem.

## Reproduction Steps

```bash
# Create and execute a plan
cd ~/Exaix && deno run --allow-all src/cli/exactl.ts request "Test execution" --agent default --model google:gemini-2.0-flash-exp --priority normal
cd ~/Exaix && deno run --allow-all src/cli/exactl.ts plan approve <plan-id>

# Check for misplaced Execution folder
cd ~/Exaix && ls -la | grep Execution
cd ~/Exaix && ls -la Memory/Execution/
```

## Observed Behavior

- Execution folder appears in workspace root (`$HOME/git/Exaix/Execution/`)
- Memory/Execution/ directory may be empty or missing expected trace folders
- Memory bank service creates execution records but in wrong location

## Expected Behavior

- All execution memory should be in `Memory/Execution/<trace-id>/`
- Workspace root should remain clean
- Memory bank service should use configured memory paths

## Environment

- Exaix Version: Current development
- OS: Linux
- Memory Bank: Configured with paths.memoryExecution

## Investigation Needed

1. **Memory Bank Paths**: Check path configuration
   - Verify `config.paths.memoryExecution` is set correctly
   - Check if memory bank service uses these paths

1.
   - Check `MemoryBankService.createExecutionRecord()`
   - Verify path construction logic

## Related Files

- `src/services/memory_bank.ts` - Memory bank service implementation
- `src/config/schema.ts` - Configuration schema with memory paths
- `exa.config.toml` - Configuration file

## Workaround

Manual cleanup: Move Execution folders from workspace root to Memory/Execution/

## Priority Justification

Medium priority - doesn't break functionality but violates architecture and creates filesystem clutter. Affects organization and maintenance of execution data.

## Examples

- Execution folder appears in `/home/user/Exaix/Execution/` instead of `Memory/Execution/`
- Memory bank creates execution records but stores them in wrong location
- Filesystem clutter in workspace root

## Resolution

**Root Cause**: Hardcoded path construction in `src/services/execution_loop.ts` using `join("Execution")` instead of `config.paths.memoryExecution`.

**Fix Applied**:

1. Updated `createMissionReporter()` method to use `join(config.system.root, config.paths.memoryExecution, traceId)` instead of `join("Execution", traceId)`

1.

**Verification**: All tests pass including new regression test. Code formatting and linting checks pass. Execution folders now correctly created in `Memory/Execution/` directory.
