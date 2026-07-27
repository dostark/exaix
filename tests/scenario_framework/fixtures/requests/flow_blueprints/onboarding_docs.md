---
trace_id: "onboarding_docs-{{timestamp}}"
created: "{{timestamp}}"
status: "pending"
priority: "normal"
source: "cli"
created_by: "scenario-framework"
flow: "onboarding-docs"
---

# Write the first-week orientation for a new contributor

Write orientation documentation for someone joining this codebase, using `ARCHITECTURE.md` and `CLAUDE.md` as source. Cover:

- The request lifecycle end to end, in one page
- Where the boundaries are: packages versus apps, and why
- The gates a commit must pass and what each one protects
- The three or four files worth reading first, in order

Acceptance criteria:

- The lifecycle description matches the code, verified against the processor
- The boundary rule is stated as a decidable test, not a principle
- Each recommended file is justified by what the reader learns from it
