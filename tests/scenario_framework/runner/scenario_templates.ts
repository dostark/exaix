/**
 * @module ScenarioFrameworkScenarioTemplates
 * @path tests/scenario_framework/runner/scenario_templates.ts
 * @description Implements Step 8 starter-template rendering and Phase 141
 *   swe-task template for the todo_app fixture benchmark scenarios.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/templates/scenario_template.yaml, tests/scenario_framework/tests/unit/pack_generalization_test.ts]
 */

import type { Opt, Reason } from "@exaix/core/types";
import { SCHEMA_VERSION } from "../schema/version.ts";
import {
  BARE_DELEGATE_LAUNCH_SHAPES,
  BARE_DELEGATE_STEP_ID,
  CREDENTIAL_STORES,
  REQUEST_FIXTURE_CONTENT_SENTINEL,
  spliceRequestFixtureSentinel,
} from "./matrix_expander.ts";
import { buildOpencodePermissionConfig } from "@exaix/session";

export interface IScenarioTemplateOptions {
  id: string;
  title: string;
  pack: string;
  tags: string[];
  requestFixture: string;
}
export interface IExternalBenchTaskTemplateOptions {
  id: string;
  title: string;
  requestFixture: string;
  /** Portal directory relative to fixtures/portals/, e.g. "external/terminal_bench/log-summary". */
  portalDir: string;
  /** The vendored task.json's scoped_test_cmd — the benchmark's own outcome criterion. */
  scopedTestCmd: string;
  /** Directory (relative to fixtures/external/terminal_bench/<task-id>/) holding the hidden
   *  oracle test content — mounted read-only ONLY for the verify step, at /oracle_tests,
   *  never visible to the delegate step. */
  oracleTestsDir: string;
  /** Delegate tool, looked up in the shared BARE_DELEGATE_LAUNCH_SHAPES. */
  tool: string;
  /** Pinned upstream release SHA (task.json's `source.version`) — stamped onto the scenario as
   *  a `bench-version:<sha>` tag so eval-history entries can be attributed to a specific
   *  benchmark release, not just the benchmark name. */
  benchmarkVersion: string;
  scoringWeights?: Record<string, number>;
}

export interface ICellDef {
  tool: string;
  provider: string;
  config: string;
  requiresBin?: string;
  requiresKey?: string;
  /** Marks a bare-delegate baseline cell (rendered as `harness: bare`). */
  harness?: "bare";
}

export interface ISweTaskTemplateOptions {
  id: string;
  title: string;
  requestFixture: string;
  cells: ICellDef[];
  portal?: string;
  trajectorySequence?: Array<{ tool: string }>;
  scoringWeights?: Record<string, number>;
  judgeContextPath?: string;
  judgeEvidencePath?: string;
}

/** The outcome step id shared by the Exaix and bare swe templates — the outcome channel a
 *  harness-lift comparison filters on. */
export const VERIFY_TESTS_STEP_ID = "verify-tests";

/** Default wall-clock bound for the bare delegate step. */
const DEFAULT_BARE_DELEGATE_TIMEOUT_SEC = 600;
/** OpenCode agent key for the bare-delegate SWE-task cell's staged permission config. */
export const BARE_DELEGATE_AGENT_ID = "bare-delegate";
// Default wall-clock bound for the external-bench verify step: a real pytest run against the
// hidden oracle-tests mount must declare its own bound explicitly rather than silently inherit
// step_executor.ts's generic `timeout_sec ?? 120` fallback.
const DEFAULT_EXTERNAL_BENCH_VERIFY_TIMEOUT_SEC = 300;

interface IIdSequenceStepOptions {
  id: string;
  stepType: string;
  sourceStep: string;
  expectedSequence: Array<{ tool: string }>;
  orderMatters?: boolean;
  allowExtraTools?: boolean;
  partialCredit?: boolean;
}

export function renderScenarioTemplate(
  options: IScenarioTemplateOptions,
): string {
  return [
    `# Schema version: ${SCHEMA_VERSION}`,
    `schema_version: "${SCHEMA_VERSION}"`,
    `id: "${options.id}"`,
    `title: "${options.title}"`,
    `pack: "${options.pack}"`,
    `tags: [${options.tags.map((tag) => `"${tag}"`).join(", ")}]`,
    `request_fixture: "${options.requestFixture}"`,
    'mode_support: ["auto"]',
    "portals: []",
    "steps:",
    '  - id: "create-request"',
    '    type: "exactl"',
    '    command: "request create"',
    `    args: ["--from-file", "${options.requestFixture}"]`,
    "    input_criteria:",
    '      - id: "request-fixture-exists"',
    '        kind: "file-exists"',
    `        path: "${options.requestFixture}"`,
    "    output_criteria:",
    '      - id: "request-command-succeeded"',
    '        kind: "command-exit-code"',
    "        equals: 0",
    "",
  ].join("\n");
}

// swe_tasks dogfood-loop template

const INDENT = "  ";

function renderCells(cells: ICellDef[]): string {
  const lines: string[] = ["matrix:", "  cells:"];
  for (const c of cells) {
    lines.push(`    - tool: "${c.tool}"`);
    lines.push(`      provider: "${c.provider}"`);
    lines.push(`      config: "${c.config}"`);
    if (c.requiresBin) lines.push(`      requires_bin: "${c.requiresBin}"`);
    if (c.requiresKey) lines.push(`      requires_key: "${c.requiresKey}"`);
    if (c.harness) lines.push(`      harness: "${c.harness}"`);
  }
  return lines.join("\n");
}

function renderOutputCriteria(
  criteria: Array<
    { id: string; kind: string; equals?: number; scoreWeight?: number; contains?: string[]; pathPattern?: string }
  >,
): string {
  if (criteria.length === 0) return `${INDENT}output_criteria: []`;
  const lines: string[] = [`${INDENT}output_criteria:`];
  for (const c of criteria) {
    lines.push(`      - id: "${c.id}"`);
    lines.push(`        kind: "${c.kind}"`);
    if (c.equals !== undefined) lines.push(`        equals: ${c.equals}`);
    if (c.contains) lines.push(`        contains: [${c.contains.map((s) => `"${s}"`).join(", ")}]`);
    if (c.pathPattern) lines.push(`        path_pattern: "${c.pathPattern}"`);
    if (c.scoreWeight !== undefined) lines.push(`        score_weight: ${c.scoreWeight}`);
  }
  return lines.join("\n");
}

function _shellStep(
  id: string,
  command: string,
  args: string[],
  outputCriteria: Array<
    { id: string; kind: string; equals?: number; scoreWeight?: number; contains?: string[]; pathPattern?: string }
  >,
  env?: Opt<Record<string, string>, Reason.OptionalContext>,
  stepPassThreshold?: Opt<number, Reason.ExecutionConfig>,
): string {
  const lines: string[] = [
    `  - id: "${id}"`,
    `    type: "shell"`,
    `    command: "${command}"`,
    `    args: [${args.map((a) => `"${a}"`).join(", ")}]`,
  ];
  if (env && Object.keys(env).length > 0) {
    lines.push(`    env:`);
    for (const [k, v] of Object.entries(env)) {
      lines.push(`      ${k}: "${v}"`);
    }
  }
  if (stepPassThreshold !== undefined) {
    lines.push(`    step_pass_threshold: ${stepPassThreshold}`);
  }
  lines.push(renderOutputCriteria(outputCriteria));
  return lines.join("\n");
}

function _exactlStep(
  id: string,
  command: string,
  args: string[],
  outputCriteria: Array<
    { id: string; kind: string; equals?: number; scoreWeight?: number; contains?: string[]; pathPattern?: string }
  >,
  env?: Opt<Record<string, string>, Reason.OptionalContext>,
): string {
  const lines: string[] = [
    `  - id: "${id}"`,
    `    type: "exactl"`,
    `    command: "${command}"`,
    `    args: [${args.map((a) => `"${a}"`).join(", ")}]`,
  ];
  if (env && Object.keys(env).length > 0) {
    lines.push(`    env:`);
    for (const [k, v] of Object.entries(env)) {
      lines.push(`      ${k}: "${v}"`);
    }
  }
  lines.push(renderOutputCriteria(outputCriteria));
  return lines.join("\n");
}

function _waitForFileStep(
  id: string,
  pattern: string,
  timeoutSec: number,
  failureGlob?: Opt<string, Reason.QueryFilter>,
): string {
  const lines: string[] = [
    `  - id: "${id}"`,
    `    type: "wait-for-file"`,
    `    args: ["${pattern}"]`,
    `    timeout_sec: ${timeoutSec}`,
  ];
  if (failureGlob) {
    lines.push(`    failure_glob: "${failureGlob}"`);
  }
  lines.push(`    input_criteria: []`);
  lines.push(`    output_criteria: []`);
  return lines.join("\n");
}

function _waitForJournalStep(id: string, eventType: string, timeoutSec: number): string {
  return [
    `  - id: "${id}"`,
    `    type: "exactl"`,
    `    command: "journal"`,
    `    args: ["wait", "--event", "${eventType}", "--since-rowid", "$JOURNAL_BASELINE", "--timeout", "${timeoutSec}"]`,
    `    timeout_sec: ${timeoutSec}`,
    `    input_criteria: []`,
    `    output_criteria: []`,
  ].join("\n");
}

function _idSequenceStep(opts: IIdSequenceStepOptions): string {
  return [
    `  - id: "${opts.id}"`,
    `    type: "${opts.stepType}"`,
    `    source_step: "${opts.sourceStep}"`,
    `    expected_sequence:`,
    ...opts.expectedSequence.map((e) => `      - tool: "${e.tool}"`),
    opts.orderMatters !== undefined ? `    order_matters: ${opts.orderMatters}` : "",
    opts.allowExtraTools !== undefined ? `    allow_extra_tools: ${opts.allowExtraTools}` : "",
    opts.partialCredit !== undefined ? `    partial_credit: ${opts.partialCredit}` : "",
    `    input_criteria: []`,
    `    output_criteria: []`,
  ].filter(Boolean).join("\n");
}

// The pinned-worktree setup steps shared by the Exaix and bare swe templates, rendered by one
// function so they can never diverge (both must run the task against the same worktree state).
// `includeCliDelegatePatch` adds a CLI-delegate-only step the Exaix loop needs but bare cells don't.
function renderSweSetupSteps(
  portalDir: string,
  opts: { includeCliDelegatePatch: boolean },
): string[] {
  return [
    `  - id: "setup-db"`,
    `    type: "shell"`,
    `    command: "deno"`,
    `    args: ["run", "-A", "--config", "$FRAMEWORK_HOME/../../deno.json", "$FRAMEWORK_HOME/../../scripts/setup_db.ts"]`,
    `    env:`,
    `      EXA_MIGRATIONS_DIR: "$FRAMEWORK_HOME/../../migrations"`,
    `    output_criteria:`,
    `      - id: "setup-done"`,
    `        kind: "command-exit-code"`,
    `        equals: 0`,
    "",
    `  - id: "setup-portal-repo"`,
    `    type: "shell"`,
    `    command: "sh"`,
    `    args: ["-c", "cp -r \\"$FRAMEWORK_HOME/fixtures/portals/${portalDir}\\" \\"$WORKSPACE_ROOT/todo-app\\" && cd \\"$WORKSPACE_ROOT/todo-app\\" && git init -q && git add -A && git -c user.email=swe-tasks@exaix.dev -c user.name=swe-tasks commit -q -m 'init todo-app fixture'"]`,
    `    output_criteria:`,
    `      - id: "portal-repo-initialized"`,
    `        kind: "command-exit-code"`,
    `        equals: 0`,
    "",
    `  - id: "setup-blueprints"`,
    `    type: "shell"`,
    `    command: "cp"`,
    `    args: ["-r", "$FRAMEWORK_HOME/../../Blueprints", "$WORKSPACE_ROOT/Blueprints"]`,
    `    output_criteria:`,
    `      - id: "blueprints-copied"`,
    `        kind: "command-exit-code"`,
    `        equals: 0`,
    "",
    ...(opts.includeCliDelegatePatch
      ? [
        `  - id: "patch-blueprint-capability"`,
        `    type: "shell"`,
        `    command: "sh"`,
        `    args: ["-c", "sed -i 's/\\"react\\"/\\"react\\", \\"cli_delegate\\"/' $WORKSPACE_ROOT/Blueprints/Identities/senior-coder.md && grep -q cli_delegate $WORKSPACE_ROOT/Blueprints/Identities/senior-coder.md"]`,
        `    output_criteria:`,
        `      - id: "capability-patched"`,
        `        kind: "command-exit-code"`,
        `        equals: 0`,
        "",
      ]
      : []),
    `  - id: "setup-memory"`,
    `    type: "shell"`,
    `    command: "cp"`,
    `    args: ["-r", "$FRAMEWORK_HOME/../../Memory", "$WORKSPACE_ROOT/Memory"]`,
    `    output_criteria:`,
    `      - id: "memory-copied"`,
    `        kind: "command-exit-code"`,
    `        equals: 0`,
    "",
  ];
}

/** The outcome step both templates share — the only scoring channel that exists for bare cells. */
function renderSweVerifyTestsStep(scoreWeights: Record<string, number>): string {
  return [
    `  - id: "${VERIFY_TESTS_STEP_ID}"`,
    `    type: "shell"`,
    `    command: "sh"`,
    `    args: ["-c", "cd \\"$WORKSPACE_ROOT/todo-app\\" && deno test src/"]`,
    `    output_criteria:`,
    `      - id: "tests-pass"`,
    `        kind: "command-exit-code"`,
    `        equals: 0`,
    scoreWeights.tests_pass !== undefined
      ? `        score_weight: ${scoreWeights.tests_pass}`
      : `        score_weight: 0.3`,
    "",
  ].join("\n");
}

/** Renders a complete swe_tasks scenario YAML; irrelevant per-cell steps are skipped at expansion time via matrix cell guards. */
export function renderSweTaskTemplate(
  task: ISweTaskTemplateOptions,
): string {
  const hasCliDelegate = task.cells.some((c) => c.requiresBin);
  const scoreWeights = task.scoringWeights ?? {};
  const portalDir = task.portal ?? "todo_app";

  const parts: string[] = [
    `schema_version: "1.0.0"`,
    `id: "${task.id}"`,
    `title: "${task.title}"`,
    `pack: "swe_tasks"`,
    `tags: ["swe", "provider-live"]`,
    `request_fixture: "${task.requestFixture}"`,
    `portals: []`,
    `mode_support: ["auto"]`,
    "",
    renderCells(task.cells),
    "",
    "steps:",
    ...renderSweSetupSteps(portalDir, { includeCliDelegatePatch: hasCliDelegate }),
    // daemon lifecycle
    `  - id: "start-daemon"`,
    `    type: "exactl"`,
    `    command: "daemon"`,
    `    args: ["start"]`,
    `    output_criteria:`,
    `      - id: "daemon-started"`,
    `        kind: "command-output-contains"`,
    `        contains: ["daemon.started"]`,
    "",
    `  - id: "add-portal"`,
    `    type: "exactl"`,
    `    command: "portal"`,
    `    args: ["add", "$WORKSPACE_ROOT/todo-app", "todo-app"]`,
    `    output_criteria:`,
    `      - id: "portal-added"`,
    `        kind: "command-exit-code"`,
    `        equals: 0`,
    "",
    `  - id: "restart-daemon"`,
    `    type: "exactl"`,
    `    command: "daemon"`,
    `    args: ["restart"]`,
    `    output_criteria:`,
    `      - id: "daemon-restarted"`,
    `        kind: "command-output-contains"`,
    `        contains: ["daemon.restarted"]`,
    "",
    `  - id: "wait-for-daemon-ready"`,
    `    type: "exactl"`,
    `    command: "journal"`,
    `    args: ["wait", "--event", "daemon.ready", "--since-rowid", "$JOURNAL_BASELINE", "--timeout", "30"]`,
    `    timeout_sec: 30`,
    `    input_criteria: []`,
    `    output_criteria: []`,
    "",
    // request → plan → execution
    `  - id: "submit-request"`,
    `    type: "exactl"`,
    `    command: "request"`,
    hasCliDelegate
      ? `    args: ["--file", "$REQUEST_FIXTURE", "--portal", "todo-app", "--identity", "senior-coder"]`
      : `    args: ["--file", "$REQUEST_FIXTURE", "--portal", "todo-app"]`,
    `    output_criteria:`,
    `      - id: "request-submitted"`,
    `        kind: "command-output-contains"`,
    `        contains: ["request.created"]`,
    "",
    `  - id: "wait-for-plan"`,
    `    type: "wait-for-file"`,
    `    args: ["**/Plans/*_plan.md"]`,
    `    timeout_sec: 180`,
    hasCliDelegate ? `    failure_glob: "**/Workspace/Rejected/*_rejected.md"` : "",
    `    output_criteria:`,
    `      - id: "plan-produced"`,
    `        kind: "file-found"`,
    `        path_pattern: "**/Plans/*_plan.md"`,
    scoreWeights.plan_produced !== undefined
      ? `        score_weight: ${scoreWeights.plan_produced}`
      : `        score_weight: 0.15`,
    "",
    `  - id: "approve-plan"`,
    `    type: "exactl"`,
    `    command: "plan"`,
    `    args: ["approve-all"]`,
    `    output_criteria:`,
    `      - id: "plan-approved"`,
    `        kind: "command-output-contains"`,
    `        contains: ["approved"]`,
    "",
    `  - id: "wait-for-execution-completion"`,
    `    type: "wait-for-file"`,
    `    args: ["**/Archive/*_plan.md"]`,
    `    timeout_sec: 300`,
    `    output_criteria:`,
    `      - id: "execution-completed"`,
    `        kind: "file-found"`,
    `        path_pattern: "**/Archive/*_plan.md"`,
    scoreWeights.execution_completed !== undefined
      ? `        score_weight: ${scoreWeights.execution_completed}`
      : `        score_weight: 0.15`,
    "",
    // review → test
    `  - id: "approve-review"`,
    `    type: "shell"`,
    `    command: "sh"`,
    `    args: ["-c", "trace_id=$(sqlite3 \\"$WORKSPACE_ROOT/.exa/journal.db\\" \\"SELECT trace_id FROM activity WHERE action_type = 'request.created' ORDER BY rowid ASC LIMIT 1\\"); short_id=$(printf '%s' \\"$trace_id\\" | cut -c1-8); echo \\"trace_id: $trace_id\\"; \\"$FRAMEWORK_HOME/bin/exactl\\" review approve \\"request-$short_id\\""]`,
    `    output_criteria:`,
    `      - id: "review-approved"`,
    `        kind: "command-output-contains"`,
    `        contains: ["review.approved"]`,
    scoreWeights.review_approved !== undefined
      ? `        score_weight: ${scoreWeights.review_approved}`
      : `        score_weight: 0.15`,
    "",
    renderSweVerifyTestsStep(scoreWeights),
    // CLI-delegate only assertions
    ...(hasCliDelegate
      ? [
        `  - id: "assert-no-dynamic-tool-calls"`,
        `    type: "shell"`,
        `    command: "sh"`,
        `    args: ["-c", "count=$(sqlite3 \\"$WORKSPACE_ROOT/.exa/journal.db\\" \\"SELECT COUNT(*) FROM activity WHERE action_type = 'dynamic_tool_call'\\"); echo \\"dynamic_tool_call count: $count\\"; test \\"$count\\" = \\"0\\""]`,
        `    output_criteria:`,
        `      - id: "no-dynamic-tool-calls"`,
        `        kind: "command-exit-code"`,
        `        equals: 0`,
        scoreWeights.no_dynamic_tool_calls !== undefined
          ? `        score_weight: ${scoreWeights.no_dynamic_tool_calls}`
          : `        score_weight: 0.2`,
        "",
        `  - id: "assert-files-changed"`,
        `    type: "shell"`,
        `    command: "sh"`,
        `    args: ["-c", "n=$(sqlite3 \\"$WORKSPACE_ROOT/.exa/journal.db\\" \\"SELECT COALESCE(SUM(json_extract(payload,'$.files_changed')),0) FROM activity WHERE action_type = 'agent.execution_completed'\\"); echo \\"files_changed total: $n\\"; test \\"$n\\" -gt 0"]`,
        `    output_criteria:`,
        `      - id: "files-changed-nonempty"`,
        `        kind: "command-exit-code"`,
        `        equals: 0`,
        scoreWeights.files_changed !== undefined
          ? `        score_weight: ${scoreWeights.files_changed}`
          : `        score_weight: 0.2`,
        "",
      ]
      : []),
    // trajectory
    ...(!hasCliDelegate
      ? [
        `  - id: "assert-trajectory"`,
        `    type: "trajectory-assert"`,
        `    source_step: "wait-for-execution-completion"`,
        `    expected_sequence:`,
        ...(task.trajectorySequence ?? [{ tool: "read_file" }, { tool: "edit_file" }]).map(
          (e) => `      - tool: "${e.tool}"`,
        ),
        `    order_matters: false`,
        `    allow_extra_tools: true`,
        `    partial_credit: true`,
        `    input_criteria: []`,
        `    output_criteria: []`,
        "",
      ]
      : []),
    // LLM judge
    `  - id: "prepare-llm-judge-evidence"`,
    `    type: "shell"`,
    `    command: "sh"`,
    `    args: ["-c", "cat \\"$WORKSPACE_ROOT/todo-app/${
      task.judgeEvidencePath ?? "src/main.ts"
    }\\" > \\"$WORKSPACE_ROOT/llm-judge-input.txt\\""]`,
    `    output_criteria:`,
    `      - id: "evidence-prepared"`,
    `        kind: "command-exit-code"`,
    `        equals: 0`,
    "",
    `  - id: "judge-quality"`,
    `    type: "shell"`,
    `    command: "sh"`,
    `    args: ["-c", "true"]`,
    `    step_pass_threshold: 0.8`,
    `    env:`,
    `      EXA_EVAL_LLM_MOCK: "false"`,
    `      EXA_LLM_PROVIDER: "$CELL_PROVIDER"`,
    `    output_criteria:`,
    `      - id: "llm-judge-quality"`,
    `        kind: "llm-judge"`,
    `        preset: "GOAL_ALIGNED_REVIEW"`,
    `        evidence_path: "llm-judge-input.txt"`,
    task.judgeContextPath ? `        context_path: "${task.judgeContextPath}"` : "",
    `        score_threshold: 0.5`,
    scoreWeights.llm_judge_quality !== undefined
      ? `        score_weight: ${scoreWeights.llm_judge_quality}`
      : `        score_weight: 0.4`,
    "",
    // cleanup
    `  - id: "stop-daemon"`,
    `    type: "exactl"`,
    `    command: "daemon"`,
    `    args: ["stop"]`,
    `    output_criteria:`,
    `      - id: "daemon-stopped"`,
    `        kind: "command-output-contains"`,
    `        contains: ["daemon.stopped"]`,
    "",
  ];

  return parts.filter(Boolean).join("\n");
}

// Renders the bare-delegate baseline: same pinned-worktree setup and `verify-tests` outcome step
// as the Exaix template, but process/plan steps are structurally absent (bare cells have no
// journal) — process-channel criteria are excluded from BOTH sides of a lift comparison, never scored as 0.
export function renderSweTaskBareTemplate(
  task: ISweTaskTemplateOptions,
): string {
  const scoreWeights = task.scoringWeights ?? {};
  const portalDir = task.portal ?? "todo_app";

  // The bare delegate's opencode permission config is staged INTO the sandbox worktree via
  // OPENCODE_CONFIG, so the raw CLI cannot read outside it — e.g. the repo's
  // fixtures/swe_tasks/<task>/reference.patch solution. `**` = everything under the worktree.
  const bareScopeConfigJson = JSON.stringify(buildOpencodePermissionConfig(["**"], BARE_DELEGATE_AGENT_ID))
    .replaceAll('"', '\\"');

  const parts: string[] = [
    `schema_version: "1.0.0"`,
    `id: "${task.id}"`,
    `title: "${task.title}"`,
    `pack: "swe_tasks"`,
    `tags: ["swe", "provider-live"]`,
    `request_fixture: "${task.requestFixture}"`,
    `portals: []`,
    `mode_support: ["auto"]`,
    "",
    renderCells(task.cells.map((c) => ({ ...c, harness: "bare" }))),
    "",
    "steps:",
    ...renderSweSetupSteps(portalDir, { includeCliDelegatePatch: false }),
    `  - id: "stage-bare-opencode-config"`,
    `    type: "shell"`,
    `    command: "sh"`,
    `    args: ["-c", "printf '%s' '${bareScopeConfigJson}' > \\"$WORKSPACE_ROOT/todo-app/opencode.jsonc\\""]`,
    `    output_criteria:`,
    `      - id: "opencode-config-staged"`,
    `        kind: "command-exit-code"`,
    `        equals: 0`,
    `  - id: "${BARE_DELEGATE_STEP_ID}"`,
    `    type: "shell"`,
    `    command: "opencode"`,
    `    env:`,
    `      OPENCODE_CONFIG: "$WORKSPACE_ROOT/todo-app/opencode.jsonc"`,
    `    args: ["run", "--format", "json", "--dir", "$WORKSPACE_ROOT/todo-app", "${REQUEST_FIXTURE_CONTENT_SENTINEL}"]`,
    `    timeout_sec: ${DEFAULT_BARE_DELEGATE_TIMEOUT_SEC}`,
    `    output_criteria:`,
    `      - id: "delegate-ran"`,
    `        kind: "command-exit-code"`,
    `        equals: 0`,
    "",
    renderSweVerifyTestsStep(scoreWeights),
  ];

  return parts.filter(Boolean).join("\n");
}

// external_bench_task template (Terminal-Bench container-portal)

/** Container mount destination + WORKDIR for external-benchmark tasks — matches the
 *  upstream benchmark's own container convention (Terminal-Bench uses `/app`), unlike the
 *  bare swe_tasks jail's `/worktree`. */
const EXTERNAL_BENCH_MOUNT_DEST = "/app";
/** Where the hidden oracle test content is mounted — verify step only, never the delegate step. */
const ORACLE_TESTS_MOUNT_DEST = "/oracle_tests";

// Renders external_bench_task: doesn't reuse renderSweSetupSteps (hardcoded copy+`git init`) since
// the exemplar is already vendored. Delegate/verify steps are declarative `run-script` steps that
// invoke `run_jailed.ts`, whose single `docker run --rm` per step guarantees teardown on every exit.

/** Gitignored, framework-relative root for STABLE credential staging dirs — reuses the
 *  already-gitignored `output/` tree so a staged credential copy can never be accidentally committed. */
const CREDENTIAL_STAGING_ROOT = "$FRAMEWORK_HOME/output/.eval-jail-creds";

/** `run_jailed.ts`'s path, `$FRAMEWORK_HOME`-relative — every external_bench_task container
 *  launch routes through this single wrapper instead of a raw `docker run` baked into the
 *  persisted scenario YAML (GitHub issue #4). */
const RUN_JAILED_SCRIPT = "$FRAMEWORK_HOME/scripts/run_jailed.ts";

/** Renders a YAML flow-sequence of JSON-quoted strings, e.g. `["a", "b"]` — matches how every
 *  other step's `args:` line in this module is written (JSON string syntax is valid YAML flow
 *  scalar syntax), so a run-script step's args render identically to a shell step's. */
function yamlArgsList(values: string[]): string {
  return `[${values.map((v) => JSON.stringify(v)).join(", ")}]`;
}

/** The shared `run_jailed.ts` invocation head (before its own `--flag value` pairs) every
 *  external_bench_task run-script step starts with. */
const RUN_JAILED_HEAD = ["run", "-A", "--config", "$FRAMEWORK_HOME/../../deno.json", RUN_JAILED_SCRIPT];

export function renderExternalBenchTaskTemplate(task: IExternalBenchTaskTemplateOptions): string {
  const scoreWeights = task.scoringWeights ?? {};
  const shape = BARE_DELEGATE_LAUNCH_SHAPES[task.tool];
  if (!shape) {
    throw new Error(
      `external_bench_task (tool=${task.tool}) has no direct-launch shape ` +
        `(supported tools: ${Object.keys(BARE_DELEGATE_LAUNCH_SHAPES).join(", ")})`,
    );
  }
  const mountSource = `$FRAMEWORK_HOME/fixtures/portals/${task.portalDir}`;
  const credentialFlags = CREDENTIAL_STORES[shape.bin]
    ? ["--credential-bin", shape.bin, "--credential-staging-dir", `${CREDENTIAL_STAGING_ROOT}/${shape.bin}`]
    : [];
  const delegateInnerArgs = spliceRequestFixtureSentinel(shape.args);
  const delegateArgs = [
    ...RUN_JAILED_HEAD,
    "--mount-source",
    mountSource,
    "--mount-dest",
    EXTERNAL_BENCH_MOUNT_DEST,
    "--workdir",
    EXTERNAL_BENCH_MOUNT_DEST,
    ...credentialFlags,
    "--bin",
    shape.bin,
    "--",
    ...delegateInnerArgs,
  ];
  const verifyArgs = [
    ...RUN_JAILED_HEAD,
    "--mount-source",
    mountSource,
    "--mount-dest",
    EXTERNAL_BENCH_MOUNT_DEST,
    "--workdir",
    EXTERNAL_BENCH_MOUNT_DEST,
    "--extra-mount",
    `type=bind,src=$FRAMEWORK_HOME/fixtures/external/terminal_bench/${task.oracleTestsDir},dst=${ORACLE_TESTS_MOUNT_DEST},ro`,
    "--bin",
    "bash",
    "--",
    "-c",
    task.scopedTestCmd,
  ];

  const parts: string[] = [
    `schema_version: "1.0.0"`,
    `id: "${task.id}"`,
    `title: "${task.title}"`,
    `pack: "external_terminal_bench"`,
    `tags: ["bench:terminal-bench", "bench-version:${task.benchmarkVersion}", "docker", "provider-live"]`,
    `request_fixture: "${task.requestFixture}"`,
    `portals: []`,
    `mode_support: ["auto"]`,
    "",
    "steps:",
    `  - id: "${BARE_DELEGATE_STEP_ID}"`,
    `    type: "run-script"`,
    `    command: "deno"`,
    `    args: ${yamlArgsList(delegateArgs)}`,
    `    timeout_sec: ${DEFAULT_BARE_DELEGATE_TIMEOUT_SEC}`,
    `    output_criteria:`,
    `      - id: "delegate-ran"`,
    `        kind: "command-exit-code"`,
    `        equals: 0`,
    "",
    `  - id: "${VERIFY_TESTS_STEP_ID}"`,
    `    type: "run-script"`,
    `    command: "deno"`,
    `    args: ${yamlArgsList(verifyArgs)}`,
    `    timeout_sec: ${DEFAULT_EXTERNAL_BENCH_VERIFY_TIMEOUT_SEC}`,
    `    output_criteria:`,
    `      - id: "tests-pass"`,
    `        kind: "command-exit-code"`,
    `        equals: 0`,
    scoreWeights.tests_pass !== undefined
      ? `        score_weight: ${scoreWeights.tests_pass}`
      : `        score_weight: 0.3`,
    "",
  ];

  return parts.filter(Boolean).join("\n");
}
