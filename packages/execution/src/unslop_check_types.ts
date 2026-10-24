/**
 * @module UnslopCheckTypes
 * @path packages/execution/src/unslop_check_types.ts
 * @description Typed outcomes, findings and error classes of the portal unslop verification adapter.
 * @architectural-layer Services
 * @dependencies [@exaix/schemas]
 * @related-files [packages/execution/src/verification_runner.ts, packages/schemas/src/portal_verification.ts]
 */

import type { UnslopErrorClass } from "@exaix/schemas";

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
  readonly kind: "passed";
  readonly hostExitCodes: readonly number[];
  readonly total: 0;
  readonly findings: readonly [];
  readonly output: "";
}

/** A check that retained findings on changed lines. */
export interface IUnslopCheckOutcomeFailed {
  readonly kind: "failed";
  readonly hostExitCodes: readonly number[];
  readonly total: number;
  readonly findings: readonly IUnslopFinding[];
  readonly output: string;
}

/** A check that could not produce a valid result. */
export interface IUnslopCheckOutcomeError {
  readonly kind: "error";
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
