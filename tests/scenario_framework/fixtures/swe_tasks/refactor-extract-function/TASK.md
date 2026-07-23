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
must be preserved exactly.

Files: src/business_logic.ts

Actions:

1. Read src/business_logic.ts to understand the current processTaskSubmission
2. Extract each validation concern into a separate exported function
3. Rewrite processTaskSubmission to delegate to the extracted functions
4. Run `deno test src/business_logic_test.ts` to verify behavior is preserved

Constraints:

- The existing tests in src/business_logic_test.ts must pass unmodified
- Error messages and success/failure behavior must be identical
- All extracted functions must be exported
