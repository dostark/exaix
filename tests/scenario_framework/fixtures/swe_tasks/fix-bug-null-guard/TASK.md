# Fix null-safety bugs in src/utils.ts

Fix the null-safety bugs in `src/utils.ts`: formatAssignee crashes when a task has no
assignee, and formatDueDate crashes when a task has no due date. Add null checks so both
functions return an empty string instead of crashing, without changing their signatures.

Files: src/utils.ts, src/utils_test.ts

Acceptance criteria:

- formatAssignee returns "" when task.assignee is null
- formatDueDate returns "" when task.dueDate is null
- Existing behavior for a present assignee/due date is unchanged

Actions:

1. Read src/utils.ts to understand the current implementation
2. Add null checks to formatAssignee and formatDueDate
3. Run `deno test src/utils_test.ts` to verify the fix
4. Iterate until tests pass

Constraints:

- Do not change function signatures
- Existing behavior for non-null values must be preserved
