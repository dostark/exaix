# Add a task search endpoint

The file `src/api.ts` has handlers for creating, listing, and getting individual
tasks, but no way to search tasks by keyword.

Add a `handleSearchTasks(repo, req, res)` handler that:

1. Reads `req.body.query` — a search keyword
2. Returns 400 with `{ error: "Query must be a non-empty string" }` when the
   query is empty or not a string
3. Filters `repo.list()` to tasks whose `title` (case-insensitive) contains the
   query, OR whose `assignee.name` (if assignee exists, case-insensitive)
   contains the query
4. Responds with the matching task array and status 200

Files: src/api.ts, src/api_test.ts

Actions:

1. Read src/api.ts and src/api_test.ts to understand the existing patterns
2. Add handleSearchTasks to api.ts following the existing handler signatures
3. Add tests in api_test.ts covering:
   - Title match (case-insensitive)
   - Assignee name match (case-insensitive)
   - Empty query returns 400
4. Run `deno test src/api_test.ts` to verify

Constraints:

- Follow the existing handler signatures and error-handling style
- Existing handler tests must remain green
- Do not modify existing handlers or their signatures
