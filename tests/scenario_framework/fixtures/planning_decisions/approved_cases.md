# Phase 234 Step 6 cases, revision 1

These inputs and domain checks are proposed for freezing before the skill edit.
They test generated plans, not whether the skill contains matching phrases.
Live execution belongs to Step 8. Unit controls prove only oracle sensitivity.

## C1: Small reachable feature

Request: Plan a Solo CLI feature `exactl request count --status pending`.
The supplied repository fixture has a request repository that can count by status,
a CLI command registry, and a CLI test harness. Empty storage must print `0`.
Two pending requests and one completed request must print `2`. Reuse the repository
query. No new configuration, database schema, provider, or service is needed.

Oracle: The first implementation checkpoint includes the registered command,
the real repository query, and CLI execution covering both expected counts.
Later steps may add other statuses. Its integration anchor names the registered
entry point and the test that runs it. The plan adds no unused service or schema.

Bad controls: schemas-only first checkpoint; unregistered command with unit tests
only; expected count includes the completed request.

## C2: Compatible shared-symbol migration

Request: Plan a mechanical rename of `RequestStore.countPending` to
`RequestStore.countByStatus(status)`. The existing countPending method returns
the number of pending requests. The new method must retain that result for
status `pending`. There are two caller batches: CLI commands and daemon reports.
Both batches currently use countPending. The public interface must support
either caller revision during rollout. It is not possible to deploy all callers
atomically. No new feature is requested.

Oracle: Expand adds countByStatus while retaining countPending compatibility.
The two named batches depend on expand, not on each other without a real reason.
Each batch checks its real production consumer and retains the pending-count
contract. The integration checkpoint exercises both migrated consumers before
contract removes countPending. Removal depends on both batches, a zero-consumer
check, and that checkpoint. Stage checks name rollback conditions. Before
contract, rollback can restore either old caller; after contract, rollback must
restore the compatible API before restoring an old caller.

Bad controls: remove countPending before daemon reports migrate; migration
justified only by preference for layers; contract precedes integration;
rollback restores an old caller against the incompatible contracted API.

## C3: Settled choice and material unknown

Request: Plan an audit export. The user has explicitly chosen local JSONL files
and rejected a hosted exporter after the Requirement Cost comparison. Decision
U-17 records that choice and its maintenance cost. Preserve it. Destination
directory is not configured, and no accepted decision supplies it. The user
must choose the directory before a write-path criterion can be finalized.

Oracle: Record U-17 and its cost rationale without reopening hosted versus local.
Keep the destination-dependent criterion pending. Ask only for the missing
directory. Other independently known criteria can be planned. No destination
is invented. If later evidence changes U-17's consequences, that change must
be stated before requesting reconsideration.

Bad controls: repeat the hosted-versus-local question; invent an export path;
mark the unresolved write-path criterion ready for implementation.

## C4: Established Agent Role meaning

Request: Plan assignment of req-42 to the `reviewer` Agent Role. The supplied
project glossary defines Agent Role as a configured persona selected by
`agent_role`; a running agent instance is a separate concept. The accepted
decision selects the role blueprint and excludes running-instance selection.
Reuse that meaning in the decision record and acceptance criteria.

Oracle: The decision record references the established role meaning and the
accepted choice. Acceptance assigns `agent_role: reviewer` for req-42.
No criterion selects a process, instance UUID, or RunnerKind. No replacement
glossary is created and the settled meaning is not asked again.

Bad controls: record the role meaning but accept an instance UUID;
redefine Agent Role as RunnerKind; reopen the role-versus-instance choice.

## C5: Selective ADR proposal

Request: Plan two accepted changes. Rename a screen label from Executions to
Runs; this is a reversible display change. Separately, preserve an immutable
signed audit ledger rather than rewrite ledger rows for corrections. Corrections
will be append-only entries. Independent verification requires the original
signed bytes. Rewriting would break that verification. Append-only corrections
increase read-model and migration cost. Consider mutable rows and an immutable
ledger as alternatives. Record these facts without reopening the accepted choice.

Oracle: The label decision stays in the phase plan. Only the ledger decision
receives an ADR proposal, with both alternatives, the independent-verification
rationale, and read-model and migration consequences. The proposal explains why
the choice is consequential and hard to reverse. No ADR is automatically created.
Acceptance retains signed original rows and represents corrections by new entries.

Bad controls: ADR for the label; ledger proposal without alternatives or rationale;
rewrite signed rows in acceptance; create an ADR without authorization.

## Verification limits

Use structured plan records and independently calculated stage dependencies for
deterministic controls. Reject missing or malformed records, duplicate case IDs,
and each bad control. Bind live artifacts to their request identity.
The live review must inspect the complete plan and actual created files; an
agent's declaration that it created no ADR is insufficient evidence.
Semantic ADR quality and actual plan behavior require Step 8 execution and review.
Step 9 owns paired value trials. No benefit is inferred from these proposed cases.
