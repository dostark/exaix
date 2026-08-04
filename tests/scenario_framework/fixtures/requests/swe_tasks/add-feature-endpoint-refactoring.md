---
trace_id: "add-feature-endpoint-refactoring-{{timestamp}}"
created: "{{timestamp}}"
status: "pending"
priority: "normal"
source: "cli"
created_by: "scenario-framework"
flow: "refactoring"
---

# Add a "complete task" endpoint

The file `src/api.ts` has handlers for creating, listing, and getting tasks, but
no way to mark a task as done.

Add a `handleCompleteTask(repo, req, res)` handler that:

1. Looks up the task by `req.params.id` via `repo.update`, setting `done: true`
2. Responds with the updated task and status 200 on success
3. Responds with status 404 and an `{ error: "Task not found" }` body when the
   task id does not exist

Follow the existing handler signatures and error-handling style in the file.
