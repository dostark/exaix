# Established Agent Role meaning

Plan assignment of req-42 to the `reviewer` Agent Role. The supplied
project glossary defines Agent Role as a configured persona selected by
`agent_role`; a running agent instance is a separate concept. The accepted
decision selects the role blueprint and excludes running-instance selection.
Reuse that meaning in the decision record and acceptance criteria.

## Case record

Record `case_id`, `status`, `questions`, `decisions`, `acceptance`, `stages`,
`terms`, `adr_proposals`, and `created_files`. Questions and decisions have stable IDs.
Acceptance entries have `id`, `status`, and `outcome`. Use RESOLVED or PENDING.
Decision entries identify the source, choice, affected `acceptance_ids`, and `cost_row`.
Stages identify real `depends_on` edges, `api`, `callers`, `tests`, and `rollback`.
Use consumer/method entries in `callers`. Omit stages blocked by unanswered decisions.
Use structured acceptance outcomes for count examples, assignments, and ledger corrections.
ADR proposals record decision, alternatives, rationale, and consequences.
