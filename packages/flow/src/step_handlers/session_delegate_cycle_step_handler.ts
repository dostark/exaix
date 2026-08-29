/**
 * @module SessionDelegateCycleStepHandler
 * @path packages/flow/src/step_handlers/session_delegate_cycle_step_handler.ts
 * @description IFlowStepHandler for the `session_delegate_cycle` step type (Phase 174
 *   Step 2): resolves the request's PlanContext sandbox copy, parses its per-step
 *   manifests, and delegates each parsed step through the injected coordinator, gating
 *   advancement on a passing IGateEvaluator review. Strict sequential-halt semantics and
 *   the exact cycle event contract are hardened in Step 3; this handler proves the
 *   reachable end-to-end wiring for a plan.
 * @architectural-layer Flows
 * @dependencies [@exaix/core/types, @exaix/schemas/flow.ts]
 * @related-files [packages/flow/src/plan_context_resolver.ts, packages/flow/src/phase_step_manifest_parser.ts, packages/session/src/session_delegation.ts]
 */

import type { IFlowStepHandler, IStepExecutionContext } from "./step_handler.ts";
import type { IAgentExecutionResult } from "@exaix/execution";
import type { IGateEvaluator } from "@exaix/core/types";
import { FlowStepType } from "@exaix/core";
import type { ISessionDelegationCoordinator } from "@exaix/session/session_delegation.ts";
import type { IPlanContextResolver } from "../plan_context_resolver.ts";
import { parsePhaseStepManifests } from "../phase_step_manifest_parser.ts";
import { toGateConfig } from "../flow_runner.ts";

export interface ISessionDelegateCycleStepHandlerDeps {
  coordinator: ISessionDelegationCoordinator;
  planContextResolver: IPlanContextResolver;
  gateEvaluator: IGateEvaluator;
}

/**
 * Sequential per-plan-step session-delegation orchestration handler. Not yet tagged for
 * mandatory observability tracking: Step 3 adds the cycle event contract
 * (cycle_started/cycle_step_completed/etc.) and its logger dependency together.
 */
export class SessionDelegateCycleStepHandler implements IFlowStepHandler {
  readonly stepType = FlowStepType.SESSION_DELEGATE_CYCLE;

  constructor(private readonly deps: ISessionDelegateCycleStepHandlerDeps) {}

  async execute(ctx: IStepExecutionContext): Promise<IAgentExecutionResult> {
    const cycleConfig = ctx.step.delegateCycle;
    if (!cycleConfig) {
      throw new Error(`session_delegate_cycle step "${ctx.step.id}" has no delegateCycle config`);
    }

    const { executionRoot, planContextRef, traceId: parentTraceId } = ctx.request;
    if (!executionRoot || !planContextRef) {
      throw new Error(
        `session_delegate_cycle step "${ctx.step.id}" requires executionRoot and plan_context_ref on the request`,
      );
    }
    if (!parentTraceId) {
      throw new Error(`session_delegate_cycle step "${ctx.step.id}" requires a parent trace id`);
    }

    const { content } = await this.deps.planContextResolver.resolve({ executionRoot, planContextRef });
    const { steps, diagnostics } = parsePhaseStepManifests(content);
    const fatalDiagnostic = diagnostics.find((d) => d.code === "no_steps" || d.code === "duplicate_step_number");
    if (fatalDiagnostic) {
      throw new Error(`session_delegate_cycle plan parse failed: ${fatalDiagnostic.message}`);
    }

    const stepSummaries: string[] = [];
    const touchedPaths: string[] = [];

    for (const parsedStep of steps) {
      const outcome = await this.deps.coordinator.delegate({
        parentTraceId,
        parentStepId: ctx.step.id,
        sequence: parsedStep.stepNumber,
        objective: parsedStep.sectionText,
        acceptanceCriteria: [
          ...(parsedStep.manifest?.acceptance?.tests ?? []),
          ...(parsedStep.manifest?.acceptance?.outcomes ?? []),
        ],
        artifactRef: planContextRef,
        worktreePath: executionRoot,
      });

      if (outcome.status !== "completed") {
        throw new Error(
          `session_delegate_cycle step ${parsedStep.stepNumber} did not complete: status=${outcome.status}`,
        );
      }
      if (cycleConfig.requireChangedPaths && outcome.pathsTouched.length === 0) {
        throw new Error(`session_delegate_cycle step ${parsedStep.stepNumber} reported no changed paths`);
      }

      const gateResult = await this.deps.gateEvaluator.evaluate(
        toGateConfig(cycleConfig.review),
        outcome.summary,
        parsedStep.sectionText,
        0,
      );
      if (!gateResult.passed) {
        throw new Error(
          `session_delegate_cycle step ${parsedStep.stepNumber} failed review: ${gateResult.evaluation.feedback}`,
        );
      }

      stepSummaries.push(`Step ${parsedStep.stepNumber}: ${outcome.summary}`);
      touchedPaths.push(...outcome.pathsTouched);
    }

    return {
      thought: "",
      content: stepSummaries.join("\n\n"),
      raw: JSON.stringify({ stepCount: steps.length, touchedPaths }),
    };
  }
}
