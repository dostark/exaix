---
trace_id: "skill-batch-3-{{timestamp}}"
created: "{{timestamp}}"
status: "pending"
priority: "normal"
source: "cli"
created_by: "scenario-framework"
skills: [fix-bug, gap-analysis, performance-analysis, reflexive-critique, requirements-analysis]
---

# Diagnose why skill hydration silently drops ids that are not in the catalog

`AgentRunner.hydrateSkills` looks each resolved skill id up in the catalog and filters out
every lookup that returns null. A request that pins an id with a typo therefore produces the
same prompt as one that pins nothing, with no journal record of the discrepancy. Work out:

- Where the drop happens and what the caller can observe after it
- Whether the resolved-skill count reported downstream reflects requested or hydrated ids
- The cost of the per-id lookup when a request resolves the maximum number of skills
- Which behaviour is actually required: reject the request, warn, or continue silently

Acceptance criteria:

- The drop is reproduced by a failing test before any fix is proposed
- The required behaviour is stated as a requirement, not inferred from current code
- Any performance claim is backed by a measurement, not an estimate
