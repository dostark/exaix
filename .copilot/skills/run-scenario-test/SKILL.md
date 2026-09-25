---
name: run-scenario-test
agent: general
tools:
  - bash
  - read_file
  - search_files
scope: dev
title: "Scenario Framework Testing & Evaluation (#run-scenario-test)"
description: Run the scenario framework's evaluation scenarios (including live provider runs) and debug their failures.
short_summary: "Run exactl eval scenarios — self-contained packs, sandbox-backed agent_flows, and live provider legs — and debug failures with the sandbox journal / daemon-log / verdict helpers."
version: "1.0.0"
topics: ["evaluation", "scenario-framework", "testing", "testing", "debugging"]
qwen_skill: run-scenario-test
---

```text
Key points

- Scenarios YAML live in tests/scenario_framework/scenarios/<pack>/. Run them with
  `exactl eval run --scenario <ID>` — pass the scenario ID, never the file path.
  `--eval-mode` is appended internally by `exactl eval run`; do not pass it yourself.
- A bare `--scenario`/`--pack`/`--tag` selection is CI-safe: it drops `provider-live` and
  non-`auto` scenarios. Ask for an excluded tag explicitly (e.g. `--tag provider-live`) to
  select the nightly/live tier.
- Exit code: 0 = all scenarios at/above `--score-threshold` (default 0.5); 1 = any failed;
  2 = infrastructure error (outside step execution).
- Run results land in tests/scenario_framework/output/eval-report.json and in eval history
  (`exactl eval history`, SQLite + JSONL under output/history/).
- A failed run's per-run sandbox is KEPT at <parent-of-repo>/exaix-sandboxes/<run-id>/
  (base dir via EXA_SANDBOX_BASE); a successful one is reclaimed. Evidence under output/ is
  always kept.
- The agent_flows / swe_tasks / provider-live legs need a real daemon and often a real
  provider. Prefer the subscription Claude Code CLI (claude-cli, no metered key) for live
  legs where the scenario is configured for it.

Run commands (quick reference)
  exactl eval run --pack eval-smoke                                # self-contained, no daemon
  exactl eval run --pack blueprint-eval --score-threshold 0.7      # threshold gate
  exactl eval run --scenario <id>                                  # one scenario (id, not path)
  exactl eval run --pack agent_flows                               # sandbox + daemon scenarios
  exactl eval run --tag provider-live --max-cost-usd 0.5           # live tier, budget-capped
  exactl eval run --scenario <id> --trials 5                       # reliability metrics
  exactl eval history --last 10                                    # run history
  exactl eval compare --run-a <id> --run-b <id>                    # per-step score deltas
  exactl eval report --view failures                               # why runs fail

Live provider/judge configuration
  EXA_LLM_PROVIDER=<provider>   driver (analysis/planning/execution); reads its API key env.
  EXA_EVAL_LLM_PROVIDER/MODEL   the llm-judge model; overrides the scenario's driver model.
  For a subscription Claude Code leg: [models."<name>"] { provider = "claude-cli",
  model = "<claude model>" }; ensure the claude CLI is on PATH and logged in
  (claude login, or CLAUDE_CODE_OAUTH_TOKEN). claude-cli needs no ANTHROPIC_API_KEY.

Debug a failing scenario (do this in order)
  1. Read the run's own "--- FAILURE DETAILS ---" block: the exact Step Failed, whether the
     criterion ran at Stage input or output, the criterion Kind, and Observed vs Expected.
  2. The failing step's sandbox is kept. Locate it:
       tests/scenario_framework/bin/sandbox                 # latest kept sandbox path
       tests/scenario_framework/bin/sandbox --list          # all sandboxes
     Then inspect the sandbox (a real Exaix workspace): request files + status in
     Workspace/Requests/*.md and Workspace/Plans/, and the Activity Journal:
       sqlite3 <sandbox>/.exa/journal.db "select action_type,target,payload from activity order by rowid desc limit 50;"
       tests/scenario_framework/bin/journal                 # tail/grep/errors/delegate/trace helpers
  3. Crashes the journal can't show live in the daemon log:
       tests/scenario_framework/bin/daemon-log               # tail/errors/grep
  4. Get the authoritative per-step pass/fail without re-running:
       tests/scenario_framework/bin/verdict <output-dir>     # from the run's manifest
  5. Run ONE scenario verbosely to reproduce and watch live:
       tests/scenario_framework/bin/debug-scenario <id>      # prints manifest verdict

Common failure classes and fixes
  - EVERYTHING passed but the journal criterion: it queried too early. The daemon processes
    requests asynchronously, so put a wait step BEFORE the assertion:
        type: exactl, command: journal, args: [wait, --event, <event>, --since-rowid,
        $JOURNAL_BASELINE, --timeout, "300"]
    `$JOURNAL_BASELINE` is injected by the runner. See scenarios/agent_flows/effort-auto-resolution.yaml.
  - Config error "default_model '<x>' not found in [models]": every default_model must have a
    matching [models."<x>"] block (provider + model). The daemon and exactl read the sandbox
    exa.config.toml; the scenario writes it via a write-file step BEFORE daemon start.
  - Request created but never processed (request.created only, request stays status: pending):
    no daemon was running. Add daemon lifecycle steps at the START of each config change:
        type: exactl, command: daemon, args: [start] (or restart to reload config), then
        journal wait --event daemon.ready --since-rowid $JOURNAL_BASELINE --timeout 30.
  - Flow fails with `source "step" but no stepId specified`: a step input of source: step
    uses `stepId: <id>`, not `from: [<id>]`. aggregate uses `from`.
  - Flow steps depend on a portal they never got: the flow needs the portal mounted before the
    request (write config + portal add + restart daemon). Use a fixture flow that needs no portal
    if the leg only exercises effort/thinking resolution.
  - exactl shim error "Module not found .../apps/exactl/main.ts": the installed shim points at a
    stale path. Reinstall:
      deno install --global --force --allow-all --config deno.json -n exactl apps/exactl/main.ts
  - Skill IDs in journal payloads are UUIDs (SkillSchema.id), not the kebab skill_id — assert
    floors_applied etc. with the UUID.
  - journal payload_includes only accepts ARRAY payload fields (e.g. floors_applied); scalar
    fields (effort_basis, effort) cannot be asserted by journal-event-exists. Assert array fields,
    or assert the scalar via unit/integration tests instead.
  - Scenario YAML shape errors: validate against the framework schema before running:
      deno eval 'import { ScenarioSchema } from "./tests/scenario_framework/schema/scenario_schema.ts";
      import { parse as py } from "jsr:@std/yaml";
      console.log(ScenarioSchema.safeParse(py(await Deno.readTextFile("<scenario>"))).success)' --allow-read
  - Live legs that look wrong on clear provider signals: check the sandbox daemon.log for
    provider errors and the journal for the provider/effort events (e.g. agent.effort_resolved).

Authoring pointers
  - Authoring language: tests/scenario_framework/SCENARIO_DSL.md (every step + criterion kind).
  - Authoring workflow: tests/scenario_framework/AUTHORING.md.
  - Full evaluation guide (scoring, history, CI, value arms): docs/Exaix_Evaluation.md.
  - Framework architecture + sandbox lifecycle: tests/scenario_framework/README.md (§2, §6).
  - Every new scenario must be schema-valid and should carry input_criteria/output_criteria
    with score_weight; a passing pack only means something if it is known to go red
    (runner/pack_mutations.ts).

Reclaim failed-run sandboxes
  deno task scenario:prune           # dry-run, 7-day window
  deno task scenario:prune --days 0 --apply

Canonical prompt (short):
"Run the {pack | scenario | tag | live legs} of the scenario framework for {feature},
including evaluation, and debug any failures to a fix — report the exact command, the
failing step/criterion with observed-vs-expected evidence, and the fix."
```

## Reference documents

For broader knowledge, read the full documents this skill condenses:

- [docs/Exaix_Evaluation.md](../../../docs/Exaix_Evaluation.md) — the full evaluation guide: CLI reference, scoring model, history & storage, CI integration, value evaluation arms.
- [docs/Exaix_User_Guide.md](../../../docs/Exaix_User_Guide.md) — especially §2.5a: subscription Claude Code / opencode CLI delegate configuration and auth.
- [tests/scenario_framework/README.md](../../../tests/scenario_framework/README.md) — framework architecture, sandbox setup/lifecycle, debugging helpers, recorded fixtures.
- [tests/scenario_framework/SCENARIO_DSL.md](../../../tests/scenario_framework/SCENARIO_DSL.md) — the complete scenario authoring language: every step type and criterion kind.
- [tests/scenario_framework/AUTHORING.md](../../../tests/scenario_framework/AUTHORING.md) — the step-by-step scenario authoring workflow.

## Examples

- `#run-scenario-test Run the effort-auto-resolution scenario`
- `#run-scenario-test Run all agent_flows scenarios and check the failure reasons`
- `#run-scenario-test Debug why the journal criterion in the new scenario fails`

## Output format

1. Command(s) run, with the scenario id and any provider/config env.
1. Result summary: suite score, threshold, exit code.
1. For a failure: failed step + criterion, observed vs expected, and the sandbox journal/daemon-log evidence.
1. The fix (scenario/steps fix, config fix, or re-run outcome).

## Related

- [test-development](../test-development/SKILL.md) — scenario authoring and test placement
- [tdd-workflow](../tdd-workflow/SKILL.md) — RED/GREEN workflow for the code under test
- [fix-bug](../fix-bug/SKILL.md) — regression-driven bug fixing surfaced by scenarios
- [explore](../explore/SKILL.md) — navigate the codebase a scenario touches

---
exaix:
  skill_id: run-scenario-test
  related_skills: [test-development, tdd-workflow, fix-bug, explore]
  triggers:
    keywords: [scenario, scenario test, run evaluation, eval run, exactl eval, debug scenario, scenario framework]
    task_types: [testing, feature, bugfix]
    tags: [evaluation, testing, scenario-framework]
  constraints:
    - "Use `exactl eval run --scenario <id>` (scenario ID), never the scenario file path"
    - "Never pass --eval-mode to exactl eval run; it is appended internally"
    - "Prefer package/tests integration tests for deterministic in-process assertions; use scenarios for score-, daemon-, or provider-level behaviour"
    - "Validate new scenario YAML against ScenarioSchema before running"
  output_requirements:
    - "The exact command(s) to run the scenario"
    - "For a failure: sandbox path, the failing step/criterion, and the observed-vs-expected evidence"
    - "The fix applied or the command that reproduces the failure"
  quality_criteria:
    - name: command_accuracy
      description: Run and debug commands reflect the current CLI and framework behavior
      weight: 40
    - name: evidence_based
      description: Failures diagnosed from the sandbox journal/daemon log, not assumed
      weight: 35
    - name: minimal_scope
      description: Scenarios used only where they add value over unit/integration tests
      weight: 25
---
