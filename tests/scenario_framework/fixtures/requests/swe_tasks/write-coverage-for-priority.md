# Add unit test coverage for `priority_calculator.ts`

The file `src/priority_calculator.ts` has zero test coverage. Write a
comprehensive test suite in `src/priority_calculator_test.ts` covering:

1. `daysUntilDue(null)` returns null
2. `daysUntilDue` returns a number for a valid future date
3. `escalatedPriority` returns the same priority when there's no due date
4. `escalatedPriority` escalates "low" → "medium" within 2 days of due date
5. `sortByEscalatedPriority` sorts by priority descending

Files: src/priority_calculator_test.ts

Actions:

1. Read src/priority_calculator.ts to understand the three exported functions
2. Create src/priority_calculator_test.ts with tests for each function
3. Run `deno test src/priority_calculator_test.ts` to verify

Constraints:

- Do not modify src/priority_calculator.ts
- Test each exported function at least once
- Follow the existing test conventions in src/utils_test.ts
- All existing tests must remain green
