/**
 * @module PortalVerificationSchema
 * @path packages/schemas/src/portal_verification.ts
 * @description Schema and pure refinements for the optional per-portal post-execution
 *   verification block: a bounded list of deno_task checks the daemon runs in the
 *   execution worktree after a plan's work is committed.
 * @architectural-layer Schemas
 * @dependencies ["@exaix/core"]
 * @related-files ["packages/schemas/src/portal_permissions.ts"]
 */

import { z } from "zod";
import { isAbsolute, normalize, SEPARATOR } from "@std/path";
import {
  DEFAULT_VERIFICATION_CHECK_TIMEOUT_MS,
  DEFAULT_VERIFICATION_MAX_REPAIR_ATTEMPTS,
  DEFAULT_VERIFICATION_OUTPUT_MAX_CHARS,
  VERIFICATION_FORBIDDEN_ARGS,
  VERIFICATION_FORBIDDEN_BARE_ALLOW_FLAGS,
  VERIFICATION_MAX_REPAIR_ATTEMPTS_LIMIT,
} from "@exaix/core";

/** One failed check as it appears in `IVerificationResult` and the repair prompt. */
export interface IVerificationCheckFailure {
  task: IVerificationCheck["task"];
  /** null when the check timed out or could not start. */
  exit_code: number | null;
  /** stdout + stderr, truncated to output_max_chars (tail kept). */
  output: string;
}

/** Result of one verification run. */
export interface IVerificationResult {
  passed: boolean;
  /** true when a check could not run (timeout, spawn failure, confinement violation). */
  error: boolean;
  failures: IVerificationCheckFailure[];
}

/** Parent path segment rejected anywhere in a check path. */
const PARENT_SEGMENT = "..";

/** True when `path` is relative and carries no `..` segment after normalization. */
export function isConfinedRelativePath(path: string): boolean {
  if (isAbsolute(path)) return false;
  return !normalize(path).split(SEPARATOR).includes(PARENT_SEGMENT);
}

/** True when `args` contains no whole-host or in-place-mutation flag. */
export function hasNoForbiddenVerificationArgs(args: readonly string[]): boolean {
  for (const arg of args) {
    if (VERIFICATION_FORBIDDEN_ARGS.includes(arg)) return false;
    if (VERIFICATION_FORBIDDEN_BARE_ALLOW_FLAGS.includes(arg)) return false;
  }
  return true;
}

/** One operator-configured post-execution check. */
export const VerificationCheckSchema = z.object({
  kind: z.literal("deno_task"),
  task: z.enum(["test", "lint", "check", "fmt"]),
  /** Relative to the worktree root, defaulting to ".". Absolute paths and ".." segments are rejected. */
  path: z.string().default(".").refine(isConfinedRelativePath, "path must be relative with no '..' segment"),
  /** Operator-supplied flags, e.g. ["--allow-read=."]. Never model-supplied. */
  args: z.array(z.string()).default([]).refine(hasNoForbiddenVerificationArgs, "forbidden verification arg"),
});

export type IVerificationCheck = z.infer<typeof VerificationCheckSchema>;

/** The optional per-portal post-execution verification block. */
export const PortalVerificationSchema = z.object({
  checks: z.array(VerificationCheckSchema).min(1),
  max_repair_attempts: z.number().int().min(0).max(VERIFICATION_MAX_REPAIR_ATTEMPTS_LIMIT)
    .default(DEFAULT_VERIFICATION_MAX_REPAIR_ATTEMPTS),
  check_timeout_ms: z.number().int().positive().default(DEFAULT_VERIFICATION_CHECK_TIMEOUT_MS),
  output_max_chars: z.number().int().positive().default(DEFAULT_VERIFICATION_OUTPUT_MAX_CHARS),
});

export type IPortalVerification = z.infer<typeof PortalVerificationSchema>;

/** Outcome of the post-execution verification stage for one execution. */
export type VerificationStatus =
  | "not_configured"
  | "skipped"
  | "passed"
  | "repaired"
  | "failed"
  | "error";
