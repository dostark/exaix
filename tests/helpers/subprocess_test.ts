/**
 * @module SubprocessTest
 * @path tests/helpers/subprocess_test.ts
 * @description Verifies the 'SafeSubprocess' wrapper, ensuring robust command
 * execution, timeout enforcement, and correct stream capturing.
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  TEST_SUBPROCESS_ABORT_DELAY_MS,
  TEST_SUBPROCESS_LONG_RUNNING_MS,
  TEST_SUBPROCESS_TIMEOUT_MS_SHORT,
} from "@exaix/testing";
import { SafeSubprocess, SubprocessError, SubprocessTimeoutError } from "@exaix/core";

function getDenoCmd(): string {
  return Deno.execPath();
}

function getLongRunningEvalArgs(): string[] {
  return [
    "eval",
    `await new Promise((resolve) => setTimeout(resolve, ${TEST_SUBPROCESS_LONG_RUNNING_MS}));`,
  ];
}

Deno.test("SafeSubprocess: runs command successfully", async () => {
  const result = await SafeSubprocess.run(getDenoCmd(), ["eval", "console.log('hello')"]);
  assertEquals(result.code, 0);
  assert(result.stdout.includes("hello"));
});

Deno.test("SafeSubprocess: respects timeout", async () => {
  // Use `deno eval` as a portable long-running command.
  await assertRejects(
    async () => {
      await SafeSubprocess.run(getDenoCmd(), getLongRunningEvalArgs(), { timeoutMs: TEST_SUBPROCESS_TIMEOUT_MS_SHORT });
    },
    SubprocessTimeoutError,
    "timed out",
  );
});

Deno.test("SafeSubprocess: handles command not found", async () => {
  await assertRejects(
    async () => {
      await SafeSubprocess.run("nonexistent-command-xyz", []);
    },
    SubprocessError,
    "Command not found",
  );
});

Deno.test("SafeSubprocess: a nonexistent cwd surfaces the bad path, not a generic binary-not-found message", async () => {
  // Deno.Command throws Deno.errors.NotFound for BOTH "binary not on PATH" and "cwd
  // does not exist" — a caller debugging a wrong-working-directory bug needs the cwd
  // in the message to tell the two apart, not a message that only names the binary.
  await assertRejects(
    async () => {
      await SafeSubprocess.run(getDenoCmd(), ["eval", "1"], { cwd: "/nonexistent-cwd-xyz-abc" });
    },
    SubprocessError,
    "nonexistent-cwd-xyz-abc",
  );
});

Deno.test("SafeSubprocess: respects cwd option", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const result = await SafeSubprocess.run(getDenoCmd(), ["eval", "console.log(Deno.cwd())"], { cwd: tempDir });
    assertEquals(result.code, 0);
    // On linux /tmp/... is often realpath'd
    const realTemp = await Deno.realPath(tempDir);
    assert(result.stdout.trim().includes(realTemp.trim()));
  } finally {
    await Deno.remove(tempDir);
  }
});

Deno.test("SafeSubprocess: respects env option", async () => {
  const result = await SafeSubprocess.run(getDenoCmd(), [
    "eval",
    "console.log(Deno.env.get('TEST_VAR') ?? '')",
  ], {
    env: { "TEST_VAR": "test_value" },
  });
  assertEquals(result.code, 0);
  assert(result.stdout.includes("test_value"));
});

Deno.test("SafeSubprocess: handles non-zero exit code", async () => {
  const result = await SafeSubprocess.run(getDenoCmd(), ["eval", "Deno.exit(1)"]);
  assertEquals(result.code, 1);
  // Should NOT throw, just return code 1
});

Deno.test("SafeSubprocess: handles abort signal", async () => {
  const controller = new AbortController();
  const task = SafeSubprocess.run(getDenoCmd(), getLongRunningEvalArgs(), { abortSignal: controller.signal });

  // Abort after a tiny delay to ensure command started
  setTimeout(() => controller.abort(), TEST_SUBPROCESS_ABORT_DELAY_MS);

  await assertRejects(
    async () => {
      await task;
    },
    SubprocessTimeoutError,
  );
});
