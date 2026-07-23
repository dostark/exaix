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

export interface IScenarioTemplateOptions {
  id: string;
  title: string;
  pack: string;
  tags: string[];
  requestFixture: string;
}

export interface ICellDef {
  tool: string;
  provider: string;
  config: string;
  requiresBin?: string;
  requiresKey?: string;
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

// ────────────────────────────────────────────────────────────────────────────
// Phase 141 — swe_tasks dogfood-loop template
// ────────────────────────────────────────────────────────────────────────────

const INDENT = "  ";

function renderCells(cells: ICellDef[]): string {
  const lines: string[] = ["matrix:", "  cells:"];
  for (const c of cells) {
    lines.push(`    - tool: "${c.tool}"`);
    lines.push(`      provider: "${c.provider}"`);
    lines.push(`      config: "${c.config}"`);
    if (c.requiresBin) lines.push(`      requires_bin: "${c.requiresBin}"`);
    if (c.requiresKey) lines.push(`      requires_key: "${c.requiresKey}"`);
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
    `    type: "wait-for-journal-event"`,
    `    event_type: "${eventType}"`,
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

/**
 * Render a complete swe_tasks benchmark scenario YAML against the
 * todo_app fixture portal. The template emits both CLI-delegate-specific
 * and direct-API-specific steps; irrelevant steps are skipped at
 * expansion time via matrix cell guards.
 */
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
    // ── setup ──
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
    // CLI-delegate only: patch senior-coder capabilities
    ...(hasCliDelegate
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
    // ── daemon lifecycle ──
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
    `    type: "wait-for-journal-event"`,
    `    event_type: "daemon.ready"`,
    `    timeout_sec: 30`,
    `    input_criteria: []`,
    `    output_criteria: []`,
    "",
    // ── request → plan → execution ──
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
    // ── review → test ──
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
    `  - id: "verify-tests"`,
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
    // ── trajectory ──
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
    // ── LLM judge ──
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
    // ── cleanup ──
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
