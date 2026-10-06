/**
 * @module DenoTaskRunner
 * @path packages/tool-runtime/src/deno_task_runner.ts
 * @description Middleware-free wrapper over SafeSubprocess.run for one deno task
 *   invocation. Returns a typed outcome so callers can classify pass, failure and
 *   error without entering the registry middleware pipeline.
 * @architectural-layer Services
 * @dependencies ["@exaix/core"]
 * @related-files ["packages/tool-runtime/src/tool_registry.ts", "packages/execution/src/verification_runner.ts"]
 */

import { SafeSubprocess, SubprocessTimeoutError, SystemCommand } from "@exaix/core";

/** Options for one deno task invocation. */
export interface IDenoTaskRunOptions {
  task: string;
  args?: string[];
  /** Absolute path passed as the trailing positional argument. */
  absPath: string;
  cwd: string;
  timeoutMs: number;
  env?: Record<string, string>;
  clearEnv?: boolean;
  /** Keep only the last N characters of each output stream while reading. */
  maxOutputChars?: number;
}

/** Typed result of one deno task invocation. */
export type IDenoTaskOutcome =
  | { kind: "exited"; code: number; stdout: string; stderr: string }
  | { kind: "timed_out" }
  | { kind: "spawn_failed"; error_class: string };

/** Run one deno task through SafeSubprocess and classify the result. */
export async function runDenoTask(options: IDenoTaskRunOptions): Promise<IDenoTaskOutcome> {
  try {
    const result = await SafeSubprocess.run(
      SystemCommand.DENO,
      [options.task, ...(options.args ?? []), options.absPath],
      {
        cwd: options.cwd,
        timeoutMs: options.timeoutMs,
        env: options.env,
        clearEnv: options.clearEnv,
        maxOutputChars: options.maxOutputChars,
      },
    );
    return { kind: "exited", code: result.code, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    if (error instanceof SubprocessTimeoutError) return { kind: "timed_out" };
    const errorClass = error instanceof Error ? error.constructor.name : "UnknownError";
    return { kind: "spawn_failed", error_class: errorClass };
  }
}
