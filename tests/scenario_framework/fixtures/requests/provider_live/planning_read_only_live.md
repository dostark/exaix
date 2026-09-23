# Plan: refactor the portal entry to a Greeter with a unit test

Inspect the `live-portal` portal and produce a plan to refactor `src/main.ts` into a
`Greeter` class with a Deno unit test.

Use the available read-only exploration tools to actually read the source files under the
portal before committing to the plan, so the plan is grounded in the real code.

Acceptance criteria:

- The plan has a step that refactors `src/main.ts` to export a `Greeter` class.
- The plan has a step that adds a Deno test for `Greeter`.
- The plan's steps are concrete and reference the portal's actual file layout.
