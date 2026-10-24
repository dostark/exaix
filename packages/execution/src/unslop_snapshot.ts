/**
 * @module UnslopSnapshot
 * @path packages/execution/src/unslop_snapshot.ts
 * @description Builds the authoritative terminal findings snapshot: safe path projection,
 *   deterministic ordering and the global cap.
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
export interface IUnslopSnapshotInput {
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
export function projectUnslopFilePath(path: string, knownSecrets: readonly string[]): string {
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

/** Builds and runtime-validates the one terminal snapshot of a configured unslop run. */
export function buildUnslopSnapshot(
  input: IUnslopSnapshotInput,
): IExecutionVerificationLintFindingsEventPayload {
  const completed = input.checks.every((state) => state.outcome !== "not_run" && state.total !== null);
  const aggregateTotal = completed ? input.checks.reduce((sum, state) => sum + (state.total ?? 0), 0) : null;
  const ordered = [...input.findings]
    .map((finding) => ({ ...finding, file: projectUnslopFilePath(finding.file, input.knownSecrets) }))
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
