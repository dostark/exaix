/**
 * @module SessionDelegateCycleStepHandler
 * @path packages/flow/src/step_handlers/session_delegate_cycle_step_handler.ts
 * @description IFlowStepHandler for the `session_delegate_cycle` step type: resolves the
 *   request's PlanContext sandbox copy, parses its per-step manifests, and delegates each
 *   parsed step strictly in sequence through the injected coordinator, gating advancement
 *   on a passing IGateEvaluator review (Phase 174 Steps 2-3). A SQLite-backed claim store
 *   is the launch source of truth — a unique (parentTraceId, parentStepId, sequence,
 *   planDigest) key guarantees at most one durable launch across crash points and
 *   duplicate handler/watcher entry — while an atomic JSON checkpoint lets the handler
 *   resume a matching non-terminal run without re-scanning claims (Phase 174 Step 4). No
 *   promise for sequence N+1 exists before sequence N's outcome and review both pass; any
 *   failure class halts before further coordinator calls and journals a categorical
 *   rejection reason with no prompt text or host paths.
 * @architectural-layer Flows
 * @dependencies [@exaix/core/types, @exaix/schemas/flow.ts, @exaix/session]
 * @related-files [packages/flow/src/plan_context_resolver.ts, packages/flow/src/phase_step_manifest_parser.ts, packages/session/src/session_delegation.ts, packages/session/src/session_delegate_cycle_claim_store.ts, packages/session/src/session_delegate_cycle_store.ts]
 */

import type { IFlowStepHandler, IStepExecutionContext } from "./step_handler.ts";
import type { IAgentExecutionResult } from "@exaix/execution";
import type { IGateEvaluator, Opt, Reason } from "@exaix/core/types";
import { FlowStepType } from "@exaix/core";
import {
  DEFAULT_SESSION_DELEGATE_CYCLE_CLAIM_MAX_POLLS,
  DEFAULT_SESSION_DELEGATE_CYCLE_CLAIM_POLL_MS,
  DEFAULT_SESSION_DELEGATE_CYCLE_MAX_PLAN_BYTES,
  DEFAULT_SESSION_DELEGATE_CYCLE_MAX_STEPS,
} from "@exaix/core";
import { DomainEventType } from "@exaix/core/events";
import type { ISessionDelegateCycleConfig, ISessionDelegateCycleRejectionReason } from "@exaix/schemas/flow.ts";
import { SessionDelegateCycleAggregateSchema, SessionDelegateCycleRejectionReasonSchema } from "@exaix/schemas/flow.ts";
import type { ISessionDelegationCoordinator, ISessionDelegationOutcome } from "@exaix/session/session_delegation.ts";
import {
  type ISessionDelegateCycleClaim,
  type ISessionDelegateCycleClaimKey,
  type ISessionDelegateCycleClaimStore,
  SessionDelegateCycleClaimAcquireOutcomeSchema,
  SessionDelegateCycleClaimStateSchema,
} from "@exaix/session/session_delegate_cycle_claim_store.ts";
import {
  type ISessionDelegateCycleCheckpoint,
  type ISessionDelegateCycleStore,
  SessionDelegateCycleCheckpointStatusSchema,
} from "@exaix/session/session_delegate_cycle_store.ts";
import type { IPlanContextResolver } from "../plan_context_resolver.ts";
import { type IParsedPhaseStep, parsePhaseStepManifests } from "../phase_step_manifest_parser.ts";
import { computePlanDigest } from "../plan_digest.ts";
import { type IFlowEventLogger, toGateConfig } from "../flow_runner.ts";

export interface ISessionDelegateCycleStepHandlerDeps {
  coordinator: ISessionDelegationCoordinator;
  planContextResolver: IPlanContextResolver;
  gateEvaluator: IGateEvaluator;
  eventLogger: IFlowEventLogger;
  claimStore: ISessionDelegateCycleClaimStore;
  cycleStore: ISessionDelegateCycleStore;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
}

/** Whether a loaded checkpoint is brand new, resuming a running cycle, or replaying a completed one. */
type CheckpointLoadMode = "fresh" | "resume" | "replay";

/** The fields runStep/driveClaim need for one parsed plan step, grouped to stay under the param-count limit. */
interface IStepDelegationContext {
  parsedStep: IParsedPhaseStep;
  cycleConfig: ISessionDelegateCycleConfig;
  parentTraceId: string;
  parentStepId: string;
  identityId: string;
  worktreePath: string;
  artifactRef: string;
}

interface ICompletedCycleStep {
  sequence: number;
  delegationTraceId: string;
  summary: string;
  pathsTouched: string[];
  outcome: ISessionDelegationOutcome;
}

/** Raised for every halt condition; carries the categorical reason the handler journals. */
class SessionDelegateCycleHaltError extends Error {
  constructor(
    readonly reason: ISessionDelegateCycleRejectionReason,
    message: string,
    readonly sequence?: Opt<number, Reason.OptionalContext>,
  ) {
    super(message);
  }
}

/**
 * Sequential per-plan-step session-delegation orchestration handler. Emits the full
 * cycle_started/cycle_resumed/cycle_step_completed/cycle_step_rejected/cycle_completed
 * lifecycle through its injected IFlowEventLogger (proven trace-correlated by a Tier A
 * test), but is not marked for the repo's mandatory-observability enforcement tag: that
 * checker's audit-logger allowlist recognizes IEventLogger/EventLogger/IEventRegistry/
 * EventRegistry only, not the flow package's own IFlowEventLogger, so tagging would be a
 * permanent false positive rather than a real gap.
 */
export class SessionDelegateCycleStepHandler implements IFlowStepHandler {
  readonly stepType = FlowStepType.SESSION_DELEGATE_CYCLE;

  private readonly now: () => Date;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly pollIntervalMs: number;
  private readonly maxPollAttempts: number;

  constructor(private readonly deps: ISessionDelegateCycleStepHandlerDeps) {
    this.now = deps.now ?? (() => new Date());
    this.sleep = deps.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_SESSION_DELEGATE_CYCLE_CLAIM_POLL_MS;
    this.maxPollAttempts = deps.maxPollAttempts ?? DEFAULT_SESSION_DELEGATE_CYCLE_CLAIM_MAX_POLLS;
  }

  async execute(ctx: IStepExecutionContext): Promise<IAgentExecutionResult> {
    const cycleConfig = ctx.step.delegateCycle;
    if (!cycleConfig) {
      throw new Error(`session_delegate_cycle step "${ctx.step.id}" has no delegateCycle config`);
    }

    const { executionRoot, planContextRef, traceId } = ctx.request;
    if (!executionRoot || !planContextRef) {
      throw new Error(
        `session_delegate_cycle step "${ctx.step.id}" requires executionRoot and plan_context_ref on the request`,
      );
    }
    if (!traceId) {
      throw new Error(`session_delegate_cycle step "${ctx.step.id}" requires a parent trace id`);
    }

    let checkpoint: ISessionDelegateCycleCheckpoint | undefined;
    try {
      const steps = await this.resolveAndValidatePlan(executionRoot, planContextRef);
      const planDigest = await computePlanDigest(
        (await this.deps.planContextResolver.resolve({
          executionRoot,
          planContextRef,
        })).content,
      );

      const init = await this.loadOrInitCheckpoint(traceId, ctx.step.id, planDigest, ctx.flowRunId);
      checkpoint = init.checkpoint;
      const completed: ICompletedCycleStep[] = init.completed;

      // A "replay" (an already-completed checkpoint reused for the same trace/step/
      // digest) is a deliberate idempotent no-op — the loop below naturally does
      // nothing, since nextSequence already exceeds every parsed step — and gets
      // neither a started nor a resumed lifecycle event of its own.
      if (init.mode !== "replay") {
        this.deps.eventLogger.log(
          init.mode === "resume"
            ? DomainEventType.SessionDelegateCycleResumed
            : DomainEventType.SessionDelegateCycleStarted,
          init.mode === "resume"
            ? { flowRunId: ctx.flowRunId, stepId: ctx.step.id, traceId }
            : { flowRunId: ctx.flowRunId, stepId: ctx.step.id, traceId, planStepCount: steps.length },
        );
      }
      await this.deps.cycleStore.save(checkpoint);

      for (const parsedStep of steps.filter((step) => step.stepNumber >= checkpoint!.nextSequence)) {
        const { result, checkpoint: afterStep } = await this.runStep(
          {
            parsedStep,
            cycleConfig,
            parentTraceId: traceId,
            parentStepId: ctx.step.id,
            identityId: ctx.step.identity,
            worktreePath: executionRoot,
            artifactRef: planContextRef,
          },
          checkpoint,
        );
        completed.push(result);
        checkpoint = this.withCompletedStep(afterStep, result);
        await this.deps.cycleStore.save(checkpoint);
        this.deps.eventLogger.log(DomainEventType.SessionDelegateCycleStepCompleted, {
          flowRunId: ctx.flowRunId,
          stepId: ctx.step.id,
          traceId,
          delegationTraceId: result.delegationTraceId,
          sequence: result.sequence,
        });
      }

      checkpoint = {
        ...checkpoint,
        status: SessionDelegateCycleCheckpointStatusSchema.enum.completed,
        updatedAt: this.now().toISOString(),
      };
      await this.deps.cycleStore.save(checkpoint);
      this.deps.eventLogger.log(DomainEventType.SessionDelegateCycleCompleted, {
        flowRunId: ctx.flowRunId,
        stepId: ctx.step.id,
        traceId,
        stepCount: steps.length,
      });

      return this.buildResult(steps.length, completed);
    } catch (error) {
      if (error instanceof SessionDelegateCycleHaltError) {
        if (checkpoint && error.reason !== SessionDelegateCycleRejectionReasonSchema.enum.checkpoint_mismatch) {
          await this.deps.cycleStore.save({
            ...checkpoint,
            status: SessionDelegateCycleCheckpointStatusSchema.enum.failed,
            failure: error.message,
            inFlight: undefined,
            updatedAt: this.now().toISOString(),
          });
        }
        this.deps.eventLogger.log(DomainEventType.SessionDelegateCycleStepRejected, {
          flowRunId: ctx.flowRunId,
          stepId: ctx.step.id,
          traceId,
          sequence: error.sequence,
          reason: error.reason,
        });
        throw new Error(error.message);
      }
      throw error;
    }
  }

  /** Resolves the PlanContext doc, enforces the byte/step-count ceilings, and parses it. */
  private async resolveAndValidatePlan(executionRoot: string, planContextRef: string): Promise<IParsedPhaseStep[]> {
    const { content } = await this.deps.planContextResolver.resolve({ executionRoot, planContextRef });
    if (new TextEncoder().encode(content).length > DEFAULT_SESSION_DELEGATE_CYCLE_MAX_PLAN_BYTES) {
      throw new SessionDelegateCycleHaltError(
        "plan_too_large",
        `session_delegate_cycle plan exceeds the ${DEFAULT_SESSION_DELEGATE_CYCLE_MAX_PLAN_BYTES}-byte ceiling`,
      );
    }

    const { steps, diagnostics } = parsePhaseStepManifests(content);
    const fatalDiagnostic = diagnostics.find((d) => d.code === "no_steps" || d.code === "duplicate_step_number");
    if (fatalDiagnostic) {
      throw new SessionDelegateCycleHaltError(
        "plan_parse_failed",
        `session_delegate_cycle plan parse failed: ${fatalDiagnostic.code}`,
      );
    }
    if (steps.length > DEFAULT_SESSION_DELEGATE_CYCLE_MAX_STEPS) {
      throw new SessionDelegateCycleHaltError(
        "too_many_steps",
        `session_delegate_cycle plan has ${steps.length} steps, exceeding the ${DEFAULT_SESSION_DELEGATE_CYCLE_MAX_STEPS}-step ceiling`,
      );
    }
    return steps;
  }

  /**
   * Loads a persisted checkpoint for (parentTraceId, flowStepId) or initializes a fresh
   * one. Rejects a checkpoint whose identity/digest no longer matches this attempt, or
   * that is already terminal — the caller must never silently overwrite that evidence.
   */
  private async loadOrInitCheckpoint(
    parentTraceId: string,
    flowStepId: string,
    planDigest: string,
    flowRunId: string,
  ): Promise<
    { checkpoint: ISessionDelegateCycleCheckpoint; completed: ICompletedCycleStep[]; mode: CheckpointLoadMode }
  > {
    const existing = await this.deps.cycleStore.load(parentTraceId, flowStepId);
    if (!existing) {
      return {
        checkpoint: {
          parentTraceId,
          lastFlowRunId: flowRunId,
          flowStepId,
          planDigest,
          revision: 0,
          nextSequence: 1,
          completedSteps: [],
          status: SessionDelegateCycleCheckpointStatusSchema.enum.running,
          updatedAt: this.now().toISOString(),
        },
        completed: [],
        mode: "fresh",
      };
    }
    // A persisted terminal failure is immutable evidence (Safety Gates): it must never
    // be silently retried. An identity/digest mismatch means either a forged checkpoint
    // or an operator editing the hardened plan mid-cycle — both fail closed. A
    // completed checkpoint is not a mismatch: it is a legitimate idempotent replay.
    if (
      existing.status === SessionDelegateCycleCheckpointStatusSchema.enum.failed ||
      existing.parentTraceId !== parentTraceId ||
      existing.flowStepId !== flowStepId ||
      existing.planDigest !== planDigest
    ) {
      throw new SessionDelegateCycleHaltError(
        SessionDelegateCycleRejectionReasonSchema.enum.checkpoint_mismatch,
        `session_delegate_cycle checkpoint for "${flowStepId}" does not match this attempt`,
      );
    }
    return {
      checkpoint: { ...existing, lastFlowRunId: flowRunId },
      completed: existing.completedSteps.map((step) => ({
        sequence: step.sequence,
        delegationTraceId: step.delegationTraceId,
        summary: step.outcome.summary,
        pathsTouched: step.outcome.pathsTouched,
        outcome: step.outcome,
      })),
      mode: existing.status === SessionDelegateCycleCheckpointStatusSchema.enum.completed ? "replay" : "resume",
    };
  }

  /**
   * Acquires (or reclaims/awaits) the durable claim for one plan step and drives it to a
   * reviewed or failed terminal state, checkpointing `inFlight` after each transition.
   */
  private async runStep(
    step: IStepDelegationContext,
    checkpoint: ISessionDelegateCycleCheckpoint,
  ): Promise<{ result: ICompletedCycleStep; checkpoint: ISessionDelegateCycleCheckpoint }> {
    const { parsedStep, parentTraceId, parentStepId } = step;
    const key: ISessionDelegateCycleClaimKey = {
      parentTraceId,
      parentStepId,
      sequence: parsedStep.stepNumber,
      planDigest: checkpoint.planDigest,
    };
    const resumingThisSequence = checkpoint.inFlight?.sequence === parsedStep.stepNumber;
    const mintedTraceId = crypto.randomUUID();

    const acquireResult = await this.deps.claimStore.acquire(key, mintedTraceId);
    let owned = acquireResult.outcome === SessionDelegateCycleClaimAcquireOutcomeSchema.enum.acquired;
    let claim = acquireResult.claim;
    if (!owned && resumingThisSequence && claim.state === SessionDelegateCycleClaimStateSchema.enum.claimed) {
      const reclaimed = await this.deps.claimStore.reclaimPreLaunch(key, mintedTraceId);
      owned = reclaimed.outcome === SessionDelegateCycleClaimAcquireOutcomeSchema.enum.acquired;
      claim = reclaimed.claim;
    }

    let latestCheckpoint = checkpoint;
    const persistInFlight = async (current: ISessionDelegateCycleClaim): Promise<void> => {
      latestCheckpoint = {
        ...latestCheckpoint,
        inFlight: {
          idempotencyKey: `${key.parentTraceId}:${key.parentStepId}:${key.sequence}:${key.planDigest}`,
          sequence: key.sequence,
          delegationTraceId: current.delegationTraceId,
          state: current.state === SessionDelegateCycleClaimStateSchema.enum.failed
            ? SessionDelegateCycleClaimStateSchema.enum.returned
            : current.state,
        },
        status: SessionDelegateCycleCheckpointStatusSchema.enum.running,
        revision: latestCheckpoint.revision + 1,
        updatedAt: this.now().toISOString(),
      };
      await this.deps.cycleStore.save(latestCheckpoint);
    };
    await persistInFlight(claim);

    const finalClaim = await this.driveClaim(step, claim, owned, key, persistInFlight);

    return { result: this.claimToCompletedStep(finalClaim, parsedStep.stepNumber), checkpoint: latestCheckpoint };
  }

  /**
   * Drives one claim from wherever its state currently is to reviewed or failed,
   * never launching unless this call owns the claim (fresh acquire or a pre-launch
   * reclaim). A claim owned elsewhere (live duplicate entry, or a resumed launched/
   * returned claim with no local ownership) is awaited via poll rather than relaunched.
   */
  private async driveClaim(
    step: IStepDelegationContext,
    claim: ISessionDelegateCycleClaim,
    owned: boolean,
    key: ISessionDelegateCycleClaimKey,
    persist: (claim: ISessionDelegateCycleClaim) => Promise<void>,
  ): Promise<ISessionDelegateCycleClaim> {
    const { parsedStep, cycleConfig, parentTraceId, parentStepId, identityId, worktreePath, artifactRef } = step;
    let state = claim.state;
    let outcome = claim.outcome;
    const delegationTraceId = claim.delegationTraceId;
    let ownsReturnedTransition = false;

    const claimState = SessionDelegateCycleClaimStateSchema.enum;
    if (state === claimState.claimed) {
      if (!owned) {
        const settled = await this.pollUntilSettled(key, (c) => c.state !== claimState.claimed, parsedStep.stepNumber);
        state = settled.state;
        outcome = settled.outcome;
      } else {
        await this.deps.claimStore.transition(key, claimState.launched);
        await persist({ ...claim, state: claimState.launched });
        outcome = await this.deps.coordinator.delegate({
          parentTraceId,
          parentStepId,
          identityId,
          sequence: parsedStep.stepNumber,
          objective: parsedStep.sectionText,
          acceptanceCriteria: [
            ...(parsedStep.manifest?.acceptance?.tests ?? []),
            ...(parsedStep.manifest?.acceptance?.outcomes ?? []),
          ],
          artifactRef,
          worktreePath,
          delegationTraceId,
        });
        await this.deps.claimStore.transition(key, claimState.returned, { outcome });
        await persist({ ...claim, state: claimState.returned });
        state = claimState.returned;
        ownsReturnedTransition = true;
      }
    }

    if (state === claimState.launched) {
      const settled = await this.pollUntilSettled(key, (c) => c.state !== claimState.launched, parsedStep.stepNumber);
      state = settled.state;
      outcome = settled.outcome;
    }

    // A claim reaching the returned state through any path other than this call's own
    // launch (a live duplicate entry, or a resumed claim someone else launched) may
    // already be under review elsewhere. Give that owner a bounded window before this
    // call takes over the review itself — the self-heal path a crash between returning
    // and reviewing requires, since no one else will ever revisit that claim.
    if (state === claimState.returned && !ownsReturnedTransition) {
      const settled = await this.pollUntilSettledOrTimeout(
        key,
        (c) => c.state === claimState.reviewed || c.state === claimState.failed,
        claim,
      );
      if (settled.settled) {
        state = settled.claim.state;
        outcome = settled.claim.outcome;
      }
    }

    if (state === claimState.returned) {
      const failureReason = outcome
        ? this.validateOutcome(outcome, cycleConfig)
        : SessionDelegateCycleRejectionReasonSchema.enum.non_completed_status;
      if (failureReason) {
        await this.deps.claimStore.transition(key, claimState.failed, { failureReason });
        throw new SessionDelegateCycleHaltError(
          failureReason,
          `session_delegate_cycle step ${parsedStep.stepNumber}: ${failureReason}`,
          parsedStep.stepNumber,
        );
      }
      const gateResult = await this.deps.gateEvaluator.evaluate(
        toGateConfig(cycleConfig.review),
        outcome!.summary,
        parsedStep.sectionText,
        0,
      );
      if (!gateResult.passed) {
        await this.deps.claimStore.transition(key, claimState.failed, {
          failureReason: SessionDelegateCycleRejectionReasonSchema.enum.review_failed,
        });
        throw new SessionDelegateCycleHaltError(
          SessionDelegateCycleRejectionReasonSchema.enum.review_failed,
          `session_delegate_cycle step ${parsedStep.stepNumber} failed review`,
          parsedStep.stepNumber,
        );
      }
      await this.deps.claimStore.transition(key, claimState.reviewed);
      state = claimState.reviewed;
    }

    if (state === claimState.failed) {
      throw new SessionDelegateCycleHaltError(
        (claim.failureReason as Opt<ISessionDelegateCycleRejectionReason, Reason.OptionalContext>) ??
          SessionDelegateCycleRejectionReasonSchema.enum.non_completed_status,
        `session_delegate_cycle step ${parsedStep.stepNumber} failed: ${claim.failureReason ?? "unknown"}`,
        parsedStep.stepNumber,
      );
    }

    return { ...claim, state: claimState.reviewed, outcome, delegationTraceId };
  }

  private validateOutcome(
    outcome: ISessionDelegationOutcome,
    cycleConfig: ISessionDelegateCycleConfig,
  ): ISessionDelegateCycleRejectionReason | null {
    if (outcome.status !== "completed") return SessionDelegateCycleRejectionReasonSchema.enum.non_completed_status;
    if (cycleConfig.requireChangedPaths && outcome.pathsTouched.length === 0) return "empty_paths_touched";
    return null;
  }

  /** Polls a claim not owned by this call until `predicate` is true, or fails visibly. */
  private async pollUntilSettled(
    key: ISessionDelegateCycleClaimKey,
    predicate: (claim: ISessionDelegateCycleClaim) => boolean,
    sequence: number,
  ): Promise<ISessionDelegateCycleClaim> {
    for (let attempt = 0; attempt < this.maxPollAttempts; attempt++) {
      const current = await this.deps.claimStore.get(key);
      if (current && predicate(current)) return current;
      await this.sleep(this.pollIntervalMs);
    }
    const last = await this.deps.claimStore.get(key);
    if (last && predicate(last)) return last;
    throw new SessionDelegateCycleHaltError(
      SessionDelegateCycleRejectionReasonSchema.enum.non_completed_status,
      `session_delegate_cycle step ${sequence} did not settle within the poll budget`,
      sequence,
    );
  }

  /** Like pollUntilSettled, but returns the last observed claim instead of throwing on timeout. */
  private async pollUntilSettledOrTimeout(
    key: ISessionDelegateCycleClaimKey,
    predicate: (claim: ISessionDelegateCycleClaim) => boolean,
    fallback: ISessionDelegateCycleClaim,
  ): Promise<{ claim: ISessionDelegateCycleClaim; settled: boolean }> {
    let last = fallback;
    for (let attempt = 0; attempt < this.maxPollAttempts; attempt++) {
      const current = await this.deps.claimStore.get(key);
      if (current) {
        last = current;
        if (predicate(current)) return { claim: current, settled: true };
      }
      await this.sleep(this.pollIntervalMs);
    }
    const final = await this.deps.claimStore.get(key);
    if (final) {
      last = final;
      if (predicate(final)) return { claim: final, settled: true };
    }
    return { claim: last, settled: false };
  }

  private claimToCompletedStep(claim: ISessionDelegateCycleClaim, sequence: number): ICompletedCycleStep {
    if (!claim.outcome) {
      throw new SessionDelegateCycleHaltError(
        SessionDelegateCycleRejectionReasonSchema.enum.non_completed_status,
        `session_delegate_cycle step ${sequence} reached reviewed with no recorded outcome`,
        sequence,
      );
    }
    return {
      sequence,
      delegationTraceId: claim.delegationTraceId,
      summary: claim.outcome.summary,
      pathsTouched: claim.outcome.pathsTouched,
      outcome: claim.outcome,
    };
  }

  private withCompletedStep(
    checkpoint: ISessionDelegateCycleCheckpoint,
    result: ICompletedCycleStep,
  ): ISessionDelegateCycleCheckpoint {
    return {
      ...checkpoint,
      completedSteps: [
        ...checkpoint.completedSteps.filter((step) => step.sequence !== result.sequence),
        {
          sequence: result.sequence,
          delegationTraceId: result.delegationTraceId,
          outcome: result.outcome,
          reviewedAt: this.now().toISOString(),
        },
      ],
      nextSequence: result.sequence + 1,
      inFlight: undefined,
      status: SessionDelegateCycleCheckpointStatusSchema.enum.running,
      revision: checkpoint.revision + 1,
      updatedAt: this.now().toISOString(),
    };
  }

  /** Builds and schema-validates the final aggregate result returned to FlowRunner. */
  private buildResult(stepCount: number, completed: ICompletedCycleStep[]): IAgentExecutionResult {
    const touchedPaths = completed.flatMap((s) => s.pathsTouched);
    const validated = SessionDelegateCycleAggregateSchema.parse({
      stepCount,
      touchedPaths,
      steps: completed.map(({ sequence, delegationTraceId, summary }) => ({ sequence, delegationTraceId, summary })),
    });

    return {
      thought: "",
      content: completed.map((s) => `Step ${s.sequence}: ${s.summary}`).join("\n\n"),
      raw: JSON.stringify(validated),
    };
  }
}
