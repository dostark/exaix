/**
 * @module ReviewVerification
 * @path apps/exactl/src/commands/review_verification.ts
 * @description Joins validated journal completion and lint snapshot identities to the reviewed commit.
 * @architectural-layer Application
 * @dependencies [@exaix/schemas]
 * @related-files [apps/exactl/src/commands/review_commands.ts]
 */

import {
  ExecutionCompletedVerificationSchema,
  ExecutionVerificationLintFindingsEventPayloadSchema,
  type VerificationStatus,
} from "@exaix/schemas";
import type { Opt, Reason } from "@exaix/core/types";
import { DomainEventType } from "@exaix/core/events";
import type { IReviewUnslopSummary } from "./review_commands.ts";

/** Parses each journal row independently so an unrelated corrupt row cannot hide a warning. */
function parsePayload(payload: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(payload);
    return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/** Selects the execution for a reviewed commit. Historical rows fall back to the single legacy completion. */
export function projectReviewVerification(
  activities: readonly { action_type: string; payload: string }[],
  commitSha: Opt<string, Reason.OptionalInput>,
  requestId: string,
): { status?: VerificationStatus; unslop?: IReviewUnslopSummary } {
  const completions = activities.filter((row) => row.action_type === DomainEventType.ExecutionCompleted)
    .flatMap((row) => {
      const parsed = ExecutionCompletedVerificationSchema.safeParse(parsePayload(row.payload));
      return parsed.success ? [parsed.data] : [];
    });
  const snapshots = activities.filter((row) => row.action_type === DomainEventType.ExecutionVerificationLintFindings)
    .flatMap((row) => {
      const payload = parsePayload(row.payload);
      return payload === null ? [] : [payload];
    });
  const matchesRun = (row: Record<string, unknown>, completion: typeof completions[number]): boolean =>
    row.request_id === completion.request_id && row.run_id === completion.verification_run_id;
  const bound = completions.findLast((completion) =>
    commitSha !== undefined && (completion.commit_sha === commitSha ||
      (completion.commit_sha === undefined && completion.verification_run_id !== undefined &&
        snapshots.some((snapshot) => matchesRun(snapshot, completion) && snapshot.commit_sha === commitSha)))
  );
  const legacy = completions.filter((completion) => completion.commit_sha === undefined);
  const sameRequest = legacy.filter((completion) => completion.request_id === requestId);
  const historical = sameRequest.length > 0 ? sameRequest : legacy;
  const completion = bound ?? (historical.length === 1 ? historical[0] : undefined);
  if (completion === undefined) return {};
  const status = completion.verification_status;
  if (completion.verification_run_id === undefined) return { status };
  const unavailable: IReviewUnslopSummary = {
    total: null,
    findings: [],
    truncated: false,
    checks: [],
    unavailable: true,
  };
  const snapshot = snapshots.findLast((row) => matchesRun(row, completion) && row.commit_sha === commitSha);
  const parsed = ExecutionVerificationLintFindingsEventPayloadSchema.safeParse(snapshot);
  if (!parsed.success || parsed.data.verification_status !== status) return { status, unslop: unavailable };
  const { total, findings, truncated, checks } = parsed.data;
  return { status, unslop: { total, findings, truncated, checks } };
}
