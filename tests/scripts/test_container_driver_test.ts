/**
 * @module TestContainerDriverTest
 * @path tests/scripts/test_container_driver_test.ts
 * @description Verifies the in-container driver: one fresh subprocess per file, per-file
 *   process-group kill plus daemon reap, the per-file timeout, and dot-reporter parsing.
 */

import { assertEquals } from "@std/assert";
import {
  type IContainerDriverDeps,
  type IContainerRunResult,
  type IDriverChild,
  runDriverLoop,
  TEST_CONTAINER_DONE_SENTINEL,
  TEST_CONTAINER_TIMEOUT_EXIT_CODE,
} from "../../scripts/test_container_driver.ts";

const ENCODER = new TextEncoder();

function fakeChild(code: number, output: string, pid = 1000): IDriverChild {
  return {
    pid,
    output: () => Promise.resolve({ code, stdout: ENCODER.encode(output), stderr: new Uint8Array() }),
  };
}

interface IRecorder {
  spawned: string[];
  killed: number[];
  reaped: number;
  results: IContainerRunResult[];
  logs: string[];
}

function makeDeps(recorder: IRecorder, spawn: (file: string) => IDriverChild): IContainerDriverDeps {
  return {
    repoRoot: "/workspaces/exaix",
    spawn: (file) => {
      recorder.spawned.push(file);
      return spawn(file);
    },
    killGroup: (pid) => recorder.killed.push(pid),
    reap: () => {
      recorder.reaped++;
      return Promise.resolve();
    },
    timeoutMs: 10_000,
    now: () => 0,
    writeLog: (text) => recorder.logs.push(text),
    writeResult: (result) => recorder.results.push(result),
  };
}

function emptyRecorder(): IRecorder {
  return { spawned: [], killed: [], reaped: 0, results: [], logs: [] };
}

async function* lines(...items: string[]): AsyncIterable<string> {
  for (const item of items) yield item;
}

Deno.test("the driver runs each file in its own fresh deno test subprocess and never combines files", async () => {
  const recorder = emptyRecorder();
  const deps = makeDeps(recorder, (file) => fakeChild(0, "ok | 1 passed | 0 failed (1ms)\n", file.length));
  await runDriverLoop(lines("a_test.ts", "b_test.ts"), deps);
  assertEquals(recorder.spawned, ["a_test.ts", "b_test.ts"]);
  assertEquals(recorder.results.length, 2);
});

Deno.test("the driver kills the per-file process group and reaps daemons after every file", async () => {
  const recorder = emptyRecorder();
  const deps = makeDeps(recorder, (file) => fakeChild(0, "ok | 1 passed | 0 failed (1ms)\n", file.length));
  await runDriverLoop(lines("a_test.ts", "b_test.ts"), deps);
  assertEquals(recorder.killed.length, 2);
  assertEquals(recorder.reaped, 2);
});

Deno.test("the driver enforces the per-file timeout and emits TIMEOUT_EXIT_CODE without exiting", async () => {
  const recorder = emptyRecorder();
  let resolveHanging: ((value: { code: number; stdout: Uint8Array; stderr: Uint8Array }) => void) | undefined;
  const deps = makeDeps(recorder, (file) => {
    if (file === "slow_test.ts") {
      return {
        pid: 4242,
        output: () =>
          new Promise((resolve) => {
            resolveHanging = resolve;
          }),
      };
    }
    return fakeChild(0, "ok | 1 passed | 0 failed (1ms)\n", 7);
  });
  deps.timeoutMs = 5;
  deps.killGroup = (pid) => {
    recorder.killed.push(pid);
    resolveHanging?.({ code: 137, stdout: new Uint8Array(), stderr: new Uint8Array() });
  };
  await runDriverLoop(lines("slow_test.ts", "next_test.ts"), deps);
  assertEquals(recorder.results[0].exitCode, TEST_CONTAINER_TIMEOUT_EXIT_CODE);
  assertEquals(recorder.results[0].failureDetail, "timeout");
  // The worker survives: the next file still runs and passes.
  assertEquals(recorder.results[1].exitCode, 0);
  assertEquals(recorder.results[1].passed, 1);
});

Deno.test("the driver parses dot-reporter counts including ignored and emits one result line per file", async () => {
  const recorder = emptyRecorder();
  const dotOutput = "..,.\nok | 3 passed | 1 failed | 2 ignored (2s)\n";
  const deps = makeDeps(recorder, () => fakeChild(1, dotOutput, 11));
  await runDriverLoop(lines("dot_test.ts"), deps);
  assertEquals(recorder.results.length, 1);
  const result = recorder.results[0];
  assertEquals(result.passed, 3);
  assertEquals(result.failed, 1);
  assertEquals(result.ignored, 2);
  assertEquals(result.testFile, "dot_test.ts");
});

Deno.test("processFile rejects a path outside the repo root", async () => {
  const recorder = emptyRecorder();
  const deps = makeDeps(recorder, () => fakeChild(0, "", 1));
  await runDriverLoop(lines("/etc/passwd"), deps);
  assertEquals(recorder.results[0].exitCode, 1);
  assertEquals(recorder.results[0].failureDetail, "invalid test file path");
  assertEquals(recorder.spawned, []);
});

Deno.test("the driver stops at the DONE sentinel", async () => {
  const recorder = emptyRecorder();
  const deps = makeDeps(recorder, () => fakeChild(0, "ok | 1 passed | 0 failed (1ms)\n", 1));
  await runDriverLoop(lines(TEST_CONTAINER_DONE_SENTINEL, "ignored_test.ts"), deps);
  assertEquals(recorder.spawned, []);
});
