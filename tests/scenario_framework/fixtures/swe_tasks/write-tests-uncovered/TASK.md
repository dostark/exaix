# Write unit tests for priority_calculator

The file `src/priority_calculator.ts` has three functions with zero test
coverage: `daysUntilDue`, `escalatedPriority`, and `sortByEscalatedPriority`.

Write comprehensive tests in `src/priority_calculator_test.ts` covering:

1. `daysUntilDue`: a task with no due date returns `null`; a task with a
   malformed due date returns `null`; a task due in N days returns N
2. `escalatedPriority`: a done task is never escalated; a task due within 2
   days is escalated one level (low->medium, medium->high); an overdue task
   becomes `high`; `high` never escalates further
3. `sortByEscalatedPriority`: tasks are ordered by escalated priority first,
   then by soonest due date

Files: src/priority_calculator_test.ts (create)

Actions:

1. Read src/priority_calculator.ts to understand the three functions
2. Create src/priority_calculator_test.ts with comprehensive tests
3. Run `deno test src/priority_calculator_test.ts` to verify

Constraints:

- Use `jsr:@std/assert@1` for assertions (matching existing test files)
- Cover all three functions with edge cases
