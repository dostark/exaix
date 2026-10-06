/**
 * @module DenoTaskRunnerTest
 * @path packages/tool-runtime/tests/deno_task_runner_test.ts
 * @related-files ["packages/tool-runtime/src/deno_task_runner.ts"]
 * @architectural-layer Tests
 * @description Tests the middleware-free runDenoTask wrapper: a real spawn in the given
 *   cwd, arg ordering, and the timeout and SubprocessError outcome mapping.
 */

import { assert, assertEquals } from "@std/assert";
import { stub } from "@std/testing/mock";
import {
  type ISubprocessOptions,
  SafeSubprocess,
  SubprocessError,
  SubprocessTimeoutError,
  SystemCommand,
} from "@exaix/core";
import { runDenoTask } from "@exaix/tool-runtime";

type StubRun = (
  command: string,
  args: string[],
  options?: ISubprocessOptions,
) => Promise<{ code: number; stdout: string; stderr: string }>;

function stubRun(fn: StubRun) {
  return stub(SafeSubprocess, "run", fn);
}

Deno.test("[deno-task-runner] the task runs with the given cwd", async () => {
  const tempDir = await Deno.realPath(await Deno.makeTempDir({ prefix: "deno-task-cwd-" }));
  try {
    const outcome = await runDenoTask({
      task: "eval",
      args: ["console.log('CWD='+Deno.cwd())"],
      absPath: ".",
      cwd: tempDir,
      timeoutMs: 30_000,
    });

    assertEquals(outcome.kind, "exited");
    const output = outcome.kind === "exited" ? outcome.output : outcome.kind;
    assert(outcome.kind === "exited" && outcome.code === 0, output);
    assert(output.includes(`CWD=${tempDir}`), output);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[deno-task-runner] an exited task returns its code, arg order and combined output", async () => {
  let captured: { args: string[]; options?: ISubprocessOptions } | undefined;
  const s = stubRun((command, args, options) => {
    assertEquals(command, SystemCommand.DENO);
    captured = { args, options };
    return Promise.resolve({ code: 2, stdout: "out", stderr: "err" });
  });
  try {
    const outcome = await runDenoTask({
      task: "test",
      args: ["--quiet"],
      absPath: "src",
      cwd: "/work",
      timeoutMs: 1234,
    });

    assertEquals(outcome, { kind: "exited", code: 2, output: "outerr" });
    assertEquals(captured?.args, ["test", "--quiet", "src"]);
    assertEquals(captured?.options?.cwd, "/work");
    assertEquals(captured?.options?.timeoutMs, 1234);
  } finally {
    s.restore();
  }
});

Deno.test("[deno-task-runner] a timed-out task returns kind timed_out and does not hang", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "deno-task-timeout-" });
  try {
    const started = Date.now();
    const outcome = await runDenoTask({
      task: "eval",
      args: ["await new Promise((r) => setTimeout(r, 10_000))"],
      absPath: ".",
      cwd: tempDir,
      timeoutMs: 500,
    });
    const elapsed = Date.now() - started;

    assertEquals(outcome.kind, "timed_out");
    assert(elapsed < 5_000, `expected the timeout to fire fast, took ${elapsed}ms`);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[deno-task-runner] a SubprocessTimeoutError maps to timed_out", async () => {
  const s = stubRun(() => Promise.reject(new SubprocessTimeoutError("timeout")));
  try {
    const outcome = await runDenoTask({ task: "test", args: [], absPath: ".", cwd: "/work", timeoutMs: 1000 });
    assertEquals(outcome, { kind: "timed_out" });
  } finally {
    s.restore();
  }
});

Deno.test("[deno-task-runner] a SubprocessError maps to spawn_failed with the error class and no message", async () => {
  const secretMessage = "SECRET-MESSAGE-DO-NOT-LEAK";
  const s = stubRun(() => Promise.reject(new SubprocessError(secretMessage, new Error("cause"))));
  try {
    const outcome = await runDenoTask({ task: "test", args: [], absPath: ".", cwd: "/work", timeoutMs: 1000 });
    assertEquals(outcome, { kind: "spawn_failed", error_class: "SubprocessError" });
    assert(!JSON.stringify(outcome).includes(secretMessage), "the error message must not be carried");
  } finally {
    s.restore();
  }
});
