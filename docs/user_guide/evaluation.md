# Evaluation

Run and compare evaluation scenarios. Part of the [Exaix User Guide](README.md).

## **Eval Commands** - Run and compare evaluation scenarios

Run predefined scenario packs, score results, and compare runs. Full documentation
in `docs/Exaix_Evaluation.md`.

```bash
exactl eval run --pack smoke --trials 5
exactl eval history --limit 10
exactl eval compare --run-a <id> --run-b <id>
exactl eval report --pack swe-tasks -o table
```

## **Eval Commands** - Run and compare evaluation scenarios

The evaluation framework runs predefined scenarios against your workspace, scores
results, and compares runs over time. Full documentation is in `docs/Exaix_Evaluation.md`.

```bash
# Run an evaluation scenario pack
exactl eval run --pack smoke
exactl eval run --tag smoke --trials 5 --score-threshold 0.7

# Run in eval mode (writes history, produces eval-report.json)
exactl eval run --pack smoke --score-threshold 0.6

# Query evaluation history (SQLite default, --source jsonl to fall back)
exactl eval history --limit 10
exactl eval history --pack smoke --since 2026-06-01 -o json
exactl eval history --limit 10

# Compare two evaluation runs side-by-side
exactl eval compare --run-a <run-id> --run-b <run-id>

# Bound a run's spend and read the accuracy-vs-cost / harness-lift readouts
exactl eval run --pack swe_tasks --max-cost-usd 0.5
exactl eval report --view frontier
exactl eval report --view lift
exactl eval report --view failures

# View family-level report (swe-tasks pack)
exactl eval report --pack swe-tasks -o table

# External-benchmark comparability (Terminal-Bench, Docker required to run tasks live)
exactl eval report --view external

# Adversarial-robustness and interactive-evaluation packs
exactl eval report --view robustness
exactl eval report --view interactive
exactl eval report --view robustness --run-ids <id,id,...>   # scope to an exact run set

# Memory evaluation: per-ability retrieval quality plus consolidation/learning-effectiveness
exactl eval report --view memory
exactl eval report --view memory -o json
```

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
`--max-cost-usd` stops scheduling once
accumulated tracked cost reaches the cap (remaining scenarios skipped, never a task truncated
mid-run). Full documentation in `docs/Exaix_Evaluation.md`.

Exit codes: `0` all passed, `1` one or more below threshold, `2` infrastructure
error. Eval reports are written to the output directory as `eval-report.json`.

---

## Evaluation & Scoring

Exaix includes a built-in evaluation framework for measuring agent behaviour
quantitatively. It provides weighted scoring, history tracking, and CI-gated
quality thresholds.

```bash
# Run self-contained evaluation packs (no sandbox needed)
exactl eval run --pack blueprint-eval

# Run with a score threshold
exactl eval run --pack blueprint-eval --score-threshold 0.7

# View run history
exactl eval history --limit 10
```

For the complete CLI reference, scoring model, scenario authoring guide, and
CI integration, see **[`docs/Exaix_Evaluation.md`](../Exaix_Evaluation.md)**.

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

## Concurrent Guardrail Runner

The concurrent guardrail runner screens each ReAct iteration's generated output
against configurable policies using a fast-slot LLM. It runs **in parallel** with
the primary agent loop and never blocks execution.

### Configuration

The guardrail is configured via an optional `[guardrail]` block in
`exa.config.toml`:

```toml
[guardrail]
enabled = false                         # opt-in, disabled by default
check_interval_iterations = 1           # screen every Nth iteration (1 = every)
screen_final_output = true              # also screen output before Review gate

[[guardrail.policies]]
policy_id = "safety-policy"
description = "Detect harmful content in agent output"
blueprint = "guardrail/safety"
severity = "block"                      # "warn" (logs only) or "block" (halts)
```

### Behaviour

- **Fire-and-forget**: `screen()` is called after each iteration but never
  awaited on the critical path.
- **Fail-open**: If the screening model errors or times out, the error is
  journaled as `guardrail.screen.error` and execution continues.
- **Blocking violations**: A `block`-severity violation halts the loop via the
  Plan Amendment gate (`guardrail_violation` trigger). The pre-execution
  Quality Gate remains the hard gate.
- **Zero overhead when disabled**: With `enabled = false`, no runner is
  constructed and no code path changes.

### Edition

**Team/Enterprise only.** In Solo builds, the guardrail runner is never
constructed even if `enabled = true`. See `ARCHITECTURE.md` for the
architecture overview.
