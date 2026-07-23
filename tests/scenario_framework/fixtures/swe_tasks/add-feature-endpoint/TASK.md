# Add a "complete task" endpoint

The file `src/api.ts` has handlers for creating, listing, and getting tasks, but
no way to mark a task as done.

Add a `handleCompleteTask(repo, req, res)` handler that:

1. Looks up the task by `req.params.id` via `repo.update`, setting `done: true`
2. Responds with the updated task and status 200 on success
3. Responds with status 404 and an `{ error: "Task not found" }` body when the
   task id does not exist

Files: src/api.ts, src/api_test.ts

Actions:

1. Read src/api.ts to understand the existing handler patterns
2. Add handleCompleteTask following the existing handler signatures and error-handling style
3. Add tests in src/api_test.ts covering the success and 404 cases
4. Run `deno test src/api_test.ts` to verify

Constraints:

- Follow the existing handler signatures and error-handling style
- Existing handler tests must remain green
