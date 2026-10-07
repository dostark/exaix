---
trace_id: "skill-review-approve-{{timestamp}}"
created: "{{timestamp}}"
status: "pending"
priority: "normal"
source: "cli"
created_by: "scenario-framework"
agent_role: "mock-agent"
skills: [review-flow]
---

# Summarize the reviewed procedure that applies to skill folder changes

Read `packages/core/src/skills/skills.ts` and describe how a draft skill becomes active. Identify:

- Which service method approves a draft and which revision it must name
- What happens to the draft when its content changes after review
- Where the approval is journaled and which fields identify the revision

Acceptance criteria:

- Every statement names the file and the method it comes from
- The approval path is described in order, from draft to active
- Any gap in the review requirement is listed with the reasoning stated
