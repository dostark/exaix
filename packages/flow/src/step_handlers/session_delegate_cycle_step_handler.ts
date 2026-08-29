/**
 * @module SessionDelegateCycleStepHandler
 * @path packages/flow/src/step_handlers/session_delegate_cycle_step_handler.ts
 * @description IFlowStepHandler for the `session_delegate_cycle` step type: resolves the
 *   request's PlanContext sandbox copy, parses its per-step manifests, and delegates each
 *   parsed step strictly in sequence through the injected coordinator, gating advancement
 *   on a passing IGateEvaluator review (Phase 174 Steps 2-3). No promise for sequence N+1
 *   exists before sequence N's outcome and review both pass; any failure class halts
 *   before further coordinator calls and journals a categorical rejection reason with no
 *   prompt text or host paths.
 * @architectural-layer Flows
 * @dependencies [@exaix/core/types, @exaix/schemas/flow.ts]
 * @related-files [packages/flow/src/plan_context_resolver.ts, packages/flow/src/phase_step_manifest_parser.ts, packages/session/src/session_delegation.ts]
 */

import type { IFlowStepHandler, IStepExecutionContext } from "./step_handler.ts";
import type { IAgentExecutionResult } from "@exaix/execution";
import type { IGateEvaluator, Opt, Reason } from "@exaix/core/types";
import { FlowStepType } from "@exaix/core";
import { DEFAULT_SESSION_DELEGATE_CYCLE_MAX_PLAN_BYTES, DEFAULT_SESSION_DELEGATE_CYCLE_MAX_STEPS } from "@exaix/core";
import { DomainEventType } from "@exaix/core/events";
import type { ISessionDelegateCycleConfig, ISessionDelegateCycleRejectionReason } from "@exaix/schemas/flow.ts";
import { SessionDelegateCycleAggregateSchema } from "@exaix/schemas/flow.ts";
import type { ISessionDelegationCoordinator } from "@exaix/session/session_delegation.ts";
import type { IPlanContextResolver } from "../plan_context_resolver.ts";
import { type IParsedPhaseStep, parsePhaseStepManifests } from "../phase_step_manifest_parser.ts";
import { type IFlowEventLogger, toGateConfig } from "../flow_runner.ts";

export interface ISessionDelegateCycleStepHandlerDeps {
  coordinator: ISessionDelegationCoordinator;
  planContextResolver: IPlanContextResolver;
  gateEvaluator: IGateEvaluator;
  eventLogger: IFlowEventLogger;
}

interface ICompletedCycleStep {
  sequence: number;
  delegationTraceId: string;
  summary: string;
  pathsTouched: string[];
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
 * cycle_started/cycle_step_completed/cycle_step_rejected/cycle_completed lifecycle through
 * its injected IFlowEventLogger (proven trace-correlated by a Tier A test), but is not
 * marked for the repo's mandatory-observability enforcement tag: that checker's
 * audit-logger allowlist recognizes IEventLogger/EventLogger/IEventRegistry/EventRegistry
 * only, not the flow package's own IFlowEventLogger, so tagging would be a permanent false
 * positive rather than a real gap.
 */
export class SessionDelegateCycleStepHandler implements IFlowStepHandler {
  readonly stepType = FlowStepType.SESSION_DELEGATE_CYCLE;

  constructor(private readonly deps: ISessionDelegateCycleStepHandlerDeps) {}

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

    try {
      const steps = await this.resolveAndValidatePlan(executionRoot, planContextRef);

      this.deps.eventLogger.log(DomainEventType.SessionDelegateCycleStarted, {
        flowRunId: ctx.flowRunId,
        stepId: ctx.step.id,
        traceId,
        planStepCount: steps.length,
      });

      const completed: ICompletedCycleStep[] = [];
      for (const parsedStep of steps) {
        const result = await this.delegateAndReviewStep(
          parsedStep,
          cycleConfig,
          traceId,
          ctx.step.id,
          executionRoot,
          planContextRef,
        );
        completed.push(result);
        this.deps.eventLogger.log(DomainEventType.SessionDelegateCycleStepCompleted, {
          flowRunId: ctx.flowRunId,
          stepId: ctx.step.id,
          traceId,
          delegationTraceId: result.delegationTraceId,
          sequence: result.sequence,
        });
      }

      this.deps.eventLogger.log(DomainEventType.SessionDelegateCycleCompleted, {
        flowRunId: ctx.flowRunId,
        stepId: ctx.step.id,
        traceId,
        stepCount: steps.length,
      });

      return this.buildResult(steps.length, completed);
    } catch (error) {
      if (error instanceof SessionDelegateCycleHaltError) {
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

  /** Delegates one parsed step and gates advancement on a non-empty completed outcome plus a passing review. */
  private async delegateAndReviewStep(
    parsedStep: IParsedPhaseStep,
    cycleConfig: ISessionDelegateCycleConfig,
    parentTraceId: string,
    parentStepId: string,
    worktreePath: string,
    artifactRef: string,
  ): Promise<ICompletedCycleStep> {
    const outcome = await this.deps.coordinator.delegate({
      parentTraceId,
      parentStepId,
      sequence: parsedStep.stepNumber,
      objective: parsedStep.sectionText,
      acceptanceCriteria: [
        ...(parsedStep.manifest?.acceptance?.tests ?? []),
        ...(parsedStep.manifest?.acceptance?.outcomes ?? []),
      ],
      artifactRef,
      worktreePath,
    });

    if (outcome.status !== "completed") {
      throw new SessionDelegateCycleHaltError(
        "non_completed_status",
        `session_delegate_cycle step ${parsedStep.stepNumber} did not complete: status=${outcome.status}`,
        parsedStep.stepNumber,
      );
    }
    if (cycleConfig.requireChangedPaths && outcome.pathsTouched.length === 0) {
      throw new SessionDelegateCycleHaltError(
        "empty_paths_touched",
        `session_delegate_cycle step ${parsedStep.stepNumber} reported no changed paths`,
        parsedStep.stepNumber,
      );
    }

    const gateResult = await this.deps.gateEvaluator.evaluate(
      toGateConfig(cycleConfig.review),
      outcome.summary,
      parsedStep.sectionText,
      0,
    );
    if (!gateResult.passed) {
      throw new SessionDelegateCycleHaltError(
        "review_failed",
        `session_delegate_cycle step ${parsedStep.stepNumber} failed review`,
        parsedStep.stepNumber,
      );
    }

    return {
      sequence: parsedStep.stepNumber,
      delegationTraceId: outcome.delegationTraceId,
      summary: outcome.summary,
      pathsTouched: outcome.pathsTouched,
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
