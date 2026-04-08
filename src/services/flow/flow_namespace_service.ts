/**
 * @module FlowNamespaceService
 * @path src/services/flow/flow_namespace_service.ts
 * @description Runtime contract surface for flow namespace persistence and shared blackboard coordination.
 * @architectural-layer Services
 * @related-files [src/shared/schemas/flow.ts, src/services/flow/flow_checkpoint_service.ts]
 */

import type { IFlowNamespaceWrite } from "../../shared/schemas/flow.ts";

export interface IFlowNamespaceSnapshot {
  traceId: string;
  path: string;
  entries: Record<string, string>;
  updatedAt: string;
}

export interface IFlowNamespaceService {
  getNamespacePath(traceId: string): string;
  initialize(traceId: string): Promise<IFlowNamespaceSnapshot>;
  load(traceId: string): Promise<IFlowNamespaceSnapshot>;
  readKeys(traceId: string, keys: string[]): Promise<Record<string, string | undefined>>;
  writeEntries(
    traceId: string,
    stepId: string,
    writes: IFlowNamespaceWrite[],
    stepOutput: string,
  ): Promise<IFlowNamespaceSnapshot>;
  delete(traceId: string): Promise<void>;
}

export class NamespaceQuotaExceededError extends Error {
  constructor(traceId: string, byteSize: number, maxBytes: number) {
    super(`Namespace quota exceeded for ${traceId}: ${byteSize} bytes > ${maxBytes} limit`);
    this.name = "NamespaceQuotaExceededError";
  }
}
