# Confirm a planned GREETING constant change is safe

In the `test-project` portal, inspect `src/main.ts`. It currently contains a single
`console.log("hello")` call and nothing else.

Confirm, in your response, that:

- `src/main.ts` exists and its only statement is `console.log("hello");`.
- Adding an exported `GREETING` constant and changing the `console.log` call to use it
  would be a safe, single-file, single-line-of-intent change with no other files affected.

Do not modify any file — this is an analysis-only task.
