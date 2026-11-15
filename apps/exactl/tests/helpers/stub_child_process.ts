/**
 * @module StubChildProcess
 * @path apps/exactl/tests/helpers/stub_child_process.ts
 * @description Replaces Deno.Command for the length of one call so that a spawned child ends with a chosen exit status.
 * @architectural-layer Test
 * @dependencies []
 * @related-files [apps/exactl/tests/eval_commands_test.ts, apps/exactl/tests/exit_code_contract_test.ts]
 */

/** Runs `fn` while every spawned command reports `code` as its exit status. */
export async function withStubbedChildExit<T>(code: number, fn: () => Promise<T>): Promise<T> {
  const originalCommand = Deno.Command;
  Object.defineProperty(Deno, "Command", {
    configurable: true,
    value: function () {
      return { spawn: () => ({ status: Promise.resolve({ success: code === 0, code }) }) };
    },
  });
  try {
    return await fn();
  } finally {
    Object.defineProperty(Deno, "Command", { configurable: true, value: originalCommand });
  }
}
