/**
 * @module ConsoleUtilsTest
 * @path apps/exactl/tests/helpers/console_utils.ts
 * @description Verifies CLI console utilities, ensuring correct ANSI color mapping,
 * progress bar synchronization, and multi-line message wrapping.
 */

/**
 * Helper to run a function with a timeout.
 */
export async function runWithTimeout<T>(
  fn: () => Promise<T> | T,
  timeoutMs: number,
  timeoutMessage: string = `Test operation timed out after ${timeoutMs}ms`,
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await Promise.race([
      Promise.resolve(fn()),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener("abort", () => {
          reject(new Error(timeoutMessage));
        });
      }),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Captures console.log output during the execution of a function.
 */
export async function captureConsoleOutput(
  fn: () => Promise<void> | void,
  timeoutMs: number = 10000,
): Promise<string> {
  let out = "";
  const origLog = console.log;
  console.log = (msg: string) => (out += msg + "\n");

  try {
    await runWithTimeout(fn, timeoutMs);
  } finally {
    console.log = origLog;
  }
  return out;
}

/**
 * Captures all console outputs (log, warn, error) during the execution of a function.
 */
export async function captureAllOutputs(
  fn: () => Promise<void> | void,
  timeoutMs: number = 10000,
): Promise<{ logs: string[]; warns: string[]; errs: string[] }> {
  const logs: string[] = [];
  const warns: string[] = [];
  const errs: string[] = [];
  const origLog = console.log;
  const origWarn = console.warn;
  const origErr = console.error;
  console.log = (...args: string[]) => logs.push(args.map(String).join(" "));
  console.warn = (...args: string[]) => warns.push(args.map(String).join(" "));
  console.error = (...args: string[]) => errs.push(args.map(String).join(" "));

  try {
    await runWithTimeout(fn, timeoutMs);
  } finally {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origErr;
  }
  return { logs, warns, errs };
}
