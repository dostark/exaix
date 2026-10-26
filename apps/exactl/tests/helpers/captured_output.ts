/**
 * @module CapturedOutputTestHelper
 * @path apps/exactl/tests/helpers/captured_output.ts
 * @description Runs a function while `console.log` lines are collected, so CLI tests can assert on printed output.
 * @architectural-layer CLI
 * @related-files [apps/exactl/tests/helpers/console_utils.ts]
 */

interface IConsoleArgs extends Array<string | number | boolean | object | undefined | null> {}

/** Runs `fn` and returns the lines it logged with its result. `console.log` is restored afterwards. */
export function withCapturedOutput<T>(fn: () => T | Promise<T>): Promise<{ output: string[]; result: T }> {
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
