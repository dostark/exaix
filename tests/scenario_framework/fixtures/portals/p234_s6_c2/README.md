# Compatible shared-symbol migration

Plan a mechanical rename of `RequestStore.countPending` to
`RequestStore.countByStatus(status)`. The existing countPending method returns
the number of pending requests. The new method must retain that result for
status `pending`. There are two caller batches: CLI commands and daemon reports.
Both batches currently use countPending. The public interface must support
either caller revision during rollout. It is not possible to deploy all callers
atomically. No new feature is requested.

## Case record

Record `case_id`, `status`, `questions`, `decisions`, `acceptance`, `stages`,
`terms`, `adr_proposals`, and `created_files`. Questions and decisions have stable IDs.
Acceptance entries have `id`, `status`, and `outcome`. Use RESOLVED or PENDING.
Decision entries identify the source, choice, affected `acceptance_ids`, and `cost_row`.
Stages identify real `depends_on` edges, `api`, `callers`, `tests`, and `rollback`.
Use consumer/method entries in `callers`. Omit stages blocked by unanswered decisions.
Use structured acceptance outcomes for count examples, assignments, and ledger corrections.
ADR proposals record decision, alternatives, rationale, and consequences.
