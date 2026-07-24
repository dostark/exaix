# Add batch operations for task management

The current `TaskRepository` in `src/storage.ts` only supports single-task
operations (add, get, update, remove). There is no way to update or delete
multiple tasks at once.

Create a new module `src/batch_operations.ts` with:

1. `batchUpdateStatus(repo, ids, done)` — updates the `done` status for
   multiple tasks by their IDs. Returns the array of successfully updated
   tasks. Silently skips missing IDs.
2. `batchDeleteByPriority(repo, priority)` — removes all tasks with the
   given priority. Returns the count of deleted tasks.

Files: src/batch_operations.ts, src/batch_operations_test.ts

Actions:

1. Read src/storage.ts and src/models.ts to understand the existing patterns
2. Create src/batch_operations.ts with both functions
3. Create src/batch_operations_test.ts with tests covering:
   - batchUpdateStatus marks selected tasks as done
   - batchUpdateStatus skips missing IDs
   - batchDeleteByPriority removes only matching tasks
4. Run `deno test src/batch_operations_test.ts` to verify

Constraints:

- Follow the existing type conventions from src/models.ts
- Do not modify existing files
- Use the existing TaskRepository API (add, get, list, update, remove)
