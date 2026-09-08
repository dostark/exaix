/**
 * @module EvalCalibrationCliDispatchTest
 * @path apps/exactl/tests/eval_calibration_cli_dispatch_test.ts
 * @description Phase 146 Step 1 — RED-first test. `exactl eval calibration generate`
 *   and `exactl eval calibration score` must be reachable through the actual command
 *   tree (mod.__test_command.parse), not only correctly implemented as isolated
 *   EvalCommands methods — proving both are registered and wired, not production-dead.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/exactl.ts, apps/exactl/src/commands/eval_commands.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { withTestMod } from "./helpers/test_utils.ts";

Deno.test("eval calibration generate dispatches through the real command tree with the capture flag", async () => {
  await withTestMod(async (mod, ctx) => {
    let called = false;
    let receivedOptions: { pack?: string[]; cell?: string; captureCalibrationEvidence?: string } | undefined;
    ctx.evalCommands.calibrationGenerate = (
      options: { pack?: string[]; cell?: string; captureCalibrationEvidence?: string },
    ) => {
      called = true;
      receivedOptions = options;
      return Promise.resolve();
    };

    await mod.__test_command.parse([
      "eval",
      "calibration",
      "generate",
      "--pack",
      "swe_tasks",
      "--cell",
      "claude-code",
      "--capture-calibration-evidence",
      "/tmp/calib-capture",
    ]);

    assert(called, "evalCommands.calibrationGenerate should have been called via CLI dispatch");
    assertEquals(receivedOptions?.pack, ["swe_tasks"]);
    assertEquals(receivedOptions?.cell, "claude-code");
    assertEquals(receivedOptions?.captureCalibrationEvidence, "/tmp/calib-capture");
  });
});

Deno.test("eval calibration score dispatches through the real command tree with target/reference/seed", async () => {
  await withTestMod(async (mod, ctx) => {
    let called = false;
    let receivedOptions:
      | { captureDir?: string; target?: string; reference?: string; seed?: string; isolated?: boolean }
      | undefined;
    ctx.evalCommands.calibrationScore = (
      options: { captureDir?: string; target?: string; reference?: string; seed?: string; isolated?: boolean },
    ) => {
      called = true;
      receivedOptions = options;
      return Promise.resolve();
    };

    await mod.__test_command.parse([
      "eval",
      "calibration",
      "score",
      "--capture-dir",
      "/tmp/calib-capture",
      "--target",
      "claude-cli:claude-sonnet-5",
      "--reference",
      "codex-cli:gpt-5.6-sol",
      "--seed",
      "founding",
      "--isolated",
    ]);

    assert(called, "evalCommands.calibrationScore should have been called via CLI dispatch");
    assertEquals(receivedOptions?.captureDir, "/tmp/calib-capture");
    assertEquals(receivedOptions?.target, "claude-cli:claude-sonnet-5");
    assertEquals(receivedOptions?.reference, "codex-cli:gpt-5.6-sol");
    assertEquals(receivedOptions?.seed, "founding");
    assertEquals(receivedOptions?.isolated, true);
  });
});

Deno.test("eval calibration score omitting --isolated reaches evalCommands.calibrationScore as falsy", async () => {
  await withTestMod(async (mod, ctx) => {
    let receivedOptions: { isolated?: boolean } | undefined;
    ctx.evalCommands.calibrationScore = (options: { isolated?: boolean }) => {
      receivedOptions = options;
      return Promise.resolve();
    };

    await mod.__test_command.parse([
      "eval",
      "calibration",
      "score",
      "--capture-dir",
      "/tmp/calib-capture",
      "--target",
      "claude-cli:claude-sonnet-5",
      "--reference",
      "codex-cli:gpt-5.6-sol",
      "--seed",
      "founding",
    ]);

    assert(!receivedOptions?.isolated, "isolated should be falsy when --isolated is omitted");
  });
});
