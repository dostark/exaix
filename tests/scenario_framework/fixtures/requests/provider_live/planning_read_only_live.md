# Plan: raise the request limit constant

Inspect the `live-portal` portal and produce a plan to change the constant
`PLANNING_MARKER_LIMIT` defined in `src/limits.ts` and to add a Deno unit test for it.

Use the available read-only exploration tools to read `src/limits.ts` before planning. The
first plan step must quote the constant's exact current value.

Acceptance criteria:

- The first plan step quotes the exact current value of `PLANNING_MARKER_LIMIT`.
- The plan has a step that adds a Deno test covering the constant.
- The plan's steps reference the portal's actual file layout.
