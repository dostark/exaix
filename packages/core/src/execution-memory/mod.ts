/**
 * @module ExecutionMemory
 * @path packages/core/src/execution-memory/mod.ts
 * @description Public surface of the unified per-execution memory store shared by packages/memory and packages/flow.
 * @architectural-layer Services
 * @related-files ["packages/core/src/execution-memory/execution_memory_store.ts", "packages/core/src/types/i_execution_memory_store.ts"]
 */
export { ExecutionMemoryStore, NamespaceQuotaExceededError } from "./execution_memory_store.ts";
export type { IExecutionMemoryStore } from "../types/i_execution_memory_store.ts";
