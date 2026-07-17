# Fix null-safety bugs in src/utils.ts

Fix the null-safety bugs in `src/utils.ts`: formatAssignee crashes when a task has no
assignee, and formatDueDate crashes when a task has no due date. Add null checks so both
functions return an empty string instead of crashing, without changing their signatures.

Acceptance criteria:

- formatAssignee returns "" when task.assignee is null
- formatDueDate returns "" when task.dueDate is null
- Existing behavior for a present assignee/due date is unchanged
