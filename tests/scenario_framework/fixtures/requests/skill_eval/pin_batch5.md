---
trace_id: "skill-batch-5-{{timestamp}}"
created: "{{timestamp}}"
status: "pending"
priority: "normal"
source: "cli"
created_by: "scenario-framework"
skills: [
  response-contract,
  response-contract-code-analysis,
  response-contract-judge,
  response-contract-performance,
  response-contract-qa,
  response-contract-security-analysis,
  conversational-dialogue,
]
---

# Reconcile the response-contract skill family into a documented hierarchy

Six `response-contract*` skills now exist, one generic and five per-domain. Nothing states
which one an identity should carry, and an identity carrying two pays for both on every
request. Produce the missing definition:

- What the generic contract guarantees that every variant inherits
- What each variant adds, stated as the difference from the generic one
- The rule for choosing exactly one, expressed so it can be checked mechanically
- Whether `conversational-dialogue` overlaps any of them, and if so which parts

Acceptance criteria:

- Each of the six skills is described by its difference from the generic contract
- The selection rule is stated precisely enough to become a test over the identity catalog
- Any recommended merge or deletion names the identities it would affect
