/**
 * @module FlowLoaderAdapter
 * @path apps/common/adapters/flow_loader_adapter.ts
 * @description Adapter for FlowLoader that satisfies the IFlowLoaderService interface.
 * @architectural-layer Services/Adapters
 * @related-files ["packages/flow/mod.ts", "packages/core/src/types/i_flow_loader_service.ts"]
 */

import type { IFlowLoaderService } from "@exaix/core/types";
import type { FlowLoader } from "@exaix/flow";
import type { IFlow } from "@exaix/schemas/flow.ts";

export class FlowLoaderAdapter implements IFlowLoaderService {
  constructor(private inner: FlowLoader) {}

  loadFlow(flowId: string): Promise<IFlow> {
    return this.inner.loadFlow(flowId);
  }
}
