/**
 * @module FlowLogBase
 * @path packages/flow/src/flow_log_base.ts
 * @description Builds the identifiers that every flow event payload carries: flow id, trace id, request id and, on request, the step count.
 * @architectural-layer Flow
 * @related-files [packages/flow/src/flow_runner.ts, packages/flow/src/flow_types.ts]
 */

import type { IFlow } from "@exaix/schemas/flow.ts";
import type { Opt, Reason } from "@exaix/core/types";
import type { IFlowEventLogBase, IFlowEventPayloadMap } from "./flow_types.ts";

export function getFlowLogBase(
  flow: IFlow,
  request: { traceId?: string; requestId?: string },
  options: { includeStepCount: true },
): IFlowEventPayloadMap["flow.validating"];
export function getFlowLogBase(
  flow: IFlow,
  request: { traceId?: string; requestId?: string },
  options?: Opt<{ includeStepCount?: false }, Reason.SensibleDefault>,
): IFlowEventLogBase;
export function getFlowLogBase(
  flow: IFlow,
  request: { traceId?: string; requestId?: string },
  options: { includeStepCount?: boolean } = {},
): IFlowEventLogBase | IFlowEventPayloadMap["flow.validating"] {
  return {
    flowId: flow.id,
    ...(options.includeStepCount ? { stepCount: flow.steps.length } : {}),
    traceId: request.traceId,
    requestId: request.requestId,
  };
}
