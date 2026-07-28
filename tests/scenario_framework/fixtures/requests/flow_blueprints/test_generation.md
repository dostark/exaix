---
trace_id: "test_generation-{{timestamp}}"
created: "{{timestamp}}"
status: "pending"
priority: "normal"
source: "cli"
created_by: "scenario-framework"
flow: "test-generation"
---

# Write regression tests for the flow step hand-off

Write tests covering how a flow step's output becomes the next step's input, targeting `packages/flow/src/step_output_formatter.ts`. Cover:

- Each transform, with a realistic predecessor output as input
- The shapes a step can emit: plan JSON, prose, and an empty result
- What happens when a transform receives something it cannot use
- The aggregate path that feeds plan validation

Acceptance criteria:

- Every transform has a test using output a real step would produce
- The empty and malformed cases are covered, not only the happy path
- Each test states the defect it would catch
