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
import type { JSONObject, JSONValue } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";
import { DomainEventType } from "@exaix/core/events";
import type { IReviewLintSummary } from "./review_commands.ts";

/** The run identity a lint snapshot row declares, with the payload text that the full schema reads later. */
interface ISnapshotBinding {
  readonly request_id: JSONValue;
  readonly run_id: JSONValue;
  readonly commit_sha: JSONValue;
  readonly payload: string;
}

/** Parses each journal row independently so an unrelated corrupt row cannot hide a warning. */
function parsePayload(payload: string): JSONObject | JSONValue[] | null {
  try {
    const value: JSONValue = JSON.parse(payload);
    return typeof value === "object" && value !== null ? value : null;
  } catch {
    return null;
  }
}

/** Reads only the identity of a snapshot row. An invalid full snapshot still binds, as before. */
function bindingOf(payload: string): ISnapshotBinding | null {
  const value = parsePayload(payload);
  if (value === null) return null;
  const fields: JSONObject = Array.isArray(value) ? {} : value;
  return { request_id: fields.request_id, run_id: fields.run_id, commit_sha: fields.commit_sha, payload };
}

/** Selects the execution for a reviewed commit. Historical rows fall back to the single legacy completion. */
export function projectReviewVerification(
  activities: readonly { action_type: string; payload: string }[],
  commitSha: Opt<string, Reason.OptionalInput>,
  requestId: string,
): { status?: VerificationStatus; lint?: IReviewLintSummary } {
  const completions = activities.filter((row) => row.action_type === DomainEventType.ExecutionCompleted)
    .flatMap((row) => {
      const parsed = ExecutionCompletedVerificationSchema.safeParse(parsePayload(row.payload));
      return parsed.success ? [parsed.data] : [];
    });
  const snapshots = activities.filter((row) => row.action_type === DomainEventType.ExecutionVerificationLintFindings)
    .flatMap((row) => {
      const binding = bindingOf(row.payload);
      return binding === null ? [] : [binding];
    });
  const matchesRun = (row: ISnapshotBinding, completion: typeof completions[number]): boolean =>
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
  const unavailable: IReviewLintSummary = {
    total: null,
    findings: [],
    truncated: false,
    checks: [],
    unavailable: true,
  };
  const snapshot = snapshots.findLast((row) => matchesRun(row, completion) && row.commit_sha === commitSha);
  const parsed = ExecutionVerificationLintFindingsEventPayloadSchema.safeParse(
    snapshot === undefined ? undefined : parsePayload(snapshot.payload),
  );
  if (!parsed.success || parsed.data.verification_status !== status) return { status, lint: unavailable };
  const { total, findings, truncated, checks } = parsed.data;
  return { status, lint: { total, findings, truncated, checks } };
}
