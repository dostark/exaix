/**
 * @module DenoLintProcess
 * @path packages/execution/src/deno_lint_process.ts
 * @description Bounded `deno lint` child process: complete JSON capture, host-result guards and
 *   guaranteed reaping.
 * @architectural-layer Services
 * @dependencies [@exaix/core]
 * @related-files [packages/execution/src/deno_lint_check.ts]
 */

import { SafeSubprocess } from "@exaix/core";

/** One host diagnostic with its raw file URL and half-open range. */
interface IDenoLintHostDiagnostic {
  readonly filename: string;
  readonly code: string;
  readonly message: string;
  readonly hint: string;
  readonly start: { readonly line: number; readonly column: number };
  readonly end: { readonly line: number; readonly column: number };
}

/** The batch outcome of an exceeded whole-check deadline. */
export const DENO_LINT_DEADLINE_EXCEEDED = "deadline_exceeded";

/** The parsed host JSON document. */
interface IDenoLintHostOutput {
  readonly diagnostics: readonly IDenoLintHostDiagnostic[];
  readonly errors: readonly string[];
}

/** The result of one lint batch. */
export type IDenoLintBatchOutcome =
  | {
    readonly kind: "diagnostics";
    readonly hostExitCodes: readonly number[];
    readonly diagnostics: readonly IDenoLintHostDiagnostic[];
  }
  | { readonly kind: "source_invalid" }
  | { readonly kind: "deadline_exceeded" }
  | { readonly kind: "limit" }
  | { readonly kind: "spawn_failed" }
  | { readonly kind: "protocol_invalid" };

/** Inputs of one lint batch. */
export interface IDenoLintBatchOptions {
  readonly configPath: string;
  readonly files: readonly string[];
  readonly cwd: string;
  readonly env: Record<string, string>;
  readonly clearEnv: boolean;
  readonly timeoutMs: number;
  readonly jsonMaxBytes: number;
  readonly stderrMaxBytes: number;
}

/** The complete `deno lint` argv for one batch. */
export function denoLintArgs(configPath: string, files: readonly string[]): string[] {
  return ["lint", "--deny-import", "--config", configPath, "--rules-tags=", "--json", ...files];
}

/** Strict host JSON guard. Null means malformed JSON or a malformed shape. */
export function parseDenoLintHostOutput(stdout: string): IDenoLintHostOutput | null {
  let document: unknown;
  try {
    document = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (typeof document !== "object" || document === null) return null;
  const record = document as Record<string, unknown>;
  if (!Array.isArray(record.diagnostics) || !Array.isArray(record.errors)) return null;
  const diagnostics: IDenoLintHostDiagnostic[] = [];
  for (const entry of record.diagnostics) {
    const diagnostic = parseDiagnostic(entry);
    if (diagnostic === null) return null;
    diagnostics.push(diagnostic);
  }
  const errors: string[] = [];
  for (const entry of record.errors) {
    if (typeof entry !== "string") {
      if (typeof entry !== "object" || entry === null) return null;
      const error = entry as Record<string, unknown>;
      if (typeof error.file_path !== "string" || typeof error.message !== "string") return null;
    }
    errors.push("source_invalid");
  }
  return { diagnostics, errors };
}

function isPosition(value: unknown, allowZeroColumn: boolean): value is { line: number; col: number } {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  const { line, col } = record;
  return typeof line === "number" && Number.isInteger(line) && line >= 1 &&
    typeof col === "number" && Number.isInteger(col) && col >= (allowZeroColumn ? 0 : 1);
}

/** Reads the optional string fields of one diagnostic. */
function diagnosticMeta(record: Record<string, unknown>): { code: string; message: string; hint: string } | null {
  const { code, message, hint } = record;
  if (typeof code !== "string" || code.length === 0) return null;
  if (typeof message !== "string") return null;
  if (hint !== undefined && hint !== null && typeof hint !== "string") return null;
  return { code, message, hint: typeof hint === "string" ? hint : "" };
}

/** Reads the half-open range of one diagnostic. */
function diagnosticRange(record: Record<string, unknown>): {
  start: { line: number; column: number };
  end: { line: number; column: number };
} | null {
  if (typeof record.range !== "object" || record.range === null) return null;
  const bounds = record.range as Record<string, unknown>;
  if (!isPosition(bounds.start, true) || !isPosition(bounds.end, true)) return null;
  if (bounds.end.line < bounds.start.line) return null;
  if (bounds.end.line === bounds.start.line && bounds.end.col < bounds.start.col) return null;
  return {
    start: { line: bounds.start.line, column: bounds.start.col },
    end: { line: bounds.end.line, column: bounds.end.col },
  };
}

function parseDiagnostic(entry: unknown): IDenoLintHostDiagnostic | null {
  if (typeof entry !== "object" || entry === null) return null;
  const record = entry as Record<string, unknown>;
  if (typeof record.filename !== "string" || record.filename.length === 0) return null;
  const meta = diagnosticMeta(record);
  if (meta === null) return null;
  const range = diagnosticRange(record);
  if (range === null) return null;
  return { filename: record.filename, ...meta, ...range };
}

interface IByteBudget {
  remaining: number;
}

async function readBounded(
  stream: ReadableStream<Uint8Array>,
  budget: IByteBudget,
  onOverflow: () => void,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      if (value.byteLength > budget.remaining) {
        onOverflow();
        break;
      }
      budget.remaining -= value.byteLength;
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return concat(chunks);
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

/** Runs one bounded batch and classifies its host result. */
export function runDenoLintBatch(options: IDenoLintBatchOptions): Promise<IDenoLintBatchOutcome> {
  return runDenoLintHost(options, denoLintArgs(options.configPath, options.files));
}

/** Captures and reaps the lint host under the transport limits. */
async function runDenoLintHost(
  options: Omit<IDenoLintBatchOptions, "files">,
  args: readonly string[],
): Promise<IDenoLintBatchOutcome> {
  let child: Deno.ChildProcess;
  try {
    child = SafeSubprocess.spawn(Deno.execPath(), [...args], {
      cwd: options.cwd,
      env: options.env,
      clearEnv: options.clearEnv,
    });
  } catch {
    return { kind: "spawn_failed" };
  }
  let timedOut = false;
  let overflowed = false;
  const kill = (): void => {
    try {
      child.kill();
    } catch {
      // The child already exited.
    }
  };
  const timer = setTimeout(() => {
    timedOut = true;
    kill();
  }, options.timeoutMs);
  const stdoutBudget: IByteBudget = { remaining: options.jsonMaxBytes };
  const stderrBudget: IByteBudget = { remaining: options.stderrMaxBytes };
  const stdoutChunks = readBounded(child.stdout, stdoutBudget, () => {
    overflowed = true;
    kill();
  });
  const stderrChunks = readBounded(child.stderr, stderrBudget, () => {
    overflowed = true;
    kill();
  });
  const [status, , stdoutBytes] = await Promise.all([child.status, stderrChunks, stdoutChunks]);
  clearTimeout(timer);
  if (timedOut) return { kind: DENO_LINT_DEADLINE_EXCEEDED };
  if (overflowed) return { kind: "limit" };
  if (status.code !== 0 && status.code !== 1) return { kind: "protocol_invalid" };
  const parsed = parseDenoLintHostOutput(new TextDecoder().decode(stdoutBytes));
  if (parsed === null) return { kind: "protocol_invalid" };
  if (parsed.errors.length > 0) return { kind: "source_invalid" };
  if (status.code === 0 && parsed.diagnostics.length > 0) return { kind: "protocol_invalid" };
  return { kind: "diagnostics", hostExitCodes: [status.code], diagnostics: parsed.diagnostics };
}
