/**
 * @module CompatTypes
 * @path tests/compat/harness/compat_types.ts
 * @description Shared identifiers and candidate-binding shapes of the pending-review compatibility harness.
 */

/** One executable that the sandbox exposes on PATH. */
export interface IBoundExecutable {
  /** The name visible on PATH inside the sandbox. `deno` is allowed only for ts-frozen. */
  name: "exactl" | "exaix" | "deno";
  /** A host path, absolute or relative to the harness sandbox root. */
  sourcePath: string;
  sha256: string;
  argvPrefix: string[];
}

/** A single file that a candidate needs, such as the SQLite library of the TS binary. */
export interface IBoundCompanion {
  path: string;
  sha256: string;
  envVar: string;
}

/** A directory tree that a candidate needs, such as the TS source or its module cache. */
export interface IBoundTree {
  sourcePath: string;
  mountPath: string;
  writable: boolean;
  contentHash: string;
}

export interface ICandidateBinding {
  schemaVersion: typeof COMPAT_SCHEMA_VERSION;
  label: string;
  kind: CandidateKind;
  /** The commit the executables were built from. */
  sourceRevision: string;
  toolchain: string;
  executables: IBoundExecutable[];
  companions: IBoundCompanion[];
  trees: IBoundTree[];
  /** The exact environment passed into the sandbox. */
  env: Record<string, string>;
}

export interface ICommandObservation {
  argv: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
  stdoutEncoding: OutputEncoding;
  stderrEncoding: OutputEncoding;
}

export const COMPAT_SCHEMA_VERSION = "1";

export const CandidateKind = {
  TS_FROZEN: "ts-frozen",
  GO_STANDALONE: "go-standalone",
  MIXED: "mixed",
  MUTANT: "mutant",
} as const;
export type CandidateKind = typeof CandidateKind[keyof typeof CandidateKind];

export const OutputEncoding = {
  UTF8: "utf-8",
  BASE64: "base64",
} as const;
export type OutputEncoding = typeof OutputEncoding[keyof typeof OutputEncoding];

/** One identifier per pending-review case that the harness records and compares. */
export const CompatCaseId = {
  SHOW_CODE: "show-code",
  SHOW_ARTIFACT: "show-artifact",
  APPROVE_ARTIFACT: "approve-artifact",
  REJECT_ARTIFACT: "reject-artifact",
  APPROVE_WORKTREE: "approve-worktree",
  APPROVE_BRANCH_PORTAL: "approve-branch-portal",
  APPROVE_WRONG_BASE: "approve-wrong-base",
  REJECT_WORKTREE: "reject-worktree",
  REJECT_MISSING_REASON: "reject-missing-reason",
  MERGE_CONFLICT: "merge-conflict",
  RESTART_RETRY: "restart-retry",
  OWNER_SCRIPT: "owner-script",
} as const;
export type CompatCaseId = typeof CompatCaseId[keyof typeof CompatCaseId];
