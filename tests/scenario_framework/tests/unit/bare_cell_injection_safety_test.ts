/**
 * @module BareCellInjectionSafetyTest
 * @path tests/scenario_framework/tests/unit/bare_cell_injection_safety_test.ts
 * @description Phase 143 Step 1 — RED-first security test (pre-gap GAP-4). A TASK.md whose
 * content contains shell metacharacters (backticks, `$(...)`, `;`, unbalanced quotes) must be
 * passed verbatim as a single discrete `args` array element: `buildCommandSpec` must hand
 * `executable` + `args` straight to `Deno.Command` (never `sh -c`), and the `$REQUEST_FIXTURE_CONTENT`
 * sentinel must expand to the fixture's exact bytes as one argument — so the launched process
 * receives the task text as one argument with no side effect and no shell interpretation.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/step_executor.ts, tests/scenario_framework/runner/synthetic_runner.ts, tests/scenario_framework/runner/matrix_expander.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { CriterionKind, type IScenarioStep, ScenarioStepType } from "../../schema/step_schema.ts";
import { executeScenarioStep } from "../../runner/step_executor.ts";
import { expandFileContentSentinels, expandVariablesInStep } from "../../runner/synthetic_runner.ts";
import { REQUEST_FIXTURE_CONTENT_SENTINEL } from "../../runner/matrix_expander.ts";

const METACHARACTER_TASK_CONTENT =
  "Fix the null guard; run $(rm -rf /tmp/exaix-probe) `id` \"unbalanced; 'semi'; # hash" +
  "\nsecond line with $HOME and ${PATH} and ; && ||";

const BASE_ENV: Record<string, string> = {
  REQUEST_FIXTURE: "/tmp/opencode/does-not-matter.md",
  WORKSPACE_ROOT: "/tmp/opencode/workspace",
  FRAMEWORK_HOME: "/tmp/opencode/framework",
  CELL_PROVIDER: "ollama",
};

function delegateStep(): IScenarioStep {
  return {
    id: "bare-delegate",
    type: ScenarioStepType.SHELL,
    command: "opencode",
    args: ["run", "--format", "json", "--dir", "$WORKSPACE_ROOT/todo-app", REQUEST_FIXTURE_CONTENT_SENTINEL],
    timeout_sec: 60,
    continue_on_failure: false,
    input_criteria: [],
    output_criteria: [
      { id: "delegate-ran", kind: CriterionKind.COMMAND_EXIT_CODE, equals: 0 },
    ],
  };
}

Deno.test("[BareCellInjection] env expansion leaves the content sentinel verbatim", () => {
  const expanded = expandVariablesInStep(delegateStep(), BASE_ENV);
  const sentinelIndex = expanded.args?.indexOf(REQUEST_FIXTURE_CONTENT_SENTINEL);
  assert(sentinelIndex !== undefined && sentinelIndex !== -1, "sentinel must survive env expansion untouched");
});

Deno.test("[BareCellInjection] file-content expansion replaces the sentinel with the fixture bytes as one element", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const fixturePath = join(tempDir, "task.md");
    await Deno.writeTextFile(fixturePath, METACHARACTER_TASK_CONTENT);

    const expanded = await expandFileContentSentinels(delegateStep(), fixturePath);
    const contentArgs = expanded.args ?? [];
    const content = contentArgs[contentArgs.length - 1];

    assertEquals(content, METACHARACTER_TASK_CONTENT, "task content must arrive byte-identical as one element");
    assertEquals(
      contentArgs.filter((a) => a === METACHARACTER_TASK_CONTENT).length,
      1,
      "content must occupy exactly one args element",
    );
    assert(
      !contentArgs.includes(REQUEST_FIXTURE_CONTENT_SENTINEL),
      "sentinel must not remain in the final args",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[BareCellInjection] a spawned process receives the metacharacter content as a single verbatim argument", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const fixturePath = join(tempDir, "task.md");
    await Deno.writeTextFile(fixturePath, METACHARACTER_TASK_CONTENT);

    const envExpanded = expandVariablesInStep(delegateStep(), { ...BASE_ENV, WORKSPACE_ROOT: tempDir });
    const expanded = await expandFileContentSentinels(envExpanded, fixturePath);
    // Swap the executable for a probe that prints its argv as JSON — the same
    // executable+args path buildCommandSpec feeds Deno.Command.
    const probePath = join(tempDir, "argv_probe.ts");
    await Deno.writeTextFile(probePath, "console.log(JSON.stringify(Deno.args));");
    const probe: IScenarioStep = {
      ...expanded,
      command: "deno",
      args: ["run", probePath, ...(expanded.args ?? [])],
    };

    const result = await executeScenarioStep({ step: probe, cwd: tempDir });
    assertEquals(result.exitCode, 0, `probe must exit 0: ${result.combinedOutput}`);

    const received = JSON.parse(result.stdout.trim()) as string[];
    assertEquals(
      received,
      ["run", "--format", "json", "--dir", `${tempDir}/todo-app`, METACHARACTER_TASK_CONTENT],
      "no shell must interpret the content: the process sees exactly one verbatim argument",
    );
    assert(
      !(result.stderr.includes("sh:") || result.stderr.includes("not found")),
      "no shell must be involved in the launch",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
