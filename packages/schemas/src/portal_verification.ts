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
  UNSLOP_CHECK_KIND,
  UNSLOP_DENO_PACK,
  UNSLOP_PORTAL_INCLUDE_GLOBS,
  UNSLOP_TS_PACK,
  VERIFICATION_ALLOW_FLAG_PREFIX,
  VERIFICATION_FORBIDDEN_ARGS,
  VERIFICATION_MAX_REPAIR_ATTEMPTS_LIMIT,
  VERIFICATION_PERMISSION_SET_FLAGS,
  VERIFICATION_PERMISSION_SHORT_FLAGS,
} from "@exaix/core";

/** Every check name a verification run can report. The public union activates in Step 5. */
export type VerificationCheckName = IDenoTaskCheck["task"] | "unslop";

/** The reported name of one configured check. */
export function checkName(check: IVerificationCheck): VerificationCheckName {
  return check.kind === UNSLOP_CHECK_KIND ? UNSLOP_CHECK_KIND : check.task;
}

/** True when the check is a Deno task check, so its task, path and args are readable. */
export function isDenoTaskCheck(check: IVerificationCheck): check is IDenoTaskCheck {
  return check.kind === "deno_task";
}

/** The Deno task behind a check name, or null for a name without a Deno task. */
export function denoTaskOf(name: VerificationCheckName): IDenoTaskCheck["task"] | null {
  return name === UNSLOP_CHECK_KIND ? null : name;
}

/** One failed check as it appears in `IVerificationResult` and the repair prompt. */
export interface IVerificationCheckFailure {
  check: VerificationCheckName;
  /** null when the check timed out or could not start. */
  exit_code: number | null;
  /** stdout + stderr, truncated to output_max_chars (tail kept). */
  output: string;
}

/** One configured unslop check state after an attempt. */
export interface IVerificationCheckRunState {
  check_index: number;
  outcome: UnslopCheckRunOutcome;
  total: number | null;
  error_class: UnslopErrorClass | null;
}

/** One retained unslop finding before safe projection. */
export interface IVerificationLintFinding {
  check_index: number;
  file: string;
  line: number;
  rule: string;
}

/** Result of one verification run. */
export interface IVerificationResult {
  passed: boolean;
  /** true when a check could not run (timeout, spawn failure, confinement violation). */
  error: boolean;
  failures: IVerificationCheckFailure[];
  /** Run identity of the attempt, when the run had scoped unslop context. */
  run_id?: string;
  /** Per-check state of every configured unslop check. */
  lint_checks?: IVerificationCheckRunState[];
  /** Retained findings of the attempt, before safe projection. */
  lint_findings?: IVerificationLintFinding[];
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

/** One operator-configured Deno task check. */
export const DenoTaskCheckSchema = z.object({
  kind: z.literal("deno_task"),
  task: z.enum(["test", "lint", "check", "fmt"]),
  /** Relative to the worktree root, defaulting to ".". Absolute paths and ".." segments are rejected. */
  path: z.string().default(".").refine(isConfinedRelativePath, "path must be relative with no '..' segment"),
  /** Operator-supplied flags, e.g. ["--allow-read=."]. Never model-supplied. Permission flags must be scoped. */
  args: z.array(z.string()).default([]).refine(hasNoForbiddenVerificationArgs, "forbidden verification arg"),
});

export type IDenoTaskCheck = z.infer<typeof DenoTaskCheckSchema>;

/** The discriminator field name every verification check carries. */
const CHECK_KIND_FIELD = "kind";

/** True when an include glob stays repo-relative and carries no NUL or escape. */
export function isSafeIncludeGlob(glob: string): boolean {
  if (glob.includes("\u0000") || glob.startsWith("/") || glob.startsWith("\\")) return false;
  return !glob.split("/").includes("..");
}

/** True when a value is a literal repo file path with no escape or platform prefix. */
export function isLiteralRepoFilePath(value: string): boolean {
  if (value.length === 0 || value === "." || value.startsWith("/")) return false;
  if (value.includes("\u0000") || value.startsWith("\\")) return false;
  if (/^[A-Za-z]:/.test(value)) return false;
  const segments = value.replaceAll("\\", "/").split("/");
  return !segments.includes("..") && !segments.includes(".");
}

/** True when the packs carry exactly one TypeScript pack and at most one Deno pack. */
function hasExactlyOneTypeScriptAndAtMostOneDeno(packs: readonly string[]): boolean {
  const typescript = packs.filter((pack) => pack === UNSLOP_TS_PACK).length;
  const deno = packs.filter((pack) => pack === UNSLOP_DENO_PACK).length;
  return typescript === 1 && deno <= 1;
}

/** Orders packs canonically: TypeScript first, then Deno. */
function canonicalPackOrder(packs: readonly string[]): readonly string[] {
  return [...packs].sort((left, right) => left === right ? 0 : left === UNSLOP_TS_PACK ? -1 : 1);
}

/** One operator-configured unslop lint check with the validated pack and catalog contract. */
export const UnslopCheckSchema = z.object({
  kind: z.literal(UNSLOP_CHECK_KIND),
  packs: z.array(z.enum([UNSLOP_TS_PACK, UNSLOP_DENO_PACK]))
    .min(1)
    .max(2)
    .default([UNSLOP_TS_PACK])
    .refine(hasExactlyOneTypeScriptAndAtMostOneDeno, "typescript is required; duplicates are forbidden")
    .transform(canonicalPackOrder),
  catalog: z.string().min(1).refine(isLiteralRepoFilePath, "catalog must be a literal repo file path").optional(),
  include: z.array(z.string().min(1).refine(isSafeIncludeGlob, "include glob must be repo-relative"))
    .min(1)
    .default([...UNSLOP_PORTAL_INCLUDE_GLOBS]),
}).strict();

export type IUnslopCheck = z.infer<typeof UnslopCheckSchema>;

/** One operator-configured post-execution check of any supported kind. */
export const VerificationCheckSchema = z.discriminatedUnion(CHECK_KIND_FIELD, [DenoTaskCheckSchema, UnslopCheckSchema]);

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

/** The closed set of categorical unslop errors. Messages never carry portal text. */
export const UNSLOP_ERROR_CLASSES = [
  "UnslopEngineMissing",
  "UnslopAssetInvalid",
  "UnslopCatalogInvalid",
  "UnslopSnapshotInvalid",
  "UnslopGitFailed",
  "UnslopSourceInvalid",
  "UnslopHostProtocolInvalid",
  "UnslopTimeout",
  "UnslopSpawnFailed",
  "UnslopLimitExceeded",
  "UnslopSuppressionForbidden",
] as const;

export type UnslopErrorClass = (typeof UNSLOP_ERROR_CLASSES)[number];

/** Named access to the closed unslop error classes. */
export const UnslopErrorClass = {
  ENGINE_MISSING: "UnslopEngineMissing",
  ASSET_INVALID: "UnslopAssetInvalid",
  CATALOG_INVALID: "UnslopCatalogInvalid",
  SNAPSHOT_INVALID: "UnslopSnapshotInvalid",
  GIT_FAILED: "UnslopGitFailed",
  SOURCE_INVALID: "UnslopSourceInvalid",
  HOST_PROTOCOL_INVALID: "UnslopHostProtocolInvalid",
  TIMEOUT: "UnslopTimeout",
  SPAWN_FAILED: "UnslopSpawnFailed",
  LIMIT_EXCEEDED: "UnslopLimitExceeded",
  SUPPRESSION_FORBIDDEN: "UnslopSuppressionForbidden",
} as const satisfies Record<string, UnslopErrorClass>;

/** The outcome of one configured unslop check in the terminal snapshot. */
export const UNSLOP_CHECK_NOT_RUN = "not_run";

export const UNSLOP_CHECK_RUN_OUTCOMES = [
  GeneralStatus.PASSED,
  GeneralStatus.FAILED,
  GeneralStatus.ERROR,
  UNSLOP_CHECK_NOT_RUN,
] as const;

export type UnslopCheckRunOutcome = (typeof UNSLOP_CHECK_RUN_OUTCOMES)[number];

/** The verification status wire values, for runtime validation. */
export const VERIFICATION_STATUS_VALUES = [
  VerificationStatus.NOT_CONFIGURED,
  VerificationStatus.SKIPPED,
  VerificationStatus.PASSED,
  VerificationStatus.REPAIRED,
  VerificationStatus.FAILED,
  VerificationStatus.ERROR,
] as const;

export const VerificationStatusSchema = z.enum(VERIFICATION_STATUS_VALUES);

/** Verification identity on execution.completed. Older rows may omit the added fields. */
export const ExecutionCompletedVerificationSchema = z.object({
  request_id: z.string().min(1),
  verification_status: VerificationStatusSchema,
  verification_run_id: z.string().uuid().optional(),
  commit_sha: z.string().min(1).nullable().optional(),
});

export type IExecutionCompletedVerification =
  & Omit<z.infer<typeof ExecutionCompletedVerificationSchema>, "verification_status">
  & {
    verification_status: VerificationStatus;
  };

const UnslopCheckIndexSchema = z.number().int().nonnegative();
const UnslopTotalSchema = z.number().int().nonnegative().nullable();

/** One configured unslop check in the terminal snapshot. */
export const UnslopCheckSnapshotSchema = z.object({
  check_index: UnslopCheckIndexSchema,
  outcome: z.enum(UNSLOP_CHECK_RUN_OUTCOMES),
  total: UnslopTotalSchema,
  error_class: z.enum(UNSLOP_ERROR_CLASSES).nullable(),
}).strict();

/** True when a projected path is relative and contains no raw terminal or markup controls. */
function isSafeFindingPath(value: string): boolean {
  return isLiteralRepoFilePath(value) && ![...value].some((char) => {
    const code = char.codePointAt(0) ?? 0;
    return code < 0x20 || code === 0x7f || char === "<" || char === ">";
  });
}

/** One persisted finding. The file is a display-safe repo-relative path. */
export const UnslopFindingSnapshotSchema = z.object({
  check_index: UnslopCheckIndexSchema,
  file: z.string().min(1).refine(isSafeFindingPath, "unsafe display path"),
  line: z.number().int().positive(),
  rule: z.string().regex(/^unslop\/[a-z][a-z0-9-]*$/),
}).strict();

/** The authoritative terminal findings snapshot of one configured unslop run. */
export const ExecutionVerificationLintFindingsEventPayloadSchema = z.object({
  request_id: z.string().min(1),
  run_id: z.string().uuid(),
  attempt: z.number().int().nonnegative(),
  commit_sha: z.string().min(1).nullable(),
  verification_status: VerificationStatusSchema,
  total: UnslopTotalSchema,
  checks: z.array(UnslopCheckSnapshotSchema).min(1),
  findings: z.array(UnslopFindingSnapshotSchema),
  truncated: z.boolean(),
}).strict().superRefine((snapshot, context) => {
  if (!validSnapshotSemantics(snapshot)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "inconsistent lint snapshot" });
  }
});

export type IExecutionVerificationLintFindingsEventPayload = z.infer<
  typeof ExecutionVerificationLintFindingsEventPayloadSchema
>;

/** Validates the per-check outcome without accepting contradictory numeric totals. */
function validCheckState(check: z.infer<typeof UnslopCheckSnapshotSchema>): boolean {
  if (check.outcome === VerificationStatus.ERROR) return check.total === null && check.error_class !== null;
  if (check.error_class !== null) return false;
  if (check.outcome === UNSLOP_CHECK_NOT_RUN) return check.total === null;
  if (check.outcome === VerificationStatus.PASSED) return check.total === 0;
  return check.total !== null && check.total > 0;
}

/** Enforces the relationships a renderer must trust across snapshot fields. */
function validSnapshotSemantics(snapshot: {
  verification_status: VerificationStatus;
  total: number | null;
  checks: z.infer<typeof UnslopCheckSnapshotSchema>[];
  findings: z.infer<typeof UnslopFindingSnapshotSchema>[];
  truncated: boolean;
}): boolean {
  const { checks, findings, total, verification_status: status } = snapshot;
  if (
    !checks.every((check, index) =>
      validCheckState(check) &&
      (index === 0 || check.check_index > checks[index - 1]!.check_index)
    )
  ) return false;
  for (const finding of findings) {
    const check = checks.find((entry) => entry.check_index === finding.check_index);
    if (check?.outcome !== VerificationStatus.FAILED) return false;
  }
  for (const check of checks) {
    const count = findings.filter((finding) => finding.check_index === check.check_index).length;
    if (check.total !== null && count > check.total) return false;
  }
  const complete = checks.every((check) => check.total !== null);
  const aggregate = complete ? checks.reduce((sum, check) => sum + (check.total ?? 0), 0) : null;
  if (total !== aggregate || snapshot.truncated !== (total !== null && total > findings.length)) return false;
  return validSnapshotStatus(status, checks, findings.length);
}

/** Status also covers Deno task checks whose state is not included in the lint-only snapshot. */
function validSnapshotStatus(
  status: VerificationStatus,
  checks: z.infer<typeof UnslopCheckSnapshotSchema>[],
  findingCount: number,
): boolean {
  if (status === VerificationStatus.NOT_CONFIGURED) return false;
  if (status === VerificationStatus.SKIPPED) {
    return checks.every((check) => check.outcome === UNSLOP_CHECK_NOT_RUN) && findingCount === 0;
  }
  if (status === VerificationStatus.PASSED || status === VerificationStatus.REPAIRED) {
    return checks.every((check) => check.outcome === VerificationStatus.PASSED);
  }
  if (status === VerificationStatus.FAILED) return checks.every((check) => check.outcome !== VerificationStatus.ERROR);
  return true;
}
