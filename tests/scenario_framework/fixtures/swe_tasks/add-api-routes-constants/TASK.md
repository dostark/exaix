# Extract API route strings into named constants

The file `src/api.ts` contains inline path strings in comments (e.g.,
"/tasks/:id", "/tasks/:id/complete") that are used as route identifiers.
Extract these into a shared constants module.

Create a new file `src/api_routes.ts` with:

- `ROUTE_GET_TASK = "/tasks/:id"`
- `ROUTE_LIST_TASKS = "/tasks"`
- `ROUTE_CREATE_TASK = "/tasks"`
- `ROUTE_COMPLETE_TASK = "/tasks/:id/complete"`

Files: src/api_routes.ts, src/api_routes_test.ts

Actions:

1. Read src/api.ts to identify the route path strings used
2. Create src/api_routes.ts with the route constants
3. Create src/api_routes_test.ts that verifies each constant value
4. Run `deno test src/api_routes_test.ts` to verify

Constraints:

- Do not modify existing files — the constants module is additive
- Constant names should follow UPPER_CASE convention
