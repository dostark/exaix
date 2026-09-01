/**
 * @module IScratchpadService
 * @path packages/core/src/types/i_scratchpad_service.ts
 * @description Per-execution scratchpad store: append-only capture of lightweight agent notes
 * (remember_fact), scoped to one execution trace. Never touches global/project memory.
 * @architectural-layer Shared/Interfaces
 * @related-files ["packages/memory/src/scratchpad/scratchpad_service.ts", "packages/core/src/types/i_application_context.ts", "@exaix/schemas/memory_bank.ts"]
 */

import type { IToolResult } from "./i_tool_registry.ts";
import type { Opt, Reason } from "./optional_marker.ts";
import type { IScratchpadEntry } from "@exaix/schemas/memory_bank.ts";

export interface IScratchpadService {
  /** Appends one entry scoped to traceId; over-cap content or an exhausted entry budget is rejected with a clear error. */
  append(traceId: string, content: string, tags?: Opt<string[], Reason.OptionalInput>): Promise<IToolResult>;

  /** Reads all entries for traceId (empty when the execution wrote nothing). */
  read(traceId: string): Promise<IScratchpadEntry[]>;
}
