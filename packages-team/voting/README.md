# @exaix-team/voting — Multi-Agent Consensus

Team-edition package providing multi-agent voting/consensus for `voting_group`
flow steps. See [ARCHITECTURE.md](../../ARCHITECTURE.md#voting-consensus) for
the strategic design and edition tier.

## Key Files

| File                                                     | Role                                                                                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `src/voting_consensus_service.ts`                        | Consensus resolution — fans out N runners, resolves majority/weighted/llm-judge                                    |
| `src/voting_capability_module.ts`                        | `ICapabilityModule` — registers `VotingStepHandler` into FlowRunner's handler registry via `IEditionComposer` seam |
| `packages/flow/src/step_handlers/voting_step_handler.ts` | `IFlowStepHandler` — dispatches `voting_group` steps to the consensus service                                      |
| `packages/core/src/types/i_executor.ts`                  | `IExecutor` contract — MIT interface consumed by both sides                                                        |
| `packages/core/src/types/i_voting_consensus_service.ts`  | `IVotingConsensusService` contract — MIT interface                                                                 |
| `packages/schemas/src/voting.ts`                         | `VotingGroupConfig`, `VotingCandidate`, `VotingResult` Zod schemas                                                 |

## Dependencies

- `@exaix/core` — contracts and events
- `@exaix/schemas` — voting schemas
- `@exaix/flow` — `VotingStepHandler` and `FlowStepHandlerRegistry`

## Events

The service emits four event types under the `voting.*` family. All carry an
`IVotingEventPayload` with `step_id`, `strategy`, `candidate_count`, and
`consensus_reached`.

| Event                  | When                 | Additional fields           |
| ---------------------- | -------------------- | --------------------------- |
| `voting.started`       | Before fan-out       | None                        |
| `voting.runner_failed` | A runner throws      | `error` — the error message |
| `voting.resolved`      | Consensus reached    | `winner_runner_id`          |
| `voting.no_consensus`  | No consensus reached | `dissent_summary`           |

## Edition Gating

Voting is Team+ only (Solo ❌ / Team ✅ / Enterprise ✅). The handler is
registered only when `_editionComposer instanceof TeamComposer` in the daemon
bootstrap. In Solo mode, a `voting_group` step produces `UnknownFlowStepError`.
Runtime edition-enforcement is deferred to a future phase.
