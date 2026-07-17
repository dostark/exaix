# Refactor processTaskSubmission

The `processTaskSubmission` function in `src/business_logic.ts` is too long and
handles validation, priority resolution, and duplicate-checking all in one
function.

Extract into separate functions:

1. `validateTitle(title)` — title presence/length validation
2. `resolvePriority(rawPriority)` — priority parsing and validation
3. `validateDueDate(dueDate)` — due-date parsing and future-date validation
4. `checkDuplicateLimit(title, existingTasks)` — duplicate-title enforcement

Each extracted function must be independently usable, and
`processTaskSubmission`'s existing behavior (inputs, outputs, error messages)
must be preserved exactly — the existing tests in `src/business_logic_test.ts`
must keep passing unmodified.
