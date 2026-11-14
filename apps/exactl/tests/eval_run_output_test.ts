/**
 * @module EvalRunOutputTest
 * @path apps/exactl/tests/eval_run_output_test.ts
 * @description Verifies that eval run prints one JSON event per line with -o jsonl and sends the child output to stderr.
 * @architectural-layer Test
 * @dependencies [@std/assert, apps/exactl/tests/helpers/captured_output.ts]
 * @related-files [apps/exactl/src/command_builders/eval_command.ts]
 */

import "./helpers/set_test_mode.ts";
import { assertEquals } from "@std/assert";
import { withCapturedSink } from "./helpers/captured_output.ts";
import { withTestMod } from "./helpers/test_utils.ts";

Deno.test("eval run -o jsonl emits one progress event per line", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.evalCommands.run = () => Promise.resolve();
    const { out } = await withCapturedSink(ctx.outputSink, async () => {
      await mod.__test_command.parse(["eval", "run", "--pack", "eval-smoke", "-o", "jsonl"]);
    });
    assertEquals(out.trimEnd().split("\n").map((line) => JSON.parse(line)), [
      { type: "eval.run.started" },
      { type: "eval.run.finished", exit_code: 0 },
    ]);
  });
});

Deno.test("eval run -o jsonl sends the scenario output to stderr", async () => {
  await withTestMod(async (mod, ctx) => {
    let childOutputToStderr: boolean | undefined;
    ctx.evalCommands.run = (options: { childOutputToStderr?: boolean }) => {
      childOutputToStderr = options.childOutputToStderr;
      return Promise.resolve();
    };
    await withCapturedSink(ctx.outputSink, async () => {
      await mod.__test_command.parse(["eval", "run", "-o", "jsonl"]);
    });
    assertEquals(childOutputToStderr, true);
  });
});

Deno.test("eval run without a machine format keeps the scenario output on stdout", async () => {
  await withTestMod(async (mod, ctx) => {
    let childOutputToStderr: boolean | undefined;
    ctx.evalCommands.run = (options: { childOutputToStderr?: boolean }) => {
      childOutputToStderr = options.childOutputToStderr;
      return Promise.resolve();
    };
    const { out } = await withCapturedSink(ctx.outputSink, async () => {
      await mod.__test_command.parse(["eval", "run"]);
    });
    assertEquals([childOutputToStderr, out], [false, ""]);
  });
});
