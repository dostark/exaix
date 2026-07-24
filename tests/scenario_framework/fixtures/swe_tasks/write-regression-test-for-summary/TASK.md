# Write a regression test for `formatTaskSummary`

The `formatTaskSummary` function in `src/utils.ts` uses `task.done` to
determine the status marker. A common regression is mistakenly using
`task.dueDate` instead — which would mark any task with a due date as
"done" even when it isn't.

Write a regression test in `src/utils_test.ts` that asserts a task with
`done: false` and a present `dueDate` is NOT marked as completed.

Files: src/utils_test.ts

Actions:

1. Read src/utils.ts and src/utils_test.ts to understand the patterns
2. Add a test case: a task with done=false and dueDate=some date should
   produce "[ ] Title" (not "[x] Title")
3. Run `deno test src/utils_test.ts` to verify the test passes

Constraints:

- Do not modify src/utils.ts
- The new test must pass on the current codebase
- The new test must FAIL if `formatTaskSummary` uses `dueDate` instead of `done`
- All existing tests must remain green
