---
trace_id: "skill-batch-4-{{timestamp}}"
created: "{{timestamp}}"
status: "pending"
priority: "normal"
source: "cli"
created_by: "scenario-framework"
skills: [research-methodology, step-execution, typescript-patterns, verdict-rubric, commit-message]
---

# Survey how the codebase models optional values and recommend one convention

The codebase carries at least three conventions for an absent value: a bare `?` optional
property, an explicit `| undefined`, and the `Opt<T, Reason.*>` wrapper enforced by
`check:optional-params`. Survey the current usage and recommend a single convention. Cover:

- Where each form appears, and whether the split follows a rule or is historical drift
- What `Opt<T, Reason.*>` buys over a bare optional, and where that value does not apply
- Which form the gate actually enforces, and on which files
- The migration cost of converging on one convention, in files touched per package

Acceptance criteria:

- The survey reports counts per package, not impressions
- The recommendation is one convention with the cases where it does not apply named
- The migration is broken into steps that can each be committed independently
