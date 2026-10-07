/**
 * @module StepResultFinalizer
 * @path packages/flow/src/step_result_finalizer.ts
 * @description Shares ordered namespace and checkpoint persistence across waves and gate loops.
 * @architectural-layer Flows
 * @dependencies [@exaix/schemas]
 * @related-files [packages/flow/src/wave_orchestrator.ts, packages/flow/src/flow_runner.ts]
 */
import type { IFlow } from "@exaix/schemas/flow.ts";
import type { IFlowCheckpointCoordinator, IFlowCheckpointRequest } from "./flow_checkpoint_coordinator.ts";
import type { IFlowNamespaceCoordinator } from "./flow_namespace_coordinator.ts";
import type { IStepResult } from "./flow_runner.ts";
export interface IStepFinalizationContext {
  flow: IFlow;
  request: IFlowCheckpointRequest;
  flowRunId: string;
  flowContentHash: string;
  stepResults: Map<string, IStepResult>;
}
export async function finalizeStepResult(
  ctx: IStepFinalizationContext,
  result: IStepResult,
  namespaceCoordinator: IFlowNamespaceCoordinator,
  checkpointCoordinator: IFlowCheckpointCoordinator,
): Promise<void> {
  ctx.stepResults.set(result.stepId, result);
  if (!result.success) return;
  await namespaceCoordinator.persistWaveNamespaceWrites(
    result,
    ctx.request,
    result.stepId,
    namespaceCoordinator.getNamespaceId(ctx.request, ctx.flowRunId),
    ctx.flow.namespace?.enabled === true,
  );
  await checkpointCoordinator.saveCheckpointIfEnabled(
    ctx.flow,
    ctx.request,
    ctx.flowRunId,
    ctx.flowContentHash,
    ctx.stepResults,
  );
}
