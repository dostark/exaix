/**
 * @module EvalCommandsTest
 * @path apps/exactl/tests/eval_commands_test.ts
 * @description Tests for `exactl eval` CLI commands.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/commands/eval_commands.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { EvalCommands } from "../src/commands/eval_commands.ts";
import { createCliTestContext } from "./helpers/test_setup.ts";

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
  const { context, cleanup } = await createCliTestContext();
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

    const { output } = await withCapturedOutput(() => cmds.history({}));

    assertStringIncludes(output.join(" "), "RUN ID");
    assertStringIncludes(output.join(" "), "SCENARIO");
    assertStringIncludes(output.join(" "), "OUTCOME");
    assertStringIncludes(output.join(" "), "SCORE");
    assertStringIncludes(output.join(" "), "PASSED");
    assertStringIncludes(output.join(" "), "TIMESTAMP");
    assertStringIncludes(output.join(" "), "test-scenario");
    assertStringIncludes(output.join(" "), "failing-scenario");
  } finally {
    await cleanup();
  }
});

Deno.test("[EvalCommands] history --last 1 shows only the most recent entry", async () => {
  const { context, cleanup } = await createCliTestContext();
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

    const { output } = await withCapturedOutput(() => cmds.history({ last: 1 }));
    const outputText = output.join(" ");

    assertStringIncludes(outputText, "second-scenario");
    assertEquals(outputText.includes("first-scenario"), false);
  } finally {
    await cleanup();
  }
});

Deno.test("[EvalCommands] history --format json outputs valid JSON array", async () => {
  const { context, cleanup } = await createCliTestContext();
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

    const { output } = await withCapturedOutput(() => cmds.history({ format: "json" }));
    const parsed = JSON.parse(output.join(" "));
    assertEquals(Array.isArray(parsed), true);
    assertEquals(parsed[0].scenario_id, "test-scenario");
  } finally {
    await cleanup();
  }
});

Deno.test("[EvalCommands] history with no history file shows empty message", async () => {
  const { context, cleanup } = await createCliTestContext();
  try {
    const cmds = new EvalCommands(context);

    const historyDir = join(Deno.cwd(), "tests", "scenario_framework", "output", "history");
    try {
      await Deno.remove(historyDir, { recursive: true });
    } catch {
      // Directory doesn't exist — fine
    }

    const { output } = await withCapturedOutput(() => cmds.history({}));
    assertStringIncludes(output.join(" "), "No evaluation history found");
  } finally {
    await cleanup();
  }
});
