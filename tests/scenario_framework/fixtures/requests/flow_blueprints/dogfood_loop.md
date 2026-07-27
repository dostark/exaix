---
trace_id: "dogfood_loop-{{timestamp}}"
created: "{{timestamp}}"
status: "pending"
priority: "normal"
source: "cli"
created_by: "scenario-framework"
flow: "dogfood-loop"
---

# Plan the next dogfooding iteration against this repository

Plan the next self-hosted development iteration, using `exaix-dev-docs/planning/phase-142-subsystem-evaluation-packs.md` for current phase state. Determine:

- Which phase step is next and what it depends on
- Which parts are safe for an agent to execute unattended
- The portal and branch the work should target, and the gates it must pass in `deno.json`
- What evidence would show the step succeeded

Acceptance criteria:

- The next step is named with its dependencies verified against the plan
- Unattended-safe work is separated from work needing review
- Success evidence is stated as a command a reviewer can run
