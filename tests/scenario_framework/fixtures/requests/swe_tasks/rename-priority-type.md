# Rename `TaskPriority` type to `Priority`

The type `TaskPriority` in `src/models.ts` is overly verbose. Rename it to
`Priority` and update all references across the codebase.

Files: src/models.ts, src/api.ts, src/api_test.ts, src/business_logic.ts,
src/business_logic_test.ts, src/priority_calculator.ts, src/storage.ts,
src/storage_test.ts

Actions:

1. Read src/models.ts to find the type definition
2. Grep the codebase for all references to `TaskPriority`
3. Rename `TaskPriority` to `Priority` everywhere
4. Run `deno test src/` to verify all tests pass

Constraints:

- Do not change any logic, behaviour, or test expectations
- Only rename the type — the string literal values stay unchanged
- Every test must remain green after the rename
