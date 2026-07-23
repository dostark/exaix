# Fix async ordering in processBatchSubmissions

The `processBatchSubmissions` function in `src/business_logic.ts` allows more
than 3 tasks with the same title to be created in a single batch, bypassing
the duplicate-title limit.

The bug: the function snapshots the existing tasks array at the start and
never checks whether a title was already submitted earlier in the same batch.
When 4 tasks with title "Meeting" are submitted together, all 4 succeed instead
of only the first 3.

Files: src/business_logic.ts

Actions:

1. Read src/business_logic.ts to understand processBatchSubmissions
2. Fix the function to track titles already seen within the batch
3. Run `deno test src/business_logic_test.ts` to verify

Constraints:

- processTaskSubmission must remain unchanged
- The existing synchronous tests must still pass
- After fixing, submitting 4 same-title tasks in a batch should allow only 3
