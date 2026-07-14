/**
 * @module IToolRegistryFactory
 * @path packages/core/src/types/i_tool_registry_factory.ts
 * @description Factory interface for creating per-execution IToolRegistry instances.
 * Injected into ExecutionLoop via IExecutionLoopConfig so the concrete
 * ToolRegistry class stays in the composition root (apps/daemon/main.ts).
 * @architectural-layer Shared
 * @related-files ["packages/execution/src/execution_loop.ts"]
 */
import type { IToolRegistry } from "./i_tool_registry.ts";

export interface IToolRegistryFactory {
  createToolRegistry(traceId: string, baseDir: string): IToolRegistry;
}
