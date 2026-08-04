---
trace_id: "strategy-comparison-react-{{timestamp}}"
created: "{{timestamp}}"
status: "pending"
priority: "normal"
source: "cli"
created_by: "scenario-framework"
flow: "strategy-comparison-react"
---

# Add a health-check endpoint

Add a `GET /health` handler to `src/api.ts` that responds with HTTP 200 and a
JSON body `{ "status": "ok" }`.

Acceptance criteria:

- The handler is registered on the existing router.
- The response has status code 200 and content-type application/json.
- No existing route is modified or removed.
