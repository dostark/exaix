/**
 * @module ScenarioFrameworkFileContainsTest
 * @path tests/scenario_framework/tests/unit/file_contains_test.ts
 * @description Tests for the `file-contains` step type — a declarative wait+assert over a file
 *   glob: the step polls until at least `min_matches` files match the glob(s) and the resolved
 *   target's content satisfies the step's text criteria, then evaluateStepOutcome asserts the
 *   file/text criteria. Covers content-polling, min_matches counting, negative (file-not-exists)
 *   assertions, and timeout failure.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/step_executor.ts, tests/scenario_framework/schema/step_schema.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { executeScenarioStep } from "../../runner/step_executor.ts";
import { CriterionKind, type IScenarioStep, ScenarioStepType } from "../../schema/step_schema.ts";

async function withTempWorkspace(fn: (ws: string) => Promise<void>): Promise<void> {
  const ws = await Deno.makeTempDir({ prefix: "file-contains-" });
  try {
    await fn(ws);
  } finally {
    await Deno.remove(ws, { recursive: true });
  }
}

function step(overrides: Partial<IScenarioStep> = {}) {
  return {
    id: "file-check",
    type: ScenarioStepType.FILE_CONTAINS,
    file_pattern: "**/src/main.ts",
    timeout_sec: 3,
    input_criteria: [],
    output_criteria: [
      {
        id: "content-present",
        kind: CriterionKind.TEXT_CONTAINS,
        contains: "GREETING",
      },
    ],
    continue_on_failure: false,
    ...overrides,
  } as never;
}

Deno.test("[file_contains] succeeds when the file exists with the required content", async () => {
  await withTempWorkspace(async (ws) => {
    await Deno.mkdir(join(ws, "src"), { recursive: true });
    await Deno.writeTextFile(join(ws, "src", "main.ts"), "export const GREETING = true;\n");
    const result = await executeScenarioStep({ step: step(), cwd: ws });
    assertEquals(result.exitCode, 0);
    assert(result.stdout.includes("main.ts"), `expected file named in stdout: ${result.stdout}`);
  });
});

Deno.test("[file_contains] waits (polls) until the content appears", async () => {
  await withTempWorkspace(async (ws) => {
    await Deno.mkdir(join(ws, "src"), { recursive: true });
    await Deno.writeTextFile(join(ws, "src", "main.ts"), "// no greeting yet");
    setTimeout(() => {
      Deno.writeTextFileSync(join(ws, "src", "main.ts"), "const GREETING = 'hi';\n");
    }, 200);
    const startedAt = Date.now();
    const result = await executeScenarioStep({ step: step({ timeout_sec: 5 }), cwd: ws });
    const elapsedMs = Date.now() - startedAt;
    assertEquals(result.exitCode, 0, `expected success, got ${result.stderr}`);
    assert(elapsedMs >= 150, `expected the step to wait for content, finished in ${elapsedMs}ms`);
  });
});

Deno.test("[file_contains] times out when the required content never appears", async () => {
  await withTempWorkspace(async (ws) => {
    await Deno.mkdir(join(ws, "src"), { recursive: true });
    await Deno.writeTextFile(join(ws, "src", "main.ts"), "// never has the greeting");
    const result = await executeScenarioStep({ step: step({ timeout_sec: 1 }), cwd: ws });
    assertEquals(result.exitCode, 1);
    assert(result.stderr.includes("Timeout"), `expected timeout message, got ${result.stderr}`);
  });
});

Deno.test("[file_contains] min_matches waits until enough files exist (no content criteria)", async () => {
  await withTempWorkspace(async (ws) => {
    await Deno.mkdir(join(ws, "out"), { recursive: true });
    await Deno.writeTextFile(join(ws, "out", "a.json"), "{}");
    setTimeout(() => {
      Deno.writeTextFileSync(join(ws, "out", "b.json"), "{}");
    }, 200);
    const result = await executeScenarioStep({
      step: step({
        file_pattern: "**/out/*.json",
        min_matches: 2,
        output_criteria: [{ id: "count", kind: CriterionKind.FILE_FOUND, path_pattern: "**/out/*.json" }],
      }),
      cwd: ws,
    });
    assertEquals(result.exitCode, 0, `expected success once 2 files exist, got ${result.stderr}`);
  });
});

Deno.test("[file_contains] a negative file-not-exists assertion does not wait", async () => {
  await withTempWorkspace(async (ws) => {
    const startedAt = Date.now();
    const result = await executeScenarioStep({
      step: step({
        file_pattern: "**/never-created.txt",
        output_criteria: [
          { id: "absent", kind: CriterionKind.FILE_NOT_EXISTS, path: "/tmp/not-created-anywhere.txt" },
        ],
      }),
      cwd: ws,
    });
    const elapsedMs = Date.now() - startedAt;
    assertEquals(result.exitCode, 0, `negative assertion should not wait, got ${result.stderr}`);
    assert(elapsedMs < 1500, `expected immediate return, took ${elapsedMs}ms`);
  });
});

Deno.test("[file_contains] cwd $WORKTREE resolves a relative glob against the newest worktree", async () => {
  await withTempWorkspace(async (ws) => {
    const wt = join(ws, ".exa", "worktrees", "todo-app", "trace-1");
    await Deno.mkdir(join(wt, "src"), { recursive: true });
    await Deno.writeTextFile(join(wt, "src", "main.ts"), "const GREETING = 'hi';\n");
    const result = await executeScenarioStep({
      step: step({ cwd: "$WORKTREE", file_pattern: "src/main.ts" }),
      cwd: ws,
    });
    assertEquals(result.exitCode, 0, `expected worktree-relative match, got ${result.stderr}`);
    assert(result.stdout.includes("main.ts"), `expected file named in stdout: ${result.stdout}`);
  });
});

Deno.test("[file_contains] cwd $WORKTREE waits when the worktree is created after the step starts", async () => {
  await withTempWorkspace(async (ws) => {
    setTimeout(async () => {
      const wt = join(ws, ".exa", "worktrees", "todo-app", "trace-1");
      await Deno.mkdir(join(wt, "src"), { recursive: true });
      await Deno.writeTextFile(join(wt, "src", "main.ts"), "const GREETING = 'hi';\n");
    }, 200);
    const result = await executeScenarioStep({
      step: step({ cwd: "$WORKTREE", file_pattern: "src/main.ts", timeout_sec: 5 }),
      cwd: ws,
    });
    assertEquals(result.exitCode, 0, `expected worktree-relative match once it appears, got ${result.stderr}`);
  });
});

Deno.test("[file_contains] cwd relative path resolves against the workspace root", async () => {
  await withTempWorkspace(async (ws) => {
    await Deno.mkdir(join(ws, "todo-app", "src"), { recursive: true });
    await Deno.writeTextFile(join(ws, "todo-app", "src", "main.ts"), "const GREETING = 'hi';\n");
    const result = await executeScenarioStep({
      step: step({ cwd: "todo-app", file_pattern: "src/main.ts" }),
      cwd: ws,
    });
    assertEquals(result.exitCode, 0, `expected cwd-relative match, got ${result.stderr}`);
  });
});
