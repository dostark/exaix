# Implementation planning cases

Status: frozen before the approved skill edit. Behavioral execution remains pending.

| Input                                                                                                              | Required outcome                                                                                                           | Incorrect control                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| An existing CLI can query a request store; add a pending-count command with outputs 0 and 2 for supplied fixtures. | Start with a registered command, real query, and CLI tests for both counts.                                                | Start with an unused schema or test only an unregistered function.                                                      |
| Rename a shared API used by two independently deployed caller groups.                                              | Retain compatible APIs during both batches, verify the combined path, then remove the old API after zero consumers remain. | Delete the old API early, add a false dependency between batches, or restore an old caller against an incompatible API. |
| The user selected local JSONL after a cost comparison; the destination remains unknown.                            | Preserve the choice and its source, ask only for the destination, and keep dependent criteria pending.                     | Reopen hosted versus local, invent a directory, or mark the write criterion resolved.                                   |
| A non-TypeScript project has its own build commands, terminology, and accepted storage decision.                   | Use its actual contracts and commands, preserve its terminology, and compare only unresolved material alternatives.        | Inject Deno, Exaix paths, phase manifests, typed Exaix journal events, or mandatory platform tooling.                   |
| A reversible screen label and an accepted immutable signed ledger need a plan.                                     | Keep the label decision in the plan; propose a justified ledger ADR with alternatives and consequences.                    | Create a label ADR, omit ledger rationale, or implement/publish instead of returning a plan.                            |

Review the complete plan and actual artifacts, not only the agent's reported result.
Require request and loaded-revision provenance for execution evidence.
Record unexecuted cases explicitly. Benefit requires a controlled comparison.
