/**
 * @module Subprocess
 * @path src/helpers/subprocess.ts
 * @description Safe subprocess execution utilities with timeout protection and error handling.
 * @architectural-layer Helpers
 * * @related-files [src/services/tool_reflector.ts]
 */

import { DEFAULT_SUBPROCESS_TIMEOUT_MS } from "../shared/constants.ts";

export interface ISubprocessOptions {
  timeoutMs?: number;
  abortSignal?: AbortSignal;
  cwd?: string;
  env?: Record<string, string>;
}

export class SafeSubprocess {
  /**
   * Run a subprocess with timeout protection and proper error handling
   */
  static async run(
    command: string,
    args: string[],
    options: ISubprocessOptions = {},
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    const {
      timeoutMs = DEFAULT_SUBPROCESS_TIMEOUT_MS, // 30 second default timeout
      abortSignal,
      cwd,
      env,
    } = options;

    // Create abort controller for timeout
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => {
      timeoutController.abort();
    }, timeoutMs);

    // Combine abort signals
    const combinedSignal = abortSignal
      ? AbortSignal.any([abortSignal, timeoutController.signal])
      : timeoutController.signal;

    try {
      const cmdOptions: Deno.CommandOptions = {
        args,
        cwd,
        stdout: "piped",
        stderr: "piped",
        signal: combinedSignal,
      };

      if (env) {
        cmdOptions.env = env;
      }

      const cmd = new Deno.Command(command, cmdOptions);

      const result = await cmd.output();

      clearTimeout(timeoutId);

      if (combinedSignal.aborted) {
        throw new SubprocessTimeoutError(
          `Command timed out after ${timeoutMs}ms or was aborted: ${command} ${args.join(" ")}`,
        );
      }

      const stdout = new TextDecoder().decode(result.stdout);
      const stderr = new TextDecoder().decode(result.stderr);

      return { code: result.code, stdout, stderr };
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Deno.errors.PermissionDenied) {
        throw new SubprocessError(`Permission denied: ${command}`, error);
      }
      if (error instanceof Deno.errors.NotFound) {
        throw new SubprocessError(`Command not found: ${command}`, error);
      }
      if (combinedSignal.aborted) {
        throw new SubprocessTimeoutError(`Command timed out after ${timeoutMs}ms: ${command} ${args.join(" ")}`);
      }

      const cause = error instanceof Error ? error : new Error(String(error));
      throw new SubprocessError(`Subprocess failed: ${command}`, cause);
    }
  }

  /**
   * Spawn a subprocess without waiting for completion
   */
  static spawn(
    command: string,
    args: string[],
    options: ISubprocessOptions = {},
  ): Deno.ChildProcess {
    const { cwd, env } = options;

    const cmdOptions: Deno.CommandOptions = {
      args,
      cwd,
      stdout: "piped",
      stderr: "piped",
      stdin: "piped",
    };

    if (env) {
      cmdOptions.env = env;
    }

    const cmd = new Deno.Command(command, cmdOptions);
    return cmd.spawn();
  }
}

export class SubprocessError extends Error {
  constructor(message: string, public override cause?: Error) {
    super(message);
    this.name = "SubprocessError";
  }
}

export class SubprocessTimeoutError extends SubprocessError {
  constructor(message: string) {
    super(message);
    this.name = "SubprocessTimeoutError";
  }
}
