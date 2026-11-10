# Selective ADR proposal

Plan two accepted changes. Rename a screen label from Executions to
Runs; this is a reversible display change. Separately, preserve an immutable
signed audit ledger rather than rewrite ledger rows for corrections. Corrections
will be append-only entries. Independent verification requires the original
signed bytes. Rewriting would break that verification. Append-only corrections
increase read-model and migration cost. Consider mutable rows and an immutable
ledger as alternatives. Record these facts without reopening the accepted choice.

## Case record

Record `case_id`, `status`, `questions`, `decisions`, `acceptance`, `stages`,
`terms`, `adr_proposals`, and `created_files`. Questions and decisions have stable IDs.
Acceptance entries have `id`, `status`, and `outcome`. Use RESOLVED or PENDING.
Decision entries identify the source, choice, affected `acceptance_ids`, and `cost_row`.
Stages identify real `depends_on` edges, `api`, `callers`, `tests`, and `rollback`.
Use consumer/method entries in `callers`. Omit stages blocked by unanswered decisions.
Use structured acceptance outcomes for count examples, assignments, and ledger corrections.
The record `status` is `RESOLVED` or `PENDING USER DECISION`.
Acceptance entries use `RESOLVED` or `PENDING`.
Every stage's `rollback.requires_api` names at least one API or invariant to retain.
ADR proposals record decision, alternatives, rationale, consequences, and `hard_to_reverse`.
`hard_to_reverse` is a sentence that explains why the choice is difficult to reverse.
The ledger decision ID is `D-ledger`; the proposal's `decision` field names `D-ledger`.
Acceptance uses the stable IDs `AC-label` and `AC-correction`.
Every stage names a concrete implementation API and a rollback condition; do not add discovery-only stages.
