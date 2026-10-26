/**
 * @module SessionDelegationTestDoubles
 * @path apps/daemon/tests/helpers/session_delegation_doubles.ts
 * @description Wait-store and result-store doubles shared by the session delegation coordinator tests.
 * @architectural-layer Tests
 * @related-files [apps/daemon/tests/session_delegation_coordinator_test.ts, apps/daemon/tests/session_delegation_coordinator_dogfood_context_test.ts]
 */

import type { SessionBrief, SessionWaitState } from "@exaix/schemas/session_delegate.ts";
import type { ISessionWaitStore } from "@exaix/session/wait/i_session_wait_store.ts";
import {
  type ISessionDelegationOutcome,
  type ISessionDelegationRequest,
  SessionDelegationOutcomeSchema,
} from "@exaix/session/session_delegation.ts";
import type {
  ISessionDelegationResultRecord,
  ISessionDelegationResultStore,
} from "@exaix/session/session_delegation_result_store.ts";

export const FIXED_NOW = new Date("2026-08-28T12:00:00.000Z");

export class RecordingWaitStore implements ISessionWaitStore {
  status: SessionWaitState["status"] = "resumed";
  decision: SessionWaitState["decision"] = "changes_made";

  park(traceId: string, gate: SessionBrief["gate"], resumeToken: string, deadline: string): Promise<SessionWaitState> {
    return Promise.resolve({
      trace_id: traceId,
      gate,
      resume_token: resumeToken,
      deadline,
      status: "pending",
      created_at: FIXED_NOW.toISOString(),
    });
  }

  resume(): Promise<SessionWaitState> {
    return Promise.reject(new Error("not used"));
  }

  expire(traceId: string): Promise<SessionWaitState> {
    this.status = "expired";
    return this.get(traceId).then((state) => state!);
  }

  cancel(traceId: string): Promise<SessionWaitState> {
    this.status = "cancelled";
    return this.get(traceId).then((state) => state!);
  }

  get(traceId: string): Promise<SessionWaitState | undefined> {
    return Promise.resolve({
      trace_id: traceId,
      gate: "code_changes",
      resume_token: "resume-token",
      deadline: "2026-12-31T00:00:00.000Z",
      status: this.status,
      decision: this.decision,
      created_at: FIXED_NOW.toISOString(),
    });
  }
}

export class OutcomeResultStore implements ISessionDelegationResultStore {
  status: ISessionDelegationOutcome["status"] | null = "completed";
  request: ISessionDelegationRequest | null = null;

  publishAccepted(): Promise<void> {
    return Promise.resolve();
  }

  publishRejected(): Promise<void> {
    return Promise.resolve();
  }

  get(traceId: string): Promise<ISessionDelegationOutcome | null> {
    if (!this.status || !this.request) return Promise.resolve(null);
    return Promise.resolve(SessionDelegationOutcomeSchema.parse({
      delegationTraceId: traceId,
      parentTraceId: this.request.parentTraceId,
      parentStepId: this.request.parentStepId,
      sequence: this.request.sequence,
      status: this.status,
      decision: this.status === "abandoned" ? "abandoned" : this.status === "completed" ? "changes_made" : undefined,
      summary: `${this.status} outcome`,
      pathsTouched: this.status === "completed" ? ["packages/session/mod.ts"] : [],
      tokenStats: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      rejection: this.status === "rejected" ? "scope_violation" : undefined,
    }));
  }

  getRecord(): Promise<ISessionDelegationResultRecord | null> {
    return Promise.resolve(null);
  }

  markDelivered(): Promise<boolean> {
    return Promise.resolve(true);
  }
}
