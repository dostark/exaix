# Add a greeting constant to the simple_repo main file

Make a small, bounded code change in the `test-project` portal:

In `src/main.ts`, add a single exported constant named `GREETING` set to the string
`"hello from delegate"`, and change the existing `console.log("hello")` call to log that
constant instead.

Acceptance criteria:

- `src/main.ts` declares `export const GREETING = "hello from delegate";`.
- The `console.log` call uses `GREETING`.
- No other files are modified (stay within `src/**`).
- The change keeps the file valid TypeScript.

This is intentionally a minimal single-file edit so the delegate's `code_changes` gate fires,
the worktree edit stays inside the portal's permitted paths, and reconciliation accepts it.
