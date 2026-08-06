/**
 * @module ScenarioFrameworkTestRunTest
 * @path tests/scenario_framework/tests/unit/test_run_test.ts
 * @description Tests for the `test-run` step type — a framework-owned test-runner that executes
 *   the repo's test command in the step's resolved `cwd` (workspace, portal dir, or `$WORKTREE`),
 *   replacing `cd ... && deno test src/` shell steps. Verifies success/failure exit codes, the
 *   relative-cwd and $WORKTREE-cwd execution, and the default `deno test` command.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/step_executor.ts, tests/scenario_framework/schema/step_schema.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { executeScenarioStep } from "../../runner/step_executor.ts";
import { ScenarioStepType } from "../../schema/step_schema.ts";

const PASSING_TEST = "Deno.test('passes', () => { if (1 !== 1) throw new Error('no'); });\n";
const FAILING_TEST = "Deno.test('fails', () => { throw new Error('boom'); });\n";

function testRunStep(overrides: Record<string, string | number | undefined> = {}) {
  return {
    id: "run-tests",
    type: ScenarioStepType.TEST_RUN,
    command: "deno",
    args: ["test", "src/"],
    cwd: "todo-app",
    timeout_sec: 60,
    input_criteria: [],
    output_criteria: [],
    continue_on_failure: false,
    ...overrides,
  } as never;
}

async function withWorkspace(fn: (ws: string) => Promise<void>): Promise<void> {
  const ws = await Deno.makeTempDir({ prefix: "test-run-" });
  try {
    await fn(ws);
  } finally {
    await Deno.remove(ws, { recursive: true });
  }
}

Deno.test("[test_run] a passing repo test suite exits 0", async () => {
  await withWorkspace(async (ws) => {
    await Deno.mkdir(join(ws, "todo-app", "src"), { recursive: true });
    await Deno.writeTextFile(join(ws, "todo-app", "src", "a_test.ts"), PASSING_TEST);
    const result = await executeScenarioStep({ step: testRunStep(), cwd: ws });
    assertEquals(result.exitCode, 0, `expected pass, got stderr: ${result.stderr}`);
  });
});

Deno.test("[test_run] a failing repo test suite exits non-zero", async () => {
  await withWorkspace(async (ws) => {
    await Deno.mkdir(join(ws, "todo-app", "src"), { recursive: true });
    await Deno.writeTextFile(join(ws, "todo-app", "src", "a_test.ts"), FAILING_TEST);
    const result = await executeScenarioStep({ step: testRunStep(), cwd: ws });
    assertEquals(result.exitCode, 1, "expected the failing test to fail the step");
  });
});

Deno.test("[test_run] cwd $WORKTREE runs in the newest execution worktree", async () => {
  await withWorkspace(async (ws) => {
    const wt = join(ws, ".exa", "worktrees", "todo-app", "trace-9");
    await Deno.mkdir(join(wt, "src"), { recursive: true });
    await Deno.writeTextFile(join(wt, "src", "a_test.ts"), PASSING_TEST);
    const result = await executeScenarioStep({
      step: testRunStep({ cwd: "$WORKTREE" }),
      cwd: ws,
    });
    assertEquals(result.exitCode, 0, `expected pass in worktree, got stderr: ${result.stderr}`);
  });
});
