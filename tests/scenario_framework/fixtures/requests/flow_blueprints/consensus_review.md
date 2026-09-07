---
trace_id: "consensus_review-{{timestamp}}"
created: "{{timestamp}}"
status: "pending"
priority: "normal"
source: "cli"
created_by: "scenario-framework"
flow: "consensus-review"
---

# Assess whether multi-judge consensus improves verdict stability

Assess the voting consensus path in `exaix-team/packages/voting/` and determine what it adds over a single judge. Cover:

- How individual verdicts are combined, and what happens on a tie
- Whether judge disagreement is recorded or discarded
- The cost in model calls per additional judge
- Conditions under which consensus would change a verdict versus merely confirm it

Acceptance criteria:

- The combination rule is stated precisely enough to implement
- Tie handling is specified, including the degenerate all-disagree case
- The cost per additional judge is quantified in calls, not adjectives
