/**
 * @module IFlowLoaderService
 * @path packages/core/src/types/i_flow_loader_service.ts
 * @description Interface for resolving a flow blueprint by id.
 *
 *   Separate from IFlowValidatorService deliberately. RequestProcessor needs the loaded flow
 *   itself, not a verdict about it, and borrowing the loader the validator happens to hold is
 *   what produced the defect this interface removes: the processor fabricated
 *   `{ id } as IFlow`, so every field but `id` was undefined and FlowRunner crashed on
 *   `flow.steps.length`. Loading and validating are different jobs and are declared as such.
 * @architectural-layer Shared
 * @related-files [apps/common/adapters/flow_loader_adapter.ts, packages/request/src/processor.ts]
 */

import type { IFlow } from "@exaix/schemas";

export interface IFlowLoaderService {
  /** Resolve a flow blueprint by id. Rejects when the flow does not exist. */
  loadFlow(flowId: string): Promise<IFlow>;
}
