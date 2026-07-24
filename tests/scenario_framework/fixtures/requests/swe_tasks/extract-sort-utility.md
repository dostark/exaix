# Extract duplicated sorting logic into a shared function

The file `src/priority_calculator.ts` contains two functions —
`sortByEscalatedPriority` and `sortTasksForDisplay` — that have identical
sorting logic. Extract the common comparison into a private helper function
and make both public functions delegate to it.

Files: src/priority_calculator.ts

Actions:

1. Read src/priority_calculator.ts to understand the duplicated logic
2. Extract a shared `compareByEscalatedPriority(a, b)` function
3. Update `sortByEscalatedPriority` and `sortTasksForDisplay` to use it
4. Run `deno test src/priority_calculator_test.ts` to verify

Constraints:

- The extracted function must be module-private (not exported)
- Public function signatures must not change
- All existing tests must remain green
- Do not change the behaviour of `daysUntilDue` or `escalatedPriority`
