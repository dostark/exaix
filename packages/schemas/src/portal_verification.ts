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
  GeneralStatus,
  VERIFICATION_ALLOW_FLAG_PREFIX,
  VERIFICATION_FORBIDDEN_ARGS,
  VERIFICATION_MAX_REPAIR_ATTEMPTS_LIMIT,
  VERIFICATION_PERMISSION_SET_FLAGS,
  VERIFICATION_PERMISSION_SHORT_FLAGS,
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

/** A single-dash token of one or more letters, e.g. `-q` or the cluster `-qA`. */
const SHORT_FLAG_TOKEN = /^-[A-Za-z]+$/;
/** Separator between a flag and its value list. */
const FLAG_VALUE_SEPARATOR = "=";

/** True when `arg` grants an unscoped or config-chosen permission, or mutates the worktree. */
function isForbiddenVerificationArg(arg: string): boolean {
  const separatorIndex = arg.indexOf(FLAG_VALUE_SEPARATOR);
  const flag = separatorIndex === -1 ? arg : arg.slice(0, separatorIndex);
  const value = separatorIndex === -1 ? "" : arg.slice(separatorIndex + 1);

  if (VERIFICATION_FORBIDDEN_ARGS.includes(flag)) return true;
  if (VERIFICATION_PERMISSION_SET_FLAGS.includes(flag)) return true;
  if (SHORT_FLAG_TOKEN.test(flag)) {
    return [...flag.slice(1)].some((letter) => VERIFICATION_PERMISSION_SHORT_FLAGS.includes(letter));
  }
  if (flag.startsWith(VERIFICATION_ALLOW_FLAG_PREFIX)) return value.length === 0;
  return false;
}

/** True when `args` contains no unscoped permission grant and no in-place-mutation flag. */
export function hasNoForbiddenVerificationArgs(args: readonly string[]): boolean {
  return !args.some(isForbiddenVerificationArg);
}

/** One operator-configured post-execution check. */
export const VerificationCheckSchema = z.object({
  kind: z.literal("deno_task"),
  task: z.enum(["test", "lint", "check", "fmt"]),
  /** Relative to the worktree root, defaulting to ".". Absolute paths and ".." segments are rejected. */
  path: z.string().default(".").refine(isConfinedRelativePath, "path must be relative with no '..' segment"),
  /** Operator-supplied flags, e.g. ["--allow-read=."]. Never model-supplied. Permission flags must be scoped. */
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
export const VerificationStatus = {
  NOT_CONFIGURED: "not_configured",
  SKIPPED: GeneralStatus.SKIPPED,
  PASSED: GeneralStatus.PASSED,
  REPAIRED: "repaired",
  FAILED: GeneralStatus.FAILED,
  ERROR: GeneralStatus.ERROR,
} as const;

export type VerificationStatus = `${typeof VerificationStatus[keyof typeof VerificationStatus]}`;
