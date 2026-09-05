# Todo App — shared swe_tasks fixture

A small, realistic multi-file TypeScript task-tracking app, shared across all four
`swe_tasks` scenarios so each targets a different real file in the same coherent
codebase instead of an isolated single-file stub.

```text
src/
  models.ts              # Task, User, Priority types
  storage.ts              # TaskRepository (in-memory CRUD)
  business_logic.ts       # processTaskSubmission — the refactor target (monolithic)
  api.ts                  # HTTP-style handlers — the add-feature target (no complete endpoint)
  utils.ts                # display formatting — the fix-bug target (null-safety bugs)
  priority_calculator.ts  # due-date escalation — the write-tests target (zero coverage)

  storage_test.ts          # baseline coverage, kept green by every scenario
  business_logic_test.ts   # baseline coverage for processTaskSubmission's observable behavior
  api_test.ts               # baseline coverage for the existing handlers
  utils_test.ts             # fails against the unfixed fixture; passes once null guards are added
```

Each scenario's `command-exit-code` criterion runs `deno test src/` against the
worktree the delegate edited — `deno check`'s strict null checking alone catches the
`utils.ts` bug at type-check time, before any test even runs.
