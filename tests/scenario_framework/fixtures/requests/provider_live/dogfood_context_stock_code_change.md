---
trace_id: "dogfood-context-stock-{{timestamp}}"
created: "{{timestamp}}"
status: "pending"
priority: "normal"
source: "cli"
created_by: "scenario-framework"
flow: "dogfood-loop"
---

# Add a farewell constant to the simple_repo main file

Make a small, bounded code change in the `test-project` portal:

In `src/main.ts`, add a single exported constant named `FAREWELL` set to the string
`"goodbye from delegate"`, and add a `console.log(FAREWELL)` call right after the
existing `console.log` call.

Acceptance criteria:

- `src/main.ts` declares `export const FAREWELL = "goodbye from delegate";`.
- A `console.log(FAREWELL)` call is present.
- No other files are modified (stay within `src/**`).
- The change keeps the file valid TypeScript.

This is intentionally a minimal single-file edit so the `implement` step's headless CLI
delegate (Blueprints/Flows/dogfood-loop.flow.yaml's `strategy: cli_delegate`) produces a
real, reviewable diff for the `review` step's quality-judge to assess.
