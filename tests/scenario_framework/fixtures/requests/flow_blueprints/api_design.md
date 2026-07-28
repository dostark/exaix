---
trace_id: "api_design-{{timestamp}}"
created: "{{timestamp}}"
status: "pending"
priority: "normal"
source: "cli"
created_by: "scenario-framework"
flow: "api-design"
---

# Design the REST interface for request submission and status

Design the HTTP interface a external client would use to submit a request to Exaix and follow
it to completion, covering:

- The resource model: what a request is, what a plan is, and how the two relate
- The endpoints needed to submit, poll status, list, and cancel, with their methods and paths
- The status values a client can observe and which transitions are legal between them
- Error responses: which failures are client errors, which are server errors, and what a
  client should retry
- How a long-running request reports progress without the client polling tightly

Acceptance criteria:

- Every endpoint is specified with method, path, request body and response body
- The status model is stated as a transition table, not prose
- Each error case names the status code and whether it is retryable
