# Evaluation

Run evaluation scenarios, read the history and compare runs. Part of the [Exaix User Guide](README.md).

## What the framework does

The Exaix evaluation framework measures agent behaviour with numbers. It runs predefined scenarios against your workspace, scores the results with weights, records the history of the runs, compares runs and gates CI on quality thresholds. This page covers the commands that you use to run and read evaluations. The [Evaluation Framework](../evaluation-framework.md) guide is for people who write scenarios and extend the framework: it covers scoring weights, judges, CI jobs and the benchmark packs.

A pack is a group of scenarios. These packs cover the main components:

| Component            | Covered by pack           |
| -------------------- | ------------------------- |
| Agent flows          | `agent_flows`             |
| Tool execution       | `mcp_tools_extended`      |
| Routing              | `dynamic_execution`       |
| Provider behaviour   | `provider_live`           |
| Framework health     | `smoke`, `framework_test` |
| End-to-end workflows | `integration_e2e`         |
| Blueprint quality    | `blueprint-eval`          |
| Eval self-test       | `eval-smoke`              |
| Memory quality       | `memory`                  |

Packs also carry a tag for the subsystem that they measure: tools, mcp-server, mcp-client, agent_roles, skills, flows and memory. `exactl eval report --group-by subsystem` aggregates on that tag. See [Subsystem Evaluation](../evaluation-framework.md#12-subsystem-evaluation).

## Quick start

1. Run the smoke scenarios with evaluation metrics: `exactl eval run --tag smoke`.
1. Run one pack with a score threshold: `exactl eval run --pack blueprint-eval --score-threshold 0.7`.
1. Repeat each scenario to measure reliability: `exactl eval run --pack smoke --trials 5`.
1. Read the history: `exactl eval history --limit 10`.
1. Compare two runs: `exactl eval compare --run-a <run-id> --run-b <run-id>`.
1. Bound the spend of a live run and read the value-for-money view: `exactl eval run --pack swe_tasks --max-cost-usd 0.5`, then `exactl eval report --view frontier`.

The exit code is `0` when every scenario reaches the threshold. Self-contained packs such as `blueprint-eval` need no sandbox.

## Running scenarios

`exactl eval run` executes scenarios, scores them and records the run in the history. Select scenarios with these options. All three are repeatable:

- `--pack <name>` (`-P`) runs every scenario of a pack.
- `--tag <tag>` (`-t`) selects scenarios by tag.
- `--scenario <id>` (`-s`) runs one named scenario.

Tune the run with these options:

- `--score-threshold <n>` sets the minimum suite score that passes. The default is 0.5.
- `--trials <n>` repeats each scenario. The default is 1.
- `--history-store sqlite+jsonl|jsonl` chooses the history storage. The default is `sqlite+jsonl`.
- `--max-cost-usd <n>` bounds the spend of a run. See below.
- `--verbose` (`-v`) prints detailed output.

Each run writes the history and an `eval-report.json` in the output directory.

**Exit codes.** `0` means that every scenario scored at or above the threshold. `1` means that one or more scenarios scored below it or failed. `2` means an infrastructure error, such as a catalog load failure or a runner exception outside step execution.

**The cost cap.** `--max-cost-usd` is the budget discipline for unattended runs. The runner checks the cap between scenarios and never in the middle of a task. When the tracked cost reaches the cap, the runner skips the remaining scenarios (reported as `skipped: budget`) and finishes on the scores of the completed scenarios. A budget stop is not an infrastructure error, so the exit code is the normal `0` or `1`. The suite report records `budget_stopped: true`.

Every option is in the [eval command reference](../cli/eval.md).

## History and comparison

`exactl eval history` lists the recorded runs. `--limit` shows the last N entries, and `--scenario`, `--pack` and `--since` (an ISO 8601 date) narrow the list. `-o json` prints machine-readable rows.

`exactl eval compare --run-a <run-id> --run-b <run-id>` compares two runs side by side and shows the score difference of each step and the overall score delta.

## Reading the reports

`exactl eval report --view <view>` renders a comparison over the recorded history, grouped by cell, provider and model. The report views read the same tracked cost, score and cell fields as the history rows. `-o json` prints machine-readable rows for CI trend jobs.

| View          | What it shows                                                                                                                                                                                                                     |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cost`        | The default view. Cost of the runs.                                                                                                                                                                                               |
| `families`    | Results per scenario family.                                                                                                                                                                                                      |
| `lift`        | Exaix against the raw CLI on the same task.                                                                                                                                                                                       |
| `ablation`    | The contribution of each subsystem.                                                                                                                                                                                               |
| `frontier`    | Accuracy against cost, with Pareto marking.                                                                                                                                                                                       |
| `failures`    | Why runs fail, per family and cell.                                                                                                                                                                                               |
| `external`    | Comparability against a public benchmark, currently Terminal-Bench. It needs Docker to run tasks live and reads history only otherwise. See [External Benchmarks](../evaluation-framework.md#17-external-benchmarks).             |
| `robustness`  | The AgentDojo triple per injection vector: clean utility, utility under attack, attack success rate and the robustness gap.                                                                                                       |
| `interactive` | Per persona: clarification-loop convergence and policy-adherence rate. Both views are explained in [Adversarial and Interactive Evaluation](../evaluation-framework.md#18-adversarial--interactive-evaluation), with `--run-ids`. |
| `memory`      | Per memory ability: recall, precision, MRR, nDCG, answer correctness and abstention, plus consolidation quality, staleness and learning effectiveness. See [Memory Evaluation](../evaluation-framework.md#19-memory-evaluation).  |

- **`cost`** compares cells. Per cell it shows the mean wall-clock duration, the mean LLM-call duration, the total prompt and completion tokens, and the total and mean **tracked** cost. A cell whose runs had no tracked cost, for example a direct-API cell that only produces a predicted estimate, shows `—` in the cost columns. It never shows `0` or a predicted figure that is labeled as tracked.
- **`families`** shows, per task family, the mean score, pass@1, the reconcile rate and the duration. It groups by the `task:` tag.
- **`lift`** answers "does Exaix add anything over running the raw CLI directly?" A bare delegate cell (`bare/<tool>/<provider>`) runs the same pinned task with the raw CLI, with no daemon and no pipeline, and the same outcome criteria score it. For each task family the view pairs the Exaix cell with its bare baseline. It reports `meanDelta` (Exaix minus bare), `stdevDelta` and a `noEffect` verdict when the delta cannot be told from noise, always with its basis.
- **`ablation`** shows what each subsystem contributes. An ablation cell (`ablate-<subsystem>/<tool>/<provider>`) runs the full loop with exactly one subsystem switched off through a config preset. The view pairs each full cell with its ablated sibling and reports `meanDelta`, `stdevDelta` and `noEffect` per subsystem.
- **`frontier`** shows, per cell, the mean score, the mean cost and `cost_per_solved` (the total tracked cost divided by the passed tasks). It marks Pareto-dominant cells: no other cell is both better scored and no more expensive. A cell without cost data stays out of the comparison and shows `—`.
- **`failures`** aggregates the recorded failure classes: counts per class with the family and cell breakdown, and the top class of each cell. It shows whether a cell keeps failing in one way.
- **`external`** shows, per benchmark, version and cell, the tasks run, the resolved count and rate, the size and coverage of the supported subset, the mean tracked cost, the provider and model, and the run date, with the comparability caveat.

## Scenario sandboxes

Scenario sandboxes are reclaimed on success and kept on failure. Reclaim the backlog with `deno task sandboxes:prune`, which is a dry run by default. See the [scenario framework README](../../tests/scenario_framework/README.md#25-sandbox-lifecycle--what-is-kept-and-how-to-reclaim-the-rest).

## Next steps

To write scenarios, set scoring weights, add an LLM judge, run the CI jobs or the nightly provider-live recipe, read the [Evaluation Framework](../evaluation-framework.md) guide.
