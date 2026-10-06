/**
 * @module Subprocess
 * @path packages/core/src/helpers/subprocess.ts
 * @related-files [packages/core/src/helpers/child_env.ts]
 * @architectural-layer Core
 * @ungrounded
 * @description Safe subprocess execution utilities with timeout protection and error handling.
 */

import { buildChildEnv } from "./child_env.ts";
import type { Opt, Reason } from "../types/optional_marker.ts";

export interface ISubprocessOptions {
  timeoutMs?: number;
  abortSignal?: AbortSignal;
  cwd?: string;
  env?: Record<string, string>;
  /** When true, subprocess starts with a clean environment. Deno 2.x merges `env`
   *  with the parent env by default, leaking vars like ANTHROPIC_API_KEY unless
   *  clearEnv is set — then only the vars in `env` are passed. */
  clearEnv?: boolean;
  /** When set, keep only the last `maxOutputChars` characters of each stream while reading.
   *  A child that prints without limit then cannot grow the parent's memory. */
  maxOutputChars?: number;
}

const DEFAULT_SUBPROCESS_TIMEOUT_MS = 30000;
/** A bounded tail buffer may grow to this multiple of its limit before it is trimmed. */
const TAIL_BUFFER_SLACK_FACTOR = 2;

/** Decoded process output. */
interface IDecodedOutput {
  code: number;
  stdout: string;
  stderr: string;
}

/** Read a byte stream to its end, keeping only the last `maxChars` decoded characters. */
async function readStreamTail(stream: ReadableStream<Uint8Array>, maxChars: number): Promise<string> {
  const decoder = new TextDecoder();
  let tail = "";
  for await (const chunk of stream) {
    tail += decoder.decode(chunk, { stream: true });
    if (tail.length > maxChars * TAIL_BUFFER_SLACK_FACTOR) tail = tail.slice(tail.length - maxChars);
  }
  tail += decoder.decode();
  return tail.length > maxChars ? tail.slice(tail.length - maxChars) : tail;
}

/** Run to completion and decode the whole of stdout and stderr. */
async function collectFullOutput(cmd: Deno.Command): Promise<IDecodedOutput> {
  const result = await cmd.output();
  return {
    code: result.code,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

/** Run to completion, keeping only the tail of each stream. */
async function collectTailOutput(cmd: Deno.Command, maxChars: number): Promise<IDecodedOutput> {
  const child = cmd.spawn();
  const [status, stdout, stderr] = await Promise.all([
    child.status,
    readStreamTail(child.stdout, maxChars),
    readStreamTail(child.stderr, maxChars),
  ]);
  return { code: status.code, stdout, stderr };
}

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
      clearEnv,
      maxOutputChars,
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

      // Build the child env via the shared child-env policy (injection-class vars
      // stripped) so Deno's scoped --allow-run never refuses to spawn a child that
      // would inherit LD_*/DYLD_*/overlay/git-config env.
      const childEnv = buildChildEnv({ mode: "inherit", env, clearEnv });
      cmdOptions.env = childEnv.env;
      cmdOptions.clearEnv = childEnv.clearEnv;

      const cmd = new Deno.Command(command, cmdOptions);

      const result = maxOutputChars === undefined
        ? await collectFullOutput(cmd)
        : await collectTailOutput(cmd, maxOutputChars);

      clearTimeout(timeoutId);

      if (combinedSignal.aborted) {
        throw new SubprocessTimeoutError(
          `Command timed out after ${timeoutMs}ms or was aborted: ${command} ${args.join(" ")}`,
        );
      }

      return result;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Deno.errors.PermissionDenied) {
        throw new SubprocessError(`Permission denied: ${command}`, error);
      }
      if (error instanceof Deno.errors.NotFound) {
        // Deno.errors.NotFound covers both "binary not on PATH" and "cwd does not
        // exist"; Deno's own error.message already distinguishes them (e.g. "No such
        // cwd '<path>'" vs "entity not found"), so it's included verbatim below.
        throw new SubprocessError(`Command not found: ${command}: ${error.message}`, error);
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
    const { cwd, env, clearEnv } = options;

    const cmdOptions: Deno.CommandOptions = {
      args,
      cwd,
      stdout: "piped",
      stderr: "piped",
      stdin: "piped",
    };

    const childEnv = buildChildEnv({ mode: "inherit", env, clearEnv });
    cmdOptions.env = childEnv.env;
    cmdOptions.clearEnv = childEnv.clearEnv;

    const cmd = new Deno.Command(command, cmdOptions);
    return cmd.spawn();
  }
}

export class SubprocessError extends Error {
  constructor(message: string, public override cause?: Opt<Error, Reason.OptionalContext>) {
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
