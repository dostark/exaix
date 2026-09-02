/**
 * @module IExecutionMemoryStore
 * @path packages/core/src/types/i_execution_memory_store.ts
 * @description Unified per-execution memory store contract: free-text agent notes (soft-degrade
 *   append-only capture) and flow-namespace variables (hard-fail keyed writes) as different
 *   methods on one service over one shared log.
 * @architectural-layer Shared/Interfaces
 * @related-files ["packages/core/src/execution-memory/execution_memory_store.ts", "packages/core/src/types/i_application_context.ts", "@exaix/schemas/memory_bank.ts"]
 */

import type { IToolResult } from "./i_tool_registry.ts";
import type { Opt, Reason } from "./optional_marker.ts";
import type { IScratchpadEntry } from "@exaix/schemas/memory_bank.ts";
import type { IFlowNamespaceWrite } from "@exaix/schemas/flow.ts";

export interface IExecutionMemoryStore {
  /** Appends one note-kind entry scoped to traceId; over-cap content or an exhausted entry budget is rejected with a clear error. */
  appendNote(traceId: string, content: string, tags?: Opt<string[], Reason.OptionalInput>): Promise<IToolResult>;

  /** Reads all note-kind entries for traceId (empty when the execution wrote nothing). */
  readNotes(traceId: string): Promise<IScratchpadEntry[]>;

  /** Applies a flow step's namespace write batch (skip-on-invalid-key, truncate-on-oversized-value, throw-only-on-total-quota). */
  writeNamespaceEntries(
    traceId: string,
    stepId: string,
    writes: IFlowNamespaceWrite[],
    stepOutput: string,
  ): Promise<void>;

  /** Reads the requested namespace keys for traceId; missing keys resolve to undefined. */
  readKeys(traceId: string, keys: string[]): Promise<Record<string, string | undefined>>;

  /** Resolves the per-trace log path (the flow run result's namespace artifact path). */
  getNamespacePath(traceId: string): string;
}
