/**
 * @module LintSnapshot
 * @path packages/execution/src/lint_snapshot.ts
 * @description Builds the authoritative terminal findings snapshot, finding identity and the global cap.
 * @architectural-layer Services
 * @dependencies [@exaix/core, @exaix/schemas]
 * @related-files [packages/execution/src/execution_loop.ts, packages/schemas/src/portal_verification.ts]
 */

import { redactKnownSecrets } from "@exaix/core/func";
import {
  ExecutionVerificationLintFindingsEventPayloadSchema,
  type IExecutionVerificationLintFindingsEventPayload,
  type IVerificationCheckRunState,
  type IVerificationLintFinding,
  type VerificationStatus,
} from "@exaix/schemas";

/** Inputs of the terminal snapshot. */
interface ILintSnapshotInput {
  readonly requestId: string;
  readonly runId: string;
  readonly attempt: number;
  readonly commitSha: string | null;
  readonly status: VerificationStatus;
  readonly checks: readonly IVerificationCheckRunState[];
  readonly findings: readonly IVerificationLintFinding[];
  readonly limit: number;
  readonly knownSecrets: readonly string[];
}

const CONTROL_REPLACEMENTS = new Map<string, string>([
  ["<", "&lt;"],
  [">", "&gt;"],
  ["&", "&amp;"],
]);

/** Projects one raw repo path into its display-safe persisted form. */
export function projectLintFilePath(path: string, knownSecrets: readonly string[]): string {
  const redacted = redactKnownSecrets(path, knownSecrets).text;
  return [...redacted].map((char) => {
    const replacement = CONTROL_REPLACEMENTS.get(char);
    if (replacement !== undefined) return replacement;
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return `\\u${code.toString(16).padStart(4, "0")}`;
    return char;
  }).join("");
}

/** Fills every configured check index and marks an unreached check as not_run. */
export function completeCheckStates(
  recorded: readonly IVerificationCheckRunState[],
  configuredIndexes: readonly number[],
): IVerificationCheckRunState[] {
  const byIndex = new Map(recorded.map((state) => [state.check_index, state]));
  return [...configuredIndexes].sort((left, right) => left - right).map((checkIndex) =>
    byIndex.get(checkIndex) ?? {
      check_index: checkIndex,
      outcome: "not_run",
      total: null,
      error_class: null,
    }
  );
}

/** Builds and runtime-validates the one terminal snapshot of a configured lint run. */
export function buildLintSnapshot(
  input: ILintSnapshotInput,
): IExecutionVerificationLintFindingsEventPayload {
  const completed = input.checks.every((state) => state.outcome !== "not_run" && state.total !== null);
  const aggregateTotal = completed ? input.checks.reduce((sum, state) => sum + (state.total ?? 0), 0) : null;
  const ordered = [...input.findings]
    .map((finding) => ({ ...finding, file: projectLintFilePath(finding.file, input.knownSecrets) }))
    .sort((left, right) =>
      left.check_index - right.check_index ||
      left.file.localeCompare(right.file) ||
      left.line - right.line ||
      left.rule.localeCompare(right.rule)
    );
  const capped = ordered.slice(0, input.limit);
  return ExecutionVerificationLintFindingsEventPayloadSchema.parse({
    request_id: input.requestId,
    run_id: input.runId,
    attempt: input.attempt,
    commit_sha: input.commitSha,
    verification_status: input.status,
    total: aggregateTotal,
    checks: input.checks,
    findings: capped,
    truncated: aggregateTotal !== null && aggregateTotal > capped.length,
  });
}

/** One diagnostic with its full source position. */
export interface ILintFinding {
  readonly file: string;
  readonly start_line: number;
  readonly start_column: number;
  readonly end_line: number;
  readonly end_column: number;
  readonly rule: string;
}

/** Orders findings before any safe display projection. */
export function compareLintFindings(left: ILintFinding, right: ILintFinding): number {
  return left.file.localeCompare(right.file) || left.start_line - right.start_line ||
    left.start_column - right.start_column || left.rule.localeCompare(right.rule) ||
    left.end_line - right.end_line || left.end_column - right.end_column;
}

/** Deduplicates a single byte-bounded host batch by complete source position identity. */
export function uniqueLintBatch(findings: readonly ILintFinding[]): ILintFinding[] {
  const unique = new Map<string, ILintFinding>();
  for (const finding of findings) {
    const key = JSON.stringify([
      finding.file,
      finding.start_line,
      finding.start_column,
      finding.end_line,
      finding.end_column,
      finding.rule,
    ]);
    unique.set(key, finding);
  }
  return [...unique.values()].sort(compareLintFindings);
}
