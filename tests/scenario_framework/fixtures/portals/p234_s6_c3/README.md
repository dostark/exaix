# Settled choice and material unknown

Plan an audit export. The user has explicitly chosen local JSONL files
and rejected a hosted exporter after the Requirement Cost comparison. Decision
U-17 records that choice and its maintenance cost. Preserve it. Destination
directory is not configured, and no accepted decision supplies it. The user
must choose the directory before a write-path criterion can be finalized.

## Case record

Record `case_id`, `status`, `questions`, `decisions`, `acceptance`, `stages`,
`terms`, `adr_proposals`, and `created_files`. Questions and decisions have stable IDs.
Acceptance entries have `id`, `status`, and `outcome`. Use RESOLVED or PENDING.
Decision entries identify the source, choice, affected `acceptance_ids`, and `cost_row`.
Stages identify real `depends_on` edges, `api`, `callers`, `tests`, and `rollback`.
Use consumer/method entries in `callers`. Omit stages blocked by unanswered decisions.
Use structured acceptance outcomes for count examples, assignments, and ledger corrections.
ADR proposals record decision, alternatives, rationale, and consequences.
