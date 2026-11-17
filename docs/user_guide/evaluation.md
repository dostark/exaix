# Evaluation

Run and compare evaluation scenarios. Part of the [Exaix User Guide](README.md).

## Evaluation and scoring

Exaix includes a built-in evaluation framework for measuring agent behaviour quantitatively. It runs predefined scenarios against your workspace, scores the results with weighted scoring, tracks the history of runs, and gates CI on quality thresholds. For the complete CLI reference, the scoring model, the scenario authoring guide and the CI integration, see **[`docs/Exaix_Evaluation.md`](../Exaix_Evaluation.md)**.

### Running and comparing

- `exactl eval run --pack <pack>` runs a scenario pack. Self-contained packs such as `blueprint-eval` need no sandbox. `--tag` selects scenarios by tag, `--trials <n>` repeats each scenario, and `--score-threshold <t>` sets the minimum score that passes.
- Each run writes the eval history and an `eval-report.json` in the output directory. The exit code is `0` when all scenarios passed, `1` when one or more fell below the threshold, and `2` for an infrastructure error.
- `exactl eval history` queries the history. `--limit`, `--pack`, `--scenario` and `--since` narrow the result, and `-o json` prints machine-readable rows.
- `exactl eval compare --run-a <run-id> --run-b <run-id>` compares two runs side by side.
- `--max-cost-usd <usd>` bounds the spend of a run. The run stops scheduling once the accumulated tracked cost reaches the cap, and it skips the remaining scenarios, and it never truncates a task in the middle.
- `exactl eval report --view <view>` reads the history in a view.

`eval report` views: `cost` (default), `families`, `lift` (Exaix vs the raw CLI on the same
task), `ablation` (per-subsystem contribution), `frontier` (accuracy vs cost with Pareto
marking), `failures` (why runs fail, per family and cell), `external` (comparability against
a public benchmark — currently Terminal-Bench; requires Docker to run tasks live, read-only
against history otherwise; see `docs/Exaix_Evaluation.md` §17 for the methodology and its
caveats), `robustness` (the AgentDojo triple per injection vector — clean utility,
utility-under-attack, attack-success-rate, robustness gap), and `interactive` (per-persona
clarification-loop convergence and policy-adherence rate; see `docs/Exaix_Evaluation.md` §18 for
both views' methodology, safety model, and the `--run-ids` reproducibility option), and `memory`
(per memory-ability recall/precision/MRR/nDCG/answer-correctness/abstention, plus a second table
for the cross-cutting consolidation-quality/staleness/learning-effectiveness metrics; see
`docs/Exaix_Evaluation.md` §19 for the ability taxonomy, metric definitions, and the
per-corpus/per-provider/per-date positioning caveat); `-o json` gives machine-readable rows.

Every option is in the [eval command reference](../cli/eval.md).

### Subsystem evaluation

Scenarios are tagged by the subsystem they measure — tools, mcp-server, mcp-client, agent_roles,
skills, flows, memory — so coverage can be read per subsystem rather than per directory:

```bash
# Every mock-tier scenario across all seven subsystems
deno task eval:subsystems

# The cheap tier: one or more representatives per subsystem
deno task eval:subsystems:core

# The catalog/flow/agent-role/skill/tool parity gates
deno task test:parity

# Per-subsystem summary with pass counts and trend deltas
exactl eval report --group-by subsystem
```

> **Run these by hand.** None is attached to a CI job or to the pre-commit gates. `eval:subsystems`
> spawns daemons across roughly seventy scenarios; the nightly tier below spends provider budget.

**The nightly provider-live recipe.** The mock tier proves mechanics through controlled responses.
Tool-selection and output-quality baselines require live model decisions.

```bash
# Requires DEEPSEEK_API_KEY; the judge uses the subscription Claude CLI.
# Strip unrelated API credentials and inherited driver selections.
env -u ANTHROPIC_API_KEY -u OPENAI_API_KEY -u GOOGLE_API_KEY \
  -u EXA_LLM_PROVIDER -u EXA_LLM_MODEL \
  EXAIX_EDITION=team EXA_MATRIX_AGENT_ROLE_LIVE=1 EXA_EVAL_LLM_MOCK=false \
  deno run -A tests/scenario_framework/runner/main.ts \
  --pack agent_role_eval --cell live --mode auto --eval-mode

# Five skill-effectiveness cases and three shipped-flow artifact cases.
env -u ANTHROPIC_API_KEY -u OPENAI_API_KEY -u GOOGLE_API_KEY \
  -u EXA_LLM_PROVIDER -u EXA_LLM_MODEL \
  EXAIX_EDITION=team EXA_EVAL_LLM_MOCK=false \
  deno run -A tests/scenario_framework/runner/main.ts \
  --tag nightly-quality --tag provider-live --cell live --mode auto --eval-mode

# Reliability: repeat the four-role subset.
env -u ANTHROPIC_API_KEY -u OPENAI_API_KEY -u GOOGLE_API_KEY \
  -u EXA_LLM_PROVIDER -u EXA_LLM_MODEL \
  EXAIX_EDITION=team EXA_MATRIX_AGENT_ROLE_LIVE=1 EXA_EVAL_LLM_MOCK=false \
  deno run -A tests/scenario_framework/runner/main.ts \
  --scenario senior-coder-smoke --scenario code-analyst-smoke \
  --scenario software-architect-smoke --scenario quality-judge-smoke \
  --cell live --mode auto --eval-mode --trials 3

# Real tool selection and an imperfect-reference partial-credit control.
env -u ANTHROPIC_API_KEY -u OPENAI_API_KEY -u GOOGLE_API_KEY \
  -u EXA_LLM_PROVIDER -u EXA_LLM_MODEL EXAIX_EDITION=team \
  deno run -A tests/scenario_framework/runner/main.ts \
  --scenario selection-multi-tool-partial-credit --cell openai-chat \
  --mode auto --eval-mode --trials 3

exactl eval report --group-by subsystem
exactl eval report --group-by entity
```

Role artifacts can contain execution steps, analysis, or QA reports. The live structural
check verifies role attribution; the separate judge evaluates the requested content.
Reliability pass rates require both a successful trial outcome and its score threshold.
Passing setup steps cannot turn a failed judge criterion into a successful trial. A file-based
judge receives the matching artifact text. If that file cannot be read, the judge returns an
error instead of grading the step's readiness message.

`--tag provider-live` turns off the CI-safety filter that normally drops those scenarios; it does
not widen the selection into other packs. Do not pin `EXA_LLM_PROVIDER` inside a scenario — step
`env` is merged last and would override the value you set here.

The trajectory scenario captures two real tool calls and scores an imperfect three-tool
reference at 2/3. That is a scoring control, separate from tool-selection quality. Matrix cells
select their provider through their configuration. The live quality config uses DeepSeek
for the system under test and Claude Haiku through `claude-cli` for the judge. Record the
judge criterion score separately from the suite score. Keep quality failures in the baseline;
exclude malformed judge responses and provider failures from quality-score aggregates.

Scenario sandboxes are reclaimed on success and kept on failure; reclaim the backlog with
`deno task sandboxes:prune` (dry-run by default). See
[`tests/scenario_framework/README.md`](../../tests/scenario_framework/README.md) §2.5 and §4b.

---
