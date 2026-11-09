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

/** The part of a sink holder that a test replaces: the runtime's output sink. */
interface ISinkHolder {
  out(text: string): Promise<void>;
  err(text: string): Promise<void>;
}

/** Runs `fn` while the runtime sink collects what renderers write. The original methods are restored afterwards. */
export async function withCapturedSink(
  sink: ISinkHolder,
  fn: () => Promise<void>,
): Promise<{ out: string; err: string }> {
  const original = { out: sink.out, err: sink.err };
  let out = "";
  let err = "";
  sink.out = (text) => {
    out += text;
    return Promise.resolve();
  };
  sink.err = (text) => {
    err += text;
    return Promise.resolve();
  };
  try {
    await fn();
  } finally {
    sink.out = original.out;
    sink.err = original.err;
  }
  return { out, err };
}
