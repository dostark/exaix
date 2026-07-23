# Fix code injection in handleSearchTasks

The `handleSearchTasks` function in `src/api.ts` uses `new Function` to
evaluate user-provided query strings, allowing arbitrary code execution
(e.g. `query: "true"` returns all tasks).

Files: src/api.ts

Actions:

1. Read src/api.ts to understand handleSearchTasks
2. Replace the `new Function` call with a safe string-matching filter
3. Add input validation to ensure query is a string
4. Run `deno test src/api_test.ts` to verify

Constraints:

- Do not use `eval`, `new Function`, or any dynamic code execution
- Existing handler tests must remain green
