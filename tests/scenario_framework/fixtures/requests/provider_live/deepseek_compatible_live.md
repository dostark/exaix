# Plan: raise the request limit constant and document its use

Inspect the `live-portal` portal and produce a plan to change the constant
`PLANNING_MARKER_LIMIT` defined in `src/limits.ts`, and to update the code that uses it.

Use the available read-only exploration tools. Call exactly one tool per response and wait for
its result before the next call. Read `src/limits.ts` first, then read `src/main.ts`. The first
plan step must quote the constant's exact current value.

Acceptance criteria:

- The first plan step quotes the exact current value of `PLANNING_MARKER_LIMIT`.
- A plan step names how `src/main.ts` uses the constant.
- The plan's steps reference the portal's actual file layout.
