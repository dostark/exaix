# Small reachable feature

Plan a Solo CLI feature `exactl request count --status pending`.
The supplied repository fixture has a request repository that can count by status,
a CLI command registry, and a CLI test harness. Empty storage must print `0`.
Two pending requests and one completed request must print `2`. Reuse the repository
query. No new configuration, database schema, provider, or service is needed.

## Case record

Record `case_id`, `status`, `questions`, `decisions`, `acceptance`, `stages`,
`terms`, `adr_proposals`, and `created_files`. Questions and decisions have stable IDs.
Acceptance entries have `id`, `status`, and `outcome`. Use RESOLVED or PENDING.
Decision entries identify the source, choice, affected `acceptance_ids`, and `cost_row`.
Stages identify real `depends_on` edges, `api`, `callers`, `tests`, and `rollback`.
Use consumer/method entries in `callers`. Omit stages blocked by unanswered decisions.
Use structured acceptance outcomes for count examples, assignments, and ledger corrections.
ADR proposals record decision, alternatives, rationale, and consequences.

The CLI registry registers the request count command. The RequestStore query counts
only the requested status. The CLI harness executes the registered command against
a real request store. Use these existing boundaries without adding a service.
