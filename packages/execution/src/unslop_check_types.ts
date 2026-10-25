/**
 * @module UnslopCheckTypes
 * @path packages/execution/src/unslop_check_types.ts
 * @description Typed outcomes, findings and error classes of the portal unslop verification adapter.
 * @architectural-layer Services
 * @dependencies [@exaix/schemas]
 * @related-files [packages/execution/src/verification_runner.ts, packages/schemas/src/portal_verification.ts]
 */

import type { IEventLogger } from "@exaix/core/logger";
import type { IGitService } from "@exaix/core/types";
import type { IUnslopSettings, UnslopErrorClass, VerificationStatus } from "@exaix/schemas";

/** One retained diagnostic. Every path is an internal raw repo path until safe projection. */
export interface IUnslopFinding {
  /** Repo-relative path with POSIX separators. */
  readonly file: string;
  readonly start_line: number;
  readonly start_column: number;
  readonly end_line: number;
  readonly end_column: number;
  readonly rule: string;
}

/** A check that retained no finding. */
export interface IUnslopCheckOutcomePassed {
  readonly kind: typeof VerificationStatus.PASSED;
  readonly hostExitCodes: readonly number[];
  readonly total: 0;
  readonly findings: readonly [];
  readonly output: "";
}

/** A check that retained findings on changed lines. */
export interface IUnslopCheckOutcomeFailed {
  readonly kind: typeof VerificationStatus.FAILED;
  readonly hostExitCodes: readonly number[];
  readonly total: number;
  readonly findings: readonly IUnslopFinding[];
  readonly output: string;
}

/** A check that could not produce a valid result. */
export interface IUnslopCheckOutcomeError {
  readonly kind: typeof VerificationStatus.ERROR;
  readonly error_class: UnslopErrorClass;
  readonly total: null;
  readonly findings: readonly [];
  readonly output: string;
}

/** The adapter result for one configured unslop check. */
export type IUnslopCheckOutcome =
  | IUnslopCheckOutcomePassed
  | IUnslopCheckOutcomeFailed
  | IUnslopCheckOutcomeError;

/** The per-check state the terminal snapshot keeps, including a check not reached. */
export interface IUnslopCheckRunState {
  readonly check_index: number;
  readonly outcome: "passed" | "failed" | "error" | "not_run";
  readonly total: number | null;
  readonly error_class: UnslopErrorClass | null;
}

/** One configured portal unslop check at the Step 4 contract. */
export interface IUnslopCheckConfig {
  readonly kind: "unslop";
  /** Validated rule packs, canonically ordered. */
  readonly packs?: readonly string[];
  /** Optional literal repo path of a base-commit replacement catalog. */
  readonly catalog?: string;
  /** Repo-relative globs the operator selected. The adapter keeps only matching files. */
  readonly include?: readonly string[];
}

/** Narrow confinement contract the adapter needs from the path resolver. */
export interface IPathConfinement {
  validatePath(path: string, allowedRoots: string[]): Promise<string>;
  resolve(alias: string): Promise<string>;
}

/** Inputs of the unslop adapter. They never infer a root from the process directory. */
export interface IUnslopCheckRunnerOptions {
  readonly settings: IUnslopSettings;
  readonly systemRoot: string;
  readonly logger: IEventLogger;
  readonly pathResolver: IPathConfinement;
  /** Configured portal roots that cannot own trusted lint inputs. */
  readonly portalRoots?: readonly string[];
  /** Known secrets redacted from the repair text. */
  readonly knownSecrets?: readonly string[];
}

/** One adapter invocation, bound to the immutable base and one target commit. */
export interface IUnslopCheckContext {
  readonly requestId: string;
  readonly traceId: string;
  readonly attempt: number;
  readonly executionRoot: string;
  readonly runId: string;
  readonly baseSha: string;
  readonly targetSha: string;
  readonly git: IGitService;
  readonly checkIndex: number;
  readonly check: IUnslopCheckConfig;
  readonly timeoutMs: number;
  readonly outputMaxChars: number;
}
