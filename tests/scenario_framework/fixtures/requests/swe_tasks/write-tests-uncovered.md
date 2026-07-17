# Write unit tests for priority_calculator

The file `src/priority_calculator.ts` has three functions with zero test
coverage: `daysUntilDue`, `escalatedPriority`, and `sortByEscalatedPriority`.

Write comprehensive tests in `src/priority_calculator_test.ts` covering:

1. `daysUntilDue`: a task with no due date returns `null`; a task with a
   malformed due date returns `null`; a task due in N days returns N
2. `escalatedPriority`: a done task is never escalated; a task due within 2
   days is escalated one level (low→medium, medium→high); an overdue task
   becomes `high`; `high` never escalates further
3. `sortByEscalatedPriority`: tasks are ordered by escalated priority first,
   then by soonest due date

Use `jsr:@std/assert@1` for assertions, matching the existing test files in
this package.
