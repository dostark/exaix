# Rename `done` to `completed` across the codebase

The `ITask` interface in `src/models.ts` uses `done: boolean` to track
completion status. Rename it to `completed` for clarity, and update every
consumer.

Files: src/models.ts, src/api.ts, src/storage.ts, src/business_logic.ts,
src/utils.ts, src/utils_test.ts, src/api_test.ts, src/storage_test.ts,
src/business_logic_test.ts

Actions:

1. Change `done: boolean` to `completed: boolean` in `ITask` in `src/models.ts`
2. Update all references to `done` in:
   - src/api.ts (handleCreateTask sets `completed: false`)
   - src/business_logic.ts
   - src/utils.ts (formatTaskSummary checks `task.completed`)
   - src/api_test.ts, src/storage_test.ts, src/utils_test.ts,
     src/business_logic_test.ts
3. Run `deno test src/` to verify all tests pass

Constraints:

- Do not change function signatures
- Do not change test logic, only the property name
- Every test must remain green after the rename
