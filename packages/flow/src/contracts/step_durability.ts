/**
 * @module StepDurabilityContracts
 * @path packages/flow/src/contracts/step_durability.ts
 * @description Defines contracts for step execution durability: IStepExecutionRecord,
 * IStepDurabilityStore, and IStepReplayPolicy. These power idempotency key generation,
 * replay detection, and result reuse across trace sessions.
 * @related-files [packages/core/src/types/enums.ts, packages/schemas/src/flow.ts]
 * @architectural-layer Contracts
 */

import type { JSONValue, StepAttemptClass, StepExecutionDisposition } from "@exaix/core";
import { StepSideEffectClass } from "@exaix/core";

export type StepEntryMetadata = { [key: string]: JSONValue };
export type StepReplayContext = { [key: string]: JSONValue };

/**
 * Represents a persisted record of a single step execution, used for replay
 * detection and result reuse across flow trace sessions.
 */
export interface IStepExecutionRecord {
  recordId: string;
  traceId: string;
  flowId: string;
  stepId: string;
  idempotencyKey: {
    traceId: string;
    flowId: string;
    stepId: string;
    attemptClass: StepAttemptClass;
    inputHash: string;
    toolPolicyHash?: string;
    portalScopeHash?: string;
  };
  disposition: StepExecutionDisposition;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  inputHash: string;
  outputHash?: string;
  sideEffectClass: StepSideEffectClass;
  replayEligible: boolean;
  checkpointId?: string;
  summary?: string;
  invalidationReason?: string;
  metadata?: StepEntryMetadata;
  error?: string;
}

/**
 * Persistence contract for step execution records.
 * Implementations may back against SQLite (primary), in-memory (test), or
 * a remote store.
 */
export interface IStepDurabilityStore {
  /** Persist a step execution record. Overwrites if recordId exists. */
  save(record: IStepExecutionRecord): Promise<void>;

  /**
   * Find a prior execution record whose idempotency key matches the given
   * query parameters. Returns null when no match exists.
   */
  findReplayCandidate(
    query: {
      traceId: string;
      flowId: string;
      stepId: string;
      attemptClass: string;
      inputHash: string;
      toolPolicyHash?: string;
      portalScopeHash?: string;
    },
  ): Promise<IStepExecutionRecord | null>;

  /** Mark a record as invalidated (superseded by a newer execution). */
  invalidate(recordId: string, reason: string): Promise<void>;
}

/**
 * Policy contract for deciding whether a prior step execution result can be
 * reused for the current step invocation.
 */
export interface IStepReplayPolicy {
  /**
   * Given the current step input and the prior execution record, decide
   * whether reuse is allowed. Return { allowed: true } to permit reuse, or
   * { allowed: false, reason: "..." } to deny with a traceable explanation.
   */
  canReuse(params: {
    step: { userPrompt: string; context: StepReplayContext };
    prior: IStepExecutionRecord;
    currentInputHash: string;
  }): { allowed: boolean; reason?: string };
}

export class DefaultStepReplayPolicy implements IStepReplayPolicy {
  canReuse(params: {
    step: { userPrompt: string; context: StepReplayContext };
    prior: IStepExecutionRecord;
    currentInputHash: string;
  }): { allowed: boolean; reason?: string } {
    switch (params.prior.sideEffectClass) {
      case StepSideEffectClass.NONE:
      case StepSideEffectClass.LLM:
        return { allowed: true };
      default:
        return {
          allowed: false,
          reason: `Step with sideEffectClass ${params.prior.sideEffectClass} is not replay-safe by default`,
        };
    }
  }
}
