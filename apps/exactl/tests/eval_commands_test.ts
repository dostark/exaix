/**
 * @module EvalCommandsTest
 * @path apps/exactl/tests/eval_commands_test.ts
 * @description Tests for `exactl eval` CLI commands.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/commands/eval_commands.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { buildRunArgs, EvalCommands } from "../src/commands/eval_commands.ts";
import { createCliTestContext } from "./helpers/test_setup.ts";

// history({}) resolves paths relative to Deno.cwd(), not tempDir, so tests chdir into
// tempDir for the duration of each history test. ORIGINAL_CWD is anchored to the repo root
// (not a module-load Deno.cwd()) because `deno test --parallel` shares cwd across workers.
const ORIGINAL_CWD = fromFileUrl(new URL("../../..", import.meta.url));

interface IConsoleArgs extends Array<string | number | boolean | object | undefined | null> {}

function withCapturedOutput<T>(fn: () => T | Promise<T>): Promise<{ output: string[]; result: T }> {
  const output: string[] = [];
  const originalLog = console.log;
  console.log = (...args: IConsoleArgs) => output.push(args.join(" "));

  const result = fn();
  const promise = result instanceof Promise ? result : Promise.resolve(result);

  return promise
    .then((resolved) => ({ output, result: resolved }))
    .finally(() => {
      console.log = originalLog;
    });
}

type TestHistoryEntry = {
  run_id: string;
  scenario_id: string;
  outcome: string;
  mode: string;
  suite_score?: number;
  passed: boolean;
  timestamp: string;
  component_versions?: { binary_version: string; schema_version: string };
};

function createTestHistoryFile(historyDir: string, entries: TestHistoryEntry[]): void {
  const lines = entries.map((e) => JSON.stringify(e));
  Deno.mkdirSync(historyDir, { recursive: true });
  Deno.writeTextFileSync(join(historyDir, "eval-history.jsonl"), lines.join("\n") + "\n");
}

Deno.test("[EvalCommands] history renders table with correct columns", async () => {
  const { context, tempDir, cleanup } = await createCliTestContext();
  Deno.chdir(tempDir);
  try {
    const cmds = new EvalCommands(context);

    const historyDir = join(Deno.cwd(), "tests", "scenario_framework", "output", "history");
    createTestHistoryFile(historyDir, [
      {
        run_id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
        scenario_id: "test-scenario",
        outcome: "success",
        mode: "auto",
        suite_score: 0.95,
        passed: true,
        timestamp: "2026-06-09T12:00:00.000Z",
        component_versions: { binary_version: "1.0.3", schema_version: "1.5.0" },
      },
      {
        run_id: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
        scenario_id: "failing-scenario",
        outcome: "scenario-failure",
        mode: "auto",
        passed: false,
        timestamp: "2026-06-09T13:00:00.000Z",
        component_versions: { binary_version: "1.0.3", schema_version: "1.5.0" },
      },
    ]);

    const { output } = await withCapturedOutput(() => cmds.history({ source: "jsonl" }));

    assertStringIncludes(output.join(" "), "RUN ID");
    assertStringIncludes(output.join(" "), "SCENARIO");
    assertStringIncludes(output.join(" "), "OUTCOME");
    assertStringIncludes(output.join(" "), "SCORE");
    assertStringIncludes(output.join(" "), "PASSED");
    assertStringIncludes(output.join(" "), "TIMESTAMP");
    assertStringIncludes(output.join(" "), "test-scenario");
    assertStringIncludes(output.join(" "), "failing-scenario");
  } finally {
    Deno.chdir(ORIGINAL_CWD);
    await cleanup();
  }
});

Deno.test("[EvalCommands] history --last 1 shows only the most recent entry", async () => {
  const { context, tempDir, cleanup } = await createCliTestContext();
  Deno.chdir(tempDir);
  try {
    const cmds = new EvalCommands(context);

    const historyDir = join(Deno.cwd(), "tests", "scenario_framework", "output", "history");
    createTestHistoryFile(historyDir, [
      {
        run_id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
        scenario_id: "first-scenario",
        outcome: "success",
        mode: "auto",
        suite_score: 1.0,
        passed: true,
        timestamp: "2026-06-09T12:00:00.000Z",
      },
      {
        run_id: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
        scenario_id: "second-scenario",
        outcome: "success",
        mode: "auto",
        suite_score: 0.8,
        passed: true,
        timestamp: "2026-06-09T13:00:00.000Z",
      },
    ]);

    const { output } = await withCapturedOutput(() => cmds.history({ last: 1, source: "jsonl" }));
    const outputText = output.join(" ");

    assertStringIncludes(outputText, "second-scenario");
    assertEquals(outputText.includes("first-scenario"), false);
  } finally {
    Deno.chdir(ORIGINAL_CWD);
    await cleanup();
  }
});

Deno.test("[EvalCommands] history --format json outputs valid JSON array", async () => {
  const { context, tempDir, cleanup } = await createCliTestContext();
  Deno.chdir(tempDir);
  try {
    const cmds = new EvalCommands(context);

    const historyDir = join(Deno.cwd(), "tests", "scenario_framework", "output", "history");
    createTestHistoryFile(historyDir, [
      {
        run_id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
        scenario_id: "test-scenario",
        outcome: "success",
        mode: "auto",
        passed: true,
        timestamp: "2026-06-09T12:00:00.000Z",
      },
    ]);

    const { output } = await withCapturedOutput(() => cmds.history({ format: "json", source: "jsonl" }));
    const parsed = JSON.parse(output.join(" "));
    assertEquals(Array.isArray(parsed), true);
    assertEquals(parsed[0].scenario_id, "test-scenario");
  } finally {
    Deno.chdir(ORIGINAL_CWD);
    await cleanup();
  }
});

Deno.test("[EvalCommands] buildRunArgs forwards score-threshold, trials, and history-format flags", () => {
  const args = buildRunArgs({
    scenario: ["test-scenario"],
    scoreThreshold: 0.8,
    trials: 5,
    historyFormat: "jsonl",
    verbose: true,
  });

  const argsStr = args.join(" ");
  assertEquals(argsStr.includes("--score-threshold"), true, "should include --score-threshold");
  assertEquals(argsStr.includes("0.8"), true, "should include threshold value 0.8");
  assertEquals(argsStr.includes("--trials"), true, "should include --trials");
  assertEquals(argsStr.includes("5"), true, "should include trials value 5");
  assertEquals(argsStr.includes("--history-format"), true, "should include --history-format");
  assertEquals(argsStr.includes("jsonl"), true, "should include history format jsonl");
  assertEquals(argsStr.includes("--verbose"), true, "should include --verbose");
  assertEquals(argsStr.includes("--eval-mode"), true, "should include --eval-mode");
  assertEquals(argsStr.includes("--scenario"), true, "should include --scenario");
  assertEquals(argsStr.includes("test-scenario"), true, "should include scenario id");
});

Deno.test("[EvalCommands] buildRunArgs omits flags not provided", () => {
  const args = buildRunArgs({});
  const argsStr = args.join(" ");
  assertEquals(argsStr.includes("--score-threshold"), false, "should NOT include --score-threshold");
  assertEquals(argsStr.includes("--trials"), false, "should NOT include --trials");
  assertEquals(argsStr.includes("--history-format"), false, "should NOT include --history-format");
  assertEquals(argsStr.includes("--cell"), false, "should NOT include --cell");
  assertEquals(argsStr.includes("--eval-mode"), true, "should always include --eval-mode");
});

Deno.test("[EvalCommands] buildRunArgs forwards --cell for explicit matrix-cell selection", () => {
  const args = buildRunArgs({
    scenario: ["fix-bug-null-guard-cli-all"],
    cell: "claude-code",
  });
  const argsStr = args.join(" ");
  assertEquals(argsStr.includes("--cell"), true, "should include --cell");
  assertEquals(argsStr.includes("claude-code"), true, "should include the selected cell's tool");
});

Deno.test("[EvalCommands] history with no history file shows empty message", async () => {
  const { context, tempDir, cleanup } = await createCliTestContext();
  Deno.chdir(tempDir);
  try {
    const cmds = new EvalCommands(context);

    const historyDir = join(Deno.cwd(), "tests", "scenario_framework", "output", "history");
    try {
      await Deno.remove(historyDir, { recursive: true });
    } catch {
      // Directory doesn't exist — fine
    }

    const { output } = await withCapturedOutput(() => cmds.history({ source: "jsonl" }));
    assertStringIncludes(output.join(" "), "No evaluation history found");
  } finally {
    Deno.chdir(ORIGINAL_CWD);
    await cleanup();
  }
});
