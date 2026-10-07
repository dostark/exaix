/**
 * @module FlowControlState
 * @path packages/flow/src/contracts/flow_control_state.ts
 * @description Run-local typed gate lifecycle contracts owned by the flow runtime.
 * @architectural-layer Flows
 * @dependencies [@exaix/schemas]
 * @related-files [packages/flow/src/flow_control_state_store.ts]
 */
import type { ZFlowControlState, ZGateLoopState } from "@exaix/schemas/flow.ts";
import type { z } from "zod";
export type IFlowControlState = z.infer<typeof ZFlowControlState>;
export type IGateLoopState = z.infer<typeof ZGateLoopState>;
