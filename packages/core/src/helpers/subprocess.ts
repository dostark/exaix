/**
 * @module Subprocess
 * @path packages/core/src/helpers/subprocess.ts
 * @related-files []
 * @architectural-layer Core
 * @ungrounded
 * @description Safe subprocess execution utilities with timeout protection and error handling.
 */

export interface ISubprocessOptions {
  timeoutMs?: number;
  abortSignal?: AbortSignal;
  cwd?: string;
  env?: Record<string, string>;
}

const DEFAULT_SUBPROCESS_TIMEOUT_MS = 30000;

export class SafeSubprocess {
  static async run(
    command: string,
    args: string[],
    options: ISubprocessOptions = {},
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    const {
      timeoutMs = DEFAULT_SUBPROCESS_TIMEOUT_MS,
      abortSignal,
      cwd,
      env,
    } = options;

    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => {
      timeoutController.abort();
    }, timeoutMs);

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
